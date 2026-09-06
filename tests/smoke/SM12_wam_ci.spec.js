const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { openAssignmentDialog, assignAndProve } = require('../utils/smoke-wam');

// Feature stage SM12: the smoke replica of 07_wam_ci.spec.js — the VENDOR
// variant of the WAM assignment screen.
//
// WHAT MAKES THIS DIFFERENT FROM SM11, and why it is its own stage rather than
// two more rows in that one: the vendor roles render an extra Service Order
// field after Package, and that field GATES the assignment — only work already
// mapped to that vendor is assignable. So this exercises a different cascade
// depth, a different widget type, and a different authorisation rule.
//
// Both vendor roles are covered (Contractor Incharge and Contractor Manager).
// The original only did Contractor Incharge; CM has the same Service Order gate
// and is the role SM04's cascade ends on, so leaving it uncovered here meant the
// gate was only ever proven for one of the two roles that has it.
//
// Same two departures from the original as SM11:
//   * USERS — the original hardcoded a roster name ('Vikram Singh') with a
//     comment noting that the previous hardcoded name had already stopped being
//     assignable. This resolves SM01's own CI/CM instead, which cannot go stale.
//   * GROUND — A-06c / BL01-BL10 becomes featureGround.wamSweep on S05b.
//
// NOT serial mode — CI's and CM's tests are independent, and serial would let
// one's failure skip the other. See SM01's comment for the full reasoning.

const ROLES = ['CI', 'CM'];

test.describe('Smoke stage SM12 - WAM for vendor roles, Service Order gated', () => {
  let context, page, dashboard, profile, users, areas;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    const ground = requireFeatureGround(profile);

    areas = (ground.wamSweep || []).filter(Boolean);
    expect(
      areas.length,
      `Profile "${profile.key}" declares no featureGround.wamSweep areas.`
    ).toBeGreaterThan(0);

    users = resolveSmokeUsers(profile, ROLES);

    // Both must actually BE vendor roles, or the Service Order assertion below
    // is silently vacuous — fillAssignmentFilters skips fields that aren't
    // visible, so a non-vendor role would sail through with the gate never
    // exercised and the test still green.
    for (const r of ROLES) {
      expect(
        users[r].userType,
        `${r} ("${users[r].role}") must be a VENDOR-type user for this stage to exercise ` +
        `the Service Order gate at all — an AGEL role renders no such field and would ` +
        `make this test pass without testing anything.`
      ).toBe('VENDOR');
    }

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    console.log(
      `\n=== SM12 WAM vendor roles: "${profile.key}" -> ${profile.workLocations[0]} / ` +
      `${profile.packages[0]}\n` +
      `    vendor: ${profile.vendor.name}\n` +
      `    service order: ${profile.vendor.serviceOrder}\n` +
      `    rows (featureGround.wamSweep): ${areas.join(', ')}`
    );
    for (const r of ROLES) console.log(`    ${r} (${users[r].role}): ${users[r].name}`);
    console.log('');
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  for (const roleKey of ROLES) {
    test(`Admin can assign the ${roleKey} user to SO-mapped work areas and it persists`, async () => {
      const user = users[roleKey];

      const filters = {
        role: user.role,
        cluster: profile.cluster,
        site: profile.site,
        workLocation: profile.workLocations[0],
        package: profile.packages[0],
        // Precise SO string first, vendor name as fallback. Not
        // belt-and-braces: a vendor can hold SEVERAL service orders (BAUER has
        // five, confirmed live), so matching on name alone can silently select
        // the wrong one — and since the SO gates which work is assignable, the
        // symptom would be an empty or wrong row list, not an obvious error.
        serviceOrder: [profile.vendor.serviceOrder, profile.vendor.name],
      };

      const wam = await openAssignmentDialog(page, dashboard, filters);

      // Service Order is a searchable Ark UI combobox (an <input>), NOT a
      // select — its selected text lives in the `value` attribute, so this has
      // to be toHaveValue and not toContainText. Carried over from the
      // original, which found this the hard way.
      await expect(
        wam.dialogServiceOrderDropdown,
        `${user.role}: the Service Order field should have resolved to this profile's ` +
        `vendor. If it is empty, the vendor has no SO mapped at ` +
        `${profile.workLocations[0]}/${profile.packages[0]} and no work area will be ` +
        `assignable — which is a data problem, not a UI one.`
      ).toHaveValue(new RegExp(shortVendorToken(profile.vendor.name), 'i'));

      await assignAndProve(wam, {
        filters,
        entries: areas.map((row) => ({ row, userName: user.name })),
        // Contractor Incharge rows are SINGLE-ASSIGNEE (one pick replaces
        // whoever held the row — WAMPage.js). Contractor Manager behaves the
        // same at work-area granularity.
        multi: false,
        label: roleKey,
      });
    });
  }
});

// The Service Order combobox renders the vendor's name in a form that has been
// observed to differ from the configured string (the profile carries
// "M S CHOUHAN INFRAVENTURES" while the dialog shows
// "... INFRAVENTURES PVT LTD"), so asserting the whole name is brittle in a way
// that says nothing useful when it breaks. Match on the most distinctive single
// token instead — the vendor's actual name word rather than a corporate suffix.
function shortVendorToken(vendorName) {
  const skip = new Set(['M', 'S', 'PVT', 'LTD', 'PRIVATE', 'LIMITED', 'AND', '&']);
  const token = String(vendorName)
    .split(/[\s.]+/)
    .filter(Boolean)
    .filter((w) => !skip.has(w.toUpperCase()))
    .sort((a, b) => b.length - a.length)[0];
  return (token || vendorName).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
