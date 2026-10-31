#!/usr/bin/env node
// THE ONBOARDING SUITE RUNNER (docs/drs-onboarding-suite.md).
//
//   npm run onboarding:uat          the whole suite, in order (~1.9 h)
//   node tests/utils/run-onboarding.js --from OB02   resume from a stage
//   node tests/utils/run-onboarding.js --only OB04,OB05   just those stages
//   node tests/utils/run-onboarding.js --list        print the stages only
//   node tests/utils/run-onboarding.js --run R1 --from IN01   stages on a given (even closed) run
//   ONBOARDING_LANES=1 npm run onboarding:uat        no parallel workers at all
//
// Stages, each its own Playwright invocation (they are different projects, and a
// failed stage must stop the chain - every later stage depends on it):
//   D01   DRS masters (vendors, SPV, site)                       project `drs`
//   OB01  the run's catalog versions: roots + A1 / S1 / A2 / S2   project `onboarding`
//   OB02  fresh project, WA / Road / Drain / Culvert, pins, 2 SOs project `onboarding`
//   D05   SO Configuration on that project (all versions)         project `drs`
//   D06   SO Line Mapping on that project                         project `drs`
//   IN01  Pulse users of the project (CI, CIE, EE, QI, PM, EL, QL) project `integration`
//   OB03  Pulse WAM: Civil on every area, Electrical on WA<nn>    project `onboarding`
//   OB04  Pulse RFIs on every area + the dependency plans         project `onboarding`
//   OB05  Pulse NC cycle on every area                            project `onboarding`
// The DEPTH - every checkpoint of every new code, our checklists' questions, an NC
// per sub-activity - and the smoke flows on every catalog version run in the
// SEPARATE suite tests/onboarding-smoke (run-onboarding-smoke.js) on the last
// onboarded project (app owner, 2026-10-21: one run must stay ~1.9 h).
// Stages from D05 on get DRS_PROJECT_TAG = the run's project (read from the state
// file after OB02). URLs come from DRS_ENV / PULSE_ENV (tests/config).

const { defaultPulseEnv, selectStages, createReport, runStages } = require('./stage-runner');

const STAGES = [
  { id: 'D01', project: 'drs', files: ['tests/drs/setup/D01_masters.spec.js'], workers: 1 },
  { id: 'OB01', project: 'onboarding', files: ['tests/onboarding/OB01_catalogs.spec.js'], workers: 2 },
  { id: 'OB02', project: 'onboarding', files: ['tests/onboarding/OB02_project.spec.js'], workers: 1 },
  { id: 'D05', project: 'drs', files: ['tests/drs/setup/D05_so_configuration.spec.js'], needsProject: true, workers: 3 },
  { id: 'D06', project: 'drs', files: ['tests/drs/setup/D06_so_line_mapping.spec.js'], needsProject: true, workers: 2 },
  { id: 'IN01', project: 'integration', files: ['tests/integration/IN01_users.spec.js'], needsProject: true, workers: 1 },
  { id: 'OB03', project: 'onboarding', files: ['tests/onboarding/OB03_pulse_wam.spec.js'], needsProject: true, workers: 1 },
  { id: 'OB04', project: 'onboarding', files: ['tests/onboarding/OB04_pulse_rfi.spec.js'], needsProject: true, workers: 3, env: { ONBOARDING_PLAN: 'onboarding' } },
  { id: 'OB05', project: 'onboarding', files: ['tests/onboarding/OB05_pulse_nc.spec.js'], needsProject: true, workers: 3, env: { ONBOARDING_PLAN: 'onboarding' } },
];

defaultPulseEnv();
const argv = process.argv.slice(2);
const runIdx = argv.indexOf('--run');
const RUN_ID = runIdx >= 0 ? argv[runIdx + 1] : null;
// ONBOARDING_VERSIONS (onboarding-run.js fixedVersions): the versions exist already,
// so OB01 builds nothing and is left out.
const stages = process.env.ONBOARDING_VERSIONS ? STAGES.filter((s) => s.id !== 'OB01') : STAGES;
const { picked, resumeHint } = selectStages(stages, argv, 'run-onboarding.js');

function runProjectTag() {
  delete require.cache[require.resolve('../drs/utils/drs-state')];
  const state = require('../drs/utils/drs-state');
  const env = String(process.env.DRS_ENV || 'uat').toLowerCase();
  const ob = state.envRecord(env).onboarding || { runs: {} };
  // --run R<n> targets that run even when it is closed; otherwise the open run.
  const open = RUN_ID ? (ob.runs || {})[RUN_ID] || null : Object.values(ob.runs || {}).find((r) => !r.done) || null;
  return { env, state, run: open };
}

const report = createReport('onboarding-reports');
const writeReport = (status, known) => {
  const run = known || runProjectTag().run;
  report.write(`Onboarding run ${run ? run.run : '?'} - ${status}`, [`- **Project:** ${(run && run.projectTag) || '(not created)'}`]);
};

(async () => {
  await runStages({
    picked, report, resumeHint,
    projectTag: () => (runProjectTag().run || {}).projectTag,
    onFail: (status) => writeReport(status),
  });
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
