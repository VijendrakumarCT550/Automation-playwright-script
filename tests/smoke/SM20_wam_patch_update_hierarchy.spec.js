const { test, expect } = require('../config/test-base');
const { loginAsUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { ensureDialogOpen, reopenWithFilters } = require('../utils/smoke-wam');
const DashboardPage = require('../pages/DashboardPage');
const WAMPage = require('../pages/WAMPage');

// Feature stage SM20: the smoke replica of
// 28_wam_patch_update_hierarchy.spec.js — the same WAM update semantics SM19
// proves for Admin, but performed BY each hierarchy tier on the roles below it.
//
// The question is authorisation, not mechanics: SM19 already establishes that
// replace-vs-add works. This establishes that a Cluster Admin, Site Admin and
// Plot Admin can each do it within their own scope — i.e. that the tier system
// grants write access and not merely read access. A tier that can SEE a row but
// silently fails to save it is a real defect no other stage would catch.
//
// Ground and users: featureGround.wamMutate for the single-assignee target
// (isolated), the profile's shared rows for the multi-assignee ones (add-only,
// so nobody is evicted), and SM01's users throughout — the original resolved
// the bare-prefix batch.
//
// PRECONDITION: these tiers must be WAM'd before they can log in and see
// anything, which SM04's cascade and SM13 both do. Declared later than both in
// SMOKE_FEATURE_STAGES so a full run has already mapped them.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Each tier, the single-assignee role it updates, and the multi-assignee row it
// adds to. `multiTarget: null` for Plot Admin — every role below it is
// work-area-scoped and single-assignee, so there is no multi row in its scope.
const TIERS = [
  { key: 'CAD', label: 'Cluster Admin', single: 'EE', multiTarget: { key: 'SAD', level: 'site' } },
  { key: 'SAD', label: 'Site Admin', single: 'EE', multiTarget: { key: 'PAD', level: 'workLocation' } },
  { key: 'PAD', label: 'Plot Admin', single: 'QI', multiTarget: null },
];

for (const tier of TIERS) {
  test.describe(`SM20 - ${tier.label} can update WAM assignments below its tier`, () => {
    // Each tier gets its own describe (with its own login) so one tier's
    // login failure cannot skip the others' coverage entirely.
    //
    // NOT serial mode WITHIN a tier, though — fixed 2026-09-05. The
    // single-assignee and multi-assignee tests inside one tier act on
    // completely different rows and are independent of each other; `serial`
    // would mean the single-assignee test failing skips the multi-assignee one
    // too, for no correctness reason. Sharing one login is enough — order and
    // single-worker safety both already come from the `--workers=1` every npm
    // script and run-smoke.js enforce for the whole run. See SM01's comment for
    // the fuller reasoning.

    let context, page, profile, users, mutateArea;

    test.beforeAll(async ({ browser, profile: p }) => {
      profile = p;
      const ground = requireFeatureGround(profile);
      mutateArea = ground.wamMutate;
      expect(mutateArea, `Profile "${profile.key}" declares no featureGround.wamMutate`).toBeTruthy();
      expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

      const needed = [tier.key, tier.single, ...(tier.multiTarget ? [tier.multiTarget.key] : [])];
      users = resolveSmokeUsers(profile, needed);

      context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      page = await context.newPage();

      console.log(
        `\n=== SM20 as ${tier.label}: ${users[tier.key].name} <${users[tier.key].email}> ===\n` +
        `    single-assignee target: ${users[tier.single].role} @ ${mutateArea}` +
        (tier.multiTarget ? `\n    multi-assignee target : ${users[tier.multiTarget.key].role}` : '')
      );
      await loginAsUser(page, users[tier.key].email, PASSWORD);
      await expect(page, `${tier.label}: still on /login`).not.toHaveURL(/\/login/i);
    });

    test.afterAll(async () => {
      if (context) await context.close();
    });

    test(`${tier.label} can update ${tier.single} (replace with a different user) and it persists`, async () => {
      // Wide: a first login can sit through the PWA spinner, and this does a
      // replace plus a restore, each with a close-reopen verification.
      test.setTimeout(20 * 60 * 1000);
      const target = users[tier.single];
      const filters = {
        role: target.role,
        cluster: profile.cluster,
        site: profile.site,
        workLocation: profile.workLocations[0],
        package: profile.packages[0],
        serviceOrder: target.userType === 'VENDOR'
          ? [profile.vendor.serviceOrder, profile.vendor.name]
          : null,
      };

      const wam = new WAMPage(page);
      await wam.goto(new DashboardPage(page));
      await wam.openAddDetails();
      await wam.fillAssignmentFilters(filters);
      // Reading the Role dropdown can close the whole dialog via Escape
      // bubbling — see ensureDialogOpen.
      if (await ensureDialogOpen(wam, { reason: 'after filtering' })) {
        await wam.fillAssignmentFilters(filters);
      }

      const original = await wam.getWorkAreaUserValue(mutateArea);
      expect(
        original,
        `Precondition: ${target.role} should already be assigned at ${mutateArea} for there ` +
        `to be an update to test — SM03 seeds this area`
      ).not.toBe('');
      console.log(`  before: ${mutateArea} = "${original}"`);

      const updated = await wam.selectDifferentWorkAreaUser(mutateArea, original);
      test.skip(
        updated === null,
        `${tier.label} is offered no alternative ${target.role} at ${mutateArea} — nothing to update to`
      );
      await expect(
        wam.getWorkAreaRow(mutateArea).locator('[role="combobox"]')
      ).toContainText(updated);

      await ensureDialogOpen(wam, { reason: 'before Submit (update)' });
      await wam.clickSubmit();
      await reopenWithFilters(wam, filters);

      const afterUpdate = await wam.getWorkAreaUserValue(mutateArea);
      expect(
        afterUpdate,
        `${tier.label} should be ABLE to write here — the update to "${updated}" did not ` +
        `persist, which means this tier has read access but not write access`
      ).toContain(updated);
      console.log(`  after update (persisted): ${mutateArea} = "${afterUpdate}"`);

      // Restore, asserted — see SM19's note on why this is not cleanup.
      await wam.selectWorkAreaUser(mutateArea, original);
      await ensureDialogOpen(wam, { reason: 'before Submit (restore)' });
      await wam.clickSubmit();
      await reopenWithFilters(wam, filters);

      const restored = await wam.getWorkAreaUserValue(mutateArea);
      expect(
        restored,
        `The original "${original}" must be restored on ${mutateArea} — run ` +
        `\`npm run smoke:restore\` if this failed`
      ).toContain(original);
      console.log(`  restored: ${mutateArea} = "${restored}"`);

      await wam.closeDialog();
    });

    if (tier.multiTarget) {
      const mt = tier.multiTarget;
      test(`${tier.label} can update ${mt.key} (add an assignee alongside existing ones) and it persists`, async () => {
        test.setTimeout(20 * 60 * 1000);
        const target = users[mt.key];
        const filters = mt.level === 'site'
          ? { role: target.role, cluster: profile.cluster }
          : { role: target.role, cluster: profile.cluster, site: profile.site };

        const wam = new WAMPage(page);
        await wam.goto(new DashboardPage(page));
        await wam.openAddDetails();
        await wam.fillAssignmentFilters(filters);
        if (await ensureDialogOpen(wam, { reason: 'after filtering' })) {
          await wam.fillAssignmentFilters(filters);
        }

        // Resolve against what is actually rendered: a site/cluster row can
        // show "KHAVDA" even when "Khavda"/"Gujarat" was filtered on.
        const row = mt.level === 'site'
          ? await wam.resolveRowLabel([profile.site, profile.site.toUpperCase()])
          : profile.workLocations[0];

        const before = await wam.getWorkAreaUserValue(row);
        expect(
          before,
          `Precondition: ${target.role}'s row "${row}" should already have assignees ` +
          `(SM04's cascade and SM13 both populate it)`
        ).not.toBe('');
        const existing = before.split(',').map((n) => n.trim()).filter(Boolean);
        console.log(`  before: ${row} = [${existing.join(', ')}]`);

        const added = await wam.addAnyUnassignedUser(row);
        test.skip(
          added === null,
          `Every offered user already holds ${row} for ${target.role} — nobody left to add`
        );

        await ensureDialogOpen(wam, { reason: 'before Submit (multi add)' });
        await wam.clickSubmit();
        await reopenWithFilters(wam, filters);

        const after = await wam.getWorkAreaUserValue(
          mt.level === 'site'
            ? await wam.resolveRowLabel([profile.site, profile.site.toUpperCase()])
            : row
        );
        // The real assertion: an add must not behave as a replace. This is what
        // catches the Ark UI toggle-off bug that once emptied Cluster Admin's row.
        for (const name of existing) {
          expect(
            after,
            `${tier.label}: existing assignee "${name}" must STILL be on ${row} after ` +
            `adding "${added}"`
          ).toContain(name);
        }
        expect(after, `Newly added "${added}" should be on ${row}`).toContain(added);
        console.log(`  after add (persisted): ${row} = "${after}"`);

        // Not restored: these rows are additive by design and the extra
        // assignee is harmless. Removing them would be a demap, which is
        // SM22's subject.
        await wam.closeDialog();
      });
    }
  });
}
