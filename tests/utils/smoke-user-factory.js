const { expect } = require('@playwright/test');
const UserManagementPage = require('../pages/UserManagementPage');
const { generateUserIdentity, recordLastCreatedUser } = require('./user-counter-utils');

// CREATING ONE SMOKE USER — the single implementation, shared by two callers.
//
// This was SM01_user_creation.spec.js's per-role test body until 2026-09-09.
// It moved here when the smoke stages gained the ability to CREATE a user they
// find missing (see ensureSmokeUsers in smoke-users.js) instead of dying with
// "run stage 1 first". Two code paths that create users would be two chances
// for them to disagree about project-type scoping — and getting that wrong
// produces a user that exists, logs in, and then cannot see the work area,
// which is a slow and confusing failure.
//
// Everything that made SM01's version careful is kept, in particular the
// cascade assertions and the order they run in. Their reasoning is in the
// comments below; it is all live-confirmed history, not defensiveness.
async function createSmokeUser(page, dashboard, profile, roleKey, batchNumber) {
  const prefix = profile.users.prefixes[roleKey];
  if (!prefix) {
    throw new Error(`Profile "${profile.key}" declares no ${roleKey} role`);
  }
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

  // Pin Project type to THIS profile's type — not a count-based pick. Seven
  // types exist live (SOLAR/WIND/INFRA/PSS/ADMIN/BESS/TRANSMISSION_LINE), so
  // "first two options" would scope a wind user to the wrong thing entirely.
  const picked = await users.fillLocationCascade({
    cluster: profile.cluster,
    site: [profile.site],
    projectTypes: [profile.projectType],
    projectTypeCount: 1,
    workLocations: profile.workLocations,
    workLocationCount: profile.workLocations.length,
  });

  // Assert the cascade actually landed on the intended project type / work
  // locations rather than silently falling back. fillLocationCascade fills only
  // the fields a given role renders (a clean prefix of Cluster/Sites/Project
  // type/Work Locations, and which prefix varies by role) — so only check a
  // field when the role actually showed it.
  //
  // CLUSTER AND SITE FIRST, because they scope everything below them and
  // because selectMultiAware FALLS BACK SILENTLY: when none of the preferred
  // candidates match an option, it clicks the FIRST option instead. Found live
  // 2026-09-04 — a wind run asking for cluster "Gujarat" / site "Mandvi" came
  // back with "Rajasthan" / "Baiya", and the only symptom was an empty Work
  // Locations list three fields later, which reads like a data problem at the
  // wrong field entirely.
  //
  // Asserted in cascade order so the FIRST wrong field is the one that fails,
  // rather than its downstream consequence.
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
      `"${picked.sites.join(',')}" — check the cluster selected above it first, ` +
      `since Sites is scoped to the chosen Cluster`
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

  // Keyed by the project-scoped prefix (CIWTG/CISL/...) inside the record's
  // per-environment bucket, so the later stages (WAM, RFI flow) can resolve
  // "the current solar CI on this deployment" without hardcoding a generated
  // name, and without colliding with either the 11-role batch spec's bare keys
  // or another deployment's users. See user-counter-utils.js.
  const entry = {
    ...identity, role, userType,
    profileKey: profile.key,
    // WHICH DEPLOYMENT this user actually exists on. Without it a later stage
    // cannot tell a usable user from one created against a different
    // environment — and it is what decides the bucket it is filed under.
    baseUrl: process.env.BASE_URL,
    projectType: profile.projectType,
    workLocations: profile.workLocations,
    vendor: userType === 'VENDOR' ? profile.vendor.name : null,
  };
  recordLastCreatedUser(prefix, entry);

  return { identity, picked, entry, role, userType, prefix };
}

module.exports = { createSmokeUser };
