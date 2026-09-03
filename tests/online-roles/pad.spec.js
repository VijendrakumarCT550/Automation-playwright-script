const { test } = require('@playwright/test');
const { runOnlineRoleRegressionSuite } = require('../utils/online-role-regression');

// Plot Admin — extensive online-role regression. See
// tests/utils/online-role-regression.js for the full sweep this runs.
//
// addUserRoleTarget: 'Execution Lead' — CONFIRMED live (00_inspect_
// reports_and_pad_useradd.spec.js) as one of exactly 5 AGEL UserRole options
// Plot Admin's Add User dialog offers (Execution Engineer, Quality
// Inspector, Execution Lead, Quality Lead, Project Manager).
//
// jurisdiction: CONFIRMED live (00_inspect_download_and_pad_worklocation.
// spec.js, via the real fillLocationCascade() flow) — Plot Admin's Add User
// "Work Locations" field offers EXACTLY ["A-06c"], not the other known
// locations (S05b, WTG-Khavda) — i.e. Plot Admin genuinely can only create a
// user scoped to their own assigned Work Location, matching the explicit
// ask ("Plot admin is able to create user only in assigned Work Location not
// at site level or in other work locations beyond his jurisdiction"). This
// is the one jurisdiction expectation in this whole suite that's a hard
// assertion rather than a logged finding, precisely because it's the one
// that's actually been confirmed live.
test('Plot Admin: dashboard, My Tasks, WAM, SO Mapping, Users (incl. Work Location jurisdiction), Reports', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  await runOnlineRoleRegressionSuite(browser, {
    prefix: 'PAD',
    roleName: 'Plot Admin',
    addUserRoleTarget: 'Execution Lead',
    jurisdiction: { field: 'Work Locations', expectedOptions: ['A-06c'] },
  });
});
