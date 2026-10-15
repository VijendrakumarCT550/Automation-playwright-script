const { test } = require('@playwright/test');
const { drsEnv, installWriteGuard, loginSuperAdmin } = require('../utils/drs-ui');
const ServiceConfiguratorPage = require('../../drs-setting/ServiceConfiguratorPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 17. READ-ONLY, ENFORCED. The real catalog name of the
// Robot group's second sub-activity: the BBU workbook says "Installation of docking
// & reverse stations", but no Service Configurator row has that name. Lists every
// treeitem label matching "dock" / "revers" / "Robot" for All sites v1.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round17_docking_name.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();

test('robot group names', async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
  await installWriteGuard(context, ENV, []);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const sc = new ServiceConfiguratorPage(page, ENV.baseUrl);
  await sc.goto();
  await sc.openCode('120036457');
  for (const term of ['dock', 'Docking', 'revers', 'Robot']) {
    await sc.subSearch().fill(term);
    await page.waitForTimeout(2500);
    const labels = await page.getByRole('treeitem').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-level')}: ${e.getAttribute('aria-label')}`));
    console.log(`  "${term}": ${labels.filter((l) => /All sites v1$/.test(l)).join(' | ') || '(no All sites v1 rows rendered)'} `);
  }
  await context.close();
});
