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

// THE ONBOARDING RUN'S Work Areas - WA / Road / Drain / Culvert per version. The
// SMOKE ground (SM01..SM13, SM<nn>-01..09) is NOT part of onboarding any more (app
// owner, 2026-10-21: a full run with smoke took ~9 h): tests/onboarding-smoke
// imports it into the last onboarded project (smokeAreaPlan below).
function areaPlan(run) {
  const versions = [
    run.roots && run.roots.allSites,
    run.roots && run.roots.site,
    ...ROUNDS.map((r) => run.rounds[r.key] && run.rounds[r.key].label),
  ].filter(Boolean);
  return versions.flatMap((v, i) => Object.entries(SECTION_PLAN).map(([kind, plan]) => (
    { name: `${kind}${String(i + 1).padStart(2, '0')}`, version: v, kind, plan })));
}

// THE SMOKE GROUND of an onboarded project (tests/onboarding-smoke, app owner
// 2026-10-21). The smoke folder's stages run UNCHANGED on it through the DRS smoke
// chains (tests/integration/drs-smoke-profile.js):
//   SM01..SM13      the full smoke chain, on the All-sites root (All sites v1) -
//                   13 stages own an area each (a stage consumes sections or leaves
//                   records, e.g. SM28's open NC, that would disturb the others)
//   SM<nn>-01..09   the smoke RFI / NC stages on version nn's own codes, for every
//                   other version (nn = the version's WA<nn> number): RFI desktop,
//                   RFI mobile, NC, NC-blocks-RFI, dependency chain, RFI create and
//                   the three bulk areas
// TABLE + INVERTER like a BL block (288 + 12). Versions come from the project's
// own WA<nn> -> version map, so this works on any onboarded project.
const SMOKE_AREAS = 13;
const SMOKE_PLAN = { table: 288, inverter: 12 };
const VERSION_SMOKE_SLOTS = 9;

function smokeAreaPlan(project) {
  const pad = (n) => String(n).padStart(2, '0');
  const byNn = Object.entries(project.areaVersions || {})
    .map(([wa, v]) => [(wa.match(/^WA(\d{2})$/) || [])[1], v]).filter(([nn]) => nn).sort();
  const root = (byNn.find(([nn]) => nn === '01') || [])[1];
  const areas = [];
  if (root) for (let n = 1; n <= SMOKE_AREAS; n += 1) areas.push({ name: `SM${pad(n)}`, version: root, kind: 'SM', plan: SMOKE_PLAN });
  for (const [nn, v] of byNn) {
    if (v === root) continue;
    for (let k = 1; k <= VERSION_SMOKE_SLOTS; k += 1) areas.push({ name: `SM${nn}-${pad(k)}`, version: v, kind: 'SMV', plan: SMOKE_PLAN });
  }
  return areas;
}

// THE COVERAGE GROUND of one onboarding-smoke run: a FRESH area per version,
// CV<nn>-S<k> (nn = the version's WA<nn>, S<k> = the smoke run). Every checkpoint
// of every new code consumes Work Sections (R6: 16-22 of WA<nn>'s 60 TABLEs, plus
// the throwaway ones), and the suite is re-run after every deployment, so each run
// raises its coverage RFIs / NCs on areas of its own instead of wearing out WA<nn>.
const COVERAGE_PLAN = { table: 60, inverter: 10 };
const coverageArea = (nn, smokeRun) => `CV${nn}-${smokeRun}`;

// Only versions this suite BUILT carry new codes (the roots predate the run).
function builtVersions(envKey) {
  const labels = new Set();
  for (const chain of Object.values(state.envRecord(envKey).catalogs || {})) {
    for (const rec of Object.values(chain)) if (rec && rec.onboarding && rec.codes) labels.add(rec.label);
  }
  return labels;
}

function coverageAreaPlan(project, smokeRun, envKey = DATA.DRS_ENV || String(process.env.DRS_ENV || 'uat').toLowerCase()) {
  const built = builtVersions(envKey);
  return Object.entries(project.areaVersions || {})
    .map(([wa, v]) => [(wa.match(/^WA(\d{2})$/) || [])[1], v]).filter(([nn, v]) => nn && built.has(v)).sort()
    .map(([nn, v]) => ({ name: coverageArea(nn, smokeRun), version: v, kind: 'CV', plan: COVERAGE_PLAN }));
}

// THE ONBOARDING-SMOKE RUNS (S1, S2 ...) under env.onboardingSmoke, one per
// invocation of run-onboarding-smoke.js on an onboarded project: `fresh` closes an
// open one and starts S<n+1>; otherwise the open run is resumed (--from / --only).
function smokeRun(envKey, projectTag, { fresh }) {
  return state.mutateEnv(envKey, (env) => {
    const os = env.onboardingSmoke = env.onboardingSmoke || { lastRun: 0, runs: {} };
    os.runs = os.runs || {};
    const open = Object.values(os.runs).find((r) => !r.done);
    if (open && !fresh) return open;
    if (open) os.runs[open.run] = { ...open, done: true, abandoned: true, doneAt: new Date().toISOString() };
    const n = (os.lastRun || 0) + 1;
    const run = { run: `S${n}`, n, projectTag, startedAt: new Date().toISOString(), done: false };
    os.lastRun = n;
    os.runs[run.run] = run;
    return run;
  });
}

function closeSmokeRun(envKey, runId) {
  return state.mutateEnv(envKey, (env) => {
    const r = env.onboardingSmoke.runs[runId];
    env.onboardingSmoke.runs[runId] = { ...r, done: true, doneAt: new Date().toISOString() };
    return env.onboardingSmoke.runs[runId];
  });
}

module.exports = {
  ROUNDS, record, currentRun, putRun, chainName, areaPlan, smokeAreaPlan, coverageAreaPlan, coverageArea,
  smokeRun, closeSmokeRun, SECTION_PLAN, SMOKE_AREAS, VERSION_SMOKE_SLOTS,
};
