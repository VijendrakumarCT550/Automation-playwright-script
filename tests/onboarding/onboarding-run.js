const state = require('../drs/utils/drs-state');
const DATA = require('../drs/drs-data');

// THE ONBOARDING RUN (tests/onboarding, app owner 2026-10-19; docs/drs-onboarding-suite.md).
//
// Every run of the suite onboards one fresh project whose Work Areas carry SIX
// catalog versions (five when the site has no v1 of its own):
//   root  All sites v1                    → WA01
//   root  <site> v1 (if it exists)        → WA02
//   A1    All sites, drafted from All sites v1, locked     → WA..
//   S1    <site>, drafted from <site> v1 (or All sites v1), locked
//   A2    All sites, drafted from A1, locked
//   S2    <site>, drafted from S1, locked
// The run is numbered (R1, R2 ...) - the number goes into our checklist names
// ("AUTO R1 PC05 Checklist 1") - and recorded in the DRS state file under
// env.onboarding, the moment each piece exists (everything DRS makes is permanent).
// A run that stops part-way is RESUMED by the next one (app owner: "resume ok").

const ROUNDS = [
  { key: 'A1', chain: 'All sites', round: 1 },
  { key: 'S1', chain: 'site', round: 1 },
  { key: 'A2', chain: 'All sites', round: 2 },
  { key: 'S2', chain: 'site', round: 2 },
];

function record(envKey) {
  return state.envRecord(envKey).onboarding || { lastRun: 0, runs: {} };
}

// The run to work on: the open one, else a new R<n+1>. Atomic (state.mutateEnv):
// parallel workers starting together must all get the SAME new run.
function currentRun(envKey) {
  return state.mutateEnv(envKey, (env) => {
    const ob = env.onboarding = env.onboarding || { lastRun: 0, runs: {} };
    ob.runs = ob.runs || {};
    const open = Object.values(ob.runs).find((r) => !r.done);
    if (open) return open;
    const n = (ob.lastRun || 0) + 1;
    const run = { run: `R${n}`, n, startedAt: new Date().toISOString(), rounds: {}, done: false };
    ob.lastRun = n;
    ob.runs[run.run] = run;
    return run;
  });
}

// Merges patch into the run; `rounds` and `roots` are merged key by key, so the
// two chains' workers recording theirs never drop each other's.
function putRun(envKey, runId, patch) {
  return state.mutateEnv(envKey, (env) => {
    const ob = env.onboarding = env.onboarding || { lastRun: 0, runs: {} };
    const cur = (ob.runs = ob.runs || {})[runId] || {};
    const run = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    if (patch.rounds) run.rounds = { ...(cur.rounds || {}), ...patch.rounds };
    if (patch.roots) run.roots = { ...(cur.roots || {}), ...patch.roots };
    ob.runs[runId] = run;
    return run;
  });
}

// The chain name the Packages Configurator uses for a round: "All sites" or the site.
const chainName = (round) => (round.chain === 'site' ? DATA.site : 'All sites');

// The run's Work Areas, in version order (the two roots, then A1, S1, A2, S2; a
// missing root site v1 is left out). Each version gets FOUR Work Areas, all
// pinned to it (app owner, 2026-10-19): WA<nn> (TABLE + INVERTER + CABLE),
// Road<nn> (ROAD), Drain<nn> (DRAIN) and Culvert<nn> (CULVERT) - linear works
// are Work Areas of their own, as in the production app's layout; D05 maps
// Road Works / Drain Work / Culvert Works only onto their own kind of area.
// (Observed, possible DRS bug for the app owner: the import also rejects one area
// holding two same-named sections of different types - DUPLICATE_IN_PAYLOAD. That
// is not why the areas are separate.)
const SECTION_PLAN = {
  WA: { table: 60, inverter: 25, cable: 10 },
  Road: { road: 10 },
  Drain: { drain: 10 },
  Culvert: { culvert: 10 },
};

// THE SMOKE GROUND (app owner, 2026-10-21): the smoke folder's stages (SM01-SM29)
// run UNCHANGED on the run's project through the DRS smoke chain
// (tests/integration/drs-smoke-profile.js), on standard checkpoints first. They
// give 13 stages a Work Area each (a stage consumes sections or leaves records -
// e.g. SM28's open NC - that would disturb the others), so the project gets 13
// areas of their own: SM01..SM13, TABLE + INVERTER like a BL block (288 + 12),
// pinned to the All-sites root (All sites v1, the standard Piling catalog).
const SMOKE_AREAS = 13;
const SMOKE_PLAN = { table: 288, inverter: 12 };
// THE SMOKE RFI / NC SCENARIOS ON EVERY OTHER VERSION (app owner, 2026-10-21:
// "for all new catalog site and all site specific, not only v1"): the site root
// and every version the run builds get the smoke RFI / NC stages too, on that
// version's own codes (drs-smoke-profile.js version profiles). Each version n
// (02 = the site root, then A1, S1, A2, S2) gets the 9 areas those stages own -
// SM<nn>-01..09: RFI desktop, RFI mobile, NC, NC-blocks-RFI, dependency chain,
// RFI create, and the three bulk areas - pinned to that version.
const VERSION_SMOKE_SLOTS = 9;

function areaPlan(run) {
  const versions = [
    run.roots && run.roots.allSites,
    run.roots && run.roots.site,
    ...ROUNDS.map((r) => run.rounds[r.key] && run.rounds[r.key].label),
  ].filter(Boolean);
  const areas = versions.flatMap((v, i) => Object.entries(SECTION_PLAN).map(([kind, plan]) => (
    { name: `${kind}${String(i + 1).padStart(2, '0')}`, version: v, kind, plan })));
  const root = run.roots && run.roots.allSites;
  const pad = (n) => String(n).padStart(2, '0');
  if (root) {
    for (let n = 1; n <= SMOKE_AREAS; n += 1) {
      areas.push({ name: `SM${pad(n)}`, version: root, kind: 'SM', plan: SMOKE_PLAN });
    }
  }
  versions.forEach((v, i) => {
    if (v === root) return; // All sites v1: the full smoke chain on SM01..SM13
    for (let k = 1; k <= VERSION_SMOKE_SLOTS; k += 1) {
      areas.push({ name: `SM${pad(i + 1)}-${pad(k)}`, version: v, kind: 'SMV', plan: SMOKE_PLAN });
    }
  });
  return areas;
}

module.exports = { ROUNDS, record, currentRun, putRun, chainName, areaPlan, SECTION_PLAN, SMOKE_AREAS, VERSION_SMOKE_SLOTS };
