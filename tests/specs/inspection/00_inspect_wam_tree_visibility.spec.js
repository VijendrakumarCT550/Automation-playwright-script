const { test } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const { loadLastCreatedUsers } = require('../../utils/user-counter-utils');
const WAMPage = require('../../pages/WAMPage');

// PURE RECON — investigating a real gap flagged by the user: does the
// online-role-regression suite's WAM section actually verify that a role
// sees ALL child entities under their own WAM scope (per
// docs/work-region-hierarchy.md §2b: "WAM restricts the tree to only what
// the logged-in user is mapped to" — a Site Admin mapped to Site Khavda
// should see ALL Work Locations under Khavda, not just one)? The existing
// check only confirmed the Cluster/Site FIELD resolves to a value, never
// that the full child set is exposed. This checks two things:
//   1. What does the "My Assignment" VIEW panel actually show after Cluster
//      resolves for Cluster Admin — round-1 recon saw a mystery "20" appear
//      after picking Cluster and never followed up on what it is.
//   2. In the "Add Details" dialog (used to assign OTHER users), does
//      picking a subordinate role reveal ALL the Work Locations/Sites under
//      the logged-in admin's own scope, or a restricted subset?
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const lastCreated = loadLastCreatedUsers();

test('RECON: WAM tree-visibility — does an admin role see ALL children under its own scope?', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  console.log('\n========== A. CLUSTER ADMIN — what does "20" mean? ==========');
  const cad = lastCreated.CAD;
  const dashboard = await loginAsUser(page, cad.email, PASSWORD);
  const wam = new WAMPage(page);
  await wam.goto(dashboard);

  // Fill the view-own cascade for real and dump EVERYTHING that appears.
  await wam.viewOwnAssignments({ cluster: ['KHAVDA', 'Gujarat', 'Khavda'] });
  await page.waitForTimeout(1000);
  const fullBodyText = await page.locator('body').innerText();
  console.log('Full page text after Cluster resolves (My Assignment panel):\n', fullBodyText);

  // Is there a table/grid rendered anywhere?
  const gridRows = await page.locator('div.d_grid, [role="row"], table tr').count();
  console.log('div.d_grid / [role=row] / table tr count on page:', gridRows);

  console.log('\n--- CAD: Add Details dialog -> Role=Site Admin -> what SITE rows appear? ---');
  await wam.openAddDetails();
  await wam.fillAssignmentFilters({ role: 'Site Admin' });
  const siteRowLabels = await wam.dialog.locator('div.d_grid').allInnerTexts().catch(() => []);
  console.log('Site Admin target rows (should be Sites under CAD\'s own Cluster):', JSON.stringify(siteRowLabels.map(t => t.split('\n')[0])));
  await wam.closeDialog();

  console.log('\n--- CAD: Add Details dialog -> Role=Plot Admin -> what WORK LOCATION rows appear? ---');
  await wam.openAddDetails();
  // site must be a plain string here — fillAssignmentFilters' `site` param
  // does NOT support an array of candidates (only `cluster`/`serviceOrder`
  // do); every existing caller in this suite already passes a plain string.
  await wam.fillAssignmentFilters({ role: 'Plot Admin', cluster: ['KHAVDA', 'Gujarat', 'Khavda'], site: 'KHAVDA' });
  const workLocRowsForCAD = await wam.dialog.locator('div.d_grid').allInnerTexts().catch(() => []);
  console.log(`Plot Admin target rows under CAD's own scope (${workLocRowsForCAD.length} total):`, JSON.stringify(workLocRowsForCAD.map(t => t.split('\n')[0])));
  await wam.closeDialog();

  console.log('\n========== B. SITE ADMIN — does its own scope show ALL Work Locations under Khavda? ==========');
  const sad = lastCreated.SAD;
  const sadDashboard = await loginAsUser(page, sad.email, PASSWORD);
  const sadWam = new WAMPage(page);
  await sadWam.goto(sadDashboard);

  // View panel: does a Work Location field even appear for Site Admin?
  const viewResult = await sadWam.viewOwnAssignments({ cluster: ['KHAVDA', 'Gujarat', 'Khavda'], site: ['Khavda', 'KHAVDA'], workLocation: ['A-06c'] });
  console.log('SAD viewOwnAssignments result:', JSON.stringify(viewResult));
  const sadViewWorkLocVisible = await sadWam.viewWorkLocationField.isVisible({ timeout: 3000 }).catch(() => false);
  console.log('SAD view-panel Work Location field visible:', sadViewWorkLocVisible);
  if (sadViewWorkLocVisible) {
    const options = await sadWam.getDropdownOptions(sadWam.viewWorkLocationField);
    console.log('SAD view-panel Work Location FULL option list:', JSON.stringify(options));
  }
  const sadBodyText = await page.locator('body').innerText();
  console.log('SAD full page text after own-scope cascade:\n', sadBodyText.slice(0, 1500));

  console.log('\n--- SAD: Add Details dialog -> Role=Plot Admin -> what WORK LOCATION rows appear? ---');
  await sadWam.openAddDetails();
  await sadWam.fillAssignmentFilters({ role: 'Plot Admin' });
  const workLocRowsForSAD = await sadWam.dialog.locator('div.d_grid').allInnerTexts().catch(() => []);
  console.log(`Plot Admin target rows under SAD's own Site (${workLocRowsForSAD.length} total):`, JSON.stringify(workLocRowsForSAD.map(t => t.split('\n')[0])));
  await sadWam.closeDialog();

  console.log('\n--- SAD: Add Details dialog -> Role=Execution Lead -> what WORK AREA rows appear (which Work Location do they belong to)? ---');
  await sadWam.openAddDetails();
  await sadWam.fillAssignmentFilters({ role: 'Execution Lead', workLocation: 'A-06c' });
  const workAreaRowsForSAD = await sadWam.dialog.locator('div.d_grid').allInnerTexts().catch(() => []);
  console.log(`Execution Lead target rows under SAD's Work Location A-06c (${workAreaRowsForSAD.length} total, first 10):`, JSON.stringify(workAreaRowsForSAD.slice(0, 10).map(t => t.split('\n')[0])));
  // Does SAD's dialog even offer OTHER Work Locations besides A-06c?
  const availableWorkLocs = await sadWam.dialogWorkLocationDropdown.isVisible({ timeout: 2000 }).catch(() => false);
  if (availableWorkLocs) {
    const wlOptions = await sadWam.getDropdownOptions(sadWam.dialogWorkLocationDropdown);
    console.log('SAD Add-Details dialog Work Location dropdown FULL options:', JSON.stringify(wlOptions));
  }
  await sadWam.closeDialog();

  await context.close();
});
