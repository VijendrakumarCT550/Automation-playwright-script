const { test } = require('@playwright/test');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper, openCombobox, visibleOptions, chooseOption } = require('../utils/drs-ui');

// ===========================================================================
// DRS EXPLORATION — ROUND 25. READ-ONLY, ENFORCED.
// The app owner's reference project "AGEL Hybrid Merchant_292 (Solar)": how its
// SO Configuration maps Road / Drain / other activities onto Work Areas, and how
// its SO lines group sub-activities (step 5). Dumps every Version × Package
// matrix (all Work Areas) and the SO Line Mapping page.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round25_reference_project.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round25');
const NAME = process.env.REF_PROJECT || 'AGEL Hybrid Merchant_292';

test('reference project: SO Configuration + SO Line Mapping', async ({ browser }) => {
  test.setTimeout(30 * 60 * 1000);
  const blocked = [];
  const context = await browser.newContext({ viewport: { width: 2200, height: 1300 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const dump = makeDumper(page, OUT, { screens: [] });

  // Find the project on the list and read its id from the URL it opens.
  const search = page.getByPlaceholder(/search/i).first();
  if (await search.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false)) await search.fill(NAME);
  await page.waitForTimeout(2500);
  await page.getByText(NAME, { exact: false }).first().click();
  await page.waitForURL(/\/projects\/[0-9a-f-]{36}/, { timeout: 60000 });
  const id = page.url().match(/\/projects\/([0-9a-f-]{36})/)[1];
  console.log(`  ${NAME}: ${id}`);

  // Step 5 - SO Line Mapping.
  await page.goto(`${ENV.baseUrl}/projects/${id}/configuration?step=so_line_mapping`);
  await page.waitForTimeout(5000);
  await dump('so-line-mapping');

  // Step 4 - SO Configuration, every Work Location × Version × Package, all areas.
  await page.goto(`${ENV.baseUrl}/projects/${id}/configuration?step=so_config`);
  const wl = page.getByRole('combobox', { name: 'Work Location' }).first();
  await wl.waitFor({ state: 'visible', timeout: 60000 });
  await openCombobox(page, wl);
  const locations = await visibleOptions(page);
  await page.keyboard.press('Escape');
  console.log('  work locations:', locations);
  for (const loc of locations.filter((l) => l === (process.env.REF_WL || 'S05b'))) {
    await page.goto(`${ENV.baseUrl}/projects/${id}/configuration?step=so_config`);
    await wl.waitFor({ state: 'visible', timeout: 60000 });
    await chooseOption(page, wl, loc);
    const v = page.getByRole('combobox', { name: 'Version' }).first();
    await v.fill('').catch(() => {});
    await openCombobox(page, v);
    const versions = await visibleOptions(page);
    await page.keyboard.press('Escape');
    console.log(`  ${loc}: versions`, versions);
    for (const version of versions.filter((x) => x.trim() === (process.env.REF_VERSION || 'All sites v1'))) {
      for (const pkg of ['Civil', 'Electrical']) {
        await page.goto(`${ENV.baseUrl}/projects/${id}/configuration?step=so_config`);
        await wl.waitFor({ state: 'visible', timeout: 60000 });
        await chooseOption(page, wl, loc);
        await v.fill('').catch(() => {});
        await page.waitForTimeout(500);
        if (!(await chooseOption(page, v, version))) { console.log(`  ${version}: not choosable`); continue; }
        const wa = page.getByRole('combobox', { name: 'Work Area' }).first();
        await page.waitForTimeout(1500);
        await openCombobox(page, wa);
        // "Select all" did not tick anything (round 25), so every area one by one.
        await page.locator('[role="option"]:visible').first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
        const areaNames = (await visibleOptions(page, 500)).filter((t) => !/select all/i.test(t));
        console.log(`  ${version}: work areas (${areaNames.length})`, areaNames.join(', '));
        for (const name of areaNames) {
          const o = page.locator('[role="option"]:visible').filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first();
          if (!(await o.isVisible().catch(() => false))) await openCombobox(page, wa);
          await o.click({ timeout: 5000 }).catch(() => console.log(`  could not tick ${name}`));
          await page.waitForTimeout(300);
        }
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
        const p = page.getByRole('combobox', { name: 'Package' }).first();
        if (!(await chooseOption(page, p, pkg))) { console.log(`  ${version} / ${pkg}: package not offered`); continue; }
        await page.waitForTimeout(3000);
        await dump(`so-config-${loc}-${version}-${pkg}`.replace(/\W+/g, '-'));
      }
    }
  }
  console.log('  blocked writes:', blocked);
  await context.close();
});
