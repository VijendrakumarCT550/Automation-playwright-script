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
const ROLE_ORDER = ['CI', 'CM', 'EE', 'QI'];

// IDEMPOTENCY. Playwright re-runs a project's `dependencies` on every
// invocation, so `--project=smoke-wind-so` (or any later stage) pulls this
// stage in again. Without a guard that silently created a FRESH batch of four
// users on every single run — confirmed live: iterating on stage 2 produced
// batch 59 on top of batch 58's already-good users, and would keep piling up
// one junk batch per iteration.
//
// So: if this profile's four users already exist in last-created-users.json,
// skip creation and reuse them. Set SMOKE_RECREATE_USERS=1 to force a new
// batch (e.g. after the app's user data is wiped, or to test creation itself).
function existingUsersFor(profile) {
  const recorded = loadLastCreatedUsers();
  const found = {};
  for (const roleKey of ROLE_ORDER) {
    const prefix = profile.users.prefixes[roleKey];
    const entry = recorded[prefix];
    // Must belong to THIS profile — a prefix could in principle be reused by
    // another profile later, and silently inheriting its user would scope the
    // whole chain to the wrong project type.
    if (!entry || entry.profileKey !== profile.key) return null;
    found[roleKey] = entry;
  }
  return found;
}

test.describe('Smoke stage 1 - create flow users for a project type', () => {
  let context, page, dashboard, batchNumber, profile, reusing;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    expect(
      profile.users.source,
      `Profile "${profile.key}" is not a fresh-user profile — it uses ${profile.users.source} credentials, ` +
      `so this stage has nothing to create.`
    ).toBe('created');

    reusing = process.env.SMOKE_RECREATE_USERS === '1' ? null : existingUsersFor(profile);
    if (reusing) {
      console.log(
        `\n=== Smoke user creation: profile "${profile.key}" — REUSING existing users ` +
        `(set SMOKE_RECREATE_USERS=1 to force a new batch) ===`
      );
      for (const roleKey of ROLE_ORDER) {
        console.log(`    ${roleKey}: ${reusing[roleKey].name} <${reusing[roleKey].email}>`);
      }
      console.log('');
      return;
    }

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    batchNumber = nextBatchNumber();
    console.log(
      `\n=== Smoke user creation: profile "${profile.key}" ` +
      `(${profile.projectType} @ ${profile.workLocations.join(', ')}), batch ${batchNumber} ===\n`
    );
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  for (const roleKey of ROLE_ORDER) {
    test(`create the ${roleKey} user`, async () => {
      test.skip(!!reusing, 'Users for this profile already exist — reusing them');

      const prefix = profile.users.prefixes[roleKey];
      expect(prefix, `Profile "${profile.key}" defines no prefix for role ${roleKey}`).toBeTruthy();
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
