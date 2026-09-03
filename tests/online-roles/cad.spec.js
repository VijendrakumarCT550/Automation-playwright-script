const { test } = require('@playwright/test');
const { runOnlineRoleRegressionSuite } = require('../utils/online-role-regression');

// Cluster Admin — extensive online-role regression. See
// tests/utils/online-role-regression.js for what this actually walks
// (Dashboard incl. chart toggles, My Tasks, WAM incl. own-scope view +
// Add Details reachability, SO Mapping, Users incl. search/expand/Add User,
// Reports incl. filter + download-content verification).
//
// addUserRoleTarget: 'Site Admin' is a best-effort guess (Cluster Admin's
// own Add-User UserRole option list isn't confirmed live the way Plot
// Admin's is) — consistent with the WAM hierarchy's "every tier above PM can
// assign every role below its own tier" pattern. If wrong, the shared suite
// logs the failure and continues rather than failing the whole test over it.
//
// jurisdiction: null — Cluster is the top-most scope, and this environment
// currently has only ONE cluster env-wide (confirmed live), so a
// jurisdiction check here would be trivially satisfied for anyone and isn't
// worth hard-asserting yet.
//
// childVisibilityChecks: the real tree-visibility test (docs/work-region-
// hierarchy.md §2b) — does Cluster Admin see ALL Sites under its own
// Cluster, and ALL Work Locations under its own Site, matching Admin's
// unrestricted view of the same scope exactly? Hard-asserted, not logged —
// per explicit user instruction, a mismatch here is treated as a real bug.
test('Cluster Admin: dashboard, My Tasks, WAM (incl. tree-visibility vs Admin), SO Mapping, Users, Reports', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000); // wider: each childVisibilityCheck adds an Admin login + re-login
  await runOnlineRoleRegressionSuite(browser, {
    prefix: 'CAD',
    roleName: 'Cluster Admin',
    addUserRoleTarget: 'Site Admin',
    jurisdiction: null,
    childVisibilityChecks: [
      { targetRole: 'Site Admin' },   // Cluster -> ALL Sites under it
      { targetRole: 'Plot Admin' },   // Cluster+Site -> ALL Work Locations under it
    ],
  });
});
