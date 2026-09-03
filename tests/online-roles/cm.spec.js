const { test } = require('@playwright/test');
const { runOnlineRoleRegressionSuite } = require('../utils/online-role-regression');

// Contractor Manager — extensive online-role regression. See
// tests/utils/online-role-regression.js for the full sweep this runs.
//
// Contractor Manager is the one role in this suite that is VENDOR-type
// (not AGEL) — confirmed in tests/fixtures/last-created-users.json. It still
// gets the same Dashboard/My Tasks/WAM/Users/Reports sweep as the AGEL
// hierarchy roles (same 5-item left-hand menu confirmed live in
// [[project_hierarchy_dashboard_menu_feature]]).
//
// addUserRoleTarget: null — same reasoning as el.spec.js: Contractor
// Manager's own WAM authority is to assign Contractor In-Charge, but whether
// Add User is active for this tier at all is unconfirmed, and CIC is itself
// VENDOR-type (a different UserType branch than this suite drives).
test('Contractor Manager: dashboard, My Tasks, WAM, Users, Reports — full sweep', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  await runOnlineRoleRegressionSuite(browser, {
    prefix: 'CM',
    roleName: 'Contractor Manager',
    addUserRoleTarget: null,
    jurisdiction: null,
  });
});
