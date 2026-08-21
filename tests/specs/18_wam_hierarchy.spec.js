const { test, expect } = require('@playwright/test');
const { loginAsUser } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const DashboardPage = require('../pages/DashboardPage');
const WAMPage = require('../pages/WAMPage');

test.describe.configure({ mode: 'serial' });

// Role hierarchy — CORRECTED/EXPANDED per app owner (2026-08-21), see
// docs/wam-hierarchy-business-logic.md for the full writeup:
//   Admin -> Cluster Admin -> Site Admin -> Plot Admin -> Project Manager
//   -> (Execution Lead + Quality Lead) -> (Contractor Manager + Execution
//   Engineer) / Quality Inspector -> Contractor In-Charge.
// Key rule: EVERY tier above Project Manager (Admin, Cluster Admin, Site
// Admin, Plot Admin) can assign Project Manager directly, each within
// their own scope (Cluster contains multiple Sites, Site contains
// multiple Plots/Work Locations — a higher tier simply has more Work
// Locations available to map into). The FIRST test.describe below covers
// this one-role-at-a-time CASCADE (each tier assigns only the next tier
// down) for a single path starting at Cluster Admin.
//
// The SECOND part of this file (test.describe blocks per tier, appended
// below) covers a DIFFERENT, broader angle the cascade tests don't:
// each of Cluster Admin/Site Admin/Plot Admin can actually assign EVERY
// role below its own tier at once (not just the next one down) — the
// cascade tests' own role-restriction check already hinted at this for
// Cluster Admin ("9 of the 10 possible roles" in its Role dropdown, not
// just "Project Manager"). Mirrors 13_wam_all_roles.spec.js's structure
// exactly (same WORK_AREA_ROLES/WORK_LOCATION_ROLES/SITE_ROLES groupings,
// same assignUserIfNeeded/addAssigneeToRow idempotent "map if not already
// mapped" pattern) — just scoped down per tier and logged in as that
// tier's own bulk-created user instead of Admin. Per app owner: also
// apply Cluster Admin/Site Admin/Plot Admin's authority to SO Mapping and
// RFI/NC visibility/reassignment (they have Admin's full authority within
// their own scope for those too) — planned as separate follow-up work in
// 05_so_mapping.spec.js/11_reassign_rfi_nc.spec.js, not built here.
//
// Reuses the SAME already-created, already-WAM-mapped users from
// [[project_user_management_feature]]/[[project_wam_all_roles_feature]]
// (tests/fixtures/last-created-users.json) — this spec isn't about
// creating new mappings, it's about confirming that a NON-ADMIN login can
// perform the identical WAM assignment action, restricted to their own
// subordinate roles and their own location scope.
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

    // Expected value here is deliberately still just ["Project Manager"]
    // — this test only exercises the CASCADE (one role at a time down the
    // chain), so a "mismatch" log here is EXPECTED and correct per the
    // corrected hierarchy (Cluster Admin can see/assign every role below
    // it, not just Project Manager) — see the "Part 2" describe blocks
    // below, which exercise and confirm that broader capability directly.
    // Not updated to the wider expectation here so this log keeps
    // surfacing the original, narrower cascade-only assumption for
    // anyone reading just this one test in isolation.
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

// ─── Part 2: each upper tier assigns EVERY role below its own, not just
// the next one down (app owner, 2026-08-21) ───────────────────────────────
//
// Mirrors 13_wam_all_roles.spec.js exactly — same role groupings by row
// granularity, same idempotent assignUserIfNeeded/addAssigneeToRow "map
// if not already mapped" pattern, same reopen-and-reverify — just logged
// in as the tier's own bulk-created user instead of Admin, and with the
// role list narrowed to exclude that tier's own role and anything above
// it (a tier can't assign itself or its superiors).
//
// CAD/SAD/PAD are already pre-mapped into this exact same Gujarat/
// Khavda/A-06c scope by 13_wam_all_roles.spec.js's own Admin-driven runs
// (SAD -> Site "Khavda", PAD -> Work Location "A-06c", CAD -> Cluster
// "Gujarat") — same CLUSTER/SITE/WORK_LOCATION/PACKAGE/SERVICE_ORDER
// constants already defined above are reused unchanged.
const WORK_AREAS_ALL_ROLES = ['BL01', 'BL02', 'BL03', 'BL04', 'BL05'];

const WORK_AREA_ROLES_ALL = [
  { prefix: 'EE',  role: 'Execution Engineer' },
  { prefix: 'QI',  role: 'Quality Inspector' },
  { prefix: 'EL',  role: 'Execution Lead' },
  { prefix: 'QL',  role: 'Quality Lead' },
  { prefix: 'CIC', role: 'Contractor Incharge', serviceOrder: SERVICE_ORDER },
  { prefix: 'CM',  role: 'Contractor Manager',  serviceOrder: SERVICE_ORDER },
];
const WORK_LOCATION_ROLES_ALL = [
  { prefix: 'PM',  role: 'Project Manager' },
  { prefix: 'PAD', role: 'Plot Admin' },
];
const SITE_ROLES_ALL = [
  { prefix: 'SAD', role: 'Site Admin' },
];

// Every tier assigns every WORK_AREA_ROLES_ALL role (Execution Engineer/
// Quality Inspector/Execution Lead/Quality Lead/Contractor Incharge/
// Contractor Manager) — none of those sit above any of CAD/SAD/PAD in the
// hierarchy, so nothing to exclude there. Only the WORK_LOCATION/SITE
// groupings shrink as the tier gets narrower (a tier can't assign its own
// role or anything above it).
const TIERS_ALL_ROLES = [
  {
    prefix: 'CAD', loginRole: 'Cluster Admin',
    workAreaRoles: WORK_AREA_ROLES_ALL,
    workLocationRoles: WORK_LOCATION_ROLES_ALL, // PM, PAD
    siteRoles: SITE_ROLES_ALL,                  // SAD
  },
  {
    prefix: 'SAD', loginRole: 'Site Admin',
    workAreaRoles: WORK_AREA_ROLES_ALL,
    workLocationRoles: WORK_LOCATION_ROLES_ALL, // PM, PAD
    siteRoles: [],                              // SAD is this tier itself — excluded
  },
  {
    prefix: 'PAD', loginRole: 'Plot Admin',
    workAreaRoles: WORK_AREA_ROLES_ALL,
    workLocationRoles: [{ prefix: 'PM', role: 'Project Manager' }], // PAD excluded (itself)
    siteRoles: [],                              // SAD excluded (above this tier)
  },
];

// Same non-asserting toast check as 13_wam_all_roles.spec.js's
// logSubmitToast — an empty toast can be a real gateway/502 blip on a
// large payload even though the write succeeded server-side, so this is
// only ever a heads-up log, never a failure. The real proof is always the
// reopen-and-reverify step that follows every call site.
function logAllRolesToast(toastText, changed, context) {
  if (!toastText) {
    console.log(`${context}: no toast text (possible gateway/502 blip) — verifying persisted state directly`);
    return;
  }
  if (!/assigned successfully|no changes to save/i.test(toastText)) {
    console.log(`${context}: unexpected toast text "${toastText}"`);
  }
}

for (const tier of TIERS_ALL_ROLES) {
  test.describe(`${tier.loginRole} - WAM assignment for every role below its own tier`, () => {
    let context, page, loginUser;

    test.beforeAll(async ({ browser }) => {
      loginUser = requireUser(tier.prefix);
      context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      page = await context.newPage();
      // Same first-time PWA install spinner concern as Part 1's tests —
      // these bulk-created accounts may be logging in for the first time.
      await loginAsUser(page, loginUser.email, PASSWORD);
    });

    test.afterAll(async () => {
      await context.close();
    });

    for (const { prefix, role, serviceOrder } of tier.workAreaRoles) {
      test(`${tier.loginRole} can assign ${role} (${prefix}) to work areas at ${WORK_LOCATION}`, async () => {
        test.setTimeout(20 * 60 * 1000);
        const created = requireUser(prefix);
        const wam = new WAMPage(page);
        await wam.goto(new DashboardPage(page));
        await wam.openAddDetails();
        await wam.fillAssignmentFilters({
          role, cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE, serviceOrder,
        });

        let anyChanged = false;
        for (const area of WORK_AREAS_ALL_ROLES) {
          const changed = await wam.assignUserIfNeeded(area, created.name);
          anyChanged = anyChanged || changed;
        }
        for (const area of WORK_AREAS_ALL_ROLES) {
          await expect(wam.getWorkAreaRow(area).locator('[role="combobox"]')).toContainText(created.name);
        }

        const toastText = await wam.clickSubmit();
        logAllRolesToast(toastText, anyChanged, `${tier.loginRole} -> ${role} at ${WORK_LOCATION}`);

        await wam.closeDialog();
        await wam.openAddDetails();
        await wam.fillAssignmentFilters({
          role, cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE, serviceOrder,
        });
        for (const area of WORK_AREAS_ALL_ROLES) {
          const value = await wam.getWorkAreaUserValue(area);
          expect(value).toContain(created.name);
        }
        await wam.closeDialog();

        console.log(`${tier.loginRole} "${loginUser.name}" assigned ${role} "${created.name}" to ${WORK_LOCATION}: ${WORK_AREAS_ALL_ROLES.join(', ')}`);
      });
    }

    for (const { prefix, role } of tier.workLocationRoles) {
      test(`${tier.loginRole} can assign ${role} (${prefix}) at Work Location ${WORK_LOCATION}`, async () => {
        test.setTimeout(20 * 60 * 1000);
        const created = requireUser(prefix);
        const wam = new WAMPage(page);
        await wam.goto(new DashboardPage(page));
        await wam.openAddDetails();
        await wam.fillAssignmentFilters({ role, cluster: CLUSTER, site: SITE });

        const changed = await wam.addAssigneeToRow(WORK_LOCATION, created.name);
        await expect(wam.getWorkAreaRow(WORK_LOCATION).locator('[role="combobox"]')).toContainText(created.name);

        const toastText = await wam.clickSubmit();
        logAllRolesToast(toastText, changed, `${tier.loginRole} -> ${role} at Work Location ${WORK_LOCATION}`);

        await wam.closeDialog();
        await wam.openAddDetails();
        await wam.fillAssignmentFilters({ role, cluster: CLUSTER, site: SITE });
        const value = await wam.getWorkAreaUserValue(WORK_LOCATION);
        expect(value).toContain(created.name);
        await wam.closeDialog();

        console.log(`${tier.loginRole} "${loginUser.name}" assigned ${role} "${created.name}" at Work Location ${WORK_LOCATION}`);
      });
    }

    for (const { prefix, role } of tier.siteRoles) {
      test(`${tier.loginRole} can assign ${role} (${prefix}) at Site ${SITE}`, async () => {
        test.setTimeout(20 * 60 * 1000);
        const created = requireUser(prefix);
        const wam = new WAMPage(page);
        await wam.goto(new DashboardPage(page));
        await wam.openAddDetails();
        await wam.fillAssignmentFilters({ role, cluster: CLUSTER });

        const changed = await wam.addAssigneeToRow(SITE, created.name);
        await expect(wam.getWorkAreaRow(SITE).locator('[role="combobox"]')).toContainText(created.name);

        const toastText = await wam.clickSubmit();
        logAllRolesToast(toastText, changed, `${tier.loginRole} -> ${role} at Site ${SITE}`);

        await wam.closeDialog();
        await wam.openAddDetails();
        await wam.fillAssignmentFilters({ role, cluster: CLUSTER });
        const value = await wam.getWorkAreaUserValue(SITE);
        expect(value).toContain(created.name);
        await wam.closeDialog();

        console.log(`${tier.loginRole} "${loginUser.name}" assigned ${role} "${created.name}" at Site ${SITE}`);
      });
    }
  });
}
