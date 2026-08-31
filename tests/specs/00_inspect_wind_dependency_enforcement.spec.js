const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser, stripLabelPrefix, sameLabel } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const { fillPageOne } = require('../utils/rfi-dependency-flow');
const { WIND_E2E } = require('../config/projects');

// Answers the LAST open question about wind's RFI behaviour, and the one that
// gates whether a wind equivalent of 29_rfi_activity_dependency.spec.js can
// exist at all:
//
//   Does wind ENFORCE the preceding-checkpoint dependency?
//
// The activity master marks EVERY one of its 144 rows
// "Is the Inspection Checkpoint Optional? = Y". Read literally that means the
// dependency is advisory on wind — the opposite of solar, where
// 29_rfi_activity_dependency.spec.js proves it is hard-blocked with a
// "Missing an RFI for Dependent Inspection Point" validation error. A column
// that is constant across 290 rows in two independently-dated sheets is more
// likely an unfilled default than a real rule, but it cannot be assumed either
// way, so this measures it.
//
// HOW, and why on THIS activity:
// The smoke stage has already consumed Crane Pad's A1.18.1 and A1.18.2 (both
// now approved), so attempting A1.18.3 would proceed on its own merits and
// prove nothing. "Stone Column Installation" is untouched — none of its
// checkpoints has ever been raised — so attempting its SECOND checkpoint while
// its FIRST has never been created is a clean enforcement test:
//
//   A1.1.1  Pre-Activity Work  / Pre-Activity Checkpoint      preceding: -
//   A1.1.2  Stone Column Work  / Inspection of Stone Column   preceding: A1.1.1   <-- attempt this
//   A1.1.3  Post-Activity Work / Post-Activity Checkpoint     preceding: A1.1.2
//
// If Proceed is BLOCKED with a dependency toast -> wind enforces it, and the
// wind dependency spec is writable (using the two-Work-Areas strategy, since
// wind has one Work Section per Work Area). If Proceed SUCCEEDS -> the
// Optional=Y column is real, there is nothing to enforce, and no wind
// counterpart to spec 29 should be written.
//
// COST, stated plainly: this permanently consumes A1.1.2's (checkpoint,
// "KH 34") pair, because merely SELECTING a Work Section consumes it whether or
// not anything is submitted. It deliberately spends a STONE COLUMN checkpoint
// rather than one of the three Crane Pad checkpoints the smoke stage still has.
// It never submits — it stops at the Proceed outcome and cancels out.
const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'so-mapping-baseline');
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Live labels carry position prefixes whose FORMAT is inconsistent — Crane Pad
// renders "1.1 ..."/"1.2 ..." but Stone Column renders "1. 2 ..."/"1. 3 ..."
// with a space inside the prefix (confirmed live; an earlier local regex here
// handled only "<n>.<n>" and left "2 Stone Column Work", so every match failed).
// stripLabelPrefix/sameLabel in helpers.js are the single canonical
// implementation — do not re-derive one here.

const TARGET = {
  subPackage: 'Stone Column',
  activity: 'Stone Column Installation',
  subActivity: 'Stone Column Work',              // A1.1.2's sub-activity
  checkpoint: 'Inspection of Stone Column',      // A1.1.2's checkpoint
  checklist: 'Stone Column Inspection Protocol for Vibro-Non Vibro Method',
  predecessor: 'A1.1.1 Pre-Activity Checkpoint (never created)',
};

test('Does WIND enforce the preceding-checkpoint dependency?', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  const ci = loadLastCreatedUsers()[WIND_E2E.users.prefixes.CI];
  expect(ci && ci.profileKey === WIND_E2E.key,
    'No WTG Contractor Incharge recorded — run the smoke-wind-* stages first.').toBeTruthy();
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const report = {
    baseUrl: process.env.BASE_URL,
    question: 'Does wind enforce the preceding-checkpoint dependency?',
    target: TARGET,
    loggedInAs: ci.name,
  };

  await loginAsFlowUser(page, ci.email, PASSWORD);

  // Resolve the live labels first, so the attempt uses exactly what the form
  // renders. Uses the same page objects the smoke stage does.
  const MyTasksPage = require('../pages/MyTasksPage');
  const RFICreatePage = require('../pages/RFICreatePage');
  const { resetToMyTasks } = require('../utils/rfi-dependency-flow');

  await resetToMyTasks(page);
  const myTasks = new MyTasksPage(page);
  await myTasks.waitForLoad();
  await myTasks.clickCreateRFI();

  const probe = new RFICreatePage(page);
  const readOpts = async (dropdown, label) => {
    const listbox = await probe._openDropdown(dropdown);
    const texts = (await listbox.locator('[role="option"]').allInnerTexts())
      .map(t => t.replace(/\s*✓\s*$/, '').trim()).filter(Boolean);
    await probe.closeAnyOpenListbox();
    console.log(`  ${label} (${texts.length}): ${JSON.stringify(texts)}`);
    return texts;
  };

  await probe.selectOption(probe.workLocationDropdown, WIND_E2E.rfi.workLocation);
  await probe.selectOption(probe.workAreaDropdown, WIND_E2E.rfi.workArea);
  await probe.selectOption(probe.packageDropdown, WIND_E2E.rfi.package);

  const subPackages = await readOpts(probe.subPackageDropdown, 'Sub-Package');
  const subPackage = subPackages.find(s => sameLabel(s, TARGET.subPackage));
  expect(subPackage, `Sub-package "${TARGET.subPackage}" not offered`).toBeTruthy();
  await probe.selectOption(probe.subPackageDropdown, subPackage);

  const activities = await readOpts(probe.activityDropdown, 'Activity');
  const activity = activities.find(a => sameLabel(a, TARGET.activity));
  expect(activity, `Activity "${TARGET.activity}" not offered`).toBeTruthy();
  await probe.selectOption(probe.activityDropdown, activity);

  const subActivities = await readOpts(probe.subActivityDropdown, 'Sub-Activity');
  const subActivity = subActivities.find(s => sameLabel(s, TARGET.subActivity));
  expect(
    subActivity,
    `Sub-activity "${TARGET.subActivity}" not offered; got ${JSON.stringify(subActivities)}`
  ).toBeTruthy();
  await probe.selectOption(probe.subActivityDropdown, subActivity);

  const checkpoints = await readOpts(probe.inspectionCheckpointDropdown, 'Checkpoint');
  const checkpoint = checkpoints.find(c => sameLabel(c, TARGET.checkpoint)) || checkpoints[0];
  const checklists = await (async () => {
    await probe.selectOption(probe.inspectionCheckpointDropdown, checkpoint);
    return readOpts(probe.inspectionChecklistDropdown, 'Checklist');
  })();

  report.live = { subPackage, activity, subActivity, checkpoint, checklists };
  console.log(
    `\n  Attempting ${TARGET.subActivity} / "${checkpoint}" ` +
    `while its predecessor (${TARGET.predecessor}) does NOT exist.\n`
  );

  // Now do the real attempt through the shared helper, so this uses the exact
  // same code path the smoke and dependency stages do.
  const { rfiCreate } = await fillPageOne(
    page,
    {
      workLocation: WIND_E2E.rfi.workLocation,
      workArea: WIND_E2E.rfi.workArea,
      package: WIND_E2E.rfi.package,
      subPackage,
      activity,
      subActivity,
      rfiQuantity: null, unit: null, subContractor: null,
    },
    { name: checkpoint, checklist: checklists[0] },
    WIND_E2E.rfi.workSection
  );

  const outcome = await rfiCreate.clickProceedAndCheckOutcome();
  report.outcome = outcome;

  console.log('\n  ================ ANSWER ================');
  if (outcome.proceeded) {
    console.log('  Proceed SUCCEEDED with the predecessor absent.');
    console.log('  => WIND does NOT enforce the preceding-checkpoint dependency here.');
    console.log('     The activity master\'s Optional = Y appears to be real, and there is');
    console.log('     no wind counterpart to 29_rfi_activity_dependency.spec.js to write.');
    report.verdict = 'NOT_ENFORCED';
  } else {
    console.log('  Proceed was BLOCKED.');
    console.log(`  toast: "${outcome.toastText}"`);
    console.log('  => WIND DOES enforce the preceding-checkpoint dependency.');
    console.log('     A wind dependency spec IS writable, and must use the two-Work-Areas');
    console.log('     strategy (one Work Section per Work Area, no spare to sacrifice).');
    report.verdict = 'ENFORCED';
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const dst = path.join(OUT_DIR, 'wind-dependency-enforcement.json');
  fs.writeFileSync(dst, JSON.stringify(report, null, 2));
  console.log(`\n  [saved] ${path.relative(path.join(__dirname, '..', '..'), dst)}`);

  // Never submit. Cancel out and confirm the discard popup — the corrected
  // discard, per the app owner (Cancel alone leaves the draft, and the Work
  // Section it holds, alive).
  const cancel = page.getByRole('button', { name: 'Cancel' });
  if (await cancel.isVisible({ timeout: 2000 }).catch(() => false)) {
    await cancel.click().catch(() => {});
    const confirm = page.locator('[role="dialog"]')
      .getByRole('button', { name: /yes|confirm|discard|ok/i }).first();
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
      await confirm.click().catch(() => {});
    }
  }

  // Either verdict is a legitimate finding — this spec's job is to MEASURE, so
  // it does not assert one outcome over the other.
  expect(['ENFORCED', 'NOT_ENFORCED']).toContain(report.verdict);
});
