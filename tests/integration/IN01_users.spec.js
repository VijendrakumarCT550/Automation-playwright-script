const { test, expect } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const { nextBatchNumber } = require('../utils/user-counter-utils');
const { createSmokeUser } = require('../utils/smoke-user-factory');
const { profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers, packageProfile } = require('./drs-profile');

// ===========================================================================
// IN01 — PULSE USERS FOR THE DRS PROJECT: CI (vendor user), EE, QI (+ PM/EL/QL, and
// CIE = the Electrical vendor's CI when the project has an Electrical SO).
// docs/drs-pulse-integration.md §9.
//
// PER DRS PROJECT, not per environment: a person appears in a WAM row only if
// the row's Work Location is on their profile (DRS team, 008 spec), and every
// DRS project brings a fresh Work Location. So each project gets its own three
// users, created once and reused by every later run against that project.
//
// Created through Pulse's own Add User (app owner), by the same
// createSmokeUser the smoke chain uses — its cascade assertions (cluster →
// site → project type → work location actually landed) apply here too. The
// CI is a VENDOR user of our DRS vendor.
//
// Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN01_users.spec.js
// ===========================================================================

const profile = profileForSpec();

test.describe.configure({ mode: 'serial' });

test(`IN01. CI / EE / QI exist for ${profile.drs.project.name}`, async ({ browser }) => {
  requireAvailable(profile);
  test.setTimeout(30 * 60 * 1000);
  // The newest users recorded for this profile key (shared with the
  // smoke-drs-* chain — see drsUsers in drs-profile.js), so IN01 creates only
  // when this project has none yet.
  const existing = drsUsers(profile, profile.users.order);
  const missing = profile.users.order.filter((r) => !existing[r]);
  if (!missing.length) {
    recordPulse(profile, { users: Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, {
      name: v.name, email: v.email, role: v.role, userType: v.userType, vendor: v.vendor || null,
    }])) });
  }
  console.log(`  project ${profile.drs.project.name} on pulse-${profile.drs.pulseKey}`);
  console.log(`  recorded: ${JSON.stringify(Object.fromEntries(Object.entries(existing).map(([k, v]) => [k, v ? v.name : null])))}`);
  if (!missing.length) {
    console.log('  all three users already exist — nothing to create');
    return;
  }

  const batch = nextBatchNumber();
  const { context, page, dashboard } = await adminFreshLogin(browser);
  try {
    for (const roleKey of missing) {
      console.log(`  creating ${roleKey} (batch ${batch}) scoped to ${profile.workLocations[0]} …`);
      // CIE is the ELECTRICAL vendor's CI (DRS: one vendor + SO per package), so it is
      // created against that vendor; every other role uses the Civil profile.
      const asProfile = roleKey === 'CIE' ? packageProfile(profile, 'Electrical') : profile;
      const { entry } = await createSmokeUser(page, dashboard, asProfile, roleKey, batch);
      // Recorded per user, the moment it exists — a user has no delete.
      recordPulse(profile, {
        users: { ...(recordedPulse(profile).users || {}), [roleKey]: {
          name: entry.name, email: entry.email, role: entry.role, userType: entry.userType,
          vendor: entry.vendor, createdAt: new Date().toISOString(),
        } },
      });
      console.log(`  ✓ ${roleKey}: ${entry.name} (${entry.email})`);
    }
  } finally {
    await context.close();
  }

  const after = recordedPulse(profile).users || {};
  for (const r of profile.users.order) expect(after[r], `${r} not recorded after IN01`).toBeTruthy();
});
