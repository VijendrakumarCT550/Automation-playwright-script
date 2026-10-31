const { test } = require('@playwright/test');
const { drsEnv, loginSuperAdmin } = require('../utils/drs-ui');
const PackagesConfiguratorPage = require('../../drs-setting/PackagesConfiguratorPage');

// ROUND 23 — READ ONLY. What catalog versions exist on a DRS env before we make
// any: the Solar Site list, and the Catalog version options of "All sites" and of
// the site in PROBE_SITE (default "Automation Site 06").
// Run: cross-env DRS_ENV=dev npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round23_dev_catalogs.spec.js

const ENV = drsEnv();
const SITE = process.env.PROBE_SITE || 'Automation Site 06';

test('round 23: Solar sites + catalog versions (read only)', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  await page.setViewportSize({ width: 1700, height: 1100 });
  await loginSuperAdmin(page, ENV);
  const pc = new PackagesConfiguratorPage(page, ENV.baseUrl);
  await pc.goto();
  await pc.choose('Project Type', 'Solar');
  const sites = await pc.optionLabels('Site');
  console.log(`  drs-${ENV.key} Solar sites: ${JSON.stringify(sites)}`);
  for (const site of ['All sites', SITE]) {
    if (!sites.some((s) => s.toLowerCase() === site.toLowerCase())) { console.log(`  ${site}: NOT in the Site list`); continue; }
    await pc.selectProjectTypeAndSite(site);
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `test-results/round23-${site.replace(/\W+/g, '_')}.png`, fullPage: true });
    const combos = await page.getByRole('combobox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.id || e.textContent.trim()));
    console.log(`  ${site} comboboxes: ${JSON.stringify(combos)}`);
    if (!(await pc.combo('Catalog version').isVisible().catch(() => false))) { console.log(`  ${site}: no Catalog version box`); continue; }
    console.log(`  ${site} versions: ${JSON.stringify(await pc.optionLabels('Catalog version'))}`);
  }
});
