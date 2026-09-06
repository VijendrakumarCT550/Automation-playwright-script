const { test, expect } = require('../config/test-base');
const { runOnlineRoleRegressionSuite } = require('../utils/online-role-regression');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');

// Feature stage SM18: the smoke replica of the seven specs in
// tests/online-roles/ — the extensive per-role sweep for the oversight tiers.
//
// Each role walks its whole application surface: Dashboard (including the
// RFI/NC chart toggles, verified by rendered-content fingerprint rather than
// just tab colour), My Tasks, WAM (including its own-scope view, Add Details
// reachability and tree-visibility compared against Admin's ground truth), SO
// Mapping, Users (search / expand / Add User) and Reports (filter plus
// download-content verification).
//
// ---------------------------------------------------------------------------
// ONE FILE, NOT SEVEN
// ---------------------------------------------------------------------------
// tests/online-roles/ is seven files because the old config needed a whole
// DIRECTORY to make one Playwright project (the `dir` special case in the
// deleted smokeFeatureChain). The seven were never related — they are
// independent per-role checks that share a driver — so as one file with seven
// tests they behave identically and the config loses a special case.
//
// NOT serial, and each test opens its own context inside the shared driver: one
// role's login failure must not skip the other six.
//
// ---------------------------------------------------------------------------
// HOW THIS AVOIDS DUPLICATING ~400 LINES OF DRIVER
// ---------------------------------------------------------------------------
// online-role-regression.js gained ONE optional parameter, `resolveUser`
// (defaulting to its original bare-prefix lookup). The seven regression specs
// pass nothing and are byte-for-byte unaffected; this file injects a resolver
// backed by resolveSmokeUsers(), so the same driver runs as SM01's users for
// the current run. Same injection pattern already proven for `loginAs` on
// rfi-dependency-flow.js.
//
// ---------------------------------------------------------------------------
// GROUND
// ---------------------------------------------------------------------------
// Two of the seven configs name a work location: Plot Admin's Add-User
// jurisdiction check and Project Manager's child-visibility cascade. Both said
// A-06c — the app owner's manual ground. Both now come from the profile.
//
// Plot Admin's jurisdiction check is the interesting one: it asserts that a Plot
// Admin's Add-User "Work Locations" dropdown offers ONLY the locations it
// administers. That scoping was confirmed real in earlier live work, and pointing
// it at the smoke profile makes it a genuine assertion again — the smoke Plot
// Admin is scoped to S05b, so S05b is exactly what it should see.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// prefix here is the SMOKE role key (resolveSmokeUsers' vocabulary), which
// happens to match the bare prefixes for these seven. `roleName` is asserted
// against the recorded role by the driver, so a mismatch fails loudly.
const ROLE_SUITES = [
  {
    key: 'CAD',
    roleName: 'Cluster Admin',
    addUserRoleTarget: 'Site Admin',
    jurisdiction: null,
    // The real tree-visibility test: does this tier see ALL children under its
    // own scope, matching Admin's unrestricted view exactly? Hard-asserted by
    // the driver, not logged — a mismatch is a real bug.
    childVisibilityChecks: [
      { targetRole: 'Site Admin' },   // Cluster -> ALL Sites under it
      { targetRole: 'Plot Admin' },   // Cluster+Site -> ALL Work Locations under it
    ],
  },
  {
    key: 'SAD',
    roleName: 'Site Admin',
    addUserRoleTarget: 'Plot Admin',
    jurisdiction: null,
    childVisibilityChecks: [
      { targetRole: 'Plot Admin' },   // Site -> ALL Work Locations under it
    ],
  },
  {
    key: 'PAD',
    roleName: 'Plot Admin',
    addUserRoleTarget: 'Execution Lead',
    // Filled from the profile below — was hardcoded to A-06c.
    jurisdictionFromProfile: true,
  },
  {
    key: 'PM',
    roleName: 'Project Manager',
    addUserRoleTarget: null,
    jurisdiction: null,
    // Work Location -> ALL Work Areas under it. extraCascade's workLocation is
    // filled from the profile below.
    childVisibilityChecks: [{ targetRole: 'Execution Lead', cascadeFromProfile: true }],
  },
  // EL / QL / CM have no addUserRoleTarget (confirmed earlier: the Add User icon
  // is admin-tier-only — CAD/SAD/PAD have it, PM/EL/QL/CM do not) and no
  // childVisibilityChecks, because their own targets sit at their OWN work-area
  // level rather than a broader one, so there is no further child set to
  // enumerate.
  { key: 'EL', roleName: 'Execution Lead', addUserRoleTarget: null, jurisdiction: null },
  { key: 'QL', roleName: 'Quality Lead', addUserRoleTarget: null, jurisdiction: null },
  { key: 'CM', roleName: 'Contractor Manager', addUserRoleTarget: null, jurisdiction: null },
];

test.describe('Smoke stage SM18 - online-role extensive sweep', () => {
  for (const suite of ROLE_SUITES) {
    test(`${suite.roleName}: dashboard, My Tasks, WAM (incl. tree-visibility vs Admin), SO Mapping, Users, Reports`, async ({ browser, profile }) => {
      // Wide: each childVisibilityCheck adds an Admin login plus a re-login as
      // the role under test, on top of a six-section sweep.
      test.setTimeout(15 * 60 * 1000);

      requireFeatureGround(profile);
      expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

      const workLocation = profile.workLocations[0];

      // Resolve up front so a missing user fails here — with resolveSmokeUsers'
      // message naming exactly which check failed and what to run — rather than
      // deep inside the driver at a dropdown search.
      const users = resolveSmokeUsers(profile, [suite.key]);
      const user = users[suite.key];
      console.log(
        `\n=== SM18 ${suite.roleName} (${suite.key}) ===\n` +
        `    ${user.name} <${user.email}>  scoped to ${workLocation}`
      );

      const jurisdiction = suite.jurisdictionFromProfile
        ? { field: 'Work Locations', expectedOptions: [workLocation] }
        : (suite.jurisdiction || null);

      const childVisibilityChecks = (suite.childVisibilityChecks || []).map((c) =>
        c.cascadeFromProfile
          ? { targetRole: c.targetRole, extraCascade: { workLocation } }
          : c
      );

      await runOnlineRoleRegressionSuite(browser, {
        prefix: suite.key,
        roleName: suite.roleName,
        addUserRoleTarget: suite.addUserRoleTarget,
        jurisdiction,
        childVisibilityChecks,
        // THE injection. Everything above is config the regression specs also
        // pass; this one line is what makes the shared driver run as the smoke
        // tier's own users instead of the bare-prefix batch.
        resolveUser: () => user,
      });
    });
  }
});
