const { test, expect } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const WAMPage = require('../pages/WAMPage');

// Tests WAM's PATCH/update semantics for every role — confirms REPLACING
// (or, for multi-assignee rows, ADDING to) an existing assignment
// actually persists, not just "can create from empty" (already covered
// by 13_wam_all_roles.spec.js/18_wam_hierarchy.spec.js) or "can clear"
// (25_wam_demapping.spec.js). Per app owner (2026-08-21):
//
// - Single-assignee Work Area roles (Execution Engineer/Quality
//   Inspector/Execution Lead/Quality Lead/Contractor Incharge/Contractor
//   Manager): "update" means selecting a DIFFERENT user, which replaces
//   whoever was there. WAMPage.selectDifferentWorkAreaUser() picks
//   whichever dropdown option isn't the current value, so this doesn't
//   need a second known bulk-created user of the same role. Restores the
//   original value afterward — exact and safe, since a single-select
//   pick always fully replaces (same reasoning 25_wam_demapping.spec.js
//   already relies on for its own restore step).
// - Multi-assignee Work Location/Site/Cluster roles (Plot Admin/Site
//   Admin/Cluster Admin): "update" means adding a new person ALONGSIDE
//   existing assignees, not replacing anyone — app owner's explicit
//   choice, since there's no single-person-replace action in this UI.
//   WAMPage.addAnyUnassignedUser() picks whichever option isn't already
//   selected. Deliberately targets these roles' ALREADY-populated,
//   already-shared rows (Khavda for Site Admin, Gujarat/KHAVDA for
//   Cluster Admin, A-06c for Plot Admin) specifically BECAUSE they
//   already have real existing assignees — proves "alongside existing
//   ones," which a fresh/empty row wouldn't demonstrate. Purely additive
//   (never removes anyone), so nothing needs restoring — same tolerance
//   for organic accumulation these rows already show from real
//   historical usage (confirmed live, several real named individuals
//   already present on some of them).
// - Project Manager is a special case, deliberately tested with the
//   single-assignee (replace) roles below instead of the multi-assignee
//   ones — confirmed live (2026-08-21) that its Work Location row is
//   actually single-select: adding a new person REPLACED the existing
//   one, twice, using the exact same addAssigneeToRow method already
//   proven reliable for genuinely multi-select rows (Plot Admin's row,
//   same tier/depth, holds 5+ names at once). A real, previously-
//   undocumented discrepancy between PM's and Plot Admin's row
//   behavior, not a bug in this spec.
const CLUSTER = ['Gujarat', 'Khavda'];
const SITE = 'Khavda';
const WORK_LOCATION = 'A-06c';
const PACKAGE = 'Civil';
const WORK_AREA = 'BL01';
const SITE_ROW_CANDIDATES = ['Khavda', 'KHAVDA'];
const CLUSTER_ROW_CANDIDATES = ['Gujarat', 'KHAVDA'];

const WORK_AREA_FILTERS = { cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE };

const SINGLE_ASSIGNEE_ROLES = [
  { role: 'Execution Engineer', rowLabel: WORK_AREA, filters: WORK_AREA_FILTERS },
  { role: 'Quality Inspector',  rowLabel: WORK_AREA, filters: WORK_AREA_FILTERS },
  { role: 'Execution Lead',     rowLabel: WORK_AREA, filters: WORK_AREA_FILTERS },
  { role: 'Quality Lead',       rowLabel: WORK_AREA, filters: WORK_AREA_FILTERS },
  { role: 'Contractor Incharge', rowLabel: WORK_AREA, filters: { ...WORK_AREA_FILTERS, serviceOrder: 'M S CHOUHAN INFRAVENTURES' } },
  { role: 'Contractor Manager',  rowLabel: WORK_AREA, filters: { ...WORK_AREA_FILTERS, serviceOrder: 'M S CHOUHAN INFRAVENTURES' } },
  { role: 'Project Manager',     rowLabel: WORK_LOCATION, filters: { cluster: CLUSTER, site: SITE } },
];

const MULTI_ASSIGNEE_ROLES = [
  { role: 'Plot Admin',    rowLabelCandidates: [WORK_LOCATION], filters: { cluster: CLUSTER, site: SITE } },
  { role: 'Site Admin',    rowLabelCandidates: SITE_ROW_CANDIDATES, filters: { cluster: CLUSTER } },
  { role: 'Cluster Admin', rowLabelCandidates: CLUSTER_ROW_CANDIDATES, filters: {} },
];

test.describe('WAM patch/update semantics for every role', () => {
  let context, page, dashboard;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, dashboard } = await adminFreshLogin(browser));
  });

  test.afterAll(async () => {
    await context.close();
  });

  for (const { role, rowLabel, filters } of SINGLE_ASSIGNEE_ROLES) {
    test(`Updating ${role}'s assignment (replace with a different user) persists`, async () => {
      test.setTimeout(10 * 60 * 1000);
      const wam = new WAMPage(page);
      const openAndFilter = () => wam.fillAssignmentFilters({ role, ...filters });

      await wam.goto(dashboard);
      await wam.openAddDetails();
      await openAndFilter();

      const original = await wam.getWorkAreaUserValue(rowLabel);
      expect(original, `precondition: ${role}'s row should already have an assignee`).not.toBe('');
      console.log(`${role} before update: ${rowLabel} = "${original}"`);

      const updated = await wam.selectDifferentWorkAreaUser(rowLabel, original);
      // Real edge case, not a failure: if the dropdown genuinely offers
      // only the current value with nothing else to switch to, there's
      // no "different user" to test an update against here.
      test.skip(updated === null, `No alternative user available for ${role} at ${rowLabel} — can't test update`);
      await expect(wam.getWorkAreaRow(rowLabel).locator('[role="combobox"]')).toContainText(updated);

      await wam.clickSubmit();
      await wam.closeDialog();
      await wam.openAddDetails();
      await openAndFilter();
      const afterUpdate = await wam.getWorkAreaUserValue(rowLabel);
      expect(afterUpdate, 'updated value should persist after reopening').toContain(updated);
      console.log(`${role} after update (persisted): ${rowLabel} = "${afterUpdate}"`);
      await wam.closeDialog();

      // Restore the original assignee — exact, since a single-select
      // pick always fully replaces.
      await wam.openAddDetails();
      await openAndFilter();
      await wam.selectWorkAreaUser(rowLabel, original);
      await wam.clickSubmit();
      await wam.closeDialog();
      await wam.openAddDetails();
      await openAndFilter();
      const restored = await wam.getWorkAreaUserValue(rowLabel);
      expect(restored, 'original value should be restored after persisting').toContain(original);
      await wam.closeDialog();

      console.log(`${role} restored: ${rowLabel} = "${restored}"`);
    });
  }

  for (const { role, rowLabelCandidates, filters } of MULTI_ASSIGNEE_ROLES) {
    test(`Updating ${role}'s row (adding a new assignee alongside existing ones) persists`, async () => {
      test.setTimeout(10 * 60 * 1000);
      const wam = new WAMPage(page);
      const openAndFilter = () => wam.fillAssignmentFilters({ role, ...filters });

      await wam.goto(dashboard);
      await wam.openAddDetails();
      await openAndFilter();

      const rowLabel = await wam.resolveRowLabel(rowLabelCandidates);
      const before = await wam.getWorkAreaUserValue(rowLabel);
      expect(before, `precondition: ${role}'s row should already have existing assignees`).not.toBe('');
      const existingNames = before.split(',').map(n => n.trim()).filter(Boolean);
      console.log(`${role} before update: ${rowLabel} = [${existingNames.join(', ')}]`);

      const added = await wam.addAnyUnassignedUser(rowLabel);
      // Real edge case, not a failure: if every possible person is
      // already assigned to this row, there's no one left to add.
      test.skip(added === null, `No unassigned user available for ${role} at ${rowLabel} — can't test update`);
      await wam.clickSubmit();
      await wam.closeDialog();
      await wam.openAddDetails();
      await openAndFilter();
      const after = await wam.getWorkAreaUserValue(rowLabel);
      for (const name of existingNames) {
        expect(after, `${role}: existing assignee "${name}" should still be present after update`).toContain(name);
      }
      expect(after, `${role}: newly-added assignee "${added}" should be present after update`).toContain(added);
      await wam.closeDialog();

      console.log(`${role} after update (persisted): ${rowLabel} = "${after}"`);
    });
  }
});
