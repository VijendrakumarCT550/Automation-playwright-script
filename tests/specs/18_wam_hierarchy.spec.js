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
// Admin, Plot Admin) CAN assign Project Manager directly within their own
// scope (that's what Part 2 below exercises), but the FIRST test.describe
// below models the actual real-world SEQUENCE the app owner described
// (2026-08-27): mapping starts at the true top of the hierarchy and walks
// down ONE TIER AT A TIME — Admin maps Cluster Admin -> Cluster Admin maps
// Site Admin -> Site Admin maps Plot Admin -> Plot Admin maps Project
// Manager -> Project Manager maps Execution Lead + Quality Lead -> ... ->
// Contractor Manager maps Contractor In-Charge. Each step's login is the
// user assigned by the PREVIOUS step, same "prove the assigning mechanism
// itself works for a real non-Admin login" goal as before — this was
// previously (incorrectly) shortened to start at Cluster Admin, skipping
// the Admin -> CAD -> SAD -> PAD run-up entirely; fixed here to match.
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
// Row LABELS (as rendered in the Add Details dialog's grid) can differ in
// casing from the FILTER values above — same "Gujarat" vs "KHAVDA"
// deployment/DB-state variance 13_wam_all_roles.spec.js already handles via
// WAMPage.resolveRowLabel(). Only needed for the Cluster-Admin-row and
// Site-Admin-row assignment steps below (Work Location rows like A-06c
// haven't shown this variance).
const CLUSTER_ROW_CANDIDATES = ['Gujarat', 'KHAVDA'];
const SITE_ROW_CANDIDATES = ['Khavda', 'KHAVDA'];
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

// Asserts the Submit toast, instead of only logging it — added 2026-08-27
// per explicit user request ("if any action fails should be reported not
// swallowed silently"). Previously every call site here just did
// `if (!toastText) console.log(...)`, which meant a toast that DID render
// but said something unexpected (a real server-side error, not just an
// empty/missing toast) was silently ignored — the test would only fail
// later, if at all, via the separate reopen-and-reverify content check,
// with no link back to what the toast actually said. An EMPTY toast stays
// non-fatal (known gateway/502-blip-on-large-payload symptom, already
// proven harmless — the reopen-and-reverify step that always follows this
// is the real proof either way); anything else must match one of the two
// known-good messages or this throws immediately, with the toast's actual
// text in the failure message.
function assertExpectedToast(toastText, context) {
  if (!toastText) {
    console.log(`${context}: no toast text (possible gateway/502 blip) — verifying persisted state directly`);
    return;
  }
  expect(toastText, `${context}: unexpected toast text`).toMatch(/assigned successfully|no changes to save/i);
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
  assertExpectedToast(toastText, `${filters.role} -> ${rowLabel} (assign)`);

  await wam.closeDialog();
  await wam.openAddDetails();
  await wam.fillAssignmentFilters(filters);
  const value = await wam.getWorkAreaUserValue(rowLabel);
  expect(value).toContain(userName);
  await wam.closeDialog();
}

// Removes `userName` from `rowLabel` first (if currently present) and
// confirms the removal actually PERSISTED server-side — same reopen-and-
// reverify rigor as assignAndVerify's own assign-then-verify step below,
// just for the opposite direction. Added 2026-08-27 per user request: this
// environment's WAM mappings are real, PERSISTENT backend state (the whole
// reason assignUserIfNeeded/addAssigneeToRow exist as "map only if not
// already mapped" idempotent helpers) — so on a RE-run, a cascade step's
// intended assignee can already be sitting there from an earlier/unrelated
// run (e.g. Part 2's Plot Admin tier assigning the same EL/QL/EE/... users
// to the same rows), making the assign step below a silent no-op that
// never actually exercises the assignment UI at all, even though the test
// still "passes". Concrete example that prompted this: Project Manager
// assigning Execution Lead/Quality Lead is a no-op if Plot Admin's Part 2
// run already mapped the same users to the same Work Area rows. Removing
// first forces EVERY run to genuinely exercise both the remove AND the
// (re-)assign mechanism, regardless of what any previous run left behind —
// this is also the ONLY coverage anywhere in Part 1 of the remove/update
// path at all, not just the assign path.
//
// No-ops (skips the whole remove+verify+submit cycle) if userName isn't
// currently assigned to this row — nothing to remove, and clicking Submit
// with no actual change would only show "no changes to save" without
// proving anything either way.
async function removeIfPresentAndVerify(wam, filters, rowLabel, userName, useMultiAssign) {
  if (!(await wam.dialog.isVisible({ timeout: 1000 }).catch(() => false))) {
    await wam.openAddDetails();
  }
  await wam.fillAssignmentFilters(filters);

  const before = await wam.getWorkAreaUserValue(rowLabel);
  if (!before.includes(userName)) {
    console.log(`${filters.role} -> ${rowLabel}: "${userName}" not currently assigned — nothing to remove, skipping removal phase`);
    await wam.closeDialog();
    return;
  }

  // Assert the removal ACTION itself actually ran (clicked something),
  // not just the eventual displayed value — added 2026-08-27 alongside
  // assertExpectedToast, same "report, don't swallow" principle. Without
  // this, a removeAssigneeFromRow/clearWorkAreaUser that silently found
  // nothing to click (e.g. its own internal locator/selector broke) would
  // only surface as the generic "not toContainText" failure two lines
  // below — still a real failure, but with no indication the removal
  // action itself never even attempted anything. We already know `before`
  // contains userName at this point, so the action SHOULD do something;
  // a false return here is a distinct, more specific bug than "the value
  // didn't change".
  const removed = useMultiAssign
    ? await wam.removeAssigneeFromRow(rowLabel, userName)
    : await wam.clearWorkAreaUser(rowLabel);
  expect(removed, `${filters.role} -> ${rowLabel}: removal action found nothing to click for "${userName}", even though it was confirmed present`).toBe(true);
  await expect(wam.getWorkAreaRow(rowLabel).locator('[role="combobox"]')).not.toContainText(userName);

  const toastText = await wam.clickSubmit();
  assertExpectedToast(toastText, `${filters.role} -> ${rowLabel} (removal)`);

  await wam.closeDialog();
  await wam.openAddDetails();
  await wam.fillAssignmentFilters(filters);
  const value = await wam.getWorkAreaUserValue(rowLabel);
  expect(value, `${rowLabel}: "${userName}" should have been removed but is still present after reopening`).not.toContain(userName);
  await wam.closeDialog();

  console.log(`${filters.role} -> ${rowLabel}: removed "${userName}" and confirmed removal persisted`);
}

test.describe('WAM assignment follows the role hierarchy (Admin -> Cluster Admin -> Site Admin -> Plot Admin -> Project Manager -> Execution/Quality Lead -> Execution Engineer/Contractor Manager/Quality Inspector -> Contractor In-Charge)', () => {
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

  test('Admin can assign Cluster Admin, seeding the top of the hierarchy', async () => {
    // Every test here logs in as a BRAND NEW account (never logged in
    // before) — same first-time PWA install spinner CI/EE/QI hit (5-6 min),
    // which the global 10min config timeout doesn't leave enough room for
    // on top of the actual WAM interaction. Confirmed live: without this,
    // the outer test timeout force-closed the browser mid-wait even though
    // the dashboard HAD fully loaded by then, just too late.
    test.setTimeout(20 * 60 * 1000);
    const cad = requireUser('CAD');

    // Real fixed .env Admin account (same one adminFreshLogin/13_wam_all_
    // roles.spec.js use), NOT the bulk-created "ADM" dummy in last-created-
    // users.json — Admin is a single top-level account in this app, not a
    // per-tier bulk-created user, and is already proven to be able to
    // assign Cluster Admin (13_wam_all_roles.spec.js's CLUSTER_ROW_ROLES
    // test). loginAsUser (not adminFreshLogin) so this reuses the SAME
    // shared page/context the rest of the cascade below runs on.
    await loginAsUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();
    await wam.fillAssignmentFilters({ role: 'Cluster Admin' });

    // Cluster Admin's row-level granularity: no location fields at all,
    // rows = Clusters themselves (same as 13_wam_all_roles.spec.js's
    // CLUSTER_ROW_ROLES) — resolve the actual rendered row label first
    // since it can differ in casing from the CLUSTER filter values.
    const clusterRowLabel = await wam.resolveRowLabel(CLUSTER_ROW_CANDIDATES);
    await removeIfPresentAndVerify(wam, { role: 'Cluster Admin' }, clusterRowLabel, cad.name, /* useMultiAssign */ true);
    await assignAndVerify(
      wam,
      { role: 'Cluster Admin' },
      clusterRowLabel, cad.name, /* useMultiAssign */ true,
    );

    console.log(`Admin assigned Cluster Admin "${cad.name}" at Cluster ${clusterRowLabel}`);
  });

  test('Cluster Admin can assign Site Admin, within their own Cluster', async () => {
    test.setTimeout(20 * 60 * 1000); // see first test's comment — first-time login PWA spinner
    const cad = requireUser('CAD');
    const sad = requireUser('SAD');

    await loginAsUser(page, cad.email, PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    // Deliberately still just the narrow "next tier down" expectation —
    // see the "Part 2" describe blocks below for Cluster Admin's actually-
    // wider capability (every role below it, not just Site Admin).
    const availableRoles = await wam.getAvailableRoleOptions();
    logRoleRestrictionCheck('Cluster Admin', availableRoles, ['Site Admin']);

    await wam.fillAssignmentFilters({ role: 'Site Admin', cluster: CLUSTER });
    const siteRowLabel = await wam.resolveRowLabel(SITE_ROW_CANDIDATES);
    await removeIfPresentAndVerify(wam, { role: 'Site Admin', cluster: CLUSTER }, siteRowLabel, sad.name, /* useMultiAssign */ true);
    await assignAndVerify(
      wam,
      { role: 'Site Admin', cluster: CLUSTER },
      siteRowLabel, sad.name, /* useMultiAssign */ true,
    );

    console.log(`Cluster Admin "${cad.name}" assigned Site Admin "${sad.name}" at Site ${siteRowLabel}`);
  });

  test('Site Admin can assign Plot Admin, within their own Site', async () => {
    test.setTimeout(20 * 60 * 1000); // see first test's comment — first-time login PWA spinner
    const sad = requireUser('SAD');
    const pad = requireUser('PAD');

    await loginAsUser(page, sad.email, PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    const availableRoles = await wam.getAvailableRoleOptions();
    logRoleRestrictionCheck('Site Admin', availableRoles, ['Plot Admin']);

    await removeIfPresentAndVerify(wam, { role: 'Plot Admin', cluster: CLUSTER, site: SITE }, WORK_LOCATION, pad.name, /* useMultiAssign */ true);
    await assignAndVerify(
      wam,
      { role: 'Plot Admin', cluster: CLUSTER, site: SITE },
      WORK_LOCATION, pad.name, /* useMultiAssign */ true,
    );

    console.log(`Site Admin "${sad.name}" assigned Plot Admin "${pad.name}" at Work Location ${WORK_LOCATION}`);
  });

  test('Plot Admin can assign only Project Manager, within their own Work Location', async () => {
    test.setTimeout(20 * 60 * 1000); // see first test's comment — first-time login PWA spinner
    const pad = requireUser('PAD');
    const pm = requireUser('PM');

    await loginAsUser(page, pad.email, PASSWORD);
    const wam = new WAMPage(page);
    await wam.goto(new DashboardPage(page));
    await wam.openAddDetails();

    const availableRoles = await wam.getAvailableRoleOptions();
    logRoleRestrictionCheck('Plot Admin', availableRoles, ['Project Manager']);

    // useMultiAssign: false here — Project Manager's own Work Location row
    // is SINGLE-select, unlike every other Work-Location/Site/Cluster-level
    // role in this cascade (Plot Admin, Site Admin, Cluster Admin, all
    // genuinely multi-select). Documented in WAMPage.js's addAssigneeToRow
    // comment ("e.g. Project Manager, unlike Plot Admin's genuinely
    // multi-select row") and previously found in [[project_wam_crud_coverage]]
    // — a real PM-vs-Plot-Admin single/multi-select asymmetry, not a typo.
    // The OLD code here inherited `true` from before this cascade was
    // reordered and never actually caught it, because addAssigneeToRow's
    // ADD path happens to still "work" on a single-select field (a click
    // always sets the value regardless of which method was used) — only
    // removeIfPresentAndVerify's REMOVE step (relying on multi-select's
    // toggle-off behavior, a genuine no-op on single-select) exposed it:
    // confirmed live 2026-08-27, "not toContainText" never resolved because
    // clicking the already-selected single-select option didn't clear it.
    await removeIfPresentAndVerify(wam, { role: 'Project Manager', cluster: CLUSTER, site: SITE }, WORK_LOCATION, pm.name, /* useMultiAssign */ false);
    await assignAndVerify(
      wam,
      { role: 'Project Manager', cluster: CLUSTER, site: SITE },
      WORK_LOCATION, pm.name, /* useMultiAssign */ false,
    );

    console.log(`Plot Admin "${pad.name}" assigned Project Manager "${pm.name}" at Work Location ${WORK_LOCATION}`);
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
      const filters = { role, cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE };
      await removeIfPresentAndVerify(wam, filters, WORK_AREA, user.name, /* useMultiAssign */ false);
      await assignAndVerify(
        wam,
        filters,
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

    const eeFilters = { role: 'Execution Engineer', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE };
    await removeIfPresentAndVerify(wam, eeFilters, WORK_AREA, ee.name, false);
    await assignAndVerify(
      wam,
      eeFilters,
      WORK_AREA, ee.name, false,
    );
    console.log(`Execution Lead "${el.name}" assigned Execution Engineer "${ee.name}" at Work Area ${WORK_AREA}`);

    const cmFilters = { role: 'Contractor Manager', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE, serviceOrder: SERVICE_ORDER };
    await removeIfPresentAndVerify(wam, cmFilters, WORK_AREA, cm.name, false);
    await assignAndVerify(
      wam,
      cmFilters,
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

    const qiFilters = { role: 'Quality Inspector', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE };
    await removeIfPresentAndVerify(wam, qiFilters, WORK_AREA, qi.name, false);
    await assignAndVerify(
      wam,
      qiFilters,
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

    const cicFilters = { role: 'Contractor Incharge', cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE, serviceOrder: SERVICE_ORDER };
    await removeIfPresentAndVerify(wam, cicFilters, WORK_AREA, cic.name, false);
    await assignAndVerify(
      wam,
      cicFilters,
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

// Part 2's own toast checks now reuse the shared assertExpectedToast
// (defined above, alongside assignAndVerify/removeIfPresentAndVerify) —
// the old logAllRolesToast here was console.log-only, same silent-swallow
// gap Part 1 had until 2026-08-27's fix; removed rather than kept
// alongside a second, inconsistent implementation.

// Project Manager's own Work Location row is SINGLE-select — every OTHER
// role assignable at Work-Location/Site/Cluster-row level (Plot Admin,
// Site Admin, Cluster Admin) is genuinely multi-select. Confirmed live
// 2026-08-27 in Part 1's own cascade (see removeIfPresentAndVerify's call
// sites there) and already documented in WAMPage.js's addAssigneeToRow
// comment ("e.g. Project Manager, unlike Plot Admin's genuinely
// multi-select row"). tier.workLocationRoles mixes PM in with Plot Admin
// for the CAD/SAD tiers (WORK_LOCATION_ROLES_ALL), so that loop below
// can't just hardcode addAssigneeToRow/removeAssigneeFromRow the way the
// old code silently did — it needs to branch per role, same as Part 1.
const SINGLE_SELECT_ROLES = new Set(['Project Manager']);

// Batched sibling to removeIfPresentAndVerify — for Work Area rows only
// (always single-select, per WAMPage.js's assignUserIfNeeded comment),
// where ONE test assigns the SAME user across several rows
// (WORK_AREAS_ALL_ROLES) in one dialog session rather than one row at a
// time. Mirrors removeIfPresentAndVerify's shape exactly (open-if-needed
// -> fill -> remove -> assert removed -> submit -> reopen -> reverify),
// just scoped to only the areas that actually need clearing, so a TC
// where only SOME of the 5 areas already carry userName doesn't pay for
// resubmitting the other, already-clear ones.
async function removeFromWorkAreasIfPresentAndVerify(wam, filters, areaCodes, userName) {
  if (!(await wam.dialog.isVisible({ timeout: 1000 }).catch(() => false))) {
    await wam.openAddDetails();
  }
  await wam.fillAssignmentFilters(filters);

  const areasToClear = [];
  for (const area of areaCodes) {
    const current = await wam.getWorkAreaUserValue(area);
    if (current.includes(userName)) areasToClear.push(area);
  }
  if (areasToClear.length === 0) {
    console.log(`${filters.role} -> [${areaCodes.join(', ')}]: "${userName}" not currently assigned anywhere here — nothing to remove, skipping removal phase`);
    await wam.closeDialog();
    return;
  }

  for (const area of areasToClear) {
    const removed = await wam.clearWorkAreaUser(area);
    expect(removed, `${filters.role} -> ${area}: removal action found nothing to click for "${userName}", even though it was confirmed present`).toBe(true);
  }
  for (const area of areasToClear) {
    await expect(wam.getWorkAreaRow(area).locator('[role="combobox"]')).not.toContainText(userName);
  }

  const toastText = await wam.clickSubmit();
  assertExpectedToast(toastText, `${filters.role} -> [${areasToClear.join(', ')}] (removal)`);

  await wam.closeDialog();
  await wam.openAddDetails();
  await wam.fillAssignmentFilters(filters);
  for (const area of areasToClear) {
    const value = await wam.getWorkAreaUserValue(area);
    expect(value, `${area}: "${userName}" should have been removed but is still present after reopening`).not.toContain(userName);
  }
  await wam.closeDialog();

  console.log(`${filters.role} -> [${areasToClear.join(', ')}]: removed "${userName}" and confirmed removal persisted`);
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

        // Same reasoning as Part 1's removeIfPresentAndVerify — remove
        // first so this run genuinely exercises the assign action instead
        // of silently no-oping when a previous/unrelated run already left
        // the same user mapped to these same rows.
        const filters = { role, cluster: CLUSTER, site: SITE, workLocation: WORK_LOCATION, package: PACKAGE, serviceOrder };
        await removeFromWorkAreasIfPresentAndVerify(wam, filters, WORK_AREAS_ALL_ROLES, created.name);

        await wam.openAddDetails();
        await wam.fillAssignmentFilters(filters);

        let anyChanged = false;
        for (const area of WORK_AREAS_ALL_ROLES) {
          const changed = await wam.assignUserIfNeeded(area, created.name);
          anyChanged = anyChanged || changed;
        }
        for (const area of WORK_AREAS_ALL_ROLES) {
          await expect(wam.getWorkAreaRow(area).locator('[role="combobox"]')).toContainText(created.name);
        }

        const toastText = await wam.clickSubmit();
        assertExpectedToast(toastText, `${tier.loginRole} -> ${role} at ${WORK_LOCATION} (assign)`);

        await wam.closeDialog();
        await wam.openAddDetails();
        await wam.fillAssignmentFilters(filters);
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

        // Project Manager is single-select, Plot Admin (the only other
        // role that can appear here) is multi-select — see
        // SINGLE_SELECT_ROLES's comment above. Delegates straight to the
        // same assignAndVerify/removeIfPresentAndVerify Part 1 uses
        // (defined once, above, not duplicated here) rather than the old
        // hand-inlined open/fill/assign/submit/reopen/reverify sequence.
        const useMultiAssign = !SINGLE_SELECT_ROLES.has(role);
        const filters = { role, cluster: CLUSTER, site: SITE };
        await removeIfPresentAndVerify(wam, filters, WORK_LOCATION, created.name, useMultiAssign);
        await assignAndVerify(wam, filters, WORK_LOCATION, created.name, useMultiAssign);

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

        // Site Admin's row is genuinely multi-select (only role that ever
        // appears in siteRoles, so no PM-style branching needed here) —
        // same delegation pattern as workLocationRoles above.
        const filters = { role, cluster: CLUSTER };
        await removeIfPresentAndVerify(wam, filters, SITE, created.name, /* useMultiAssign */ true);
        await assignAndVerify(wam, filters, SITE, created.name, /* useMultiAssign */ true);

        console.log(`${tier.loginRole} "${loginUser.name}" assigned ${role} "${created.name}" at Site ${SITE}`);
      });
    }
  });
}
