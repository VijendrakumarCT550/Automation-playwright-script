const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');

// THROWAWAY inspector — before building the Activity Dependency chain spec
// (29_rfi_activity_dependency.spec.js) for all three Piling activities, need
// the REAL "Activity" dropdown option text for the other two (only
// "Piling - MMS" is confirmed elsewhere in the repo) plus their Sub-Activity
// options, to confirm the spreadsheet's "Piling - Inverter" / "Piling - LT
// Cable Hanger System" naming matches the live UI exactly. Delete once
// captured in code comments, matching this repo's 00_inspect_*.spec.js
// convention.
test('INSPECT: Piling activity dropdown options (Inverter, LT Cable Hanger)', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  await loginAsRole(page, 'CI');
  const myTasks = new MyTasksPage(page);
  await myTasks.clickCreateRFI();

  const rfiCreate = new RFICreatePage(page);
  await rfiCreate.selectOption(rfiCreate.workLocationDropdown, 'A-06c');
  await rfiCreate.selectOption(rfiCreate.workAreaDropdown, 'BL05');
  await rfiCreate.selectOption(rfiCreate.packageDropdown, 'Civil');
  await rfiCreate.selectOption(rfiCreate.subPackageDropdown, 'Piling (MMS, Inverter, LT Cable Hangers)');

  const activityListbox = await rfiCreate._openDropdown(rfiCreate.activityDropdown);
  const activityOptions = (await activityListbox.locator('[role="option"]').allInnerTexts())
    .map((t) => t.trim());
  log(`Activity options under "Piling (MMS, Inverter, LT Cable Hangers)": ${JSON.stringify(activityOptions)}`);
  await page.keyboard.press('Escape').catch(() => {});

  // Ark UI appends a checkmark ("✓") to an option already selected by
  // default (confirmed elsewhere — WAMPage._stripSelectedMarker()); strip
  // it before comparing/reusing option text as a filter string.
  const stripMarker = (t) => t.replace(/\s*✓\s*$/, '').trim();

  for (const activity of activityOptions) {
    if (/mms/i.test(activity) || /inverter/i.test(activity) || /idt/i.test(activity)) {
      log(`skipping "${activity}" — already confirmed or out of scope`);
      continue;
    }
    log(`--- checking sub-activity + checkpoint options for activity "${activity}" ---`);
    await rfiCreate.selectOption(rfiCreate.activityDropdown, activity);
    await page.waitForTimeout(300);

    const subActivityListbox = await rfiCreate._openDropdown(rfiCreate.subActivityDropdown);
    const subActivityOptions = (await subActivityListbox.locator('[role="option"]').allInnerTexts())
      .map((t) => stripMarker(t));
    log(`activity "${activity}": Sub-Activity options = ${JSON.stringify(subActivityOptions)}`);
    await page.keyboard.press('Escape').catch(() => {});

    // Pick whichever sub-activity option looks like the parent activity
    // (existing RFI_DATA convention: subActivity === activity for MMS).
    const subActivity = subActivityOptions.find((s) => s === activity) || subActivityOptions[0];
    await rfiCreate.selectOption(rfiCreate.subActivityDropdown, subActivity);
    await page.waitForTimeout(300);

    const checkpointListbox = await rfiCreate._openDropdown(rfiCreate.inspectionCheckpointDropdown);
    const checkpointOptions = (await checkpointListbox.locator('[role="option"]').allInnerTexts())
      .map((t) => t.trim());
    log(`activity "${activity}" / sub-activity "${subActivity}": Inspection Checkpoint options = ${JSON.stringify(checkpointOptions)}`);
    await page.keyboard.press('Escape').catch(() => {});

    // Confirm checklist text for just the first checkpoint (cheap sanity
    // check — full per-checkpoint dump already done for MMS and the
    // spreadsheet shows byte-identical checkpoint/checklist columns across
    // all three Piling activities).
    if (checkpointOptions.length) {
      await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, checkpointOptions[0]);
      await page.waitForTimeout(300);
      const checklistListbox = await rfiCreate._openDropdown(rfiCreate.inspectionChecklistDropdown);
      const checklistOptions = (await checklistListbox.locator('[role="option"]').allInnerTexts())
        .map((t) => t.trim());
      log(`activity "${activity}": checkpoint "${checkpointOptions[0]}" checklist options = ${JSON.stringify(checklistOptions)}`);
      await page.keyboard.press('Escape').catch(() => {});
    }
  }

  log('DONE');
});
