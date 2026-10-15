const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DATA = require('../drs-data');
const { DrsProjectPage, buildLocationCsv, writeCsv } = require('../pages/DrsProjectPage');
const DrsServiceOrderPage = require('../pages/DrsServiceOrderPage');

// ===========================================================================
// E01 — BRING A CATALOG VERSION ONTO AN EXISTING PROJECT (app owner, 2026-10-15).
// docs/drs-catalog-versions-and-so-lines.md §2.5.
//
// No new project is needed for a new catalog version: a version is offered to a
// Work Area by PROJECT TYPE (every version) and, for a SITE version, by the Work
// Area's SITE - so any Work Area with no records can take it. This stage:
//   1. imports ONE new Work Area "BL<nn> S-v<n>" (60 Work Sections) under the
//      project's existing Work Location (the import upserts by name, so nothing
//      else changes);
//   2. pins it to the version;
//   3. adds the version's SO lines to the project's EXISTING SOs (Edit → Add Line,
//      numbered after the existing lines; same plan rules as D04: service-code
//      groups + our own sub-activities 2 per line), and records them.
// Then D05 and D06, re-run on the project (DRS_PROJECT_TAG), map the new area's
// SO Configuration cells and the new lines - both are idempotent, so only the new
// version's work is done.
//
// Which version: CATALOG_VERSION_LABEL, else the newest LOCKED site version.
// Idempotent: an area already pinned to the version is reused; lines already
// recorded for it are not added again.
//
// Run:  $env:DRS_PROJECT_TAG="15102026-RHY"
//       npx playwright test --project=drs tests/drs/extend/E01_add_version_area.spec.js --workers=1
//       npx playwright test --project=drs tests/drs/setup/D05_so_configuration.spec.js tests/drs/setup/D06_so_line_mapping.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/stage-e01');
const SECTIONS = 60;

test.describe.configure({ mode: 'serial' });
let context, page, dump, run, version, area;

function newestSiteVersion() {
  const chain = ((state.envRecord(ENV.key).catalogs || {})[DATA.site]) || {};
  const locked = Object.values(chain).filter((c) => c.status === 'locked')
    .sort((a, b) => Number(a.label.match(/v(\d+)$/)[1]) - Number(b.label.match(/v(\d+)$/)[1]));
  return locked.length ? locked[locked.length - 1].label : null;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  expect(process.env.DRS_PROJECT_TAG, 'set DRS_PROJECT_TAG to the EXISTING project to extend').toBeTruthy();
  run = state.targetProject(ENV.key, 'D9');
  expect(run, `no project ${process.env.DRS_PROJECT_TAG} on ${ENV.key}`).toBeTruthy();
  expect(run.stagesDone, `${run.name}: finish its setup chain first (D9)`).toContain('D9');
  version = process.env.CATALOG_VERSION_LABEL || newestSiteVersion();
  expect(version, 'no locked site catalog version recorded - run catalog_site_versions.spec.js').toBeTruthy();
  const n = Number(version.match(/ v(\d+)$/)[1]);
  const isSite = version.startsWith(`${DATA.site} v`);
  const tag = `${isSite ? 'S' : 'AS'}-v${n}`;
  const existing = run.workAreas.find((wa) => DATA.versionFor(wa) === version && DATA.isVersionArea(wa));
  const lastBl = Math.max(...run.workAreas.map((wa) => Number((wa.match(/^BL(\d+)/) || [])[1] || 0)));
  area = existing || `BL${String(lastBl + 1).padStart(2, '0')} ${tag}`;
  console.log(`  project ${run.name}: version "${version}" -> Work Area "${area}"${existing ? ' (already there)' : ' (new)'}`);
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  dump = makeDumper(page, OUT, { screens: [] });
});

test.afterAll(async () => { if (context) await context.close(); });

test('E1. import the new Work Area under the existing Work Location', async () => {
  test.setTimeout(10 * 60 * 1000);
  if (run.workAreas.includes(area)) {
    console.log(`  ${area} already in the project`);
    return;
  }
  const projects = new DrsProjectPage(page, ENV.baseUrl);
  // Only the new area's rows: the importer creates the area under the existing
  // Work Location (upsert by parent + name), touching nothing else.
  const csvPath = writeCsv(path.join(OUT, `extend-${run.tag}-${area.replace(/\W+/g, '-')}.csv`), buildLocationCsv({
    cluster: run.cluster, site: run.site, workLocation: run.workLocation, workAreas: 0, extraAreas: [{ name: area, sections: SECTIONS }],
  }).split('\n').filter((l) => !/,(Culvert|Drain|Road)-01,/.test(l)).join('\n'));
  await projects.gotoLocationStep(run.id);
  await projects.chooseClusterSite(run.cluster, run.site);
  const res = await projects.importCsv(csvPath);
  console.log(`  import → HTTP ${res.status}: ${res.body.slice(0, 200)}`);
  expect(res.status, `import answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
  await projects.gotoLocationStep(run.id);
  const wl = projects.treeItem(run.workLocation, 1);
  await wl.waitFor({ state: 'visible', timeout: 30000 });
  if ((await wl.getAttribute('aria-expanded')) !== 'true') { await wl.click(); await page.waitForTimeout(1500); }
  await expect(projects.treeItem(area, 2), `${area} not in the tree after import`).toBeVisible({ timeout: 30000 });
  run = state.upsertProject(ENV.key, run.tag, { workAreas: [...run.workAreas, area] });
  await dump('tree-after-import');
});

test('E2. pin the new Work Area to the version', async () => {
  test.setTimeout(10 * 60 * 1000);
  const projects = new DrsProjectPage(page, ENV.baseUrl);
  await projects.gotoLocationStep(run.id);
  const wl = projects.treeItem(run.workLocation, 1);
  await wl.waitFor({ state: 'visible', timeout: 30000 });
  if ((await wl.getAttribute('aria-expanded')) !== 'true') { await wl.click(); await page.waitForTimeout(1500); }
  const current = await projects.workAreaVersionBadge(area, { label: true });
  if (current !== version) {
    expect(current, `${area} is already pinned to "${current}" - not changing a pin`).toBe('');
    const res = await projects.pinWorkAreaVersion(run.workLocation, area, version.match(/v\d+$/)[0], version);
    console.log(`  pin ${area} -> ${version}: ${res.method} HTTP ${res.status}`);
    expect(res.status, `pin answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    await projects.gotoLocationStep(run.id);
    const wl2 = projects.treeItem(run.workLocation, 1);
    await wl2.waitFor({ state: 'visible', timeout: 30000 });
    if ((await wl2.getAttribute('aria-expanded')) !== 'true') { await wl2.click(); await page.waitForTimeout(1500); }
  }
  const badge = await projects.workAreaVersionBadge(area, { label: true });
  expect(badge, `${area}: badge reads "${badge}" after pinning ${version}`).toBe(version);
  run = state.upsertProject(ENV.key, run.tag, { pinned: { ...(run.pinned || {}), [area]: badge } });
  console.log(`  ${area}: pinned to ${badge}`);
});

test('E3. add the version\'s lines to the existing SOs', async () => {
  test.setTimeout(15 * 60 * 1000);
  const env = state.envRecord(ENV.key);
  const plan = DATA.soPlan(env, [area]); // this version only, numbered from 10
  const sos = { ...(run.serviceOrders || {}) };
  const sop = new DrsServiceOrderPage(page, ENV.baseUrl);
  for (const [pkg, planned] of Object.entries(plan)) {
    const so = sos[pkg];
    expect(so, `${run.name} has no ${pkg} SO - run D04 first`).toBeTruthy();
    if (so.lines.some((l) => l.version === version)) {
      console.log(`  ${pkg} SO ${so.number}: lines for ${version} already recorded`);
      continue;
    }
    // Numbered after the SO's existing lines (10, 20 ... -> 210, 220 ...).
    const last = Math.max(...so.lines.map((l) => l.lineNumber));
    const lines = planned.map((l, i) => ({ ...l, lineNumber: last + (i + 1) * 10, serviceItemNo: last + (i + 1) * 10 }));
    console.log(`  ${pkg} SO ${so.number}: adding ${lines.length} line(s) ${lines[0].lineNumber}..${lines[lines.length - 1].lineNumber} for ${version}`);
    for (const l of lines) console.log(`    ${l.lineNumber}-${l.serviceItemNo}  ${l.subActivities.join(' + ')}`);
    await sop.gotoList(run.id);
    const res = await sop.addLines(so.number, lines);
    console.log(`  save → ${res.method} HTTP ${res.status} ${res.url}`);
    expect(res.status, `${pkg} SO edit answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    sos[pkg] = { ...so, lines: [...so.lines, ...lines] };
    run = state.upsertProject(ENV.key, run.tag, { serviceOrders: sos, ...(pkg === 'Civil' ? { serviceOrder: sos.Civil } : {}) });
    await sop.gotoList(run.id);
    await dump(`so-list-after-${pkg.toLowerCase()}`);
  }
});
