const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { openAssignmentDialog, assignAndProve } = require('../utils/smoke-wam');
const WAMPage = require('../pages/WAMPage');

// Feature stage SM13: the smoke replica of 13_wam_all_roles.spec.js — Admin
// assigns EVERY one of the ten created roles, at whichever row granularity that
// role actually uses.
//
// ---------------------------------------------------------------------------
// THE POINT OF THIS STAGE: ROW GRANULARITY IS ROLE-DEPENDENT
// ---------------------------------------------------------------------------
// WAM's filter cascade stops at a different depth per role, and the rows you get
// are whatever level it stopped at. Confirmed live (see
// WAMPage.fillAssignmentFilters):
//
//   EE / QI / EL / QL / CIC / CM   cascade to Package  -> rows are WORK AREAS
//   Project Manager / Plot Admin   cascade to Sites    -> rows are WORK LOCATIONS
//   Site Admin                     cascade to Cluster  -> rows are SITES
//   Cluster Admin                  no location fields  -> rows are CLUSTERS
//
// So this cannot be one loop over one row list — it is four groups, and getting
// the group wrong means the row lookup times out with nothing explaining why.
// SM11 and SM12 cover the work-area group in depth (plain vs Service-Order
// gated); this one's job is BREADTH: every role, at its own level, once.
//
// ---------------------------------------------------------------------------
// GROUND, AND THE EVICTION THE ORIGINAL WOULD HAVE CAUSED
// ---------------------------------------------------------------------------
// The original swept S05b / BL01-BL05. That overlaps BL01 (02_rfi_ci), BL02 (the
// tracked 9-TC regression) and BL03/BL04/BL05 — the smoke flow areas themselves.
// Because Contractor Incharge and Quality Inspector rows are SINGLE-ASSIGNEE,
// sweeping there EVICTS whoever held the row: this stage would have quietly
// unmapped the smoke flow users from their own flow ground, and the symptom
// would not appear until a later run failed at a Work Area dropdown.
//
// It now sweeps featureGround.wamSweep, which nothing else uses.
//
// The higher-tier rows (work location / site / cluster) are NOT isolatable the
// same way — there is only one S05b, one Khavda and one Gujarat — but they are
// MULTI-assignee, so adding someone alongside the existing holders evicts
// nobody. That asymmetry is exactly why `multi` is set per group below.
//
// NOT serial mode. All ten per-role tests are independent — each resolves its
// own filters and opens its own dialog — so one role's failure must not skip
// the other nine. See SM01's comment for the full reasoning and the 137-test
// incident that motivated removing this everywhere it wasn't load-bearing.

// Row-granularity groups. Module constants because the tests are generated at
// COLLECTION time, before the `profile` fixture exists.
const WORK_AREA_ROLES = ['EE', 'QI', 'EL', 'QL', 'CI', 'CM'];
const WORK_LOCATION_ROLES = ['PM', 'PAD'];
const SITE_ROLES = ['SAD'];
const CLUSTER_ROLES = ['CAD'];
const ALL_ROLES = [
  ...WORK_AREA_ROLES, ...WORK_LOCATION_ROLES, ...SITE_ROLES, ...CLUSTER_ROLES,
];

test.describe('Smoke stage SM13 - WAM assignment for every created role', () => {
  let context, page, dashboard, profile, users, areas;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    const ground = requireFeatureGround(profile);

    areas = (ground.wamSweep || []).filter(Boolean);
    expect(
      areas.length,
      `Profile "${profile.key}" declares no featureGround.wamSweep areas.`
    ).toBeGreaterThan(0);

    users = resolveSmokeUsers(profile, ALL_ROLES);

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    console.log(
      `\n=== SM13 WAM all roles: "${profile.key}" ===\n` +
      `    work-area rows     : ${areas.join(', ')} @ ${profile.workLocations[0]}\n` +
      `    work-location row  : ${profile.workLocations[0]}\n` +
      `    site row           : ${profile.site}\n` +
      `    cluster row        : ${JSON.stringify(profile.cluster)}`
    );
    for (const r of ALL_ROLES) console.log(`    ${r.padEnd(4)} ${users[r].role.padEnd(22)} ${users[r].name}`);
    console.log('');
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  // ---- Group 1: WORK AREA rows (cascade to Package) ----
  for (const roleKey of WORK_AREA_ROLES) {
    test(`Admin can assign ${roleKey} at work-area granularity`, async () => {
      const user = users[roleKey];
      const filters = {
        role: user.role,
        cluster: profile.cluster,
        site: profile.site,
        workLocation: profile.workLocations[0],
        package: profile.packages[0],
        // Only the vendor roles render this; fillAssignmentFilters skips it for
        // the rest. Precise SO first, vendor name as fallback — a vendor can
        // hold several SOs and a name-only match can pick the wrong one.
        serviceOrder: user.userType === 'VENDOR'
          ? [profile.vendor.serviceOrder, profile.vendor.name]
          : null,
      };

      const wam = await openAssignmentDialog(page, dashboard, filters);
      await assignAndProve(wam, {
        filters,
        entries: areas.map((row) => ({ row, userName: user.name })),
        multi: false, // work-area rows are single-assignee
        label: roleKey,
      });
    });
  }

  // ---- Group 2: WORK LOCATION rows (cascade stops at Sites) ----
  for (const roleKey of WORK_LOCATION_ROLES) {
    test(`Admin can assign ${roleKey} at work-location granularity`, async () => {
      const user = users[roleKey];
      // NO workLocation/package here — that is the whole distinction. For these
      // roles the work location IS the row, so filtering by it would leave
      // nothing to assign to.
      const filters = { role: user.role, cluster: profile.cluster, site: profile.site };
      const row = profile.workLocations[0];

      const wam = await openAssignmentDialog(page, dashboard, filters);
      await assignAndProve(wam, {
        filters,
        entries: [{ row, userName: user.name }],
        // MULTI for Plot Admin, SINGLE for Project Manager. Found live
        // 2026-08-21 and recorded in SM04's SINGLE_SELECT_ROLES: PM's
        // work-location row auto-closes on pick (single-select) while Plot
        // Admin's genuinely holds several people. Getting this backwards is not
        // a cosmetic mismatch — pressing Escape at a single-select row that
        // has already closed its own popover lets the key BUBBLE and closes the
        // whole dialog, leaving Submit unreachable.
        multi: roleKey === 'PAD',
        label: roleKey,
      });
    });
  }

  // ---- Group 3: SITE rows (cascade stops at Cluster) ----
  for (const roleKey of SITE_ROLES) {
    test(`Admin can assign ${roleKey} at site granularity`, async () => {
      const user = users[roleKey];
      const filters = { role: user.role, cluster: profile.cluster };

      const wam = await openAssignmentDialog(page, dashboard, filters);
      // The rendered row label can differ from what was typed into the Cluster
      // FILTER — confirmed live that a row shows "KHAVDA" even when
      // "Khavda"/"Gujarat" was filtered on. Resolve it against what is actually
      // present rather than assuming.
      const row = await wam.resolveRowLabel([profile.site, profile.site.toUpperCase()]);

      await assignAndProve(wam, {
        filters,
        entries: [{ row, userName: user.name }],
        multi: true, // site rows hold several admins
        label: roleKey,
      });
    });
  }

  // ---- Group 4: CLUSTER rows (no location filters at all) ----
  for (const roleKey of CLUSTER_ROLES) {
    test(`Admin can assign ${roleKey} at cluster granularity`, async () => {
      const user = users[roleKey];
      const filters = { role: user.role };

      const wam = await openAssignmentDialog(page, dashboard, filters);
      const candidates = [].concat(profile.cluster).flatMap((c) => [c, c.toUpperCase()]);
      const row = await wam.resolveRowLabel(candidates);

      await assignAndProve(wam, {
        filters,
        entries: [{ row, userName: user.name }],
        multi: true,
        label: roleKey,
      });
    });
  }
});
