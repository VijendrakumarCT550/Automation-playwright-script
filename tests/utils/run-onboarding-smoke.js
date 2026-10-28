#!/usr/bin/env node
// THE ONBOARDING SMOKE RUNNER (docs/drs-onboarding-suite.md §8): the depth on the
// LAST ONBOARDED PROJECT, separate from the ~1.9 h onboarding run (app owner,
// 2026-10-21) - re-runnable after every deployment without onboarding again.
//
//   npm run onboarding-smoke:uat                         a fresh run S<n+1>
//   node tests/utils/run-onboarding-smoke.js --from OB05 resume the open run there
//   node tests/utils/run-onboarding-smoke.js --only SMOKEV
//   node tests/utils/run-onboarding-smoke.js --project 21102026-OB6   another onboarded project
//   node tests/utils/run-onboarding-smoke.js --list
//
// Stages (each its own Playwright invocation; a failure stops the chain):
//   OS01   smoke + coverage areas imported and pinned (SM.., SM<nn>-.., CV<nn>-S<k>) `onboarding-smoke`
//   D05    SO Configuration, so the new areas carry the project's SOs   `drs`
//   OB03   Pulse WAM (CI / CIE / EE / QI) on this run's CV areas        `onboarding`
//   OB04   every checkpoint of every new code + our checklists' questions, on CV<nn>-S<k>
//   OB05   one NC per sub-activity of every new code, on CV<nn>-S<k>
//   SMOKE  the smoke folder (SM01-SM29) unchanged on SM01..SM13          `smoke-drs-*`
//   SMOKEV smoke RFI / NC stages on every other catalog version          `smoke-drsv<nn>-*`
// A fresh run records its id (S1, S2 ...) under env.onboardingSmoke, keeps its
// RFI / NC results apart (ONBOARDING_RECORD) and starts the smoke trackers over
// (SMOKE_RESET=1); --from / --only resume the open run and its trackers.

const { defaultPulseEnv, selectStages, createReport, runStages } = require('./stage-runner');

const STAGES = [
  { id: 'OS01', project: 'onboarding-smoke', files: ['tests/onboarding-smoke/OS01_smoke_ground.spec.js'], needsProject: true, workers: 1 },
  { id: 'D05', project: 'drs', files: ['tests/drs/setup/D05_so_configuration.spec.js'], needsProject: true, workers: 3 },
  { id: 'OB03', project: 'onboarding', files: ['tests/onboarding/OB03_pulse_wam.spec.js'], needsProject: true, workers: 1, coverage: true },
  { id: 'OB04', project: 'onboarding', files: ['tests/onboarding/OB04_pulse_rfi.spec.js'], needsProject: true, workers: 3, coverage: true },
  { id: 'OB05', project: 'onboarding', files: ['tests/onboarding/OB05_pulse_nc.spec.js'], needsProject: true, workers: 3, coverage: true },
  { id: 'SMOKE', project: 'smoke-drs-*', files: [], needsProject: true, workers: 1, smoke: true },
  { id: 'SMOKEV', project: 'smoke-drsv<nn>-*', files: [], versionChains: true, needsProject: true, workers: 1, smoke: true },
];

defaultPulseEnv();
const argv = process.argv.slice(2);
const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
const { picked, from, only, resumeHint } = selectStages(STAGES, argv, 'run-onboarding-smoke.js');
const FRESH = !from && !only;

const state = require('../drs/utils/drs-state');
const { smokeRun, closeSmokeRun } = require('../onboarding/onboarding-run');
const ENV_KEY = String(process.env.DRS_ENV || 'uat').toLowerCase();

// The project: --project / ONBOARDING_PROJECT_TAG, else the open smoke run's (a
// resume), else the project of the last COMPLETED onboarding run.
function targetTag() {
  const named = arg('--project') || process.env.ONBOARDING_PROJECT_TAG;
  if (named) return named;
  const env = state.envRecord(ENV_KEY);
  const open = Object.values((env.onboardingSmoke || {}).runs || {}).find((r) => !r.done);
  if (open && !FRESH) return open.projectTag;
  const done = Object.values((env.onboarding || {}).runs || {}).filter((r) => r.done && r.projectTag).sort((a, b) => b.n - a.n);
  return done.length ? done[0].projectTag : null;
}

const TAG = targetTag();
if (!TAG) { console.error('no completed onboarding run to smoke - run npm run onboarding:uat first, or pass --project <tag>'); process.exit(2); }
const project = (state.envRecord(ENV_KEY).projects || []).find((p) => p.tag === TAG);
if (!project || !project.onboardingRun) { console.error(`${TAG} is not an onboarded project on ${ENV_KEY}`); process.exit(2); }
const RUN = smokeRun(ENV_KEY, TAG, { fresh: FRESH });
console.log(`\n=== onboarding-smoke ${RUN.run}${FRESH ? ' (fresh)' : ' (resumed)'} on ${project.name} (onboarding ${project.onboardingRun})`);

const report = createReport('onboarding-smoke-reports');
const writeReport = (status) => report.write(`Onboarding smoke ${RUN.run} - ${status}`, [
  `- **Project:** ${project.name} (${TAG}, onboarding run ${project.onboardingRun})`,
  `- **Coverage areas:** CV<nn>-${RUN.run}`,
]);

const stageEnv = (stage) => ({
  ONBOARDING_RECORD: RUN.run,
  ...(stage.coverage ? { ONBOARDING_PLAN: 'coverage' } : {}),
  ...(stage.id === 'OB03' ? { ONBOARDING_WAM_AREAS: `^CV\\d{2}-${RUN.run}$` } : {}),
  ...(stage.smoke && FRESH ? { SMOKE_RESET: '1' } : {}),
});

(async () => {
  await runStages({ picked, report, resumeHint, projectTag: () => TAG, stageEnv, onFail: (status) => writeReport(status) });
  // Closed once its LAST stage has passed (an --only of earlier stages leaves it open).
  if (picked.includes(STAGES[STAGES.length - 1])) {
    closeSmokeRun(ENV_KEY, RUN.run);
    console.log(`\n=== onboarding-smoke ${RUN.run} complete on ${project.name}`);
  }
  writeReport('passed');
})();
