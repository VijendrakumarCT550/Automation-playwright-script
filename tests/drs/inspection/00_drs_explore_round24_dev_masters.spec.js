const { test } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { drsEnv, loginSuperAdmin } = require('../utils/drs-ui');
const DrsAppSettingsPage = require('../pages/DrsAppSettingsPage');

// ROUND 24 — READ ONLY. The masters an onboarding needs on a DRS env:
//   * does SPV PROBE_SPV (default VIJESPV) exist; the SPV list; the Add SPV form's
//     fields (opened, read, CANCELLED - never submitted)
//   * the Locations tree: every cluster and its sites (which cluster holds PROBE_SITE)
// Run: cross-env DRS_ENV=dev npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round24_dev_masters.spec.js

const ENV = drsEnv();
const SPV = process.env.PROBE_SPV || 'VIJESPV';
const SITE = process.env.PROBE_SITE || 'Pulse-Site 06';
const OUT = path.resolve(__dirname, '../../../drs-explore/round24');

test('round 24: SPV + clusters/sites (read only)', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginSuperAdmin(page, ENV);
  const s = new DrsAppSettingsPage(page, ENV.baseUrl);

  console.log(`  SPV "${SPV}" exists on drs-${ENV.key}: ${await s.spvExists(SPV)}`);
  await page.getByRole('textbox', { name: 'Search SPVs' }).fill('');
  await page.waitForTimeout(1500);
  const main = (await page.locator('main').innerText().catch(() => '')).replace(/\n+/g, ' | ');
  console.log(`  SPV page text: ${main.slice(0, 1500)}`);
  const add = page.getByRole('button', { name: /Add SPV/i });
  if (await add.isVisible().catch(() => false)) {
    await add.click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: path.join(OUT, 'add-spv-form.png'), fullPage: true });
    const fields = await page.locator('input, textarea, [role="combobox"], button').evaluateAll((els) => els
      .filter((e) => e.offsetParent !== null)
      .map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute('role') || e.type || ''}] name=${e.getAttribute('aria-label') || e.name || e.placeholder || e.textContent.trim().slice(0, 40)}`));
    console.log(`  Add SPV form controls: ${JSON.stringify(fields)}`);
    const dialog = page.getByRole('dialog').first();
    if (await dialog.isVisible().catch(() => false)) console.log(`  Add SPV dialog text: ${(await dialog.innerText()).replace(/\n+/g, ' | ')}`);
    await page.keyboard.press('Escape').catch(() => {});
  } else console.log('  no "Add SPV" button visible');

  await s.gotoLocations();
  const clusters = await page.getByRole('treeitem', { level: 1 }).allInnerTexts();
  console.log(`  clusters: ${JSON.stringify(clusters.map((c) => c.split('\n')[0].trim()))}`);
  for (const c of clusters.map((x) => x.split('\n')[0].trim())) {
    console.log(`  ${c} has "${SITE}": ${await s.siteExists(c, SITE)}`);
    const sites = await page.getByRole('treeitem', { level: 2 }).allInnerTexts().catch(() => []);
    console.log(`  level-2 items now shown: ${JSON.stringify(sites.map((x) => x.split('\n')[0].trim()))}`);
  }
});
