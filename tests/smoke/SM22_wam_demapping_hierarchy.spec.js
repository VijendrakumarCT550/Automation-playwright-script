const { test, expect } = require('../config/test-base');
const { loginAsUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { ensureDialogOpen, reopenWithFilters } = require('../utils/smoke-wam');
const DashboardPage = require('../pages/DashboardPage');
const WAMPage = require('../pages/WAMPage');

// Feature stage SM22: the smoke replica of
// 27_wam_demapping_hierarchy.spec.js — demapping ("Clear value") performed BY
// each hierarchy tier on the roles below it.
//
// The counterpart to SM20: that one proves each tier can UPDATE within its
// scope, this one proves each tier can REMOVE. Both matter because the tier
// system could plausibly grant one without the other, and a tier that can clear
// a row it should not reach is a permissions bug in the opposite direction.
//
// Every clear is paired with an ASSERTED restore. Demapping is the one WAM
// operation that removes access, so a run that clears and then dies leaves a
// user unable to see its work area — and the symptom appears in a different
// stage on a later run, with nothing linking it back here. App owner: "after
// checking creation mapping demapping old SM01 users should be restored."
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Per tier: the single-assignee work-area roles it clears (on isolated ground),
// and the multi-assignee row it clears (shared, so snapshot-and-restore-all).
const TIERS = [
  {
    key: 'CAD', label: 'Cluster Admin',
    singles: ['EE'],
    multiTarget: { key: 'SAD', level: 'site' },
  },
  {
    key: 'SAD', label: 'Site Admin',
    singles: ['EE'],
    multiTarget: { key: 'PAD', level: 'workLocation' },
  },
  {
    // Plot Admin gets TWO single-assignee targets and no multi one: every role
    // below it is work-area-scoped and single-assignee, so there is no
    // multi-assignee row inside its scope to clear.
    key: 'PAD', label: 'Plot Admin',
    singles: ['EE', 'QI'],
    multiTarget: null,
  },
];

// Clears one single-assignee work-area row and puts the same user back, proving
// both halves persisted. Shared by every tier's single-assignee test.
async function clearAndRestoreSingle(page, { tierLabel, target, profile, area }) {
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
  if (await ensureDialogOpen(wam, { reason: 'after filtering' })) {
    await wam.fillAssignmentFilters(filters);
  }

  const before = await wam.getWorkAreaUserValue(area);
  console.log(`  ${tierLabel}: before clear, ${target.role} @ ${area} = "${before || '(empty)'}"`);

  // Guarantee something to clear, so this exercises clearing a POPULATED row
  // rather than no-opping on an empty one.
  if (!before) {
    console.log(`  ${tierLabel}: row empty — assigning "${target.name}" first`);
    await wam.assignUserIfNeeded(area, target.name);
    await ensureDialogOpen(wam, { reason: 'before Submit (seed)' });
    await wam.clickSubmit();
    await reopenWithFilters(wam, filters);
  }

  const beforeClear = await wam.getWorkAreaUserValue(area);
  expect(beforeClear, 'Precondition: the row must be populated before testing Clear').not.toBe('');
  // Whatever is actually there is what gets restored — not assumed to be
  // target.name, since SM19/SM20 may have left a different (restored) value.
  const toRestore = beforeClear.split(',').map((n) => n.trim()).filter(Boolean)[0] || target.name;

  const cleared = await wam.clearWorkAreaUser(area);
  expect(
    cleared,
    `${tierLabel}: a "Clear value" button should have been present on ${area} — it only ` +
    `renders when the row has a value`
  ).toBe(true);

  await ensureDialogOpen(wam, { reason: 'before Submit (clear)' });
  await wam.clickSubmit();
  await reopenWithFilters(wam, filters);

  const afterClear = await wam.getWorkAreaUserValue(area);
  expect(
    afterClear,
    `${tierLabel}: ${area} should be EMPTY after Clear + Submit. A value here means this ` +
    `tier's clear was accepted client-side but never persisted — read access without ` +
    `write access.`
  ).toBe('');
  console.log(`  ${tierLabel}: after clear (persisted), ${area} is empty, as expected`);

  await wam.assignUserIfNeeded(area, toRestore);
  await ensureDialogOpen(wam, { reason: 'before Submit (restore)' });
  await wam.clickSubmit();
  await reopenWithFilters(wam, filters);

  const restored = await wam.getWorkAreaUserValue(area);
  expect(
    restored,
    `${tierLabel}: "${toRestore}" must be restored on ${area}. If this failed the row is ` +
    `EMPTY and that user has lost access — run \`npm run smoke:restore\`.`
  ).toContain(toRestore);
  console.log(`  ${tierLabel}: restored ${area} = "${restored}"`);

  await wam.closeDialog();
}

for (const tier of TIERS) {
  test.describe(`SM22 - ${tier.label} can demap (Clear value) roles below its own tier`, () => {
    // Separate describes per tier (each with its own login) so one tier's
    // login cannot skip the others' coverage.
    //
    // NOT serial mode WITHIN a tier — the single-assignee and multi-assignee
    // demap tests act on different rows and are independent; `serial` would
    // let one's failure skip the other's restore, which is exactly what this
    // stage exists to prevent. See SM01's comment for the fuller reasoning.

    let context, page, profile, users, mutateArea;

    test.beforeAll(async ({ browser, profile: p }) => {
      profile = p;
      const ground = requireFeatureGround(profile);
      mutateArea = ground.wamMutate;
      expect(mutateArea, `Profile "${profile.key}" declares no featureGround.wamMutate`).toBeTruthy();
      expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

      const needed = [tier.key, ...tier.singles, ...(tier.multiTarget ? [tier.multiTarget.key] : [])];
      users = resolveSmokeUsers(profile, needed);

      context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      page = await context.newPage();

      console.log(
        `\n=== SM22 as ${tier.label}: ${users[tier.key].name} <${users[tier.key].email}> ===\n` +
        `    single-assignee targets: ${tier.singles.map((s) => users[s].role).join(', ')} @ ${mutateArea}` +
        (tier.multiTarget ? `\n    multi-assignee target  : ${users[tier.multiTarget.key].role}` : '')
      );
      await loginAsUser(page, users[tier.key].email, PASSWORD);
      await expect(page, `${tier.label}: still on /login`).not.toHaveURL(/\/login/i);
    });

    test.afterAll(async () => {
      if (context) await context.close();
    });

    for (const singleKey of tier.singles) {
      test(`${tier.label} can clear ${singleKey} (single-assignee) and restoring it also persists`, async () => {
        test.setTimeout(20 * 60 * 1000);
        await clearAndRestoreSingle(page, {
          tierLabel: tier.label,
          target: users[singleKey],
          profile,
          area: mutateArea,
        });
      });
    }

    if (tier.multiTarget) {
      const mt = tier.multiTarget;
      test(`${tier.label} can clear ${mt.key} (multi-assignee) and restoring every original assignee also persists`, async () => {
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

        const rowOf = async () => (mt.level === 'site'
          ? wam.resolveRowLabel([profile.site, profile.site.toUpperCase()])
          : profile.workLocations[0]);
        const row = await rowOf();

        // SNAPSHOT — this row is SHARED (one site, one work location) and
        // several stages put people on it, so restore exactly what was found
        // rather than a hardcoded expectation.
        const before = await wam.getWorkAreaUserValue(row);
        const originalNames = before ? before.split(',').map((n) => n.trim()).filter(Boolean) : [];
        console.log(`  ${tier.label}: before clear, ${row} = [${originalNames.join(', ') || '(empty)'}]`);

        const namesToRestore = [...originalNames];
        if (!namesToRestore.includes(target.name)) {
          console.log(`  ${tier.label}: seeding "${target.name}" so this clears a populated row`);
          await wam.addAssigneeToRow(row, target.name);
          namesToRestore.push(target.name);
          await ensureDialogOpen(wam, { reason: 'before Submit (seed)' });
          await wam.clickSubmit();
          await reopenWithFilters(wam, filters);
        }

        const beforeClear = await wam.getWorkAreaUserValue(await rowOf());
        expect(beforeClear, 'Precondition: the row must be populated before testing Clear').not.toBe('');

        const cleared = await wam.clearWorkAreaUser(await rowOf());
        expect(cleared, `${tier.label}: a "Clear value" button should have been present`).toBe(true);

        await ensureDialogOpen(wam, { reason: 'before Submit (clear)' });
        await wam.clickSubmit();
        await reopenWithFilters(wam, filters);

        const afterClear = await wam.getWorkAreaUserValue(await rowOf());
        expect(
          afterClear,
          `${tier.label}: the row should be EMPTY after Clear + Submit — for a ` +
          `multi-assignee row Clear removes ALL assignees at once`
        ).toBe('');
        console.log(`  ${tier.label}: after clear (persisted), ${row} is empty, as expected`);

        // Restore every captured name, one at a time (addAssigneeToRow only
        // adds). Failures collected rather than thrown, so one un-restorable
        // name does not abandon the rest.
        const restoreFailures = [];
        for (const name of namesToRestore) {
          try {
            await wam.addAssigneeToRow(await rowOf(), name);
          } catch (err) {
            restoreFailures.push({ name, message: err.message });
          }
        }
        await ensureDialogOpen(wam, { reason: 'before Submit (restore)' });
        await wam.clickSubmit();
        await reopenWithFilters(wam, filters);

        const restored = await wam.getWorkAreaUserValue(await rowOf());
        console.log(`  ${tier.label}: restored ${row} = "${restored}"`);

        // Asserted AFTER the demapping checks and separately from them, so the
        // report distinguishes "this tier cannot clear" from "clear works but
        // shared state was left short an assignee".
        expect(
          restoreFailures,
          `${tier.label}: failed to re-add ${JSON.stringify(restoreFailures)} to ${row}. ` +
          `Shared WAM state is short those assignees — run \`npm run smoke:restore\`.`
        ).toEqual([]);
        for (const name of namesToRestore) {
          expect(
            restored,
            `"${name}" was on ${row} before this test and must be back on it afterwards`
          ).toContain(name);
        }

        await wam.closeDialog();
      });
    }
  });
}
