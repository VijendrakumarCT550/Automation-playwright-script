const { test } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const { loadLastCreatedUsers } = require('../../utils/user-counter-utils');
const UserManagementPage = require('../../pages/UserManagementPage');

// PURE RECON, round 3 — round 2 confirmed the Reports controls are real
// <button> elements wrapping svg.lucide-funnel (filter) / svg.lucide-download
// (download), but didn't open the filter panel or attempt a real download.
// It also read Sites/Work Locations as empty for every PAD Add-User role —
// which was a recon methodology bug (peeking at each field in isolation
// instead of completing the cascade in order), not a real app behavior.
// This round does the cascade for real and captures an actual download.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const lastCreated = loadLastCreatedUsers();

test('RECON round 3: Reports filter panel + real download, PAD real cascade', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  console.log('\n========== A. REPORTS — filter panel + real download ==========');
  const cad = lastCreated.CAD;
  const dashboard = await loginAsUser(page, cad.email, PASSWORD);
  await dashboard.goToDashboard();
  await dashboard.revealNavIfCollapsed('Dashboard');
  await dashboard.navItem('Reports').click();
  await page.waitForTimeout(800);
  await dashboard.navItem('RFI status report').click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);
  console.log('On:', page.url());

  const filterBtn = page.locator('button').filter({ has: page.locator('svg.lucide-funnel') }).first();
  const downloadBtn = page.locator('button').filter({ has: page.locator('svg.lucide-download') }).first();
  console.log('filterBtn visible:', await filterBtn.isVisible().catch(() => false));
  console.log('downloadBtn visible:', await downloadBtn.isVisible().catch(() => false));

  await filterBtn.click();
  await page.waitForTimeout(800);
  // Dump whatever panel/dialog opened
  const panel = page.locator('[data-scope="dialog"][data-part="content"], [role="dialog"]').first();
  const panelVisible = await panel.isVisible({ timeout: 3000 }).catch(() => false);
  console.log('Filter panel visible after click:', panelVisible);
  if (panelVisible) {
    const panelHtml = await panel.evaluate(el => el.outerHTML).catch(e => `ERROR: ${e.message}`);
    require('fs').writeFileSync('test-results/recon3_filter_panel.html', panelHtml);
    console.log('Saved filter panel HTML to test-results/recon3_filter_panel.html (length:', panelHtml.length, ')');
    const panelText = await panel.innerText().catch(() => '');
    console.log('Filter panel visible text:\n', panelText);

    // List every combobox/input inside it
    const fields = await panel.evaluate(el => {
      const combos = Array.from(el.querySelectorAll('[role="combobox"], input, select'));
      return combos.map(c => ({
        tag: c.tagName, role: c.getAttribute('role'), name: c.getAttribute('aria-label') || c.getAttribute('placeholder') || c.closest('label')?.innerText || null,
      }));
    }).catch(e => [`ERROR: ${e.message}`]);
    console.log('Filter panel fields:', JSON.stringify(fields, null, 1));
  } else {
    // Maybe it's not a dialog but an inline expanding panel — dump whole page text diff
    const bodyText = await page.locator('body').innerText();
    console.log('Body text after filter click (first 1500 chars):\n', bodyText.slice(0, 1500));
  }

  // Try a real download regardless (even without applying a filter) to learn the file format
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      downloadBtn.click(),
    ]);
    const suggested = download.suggestedFilename();
    const savePath = require('path').join(__dirname, '..', '..', '..', 'test-results', `recon3_${suggested}`);
    await download.saveAs(savePath);
    const stat = require('fs').statSync(savePath);
    console.log('Downloaded:', suggested, 'size:', stat.size, 'bytes');
    const buf = require('fs').readFileSync(savePath);
    console.log('First 16 bytes (hex):', buf.subarray(0, 16).toString('hex'));
    if (/\.(csv|txt|json)$/i.test(suggested)) {
      console.log('First 600 chars:\n', buf.toString('utf8').slice(0, 600));
    }
  } catch (e) {
    console.log('Download attempt failed:', e.message);
  }

  console.log('\n========== B. PLOT ADMIN — real cascade (Cluster -> Sites -> Work Locations) ==========');
  const pad = lastCreated.PAD;
  const padDashboard = await loginAsUser(page, pad.email, PASSWORD);
  const padUsers = new UserManagementPage(page);
  await padUsers.goto(padDashboard);
  await padUsers.openAddUserDialog();
  await padUsers.selectUserType('AGEL');
  await padUsers.selectUserRole('Execution Lead');

  // Select Cluster for real (only one option, "KHAVDA")
  await padUsers.clusterDropdown.click();
  await page.waitForTimeout(400);
  let lb = page.locator('[role="listbox"][data-state="open"]').first();
  let opts = await lb.locator('[role="option"]').allInnerTexts().catch(() => []);
  console.log('Cluster options:', JSON.stringify(opts));
  if (opts.length) {
    await lb.locator('[role="option"]').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);
  }
  // Close listbox if still open (some Cluster fields are multi-select per UserManagementPage comments)
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  console.log('Sites visible now:', await padUsers.sitesDropdown.isVisible({ timeout: 3000 }).catch(() => false));
  await padUsers.sitesDropdown.click().catch(() => {});
  await page.waitForTimeout(400);
  lb = page.locator('[role="listbox"][data-state="open"]').first();
  opts = await lb.locator('[role="option"]').allInnerTexts().catch(() => []);
  console.log('Sites options (real, after Cluster picked):', JSON.stringify(opts));
  if (opts.length) {
    await lb.locator('[role="option"]').first().click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(600);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  console.log('Work Locations visible now:', await padUsers.workLocationsDropdown.isVisible({ timeout: 3000 }).catch(() => false));
  await padUsers.workLocationsDropdown.click().catch(() => {});
  await page.waitForTimeout(400);
  lb = page.locator('[role="listbox"][data-state="open"]').first();
  opts = await lb.locator('[role="option"]').allInnerTexts().catch(() => []);
  console.log('Work Locations options (real, after Sites picked) — THIS IS THE JURISDICTION ANSWER:', JSON.stringify(opts));
  await page.keyboard.press('Escape').catch(() => {});

  await padUsers.closeDialog();
  await context.close();
});
