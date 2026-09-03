const { test } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const { loadLastCreatedUsers } = require('../../utils/user-counter-utils');
const DashboardPage = require('../../pages/DashboardPage');
const MyTasksPage = require('../../pages/MyTasksPage');
const WAMPage = require('../../pages/WAMPage');
const SOMappingPage = require('../../pages/SOMappingPage');
const UserManagementPage = require('../../pages/UserManagementPage');

// PURE RECON — no assertions. Dumps real DOM/behavior for everything the
// planned per-role extensive regression specs need but isn't confirmed yet:
// chart RFI/NC toggles, WAM's "My Assignment" view-own-scope results, Users
// card expand/collapse, Reports filter+download mechanics (incl. file
// format), and Plot Admin's Add User dialog location-jurisdiction scoping.
// Logged in as CAD (widest of the 7 roles) for everything except the last
// section, which specifically needs Plot Admin.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const lastCreated = loadLastCreatedUsers();

test('RECON: dashboard toggles, WAM view panel, Users expand, Reports, PAD jurisdiction', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  const cad = lastCreated.CAD;
  const dashboard = await loginAsUser(page, cad.email, PASSWORD);
  await dashboard.goToDashboard();

  console.log('\n========== 1. DASHBOARD CHART TOGGLES ==========');
  for (const title of ['TAT Summary', 'Trend Analysis']) {
    const card = page.locator('div').filter({ hasText: new RegExp(`^${title}`) }).first();
    const html = await card.evaluate(el => el.outerHTML.slice(0, 1500)).catch(e => `ERROR: ${e.message}`);
    console.log(`--- ${title} card (first 1500 chars) ---\n${html}\n`);
  }

  console.log('\n========== 2. MY TASKS (RFI + NC tabs) ==========');
  const myTasks = new MyTasksPage(page);
  await dashboard.goToMyTasks();
  await myTasks.waitForTasksReady().catch(e => console.log('waitForTasksReady:', e.message));
  console.log('My Tasks URL:', page.url());
  for (const tabName of ['RFI', 'NC']) {
    const tab = tabName === 'RFI' ? myTasks.rfiTab : myTasks.ncTab;
    if (await tab.isVisible().catch(() => false)) {
      await tab.click();
      await page.waitForTimeout(1500);
    }
    const others = await myTasks.pendingWithOthersTile.isVisible().catch(() => false);
    const approved = await myTasks.approvedTile.isVisible().catch(() => false);
    const withMe = await myTasks.pendingWithMeTile.isVisible().catch(() => false);
    const createBtn = await myTasks.createRFIButton.isVisible().catch(() => false);
    console.log(`[${tabName}] Pending with me: ${withMe}, Pending with others: ${others}, Approved: ${approved}, Create button: ${createBtn}`);
    if (others) console.log(`[${tabName}] Pending with others count: ${await myTasks.getTileCount(myTasks.pendingWithOthersTile)}`);
    if (approved) console.log(`[${tabName}] Approved count: ${await myTasks.getTileCount(myTasks.approvedTile)}`);
  }

  console.log('\n========== 3. WAM — My Assignment (view own scope) ==========');
  const wam = new WAMPage(page);
  await wam.goto(dashboard);
  // NOTE: this recon's own finding (see below) led to viewRoleField being
  // REMOVED from WAMPage.js — it was never a real combobox, just read-only
  // text (see WAMPage.js's viewClusterField comment). Kept here as
  // ownRoleVisible() so this historical recon script still runs if replayed.
  const roleFieldText = await wam.ownRoleVisible('Cluster Admin').catch(e => `ERROR: ${e.message}`);
  console.log('own role "Cluster Admin" visible on WAM page:', roleFieldText);
  for (const [label, field] of [['Cluster', wam.viewClusterField], ['Sites', wam.viewSitesField], ['Work Location', wam.viewWorkLocationField]]) {
    const visible = await field.isVisible().catch(() => false);
    console.log(`viewFilter "${label}" visible: ${visible}`);
  }
  // Try filling Cluster if visible, see what appears
  if (await wam.viewClusterField.isVisible().catch(() => false)) {
    await wam.viewClusterField.click();
    await page.waitForTimeout(500);
    const listbox = page.locator('[role="listbox"][data-state="open"]').first();
    const options = await listbox.locator('[role="option"]').allInnerTexts().catch(() => []);
    console.log('viewClusterField options:', JSON.stringify(options));
    if (options.length) {
      await listbox.locator('[role="option"]').first().click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(1000);
      const bodyDump = await page.locator('body').evaluate(el => el.innerText.slice(0, 2000));
      console.log('Page text after picking first Cluster (first 2000 chars):\n', bodyDump);
    }
  }
  console.log('Add-assignment icon visible:', await wam.addAssignmentIcon.isVisible().catch(() => false));

  console.log('\n========== 4. SO MAPPING (visibility only) ==========');
  const so = new SOMappingPage(page);
  await so.goto(dashboard);
  console.log('SO Mapping empty-state hint visible:', await so.emptyStateHint.isVisible().catch(() => false));
  for (const [label, field] of [
    ['Cluster', so.clusterDropdown], ['Site', so.siteDropdown], ['Project Type', so.projectTypeDropdown],
    ['Work Location', so.workLocationDropdown], ['Work Area', so.workAreaDropdown], ['Package', so.packageDropdown],
  ]) {
    console.log(`SO Mapping field "${label}" visible: ${await field.isVisible().catch(() => false)}`);
  }

  console.log('\n========== 5. USERS — search, expand/collapse, Add User dialog ==========');
  const users = new UserManagementPage(page);
  await users.goto(dashboard);
  console.log('Search input visible:', await users.searchInput.isVisible().catch(() => false));
  console.log('Add user icon visible:', await users.addUserIcon.isVisible().catch(() => false));

  // Dump the first two user "cards" as rendered, to find the expand/collapse trigger
  const cardsHtml = await page.locator('body').evaluate(() => {
    const nodes = Array.from(document.querySelectorAll('*')).filter(el =>
      el.textContent && el.textContent.includes('Personnel Name') && el.children.length < 30
    );
    // Grab the smallest ~2 matching containers (least nested = most specific card)
    nodes.sort((a, b) => a.textContent.length - b.textContent.length);
    return nodes.slice(0, 2).map(el => el.outerHTML.slice(0, 2000));
  }).catch(e => [`ERROR: ${e.message}`]);
  cardsHtml.forEach((h, i) => console.log(`--- user card candidate ${i} ---\n${h}\n`));

  // Try clicking a likely chevron/expand icon on the first result and see if new text appears
  const beforeText = await page.locator('body').innerText();
  const chevron = page.locator('svg[class*="chevron"], button[aria-expanded]').first();
  if (await chevron.isVisible().catch(() => false)) {
    await chevron.click();
    await page.waitForTimeout(500);
    const afterText = await page.locator('body').innerText();
    console.log('Chevron click changed page text length:', beforeText.length, '->', afterText.length);
  } else {
    console.log('No chevron/aria-expanded control found near top of Users list.');
  }

  await users.openAddUserDialog().catch(e => console.log('openAddUserDialog failed:', e.message));
  console.log('Add User dialog visible:', await users.dialog.isVisible().catch(() => false));
  await users.closeDialog();

  console.log('\n========== 6. REPORTS ==========');
  await dashboard.revealNavIfCollapsed('Dashboard');
  const reportsParent = dashboard.navItem('Reports');
  console.log('Reports nav item visible:', await reportsParent.isVisible().catch(() => false));
  await reportsParent.click().catch(() => {});
  await page.waitForTimeout(800);
  const rfiStatusReport = dashboard.navItem('RFI status report');
  console.log('RFI status report sub-item visible after expand:', await rfiStatusReport.isVisible().catch(() => false));
  if (await rfiStatusReport.isVisible().catch(() => false)) {
    await rfiStatusReport.click();
    await page.waitForLoadState('networkidle').catch(() => {});
    console.log('Reports page URL:', page.url());

    // Dump top-of-page controls (filter icon, download button)
    const controlsHtml = await page.locator('body').evaluate(() => {
      const header = document.querySelector('h1, h2, [class*="header"]');
      return header ? header.parentElement?.outerHTML.slice(0, 2000) : 'no header found';
    }).catch(e => `ERROR: ${e.message}`);
    console.log('Top-of-page controls HTML (first 2000 chars):\n', controlsHtml);

    const downloadBtn = page.getByRole('button', { name: /download/i }).first();
    console.log('Download button visible:', await downloadBtn.isVisible().catch(() => false));

    const filterIcon = page.locator('svg[class*="filter"], button:has-text("Filter")').first();
    console.log('Filter icon/button visible:', await filterIcon.isVisible().catch(() => false));
    if (await filterIcon.isVisible().catch(() => false)) {
      await filterIcon.click();
      await page.waitForTimeout(800);
      const filterPanelHtml = await page.locator('[data-scope="dialog"][data-part="content"], [role="dialog"]').first()
        .evaluate(el => el.outerHTML.slice(0, 3000)).catch(e => `ERROR: ${e.message}`);
      console.log('Filter panel HTML (first 3000 chars):\n', filterPanelHtml);
    }

    // Try the download itself
    if (await downloadBtn.isVisible().catch(() => false)) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 15000 }),
          downloadBtn.click(),
        ]);
        const suggested = download.suggestedFilename();
        const savePath = require('path').join(__dirname, '..', '..', '..', 'test-results', `recon_${suggested}`);
        await download.saveAs(savePath);
        console.log('Downloaded file:', suggested, '-> saved to', savePath);
        const stat = require('fs').statSync(savePath);
        console.log('File size (bytes):', stat.size);
        // Peek at the first bytes to guess format
        const buf = require('fs').readFileSync(savePath);
        console.log('First 8 bytes (hex):', buf.subarray(0, 8).toString('hex'));
        if (suggested.endsWith('.csv') || suggested.endsWith('.txt')) {
          console.log('First 500 chars of content:\n', buf.toString('utf8').slice(0, 500));
        }
      } catch (e) {
        console.log('Download attempt failed:', e.message);
      }
    }
  }

  await page.screenshot({ path: 'test-results/recon_reports_page.png', fullPage: true }).catch(() => {});

  console.log('\n========== 7. PLOT ADMIN — Add User jurisdiction scoping ==========');
  const pad = lastCreated.PAD;
  const padDashboard = await loginAsUser(page, pad.email, PASSWORD);
  const padUsers = new UserManagementPage(page);
  await padUsers.goto(padDashboard);
  console.log('PAD Add user icon visible:', await padUsers.addUserIcon.isVisible().catch(() => false));
  await padUsers.openAddUserDialog().catch(e => console.log('PAD openAddUserDialog failed:', e.message));
  await padUsers.selectUserType('AGEL').catch(e => console.log('selectUserType failed:', e.message));
  await padUsers.selectUserRole('Execution Lead').catch(e => console.log('selectUserRole failed:', e.message));

  for (const [label, field] of [
    ['Cluster', padUsers.clusterDropdown], ['Sites', padUsers.sitesDropdown], ['Work Locations', padUsers.workLocationsDropdown],
  ]) {
    const visible = await field.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`PAD Add User field "${label}" visible: ${visible}`);
    if (visible) {
      await field.click().catch(() => {});
      await page.waitForTimeout(500);
      const listbox = page.locator('[role="listbox"][data-state="open"]').first();
      const options = await listbox.locator('[role="option"]').allInnerTexts().catch(() => []);
      console.log(`PAD Add User field "${label}" options:`, JSON.stringify(options));
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
  }
  await padUsers.closeDialog();

  await context.close();
});
