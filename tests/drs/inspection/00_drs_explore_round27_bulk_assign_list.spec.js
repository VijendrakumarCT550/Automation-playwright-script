const { test } = require('@playwright/test');
const { drsEnv, installWriteGuard, loginSuperAdmin, openCombobox, visibleOptions } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DrsSoConfigPage = require('../pages/DrsSoConfigPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 27. READ-ONLY, ENFORCED (write guard).
// SO Configuration bulk edit, R5 (2026-10-21): with cells selected, the "Select SO
// to assign to selected" list opened EXPANDED BUT EMPTY on 5 of 6 versions. What
// does the list hold - right away, after a wait, after typing, after a re-open?
// Nothing is applied or saved (Save is never clicked; writes are blocked anyway).
// Run: REF_TAG=21102026-OB5 REF_VERSION="All sites v16" npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round27_bulk_assign_list.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();

test('bulk assign list contents', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const run = state.envRecord(ENV.key).projects.find((p) => p.tag === (process.env.REF_TAG || '21102026-OB5'));
  const version = process.env.REF_VERSION || 'All sites v16';
  const areas = Object.entries(run.areaVersions).filter(([, v]) => v === version).map(([a]) => a);
  const so = run.serviceOrders.Civil.number;
  const blocked = [];
  const context = await browser.newContext({ viewport: { width: 1900, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const soc = new DrsSoConfigPage(page, ENV.baseUrl);
  await soc.open(run.id, { workLocation: run.workLocation, version, workAreas: areas, pkg: 'Civil' });
  await soc.bulkMode();
  const m = await soc.readMatrix(run.workAreas);
  const boxes = m.rows.slice(0, Number(process.env.REF_CELLS || 3)).map((r) => r.cells[m.columns.indexOf(areas.find((a) => /^WA/.test(a)))].box);
  await soc.selectCells(boxes);
  console.log(`PROBE ${version}: selected ${await soc.selectedCount()}, SO ${so}`);
  const pick = page.getByPlaceholder('Select SO to assign to selected').first();
  const listbox = async () => page.evaluate(() => [...document.querySelectorAll('[role="listbox"]')].map((l) => ({
    state: l.getAttribute('data-state'), options: [...l.querySelectorAll('[role="option"]')].map((o) => o.textContent.trim()).slice(0, 5),
    empty: (l.textContent || '').trim().slice(0, 80),
  })));
  await openCombobox(page, pick);
  console.log('PROBE at once: visible=' + JSON.stringify(await visibleOptions(page)) + ' listboxes=' + JSON.stringify(await listbox()));
  await page.waitForTimeout(5000);
  console.log('PROBE after 5s: visible=' + JSON.stringify(await visibleOptions(page)));
  await pick.fill(so.slice(0, 4));
  await page.waitForTimeout(2000);
  console.log('PROBE after typing: visible=' + JSON.stringify(await visibleOptions(page)) + ' listboxes=' + JSON.stringify(await listbox()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);
  await pick.click();
  await page.waitForTimeout(1500);
  console.log('PROBE after clicking the input: visible=' + JSON.stringify(await visibleOptions(page)));
  // The fixed page-object path (type + wait + re-open), WITHOUT clicking Apply.
  const option = page.locator('[role="option"]:visible').filter({ hasText: new RegExp(`^\\s*${so}\\b`) }).first();
  let shown = false;
  for (let attempt = 1; attempt <= 3 && !shown; attempt += 1) {
    if (attempt > 1) { await page.keyboard.press('Escape').catch(() => {}); await page.waitForTimeout(3000); }
    await openCombobox(page, pick);
    await pick.fill(so).catch(() => {});
    shown = await option.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    console.log(`PROBE fixed path try ${attempt}: ${shown}`);
  }
  console.log('PROBE blocked writes: ' + JSON.stringify(blocked));
  await context.close();
});
