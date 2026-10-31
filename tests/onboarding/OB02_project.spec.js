const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../drs/utils/drs-ui');
const state = require('../drs/utils/drs-state');
const DATA = require('../drs/drs-data');
const { DrsProjectPage } = require('../drs/pages/DrsProjectPage');
const DrsServiceOrderPage = require('../drs/pages/DrsServiceOrderPage');
const { currentRun, putRun, areaPlan } = require('./onboarding-run');
const { importMissingAreas, pinAreas } = require('./project-areas');

// ===========================================================================
// OB02 — THE RUN'S PROJECT (onboarding suite; docs/drs-onboarding-suite.md).
//   P1  a fresh Solar project (permanent; recorded the moment it exists)
//   P2  one Work Location; per version WA<nn> (60 TABLE Rxx-Tyy, 25 INVERTER Ixx,
//       10 CABLE "0-100m"...), Road<nn> (10 ROAD) and Drain<nn> (10 DRAIN)
//       (18 areas; 15 when the site has no v1)
//   P3  WA<n> / Road<n> / Drain<n> pinned to the run's n-th version (roots, A1, S1, A2, S2)
//   P4  the Civil SO + the Electrical SO, lines planned per version (drs-data soPlan)
// SO Configuration and SO Line Mapping follow as D05 / D06 on this project
// (scripts: npm run onboarding:uat). The project carries `areaVersions`, which
// drs-data.bindProject gives those stages.
// Needs OB01 (all rounds locked) and DRS masters (D01).
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../drs-explore/onboarding');
test.describe.configure({ mode: 'serial' });
let context, page, run, project, dump;

function tagFor(r) {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}-OB${r.n}`;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  run = currentRun(ENV.key);
  if (!run.versions) for (const k of ['A1', 'S1', 'A2', 'S2']) expect(run.rounds[k], `${run.run}: round ${k} not locked yet - run OB01`).toBeTruthy();
  else console.log(`  ${run.run}: fixed versions ${JSON.stringify(run.versions)} (no OB01)`);
  const env = state.envRecord(ENV.key);
  for (const k of ['vendor', 'vendorElectrical', 'spv', 'cluster', 'site']) expect(env[k], `DRS masters missing "${k}" - run D01`).toBeTruthy();
  project = run.projectTag ? env.projects.find((p) => p.tag === run.projectTag) : null;
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  dump = makeDumper(page, OUT, { screens: [] });
});

test.afterAll(async () => { if (context) await context.close(); });

test('P1. a fresh project', async () => {
  test.setTimeout(5 * 60 * 1000);
  if (project) { console.log(`  project already made: ${project.name}`); return; }
  const env = state.envRecord(ENV.key);
  const tag = tagFor(run);
  const name = `AUTO-${DATA.project.type}-${tag}`;
  const res = await new DrsProjectPage(page, ENV.baseUrl).createProject({ name, ...DATA.project, spv: env.spv });
  console.log(`  create project "${name}" → HTTP ${res.status}, id ${res.id}`);
  expect(res.status, `project create answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
  const areas = areaPlan(run);
  project = state.upsertProject(ENV.key, tag, {
    name, id: res.id, type: DATA.project.type, spv: env.spv, cluster: env.cluster, site: env.site,
    pairedPulse: ENV.pairedPulse, onboardingRun: run.run,
    areaVersions: Object.fromEntries(areas.map((a) => [a.name, a.version])),
  });
  project = state.markStageDone(ENV.key, tag, 'D4');
  run = putRun(ENV.key, run.run, { projectTag: tag });
});

test('P2. Work Location + WA01.. with their Work Sections', async () => {
  test.setTimeout(20 * 60 * 1000);
  // A project imported before an area kind was added (Culvert<nn>, 2026-10-19)
  // gets only its MISSING areas imported, into the same Work Location; batched
  // under DRS's 10,000-row import limit (project-areas.js).
  project = await importMissingAreas({ page, ENV, project, areas: areaPlan(run), outDir: OUT });
  project = state.markStageDone(ENV.key, project.tag, 'D5');
});

test('P3. pin every Work Area to its version', async () => {
  test.setTimeout(20 * 60 * 1000);
  // The run's areas only: smoke areas a later onboarding-smoke run added to this
  // project are pinned by OS01.
  const names = areaPlan(run).map((a) => a.name);
  const pinned = await pinAreas({ page, ENV, project, names });
  await dump('tree-after-pinning');
  project = state.upsertProject(ENV.key, project.tag, { pinned: { ...(project.pinned || {}), ...pinned } });
  project = state.markStageDone(ENV.key, project.tag, 'D6');
});

test('P4. the Civil and Electrical SOs, lines planned per version', async () => {
  test.setTimeout(20 * 60 * 1000);
  DATA.bindProject(project);
  const env = state.envRecord(ENV.key);
  const plan = DATA.soPlan(env, project.workAreas);
  const vendorFor = { Civil: env.vendor, Electrical: env.vendorElectrical };
  const recorded = { ...(project.serviceOrders || {}) };
  const so = new DrsServiceOrderPage(page, ENV.baseUrl);
  for (const [pkg, lines] of Object.entries(plan)) {
    await so.gotoList(project.id);
    if (recorded[pkg] && await so.soListed(recorded[pkg].number)) { console.log(`  ${pkg} SO already exists: ${recorded[pkg].number}`); continue; }
    const vendor = vendorFor[pkg];
    const number = `99${String(Date.now() + DATA.SO_PACKAGES.indexOf(pkg)).slice(-8)}`;
    console.log(`  ${pkg}: ${lines.length} line(s) for ${vendor.code} — ${vendor.name}`);
    const res = await so.createServiceOrder({ number, vendorCode: vendor.code, vendorName: vendor.name, lines });
    console.log(`  create ${pkg} SO ${number} → HTTP ${res.status}`);
    expect(res.status, `${pkg} SO create answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    recorded[pkg] = { number, package: pkg, vendorCode: vendor.code, vendorName: vendor.name, vendorText: res.vendorText, vendorHeaderSet: true, lines };
    project = state.upsertProject(ENV.key, project.tag, { serviceOrders: recorded, ...(pkg === 'Civil' ? { serviceOrder: recorded.Civil } : {}) });
    await so.gotoList(project.id);
    expect(await so.soListed(number), `${pkg} SO ${number} not listed after a ${res.status}`).toBe(true);
  }
  project = state.markStageDone(ENV.key, project.tag, 'D7');
});
