const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { openAssignmentDialog, assignAndProve } = require('../utils/smoke-wam');

// Feature stage SM11: the smoke replica of 06_wam.spec.js — Admin assigns the
// plain (non-vendor) work-area roles across a band of work areas in ONE dialog
// and proves each row persisted.
//
// This is the baseline WAM screen with none of the complications: Execution
// Engineer and Quality Inspector render no Service Order field (that is SM12's
// subject) and their rows are work areas (not the Cluster/Site/Work-Location
// rows the admin tiers get, which is SM13's).
//
// ---------------------------------------------------------------------------
// TWO SUBSTANTIVE CHANGES FROM THE ORIGINAL
// ---------------------------------------------------------------------------
// 1. USERS. 06_wam.spec.js hardcoded two real roster names ('Jay Kishan
//    Suthar', 'Udit Sharma'). Those are neither ours nor stable — a roster
//    change breaks the spec, and assigning strangers to rows is a side effect
//    on somebody else's data. This resolves SM01's EE and QI for THIS run
//    instead, so the stage owns the identities it assigns.
//
// 2. GROUND. The original swept A-06c / BL01-BL10. A-06c is the app owner's
//    manual-testing ground that smoke must never touch, and BL01-BL10 there
//    spans the regression tier's own areas. This uses featureGround.wamSweep on
//    S05b — see tests/config/projects.js for the full allocation.
//
// Scale also drops from ten rows to the two wamSweep declares, deliberately:
// the behaviour under test is "several rows, one dialog, one Submit, all
// persist", which two rows prove exactly as well as ten. Ten was about giving
// the app owner bulk mappings to look at manually, which is not what a smoke
// leaf is for.
//
// WHY THESE ROWS ARE NOT PRE-MAPPED BY SM03: assigning here IS the coverage.
// smokeMappedWorkAreas() deliberately excludes wamSweep so that
// assignUserIfNeeded() has a real change to make on the first run of a fresh
// batch — otherwise every assertion would take the "No changes to save" path
// and never prove a write at all.
//
// NOT serial mode. The two role tests are fully independent (each opens its
// own dialog fresh) and `serial` would mean EE's failure skips QI's test
// outright — see SM01's comment for the full reasoning and the 137-test
// incident that motivated removing this everywhere it wasn't load-bearing.

// Module constant: the per-role tests are generated at COLLECTION time, before
// the `profile` fixture exists. beforeAll then checks the profile agrees.
const ROLES = ['EE', 'QI'];

test.describe('Smoke stage SM11 - WAM basics, plain work-area roles', () => {
  let context, page, dashboard, profile, users, areas;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    const ground = requireFeatureGround(profile);

    areas = (ground.wamSweep || []).filter(Boolean);
    expect(
      areas.length,
      `Profile "${profile.key}" declares no featureGround.wamSweep areas, so this ` +
      `stage has no rows to assign. See tests/config/projects.js.`
    ).toBeGreaterThan(0);

    // Resolves SM01's users for THIS run, checking both that they belong to this
    // profile and that they were created against THIS deployment — an
    // undefined name reaching a dropdown search fails as an inscrutable timeout.
    users = resolveSmokeUsers(profile, ROLES);

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    console.log(
      `\n=== SM11 WAM basics: "${profile.key}" -> ${profile.workLocations[0]} / ` +
      `${profile.packages[0]}\n` +
      `    rows (featureGround.wamSweep): ${areas.join(', ')}`
    );
    for (const r of ROLES) console.log(`    ${r} (${users[r].role}): ${users[r].name}`);
    console.log('');
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  for (const roleKey of ROLES) {
    test(`Admin can assign the ${roleKey} user across the work-area band and it persists`, async () => {
      const user = users[roleKey];

      const filters = {
        role: user.role,
        cluster: profile.cluster,
        site: profile.site,
        workLocation: profile.workLocations[0],
        package: profile.packages[0],
        // AGEL roles render NO Service Order field. Passing null rather than
        // omitting it documents that this is a known absence rather than an
        // oversight; fillAssignmentFilters skips any field that isn't visible.
        serviceOrder: null,
      };

      const wam = await openAssignmentDialog(page, dashboard, filters);

      // Confirm the dialog really is showing work-AREA rows before asserting on
      // them. For these two roles the cascade goes all the way to Package and
      // the rows are work areas; if a future app change made it stop at Sites
      // (as it does for Project Manager) the row lookups below would time out
      // with nothing to say why.
      await expect(
        wam.getWorkAreaRow(areas[0]),
        `${user.role}: expected work-AREA rows (found no row "${areas[0]}"). If the ` +
        `WAM cascade for this role has changed depth, the row granularity changed ` +
        `with it — see fillAssignmentFilters' role-dependent-depth note.`
      ).toBeVisible({ timeout: 20000 });

      await assignAndProve(wam, {
        filters,
        entries: areas.map((row) => ({ row, userName: user.name })),
        multi: false, // EE/QI work-area rows are single-assignee
        label: roleKey,
      });
    });
  }
});
