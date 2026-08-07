const { test, expect } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const WAMPage = require('../pages/WAMPage');

// Assigns the most-recently-created user (tests/fixtures/last-created-
// users.json, written by 12_user_management.spec.js) for every role WAM
// supports, via My Assignment -> Add Details.
//
// WAM's OWN "Add Details" dialog has a role-dependent cascade depth, same
// as the Add User dialog does (confirmed live 2026-08) — and the row
// granularity that appears afterward shifts to match, exactly one level
// below wherever a given role's location scope stops:
//   Execution Engineer/Quality Inspector/Execution Lead/Quality Lead/
//     Contractor Incharge/Contractor Manager: Role->Cluster->Sites->Work
//     Location->Package(->Service Order for CI/CM) -> rows = WORK AREAS.
//   Project Manager/Plot Admin: Role->Cluster->Sites -> rows = WORK
//     LOCATIONS (not Work Areas).
//   Site Admin: Role->Cluster -> rows = SITES.
//   Cluster Admin: Role only, no location fields at all -> rows = CLUSTERS.
//   Admin: NOT a selectable option in WAM's Role dropdown at all (only 10
//     roles exist there; Contractor Manager/Incharge, Execution Engineer/
//     Quality Inspector, Execution Lead/Quality Lead, Project Manager,
//     Plot Admin, Site Admin, Cluster Admin — no "Admin") — there is no
//     WAM assignment to do for it, so it's excluded below rather than
//     guessed at.
//
// Work Area/Work Location/Site rows all use the exact same
// `div.d_grid` + exact-text pattern (WAMPage.getWorkAreaRow is already
// generic despite its name) — only the LABEL passed in differs by category.
//
// Site/Cluster/Work-Location-level rows allow MULTIPLE simultaneous
// assignees (confirmed live: Plot Admin's and Site Admin's rows already
// show several comma-separated names) — use WAMPage.addAssigneeToRow for
// those, which only ADDS the new user, never removing whoever's already
// there. Work Area rows are single-assignee — WAMPage.assignUserIfNeeded's
// existing replace-in-place behavior (a single-select combobox pick always
// replaces the current value) already satisfies "replace if mapped, add if
// not" with no changes needed there.
const CLUSTER = ['Gujarat', 'Khavda'];
const SITE = 'Khavda';
const PACKAGE = 'Civil';
const SERVICE_ORDER = 'M S CHOUHAN INFRAVENTURES';

// EE/QI/EL/QL/CIC/CM were all created (12_user_management.spec.js) with
// BOTH of these Work Locations — WAM's own Work Location field is
// single-select, so each needs its own separate fill->assign->submit pass
// (user-specified for CIC/CM; the same constraint applies to the other
// work-area-level roles for the same reason).
const WORK_LOCATIONS = ['A-06c', 'S05b'];
const WORK_AREAS = ['BL01', 'BL02', 'BL03', 'BL04', 'BL05'];

const WORK_AREA_ROLES = [
  { prefix: 'EE', role: 'Execution Engineer' },
  { prefix: 'QI', role: 'Quality Inspector' },
  { prefix: 'EL', role: 'Execution Lead' },
  { prefix: 'QL', role: 'Quality Lead' },
  { prefix: 'CIC', role: 'Contractor Incharge', serviceOrder: SERVICE_ORDER },
  { prefix: 'CM', role: 'Contractor Manager', serviceOrder: SERVICE_ORDER },
];

const WORK_LOCATION_ROW = 'A-06c';
const WORK_LOCATION_ROW_ROLES = [
  { prefix: 'PM', role: 'Project Manager' },
  { prefix: 'PAD', role: 'Plot Admin' },
];

const SITE_ROW = 'Khavda';
const SITE_ROW_ROLES = [
  { prefix: 'SAD', role: 'Site Admin' },
];

const CLUSTER_ROW = 'Gujarat';
const CLUSTER_ROW_ROLES = [
  { prefix: 'CAD', role: 'Cluster Admin' },
];

const lastCreated = loadLastCreatedUsers();

function requireCreatedUser(prefix) {
  const created = lastCreated[prefix];
  expect(created, `No last-created user recorded for prefix "${prefix}" in ` +
    'tests/fixtures/last-created-users.json — run 12_user_management.spec.js first').toBeTruthy();
  return created;
}

// The toast is NOT treated as the proof of success — confirmed live that
// large-payload Work Locations (e.g. A-06c, which has 85 total work-area
// rows, not just the 20 "BL0x" ones the original EE/QI/CI specs assumed)
// can make the PUT come back as a 502 with no toast at all, even though the
// user confirmed (checking the actual persisted assignment records) the
// write DOES go through server-side — it's the HTTP response round-trip
// that's flaky, not the underlying save. So an empty toast is only logged
// as a heads-up here; the real assertion is always the reopen-and-reverify
// step that follows this call at every call site.
function logSubmitToast(toastText, changed, context) {
  if (!toastText) {
    console.log(`${context}: no toast text (possible gateway/502 blip on a large payload) — ` +
      'verifying persisted state directly instead');
    return;
  }
  expect(toastText).toMatch(changed ? /assigned successfully/i : /no changes to save/i);
}

test.describe('Admin - WAM assignment for all created roles', () => {
  let context, page, dashboard;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, dashboard } = await adminFreshLogin(browser));
  });

  test.afterAll(async () => {
    await context.close();
  });

  for (const { prefix, role, serviceOrder } of WORK_AREA_ROLES) {
    for (const workLocation of WORK_LOCATIONS) {
      test(`Admin can assign ${role} (${prefix}) to work areas at ${workLocation}`, async () => {
        const created = requireCreatedUser(prefix);
        const wam = new WAMPage(page);
        await wam.goto(dashboard);
        await wam.openAddDetails();
        await wam.fillAssignmentFilters({
          role, cluster: CLUSTER, site: SITE, workLocation, package: PACKAGE, serviceOrder,
        });

        let anyChanged = false;
        for (const area of WORK_AREAS) {
          const changed = await wam.assignUserIfNeeded(area, created.name);
          anyChanged = anyChanged || changed;
        }
        for (const area of WORK_AREAS) {
          await expect(wam.getWorkAreaRow(area).locator('[role="combobox"]')).toContainText(created.name);
        }

        const toastText = await wam.clickSubmit();
        logSubmitToast(toastText, anyChanged, `${role} at ${workLocation}`);

        // Reopen fresh and reselect the same filters to confirm the
        // mapping persisted server-side, not just held in form state.
        await wam.closeDialog();
        await wam.openAddDetails();
        await wam.fillAssignmentFilters({
          role, cluster: CLUSTER, site: SITE, workLocation, package: PACKAGE, serviceOrder,
        });
        for (const area of WORK_AREAS) {
          const value = await wam.getWorkAreaUserValue(area);
          expect(value).toContain(created.name);
        }
        await wam.closeDialog();

        console.log(`${role} "${created.name}" assigned to ${workLocation}: ${WORK_AREAS.join(', ')}`);
      });
    }
  }

  for (const { prefix, role } of WORK_LOCATION_ROW_ROLES) {
    test(`Admin can assign ${role} (${prefix}) at Work Location ${WORK_LOCATION_ROW}`, async () => {
      const created = requireCreatedUser(prefix);
      const wam = new WAMPage(page);
      await wam.goto(dashboard);
      await wam.openAddDetails();
      await wam.fillAssignmentFilters({ role, cluster: CLUSTER, site: SITE });

      const changed = await wam.addAssigneeToRow(WORK_LOCATION_ROW, created.name);
      await expect(wam.getWorkAreaRow(WORK_LOCATION_ROW).locator('[role="combobox"]')).toContainText(created.name);

      const toastText = await wam.clickSubmit();
      logSubmitToast(toastText, changed, `${role} at Work Location ${WORK_LOCATION_ROW}`);

      await wam.closeDialog();
      await wam.openAddDetails();
      await wam.fillAssignmentFilters({ role, cluster: CLUSTER, site: SITE });
      const value = await wam.getWorkAreaUserValue(WORK_LOCATION_ROW);
      expect(value).toContain(created.name);
      await wam.closeDialog();

      console.log(`${role} "${created.name}" assigned at Work Location ${WORK_LOCATION_ROW}`);
    });
  }

  for (const { prefix, role } of SITE_ROW_ROLES) {
    test(`Admin can assign ${role} (${prefix}) at Site ${SITE_ROW}`, async () => {
      const created = requireCreatedUser(prefix);
      const wam = new WAMPage(page);
      await wam.goto(dashboard);
      await wam.openAddDetails();
      await wam.fillAssignmentFilters({ role, cluster: CLUSTER });

      const changed = await wam.addAssigneeToRow(SITE_ROW, created.name);
      await expect(wam.getWorkAreaRow(SITE_ROW).locator('[role="combobox"]')).toContainText(created.name);

      const toastText = await wam.clickSubmit();
      logSubmitToast(toastText, changed, `${role} at Site ${SITE_ROW}`);

      await wam.closeDialog();
      await wam.openAddDetails();
      await wam.fillAssignmentFilters({ role, cluster: CLUSTER });
      const value = await wam.getWorkAreaUserValue(SITE_ROW);
      expect(value).toContain(created.name);
      await wam.closeDialog();

      console.log(`${role} "${created.name}" assigned at Site ${SITE_ROW}`);
    });
  }

  for (const { prefix, role } of CLUSTER_ROW_ROLES) {
    test(`Admin can assign ${role} (${prefix}) at Cluster ${CLUSTER_ROW}`, async () => {
      const created = requireCreatedUser(prefix);
      const wam = new WAMPage(page);
      await wam.goto(dashboard);
      await wam.openAddDetails();
      await wam.fillAssignmentFilters({ role });

      const changed = await wam.addAssigneeToRow(CLUSTER_ROW, created.name);
      await expect(wam.getWorkAreaRow(CLUSTER_ROW).locator('[role="combobox"]')).toContainText(created.name);

      const toastText = await wam.clickSubmit();
      logSubmitToast(toastText, changed, `${role} at Cluster ${CLUSTER_ROW}`);

      await wam.closeDialog();
      await wam.openAddDetails();
      await wam.fillAssignmentFilters({ role });
      const value = await wam.getWorkAreaUserValue(CLUSTER_ROW);
      expect(value).toContain(created.name);
      await wam.closeDialog();

      console.log(`${role} "${created.name}" assigned at Cluster ${CLUSTER_ROW}`);
    });
  }
});
