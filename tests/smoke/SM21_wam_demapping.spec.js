const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { openAssignmentDialog, ensureDialogOpen, reopenWithFilters } = require('../utils/smoke-wam');

// Feature stage SM21: the smoke replica of 25_wam_demapping.spec.js — WAM's
// "Clear value" (demapping), for both row cardinalities, each cleared AND
// restored with the restore asserted.
//
// Demapping is the one WAM operation that REMOVES access, so it is the one where
// a half-finished run does real damage: a user left unmapped cannot see its work
// area, and the symptom appears in a completely different stage on a later run
// ("work area not visible" during RFI creation) with nothing linking it back
// here. That is why every clear in this file is paired with an asserted restore
// rather than best-effort cleanup, and why SM27 re-asserts the whole band
// afterwards.
//
// App owner, 2026-09-04: "after checking creation mapping demapping old SM01
// users should be restored."
//
// ---------------------------------------------------------------------------
// GROUND
// ---------------------------------------------------------------------------
// The original cleared A-06c/BL01 (regression ground) for the single-assignee
// case and the S05b work-location row for the multi-assignee case. The
// single-assignee case moves to featureGround.wamMutate, which nothing else
// uses. The multi-assignee case CANNOT move — there is exactly one S05b — so it
// keeps the original's snapshot-everything-and-put-it-all-back approach, with
// the restore hard-asserted.
//
// NOT serial mode — the single-assignee and multi-assignee tests act on
// different rows and are independent; `serial` would let one's failure skip
// the other's restore, which is precisely the outcome this stage exists to
// prevent. See SM01's comment for the fuller reasoning.

test.describe('Smoke stage SM21 - WAM demapping (Clear value)', () => {
  let context, page, dashboard, profile, users, mutateArea;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    const ground = requireFeatureGround(profile);
    mutateArea = ground.wamMutate;
    expect(mutateArea, `Profile "${profile.key}" declares no featureGround.wamMutate`).toBeTruthy();

    users = resolveSmokeUsers(profile, ['EE', 'PAD']);

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    console.log(
      `\n=== SM21 WAM demapping: "${profile.key}" ===\n` +
      `    single-assignee row : ${mutateArea} (isolated)\n` +
      `    multi-assignee row  : ${profile.workLocations[0]} (shared — snapshot + full restore)\n`
    );
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  test('Single-assignee work-area row: clearing Execution Engineer persists, then restoring persists', async () => {
    test.setTimeout(10 * 60 * 1000);
    const ee = users.EE;
    const filters = {
      role: ee.role,
      cluster: profile.cluster,
      site: profile.site,
      workLocation: profile.workLocations[0],
      package: profile.packages[0],
    };

    const wam = await openAssignmentDialog(page, dashboard, filters);

    const before = await wam.getWorkAreaUserValue(mutateArea);
    console.log(`  before clear: ${mutateArea} = "${before || '(empty)'}"`);

    // Restore target is always SM01's EE for this run: wamMutate is isolated
    // ground that only this tier writes to, so there is no third-party assignee
    // to preserve here (unlike the shared work-location row in the next test,
    // which has to snapshot whatever it finds).
    const target = ee.name;

    // Make sure there IS something to clear, so this exercises clearing a
    // POPULATED row rather than silently no-opping on an empty one. SM03 seeds
    // wamMutate, so normally this is already satisfied.
    if (!before) {
      console.log(`  row empty — assigning "${ee.name}" first so there is something to clear`);
      await wam.assignUserIfNeeded(mutateArea, ee.name);
      await ensureDialogOpen(wam, { reason: 'before Submit (seed)' });
      await wam.clickSubmit();
      await reopenWithFilters(wam, filters);
    }

    const beforeClear = await wam.getWorkAreaUserValue(mutateArea);
    expect(beforeClear, 'Precondition: the row must be populated before testing Clear').not.toBe('');

    const cleared = await wam.clearWorkAreaUser(mutateArea);
    expect(
      cleared,
      `A "Clear value" button should have been present on ${mutateArea} — it only renders ` +
      `when the row has a value, so its absence means the row was already empty`
    ).toBe(true);

    await ensureDialogOpen(wam, { reason: 'before Submit (clear)' });
    await wam.clickSubmit();
    await reopenWithFilters(wam, filters);

    const afterClear = await wam.getWorkAreaUserValue(mutateArea);
    expect(
      afterClear,
      `${mutateArea} should be EMPTY after Clear + Submit. A value here means the clear was ` +
      `accepted client-side but never persisted.`
    ).toBe('');
    console.log(`  after clear (persisted): ${mutateArea} is empty, as expected`);

    // ---- restore, asserted ----
    await wam.assignUserIfNeeded(mutateArea, target);
    await ensureDialogOpen(wam, { reason: 'before Submit (restore)' });
    await wam.clickSubmit();
    await reopenWithFilters(wam, filters);

    const restored = await wam.getWorkAreaUserValue(mutateArea);
    expect(
      restored,
      `"${target}" must be restored on ${mutateArea}. If this fails the row is left ` +
      `EMPTY and that user has lost access to it — run \`npm run smoke:restore\`.`
    ).toContain(target);
    console.log(`  restored: ${mutateArea} = "${restored}"`);

    await wam.closeDialog();
  });

  test('Multi-assignee work-location row: clearing Plot Admin persists, then restoring every original assignee also persists', async () => {
    test.setTimeout(10 * 60 * 1000);
    const pad = users.PAD;
    const filters = { role: pad.role, cluster: profile.cluster, site: profile.site };
    const row = profile.workLocations[0];

    const wam = await openAssignmentDialog(page, dashboard, filters);

    // SNAPSHOT rather than assume. This row is SHARED — it is the smoke work
    // location, and SM04's cascade, SM13 and SM19 all put people on it — so what
    // is here depends on what ran before. Capture whatever is actually present
    // and put exactly that back.
    const before = await wam.getWorkAreaUserValue(row);
    const originalNames = before ? before.split(',').map((n) => n.trim()).filter(Boolean) : [];
    console.log(`  before clear: ${row} = [${originalNames.join(', ') || '(empty)'}]`);

    const namesToRestore = [...originalNames];
    if (!namesToRestore.includes(pad.name)) {
      console.log(`  seeding "${pad.name}" so this clears a populated row`);
      await wam.addAssigneeToRow(row, pad.name);
      namesToRestore.push(pad.name);
      await ensureDialogOpen(wam, { reason: 'before Submit (seed)' });
      await wam.clickSubmit();
      await reopenWithFilters(wam, filters);
    }

    const beforeClear = await wam.getWorkAreaUserValue(row);
    expect(beforeClear, 'Precondition: the row must be populated before testing Clear').not.toBe('');

    const cleared = await wam.clearWorkAreaUser(row);
    expect(cleared, `A "Clear value" button should have been present on ${row}`).toBe(true);

    await ensureDialogOpen(wam, { reason: 'before Submit (clear)' });
    await wam.clickSubmit();
    await reopenWithFilters(wam, filters);

    const afterClear = await wam.getWorkAreaUserValue(row);
    expect(
      afterClear,
      `${row} should be EMPTY after Clear + Submit — for a multi-assignee row, Clear ` +
      `removes ALL assignees at once, not just one`
    ).toBe('');
    console.log(`  after clear (persisted): ${row} is empty, as expected`);

    // ---- restore EVERY captured name ----
    // One at a time: addAssigneeToRow only ever adds, so the row is rebuilt
    // incrementally. Failures are collected rather than thrown so that one
    // un-restorable name does not abandon the rest still-unrestored.
    const restoreFailures = [];
    for (const name of namesToRestore) {
      try {
        await wam.addAssigneeToRow(row, name);
      } catch (err) {
        restoreFailures.push({ name, message: err.message });
      }
    }
    await ensureDialogOpen(wam, { reason: 'before Submit (restore)' });
    await wam.clickSubmit();
    await reopenWithFilters(wam, filters);

    const restored = await wam.getWorkAreaUserValue(row);
    console.log(`  restored: ${row} = "${restored}"`);

    // Reported SEPARATELY from the demapping assertions above, and after them,
    // so the report distinguishes "Clear is broken" from "Clear works but shared
    // state was left short an assignee" — different problems with different
    // urgency.
    expect(
      restoreFailures,
      `Failed to re-add ${JSON.stringify(restoreFailures)} to ${row}. Shared WAM state is ` +
      `now short those assignees — run \`npm run smoke:restore\`.`
    ).toEqual([]);
    for (const name of namesToRestore) {
      expect(
        restored,
        `"${name}" was on ${row} before this test and must be back on it afterwards`
      ).toContain(name);
    }

    await wam.closeDialog();
  });
});
