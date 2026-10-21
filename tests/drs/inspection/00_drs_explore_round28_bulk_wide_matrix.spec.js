const { test } = require('@playwright/test');
const { drsEnv, installWriteGuard, loginSuperAdmin } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DrsSoConfigPage = require('../pages/DrsSoConfigPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 28. READ-ONLY, ENFORCED (write guard; Save never clicked).
// SO Configuration bulk edit on a WIDE matrix (All sites v1 with 17 Work Area
// columns, R6): the same 13 of 91 cell checkboxes never tick, however often they
// are clicked. Which cells are they, where are they on screen, what is on top of
// them, and does a DOM click tick them?
// Run: REF_TAG=21102026-OB6 npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round28_bulk_wide_matrix.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();

test('wide bulk matrix: which cells refuse to tick', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const run = state.envRecord(ENV.key).projects.find((p) => p.tag === (process.env.REF_TAG || '21102026-OB6'));
  const version = 'All sites v1';
  const areas = Object.entries(run.areaVersions).filter(([, v]) => v === version).map(([a]) => a);
  const blocked = [];
  const context = await browser.newContext({ viewport: { width: 1900, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const soc = new DrsSoConfigPage(page, ENV.baseUrl);
  await soc.open(run.id, { workLocation: run.workLocation, version, workAreas: areas, pkg: 'Civil' });
  await soc.bulkMode();
  const m = await soc.readMatrix(run.workAreas);
  console.log(`PROBE columns (${m.columns.length}): ${m.columns.join(', ')}`);
  console.log(`PROBE rows: ${m.rows.length}; cells per row: ${[...new Set(m.rows.map((r) => r.cells.length))].join('/')}`);
  // The cells D05 wants on a fresh matrix: every SM column, the planned WA activities.
  const smCols = m.columns.filter((c) => /^SM\d+$/.test(c));
  const boxes = [];
  for (const r of m.rows) for (const c of smCols) { const cell = r.cells[m.columns.indexOf(c)]; if (!cell.value) boxes.push({ box: cell.box, row: r.activity, col: c }); }
  console.log(`PROBE ticking ${boxes.length} empty SM cells`);
  const all = page.locator('input[type="checkbox"], [role="checkbox"]');
  for (const b of boxes) { await all.nth(b.box).click({ force: true }); await page.waitForTimeout(40); }
  await page.waitForTimeout(800);
  const info = await all.evaluateAll((els, list) => list.map((b) => {
    const el = els[b.box];
    const r = el.getBoundingClientRect();
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return { ...b, checked: el.checked, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      onTop: top === el ? 'itself' : top ? `${top.tagName}.${(top.className || '').toString().slice(0, 40)}` : 'nothing' };
  }), boxes);
  const missed = info.filter((x) => !x.checked);
  console.log(`PROBE after pointer clicks: ${await soc.selectedCount()} selected, ${missed.length} unchecked`);
  console.log(`PROBE unchecked: ${JSON.stringify(missed.slice(0, 15))}`);
  await all.evaluateAll((els, idx) => { for (const i of idx) if (els[i]) els[i].click(); }, missed.map((x) => x.box));
  await page.waitForTimeout(800);
  const still = await all.evaluateAll((els, idx) => idx.filter((i) => !els[i].checked), missed.map((x) => x.box));
  console.log(`PROBE after DOM clicks: ${await soc.selectedCount()} selected, ${still.length} still unchecked`);
  console.log('PROBE blocked writes: ' + JSON.stringify(blocked));
  await context.close();
});
