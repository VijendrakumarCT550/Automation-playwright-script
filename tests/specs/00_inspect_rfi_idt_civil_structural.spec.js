const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');

// THROWAWAY inspector — before building a scarce-Work-Section dependency
// spec for "IDT Civil & Structural", confirm its exact Package/Sub-Package
// path. So far it's only been seen as an ACTIVITY nested under the
// "Piling (MMS, Inverter, LT Cable Hangers)" sub-package
// (00_inspect_rfi_piling_activities.spec.js) — the user referred to it as
// its own sub-package, so check whether a SEPARATE "IDT Civil & Structural"
// sub-package also exists under Package "Civil" (or elsewhere), and dump
// one of its activities' Inspection Checkpoint + Work Section shape to
// confirm the "Work Section has only one value, same as Work Area" claim.
// Delete once captured in code comments.
test('INSPECT: IDT Civil & Structural sub-package / activity / Work Section shape', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  await loginAsRole(page, 'CI');
  const myTasks = new MyTasksPage(page);
  await myTasks.clickCreateRFI();

  const rfiCreate = new RFICreatePage(page);
  await rfiCreate.selectOption(rfiCreate.workLocationDropdown, 'A-06c');
  await rfiCreate.selectOption(rfiCreate.workAreaDropdown, 'BL09');

  const packageListbox = await rfiCreate._openDropdown(rfiCreate.packageDropdown);
  const packageOptions = (await packageListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
  log(`Package options: ${JSON.stringify(packageOptions)}`);
  await page.keyboard.press('Escape').catch(() => {});

  for (const pkg of packageOptions) {
    await rfiCreate.selectOption(rfiCreate.packageDropdown, pkg);
    await page.waitForTimeout(300);
    const subPackageListbox = await rfiCreate._openDropdown(rfiCreate.subPackageDropdown);
    const subPackageOptions = (await subPackageListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
    log(`Package "${pkg}": Sub-Package options = ${JSON.stringify(subPackageOptions)}`);
    await page.keyboard.press('Escape').catch(() => {});

    const idtMatch = subPackageOptions.find((s) => /idt.*civil|civil.*structural/i.test(s));
    if (idtMatch) {
      log(`--- FOUND candidate sub-package "${idtMatch}" under Package "${pkg}" — inspecting further ---`);
      await rfiCreate.selectOption(rfiCreate.subPackageDropdown, idtMatch);
      await page.waitForTimeout(300);

      const activityListbox = await rfiCreate._openDropdown(rfiCreate.activityDropdown);
      const activityOptions = (await activityListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
      log(`Sub-Package "${idtMatch}": Activity options = ${JSON.stringify(activityOptions)}`);
      await page.keyboard.press('Escape').catch(() => {});

      if (activityOptions.length) {
        const activity = activityOptions[0];
        await rfiCreate.selectOption(rfiCreate.activityDropdown, activity);
        await page.waitForTimeout(300);
        const subActivityListbox = await rfiCreate._openDropdown(rfiCreate.subActivityDropdown);
        const subActivityOptions = (await subActivityListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
        log(`Activity "${activity}": Sub-Activity options = ${JSON.stringify(subActivityOptions)}`);
        await page.keyboard.press('Escape').catch(() => {});

        const subActivity = subActivityOptions[0].replace(/\s*✓\s*$/, '').trim();
        await rfiCreate.selectOption(rfiCreate.subActivityDropdown, subActivity);
        await page.waitForTimeout(300);
        const checkpointListbox = await rfiCreate._openDropdown(rfiCreate.inspectionCheckpointDropdown);
        const checkpointOptions = (await checkpointListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
        log(`Activity "${activity}" / Sub-Activity "${subActivity}": Inspection Checkpoint options = ${JSON.stringify(checkpointOptions)}`);
        await page.keyboard.press('Escape').catch(() => {});

        if (checkpointOptions.length) {
          await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, checkpointOptions[0]);
          await page.waitForTimeout(300);
          const checklistListbox = await rfiCreate._openDropdown(rfiCreate.inspectionChecklistDropdown);
          const checklistOptions = (await checklistListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
          log(`checkpoint "${checkpointOptions[0]}": checklist options = ${JSON.stringify(checklistOptions)}`);
          await page.keyboard.press('Escape').catch(() => {});

          await rfiCreate.selectOption(rfiCreate.inspectionChecklistDropdown, checklistOptions[0].replace(/\s*✓\s*$/, '').trim());
          await page.waitForTimeout(300);
          const workSectionListbox = await rfiCreate._openDropdown(rfiCreate.workSectionToggle);
          const workSectionOptions = (await workSectionListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
          log(`checkpoint "${checkpointOptions[0]}": Work Section options (${workSectionOptions.length}) = ${JSON.stringify(workSectionOptions)}`);
        }
      }
    }
  }

  log('DONE');
});
