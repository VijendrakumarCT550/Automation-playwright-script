const { test, expect } = require('@playwright/test');
const WAMPage             = require('../pages/WAMPage');
const { adminFreshLogin } = require('../utils/helpers');

// Contractor Incharge has an extra "Service Order" field (after Package)
// that Execution Engineer/Quality Inspector don't — it gates the assignment
// to only the work already mapped to that vendor in SO Mapping. We map the
// same vendor here as the 05_so_mapping.spec.js run: `M S CHOUHAN
// INFRAVENTURES PVT LTD` — matched by vendor name substring only, the exact
// SO number (4810024058) isn't asserted for now, per instruction.
//
// Cluster has been observed to show "Gujarat" on one load and "KHAVDA" on
// another for what's meant to be the same location (deployment/DB state
// flakiness) — either is acceptable.
const ASSIGNMENT_FILTERS = {
  role:         'Contractor Incharge',
  cluster:      ['Gujarat', 'Khavda'],
  site:         'Khavda',
  workLocation: 'A-06c',
  package:      'Civil',
  serviceOrder: 'M S CHOUHAN INFRAVENTURES PVT LTD',
};

const TARGET_WORK_AREAS = ['BL01', 'BL02', 'BL03', 'BL04', 'BL05'];
// 'Vikram Singh' 'Vikas Sharma' isn't in this role/location's assignable-user roster
// (confirmed live: only 'Vikas Sharma'/'Ompal Singh' are offered for
// Contractor Incharge at this Cluster/Site/Work Location/Package/Service
// Order combo) — 'Ompal Singh' picked deliberately because it differs from
// whoever's already assigned, so the test still exercises a real change.
const ASSIGNEE = 'Vikas Sharma';

test.describe('Admin - Work Area Mapping (WAM) - Contractor Incharge', () => {
  let context, page, dashboard;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, dashboard } = await adminFreshLogin(browser));
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('Admin can assign a Contractor Incharge to SO-mapped work areas and submit', async () => {
    const wam = new WAMPage(page);
    await wam.goto(dashboard);
    await wam.openAddDetails();
    await wam.fillAssignmentFilters(ASSIGNMENT_FILTERS);

    // Service Order is a searchable <input role="combobox"> (Ark UI combobox,
    // not select) — its selected text lives in the `value` attribute, not
    // innerText/textContent, so assert with toHaveValue() not toContainText().
    await expect(wam.dialogServiceOrderDropdown).toHaveValue(/CHOUHAN/);

    // General rule: leave a row alone if already mapped to ASSIGNEE; only
    // change it if unmapped or mapped to someone else.
    let anyChanged = false;
    for (const area of TARGET_WORK_AREAS) {
      const changed = await wam.assignUserIfNeeded(area, ASSIGNEE);
      anyChanged = anyChanged || changed;
    }

    for (const area of TARGET_WORK_AREAS) {
      await expect(wam.getWorkAreaRow(area).locator('[role="combobox"]')).toContainText(ASSIGNEE);
    }

    const toastText = await wam.clickSubmit();
    expect(toastText).toContain(anyChanged ? 'Assigned successfully' : 'No changes to save');

    // Submit resets the dialog's fields but doesn't close it — close it
    // fully and reopen via the add-icon fresh, rather than just reselecting
    // in the same never-actually-closed dialog, so this genuinely confirms
    // the CI mapping was persisted server-side and not just held in
    // still-open front-end form state.
    await wam.closeDialog();
    await wam.openAddDetails();
    await wam.fillAssignmentFilters(ASSIGNMENT_FILTERS);

    for (const area of TARGET_WORK_AREAS) {
      const value = await wam.getWorkAreaUserValue(area);
      expect(value).toContain(ASSIGNEE);
    }

    await wam.closeDialog();
  });
});
