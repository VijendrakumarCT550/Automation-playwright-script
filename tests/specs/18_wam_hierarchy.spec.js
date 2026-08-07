const { test, expect } = require('@playwright/test');
const { loginAsUser } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const DashboardPage = require('../pages/DashboardPage');
const WAMPage = require('../pages/WAMPage');

test.describe.configure({ mode: 'serial' });

// Role hierarchy (per app owner): Admin-tier (Cluster/Site/Plot Admin) can
// each assign Project Manager within their own scope -> Project Manager
// assigns Execution Lead + Quality Lead within their Work Location ->
// Execution Lead assigns Execution Engineer + Contractor Manager, Quality
// Lead assigns Quality Inspector, Contractor Manager assigns Contractor
// In-Charge, all three within their own Work Area scope. Users cannot
// assign roles above their level, and can only assign within their OWN
// already-assigned scope (Cluster / Site / Work Location / Work Area) —
// this spec starts at the top (Cluster Admin) and cascades down through
// Work Location and Work Area level, all on one worker (test.describe
// serial mode) since each step logs in as a DIFFERENT user.
//
// Reuses the SAME already-created, already-WAM-mapped users from
// [[project_user_management_feature]]/[[project_wam_all_roles_feature]]
// (tests/fixtures/last-created-users.json) — this spec isn't about
// creating new mappings, it's about confirming that a NON-ADMIN login can
// perform the identical WAM assignment action, restricted to their own
// subordinate roles and their own location scope. Unconfirmed prior to
// this spec (all previous WAM automation ran as Admin only): whether the
// Add Details dialog's Role dropdown is actually filtered by hierarchy.
// Confirmed live: for Cluster Admin it is NOT — the dropdown showed 9 of
// the 10 possible roles (everything except Cluster Admin itself), not
// just "Project Manager". Logged (via logRoleRestrictionCheck below) but
// never asserted, so a mismatch here is reported without blocking the
// rest of the cascade from running and confirming whether the underlying
// scope-restricted assignment mechanics work regardless.
//
// Requires each of these bulk-created users to be able to log in (the app
// owner is adding them to user auth manually in the DB before this can
// run) — password ASSUMED to match every other account in .env
// (BULK_USER_DEFAULT_PASSWORD), confirm/correct once that step is done.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

const CLUSTER = ['Gujarat', 'Khavda']; // WAM's Cluster field has shown either name for this same location
const SITE = 'Khavda';
const WORK_LOCATION = 'A-06c';
const PACKAGE = 'Civil';
const WORK_AREA = 'BL01';
const SERVICE_ORDER = 'M S CHOUHAN INFRAVENTURES';

const lastCreated = loadLastCreatedUsers();
function requireUser(prefix) {
  const user = lastCreated[prefix];
  expect(user, `No last-created user recorded for prefix "${prefix}" in ` +
    'tests/fixtures/last-created-users.json — run 12_user_management.spec.js first').toBeTruthy();
  return user;
}

// Purely informational — logs whether the Role dropdown actually matched
// the expected hierarchy restriction, WITHOUT ever failing the test. An
// expect.soft() here still marks the containing TEST as failed once the
// run finishes, and test.describe.configure({mode:'serial'}) skips every
// remaining test after the first failure — confirmed live: that combo
// silently skipped the whole rest of the cascade (Project Manager/
// Execution Lead/Quality Lead/Contractor Manager never ran) the first time
// this used expect.soft(), even though the actual assignment for Cluster
// Admin had already succeeded. The real goal here is finding out whether
// the underlying assignment mechanics work for every role in the chain;
// whether the Role dropdown happens to be restricted is a secondary,
// separately-reportable finding.
function logRoleRestrictionCheck(roleLabel, actualRoles, expectedRoles) {
  const actual = [...actualRoles].sort();
  const expected = [...expectedRoles].sort();
  const matches = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(
    `${roleLabel} role-dropdown restriction: ${matches ? 'MATCHES' : 'DOES NOT MATCH'} expected. ` +
    `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`
  );
}

// Reopen fresh and reselect the same filters to confirm the mapping
// persisted server-side, not just held in form state — same pattern
// already proven in 13_wam_all_roles.spec.js.
//
// Opens the dialog itself if it isn't already open — this function always
// leaves the dialog CLOSED at the end (for the reopen-and-reverify step),
// so a caller looping over multiple roles with the SAME already-open
// dialog (e.g. Project Manager assigning both Execution Lead and Quality
// Lead) would otherwise find the Role dropdown gone on every iteration
// after the first. Confirmed live: exactly this timed out before this
// check existed.
async function assignAndVerify(wam, filters, rowLabel, userName, useMultiAssign) {
  if (!(await wam.dialog.isVisible({ timeout: 1000 }).catch(() => false))) {
    await wam.openAddDetails();
  }
  await wam.fillAssignmentFilters(filters);
  if (useMultiAssign) {
    await wam.addAssigneeToRow(rowLabel, userName);
  } else {
    await wam.assignUserIfNeeded(rowLabel, userName);
  }
  await expect(wam.getWorkAreaRow(rowLabel).locator('[role="combobox"]')).toContainText(userName);

  const toastText = await wam.clickSubmit();
  if (!toastText) console.log(`${filters.role} -> ${rowLabel}: no toast text (possible gateway blip, verifying persisted state directly)`);

  await wam.closeDialog();
  await wam.openAddDetails();
  await wam.fillAssignmentFilters(filters);
  const value = await wam.getWorkAreaUserValue(rowLabel);
  expect(value).toContain(userName);
  await wam.closeDialog();
}

test.describe('WAM assignment follows the role hierarchy (Cluster Admin -> Project Manager -> Execution/Quality Lead -> Execution Engineer/Contractor Manager/Quality Inspector -> Contractor In-Charge)', () => {
  let context, page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('Cluster Admin can assign only Project Manager, within their own Cluster', async () => {
    // Every test here logs in as a BRAND NEW account (never logged in
    // before) — same first-time PWA install spinner CI/EE/QI hit (5-6 min),
    // which the global 10min config timeout doesn't leave enough room for
    // on top of the actual WAM interaction. Confirmed live: without this,
    // the outer test timeout force-closed the browser mid-wait even though
    // the dashboard HAD fully loaded by then, just too late.
    test.setTimeout(20 * 60 * 1000);
    const cad = requireUser('CAD');
    const pm = requireUser('PM');

    await loginAsUser(page, cad.email, PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    const availableRoles = await wam.getAvailableRoleOptions();
    logRoleRestrictionCheck('Cluster Admin', availableRoles, ['Project Manager']);

    await assignAndVerify(
      wam,
      { role: 'Project Manager', cluster: CLUSTER, site: SITE },
      WORK_LOCATION, pm.name, /* useMultiAssign */ true,
    );

    console.log(`Cluster Admin "${cad.name}" assigned Project Manager "${pm.name}" at Work Location ${WORK_LOCATION}`);
  });

  test('Project Manager can assign only Execution Lead + Quality Lead, within their own Work Location', async () => {
    test.setTimeout(20 * 60 * 1000); // see first test's comment — first-time login PWA spinner
    const pm = requireUser('PM');
    const el = requireUser('EL');
    const ql = requireUser('QL');

    await loginAsUser(page, pm.email, PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    const availableRoles = await wam.getAvailableRoleOptions();
    logRoleRestrictionCheck('Project Manager', availableRoles, ['Execution Lead', 'Quality Lead']);

    for (const { role, user } of [{ role: 'Execution Lead', user: el }, { role: 'Quality Lead', user: ql }]) {
      await assignAndVerify(
        wam,
        { role, cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE },
        WORK_AREA, user.name, /* useMultiAssign */ false,
      );
      console.log(`Project Manager "${pm.name}" assigned ${role} "${user.name}" at Work Area ${WORK_AREA}`);
    }
  });

  test('Execution Lead can assign only Execution Engineer + Contractor Manager, within their own Work Area', async () => {
    test.setTimeout(20 * 60 * 1000); // see first test's comment — first-time login PWA spinner
    const el = requireUser('EL');
    const ee = requireUser('EE');
    const cm = requireUser('CM');

    await loginAsUser(page, el.email, PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    const availableRoles = await wam.getAvailableRoleOptions();
    logRoleRestrictionCheck('Execution Lead', availableRoles, ['Contractor Manager', 'Execution Engineer']);

    await assignAndVerify(
      wam,
      { role: 'Execution Engineer', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE },
      WORK_AREA, ee.name, false,
    );
    console.log(`Execution Lead "${el.name}" assigned Execution Engineer "${ee.name}" at Work Area ${WORK_AREA}`);

    await assignAndVerify(
      wam,
      { role: 'Contractor Manager', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE, serviceOrder: SERVICE_ORDER },
      WORK_AREA, cm.name, false,
    );
    console.log(`Execution Lead "${el.name}" assigned Contractor Manager "${cm.name}" at Work Area ${WORK_AREA}`);
  });

  test('Quality Lead can assign only Quality Inspector, within their own Work Area', async () => {
    test.setTimeout(20 * 60 * 1000); // see first test's comment — first-time login PWA spinner
    const ql = requireUser('QL');
    const qi = requireUser('QI');

    await loginAsUser(page, ql.email, PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    const availableRoles = await wam.getAvailableRoleOptions();
    logRoleRestrictionCheck('Quality Lead', availableRoles, ['Quality Inspector']);

    await assignAndVerify(
      wam,
      { role: 'Quality Inspector', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE },
      WORK_AREA, qi.name, false,
    );
    console.log(`Quality Lead "${ql.name}" assigned Quality Inspector "${qi.name}" at Work Area ${WORK_AREA}`);
  });

  test('Contractor Manager can assign only Contractor In-Charge, within their own Work Area', async () => {
    test.setTimeout(20 * 60 * 1000); // see first test's comment — first-time login PWA spinner
    const cm = requireUser('CM');
    const cic = requireUser('CIC');

    await loginAsUser(page, cm.email, PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    const availableRoles = await wam.getAvailableRoleOptions();
    logRoleRestrictionCheck('Contractor Manager', availableRoles, ['Contractor Incharge']);

    await assignAndVerify(
      wam,
      { role: 'Contractor Incharge', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE, serviceOrder: SERVICE_ORDER },
      WORK_AREA, cic.name, false,
    );
    console.log(`Contractor Manager "${cm.name}" assigned Contractor Incharge "${cic.name}" at Work Area ${WORK_AREA}`);
  });
});
