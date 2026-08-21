const { test, expect } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const WAMPage = require('../pages/WAMPage');

// Tests WAM's "de-mapping" (the row's "Clear value" button) actually
// persists server-side — never exercised by any spec before this one
// (WAMPage.clearWorkAreaUser() existed but had zero callers). Same
// "trust reopen-and-reverify, not the toast" principle every other WAM
// spec already follows — the toast alone isn't proof (confirmed
// elsewhere in this suite that a large-payload submit can return a
// 502 with no toast at all even though the write succeeded).
//
// Covers BOTH row shapes WAM has:
// - Single-assignee (Work Area level, e.g. Execution Engineer) — a plain
//   select; clearing empties it entirely.
// - Multi-assignee (Work Location/Site/Cluster level, e.g. Plot Admin) —
//   confirmed live (WAM row HTML dumps during the hierarchy
//   investigation) the SAME "Clear value" button exists on these rows
//   too, but clears ALL current assignees at once, not one at a time.
//
// Deliberately does NOT touch any row another spec currently relies on
// being mapped:
// - The Work Area test restores the EXACT single value it captured
//   before touching anything — trivial and exact for a single-select
//   row (one pick always fully replaces), so safe even on a row
//   13_wam_all_roles.spec.js/18_wam_hierarchy.spec.js also rely on.
// - The multi-assignee test deliberately targets Plot Admin at Work
//   Location "S05b", NOT "A-06c" — 13_wam_all_roles.spec.js's own
//   WORK_LOCATION_ROW constant only ever exercises PM/Plot Admin at
//   "A-06c", never "S05b", so this row has no accumulated history any
//   other spec depends on. Still captures and restores whatever (if
//   anything) was there before, rather than assuming it's empty.
const CLUSTER = ['Gujarat', 'Khavda'];
const SITE = 'Khavda';
const PACKAGE = 'Civil';
const WORK_AREA_LOCATION = 'A-06c';
const WORK_AREA = 'BL01';
const MULTI_ROW_LOCATION = 'S05b'; // untouched by any other spec — see header comment

const lastCreated = loadLastCreatedUsers();
function requireUser(prefix) {
  const user = lastCreated[prefix];
  expect(user, `No last-created user recorded for prefix "${prefix}" in ` +
    'tests/fixtures/last-created-users.json — run 12_user_management.spec.js first').toBeTruthy();
  return user;
}

test.describe('WAM de-mapping (Clear value) actually persists', () => {
  let context, page, dashboard;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, dashboard } = await adminFreshLogin(browser));
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('Single-assignee Work Area row: clearing Execution Engineer persists, then restoring it also persists', async () => {
    test.setTimeout(10 * 60 * 1000);
    const ee = requireUser('EE');
    const wam = new WAMPage(page);

    const openAndFilter = () => wam.fillAssignmentFilters({
      role: 'Execution Engineer', cluster: CLUSTER, site: SITE,
      workLocation: WORK_AREA_LOCATION, package: PACKAGE,
    });

    await wam.goto(dashboard);
    await wam.openAddDetails();
    await openAndFilter();

    // Precondition + snapshot — capture whatever's actually there right
    // now, don't assume it's the EE bulk user specifically (a previous
    // session may have left something else).
    const before = await wam.getWorkAreaUserValue(WORK_AREA);
    console.log(`Before clear: ${WORK_AREA} = "${before}"`);
    if (!before) {
      // Nothing to clear yet — assign the known EE user first so this
      // test actually exercises clearing a POPULATED row, not a no-op.
      await wam.assignUserIfNeeded(WORK_AREA, ee.name);
      await wam.clickSubmit();
      await wam.closeDialog();
      await wam.openAddDetails();
      await openAndFilter();
    }
    const target = before || ee.name;

    // Clear it, submit, reopen fresh and confirm it's ACTUALLY empty —
    // not just cleared in local form state.
    const cleared = await wam.clearWorkAreaUser(WORK_AREA);
    expect(cleared, 'Clear value button should have been visible and clicked').toBe(true);
    await expect(wam.getWorkAreaRow(WORK_AREA).locator('[role="combobox"]')).not.toContainText(target);

    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const afterClear = await wam.getWorkAreaUserValue(WORK_AREA);
    expect(afterClear, 'Work Area row should be empty after Clear + Submit persisted').toBe('');
    console.log(`After clear (persisted): ${WORK_AREA} is empty, as expected`);

    // Restore the exact original value, submit, reopen fresh and
    // confirm it actually came back.
    await wam.assignUserIfNeeded(WORK_AREA, target);
    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const restored = await wam.getWorkAreaUserValue(WORK_AREA);
    expect(restored, 'Work Area row should show the restored value after persisting').toContain(target);
    await wam.closeDialog();

    console.log(`Restored: ${WORK_AREA} = "${restored}"`);
  });

  test('Multi-assignee Work Location row: clearing Plot Admin persists, then restoring every original assignee also persists', async () => {
    test.setTimeout(10 * 60 * 1000);
    const pad = requireUser('PAD');
    const wam = new WAMPage(page);

    const openAndFilter = () => wam.fillAssignmentFilters({ role: 'Plot Admin', cluster: CLUSTER, site: SITE });

    await wam.goto(dashboard);
    await wam.openAddDetails();
    await openAndFilter();

    // Snapshot whatever's currently there (expected to be empty — see
    // header comment — but don't assume it, capture and restore
    // whatever's actually found).
    const before = await wam.getWorkAreaUserValue(MULTI_ROW_LOCATION);
    const originalNames = before ? before.split(',').map(n => n.trim()).filter(Boolean) : [];
    console.log(`Before clear: ${MULTI_ROW_LOCATION} = [${originalNames.join(', ') || '(empty)'}]`);

    // Ensure there's actually something to clear — add the known PAD
    // user if the row came back empty, so this test exercises clearing
    // a POPULATED multi-assignee row, not a no-op.
    const namesToRestore = [...originalNames];
    if (!namesToRestore.includes(pad.name)) {
      await wam.addAssigneeToRow(MULTI_ROW_LOCATION, pad.name);
      namesToRestore.push(pad.name);
      await wam.clickSubmit();
      await wam.closeDialog();
      await wam.openAddDetails();
      await openAndFilter();
    }

    const beforeClear = await wam.getWorkAreaUserValue(MULTI_ROW_LOCATION);
    expect(beforeClear, 'precondition: row should be populated before testing Clear').not.toBe('');

    const cleared = await wam.clearWorkAreaUser(MULTI_ROW_LOCATION);
    expect(cleared, 'Clear value button should have been visible and clicked').toBe(true);

    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const afterClear = await wam.getWorkAreaUserValue(MULTI_ROW_LOCATION);
    expect(afterClear, 'Work Location row should be empty after Clear + Submit persisted').toBe('');
    console.log(`After clear (persisted): ${MULTI_ROW_LOCATION} is empty, as expected`);

    // Restore every originally-captured (or just-added) name — one at a
    // time, since addAssigneeToRow only adds, never removes.
    const restoreFailures = [];
    for (const name of namesToRestore) {
      try {
        await wam.addAssigneeToRow(MULTI_ROW_LOCATION, name);
      } catch (err) {
        restoreFailures.push({ name, message: err.message });
      }
    }
    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const restored = await wam.getWorkAreaUserValue(MULTI_ROW_LOCATION);
    console.log(`Restored: ${MULTI_ROW_LOCATION} = "${restored}"`);

    // Surface any restore failure loudly and distinctly from the actual
    // demapping-persistence assertions above — a failure here means
    // real shared WAM state may be left short an assignee, worth
    // knowing about even though it's a different concern than "does
    // Clear work."
    expect(restoreFailures, `Failed to restore: ${JSON.stringify(restoreFailures)}`).toEqual([]);
    for (const name of namesToRestore) {
      expect(restored, `restored value should still include "${name}"`).toContain(name);
    }
    await wam.closeDialog();
  });
});
