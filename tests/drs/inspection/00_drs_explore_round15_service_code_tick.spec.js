const { test } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { drsEnv, installWriteGuard, loginSuperAdmin } = require('../utils/drs-ui');
const ServiceConfiguratorPage = require('../../drs-setting/ServiceConfiguratorPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 15. READ-ONLY, ENFORCED (a tick is UI state until Save,
// and the write guard aborts any save). Which click ticks a Service Configurator
// sub-activity row? The checkbox inside the row did not take a click (2026-10-15).
// Tries, in order, on "Piling - MMS (F.3.1) Solar · Automation Site 01 v1":
// the row's checkbox wrapper, the row's left edge, keyboard Space on the row, the
// row itself - and reports the first that ticks it and what the row's DOM is.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round15_service_code_tick.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round15');
const blocked = [];

test('which click ticks a sub-activity row', async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const sc = new ServiceConfiguratorPage(page, ENV.baseUrl);
  await sc.goto();
  await sc.openCode('120021756');
  const row = await sc.subActivityRow('Piling - MMS', 'Solar', 'Automation Site 01 v1', 'Piling');
  await row.waitFor({ state: 'visible', timeout: 15000 });
  fs.mkdirSync(OUT, { recursive: true });
  const html = await row.evaluate((el) => el.outerHTML).catch((e) => `ERR ${e.message}`);
  fs.writeFileSync(path.join(OUT, 'row.html'), html);
  console.log('  row html (first 1200):', html.slice(0, 1200));
  console.log('  checkbox count in row:', await row.getByRole('checkbox').count(),
    ' box:', JSON.stringify(await row.getByRole('checkbox').first().boundingBox().catch(() => null)),
    ' row box:', JSON.stringify(await row.boundingBox()));

  const tries = [
    ['row left edge', () => row.click({ position: { x: 12, y: 14 }, timeout: 4000 })],
    ['checkbox force', () => row.getByRole('checkbox').first().click({ force: true, timeout: 4000 })],
    ['dispatch click on input', () => row.locator('input[type="checkbox"]').first().dispatchEvent('click')],
    ['row click', () => row.click({ timeout: 4000 })],
    ['focus + Space', async () => { await row.focus(); await page.keyboard.press('Space'); }],
  ];
  for (const [how, act] of tries) {
    const err = await act().then(() => null).catch((e) => e.message.split('\n')[0]);
    await page.waitForTimeout(800);
    const ticked = await sc.isTicked(row);
    console.log(`  ${how}: ${err ? `error ${err}` : 'ok'} -> ticked=${ticked}`);
    if (ticked) break;
  }
  await page.screenshot({ path: path.join(OUT, 'after.png') });
  console.log('  blocked writes:', blocked.length ? blocked : '(none)');
  await context.close();
});
