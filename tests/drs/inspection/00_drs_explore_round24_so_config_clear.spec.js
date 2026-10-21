const { test } = require('@playwright/test');
const { drsEnv, installWriteGuard, loginSuperAdmin, openCombobox } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DrsSoConfigPage = require('../pages/DrsSoConfigPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 24. READ-ONLY, ENFORCED.
// SO Configuration: can a mapped cell be CLEARED? (D05 mapped Piling onto the
// onboarding project's Road01 / Drain01 before the app owner's rule "Road / Drain
// areas take only Road Works / Drain Work".) Opens Piling - MMS × Road01 and
// reports the cell's options and any clear control.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round24_so_config_clear.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();

test('can an SO Configuration cell be cleared', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const run = state.envRecord(ENV.key).projects.find((p) => p.tag === '19102026-OB1');
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  await installWriteGuard(context, ENV, []);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const soc = new DrsSoConfigPage(page, ENV.baseUrl);
  await soc.open(run.id, { workLocation: run.workLocation, version: 'All sites v1', workAreas: ['WA01', 'Road01', 'Drain01'], pkg: 'Civil' });
  const cols = await soc.columns(run.workAreas);
  console.log('  columns:', cols);
  console.log('  activities():', await soc.activities(cols));
  const cell = soc.cell('Piling - MMS', cols.indexOf('Road01'));
  console.log('  value:', await soc.cellValue('Piling - MMS', cols.indexOf('Road01')));
  const wrap = cell.locator('xpath=ancestor::*[self::div][2]');
  console.log('  cell html:', (await wrap.evaluate((e) => e.outerHTML)).slice(0, 1500));
  await cell.hover();
  console.log('  buttons near cell:', await wrap.locator('button').evaluateAll((bs) => bs.map((b) => `${b.getAttribute('aria-label')}|${b.textContent.trim()}`)));
  await openCombobox(page, cell);
  console.log('  options:', await page.locator('[role="option"]:visible').allInnerTexts());
  await page.keyboard.press('Escape');
  console.log('  page buttons:', await page.getByRole('button').evaluateAll((bs) => [...new Set(bs.map((b) => b.getAttribute('aria-label') || b.textContent.trim()))].slice(0, 40)));
  await context.close();
});
