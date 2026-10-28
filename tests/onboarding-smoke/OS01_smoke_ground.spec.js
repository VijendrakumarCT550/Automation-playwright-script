const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../drs/utils/drs-ui');
const state = require('../drs/utils/drs-state');
const { smokeAreaPlan, coverageAreaPlan } = require('../onboarding/onboarding-run');
const { importMissingAreas, pinAreas } = require('../onboarding/project-areas');

// ===========================================================================
// OS01 — THE SMOKE + COVERAGE GROUND ON THE LAST ONBOARDED PROJECT
// (onboarding-smoke suite, docs/drs-onboarding-suite.md §8). Into the project's
// Work Location, each area pinned to its catalog version:
//   SM01..SM13       the full smoke chain, on All sites v1 (once per project)
//   SM<nn>-01..09    the smoke RFI / NC stages on every other version (once)
//   CV<nn>-S<k>      THIS run's coverage area per version (every run: new codes'
//                    checkpoints / NCs never run out of Work Sections)
// Areas already there are left alone, so a resumed run skips straight to pinning.
// The runner (run-onboarding-smoke.js) gives DRS_PROJECT_TAG and ONBOARDING_RECORD.
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../drs-explore/onboarding-smoke');
const RUN = process.env.ONBOARDING_RECORD;
test.describe.configure({ mode: 'serial' });
let context, page, project, dump;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  expect(process.env.DRS_PROJECT_TAG, 'DRS_PROJECT_TAG must name the onboarded project - run through tests/utils/run-onboarding-smoke.js').toBeTruthy();
  expect(RUN, 'ONBOARDING_RECORD (the smoke run, S<n>) must be set - run through tests/utils/run-onboarding-smoke.js').toBeTruthy();
  project = state.targetProject(ENV.key);
  expect(project, `no project ${process.env.DRS_PROJECT_TAG} on ${ENV.key}`).toBeTruthy();
  expect(project.onboardingRun, `${project.name} is not an onboarded project`).toBeTruthy();
  for (const s of ['D6', 'D8', 'D9']) expect(project.stagesDone || [], `${project.name}: onboarding stage ${s} not done - finish its onboarding run first`).toContain(s);
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  dump = makeDumper(page, OUT, { screens: [] });
});

test.afterAll(async () => { if (context) await context.close(); });

const plan = () => [...smokeAreaPlan(project), ...coverageAreaPlan(project, RUN)];

test('OS01.1 smoke + coverage Work Areas imported', async () => {
  test.setTimeout(30 * 60 * 1000);
  const areas = plan();
  console.log(`  ${project.name}: ${areas.length} areas planned (${areas.filter((a) => a.kind === 'CV').map((a) => a.name).join(', ')} for ${RUN})`);
  project = await importMissingAreas({ page, ENV, project, areas, outDir: OUT });
  for (const a of areas) expect(project.workAreas, `${a.name} not recorded on the project`).toContain(a.name);
});

test('OS01.2 every one pinned to its version', async () => {
  test.setTimeout(30 * 60 * 1000);
  const pinned = await pinAreas({ page, ENV, project, names: plan().map((a) => a.name) });
  await dump('tree-after-pinning');
  project = state.upsertProject(ENV.key, project.tag, { pinned: { ...(project.pinned || {}), ...pinned } });
});
