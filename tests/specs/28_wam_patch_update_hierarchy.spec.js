const { test, expect } = require('@playwright/test');
const { loginAsUser } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const DashboardPage = require('../pages/DashboardPage');
const WAMPage = require('../pages/WAMPage');

// Hierarchy-wise version of 26_wam_patch_update.spec.js — same
// PATCH/update mechanic (replace for single-assignee rows, add-
// alongside for multi-assignee rows), performed by NON-ADMIN logins
// (Cluster Admin/Site Admin/Plot Admin) instead of Admin. Same
// "one representative example per tier, not every role below it" scope
// as 27_wam_demapping_hierarchy.spec.js — see that file's header
// comment for the full reasoning, including why Plot Admin's tier has
// no multi-assignee example (everything below it, including Project
// Manager's own row, turned out to be single-assignee — see
// docs/wam-crud-coverage.md).
//
// Real edge case (app-owner-raised, already handled in
// 26_wam_patch_update.spec.js): if a role's dropdown genuinely offers
// nothing to switch/add to, that's a legitimate "can't test update
// here" state — WAMPage.selectDifferentWorkAreaUser()/
// addAnyUnassignedUser() return `null` for it, and every test below
// calls test.skip() with a clear reason rather than failing.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

const CLUSTER = ['Gujarat', 'Khavda'];
const SITE = 'Khavda';
const WORK_LOCATION = 'A-06c';
const PACKAGE = 'Civil';
const WORK_AREA = 'BL01';
const UNTOUCHED_WORK_LOCATION = 'S05b';
const SITE_ROW_CANDIDATES = ['Khavda', 'KHAVDA'];

const lastCreated = loadLastCreatedUsers();
function requireUser(prefix) {
  const user = lastCreated[prefix];
  expect(user, `No last-created user recorded for prefix "${prefix}" in ` +
    'tests/fixtures/last-created-users.json — run 12_user_management.spec.js first').toBeTruthy();
  return user;
}

// Single-assignee replace-then-restore, reused by every tier — target
// row/role are parameterized so Plot Admin's tier can run it twice
// (Execution Engineer + Quality Inspector) without duplicating the body.
async function updateAndRestoreSingleAssignee(page, tierLabel, role, ee) {
  const wam = new WAMPage(page);
  const openAndFilter = () => wam.fillAssignmentFilters({
    role, cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE,
  });

  await wam.openAddDetails();
  await openAndFilter();

  const original = await wam.getWorkAreaUserValue(WORK_AREA);
  expect(original, `${tierLabel}: precondition, ${role}'s Work Area row should already have an assignee`).not.toBe('');
  console.log(`${tierLabel}: before update, ${role} @ ${WORK_AREA} = "${original}"`);

  const updated = await wam.selectDifferentWorkAreaUser(WORK_AREA, original);
  test.skip(updated === null, `No alternative user available for ${role} at ${WORK_AREA} — can't test update`);
  await expect(wam.getWorkAreaRow(WORK_AREA).locator('[role="combobox"]')).toContainText(updated);

  await wam.clickSubmit();
  await wam.closeDialog();
  await wam.openAddDetails();
  await openAndFilter();
  const afterUpdate = await wam.getWorkAreaUserValue(WORK_AREA);
  expect(afterUpdate, 'updated value should persist after reopening').toContain(updated);
  console.log(`${tierLabel}: after update (persisted), ${role} @ ${WORK_AREA} = "${afterUpdate}"`);
  await wam.closeDialog();

  await wam.openAddDetails();
  await openAndFilter();
  await wam.selectWorkAreaUser(WORK_AREA, original);
  await wam.clickSubmit();
  await wam.closeDialog();
  await wam.openAddDetails();
  await openAndFilter();
  const restored = await wam.getWorkAreaUserValue(WORK_AREA);
  expect(restored, 'original value should be restored after persisting').toContain(original);
  await wam.closeDialog();

  console.log(`${tierLabel}: restored ${role} @ ${WORK_AREA} = "${restored}"`);
}

test.describe('Cluster Admin can update roles below its own tier', () => {
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

  test('Cluster Admin can update Execution Engineer (replace with a different user) and it persists', async () => {
    test.setTimeout(20 * 60 * 1000); // first-time login PWA spinner, see 18_wam_hierarchy.spec.js
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await updateAndRestoreSingleAssignee(page, 'Cluster Admin', 'Execution Engineer');
  });

  test('Cluster Admin can update Site Admin (add a new assignee alongside existing ones) and it persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));

    const openAndFilter = () => wam.fillAssignmentFilters({ role: 'Site Admin', cluster: CLUSTER });
    await wam.openAddDetails();
    await openAndFilter();

    const rowLabel = await wam.resolveRowLabel(SITE_ROW_CANDIDATES);
    const before = await wam.getWorkAreaUserValue(rowLabel);
    expect(before, 'precondition: Site Admin row should already have existing assignees').not.toBe('');
    const existingNames = before.split(',').map(n => n.trim()).filter(Boolean);
    console.log(`Cluster Admin: before update, Site Admin @ ${rowLabel} = [${existingNames.join(', ')}]`);

    const added = await wam.addAnyUnassignedUser(rowLabel);
    test.skip(added === null, `No unassigned user available for Site Admin at ${rowLabel} — can't test update`);
    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const after = await wam.getWorkAreaUserValue(await wam.resolveRowLabel(SITE_ROW_CANDIDATES));
    for (const name of existingNames) {
      expect(after, `existing assignee "${name}" should still be present after update`).toContain(name);
    }
    expect(after, `newly-added assignee "${added}" should be present after update`).toContain(added);
    await wam.closeDialog();

    console.log(`Cluster Admin: after update (persisted), Site Admin row = "${after}"`);
  });
});

test.describe('Site Admin can update roles below its own tier', () => {
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

  test('Site Admin can update Execution Engineer (replace with a different user) and it persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await updateAndRestoreSingleAssignee(page, 'Site Admin', 'Execution Engineer');
  });

  test('Site Admin can update Plot Admin (add a new assignee alongside existing ones) and it persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));

    const openAndFilter = () => wam.fillAssignmentFilters({ role: 'Plot Admin', cluster: CLUSTER, site: SITE });
    await wam.openAddDetails();
    await openAndFilter();

    const before = await wam.getWorkAreaUserValue(UNTOUCHED_WORK_LOCATION);
    expect(before, 'precondition: Plot Admin row should already have existing assignees').not.toBe('');
    const existingNames = before.split(',').map(n => n.trim()).filter(Boolean);
    console.log(`Site Admin: before update, Plot Admin @ ${UNTOUCHED_WORK_LOCATION} = [${existingNames.join(', ')}]`);

    const added = await wam.addAnyUnassignedUser(UNTOUCHED_WORK_LOCATION);
    test.skip(added === null, `No unassigned user available for Plot Admin at ${UNTOUCHED_WORK_LOCATION} — can't test update`);
    await wam.clickSubmit();
    await wam.closeDialog();
    await wam.openAddDetails();
    await openAndFilter();
    const after = await wam.getWorkAreaUserValue(UNTOUCHED_WORK_LOCATION);
    for (const name of existingNames) {
      expect(after, `existing assignee "${name}" should still be present after update`).toContain(name);
    }
    expect(after, `newly-added assignee "${added}" should be present after update`).toContain(added);
    await wam.closeDialog();

    console.log(`Site Admin: after update (persisted), Plot Admin row = "${after}"`);
  });
});

test.describe('Plot Admin can update roles below its own tier', () => {
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
  test('Plot Admin can update Execution Engineer (replace with a different user) and it persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await updateAndRestoreSingleAssignee(page, 'Plot Admin', 'Execution Engineer');
  });

  test('Plot Admin can update Quality Inspector (replace with a different user) and it persists', async () => {
    test.setTimeout(20 * 60 * 1000);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await updateAndRestoreSingleAssignee(page, 'Plot Admin', 'Quality Inspector');
  });
});
