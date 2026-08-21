const { test, expect } = require('@playwright/test');
const { loginAsUser } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const DashboardPage = require('../pages/DashboardPage');
const WAMPage = require('../pages/WAMPage');

// Hierarchy-wise version of 25_wam_demapping.spec.js — same "Clear
// value" mechanic (does it actually persist server-side, not just clear
// in local form state), but performed by NON-ADMIN logins (Cluster
// Admin/Site Admin/Plot Admin) instead of Admin, same angle
// 18_wam_hierarchy.spec.js already applies to WAM assignment/creation.
//
// One representative example per tier per role type (not every role
// below each tier — 26_wam_patch_update.spec.js already proved the
// underlying mechanic works for every role under Admin; this spec is
// about confirming NON-ADMIN logins can invoke that same mechanic
// within their own scope, not re-proving it exhaustively):
// - Single-assignee: Execution Engineer @ Work Area BL01, Work Location
//   A-06c — below all three tiers, so reused as-is for each.
// - Multi-assignee: Site Admin @ Site Khavda for Cluster Admin (Site
//   Admin sits directly below Cluster Admin); Plot Admin @ Work
//   Location S05b for Site Admin (deliberately S05b, not A-06c — same
//   "untouched by any other spec" reasoning 25_wam_demapping.spec.js's
//   own multi-assignee test already relies on, so nothing else's
//   assumptions are at risk).
// - Plot Admin has NO multi-assignee example available: everything
//   below it (Project Manager downward) turned out to be single-
//   assignee — Project Manager's own Work Location row is single-select
//   too (confirmed live, 2026-08-21, see docs/wam-crud-coverage.md),
//   unlike Plot Admin's own row. So Plot Admin's tier tests TWO
//   single-assignee examples (Execution Engineer + Quality Inspector)
//   instead of one of each.
//
// Requires each bulk-created user to already be able to log in (same
// precondition 18_wam_hierarchy.spec.js documents) and to already be
// WAM-mapped into these exact rows (run 13_wam_all_roles.spec.js and
// 18_wam_hierarchy.spec.js first if starting from scratch).
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

const CLUSTER = ['Gujarat', 'Khavda'];
const SITE = 'Khavda';
const WORK_LOCATION = 'A-06c';
const PACKAGE = 'Civil';
const WORK_AREA = 'BL01';
const UNTOUCHED_WORK_LOCATION = 'S05b'; // never touched by 13_wam_all_roles.spec.js's PM/Plot Admin block
const SITE_ROW_CANDIDATES = ['Khavda', 'KHAVDA'];

const lastCreated = loadLastCreatedUsers();
function requireUser(prefix) {
  const user = lastCreated[prefix];
  expect(user, `No last-created user recorded for prefix "${prefix}" in ` +
    'tests/fixtures/last-created-users.json — run 12_user_management.spec.js first').toBeTruthy();
  return user;
}

// Single-assignee demap-then-restore, reused by every tier below —
// target row/role are fixed (Execution Engineer @ BL01/A-06c); only the
// LOGGED-IN tier differs.
async function demapAndRestoreSingleAssignee(page, tierLabel) {
  const ee = requireUser('EE');
  const wam = new WAMPage(page);
  const openAndFilter = () => wam.fillAssignmentFilters({
    role: 'Execution Engineer', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE,
  });

  await wam.openAddDetails();
  await openAndFilter();

  const before = await wam.getWorkAreaUserValue(WORK_AREA);
  console.log(`${tierLabel}: before clear, ${WORK_AREA} = "${before}"`);
  if (!before) {
    await wam.assignUserIfNeeded(WORK_AREA, ee.name);
    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
  }
  const target = before || ee.name;

  const cleared = await wam.clearWorkAreaUser(WORK_AREA);
  expect(cleared, `${tierLabel}: Clear value button should have been visible and clicked`).toBe(true);

  await wam.clickSubmit();
  await wam.closeDialog();
  await wam.openAddDetails();
  await openAndFilter();
  const afterClear = await wam.getWorkAreaUserValue(WORK_AREA);
  expect(afterClear, `${tierLabel}: Work Area row should be empty after Clear + Submit persisted`).toBe('');
  console.log(`${tierLabel}: after clear (persisted), ${WORK_AREA} is empty, as expected`);

  await wam.assignUserIfNeeded(WORK_AREA, target);
  await wam.clickSubmit();
  await wam.closeDialog();
  await wam.openAddDetails();
  await openAndFilter();
  const restored = await wam.getWorkAreaUserValue(WORK_AREA);
  expect(restored, `${tierLabel}: Work Area row should show the restored value after persisting`).toContain(target);
  await wam.closeDialog();

  console.log(`${tierLabel}: restored ${WORK_AREA} = "${restored}"`);
}

test.describe('Cluster Admin can demap (Clear value) roles below its own tier', () => {
  let context, page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();
    const cad = requireUser('CAD');
    await loginAsUser(page, cad.email, PASSWORD);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('Cluster Admin can clear Execution Engineer (single-assignee) and restoring it also persists', async () => {
    test.setTimeout(20 * 60 * 1000); // first-time login PWA spinner, see 18_wam_hierarchy.spec.js
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await demapAndRestoreSingleAssignee(page, 'Cluster Admin');
  });

  test('Cluster Admin can clear Site Admin (multi-assignee) and restoring every original assignee also persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const sad = requireUser('SAD');
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));

    const openAndFilter = () => wam.fillAssignmentFilters({ role: 'Site Admin', cluster: CLUSTER });
    await wam.openAddDetails();
    await openAndFilter();

    const rowLabel = await wam.resolveRowLabel(SITE_ROW_CANDIDATES);
    const before = await wam.getWorkAreaUserValue(rowLabel);
    const originalNames = before ? before.split(',').map(n => n.trim()).filter(Boolean) : [];
    console.log(`Cluster Admin: before clear, ${rowLabel} = [${originalNames.join(', ') || '(empty)'}]`);

    const namesToRestore = [...originalNames];
    if (!namesToRestore.includes(sad.name)) {
      await wam.addAssigneeToRow(rowLabel, sad.name);
      namesToRestore.push(sad.name);
      await wam.clickSubmit();
      await wam.closeDialog();
      await wam.openAddDetails();
      await openAndFilter();
    }

    const cleared = await wam.clearWorkAreaUser(rowLabel);
    expect(cleared, 'Clear value button should have been visible and clicked').toBe(true);

    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const afterClear = await wam.getWorkAreaUserValue(await wam.resolveRowLabel(SITE_ROW_CANDIDATES));
    expect(afterClear, 'Site Admin row should be empty after Clear + Submit persisted').toBe('');
    console.log(`Cluster Admin: after clear (persisted), Site Admin row is empty, as expected`);

    const restoreFailures = [];
    const finalRowLabel = await wam.resolveRowLabel(SITE_ROW_CANDIDATES);
    for (const name of namesToRestore) {
      try {
        await wam.addAssigneeToRow(finalRowLabel, name);
      } catch (err) {
        restoreFailures.push({ name, message: err.message });
      }
    }
    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const restored = await wam.getWorkAreaUserValue(await wam.resolveRowLabel(SITE_ROW_CANDIDATES));
    console.log(`Cluster Admin: restored Site Admin row = "${restored}"`);

    expect(restoreFailures, `Failed to restore: ${JSON.stringify(restoreFailures)}`).toEqual([]);
    for (const name of namesToRestore) {
      expect(restored, `restored value should still include "${name}"`).toContain(name);
    }
    await wam.closeDialog();
  });
});

test.describe('Site Admin can demap (Clear value) roles below its own tier', () => {
  let context, page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();
    const sad = requireUser('SAD');
    await loginAsUser(page, sad.email, PASSWORD);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('Site Admin can clear Execution Engineer (single-assignee) and restoring it also persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await demapAndRestoreSingleAssignee(page, 'Site Admin');
  });

  test('Site Admin can clear Plot Admin (multi-assignee) and restoring every original assignee also persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const pad = requireUser('PAD');
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));

    const openAndFilter = () => wam.fillAssignmentFilters({ role: 'Plot Admin', cluster: CLUSTER, site: SITE });
    await wam.openAddDetails();
    await openAndFilter();

    const before = await wam.getWorkAreaUserValue(UNTOUCHED_WORK_LOCATION);
    const originalNames = before ? before.split(',').map(n => n.trim()).filter(Boolean) : [];
    console.log(`Site Admin: before clear, ${UNTOUCHED_WORK_LOCATION} = [${originalNames.join(', ') || '(empty)'}]`);

    const namesToRestore = [...originalNames];
    if (!namesToRestore.includes(pad.name)) {
      await wam.addAssigneeToRow(UNTOUCHED_WORK_LOCATION, pad.name);
      namesToRestore.push(pad.name);
      await wam.clickSubmit();
      await wam.closeDialog();
      await wam.openAddDetails();
      await openAndFilter();
    }

    const cleared = await wam.clearWorkAreaUser(UNTOUCHED_WORK_LOCATION);
    expect(cleared, 'Clear value button should have been visible and clicked').toBe(true);

    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const afterClear = await wam.getWorkAreaUserValue(UNTOUCHED_WORK_LOCATION);
    expect(afterClear, 'Plot Admin row should be empty after Clear + Submit persisted').toBe('');
    console.log(`Site Admin: after clear (persisted), ${UNTOUCHED_WORK_LOCATION} is empty, as expected`);

    const restoreFailures = [];
    for (const name of namesToRestore) {
      try {
        await wam.addAssigneeToRow(UNTOUCHED_WORK_LOCATION, name);
      } catch (err) {
        restoreFailures.push({ name, message: err.message });
      }
    }
    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const restored = await wam.getWorkAreaUserValue(UNTOUCHED_WORK_LOCATION);
    console.log(`Site Admin: restored ${UNTOUCHED_WORK_LOCATION} = "${restored}"`);

    expect(restoreFailures, `Failed to restore: ${JSON.stringify(restoreFailures)}`).toEqual([]);
    for (const name of namesToRestore) {
      expect(restored, `restored value should still include "${name}"`).toContain(name);
    }
    await wam.closeDialog();
  });
});

test.describe('Plot Admin can demap (Clear value) roles below its own tier', () => {
  let context, page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();
    const pad = requireUser('PAD');
    await loginAsUser(page, pad.email, PASSWORD);
  });

  test.afterAll(async () => {
    await context.close();
  });

  // No multi-assignee example for this tier — see header comment.
  test('Plot Admin can clear Execution Engineer (single-assignee) and restoring it also persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await demapAndRestoreSingleAssignee(page, 'Plot Admin');
  });

  test('Plot Admin can clear Quality Inspector (single-assignee) and restoring it also persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const qi = requireUser('QI');
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    const openAndFilter = () => wam.fillAssignmentFilters({
      role: 'Quality Inspector', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE,
    });
    await openAndFilter();

    const before = await wam.getWorkAreaUserValue(WORK_AREA);
    console.log(`Plot Admin: before clear, ${WORK_AREA} = "${before}"`);
    if (!before) {
      await wam.assignUserIfNeeded(WORK_AREA, qi.name);
      await wam.clickSubmit();
      await wam.closeDialog();
      await wam.openAddDetails();
      await openAndFilter();
    }
    const target = before || qi.name;

    const cleared = await wam.clearWorkAreaUser(WORK_AREA);
    expect(cleared, 'Clear value button should have been visible and clicked').toBe(true);

    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const afterClear = await wam.getWorkAreaUserValue(WORK_AREA);
    expect(afterClear, 'Work Area row should be empty after Clear + Submit persisted').toBe('');
    console.log(`Plot Admin: after clear (persisted), ${WORK_AREA} is empty, as expected`);

    await wam.assignUserIfNeeded(WORK_AREA, target);
    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const restored = await wam.getWorkAreaUserValue(WORK_AREA);
    expect(restored, 'Work Area row should show the restored value after persisting').toContain(target);
    await wam.closeDialog();

    console.log(`Plot Admin: restored ${WORK_AREA} = "${restored}"`);
  });
});
