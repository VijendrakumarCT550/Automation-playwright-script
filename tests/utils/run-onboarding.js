#!/usr/bin/env node
// THE ONBOARDING SUITE RUNNER (docs/drs-onboarding-suite.md).
//
//   npm run onboarding:uat          the whole suite, in order
//   node tests/utils/run-onboarding.js --from OB02   resume from a stage
//   node tests/utils/run-onboarding.js --list        print the stages only
//   node tests/utils/run-onboarding.js --run R1 --from IN01   stages on a given (even closed) run
//   ONBOARDING_LANES=1 npm run onboarding:uat        no parallel workers at all
//
// Stages, each its own Playwright invocation (they are different projects, and a
// failed stage must stop the chain - every later stage depends on it):
//   D01   DRS masters (vendors, SPV, site)                       project `drs`
//   OB01  the run's catalog versions: roots + A1 / S1 / A2 / S2   project `onboarding`
//   OB02  fresh project, WA01..WA0n, pins, the two SOs           project `onboarding`
//   D05   SO Configuration on that project (all versions)         project `drs`
//   D06   SO Line Mapping on that project                         project `drs`
//   IN01  Pulse users of the project (CI, CIE, EE, QI, PM, EL, QL) project `integration`
//   OB03  Pulse WAM: Civil on every area, Electrical on WA<nn>    project `onboarding`
//   OB04  Pulse RFIs on every area + the dependency plans         project `onboarding`
//   OB05  Pulse NC cycle on every area + every new sub-activity    project `onboarding`
//   SMOKE the smoke folder (SM01-SM29) unchanged on SM01..SM13      projects `smoke-drs-*`
//   SMOKEV smoke RFI / NC stages on every other version (SM<nn>-..)  projects `smoke-drsv<nn>-*`
// Stages from D05 on get DRS_PROJECT_TAG = the run's project (read from the state
// file after OB02). URLs come from DRS_ENV / PULSE_ENV, as everywhere (tests/config);
// PULSE_ENV defaults to the Pulse the DRS environment syncs to (drs-environments
// pairedPulse), so the Pulse stages never land on an unpaired Pulse.

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
// `workers` (2026-10-21): stages whose tests are independent run in parallel
// workers - the two catalog chains, SO Configuration per version, SO Line Mapping
// per SO, and the Pulse RFI / NC items (disjoint Work Areas; Pulse allows several
// sessions of one user). Shared state is written under a lock (drs-state).
// ONBOARDING_LANES caps the parallel stages (1 = one after the other).
const LANES = Math.max(1, Number(process.env.ONBOARDING_LANES || 3));
const STAGES = [
  { id: 'D01', project: 'drs', files: ['tests/drs/setup/D01_masters.spec.js'], workers: 1 },
  { id: 'OB01', project: 'onboarding', files: ['tests/onboarding/OB01_catalogs.spec.js'], workers: 2 },
  { id: 'OB02', project: 'onboarding', files: ['tests/onboarding/OB02_project.spec.js'], workers: 1 },
  { id: 'D05', project: 'drs', files: ['tests/drs/setup/D05_so_configuration.spec.js'], needsProject: true, workers: 3 },
  { id: 'D06', project: 'drs', files: ['tests/drs/setup/D06_so_line_mapping.spec.js'], needsProject: true, workers: 2 },
  { id: 'IN01', project: 'integration', files: ['tests/integration/IN01_users.spec.js'], needsProject: true, workers: 1 },
  { id: 'OB03', project: 'onboarding', files: ['tests/onboarding/OB03_pulse_wam.spec.js'], needsProject: true, workers: 1 },
  { id: 'OB04', project: 'onboarding', files: ['tests/onboarding/OB04_pulse_rfi.spec.js'], needsProject: true, workers: 3 },
  { id: 'OB05', project: 'onboarding', files: ['tests/onboarding/OB05_pulse_nc.spec.js'], needsProject: true, workers: 3 },
  // The smoke folder's stages, UNCHANGED, on the project's SM01..SM13 areas
  // (standard checkpoints): the `smoke-drs-*` chain playwright.config.js builds for
  // the project named by DRS_PROJECT_TAG (tests/integration/drs-smoke-profile.js).
  // One worker - the chain shares users and WAM, its order is the FIFO queue.
  { id: 'SMOKE', project: 'smoke-drs-*', files: [], needsProject: true, workers: 1 },
  // The smoke RFI / NC stages on every other catalog version (site root, A1, S1,
  // A2, S2): one chain per version, chains in parallel lanes (runVersionChains).
  { id: 'SMOKEV', project: 'smoke-drsv<nn>-*', files: [], versionChains: true, needsProject: true, workers: 1 },
];

if (!process.env.PULSE_ENV) {
  const { DRS_ENVIRONMENTS } = require('../config/drs-environments');
  const drs = DRS_ENVIRONMENTS[String(process.env.DRS_ENV || 'uat').toLowerCase()];
  if (drs && drs.pairedPulse && drs.pairedPulse.length) process.env.PULSE_ENV = drs.pairedPulse[0];
}

const argv = process.argv.slice(2);
const runIdx = argv.indexOf('--run');
const RUN_ID = runIdx >= 0 ? argv[runIdx + 1] : null;
const fromIdx = argv.indexOf('--from');
const from = fromIdx >= 0 ? argv[fromIdx + 1] : null;
const start = from ? STAGES.findIndex((s) => s.id === from) : 0;
if (start < 0) { console.error(`unknown stage "${from}" - one of ${STAGES.map((s) => s.id).join(', ')}`); process.exit(2); }
if (argv.includes('--list')) {
  STAGES.forEach((s, i) => console.log(`${i < start ? '  (skip)' : '        '} ${s.id}  ${s.project}  workers ${Math.min(s.workers, LANES)}  ${s.files.join(' ')}`));
  process.exit(0);
}

function runProjectTag() {
  delete require.cache[require.resolve('../drs/utils/drs-state')];
  const state = require('../drs/utils/drs-state');
  const env = String(process.env.DRS_ENV || 'uat').toLowerCase();
  const ob = state.envRecord(env).onboarding || { runs: {} };
  // --run R<n> targets that run even when it is closed (e.g. Pulse stages added
  // after its DRS side finished); otherwise the open run.
  const open = RUN_ID ? (ob.runs || {})[RUN_ID] || null : Object.values(ob.runs || {}).find((r) => !r.done) || null;
  return { env, state, run: open };
}

// THE REPORT - in the SAME places as the smoke / integration runs (app owner,
// 2026-10-21). Each stage is its own Playwright invocation, so each would
// overwrite playwright-report/; instead every stage writes a blob and, at the end
// (also when a stage fails), they are merged into ONE report of the whole
// invocation:
//   playwright-report/index.html     the HTML report (npx playwright show-report)
//   onboarding-reports/results.json  JSON   ·  onboarding-reports/junit.xml  JUnit
//   onboarding-reports/summary.md    stage, result, workers, time, test totals
// (as smoke writes smoke-reports/results.json + junit.xml). A copy of all four is
// kept per invocation in onboarding-reports/<start time>/ as history.
const STAMP = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const LATEST = path.join(ROOT, 'onboarding-reports');
const HTML = path.join(ROOT, 'playwright-report');
const REPORT = path.join(LATEST, STAMP);
const BLOBS = path.join(REPORT, 'blobs');
fs.mkdirSync(BLOBS, { recursive: true });
const results = [];
const fmt = (ms) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`);

// `known` = the run, when the caller has it: once the run is CLOSED it is no
// longer the open run runProjectTag finds.
function writeReport(status, known) {
  const run = known || runProjectTag().run;
  if (fs.readdirSync(BLOBS).length) {
    spawnSync('npx', ['playwright', 'merge-reports', '--reporter=html,json,junit', `"${BLOBS}"`], {
      cwd: ROOT, stdio: 'inherit', shell: true,
      env: {
        ...process.env,
        PLAYWRIGHT_HTML_OUTPUT_DIR: HTML,
        PLAYWRIGHT_HTML_OPEN: 'never',
        PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(LATEST, 'results.json'),
        PLAYWRIGHT_JUNIT_OUTPUT_NAME: path.join(LATEST, 'junit.xml'),
      },
    });
  }
  let stats = null;
  try { stats = JSON.parse(fs.readFileSync(path.join(LATEST, 'results.json'), 'utf8')).stats; } catch { /* no tests ran */ }
  const lines = [
    `# Onboarding run ${run ? run.run : '?'} - ${status}`, '',
    `- **Project:** ${(run && run.projectTag) || '(not created)'}`,
    `- **DRS / Pulse:** drs-${String(process.env.DRS_ENV || 'uat').toLowerCase()} / pulse-${process.env.PULSE_ENV || '?'}`,
    `- **Started:** ${STAMP} (UTC), **lanes:** ${LANES}`,
    ...(stats ? [`- **Tests:** ${stats.expected} passed, ${stats.unexpected} failed, ${stats.flaky} flaky, ${stats.skipped} skipped`] : []),
    '- **Report:** playwright-report/index.html (`npx playwright show-report`), onboarding-reports/results.json, onboarding-reports/junit.xml', '',
    '| Stage | Result | Workers | Time |', '|---|---|---|---|',
    ...results.map((r) => `| ${r.id} | ${r.ok ? 'passed' : `**FAILED** (exit ${r.status})`} | ${r.workers} | ${fmt(r.ms)} |`),
    `| **Total** | | | **${fmt(results.reduce((a, r) => a + r.ms, 0))}** |`,
  ];
  fs.writeFileSync(path.join(LATEST, 'summary.md'), `${lines.join('\n')}\n`);
  // History copy of this invocation's report.
  for (const f of ['summary.md', 'results.json', 'junit.xml']) {
    if (fs.existsSync(path.join(LATEST, f))) fs.copyFileSync(path.join(LATEST, f), path.join(REPORT, f));
  }
  if (fs.existsSync(HTML)) fs.cpSync(HTML, path.join(REPORT, 'html'), { recursive: true });
  console.log(`\n${lines.join('\n')}\n\n=== report: playwright-report/index.html  (npx playwright show-report)\n=== results: onboarding-reports/results.json, junit.xml, summary.md`);
}

// One `playwright test` invocation, as a promise of its exit code (so the
// per-version smoke chains can run side by side).
function runInvocation(label, project, files, workers, env) {
  const cmd = ['playwright', 'test', `--project=${project}`, ...files, `--workers=${workers}`, '--reporter=list,blob'];
  console.log(`\n=== ${label}: npx ${cmd.join(' ')}${env.DRS_PROJECT_TAG ? `  (DRS_PROJECT_TAG=${env.DRS_PROJECT_TAG})` : ''}`);
  return new Promise((resolve) => {
    const child = spawn('npx', cmd, { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
    child.on('exit', (code) => resolve(code === null ? 1 : code));
  });
}

// SMOKEV (app owner, 2026-10-21): the smoke RFI / NC stages on EVERY other
// catalog version - one `smoke-drsv<nn>-*` chain per version (playwright.config.js
// builds them for the project named by DRS_PROJECT_TAG), each its own invocation
// with ONE worker (a chain's order is its FIFO queue), up to LANES chains at once:
// they have disjoint ground (SM<nn>-01..09) and Pulse allows several sessions of
// the same users.
async function runVersionChains(stage, i, tag) {
  process.env.DRS_PROJECT_TAG = tag;
  delete require.cache[require.resolve('../integration/drs-smoke-profile')];
  const chains = require('../integration/drs-smoke-profile').currentVersionSmokeChains();
  if (!chains.length) { console.log(`\n=== ${stage.id}: no per-version smoke areas on ${tag} - nothing to run`); return 0; }
  console.log(`\n=== ${stage.id}: ${chains.length} version chain(s), ${Math.min(LANES, chains.length)} at a time: ${chains.map((c) => `${c.chain} (${c.version})`).join(', ')}`);
  const codes = [];
  const runQueue = async (list, lanes) => {
    const queue = [...list];
    const lane = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        // The PM is shared by every version chain (one Work Location row), so the
        // version chains' NC flows leave it out (drs-smoke-profile.js).
        const env = { DRS_PROJECT_TAG: tag, SMOKE_NC_CREATORS: 'QI,EE,EL,QL', PLAYWRIGHT_BLOB_OUTPUT_FILE: path.join(BLOBS, `${String(i + 1).padStart(2, '0')}-${stage.id}-${c.chain}.zip`) };
        const code = await runInvocation(`${stage.id} ${c.chain} (${c.version})`, `smoke-${c.chain}-*`, [], 1, env);
        console.log(`\n=== ${stage.id} ${c.chain} (${c.version}): ${code === 0 ? 'passed' : `FAILED (exit ${code})`}`);
        codes.push(code);
      }
    };
    await Promise.all(Array.from({ length: Math.min(lanes, list.length) }, lane));
  };
  // Parallel chains first (LANES at once), then the `sequential` ones (draft
  // autosave: one RFI draft per user) strictly one at a time.
  await runQueue(chains.filter((c) => !c.sequential), LANES);
  await runQueue(chains.filter((c) => c.sequential), 1);
  return codes.find((c) => c !== 0) || 0;
}

(async () => {
  for (const [i, stage] of STAGES.slice(start).entries()) {
    const extraEnv = { PLAYWRIGHT_BLOB_OUTPUT_FILE: path.join(BLOBS, `${String(i + 1).padStart(2, '0')}-${stage.id}.zip`) };
    if (stage.needsProject) {
      const { run } = runProjectTag();
      if (!run || !run.projectTag) {
        console.error(`${stage.id}: no onboarding project recorded - run OB02 first`);
        writeReport(`stopped before ${stage.id}`);
        process.exit(1);
      }
      extraEnv.DRS_PROJECT_TAG = run.projectTag;
    }
    const workers = Math.min(stage.workers, LANES);
    const t0 = Date.now();
    const status = stage.versionChains
      ? await runVersionChains(stage, i, extraEnv.DRS_PROJECT_TAG)
      : await runInvocation(stage.id, stage.project, stage.files, workers, extraEnv);
    results.push({ id: stage.id, ok: status === 0, status, workers: stage.versionChains ? `${LANES} chains` : workers, ms: Date.now() - t0 });
    if (status !== 0) {
      console.error(`\n=== ${stage.id} FAILED (exit ${status}). Fix and resume with: node tests/utils/run-onboarding.js --from ${stage.id}`);
      writeReport(`FAILED at ${stage.id}`);
      process.exit(status || 1);
    }
  }

  // The whole run (DRS + Pulse) is complete: close it, so the next run starts R<n+1>.
  const { env, state, run } = runProjectTag();
  if (run) {
    state.mutateEnv(env, (e) => {
      e.onboarding.runs[run.run] = { ...e.onboarding.runs[run.run], done: true, doneAt: new Date().toISOString() };
    });
    console.log(`\n=== onboarding ${run.run} complete: project ${run.projectTag}`);
  }
  writeReport('passed', run);
})();
