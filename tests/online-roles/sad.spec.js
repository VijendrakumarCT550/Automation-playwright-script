const { test } = require('@playwright/test');
const { runOnlineRoleRegressionSuite } = require('../utils/online-role-regression');

// Site Admin — extensive online-role regression. See
// tests/utils/online-role-regression.js for the full sweep this runs.
//
// addUserRoleTarget: 'Plot Admin' is a best-effort guess, same reasoning as
// cad.spec.js's 'Site Admin' guess — Site Admin's own Add-User UserRole list
// isn't confirmed live.
//
// jurisdiction: null — Site-level scoping for the Add User dialog isn't
// confirmed live the way Plot Admin's Work-Location-level scoping is;
// logged, not asserted. The ANALOGOUS check for WAM's own tree visibility
// IS hard-asserted below, via childVisibilityChecks.
//
// childVisibilityChecks: the exact scenario the user asked about — if Site
// Admin is mapped to Site Khavda, are ALL Work Locations under Khavda
// visible in their own WAM scope, matching Admin's unrestricted view of the
// same Site? Hard-asserted per explicit instruction.
test('Site Admin: dashboard, My Tasks, WAM (incl. tree-visibility vs Admin), SO Mapping, Users, Reports', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000); // wider: the childVisibilityCheck adds an Admin login + re-login
  await runOnlineRoleRegressionSuite(browser, {
    prefix: 'SAD',
    roleName: 'Site Admin',
    addUserRoleTarget: 'Plot Admin',
    jurisdiction: null,
    childVisibilityChecks: [
      { targetRole: 'Plot Admin' }, // Site -> ALL Work Locations under it
    ],
  });
});
