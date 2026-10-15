const { test } = require('@playwright/test');
const { loginAsFlowUser } = require('../../utils/helpers');
const { fleetFor } = require('../../utils/reassign-fleet');
const MyTasksPage = require('../../pages/MyTasksPage');
const RFICreatePage = require('../../pages/RFICreatePage');

// ===========================================================================
// INSPECTION (READ-ONLY) — which activity chains on A-06c / Civil / BL07 still
// offer Work Sections to the reassignment RFI creator (fleet CI_C)?
// ===========================================================================
// 2026-09-30, pulse-test: 42_reassign_rfi_records_setup failed all 16 records
// with WORK_SECTION_NOT_FOUND on the FIRST option — Piling - MMS offered ZERO
// Work Sections on BL07 for every checkpoint (the earlier pool runs spent
// them). This walks every sub-package → activity → sub-activity → checkpoint
// (first checklist) and prints how many Work Sections each offers. It only
// OPENS the Work Section dropdown — never selects an option, because selecting
// one (even without submitting) consumes it.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/inspection/00_inspect_reassign_bl07_work_sections.spec.js --project=chromium --workers=1
// ===========================================================================
test('INSPECT: BL07 Work Sections per activity chain for the reassignment RFI creator', async ({ browser }) => {
  test.setTimeout(40 * 60 * 1000);
  const creator = fleetFor().CI_C;
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();
  const rows = [];
  try {
    await loginAsFlowUser(page, creator.email, process.env.BULK_USER_DEFAULT_PASSWORD);
    const myTasks = new MyTasksPage(page);
    await myTasks.waitForLoad();
    await myTasks.clickCreateRFI();
    const f = new RFICreatePage(page);

    // Reads a dropdown's option texts, then closes it by clicking it again —
    // never Escape, which on this form can navigate away.
    const listOptions = async (dd) => {
      const lb = await f._openDropdown(dd);
      await page.waitForTimeout(800);
      const texts = (await lb.locator('[role="option"]').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      await dd.click({ timeout: 1500 }).catch(() => {});
      await page.locator('[role="listbox"][data-state="open"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      return texts;
    };
    const sectionCount = async () => {
      const lb = await f._openDropdown(f.workSectionToggle);
      await page.waitForTimeout(1500);
      const opts = (await lb.locator('[role="option"]').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
      await f.workSectionToggle.click({ timeout: 1500 }).catch(() => {});
      await page.locator('[role="listbox"][data-state="open"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      return opts;
    };

    await f.selectOption(f.workLocationDropdown, 'A-06c');
    await f.selectOption(f.workAreaDropdown, 'BL07');
    await f.selectOption(f.packageDropdown, 'Civil');

    // Optional filter, e.g. INSPECT_SUBPACKAGE="Piling" — a substring match.
    const spFilter = process.env.INSPECT_SUBPACKAGE || '';
    const tryIt = async (label, fn) => {
      try { return await fn(); } catch (err) {
        console.log(`  ERR  ${label}: ${String(err.message).split('\n')[0]}`);
        return null;
      }
    };
    for (const sp of (await listOptions(f.subPackageDropdown)).filter((t) => t.includes(spFilter))) {
      await tryIt(sp, () => f.selectOption(f.subPackageDropdown, sp));
      for (const act of (await tryIt(`${sp} activities`, () => listOptions(f.activityDropdown))) || []) {
        await tryIt(`${sp} | ${act}`, () => f.selectOption(f.activityDropdown, act));
        for (const sub of (await tryIt(`${sp} | ${act} sub-activities`, () => listOptions(f.subActivityDropdown))) || []) {
          await tryIt(`${sp} | ${act} | ${sub}`, () => f.selectOption(f.subActivityDropdown, sub));
          for (const cp of (await tryIt(`${sp} | ${act} | ${sub} checkpoints`, () => listOptions(f.inspectionCheckpointDropdown))) || []) {
            try {
              await f.selectOption(f.inspectionCheckpointDropdown, cp);
              await page.waitForTimeout(300);
              const checklists = await listOptions(f.inspectionChecklistDropdown);
              if (checklists[0]) await f.selectOption(f.inspectionChecklistDropdown, checklists[0]);
              await page.waitForTimeout(600);
              const secs = await sectionCount();
              const row = { subPackage: sp, activity: act, subActivity: sub, checkpoint: cp, checklist: checklists[0] || '', sections: secs.length, sample: secs.slice(0, 4) };
              rows.push(row);
              console.log(`  ${String(secs.length).padStart(3)}  ${sp} | ${act} | ${sub} | ${cp} | ${row.checklist}  ${JSON.stringify(row.sample)}`);
            } catch (err) {
              console.log(`  ERR  ${sp} | ${act} | ${sub} | ${cp}: ${String(err.message).split('\n')[0]}`);
            }
          }
        }
      }
    }
  } finally {
    await context.close();
  }
  console.log(`\n  ${rows.length} checkpoint(s) read; with >= 18 sections: ${rows.filter((r) => r.sections >= 18).length}`);
});
