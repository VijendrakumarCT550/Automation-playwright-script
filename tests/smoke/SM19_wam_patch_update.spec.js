const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { openAssignmentDialog, ensureDialogOpen, reopenWithFilters } = require('../utils/smoke-wam');

// Feature stage SM19: the smoke replica of 26_wam_patch_update.spec.js — WAM's
// UPDATE semantics, which differ by row type and are the app owner's explicit
// choice rather than anything inferable from the UI.
//
//   SINGLE-ASSIGNEE rows (work-area rows for EE/QI/EL/QL/CI/CM, and the
//   work-location row for Project Manager): a pick REPLACES whoever held the
//   row. "Update" means substitution.
//
//   MULTI-ASSIGNEE rows (Plot Admin at work-location, Site Admin at site,
//   Cluster Admin at cluster): "update" means ADDING someone ALONGSIDE the
//   existing assignees — there is no single-person-replace action in this UI at
//   all. App owner, 2026-08-21.
//
// Getting that backwards is destructive, not merely wrong: clicking an
// already-selected option on an Ark UI multi-select TOGGLES IT OFF, which is
// what once wiped Cluster Admin's row to empty and dropped names from Site
// Admin's and Project Manager's rows.
//
// ---------------------------------------------------------------------------
// GROUND, AND WHY THIS STAGE IS NO LONGER "DESTRUCTIVE LAST"
// ---------------------------------------------------------------------------
// The original mutated A-06c/BL01 — a row the regression tier depends on — which
// is why it had to be ordered dead last in a linear chain, and why one failure
// upstream of it skipped everything. It now mutates featureGround.wamMutate
// (BL10), an area nothing else uses, seeded by SM03 so there is always a
// baseline to replace.
//
// That single change is what let the whole feature tier become independent
// sibling leaves — see SMOKE_FEATURE_STAGES in playwright.config.js.
//
// The higher-tier rows (work location / site / cluster) CANNOT be isolated the
// same way: there is only one S05b, one Khavda, one Gujarat. So for those:
//   * the multi-assignee ones only ADD, evicting nobody;
//   * Project Manager, the one single-assignee higher-tier row, is replaced and
//     then restored, with the restore asserted — and SM27 re-asserts the whole
//     band afterwards as a backstop.
//
// App owner: "after checking creation mapping demapping old SM01 users should be
// restored."
//
// NOT serial mode — fixed 2026-09-05 after EL's precondition failure (a real
// bug, since fixed: nobody actually seeded EL/QL onto wamMutate) skipped the
// remaining 7 tests in this file (QL, CI, CM, PM, and both multi-assignee
// tests) purely because of `serial`'s abort-on-failure semantics. Every test
// here is independent — each resolves its own filters and opens its own
// dialog — so one role's failure must never cost the others their coverage.
// See SM01's comment for the fuller reasoning.

// Row-level + assignee-cardinality, which together decide the interaction.
// Module constants: tests are generated at COLLECTION time, before `profile`.
const SINGLE_ASSIGNEE = [
  { key: 'EE', level: 'workArea' },
  { key: 'QI', level: 'workArea' },
  { key: 'EL', level: 'workArea' },
  { key: 'QL', level: 'workArea' },
  { key: 'CI', level: 'workArea' },
  { key: 'CM', level: 'workArea' },
  { key: 'PM', level: 'workLocation' },
];

const MULTI_ASSIGNEE = [
  { key: 'PAD', level: 'workLocation' },
  { key: 'SAD', level: 'site' },
  { key: 'CAD', level: 'cluster' },
];

const ALL = [...SINGLE_ASSIGNEE, ...MULTI_ASSIGNEE];

// Builds the filter set for a row level. The DEPTH is the whole point: filtering
// by the thing you want as a row leaves nothing to assign to.
function filtersFor(profile, user, level) {
  const base = { role: user.role };
  if (level === 'cluster') return base;
  if (level === 'site') return { ...base, cluster: profile.cluster };
  if (level === 'workLocation') return { ...base, cluster: profile.cluster, site: profile.site };
  return {
    ...base,
    cluster: profile.cluster,
    site: profile.site,
    workLocation: profile.workLocations[0],
    package: profile.packages[0],
    serviceOrder: user.userType === 'VENDOR'
      ? [profile.vendor.serviceOrder, profile.vendor.name]
      : null,
  };
}

test.describe('Smoke stage SM19 - WAM patch/update semantics per role', () => {
  let context, page, dashboard, profile, users, mutateArea;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    const ground = requireFeatureGround(profile);
    mutateArea = ground.wamMutate;
    expect(
      mutateArea,
      `Profile "${profile.key}" declares no featureGround.wamMutate area. This stage ` +
      `must have ground of its own to mutate — pointing it at shared ground is what ` +
      `forced the old linear chain.`
    ).toBeTruthy();

    users = resolveSmokeUsers(profile, ALL.map((r) => r.key));

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    console.log(
      `\n=== SM19 WAM patch/update: "${profile.key}" ===\n` +
      `    mutating work-area row : ${mutateArea} (featureGround.wamMutate, isolated)\n` +
      `    higher-tier rows       : ${profile.workLocations[0]} / ${profile.site} / ` +
      `${JSON.stringify(profile.cluster)} (shared — add-only or restore-asserted)\n`
    );
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  // ---- Single-assignee: replace, verify, restore ----
  for (const { key, level } of SINGLE_ASSIGNEE) {
    test(`Updating ${key}'s assignment (replace with a different user) persists, then restores`, async () => {
      test.setTimeout(10 * 60 * 1000);
      const user = users[key];
      const filters = filtersFor(profile, user, level);
      const row = level === 'workArea' ? mutateArea : profile.workLocations[0];

      const wam = await openAssignmentDialog(page, dashboard, filters);

      // SEED IF EMPTY, rather than assert-and-fail. Found live 2026-09-05: this
      // used to hard-assert the row was already populated, on the assumption
      // that "SM03 seeds every work-area row this stage touches" — true for
      // EE/QI/CI/CM (SM03's own FLOW_ROLES), but NOT for EL/QL, which nobody
      // else ever puts on wamMutate specifically (SM13 covers EL/QL only on
      // wamSweep, a different area, as ITS OWN coverage). The assumption was
      // simply wrong for two of the seven roles this loop tests, and every
      // failure was a precondition failure, not the update logic being broken.
      //
      // Self-seeding — the same pattern SM21's demap test already uses for the
      // identical reason — removes the dependency on guessing correctly which
      // OTHER stage happens to have populated this row, for EVERY role in this
      // loop, not just the two that were actually missing.
      let original = await wam.getWorkAreaUserValue(row);
      if (!original) {
        console.log(`  ${key}: ${row} is empty — assigning "${user.name}" first so there is an update to test`);
        await wam.assignUserIfNeeded(row, user.name);
        await ensureDialogOpen(wam, { reason: 'before Submit (seed)' });
        await wam.clickSubmit();
        await reopenWithFilters(wam, filters);
        original = await wam.getWorkAreaUserValue(row);
      }
      expect(
        original,
        `${user.role}'s row "${row}" is still empty even after attempting to seed it with ` +
        `"${user.name}" — this is a real failure to assign, not a missing precondition.`
      ).not.toBe('');
      console.log(`  ${key} before: ${row} = "${original}"`);

      const updated = await wam.selectDifferentWorkAreaUser(row, original);
      // A legitimate data state, not a defect: if the dropdown offers only the
      // current value there is no different user to switch to, so there is
      // nothing here to test.
      test.skip(
        updated === null,
        `No alternative user offered for ${user.role} at ${row} — nothing to update to`
      );
      await expect(
        wam.getWorkAreaRow(row).locator('[role="combobox"]'),
        `${key}: row should show the newly picked "${updated}" before Submit`
      ).toContainText(updated);

      await ensureDialogOpen(wam, { reason: 'before Submit (update)' });
      await wam.clickSubmit();
      await reopenWithFilters(wam, filters);

      const afterUpdate = await wam.getWorkAreaUserValue(row);
      expect(
        afterUpdate,
        `${key}: the update to "${updated}" should survive closing and reopening the dialog`
      ).toContain(updated);
      console.log(`  ${key} after update (persisted): ${row} = "${afterUpdate}"`);

      // ---- RESTORE, and assert it ----
      // Not best-effort cleanup: for the higher-tier rows this is the ONLY thing
      // putting shared ground back, and a silent failure here leaves the next
      // run pointed at the wrong user with nothing in the report to say so.
      await wam.selectWorkAreaUser(row, original);
      await ensureDialogOpen(wam, { reason: 'before Submit (restore)' });
      await wam.clickSubmit();
      await reopenWithFilters(wam, filters);

      const restored = await wam.getWorkAreaUserValue(row);
      expect(
        restored,
        `${key}: the ORIGINAL assignee "${original}" must be restored on ${row}. If this ` +
        `fails the row is left holding "${updated}" — run \`npm run smoke:restore\` before ` +
        `the next full run.`
      ).toContain(original);
      console.log(`  ${key} restored: ${row} = "${restored}"`);

      await wam.closeDialog();
    });
  }

  // ---- Multi-assignee: add alongside, verify nobody was dropped ----
  for (const { key, level } of MULTI_ASSIGNEE) {
    test(`Updating ${key}'s row (adding an assignee alongside existing ones) persists`, async () => {
      test.setTimeout(10 * 60 * 1000);
      const user = users[key];
      const filters = filtersFor(profile, user, level);

      const wam = await openAssignmentDialog(page, dashboard, filters);

      // Resolve the row label against what is actually rendered. Confirmed live
      // that a site/cluster row can render "KHAVDA" even when "Khavda" or
      // "Gujarat" was typed into the filter above it.
      const row = level === 'workLocation'
        ? profile.workLocations[0]
        : await wam.resolveRowLabel(
            level === 'site'
              ? [profile.site, profile.site.toUpperCase()]
              : [].concat(profile.cluster).flatMap((c) => [c, c.toUpperCase()])
          );

      const before = await wam.getWorkAreaUserValue(row);
      expect(
        before,
        `Precondition: ${user.role}'s row "${row}" should already have assignees ` +
        `(SM04's cascade and SM13 both put people here)`
      ).not.toBe('');
      const existing = before.split(',').map((n) => n.trim()).filter(Boolean);
      console.log(`  ${key} before: ${row} = [${existing.join(', ')}]`);

      const added = await wam.addAnyUnassignedUser(row);
      // Legitimate edge case: if every possible person already holds this row
      // there is nobody left to add.
      test.skip(
        added === null,
        `Every offered user is already on ${row} for ${user.role} — nobody left to add`
      );

      await ensureDialogOpen(wam, { reason: 'before Submit (multi add)' });
      await wam.clickSubmit();
      await reopenWithFilters(wam, filters);

      const after = await wam.getWorkAreaUserValue(row);
      // THE ACTUAL ASSERTION OF THIS TEST: an add must not be a replace. This is
      // what catches the toggle-off bug that once emptied Cluster Admin's row.
      for (const name of existing) {
        expect(
          after,
          `${key}: existing assignee "${name}" must STILL be on ${row} after adding ` +
          `"${added}" — if it is gone, the add behaved as a replace (or toggled someone off)`
        ).toContain(name);
      }
      expect(
        after,
        `${key}: newly added "${added}" should be present on ${row}`
      ).toContain(added);
      console.log(`  ${key} after add (persisted): ${row} = "${after}"`);

      // NOT restored, deliberately. These rows are additive by design and the
      // extra assignee is harmless — whereas removing them would mean a demap,
      // which is SM21/SM22's job and would make this stage destructive for no
      // reason.
      await wam.closeDialog();
    });
  }
});
