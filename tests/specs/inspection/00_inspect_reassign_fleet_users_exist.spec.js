const { test } = require('@playwright/test');
const { fleetFor } = require('../../utils/reassign-fleet');
const { adminFreshLogin } = require('../../utils/helpers');
const UserManagementPage = require('../../pages/UserManagementPage');

// ===========================================================================
// INSPECTION (READ-ONLY) — does every recorded reassignment-fleet account still
// exist on this deployment?
// ===========================================================================
// 2026-09-30, pulse-test: 40's remap mode failed for every mapped member with
// "not found in this row's assignee dropdown", which is what a deleted or
// deactivated account looks like from WAM. This searches User Management for
// each recorded member by name and reports FOUND / NOT FOUND, so 40 can be
// pointed at only the ones that need recreating. It never edits anything.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/inspection/00_inspect_reassign_fleet_users_exist.spec.js --project=chromium --workers=1
// ===========================================================================
test('reassignment fleet: every recorded account still exists', async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);

  const members = Object.values(fleetFor()).filter((m) => m && m.name);
  const { context, page, dashboard } = await adminFreshLogin(browser);
  const um = new UserManagementPage(page);
  const report = [];
  try {
    await um.goto(dashboard);
    // CONTROL ARM: a user known to exist must be FOUND, or every NOT FOUND
    // below is just a search that cannot see anything.
    const control = process.env.FLEET_CHECK_CONTROL || 'Vikram Singh';
    const controlFound = await um.waitForUserSearchResult(control, 15000);
    console.log(`  CONTROL  "${control}": ${controlFound ? 'FOUND' : 'NOT FOUND — results below are not trustworthy'}`);
    for (const m of members) {
      // Re-searches for up to 12s — the list can lag the query, and a
      // false NOT FOUND here would make us recreate a live account.
      const found = await um.waitForUserSearchResult(m.name, 12000);
      report.push({ key: m.key, role: m.role, name: m.name, email: m.email, found });
      console.log(`  ${found ? 'FOUND    ' : 'NOT FOUND'} ${m.key.padEnd(6)} ${m.role.padEnd(20)} ${m.name} <${m.email}>`);
    }
  } finally {
    await context.close();
  }
  const missing = report.filter((r) => !r.found).map((r) => r.key);
  console.log(`\n  found ${report.length - missing.length}/${report.length}; missing: ${missing.join(',') || '(none)'}`);
});
