const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  drsEnv, installWriteGuard, loginSuperAdmin, makeDumper, openCombobox, visibleOptions, chooseOption,
} = require('../utils/drs-ui');
const state = require('../utils/drs-state');

// ===========================================================================
// DRS EXPLORATION — ROUND 9. READ-ONLY, ENFORCED.
// 2026-10-14: SO Configuration changed. Filters are now Work Location · Version ·
// Work Area · Package, and the matrix says "Select a Work Location to begin".
// The Version list is the catalog versions of the project's type + site scope
// (what D03 pinned). Questions this round answers:
//   1. Which filters are pre-filled on open (Version "All sites v1", Package "Civil")?
//   2. After picking Work Location: what does Version offer, is Work Area single
//      or multi select, which Work Areas are listed (only those pinned to the version?)
//   3. Once Work Area (+ Package) are chosen, does the matrix appear, and with
//      which columns?
// Never saves (the write guard aborts any non-GET).
// Target: DRS_EXPLORE_TAG, else the newest project that completed D7.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round9_so_config_filters.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round9');

let context, page, dump;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (context) await context.close();
});

const read = async (loc) => ((await loc.inputValue().catch(() => '')) || (await loc.innerText().catch(() => ''))).trim();

test('SO Configuration: how do the four filters cascade now?', async ({ browser }) => {
  test.setTimeout(8 * 60 * 1000);
  const all = state.envRecord(ENV.key).projects;
  const run = process.env.DRS_EXPLORE_TAG
    ? all.find((p) => p.tag === process.env.DRS_EXPLORE_TAG)
    : [...all].reverse().find((p) => (p.stagesDone || []).includes('D7'));
  if (!run) throw new Error('no project with D7 done');
  console.log(`  project ${run.name} (${run.id}); work location ${run.workLocation}; pinned ${JSON.stringify(run.pinned)}`);

  context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  await page.goto(`${ENV.baseUrl}/projects/${run.id}/configuration?step=so_config`);
  const wlBox = page.getByRole('combobox', { name: 'Work Location' }).first();
  await wlBox.waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1500);
  const f = summary.findings;
  const snap = async () => ({
    workLocation: await read(page.getByRole('combobox', { name: 'Work Location' }).first()),
    version: await read(page.getByRole('combobox', { name: 'Version' }).first()),
    workArea: await read(page.getByRole('combobox', { name: 'Work Area' }).first()),
    pkg: await read(page.getByRole('combobox', { name: 'Package' }).first()),
  });
  f.onOpen = await snap();
  console.log('  on open:', JSON.stringify(f.onOpen));
  await dump('01-on-open');

  // Work Location options, then choose ours.
  const wlBoxEl = page.getByRole('combobox', { name: 'Work Location' }).first();
  await openCombobox(page, wlBoxEl);
  f.workLocationOptions = await visibleOptions(page, 200);
  console.log('  Work Location options:', f.workLocationOptions.length, f.workLocationOptions.slice(0, 8));
  await page.keyboard.press('Escape');
  const okWl = await chooseOption(page, wlBoxEl, run.workLocation);
  console.log(`  chose Work Location "${run.workLocation}": ${okWl}`);
  await dump('02-after-work-location');
  f.afterWorkLocation = await snap();
  console.log('  after Work Location:', JSON.stringify(f.afterWorkLocation));

  // Version options (clear the search text first - see DrsSoConfigPage.open).
  const vBox = page.getByRole('combobox', { name: 'Version' }).first();
  await vBox.fill('').catch(() => {});
  await page.waitForTimeout(500);
  await openCombobox(page, vBox);
  f.versionOptions = await visibleOptions(page, 50);
  console.log('  Version options:', f.versionOptions);
  await page.keyboard.press('Escape');
  await dump('03-version-options');
  const okV = await chooseOption(page, vBox, 'All sites v1');
  console.log(`  chose Version "All sites v1": ${okV}`);
  f.afterVersion = await snap();
  console.log('  after Version:', JSON.stringify(f.afterVersion));
  await dump('03b-after-version');

  // Work Area options - single or multi?
  const waBox = page.getByRole('combobox', { name: 'Work Area' }).first();
  await openCombobox(page, waBox);
  f.workAreaOptions = await visibleOptions(page, 100);
  console.log('  Work Area options:', f.workAreaOptions);
  await dump('04-work-area-options');
  f.workAreaHasCheckboxes = await page.locator('[role="option"]:visible input[type="checkbox"], [role="option"]:visible [role="checkbox"]').count();
  const first = page.locator('[role="option"]:visible').first();
  if (await first.isVisible().catch(() => false)) {
    await first.click();
    await page.waitForTimeout(1200);
    f.listStaysOpenAfterPick = await page.locator('[role="option"]:visible').count() > 0;
    console.log(`  list stays open after one pick (multi-select hint): ${f.listStaysOpenAfterPick}`);
    await dump('05-after-first-work-area');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
  }
  f.afterWorkArea = await snap();
  console.log('  after Work Area:', JSON.stringify(f.afterWorkArea));
  f.workAreaChips = await page.locator('[data-scope="tags-input"], [data-part="item"], [class*="chip"], [class*="tag"]').allInnerTexts().catch(() => []);

  // Does the matrix show now?
  await page.waitForTimeout(3000);
  f.activityHeader = await page.getByText('Activity', { exact: true }).first().isVisible().catch(() => false);
  f.hint = await page.getByText(/Select a .* to begin/i).allInnerTexts().catch(() => []);
  console.log(`  matrix header visible: ${f.activityHeader}; hint: ${JSON.stringify(f.hint)}`);
  f.columnTexts = (await page.locator('p').allInnerTexts()).map((t) => t.trim()).filter((t) => run.workAreas.includes(t));
  console.log('  Work Area columns:', f.columnTexts);
  await dump('06-matrix');
});
