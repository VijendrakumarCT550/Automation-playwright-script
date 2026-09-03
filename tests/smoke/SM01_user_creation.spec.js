const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { nextBatchNumber, generateUserIdentity, recordLastCreatedUser, loadLastCreatedUsers } =
  require('../utils/user-counter-utils');
const UserManagementPage = require('../pages/UserManagementPage');

// Stage 1 of the E2E smoke chain: create the four flow roles for ONE project
// type, scoped to that project type's work locations.
//
// Which project type this runs for is decided by the Playwright project's
// `use: { profileKey }` (see tests/config/test-base.js), so this one file
// serves both wind and solar rather than being copy-pasted per type.
//
// WHY FRESH USERS AT ALL, when tests/specs/ already has working .env
// CI/EE/QI accounts: PULSE users are scoped to a project type and a set of
// work locations, so a solar CI cannot raise a wind RFI. Wind has no CI at
// all yet. Creating them here also makes the chain genuinely end-to-end —
// user creation -> SO mapping -> WAM -> RFI -> NC is exercised as one
// sequence, which is the whole point of the smoke tier.
//
// The prefix encodes the project type (CIWTG vs CISL) so the two never get
// confused, per the app owner. This does NOT touch
// 12_user_management.spec.js's 11-role batch or its "CIC" prefix — different
// prefixes, so tests/fixtures/last-created-users.json gains new keys rather
// than overwriting existing ones.
//
// Serial mode is REQUIRED for the same reason 12_user_management.spec.js needs
// it: test.beforeAll runs once PER WORKER, so a parallel split would call
// nextBatchNumber() several times and scatter one logical batch across
// several numbers (confirmed live there: a 6-worker split produced batch
// numbers 32-37 instead of one).
test.describe.configure({ mode: 'serial' });

// Order matters only for readability — each user is independent. Vendor roles
// first so a failure in the vendor-category/vendor cascade (the part with the
// most moving pieces) surfaces early.
// CANONICAL creation order, and it MUST be a module constant: the per-role
// tests below are generated at COLLECTION time, before the `profile` fixture
// exists, so the list cannot come from the profile. Both profiles declare the
// same ten roles in users.order; a profile that declares FEWER simply has those
// roles skipped per-test (see the prefix check inside each test), and a profile
// declaring a role missing from here would fail the beforeAll check.
//
// Vendor roles first: their Add User cascade has the most moving pieces (vendor
// category + vendor), so a break there surfaces early. Then the AGEL flow
// roles, then the hierarchy tiers.
const ROLE_ORDER = ['CI', 'CM', 'EE', 'QI', 'EL', 'QL', 'PM', 'PAD', 'SAD', 'CAD'];

// The profile's own declared order, used for the reuse check so that "do this
// profile's users already exist?" asks about exactly the roles it declares.
const roleOrderFor = (profile) =>
  (profile.users && profile.users.order) || ROLE_ORDER;

// IDEMPOTENCY. Playwright re-runs a project's `dependencies` on every
// invocation, so `--project=smoke-wind-so` (or any later stage) pulls this
// stage in again. Without a guard that silently created a FRESH batch of four
// users on every single run — confirmed live: iterating on stage 2 produced
// batch 59 on top of batch 58's already-good users, and would keep piling up
// one junk batch per iteration.
//
// So: reuse whichever of this profile's users already exist in
// last-created-users.json and create only the rest. Set SMOKE_RECREATE_USERS=1
// to force a new batch of everything (e.g. after the app's user data is wiped,
// or to test creation itself).
//
// PER-ROLE, NOT ALL-OR-NOTHING, and that distinction is load-bearing. This used
// to return null the moment ANY declared role was missing, which meant adding
// the six hierarchy tiers to a profile whose four flow users already existed
// would have recreated ALL TEN — replacing a CI/EE/QI that were already WAM'd
// and had eighteen RFIs in flight against them. Growing the role list must add
// users, not rebuild the world.
function existingUsersFor(profile) {
  const recorded = loadLastCreatedUsers();
  const found = {};
  const missing = [];
  for (const roleKey of roleOrderFor(profile)) {
    const prefix = profile.users.prefixes[roleKey];
    const entry = recorded[prefix];
    // Must belong to THIS profile — a prefix could in principle be reused by
    // another profile later, and silently inheriting its user would scope the
    // whole chain to the wrong project type.
    if (!entry || entry.profileKey !== profile.key) { missing.push(roleKey); continue; }
    // AND the same deployment. This file has no environment dimension, so a
    // user recorded against pulse-dev stays recorded when the suite is pointed
    // at pulse-qa, where it does not exist. Found live 2026-09-03: this stage
    // was pointed at pulse-qa, found four solar users from an earlier run,
    // decided they already existed, SKIPPED all four tests and exited 0 — a
    // clean-looking run that created nothing and left the chain pointing at
    // users the target deployment had never heard of.
    //
    // Entries created before baseUrl was tracked carry undefined and so force
    // one re-creation. That is the safe direction: re-creating costs minutes,
    // trusting a phantom user fails much later at a dropdown search.
    if (entry.baseUrl !== process.env.BASE_URL) { missing.push(roleKey); continue; }
    found[roleKey] = entry;
  }
  return { found, missing };
}

test.describe('Smoke stage 1 - create flow users for a project type', () => {
  // `toCreate` is the set of role keys this run will actually create; every
  // other generated test skips. Per-role rather than one global "reusing" flag,
  // so adding roles to a profile tops up instead of rebuilding.
  let context, page, dashboard, batchNumber, profile;
  let toCreate = new Set();

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    expect(
      profile.users.source,
      `Profile "${profile.key}" is not a fresh-user profile — it uses ${profile.users.source} credentials, ` +
      `so this stage has nothing to create.`
    ).toBe('created');

    // Every role the profile declares must be one this file GENERATES a test
    // for, or it would silently never be created — the tests come from the
    // module-level ROLE_ORDER, which cannot see the profile at collection time.
    const declared = roleOrderFor(profile);
    const ungenerated = declared.filter((r) => !ROLE_ORDER.includes(r));
    expect(
      ungenerated,
      `Profile "${profile.key}" declares role(s) this stage generates no test for: ` +
      `${ungenerated.join(', ')}. Add them to ROLE_ORDER in this file.`
    ).toEqual([]);

    const forceAll = process.env.SMOKE_RECREATE_USERS === '1';
    const { found, missing } = forceAll
      ? { found: {}, missing: declared }
      : existingUsersFor(profile);
    toCreate = new Set(missing);

    console.log(
      `\n=== Smoke user creation: profile "${profile.key}" ` +
      `(${profile.projectType} @ ${profile.workLocations.join(', ')}) ===` +
      (forceAll ? '\n    SMOKE_RECREATE_USERS=1 — recreating every role' : '')
    );
    const reusedKeys = Object.keys(found);
    if (reusedKeys.length) {
      console.log(`    reusing ${reusedKeys.length}: ` +
        reusedKeys.map((k) => `${k}=${found[k].name}`).join(', '));
    }
    if (!toCreate.size) {
      console.log('    nothing to create — every declared role already exists on this deployment.');
      console.log('    (set SMOKE_RECREATE_USERS=1 to force a new batch)\n');
      return;
    }
    console.log(`    creating ${toCreate.size}: ${[...toCreate].join(', ')}\n`);

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    batchNumber = nextBatchNumber();
    console.log(`    batch ${batchNumber}\n`);
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  for (const roleKey of ROLE_ORDER) {
    test(`create the ${roleKey} user`, async () => {
      // A profile may legitimately declare fewer roles than this file generates
      // tests for (the list is a module constant, see ROLE_ORDER), so an absent
      // prefix is a skip rather than a failure.
      const prefix = profile.users.prefixes[roleKey];
      test.skip(!prefix, `Profile "${profile.key}" declares no ${roleKey} role`);
      test.skip(!toCreate.has(roleKey), `${roleKey} already exists on this deployment — reusing it`);
      const { role, userType } = profile.users.roles[prefix];

      const users = new UserManagementPage(page);
      await users.goto(dashboard);
      await users.openAddUserDialog();

      await users.selectUserType(userType);
      if (userType === 'VENDOR') {
        await users.selectVendorCategory(profile.vendor.category);
        await users.selectVendor(profile.vendor.name);
      }
      await users.selectUserRole(role);

      // Pin Project type to THIS profile's type — not a count-based pick.
      // Seven types exist live (SOLAR/WIND/INFRA/PSS/ADMIN/BESS/
      // TRANSMISSION_LINE), so "first two options" would scope a wind user
      // to the wrong thing entirely.
      const picked = await users.fillLocationCascade({
        cluster: profile.cluster,
        site: [profile.site],
        projectTypes: [profile.projectType],
        projectTypeCount: 1,
        workLocations: profile.workLocations,
        workLocationCount: profile.workLocations.length,
      });

      // Assert the cascade actually landed on the intended project type /
      // work locations rather than silently falling back. fillLocationCascade
      // fills only the fields a given role renders (it is a clean prefix of
      // Cluster/Sites/Project type/Work Locations, and which prefix varies by
      // role) — so only check a field when the role actually showed it.
      if (picked.projectType) {
        expect(
          picked.projectType.join(','),
          `${role} should be scoped to ${profile.projectType}`
        ).toContain(profile.projectType);
      }
      if (picked.workLocations) {
        for (const wl of profile.workLocations) {
          expect(
            picked.workLocations.join(','),
            `${role} should be scoped to work location ${wl}`
          ).toContain(wl);
        }
      }

      const identity = generateUserIdentity(prefix, batchNumber);
      await users.fillIdentity(identity);

      const toastText = await users.submit();
      expect(
        toastText,
        `Expected a success toast after creating ${role} "${identity.name}"`
      ).toMatch(/success/i);

      const found = await users.waitForUserSearchResult(identity.name);
      expect(
        found,
        `Newly created user "${identity.name}" should be findable via search afterward`
      ).toBe(true);

      // Keyed by the project-scoped prefix (CIWTG/CISL/...), so the later
      // stages (WAM, RFI flow) can resolve "the current wind CI" without
      // hardcoding a generated name, and without colliding with the 11-role
      // batch spec's own keys.
      recordLastCreatedUser(prefix, {
        ...identity, role, userType,
        profileKey: profile.key,
        // WHICH DEPLOYMENT this user actually exists on. Without it a later
        // stage cannot tell a usable user from one created against a different
        // environment — see the reuse guard above.
        baseUrl: process.env.BASE_URL,
        projectType: profile.projectType,
        workLocations: profile.workLocations,
        vendor: userType === 'VENDOR' ? profile.vendor.name : null,
      });

      console.log(
        `  Created ${role} (${userType}) "${identity.name}" <${identity.email}> ${identity.phone}\n` +
        `    scoped: ${JSON.stringify(picked)}`
      );
    });
  }
});
