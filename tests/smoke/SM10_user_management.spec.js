const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { nextBatchNumber, generateUserIdentity, recordLastCreatedUser, loadLastCreatedUsers } =
  require('../utils/user-counter-utils');
const { requireFeatureGround } = require('../config/projects');
const UserManagementPage = require('../pages/UserManagementPage');

// Feature stage SM10: the smoke replica of 12_user_management.spec.js — Admin
// creates one user for EVERY role the Add User dialog offers, proving the whole
// dialog (user type, the VENDOR-only vendor-category/vendor cascade, the
// role-dependent location cascade, identity, submit, searchability).
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS ALONGSIDE SM01, WHICH ALSO CREATES USERS
// ---------------------------------------------------------------------------
// They answer different questions and the app owner asked for both
// (2026-09-04): "SM01 created users should be permanent in one full run, 12 user
// management can also create all roles".
//
//   SM01 provisions the TEN roles the chain then runs as. Its users are the
//   chain's identity for the whole run — SM03 maps them, the flows raise RFIs as
//   them, SM13/SM17/SM18/SM19-22 resolve them. They must not move mid-run.
//
//   SM10 (this file) is COVERAGE OF THE CREATION SCREEN ITSELF, including the
//   ELEVENTH role SM01 has no use for: "Admin". Nothing reads what it creates.
//
// That separation is what makes it safe. If this stage wrote to SM01's prefixes
// it would repoint the chain's identity to brand-new users halfway through a run
// — after SM03 had already mapped the old ones, so every later stage would fail
// on a work area its "current" user was never assigned to.
//
// ---------------------------------------------------------------------------
// THE PREFIX NAMESPACE, AND WHY IT IS A THIRD ONE
// ---------------------------------------------------------------------------
// tests/fixtures/last-created-users.json is a single flat map keyed by prefix,
// shared by three tiers, so there are already two namespaces in it that this
// file must avoid:
//
//   CISL/EESL/...    SM01's, per project type (CIWTG for wind). Clobbering these
//                    breaks the current run, as above.
//   EE/QI/EL/CIC/... 12_user_management's BARE keys. 13, 25, 27, 28, 31 and
//                    tests/online-roles/ all resolve their users from these, so
//                    clobbering them would silently repoint the REGRESSION tier
//                    at smoke-scoped users — the exact cross-tier bleed this
//                    whole restructure exists to remove.
//
// Hence a third: role + "SM". New keys only; nothing existing is touched.
//
// NOT serial mode, deliberately — fixed 2026-09-05 alongside the identical
// issue in SM01 (which this file mirrors). `serial` means "skip every test
// after the first failure in this file," which would turn one role's Add User
// dialog hiccup into ten lost tests instead of one. Batch-number uniqueness
// (the reason a shared-session smoke file would normally want serial) is
// already guaranteed by the `--workers=1` every npm script and run-smoke.js
// enforce for the whole run — see SM01's own comment for the full reasoning.

// Every role the UserRole dropdown offers, with the ELEVENTH ("Admin") that
// SM01's ten-role chain list omits — the app owner's "12 user management can
// also create all roles".
//
// "Management User" is a real dropdown option and is still excluded, carried
// over from 12_user_management.spec.js: no prefix was ever specified for it.
//
// LOCAL, not in tests/config/projects.js, unlike almost everything else here.
// That is deliberate: this table is creation COVERAGE that nothing else reads,
// whereas the profile holds the chain's shared contract. Putting a table with
// exactly one consumer in the shared config would only invite another stage to
// start depending on it.
const ROLE_CONFIGS = [
  { prefix: 'EESM',  role: 'Execution Engineer',  userType: 'AGEL' },
  { prefix: 'QISM',  role: 'Quality Inspector',   userType: 'AGEL' },
  { prefix: 'ELSM',  role: 'Execution Lead',      userType: 'AGEL' },
  { prefix: 'QLSM',  role: 'Quality Lead',        userType: 'AGEL' },
  { prefix: 'PMSM',  role: 'Project Manager',     userType: 'AGEL' },
  { prefix: 'PADSM', role: 'Plot Admin',          userType: 'AGEL' },
  { prefix: 'SADSM', role: 'Site Admin',          userType: 'AGEL' },
  { prefix: 'CADSM', role: 'Cluster Admin',       userType: 'AGEL' },
  // "Admin" collided with Site Admin's given prefix "SAD" in the original, and
  // there is confirmed to be no separate "Super Admin" option in the dropdown
  // (see UserManagementPage.js), so it keeps its own prefix rather than reusing
  // Site Admin's.
  { prefix: 'ADMSM', role: 'Admin',               userType: 'AGEL' },
  // VENDOR roles last here, unlike SM01 which puts them first. SM01 wants its
  // riskiest cascade to fail fast because the whole chain is blocked behind it;
  // this stage is a leaf, so reading in dropdown order is worth more.
  { prefix: 'CICSM', role: 'Contractor Incharge', userType: 'VENDOR' },
  { prefix: 'CMSM',  role: 'Contractor Manager',  userType: 'VENDOR' },
];

// Honours the SAME switch SM01 does, so one setting controls the whole run's
// user policy rather than the two stages disagreeing:
//
//   SMOKE_USERS=new   (default) create all eleven, i.e. real dialog coverage
//   SMOKE_USERS=reuse           skip roles already recorded on this deployment
//
// `reuse` matters here more than anywhere else: this is eleven full dialog
// cycles, comfortably the most expensive leaf in the chain, and while iterating
// on some other stage none of it is being read by anything.
function reuseMode() {
  if (process.env.SMOKE_RECREATE_USERS === '1') return false;
  return (process.env.SMOKE_USERS || '').trim().toLowerCase() === 'reuse';
}

test.describe('Smoke stage SM10 - Admin creates one user per role (all 11)', () => {
  let context, page, dashboard, batchNumber, profile;
  let toCreate = new Set(ROLE_CONFIGS.map((r) => r.prefix));

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    // Solar-only, and loud about it rather than a quiet skip — same choice SM06
    // makes for `nc: null`. A wind run reaching here is a config error.
    requireFeatureGround(profile);

    if (reuseMode()) {
      const recorded = loadLastCreatedUsers();
      toCreate = new Set(
        ROLE_CONFIGS
          .filter(({ prefix }) => {
            const e = recorded[prefix];
            // Same two checks resolveSmokeUsers() makes, and for the same reason:
            // this file has no environment dimension, so a user recorded against
            // pulse-dev stays recorded when the suite is pointed at pulse-qa
            // where it does not exist.
            return !(e && e.profileKey === profile.key && e.baseUrl === process.env.BASE_URL);
          })
          .map((r) => r.prefix)
      );
    }

    console.log(
      `\n=== SM10 user-management coverage: profile "${profile.key}" ===\n` +
      `    ${profile.projectType} @ ${profile.workLocations.join(', ')} / ` +
      `cluster ${JSON.stringify(profile.cluster)} / site ${profile.site}\n` +
      `    mode: ${reuseMode() ? 'SMOKE_USERS=reuse' : 'create (default)'} — ` +
      `${toCreate.size} of ${ROLE_CONFIGS.length} role(s) to create`
    );
    if (!toCreate.size) {
      console.log('    nothing to create; every role already recorded on this deployment\n');
      return;
    }

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    // ONE number for the whole batch, so eleven users created together are
    // recognisable as a group. nextBatchNumber() must be called once per FILE,
    // which is exactly why this describe is serial: beforeAll runs once per
    // WORKER, so a parallel split would scatter one logical batch across
    // several numbers (confirmed live on the original: a 6-worker split
    // produced 32-37 instead of one).
    batchNumber = nextBatchNumber();
    console.log(`    batch ${batchNumber}\n`);
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  for (const { prefix, role, userType } of ROLE_CONFIGS) {
    test(`Admin can create a new ${role} user (${userType})`, async () => {
      test.skip(!toCreate.has(prefix), `${role} already recorded on this deployment — reusing it`);

      const users = new UserManagementPage(page);
      await users.goto(dashboard);
      await users.openAddUserDialog();

      await users.selectUserType(userType);
      if (userType === 'VENDOR') {
        await users.selectVendorCategory(profile.vendor.category);
        await users.selectVendor(profile.vendor.name);
      }
      await users.selectUserRole(role);

      // SCOPED TO SMOKE GROUND, which is the substantive difference from
      // 12_user_management.spec.js. That spec called fillLocationCascade() with
      // NO arguments, letting it default — which in practice meant A-06c, the
      // app owner's manual-testing ground. Passing the profile pins every user
      // to S05b instead.
      //
      // The cascade is role-dependent (some roles render all of
      // Cluster/Sites/Project type/Work Locations, some none, some a prefix of
      // them — confirmed inconsistent even for the same role across sessions),
      // so fillLocationCascade fills only what is actually visible and returns
      // what it picked.
      const picked = await users.fillLocationCascade({
        cluster: profile.cluster,
        site: [profile.site],
        projectTypes: [profile.projectType],
        projectTypeCount: 1,
        workLocations: profile.workLocations,
        workLocationCount: profile.workLocations.length,
      });

      // Assert the cascade LANDED where asked, in cascade order so the first
      // wrong field fails rather than its downstream symptom.
      //
      // This is not defensive padding: selectMultiAware FALLS BACK SILENTLY to
      // the first option when none of the candidates match. Found live
      // 2026-09-04 in SM01 — a run asking for cluster "Gujarat" / site "Mandvi"
      // came back "Rajasthan" / "Baiya", and the only visible symptom was an
      // empty Work Locations list two fields later, which reads like a data
      // problem at entirely the wrong field.
      if (picked.cluster) {
        expect(
          picked.cluster.join(','),
          `${role}: cluster should be one of ${JSON.stringify(profile.cluster)} but the ` +
          `dropdown gave "${picked.cluster.join(',')}" — that is selectMultiAware's ` +
          `first-option fallback, i.e. none of those candidates were offered`
        ).toMatch(new RegExp(`(${[].concat(profile.cluster).join('|')})`, 'i'));
      }
      if (picked.sites) {
        expect(
          picked.sites.join(','),
          `${role}: site should be "${profile.site}" but the dropdown gave ` +
          `"${picked.sites.join(',')}" — check the cluster above it first, since ` +
          `Sites is scoped to the chosen Cluster`
        ).toContain(profile.site);
      }
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
            `${role} should be scoped to work location ${wl} (smoke ground), not the ` +
            `manual-testing location the original spec defaulted to`
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

      // Creation is not proven by the toast alone — the user has to be findable
      // afterwards, which is what actually catches a write that was accepted and
      // then rolled back.
      const found = await users.waitForUserSearchResult(identity.name);
      expect(
        found,
        `Newly created user "${identity.name}" should be findable via search afterward`
      ).toBe(true);

      recordLastCreatedUser(prefix, {
        ...identity, role, userType,
        profileKey: profile.key,
        // WHICH deployment this user exists on — without it the reuse check
        // above cannot tell a usable record from a foreign-environment one.
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
