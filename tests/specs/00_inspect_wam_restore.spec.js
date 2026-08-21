const { test, expect } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const WAMPage = require('../pages/WAMPage');

// THROWAWAY one-off repair — 26_wam_patch_update.spec.js's first run hit
// a real bug (Ark UI's checkmark-artifact on already-selected options,
// now fixed in WAMPage.js) that TOGGLED OFF existing multi-assignee row
// members instead of adding alongside them. Restores what that run
// destroyed, on shared rows 13_wam_all_roles.spec.js/18_wam_hierarchy.spec.js
// rely on:
// - Cluster Admin's own Gujarat/KHAVDA row: lost CADdckUser49 entirely
//   (wiped to empty).
// - Site Admin's own Khavda row: lost "Sachin Sane".
// - Project Manager's own A-06c row: lost PMxuxUser49 (replaced by
//   "Jithin M K", which is left in place — multi-select rows tolerate
//   more than one name, and removing it isn't necessary to restore what
//   was actually lost).
// Delete once this repair is confirmed to have run successfully.
const CLUSTER = ['Gujarat', 'Khavda'];
const SITE = 'Khavda';
const WORK_LOCATION = 'A-06c';
const CLUSTER_ROW_CANDIDATES = ['Gujarat', 'KHAVDA'];
const SITE_ROW_CANDIDATES = ['Khavda', 'KHAVDA'];

const lastCreated = loadLastCreatedUsers();
function requireUser(prefix) {
  const user = lastCreated[prefix];
  expect(user, `No last-created user recorded for prefix "${prefix}"`).toBeTruthy();
  return user;
}

test('REPAIR: restore WAM rows damaged by the checkmark-artifact bug', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const { context, page, dashboard } = await adminFreshLogin(browser);
  const wam = new WAMPage(page);

  await wam.goto(dashboard);

  // ---- Cluster Admin @ Gujarat/KHAVDA: already repaired in a prior run
  // of this same script — confirmed via that run's own log ("Cluster
  // Admin row after repair: CADdckUser49"). Skipped here to avoid
  // re-running it needlessly. ----

  // ---- Site Admin @ Khavda: re-add "Sachin Sane" ----
  await wam.openAddDetails();
  await wam.fillAssignmentFilters({ role: 'Site Admin', cluster: CLUSTER });
  const siteRowLabel = await wam.resolveRowLabel(SITE_ROW_CANDIDATES);
  console.log(`Site Admin row before repair: "${await wam.getWorkAreaUserValue(siteRowLabel)}"`);
  await wam.addAssigneeToRow(siteRowLabel, 'Sachin Sane');
  await wam.clickSubmit();
  await wam.closeDialog();

  await wam.openAddDetails();
  await wam.fillAssignmentFilters({ role: 'Site Admin', cluster: CLUSTER });
  const siteAfter = await wam.getWorkAreaUserValue(await wam.resolveRowLabel(SITE_ROW_CANDIDATES));
  expect(siteAfter, 'Site Admin repair should have restored Sachin Sane').toContain('Sachin Sane');
  console.log(`Site Admin row after repair: "${siteAfter}"`);
  await wam.closeDialog();

  // ---- Project Manager @ A-06c: re-add PMxuxUser49 ----
  const pm = requireUser('PM');
  await wam.openAddDetails();
  await wam.fillAssignmentFilters({ role: 'Project Manager', cluster: CLUSTER, site: SITE });
  console.log(`Project Manager row before repair: "${await wam.getWorkAreaUserValue(WORK_LOCATION)}"`);
  await wam.addAssigneeToRow(WORK_LOCATION, pm.name);
  await wam.clickSubmit();
  await wam.closeDialog();

  await wam.openAddDetails();
  await wam.fillAssignmentFilters({ role: 'Project Manager', cluster: CLUSTER, site: SITE });
  const pmAfter = await wam.getWorkAreaUserValue(WORK_LOCATION);
  expect(pmAfter, 'Project Manager repair should have restored PMxuxUser49').toContain(pm.name);
  console.log(`Project Manager row after repair: "${pmAfter}"`);
  await wam.closeDialog();

  await context.close();
  console.log('REPAIR DONE');
});
