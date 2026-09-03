const { test } = require('@playwright/test');
const { runOnlineRoleRegressionSuite } = require('../utils/online-role-regression');

// Project Manager — extensive online-role regression. See
// tests/utils/online-role-regression.js for the full sweep this runs.
//
// addUserRoleTarget: null, deliberately — unlike Cluster/Site/Plot Admin,
// whether Project Manager's Add User icon is even ACTIVE/functional at all
// is unconfirmed live (only Cluster Admin's and Plot Admin's own Add User
// dialogs have been opened during recon). The shared suite still checks and
// logs whether the icon is visible; this just avoids guessing a UserRole
// target for a dialog that hasn't been confirmed to open the same way for
// this tier.
// childVisibilityChecks: the same tree-visibility rule (docs/work-region-
// hierarchy.md §2b), one level down — does Project Manager see ALL Work
// Areas under its own Work Location (A-06c, per 18_wam_hierarchy.spec.js's
// established WORK_LOCATION constant — PM's own WAM mapping there), matching
// Admin's unrestricted view of the same Work Location? Hard-asserted.
test('Project Manager: dashboard, My Tasks, WAM (incl. tree-visibility vs Admin), Users, Reports', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000); // wider: the childVisibilityCheck adds an Admin login + re-login
  await runOnlineRoleRegressionSuite(browser, {
    prefix: 'PM',
    roleName: 'Project Manager',
    addUserRoleTarget: null,
    jurisdiction: null,
    childVisibilityChecks: [
      { targetRole: 'Execution Lead', extraCascade: { workLocation: 'A-06c' } }, // Work Location -> ALL Work Areas under it
    ],
  });
});
