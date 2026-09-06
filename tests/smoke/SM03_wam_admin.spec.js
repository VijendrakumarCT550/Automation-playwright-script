const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { smokeMappedWorkAreas } = require('../config/projects');
const WAMPage = require('../pages/WAMPage');

// Stage 3 of the E2E smoke chain: Admin assigns each of the four users created
// in stage 1 to the profile's work area, so they actually appear in the RFI/NC
// flow. Without this, the users exist and have activity access via SO Mapping
// but no work area, and nothing can be raised.
//
// Deliberately assigns only the work areas the chain NAMES
// (smokeMappedWorkAreas — the flow areas plus the feature-depth areas that need
// flow-role access), not every area of the work location. WTG-Khavda has 244
// work areas; a full-location assignment would be a very different, much slower
// test, and no stage needs the rest.
//
// Contractor Incharge and Contractor Manager are VENDOR roles and their WAM
// dialog carries an extra Service Order field which gates assignment to work
// already mapped to that vendor. Execution Engineer and Quality Inspector have
// no such field; fillAssignmentFilters skips it when absent.
//
// THAT GATE IS ALREADY SATISFIED AND NEEDS NO STAGE OF ITS OWN. This comment
// used to say "this stage depends on stage 2 having run" — stale and actively
// misleading in two ways: SM02 is no longer a stage at all (SO mapping was
// removed from PULSE and now lives in DRS, so there is no screen here to drive
// it from), and the mapping is already in place regardless. App owner,
// 2026-09-04: "SO is mapped proerly in S05b whole work location so dont worry
// about SO mappping prerequisite."
//
// So a vendor-role assignment failing here is NOT a missing prerequisite to go
// provision — it is either the wrong Service Order being picked (the profile
// passes the precise SO string first with the vendor name only as a fallback,
// because a vendor can hold several SOs) or a genuine app problem.
test.describe.configure({ mode: 'serial' });

// Only the FLOW roles are work-area-scoped, so only they belong in this stage's
// one-dialog-many-rows model. The hierarchy tiers (PM and PAD are work-location
// roles, SAD is site-level) are mapped by SM04's cascade instead.
//
// A module constant, because the per-role tests below are generated at
// COLLECTION time, before the `profile` fixture exists. beforeAll then checks
// the profile agrees, so a profile declaring a different flow set fails loudly
// rather than having roles silently skipped.
const FLOW_ROLES = ['CI', 'CM', 'EE', 'QI'];

test.describe('Smoke stage 3 - WAM the created users onto the work area', () => {
  let context, page, dashboard, profile, users;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;

    // Resolve the users stage 1 created/reused, checking both that they belong
    // to this profile AND that they were created against THIS deployment — an
    // undefined or foreign-environment name reaching a dropdown search fails
    // with nothing readable to explain why. See smoke-users.js.
    users = resolveSmokeUsers(profile, FLOW_ROLES);

    // The profile's declared flow roles must match what this stage generates
    // tests for, or a role it expects mapped would never be mapped.
    const declared = (profile.users && profile.users.flowRoles) || FLOW_ROLES;
    expect(
      declared.filter((r) => !FLOW_ROLES.includes(r)),
      `Profile "${profile.key}" declares flow role(s) this stage generates no test for. ` +
      `Add them to FLOW_ROLES in this file.`
    ).toEqual([]);

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    // FLOW areas plus the feature-depth areas that need flow-role access —
    // see smokeMappedWorkAreas() in tests/config/projects.js for what it
    // includes and, more importantly, what it deliberately leaves out.
    const areas = smokeMappedWorkAreas(profile);
    console.log(
      `\n=== Smoke WAM: profile "${profile.key}" -> ${profile.workLocations[0]} / ` +
      `${areas.length} work area(s): ${areas.join(', ')} ===`
    );
    for (const roleKey of FLOW_ROLES) {
      console.log(`    ${roleKey} (${users[roleKey].role}): ${users[roleKey].name}`);
    }
    console.log('');
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  for (const roleKey of FLOW_ROLES) {
    test(`assign the ${roleKey} user to every work area`, async () => {
      const user = users[roleKey];
      const workAreas = smokeMappedWorkAreas(profile);
      expect(workAreas.length, `Profile "${profile.key}" has no work areas set`).toBeGreaterThan(0);

      // ONE dialog, ALL work area rows, ONE Submit.
      //
      // The work areas are ROWS inside a single WAM dialog, so assigning several
      // needs no more dialogs than assigning one — which is exactly how
      // 07_wam_ci.spec.js has always done solar (ten BL0x rows, then a single
      // clickSubmit). An earlier version of this spec opened a fresh dialog,
      // submitted, closed, reopened and re-verified PER work area, which for
      // 4 roles x 2 areas meant 8 full dialog cycles instead of 4 — double the
      // work for no extra coverage.
      const wam = new WAMPage(page);
      const filters = {
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
      };

      await wam.goto(dashboard);
      await wam.openAddDetails();
      await wam.fillAssignmentFilters(filters);

      // Only change a row if it isn't already this user — the same
      // leave-it-alone rule the existing WAM specs use, so a re-run is a no-op
      // rather than churn. Tracked across all rows so the expected Submit toast
      // can be asserted precisely: "Assigned successfully" only if something
      // actually changed, otherwise "No changes to save" is equally valid.
      let anyChanged = false;
      for (const workArea of workAreas) {
        const changed = await wam.assignUserIfNeeded(workArea, user.name);
        anyChanged = anyChanged || changed;
        console.log(`  ${roleKey} @ ${workArea}: changed=${changed}`);
      }

      // Every row must show the user BEFORE submitting, so a silent
      // assign-failure is caught here rather than being blamed on the submit.
      for (const workArea of workAreas) {
        await expect(
          wam.getWorkAreaRow(workArea).locator('[role="combobox"]'),
          `${user.name} should be selected on row ${workArea} before Submit`
        ).toContainText(user.name);
      }

      const toastText = await wam.clickSubmit();
      console.log(`  ${roleKey}: anyChanged=${anyChanged}, toast="${toastText}"`);
      expect(
        toastText,
        `Submit should report either a successful assignment or no-change for ${user.name}`
      ).toMatch(anyChanged ? /Assigned successfully/i : /Assigned successfully|No changes to save/i);

      // Submit resets the dialog's fields but does NOT close it — close and
      // reopen from scratch so this confirms server-side persistence rather than
      // still-populated front-end form state (same reasoning as
      // 07_wam_ci.spec.js). Once for all rows, not once per row.
      await wam.closeDialog();
      await wam.openAddDetails();
      await wam.fillAssignmentFilters(filters);

      for (const workArea of workAreas) {
        const persisted = await wam.getWorkAreaUserValue(workArea);
        expect(
          persisted,
          `${user.role} "${user.name}" should still be assigned to ${workArea} after reopening the dialog`
        ).toContain(user.name);
      }
      console.log(`  ${roleKey}: confirmed on ${workAreas.length} work area(s) after reopen`);

      await wam.closeDialog();
    });
  }
});
