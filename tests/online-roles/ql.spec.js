const { test } = require('@playwright/test');
const { runOnlineRoleRegressionSuite } = require('../utils/online-role-regression');

// Quality Lead — extensive online-role regression. See
// tests/utils/online-role-regression.js for the full sweep this runs.
//
// addUserRoleTarget: null — same reasoning as el.spec.js/pm.spec.js.
// Quality Lead's own WAM authority is to assign Quality Inspector; whether
// Add User is active for this tier at all is unconfirmed.
test('Quality Lead: dashboard, My Tasks, WAM, Users, Reports — full sweep', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  await runOnlineRoleRegressionSuite(browser, {
    prefix: 'QL',
    roleName: 'Quality Lead',
    addUserRoleTarget: null,
    jurisdiction: null,
  });
});
