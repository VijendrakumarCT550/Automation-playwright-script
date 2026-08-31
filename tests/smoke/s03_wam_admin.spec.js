const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const WAMPage = require('../pages/WAMPage');

// Stage 3 of the E2E smoke chain: Admin assigns each of the four users created
// in stage 1 to the profile's work area, so they actually appear in the RFI/NC
// flow. Without this, the users exist and have activity access via SO Mapping
// but no work area, and nothing can be raised.
//
// Deliberately assigns only the work areas the profile NAMES (profile.workAreas
// — currently a single entry for wind), not every area of the work location.
// WTG-Khavda has 244 work areas; a full-location assignment would be a very
// different, much slower test, and the flow stages only need the named ones.
//
// Contractor Incharge and Contractor Manager are VENDOR roles and their WAM
// dialog carries an extra Service Order field (see 07_wam_ci.spec.js) which
// gates assignment to work already mapped to that vendor in SO Mapping — i.e.
// this stage depends on stage 2 having run. Execution Engineer and Quality
// Inspector have no such field; fillAssignmentFilters skips it when absent.
test.describe.configure({ mode: 'serial' });

const ROLE_ORDER = ['CI', 'CM', 'EE', 'QI'];

test.describe('Smoke stage 3 - WAM the created users onto the work area', () => {
  let context, page, dashboard, profile, users;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;

    // Resolve the users stage 1 created/reused. Fail with a readable message
    // rather than letting an undefined name reach a dropdown search.
    const recorded = loadLastCreatedUsers();
    users = {};
    for (const roleKey of ROLE_ORDER) {
      const prefix = profile.users.prefixes[roleKey];
      const entry = recorded[prefix];
      expect(
        entry && entry.profileKey === profile.key,
        `No recorded user for ${roleKey} (prefix "${prefix}") on profile "${profile.key}" — ` +
        `run the smoke-${profile.key.replace('-e2e', '')}-users stage first.`
      ).toBeTruthy();
      users[roleKey] = entry;
    }

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    console.log(
      `\n=== Smoke WAM: profile "${profile.key}" -> ` +
      `${profile.workLocations[0]} / ${profile.primaryWorkArea} ===`
    );
    for (const roleKey of ROLE_ORDER) {
      console.log(`    ${roleKey} (${users[roleKey].role}): ${users[roleKey].name}`);
    }
    console.log('');
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  for (const roleKey of ROLE_ORDER) {
    test(`assign the ${roleKey} user to the work area`, async () => {
      const user = users[roleKey];
      // Iterates profile.workAreas for the same reason s02 does: wind has one
      // Work Section per Work Area, so the checkpoint-dependency stage will
      // need a second (throwaway + real) area, and a user must be WAM'd onto
      // an area before they can see it at all — confirmed live, the WTG CI's
      // Work Area dropdown offered exactly the one area it was WAM'd onto.
      // The list currently holds one entry, so this is behaviourally identical
      // to before.
      const workAreas = (profile.workAreas && profile.workAreas.filter(Boolean).length)
        ? profile.workAreas.filter(Boolean)
        : [profile.primaryWorkArea].filter(Boolean);
      expect(workAreas.length, `Profile "${profile.key}" has no work areas set`).toBeGreaterThan(0);

      for (const workArea of workAreas) {
        await assignOneWorkArea({ user, roleKey, workArea });
      }
    });
  }

  // Extracted so the per-work-area body reads identically whether the profile
  // lists one work area or several.
  async function assignOneWorkArea({ user, roleKey, workArea }) {
    const wam = new WAMPage(page);

    await wam.goto(dashboard);
    await wam.openAddDetails();

    await wam.fillAssignmentFilters({
      role: user.role,
      cluster: profile.cluster,
      site: profile.site,
      workLocation: profile.workLocations[0],
      package: profile.packages[0],
      // Precise SO string first, vendor name as fallback — the dialog's
      // rendering of this field isn't confirmed, and BAUER has five SOs.
      serviceOrder: user.userType === 'VENDOR'
        ? [profile.vendor.serviceOrder, profile.vendor.name]
        : null,
    });

    // Only change the row if it isn't already this user — same
    // leave-it-alone rule the existing WAM specs use, so a re-run is a
    // no-op rather than a churn.
    const changed = await wam.assignUserIfNeeded(workArea, user.name);

    await expect(
      wam.getWorkAreaRow(workArea).locator('[role="combobox"]')
    ).toContainText(user.name);

    const toastText = await wam.clickSubmit();
    console.log(`  ${roleKey}: changed=${changed}, toast="${toastText}"`);
    expect(
      toastText,
      `Submit should report either a successful assignment or no-change for ${user.name}`
    ).toMatch(changed ? /Assigned successfully/i : /Assigned successfully|No changes to save/i);

    // Submit resets the dialog's fields but does NOT close it — close and
    // reopen from scratch so this confirms server-side persistence rather
    // than still-populated front-end form state (same reasoning as
    // 07_wam_ci.spec.js).
    await wam.closeDialog();
    await wam.openAddDetails();
    await wam.fillAssignmentFilters({
      role: user.role,
      cluster: profile.cluster,
      site: profile.site,
      workLocation: profile.workLocations[0],
      package: profile.packages[0],
      serviceOrder: user.userType === 'VENDOR'
        ? [profile.vendor.serviceOrder, profile.vendor.name]
        : null,
    });

    const persisted = await wam.getWorkAreaUserValue(workArea);
    expect(
      persisted,
      `${user.role} "${user.name}" should still be assigned to ${workArea} after reopening the dialog`
    ).toContain(user.name);

    await wam.closeDialog();
  }
});
