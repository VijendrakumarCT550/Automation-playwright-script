const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveRfiFixture } = require('../utils/smoke-rfi-fixture');
const {
  createAndSubmitCheckpoint, getVisibleCodeFor, approveAsRole, resetToMyTasks,
} = require('../utils/rfi-dependency-flow');
const { profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers } = require('./drs-profile');

// ===========================================================================
// IN03 — ONE FULL RFI CYCLE ON THE DRS PROJECT: CI raises → EE approves →
// QI approves. docs/drs-pulse-integration.md §9.
//
// The first end-to-end proof that a DRS-created project, Work Area, Service
// Order and v1 package reach Pulse in a usable state: the proven solar Piling
// checkpoint (Piling - MMS / Pre Pour Inspection - Pile / Micro Pile Checklist)
// raised on OUR Work Area by OUR CI, and reviewed by OUR EE and QI.
//
// Reuses rfi-dependency-flow's helpers with the injectable login (SM07's
// pattern), so the flow users are this project's IN01 users, never .env's.
// RFI consumes the (checkpoint, Work Section) it lands on — '__random__' picks
// a fresh section each run.
//
// Needs IN01 + IN02. Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN03_rfi_cycle.spec.js
// ===========================================================================

const profile = profileForSpec();
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

test(`IN03. RFI on ${profile.rfi.workArea}: CI → EE → QI`, async ({ browser }) => {
  requireAvailable(profile);
  test.setTimeout(45 * 60 * 1000);
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  const users = drsUsers(profile);
  for (const r of ['CI', 'EE', 'QI']) expect(users[r], `${r} not recorded — run IN01 first`).toBeTruthy();
  const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);

  const context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();
  try {
    const fixture = resolveRfiFixture(profile);
    console.log(`  CI ${users.CI.name}: raising ${fixture.checkpoint.name} on ${fixture.baseData.workLocation}/${fixture.baseData.workArea}`);
    await loginAs(page, 'CI');
    const { rfiId, workSectionLabel } = await createAndSubmitCheckpoint(page, fixture.baseData, fixture.checkpoint, '__random__');
    const code = await getVisibleCodeFor(page, rfiId);
    console.log(`  ✓ RFI ${code} (${rfiId}) on work section ${workSectionLabel}`);
    expect(code, 'no visible RFI code after submit').toBeTruthy();
    const rfi = { id: rfiId, code, workArea: fixture.baseData.workArea, workSection: workSectionLabel, status: 'submitted' };
    recordPulse(profile, { rfis: [...(recordedPulse(profile).rfis || []), rfi] });
    await resetToMyTasks(page);

    console.log(`  EE ${users.EE.name}: approving ${code}`);
    await approveAsRole(page, 'EE', code, { loginAs });
    console.log(`  ✓ EE approved`);

    console.log(`  QI ${users.QI.name}: approving ${code}`);
    await approveAsRole(page, 'QI', code, { loginAs });
    console.log(`  ✓ QI approved`);

    const rfis = (recordedPulse(profile).rfis || []).map((r) => (r.id === rfiId ? { ...r, status: 'approved' } : r));
    recordPulse(profile, { rfis });
  } finally {
    await context.close();
  }
});
