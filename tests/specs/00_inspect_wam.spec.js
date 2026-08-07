/**
 * DOM Inspector — NOT a real test, no assertions.
 * Drives the WAM "Add Details" dialog for the Contractor Incharge role,
 * which has an extra "Service Order" field after Package that the other
 * roles (Execution Engineer, Quality Inspector) don't have. Confirms the
 * Service Order search-combobox behavior, which Work Areas appear after
 * picking a vendor, the assignable-CI-user roster, and the final button
 * label (Save vs Submit). Does NOT click that button.
 *
 * Usage (single run, headed so you can watch):
 *   npx playwright test tests/specs/00_inspect_wam.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const WAMPage = require('../pages/WAMPage');
const { adminFreshLogin } = require('../utils/helpers');

test('Capture WAM Add Details dialog for Contractor Incharge', async ({ browser }) => {
  const { context, page, dashboard } = await adminFreshLogin(browser);
  fs.mkdirSync('test-results', { recursive: true });

  try {
    const wam = new WAMPage(page);
    await wam.goto(dashboard);
    await wam.openAddDetails();

    await wam.selectDropdownOption(wam.dialogRoleDropdown, 'Contractor Incharge');

    // Cluster may show "Gujarat" or "Khavda" depending on deployment state —
    // check which options are actually present.
    await wam.dialogClusterDropdown.click();
    await page.waitForTimeout(500);
    const clusterOptions = await page.locator('[role="listbox"][data-state="open"] [role="option"]').allInnerTexts();
    console.log('Cluster options:', JSON.stringify(clusterOptions));
    const clusterTarget = (clusterOptions.find(t => /gujarat/i.test(t)) || clusterOptions.find(t => /khavda/i.test(t)) || clusterOptions[0]).split('\n')[0].trim();
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').filter({ hasText: clusterTarget }).first().click();
    await page.waitForTimeout(300);
    console.log('Cluster picked:', clusterTarget);

    await wam.dialogSitesDropdown.click();
    await page.waitForTimeout(500);
    const siteOptions = await page.locator('[role="listbox"][data-state="open"] [role="option"]').allInnerTexts();
    console.log('Site options:', JSON.stringify(siteOptions));
    const siteTarget = (siteOptions.find(t => /khavda/i.test(t)) || siteOptions[0]).split('\n')[0].trim();
    await page.locator('[role="listbox"][data-state="open"] [role="option"]').filter({ hasText: siteTarget }).first().click();
    await page.waitForTimeout(300);
    console.log('Site picked:', siteTarget);

    await wam.selectDropdownOption(wam.dialogWorkLocationDropdown, 'A-06c');
    await wam.selectDropdownOption(wam.dialogPackageDropdown, 'Civil');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);

    await page.screenshot({ path: 'test-results/wam_ci_after_package.png', fullPage: true });

    // Find the Service Order field
    const soDropdown = wam.dialog.getByRole('combobox', { name: /Service Order/i });
    console.log('Service Order dropdown visible?', await soDropdown.isVisible({ timeout: 3000 }).catch(() => false));
    await soDropdown.click();
    await page.waitForTimeout(500);
    let soOptions = await page.locator('[role="listbox"][data-state="open"] [role="option"]').allInnerTexts();
    console.log('Service Order options (no typing):', JSON.stringify(soOptions));

    if (soOptions.length === 0) {
      // Might be a true search box requiring typed input
      await page.keyboard.type('CHOUHAN', { delay: 60 });
      await page.waitForTimeout(1000);
      soOptions = await page.locator('[role="listbox"][data-state="open"] [role="option"]').allInnerTexts();
      console.log('Service Order options (after typing CHOUHAN):', JSON.stringify(soOptions));
    }

    const soOption = page.locator('[role="listbox"][data-state="open"] [role="option"]').filter({ hasText: 'CHOUHAN' }).first();
    if (await soOption.isVisible({ timeout: 3000 }).catch(() => false)) {
      await soOption.click();
      await page.waitForTimeout(1000);
      console.log('Service Order combo value after selecting:', await soDropdown.innerText().catch(e => 'ERR: ' + e.message));
    } else {
      console.log('CHOUHAN vendor NOT found in Service Order options');
    }

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1500);
    await page.screenshot({ path: 'test-results/wam_ci_after_so.png', fullPage: true });
    fs.writeFileSync('test-results/wam_ci_dialog_full.html', await wam.dialog.evaluate(el => el.outerHTML));

    const dialogButtons = await wam.dialog.evaluate(el =>
      Array.from(el.querySelectorAll('button')).map(b => b.innerText?.trim()).filter(Boolean)
    );
    console.log('Dialog buttons after SO select:', JSON.stringify(dialogButtons));

    const bl01Row = wam.getWorkAreaRow('BL01');
    console.log('BL01 row count:', await bl01Row.count());
    if (await bl01Row.count()) {
      const bl01Combo = bl01Row.locator('[role="combobox"]');
      await bl01Combo.click();
      await page.waitForTimeout(500);
      const userOptions = await page.locator('[role="listbox"][data-state="open"] [role="option"]').allInnerTexts();
      console.log('BL01 CI user options:', JSON.stringify(userOptions));
      console.log('Vikram Singh present?', userOptions.some(t => t.includes('Vikram Singh')));
      await page.keyboard.press('Escape');
    }
  } finally {
    await context.close();
  }
});
