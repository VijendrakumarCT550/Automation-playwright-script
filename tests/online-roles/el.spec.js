const { test } = require('@playwright/test');
const { runOnlineRoleRegressionSuite } = require('../utils/online-role-regression');

// Execution Lead — extensive online-role regression. See
// tests/utils/online-role-regression.js for the full sweep this runs.
//
// addUserRoleTarget: null — same reasoning as pm.spec.js. Execution Lead's
// own WAM authority (per [[project_wam_hierarchy_all_roles]]) is to assign
// Execution Engineer + Contractor Manager, but whether it can also CREATE
// user accounts (Add User) at all is unconfirmed, and Contractor Manager in
// particular is a VENDOR-type role needing a different UserType branch than
// the AGEL one this suite drives — not worth guessing blind.
test('Execution Lead: dashboard, My Tasks, WAM, Users, Reports — full sweep', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  await runOnlineRoleRegressionSuite(browser, {
    prefix: 'EL',
    roleName: 'Execution Lead',
    addUserRoleTarget: null,
    jurisdiction: null,
  });
});
