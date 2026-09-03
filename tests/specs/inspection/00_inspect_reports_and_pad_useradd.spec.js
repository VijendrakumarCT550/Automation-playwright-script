const { test } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const { loadLastCreatedUsers } = require('../../utils/user-counter-utils');
const UserManagementPage = require('../../pages/UserManagementPage');

// PURE RECON, round 2 — round 1 (00_inspect_online_role_extensive) left two
// real gaps: the Reports page's Download/Filter controls weren't found by
// generic selectors, and its own screenshot afterward showed the User
// Management page instead of the report — something about that navigation
// didn't do what the URL log claimed. Also: Plot Admin's Add User dialog
// showed NO location cascade fields at all for a hardcoded "Execution Lead"
// guess — need the REAL UserRole option list before picking one.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const lastCreated = loadLastCreatedUsers();

test('RECON round 2: Reports page real content + PAD Add User role list', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  console.log('\n========== A. REPORTS — isolated navigation ==========');
  const cad = lastCreated.CAD;
  const dashboard = await loginAsUser(page, cad.email, PASSWORD);
  await dashboard.goToDashboard();
  await dashboard.revealNavIfCollapsed('Dashboard');

  const reportsParent = dashboard.navItem('Reports');
  await reportsParent.click();
  await page.waitForTimeout(800);

  const rfiStatusReport = dashboard.navItem('RFI status report');
  await rfiStatusReport.waitFor({ state: 'visible', timeout: 5000 });
  await rfiStatusReport.click();

  // Log URL at several points without doing anything else in between.
  console.log('URL immediately after click:', page.url());
  await page.waitForTimeout(1000);
  console.log('URL +1s:', page.url());
  await page.waitForLoadState('networkidle').catch(() => {});
  console.log('URL after networkidle:', page.url());
  await page.waitForTimeout(2000);
  console.log('URL +2s more:', page.url());

  const bodyText = await page.locator('body').innerText().catch(e => `ERROR: ${e.message}`);
  console.log('Body text (first 800 chars):\n', bodyText.slice(0, 800));

  await page.screenshot({ path: 'test-results/recon2_reports_isolated.png', fullPage: false }).catch(() => {});

  // Dump the FULL page HTML (trimmed) so real selectors for Download/Filter
  // can be read directly instead of guessed.
  const fullHtml = await page.content().catch(e => `ERROR: ${e.message}`);
  console.log('Full page HTML length:', fullHtml.length);
  // Save to a file rather than the log — could be large.
  require('fs').writeFileSync('test-results/recon2_reports_page.html', fullHtml);
  console.log('Saved full HTML to test-results/recon2_reports_page.html');

  // If we really are on the report, look for anything icon-like near the top.
  const iconButtons = await page.locator('svg').evaluateAll(nodes =>
    nodes.slice(0, 40).map(n => ({ class: n.getAttribute('class'), parentTag: n.parentElement?.tagName, parentRole: n.parentElement?.getAttribute('role') }))
  ).catch(e => [`ERROR: ${e.message}`]);
  console.log('First 40 <svg> icons on the page (class / parent tag / parent role):');
  console.log(JSON.stringify(iconButtons, null, 1));

  console.log('\n========== B. PLOT ADMIN — real UserRole option list ==========');
  const pad = lastCreated.PAD;
  const padDashboard = await loginAsUser(page, pad.email, PASSWORD);
  const padUsers = new UserManagementPage(page);
  await padUsers.goto(padDashboard);
  await padUsers.openAddUserDialog();

  // AGEL first
  await padUsers.selectUserType('AGEL');
  const listbox1 = page.locator('[role="listbox"][data-state="open"]').first();
  await padUsers.userRoleDropdown.click();
  await page.waitForTimeout(500);
  const agelRoles = await listbox1.locator('[role="option"]').allInnerTexts().catch(() => []);
  console.log('PAD Add User -> UserType=AGEL -> UserRole options:', JSON.stringify(agelRoles));
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);

  // Pick the first non-Admin-looking role that isn't already known to skip
  // the cascade (Cluster Admin/Admin have none per WAMPage's own doc) — try
  // the whole list one at a time and log which fields appear for EACH, so
  // the real per-role cascade depth is confirmed rather than guessed once.
  for (const roleText of agelRoles) {
    const role = roleText.replace(/\s*✓\s*$/, '').trim();
    if (!role) continue;
    console.log(`\n--- Trying role "${role}" ---`);
    try {
      await padUsers.selectUserRole(role);
    } catch (e) {
      console.log(`  selectUserRole("${role}") failed: ${e.message}`);
      continue;
    }
    for (const [label, field] of [
      ['Cluster', padUsers.clusterDropdown], ['Sites', padUsers.sitesDropdown],
      ['Project type', padUsers.projectTypeDropdown], ['Work Locations', padUsers.workLocationsDropdown],
    ]) {
      const visible = await field.isVisible({ timeout: 2000 }).catch(() => false);
      if (!visible) { console.log(`  ${label}: not present`); continue; }
      await field.click().catch(() => {});
      await page.waitForTimeout(500);
      const lb = page.locator('[role="listbox"][data-state="open"]').first();
      const options = await lb.locator('[role="option"]').allInnerTexts().catch(() => []);
      console.log(`  ${label}: visible, options = ${JSON.stringify(options)}`);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  await padUsers.closeDialog();
  await context.close();
});
