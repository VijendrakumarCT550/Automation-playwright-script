const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DATA = require('../drs-data');
const { DrsProjectPage, buildLocationCsv, writeCsv } = require('../pages/DrsProjectPage');

// ===========================================================================
// D02 — PROJECT (D4) + WORK REGION TREE (D5). docs/drs-pulse-integration.md §3, §5.
//
// FRESH PER RUN, but RESUMABLE: a run first looks for the newest project in
// the state file that has not finished D5 and continues it, so a failure after
// the (permanent, undeletable) project create never leaves a second project.
//
// WRITES: one project; one Work Location → Work Areas → Work Sections import,
// under Rajasthan → AUTOMATION SITE (created by D01). Every name carries the
// run tag, because the import UPDATES nodes with the same (parent, name).
// Work Areas: BL01..BLnn + Culvert/Drain/Road, plus one Work Area per extra
// catalog version (drs-data.js versionAreas: VER-ALL-V2, VER-SITE-V1, VER-SITE-V2),
// each with its own Work Sections. DRS_VERSION_AREAS=0 leaves those out.
//
// Needs D01 first. Run:
//   npx playwright test --project=drs tests/drs/setup/D02_project_and_tree.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/stage-d02');
const WORK_AREAS = Number(process.env.DRS_WORK_AREAS || 2);
// ~300 Work Sections in EACH BL Work Area (app owner, 2026-09-26) — see buildLocationCsv.
const SECTIONS_PER_AREA = Number(process.env.DRS_SECTIONS_PER_AREA || 300);
const VERSION_AREAS = process.env.DRS_VERSION_AREAS === '0' ? [] : DATA.versionAreas;

test.describe.configure({ mode: 'serial' });

let context, page, projects, dump, run;
const summary = { screens: [] };

function newTag() {
  const d = new Date();
  const date = `${String(d.getDate()).padStart(2, '0')}${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear()}`;
  const letters = Array.from({ length: 3 }, () => String.fromCharCode(65 + Math.floor(Math.random() * 26))).join('');
  return `${date}-${letters}`;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const env = state.envRecord(ENV.key);
  for (const k of ['vendor', 'spv', 'cluster', 'site']) {
    expect(env[k], `DRS masters missing "${k}" on ${ENV.key} — run D01_masters first`).toBeTruthy();
  }
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  projects = new DrsProjectPage(page, ENV.baseUrl);
  dump = makeDumper(page, OUT, summary);

  run = state.incompleteProject(ENV.key, 'D5');
  if (run) console.log(`  resuming project ${run.name} (${run.tag}), done: [${run.stagesDone.join(', ')}]`);
});

test.afterAll(async () => {
  if (run) console.log(`\nD02 on ${ENV.key}: ${JSON.stringify(state.envRecord(ENV.key).projects.find((p) => p.tag === run.tag))}`);
  if (context) await context.close();
});

test('D4. create the project', async () => {
  test.setTimeout(5 * 60 * 1000);
  if (run && run.stagesDone.includes('D4')) {
    console.log(`  D4 already done: ${run.name} → ${run.id}`);
    return;
  }
  const tag = (run && run.tag) || newTag();
  const name = `AUTO-${DATA.project.type}-${tag}`;
  const env = state.envRecord(ENV.key);
  const res = await projects.createProject({ name, ...DATA.project, spv: env.spv });
  console.log(`  create project "${name}" → HTTP ${res.status}, id ${res.id}`);
  expect(res.status, `project create answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
  expect(res.id, 'no project id in the response or the landing URL').toBeTruthy();

  // Recorded before anything else can fail: the project is permanent.
  run = state.upsertProject(ENV.key, tag, {
    name, id: res.id, type: DATA.project.type, spv: env.spv,
    cluster: env.cluster, site: env.site, pairedPulse: ENV.pairedPulse,
  });
  run = state.markStageDone(ENV.key, tag, 'D4');
  await dump('after-project-create');
});

test('D5. import the work region tree into the project', async () => {
  // ~4k-row imports (13 BL × 300 sections): preview + commit can take minutes.
  test.setTimeout(20 * 60 * 1000);
  expect(run && run.id, 'D4 did not produce a project').toBeTruthy();
  if (run.stagesDone.includes('D5')) {
    console.log(`  D5 already done: ${run.workLocation}`);
    return;
  }
  const workLocation = `AUTO-WL-${run.tag}`;
  const csvPath = writeCsv(path.join(OUT, `locations-${run.tag}.csv`), buildLocationCsv({
    cluster: run.cluster, site: run.site, workLocation, workAreas: WORK_AREAS, sectionsPerArea: SECTIONS_PER_AREA,
    extraAreas: VERSION_AREAS,
  }));
  console.log(`  CSV: ${csvPath}`);

  await projects.gotoLocationStep(run.id);
  await projects.chooseClusterSite(run.cluster, run.site);
  await dump('location-step-site-chosen');

  const res = await projects.importCsv(csvPath);
  console.log(`  import commit → HTTP ${res.status} ${res.url}\n    ${res.body.slice(0, 400)}`);
  await dump('after-import-commit');
  expect(res.status, `import answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);

  // Proof on screen: the Work Location is in the project's tree.
  await projects.gotoLocationStep(run.id);
  const wl = projects.treeItem(workLocation, 1);
  await expect(wl, `"${workLocation}" not in the tree after import`).toBeVisible({ timeout: 30000 });
  const workAreas = [...Array(WORK_AREAS)].map((_, i) => `BL${String(i + 1).padStart(2, '0')}`)
    .concat(['Culvert-01', 'Drain-01', 'Road-01'])
    .concat(VERSION_AREAS.map((a) => a.name));
  run = state.upsertProject(ENV.key, run.tag, { workLocation, workAreas, sectionsPerArea: SECTIONS_PER_AREA, csv: path.basename(csvPath) });
  run = state.markStageDone(ENV.key, run.tag, 'D5');

  // For the version-pinning step (next): what does an IMPORTED, unpinned Work
  // Area's pane offer? Expand the Work Location and open BL01.
  await wl.click();
  if ((await wl.getAttribute('aria-expanded')) !== 'true') {
    await wl.locator('button, svg').first().click().catch(() => {});
  }
  await page.waitForTimeout(1500);
  await dump('tree-after-import');
  const bl01 = projects.treeItem('BL01', 2);
  if (await bl01.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    await bl01.click();
    await dump('imported-work-area-pane');
  }
});
