const { test } = require('@playwright/test');
const { drsEnv, installWriteGuard, loginSuperAdmin } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DrsSoConfigPage = require('../pages/DrsSoConfigPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 29. READ-ONLY, ENFORCED.
// SO Configuration, All sites v1 / Civil on R6 (17 columns): bulk readMatrix said
// "0 to set" right after a probe counted 156 empty SM cells. Ground truth: the
// SINGLE-edit cell values (comboboxes) of a few SM cells, next to the bulk read.
// Run: REF_TAG=21102026-OB6 npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round29_cell_truth.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();

test('SO Configuration cell truth: single edit vs bulk read', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const run = state.envRecord(ENV.key).projects.find((p) => p.tag === (process.env.REF_TAG || '21102026-OB6'));
  const version = 'All sites v1';
  const areas = Object.entries(run.areaVersions).filter(([, v]) => v === version).map(([a]) => a);
  const context = await browser.newContext({ viewport: { width: 1900, height: 1100 } });
  await installWriteGuard(context, ENV, []);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const soc = new DrsSoConfigPage(page, ENV.baseUrl);
  await soc.open(run.id, { workLocation: run.workLocation, version, workAreas: areas, pkg: 'Civil' });
  const cols = await soc.columns(run.workAreas);
  const acts = ['Piling - MMS', 'MMS Installation', 'Robot Structure Installation'];
  for (const a of acts) {
    const vals = [];
    for (const c of ['SM01', 'SM07', 'SM13', 'WA01']) vals.push(`${c}=${(await soc.cellValue(a, cols.indexOf(c))).slice(0, 10) || '-'}`);
    console.log(`PROBE single ${a}: ${vals.join(' ')}`);
  }
  await soc.bulkMode();
  const m = await soc.readMatrix(run.workAreas);
  for (const a of acts) {
    const r = m.rows.find((x) => x.activity === a);
    console.log(`PROBE bulk   ${a}: ${['SM01', 'SM07', 'SM13', 'WA01'].map((c) => `${c}=${(r.cells[m.columns.indexOf(c)].value || '-').slice(0, 10)}`).join(' ')}`);
  }
  const empty = m.rows.reduce((n, r) => n + r.cells.filter((c) => !c.value).length, 0);
  console.log(`PROBE bulk: ${m.rows.length} rows x ${m.columns.length} cols, ${empty} empty cells`);
  await context.close();
});
