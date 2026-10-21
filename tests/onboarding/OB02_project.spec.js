const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../drs/utils/drs-ui');
const state = require('../drs/utils/drs-state');
const DATA = require('../drs/drs-data');
const { DrsProjectPage, buildLocationCsv, writeCsv } = require('../drs/pages/DrsProjectPage');
const DrsServiceOrderPage = require('../drs/pages/DrsServiceOrderPage');
const { currentRun, putRun, areaPlan, SECTION_PLAN } = require('./onboarding-run');

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
  for (const k of ['A1', 'S1', 'A2', 'S2']) expect(run.rounds[k], `${run.run}: round ${k} not locked yet - run OB01`).toBeTruthy();
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
  const areas = areaPlan(run);
  // A project imported before an area kind was added (Culvert<nn>, 2026-10-19)
  // gets only its MISSING areas imported, into the same Work Location.
  const have = project.workAreas || [];
  const toImport = areas.filter((a) => !have.includes(a.name));
  if (!toImport.length) { console.log(`  tree already imported: ${have.length} areas`); return; }
  if (have.length) console.log(`  adding ${toImport.map((a) => a.name).join(', ')} to ${project.workLocation}`);
  const workLocation = project.workLocation || `AUTO-WL-${project.tag}`;
  // BATCHES (2026-10-21): the location import takes at most 10,000 rows per file
  // (DRS: "too_big", maximum 10000), and a full run's plan is ~18,000 sections, so
  // the areas go in files of <= 9,000 rows, every area whole in one file. Each
  // batch is recorded the moment DRS accepts it, so a stop part-way resumes with
  // the areas still missing.
  const MAX_ROWS = 9000;
  const rowsOf = (a) => Object.values(a.plan || {}).reduce((n, x) => n + x, 0);
  const batches = [];
  for (const a of toImport) {
    const last = batches[batches.length - 1];
    if (last && last.rows + rowsOf(a) <= MAX_ROWS) { last.areas.push(a); last.rows += rowsOf(a); } else batches.push({ areas: [a], rows: rowsOf(a) });
  }
  const projects = new DrsProjectPage(page, ENV.baseUrl);
  const stamp = Date.now();
  for (const [b, batch] of batches.entries()) {
    const csvPath = writeCsv(path.join(OUT, `locations-${project.tag}-${stamp}-${b + 1}.csv`), buildLocationCsv({
      cluster: project.cluster, site: project.site, workLocation, workAreas: 0, linearAreas: false,
      extraAreas: batch.areas.map((a) => ({ name: a.name, plan: a.plan })),
    }));
    await projects.gotoLocationStep(project.id);
    await projects.chooseClusterSite(project.cluster, project.site);
    const res = await projects.importCsv(csvPath);
    console.log(`  import ${b + 1}/${batches.length} (${batch.areas.length} areas, ${batch.rows} sections) → HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    expect(res.status, `import ${b + 1} answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    const names = batch.areas.map((a) => a.name);
    project = state.mutateProject(ENV.key, project.tag, (p) => {
      p.workLocation = workLocation;
      p.workAreas = [...new Set([...(p.workAreas || []), ...names])];
      p.areaVersions = { ...(p.areaVersions || {}), ...Object.fromEntries(batch.areas.map((a) => [a.name, a.version])) };
      p.sectionPlan = SECTION_PLAN;
      p.csv = path.basename(csvPath);
    });
  }
  await projects.gotoLocationStep(project.id);
  await expect(projects.treeItem(workLocation, 1), `${workLocation} not in the tree`).toBeVisible({ timeout: 30000 });
  project = state.markStageDone(ENV.key, project.tag, 'D5');
});

test('P3. pin every Work Area to its version', async () => {
  test.setTimeout(20 * 60 * 1000);
  const projects = new DrsProjectPage(page, ENV.baseUrl);
  await projects.gotoLocationStep(project.id);
  const wl = projects.treeItem(project.workLocation, 1);
  await wl.waitFor({ state: 'visible', timeout: 30000 });
  if ((await wl.getAttribute('aria-expanded')) !== 'true') { await wl.click(); await page.waitForTimeout(1500); }
  for (const [wa, version] of Object.entries(project.areaVersions)) {
    const current = await projects.workAreaVersionBadge(wa, { label: true });
    if (current === version) { console.log(`  ${wa}: already ${version}`); continue; }
    expect(current, `${wa} is pinned to "${current}", planned "${version}" - not changing a pin`).toBe('');
    const res = await projects.pinWorkAreaVersion(project.workLocation, wa, version.match(/v\d+$/)[0], version);
    console.log(`  ${wa} -> ${version}: ${res.method} HTTP ${res.status}`);
    expect(res.status, `${wa}: pin answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    await projects.collapseWorkArea(wa);
  }
  await projects.gotoLocationStep(project.id);
  const wl2 = projects.treeItem(project.workLocation, 1);
  await wl2.waitFor({ state: 'visible', timeout: 30000 });
  if ((await wl2.getAttribute('aria-expanded')) !== 'true') { await wl2.click(); await page.waitForTimeout(1500); }
  const pinned = {};
  for (const [wa, version] of Object.entries(project.areaVersions)) {
    pinned[wa] = await projects.workAreaVersionBadge(wa, { label: true });
    expect(pinned[wa], `${wa}: badge "${pinned[wa]}" after pinning ${version}`).toBe(version);
  }
  await dump('tree-after-pinning');
  project = state.upsertProject(ENV.key, project.tag, { pinned });
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
