const { test, expect } = require('@playwright/test');
const { getProfile } = require('../../config/projects');
const { fleetFor, serviceOrderFor } = require('../../utils/reassign-fleet');
const { adminFreshLogin } = require('../../utils/helpers');
const { openAssignmentDialog } = require('../../utils/smoke-wam');

// ===========================================================================
// INSPECTION (READ-ONLY) — is every reassignment-fleet member still mapped
// where 40_reassign_fleet_setup put them?
// ===========================================================================
// App owner, 2026-09-27: "make sure prerequisite WAM for all roles is
// available, there may be some demapping." Several specs rewrite WAM on the
// fleet's ground and restore it (47, 49, 54, 55), and a restore that failed —
// or a manual change — would leave a member quietly unmapped.
//
// This NEVER assigns anything. For each member with a recorded mapping it opens
// the member's own WAM cell (same filters 40 used, Service Order included for
// the vendor-side roles), reads the recorded row, and reports whether the
// member still holds it. Anything missing is re-applied with 40's own remap
// mode, which the failure message spells out — so a fix is always a
// deliberate, logged step, never a side effect of looking.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/inspection/00_inspect_reassign_fleet_wam.spec.js --project=chromium --workers=1
// ===========================================================================
test('reassignment fleet: every recorded WAM mapping is still in place', async ({ browser }) => {
  test.setTimeout(30 * 60 * 1000);

  const fleet = fleetFor();
  const profile = getProfile('solar-e2e');
  const members = Object.values(fleet).filter((m) => m && m.wam && m.wamDetail && m.wamDetail.row);
  expect(members.length, 'no fleet members with a recorded mapping for this deployment').toBeGreaterThan(0);

  const { context, page, dashboard } = await adminFreshLogin(browser);
  const report = [];
  try {
    for (const m of members) {
      const noPackage = /no package filter/i.test(m.wamDetail.filters || '');
      const serviceOrder = serviceOrderFor(m.role);
      const filters = {
        role: m.role,
        cluster: profile.cluster,
        site: profile.site,
        workLocation: m.wam.workLocation,
        package: noPackage ? undefined : m.wam.package,
        ...(serviceOrder ? { serviceOrder } : {}),
      };
      let holds = '';
      let status;
      try {
        const wam = await openAssignmentDialog(page, dashboard, filters);
        await wam.waitForRowsLoaded().catch(() => {});
        holds = ((await wam.getWorkAreaUserValue(m.wamDetail.row)) || '').trim();
        await wam.closeDialog().catch(() => {});
        const names = holds.split(',').map((s) => s.trim());
        status = names.includes(m.name) ? 'OK' : 'MISSING';
      } catch (err) {
        status = 'UNREADABLE';
        holds = String((err && err.message) || err).split(/\r?\n/)[0];
      }
      report.push({ key: m.key, role: m.role, cell: `${m.wam.workLocation}/${m.wam.package}/${m.wamDetail.row}`, status, holds });
      console.log(`  ${status.padEnd(10)} ${m.key.padEnd(6)} ${m.role.padEnd(20)} ` +
        `${m.wam.workLocation}/${m.wam.package}/${m.wamDetail.row}  row holds: "${holds}"`);
    }
  } finally {
    await context.close();
  }

  const bad = report.filter((r) => r.status !== 'OK');
  expect(
    bad,
    `${bad.length} fleet mapping(s) are not in place: ` +
    bad.map((b) => `${b.key} @ ${b.cell} (${b.status}; row holds "${b.holds}")`).join('; ') +
    `. Re-apply with: $env:REASSIGN_FLEET_GROUP="all"; $env:REASSIGN_FLEET_REMAP="` +
    bad.map((b) => b.key).join(',') + `"; npx playwright test ` +
    `tests/specs/40_reassign_fleet_setup.spec.js --project=chromium --workers=1`
  ).toEqual([]);
});
