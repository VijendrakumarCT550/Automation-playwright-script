const { test, expect } = require('@playwright/test');
const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
const { profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers } = require('./drs-profile');

// ===========================================================================
// IN02 — WAM: map the project's CI (with our SO), EE and QI onto its RFI and
// NC Work Areas. docs/drs-pulse-integration.md §9.
//
// Reuses the smoke chain's ensureWorkAreaMapping: check each row first, assign
// only what is missing, then prove every assignment persisted after a reopen.
// The CI's filter carries the Service Order ("<SO> - <VENDOR>", then the bare
// number) — the DRS team's V-09 warning: a CI whose WAM SO differs from the
// Work Area's SO can create RFIs and then sees none of them.
//
// Needs IN01. Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN02_wam.spec.js
// ===========================================================================

const profile = profileForSpec();
const ROLES = ['CI', 'EE', 'QI'];

// Every Work Area any later stage drives (the single cycles AND the matrices —
// drs-profile.js groundAreas), so no stage meets an unmapped row.
test(`IN02. CI / EE / QI mapped on ${profile.groundAreas.join(' + ')}`, async ({ browser }) => {
  requireAvailable(profile);
  test.setTimeout(30 * 60 * 1000);
  const users = drsUsers(profile);
  for (const r of ROLES) expect(users[r], `${r} not recorded — run IN01 first`).toBeTruthy();

  const areas = profile.groundAreas;
  const { assigned } = await ensureWorkAreaMapping(browser, profile, users, {
    roles: ROLES, areas, label: 'IN02',
  });
  recordPulse(profile, { wam: { roles: ROLES, areas, assigned, at: new Date().toISOString() } });
});
