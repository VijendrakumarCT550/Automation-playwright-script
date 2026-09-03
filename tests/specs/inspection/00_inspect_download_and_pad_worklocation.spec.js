const { test } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const { loadLastCreatedUsers } = require('../../utils/user-counter-utils');
const UserManagementPage = require('../../pages/UserManagementPage');

// PURE RECON, round 4 (last planned round) — round 3's download attempt
// timed out because the filter dialog's backdrop was still open and
// blocking the click; and the PAD cascade hand-rolled here (rather than
// using the already-validated fillLocationCascade()) showed Sites/Work
// Locations both invisible, likely because Project Type was skipped in the
// middle of the cascade order. This round: close the filter dialog before
// downloading, and drive PAD's cascade through the REAL
// UserManagementPage.fillLocationCascade() method the actual spec will use.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const lastCreated = loadLastCreatedUsers();

test('RECON round 4: real download (dialog closed first), PAD cascade via fillLocationCascade', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  console.log('\n========== A. REPORTS — real download, no dialog open ==========');
  const cad = lastCreated.CAD;
  const dashboard = await loginAsUser(page, cad.email, PASSWORD);
  await dashboard.goToDashboard();
  await dashboard.revealNavIfCollapsed('Dashboard');
  await dashboard.navItem('Reports').click();
  await page.waitForTimeout(800);
  await dashboard.navItem('RFI status report').click();
  await page.waitForLoadState('networkidle').catch(() => {});
  await page.waitForTimeout(1000);

  const downloadBtn = page.locator('button').filter({ has: page.locator('svg.lucide-download') }).first();
  try {
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      downloadBtn.click(),
    ]);
    const suggested = download.suggestedFilename();
    const savePath = require('path').join(__dirname, '..', '..', '..', 'test-results', `recon4_unfiltered_${suggested}`);
    await download.saveAs(savePath);
    const stat = require('fs').statSync(savePath);
    console.log('UNFILTERED download:', suggested, 'size:', stat.size, 'bytes');
    const buf = require('fs').readFileSync(savePath);
    console.log('First 16 bytes (hex):', buf.subarray(0, 16).toString('hex'));
    if (/\.(csv|txt|json)$/i.test(suggested)) console.log('First 400 chars:\n', buf.toString('utf8').slice(0, 400));
  } catch (e) {
    console.log('Unfiltered download attempt failed:', e.message);
  }

  console.log('\n--- Now apply a filter (RFI Status) and download again ---');
  const filterBtn = page.locator('button').filter({ has: page.locator('svg.lucide-funnel') }).first();
  await filterBtn.click();
  await page.waitForTimeout(800);
  const panel = page.locator('[data-scope="dialog"][data-part="content"], [role="dialog"]').first();
  const statusField = panel.getByRole('combobox', { name: /status/i }).first();
  const statusVisible = await statusField.isVisible({ timeout: 3000 }).catch(() => false);
  console.log('RFI Status field visible:', statusVisible);
  if (statusVisible) {
    await statusField.click();
    await page.waitForTimeout(500);
    const lb = page.locator('[role="listbox"][data-state="open"]').first();
    const opts = await lb.locator('[role="option"]').allInnerTexts().catch(() => []);
    console.log('RFI Status options:', JSON.stringify(opts));
    const approvedOpt = lb.locator('[role="option"]').filter({ hasText: /approved/i }).first();
    if (await approvedOpt.isVisible({ timeout: 1000 }).catch(() => false)) {
      await approvedOpt.click();
      await page.waitForTimeout(300);
    }
  }
  const applyBtn = panel.getByRole('button', { name: 'Apply' });
  if (await applyBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await applyBtn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(3000);
  }
  console.log('Filter panel still visible after Apply:', await panel.isVisible({ timeout: 1000 }).catch(() => false));
  const bodyTextAfterFilter = await page.locator('body').innerText();
  console.log('Total Count line after filter:', (bodyTextAfterFilter.match(/Total Count\s*:\s*\d+/) || ['not found'])[0]);

  try {
    const [download2] = await Promise.all([
      page.waitForEvent('download', { timeout: 20000 }),
      downloadBtn.click(),
    ]);
    const suggested2 = download2.suggestedFilename();
    const savePath2 = require('path').join(__dirname, '..', '..', '..', 'test-results', `recon4_filtered_${suggested2}`);
    await download2.saveAs(savePath2);
    const stat2 = require('fs').statSync(savePath2);
    console.log('FILTERED download:', suggested2, 'size:', stat2.size, 'bytes');
    const buf2 = require('fs').readFileSync(savePath2);
    if (/\.(csv|txt|json)$/i.test(suggested2)) {
      const text = buf2.toString('utf8');
      console.log('First 600 chars:\n', text.slice(0, 600));
      const lines = text.split('\n').filter(Boolean);
      console.log('Total data lines (incl header):', lines.length);
    } else {
      console.log('Not a text format — first 16 bytes (hex):', buf2.subarray(0, 16).toString('hex'));
    }
  } catch (e) {
    console.log('Filtered download attempt failed:', e.message);
  }

  console.log('\n========== B. PLOT ADMIN — cascade via real fillLocationCascade() ==========');
  const pad = lastCreated.PAD;
  const padDashboard = await loginAsUser(page, pad.email, PASSWORD);
  const padUsers = new UserManagementPage(page);
  await padUsers.goto(padDashboard);
  await padUsers.openAddUserDialog();
  await padUsers.selectUserType('AGEL');
  await padUsers.selectUserRole('Execution Lead');

  // Peek Work Locations options BEFORE picking anything upstream, to compare
  // against what's offered AFTER the real cascade completes.
  const picked = await padUsers.fillLocationCascade();
  console.log('fillLocationCascade() picked:', JSON.stringify(picked));

  // Now re-open Work Locations to see the FULL option list (with picked ones checked)
  if (await padUsers.workLocationsDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
    await padUsers.workLocationsDropdown.click();
    await page.waitForTimeout(500);
    const lb = page.locator('[role="listbox"][data-state="open"]').first();
    const allOpts = await lb.locator('[role="option"]').allInnerTexts().catch(() => []);
    console.log('Work Locations FULL option list for Plot Admin (Execution Lead target role):', JSON.stringify(allOpts));
    await page.keyboard.press('Escape').catch(() => {});
  } else {
    console.log('Work Locations field still not visible after fillLocationCascade().');
  }

  await padUsers.closeDialog();
  await context.close();
});
