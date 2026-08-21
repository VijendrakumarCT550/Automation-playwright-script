const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');

// THROWAWAY inspector — before building the Activity Dependency chain
// spec (checkpoint N+1 blocked until checkpoint N is approved), need
// the REAL "Inspection Checkpoint" dropdown options for Piling - MMS
// (only "Pre Pour Inspection - Pile" is confirmed from existing
// RFI_DATA) and, for each one, the real "Inspection Checklist" options
// — the app owner's description mentions a checkpoint with "No
// Checklist; only testing report to be uploaded" (Bitumen & Epoxy
// Paint), a UI pattern not yet seen/built in this suite. Delete once
// captured in code comments, matching this repo's 00_inspect_*.spec.js
// convention.
test('INSPECT: Piling - MMS checkpoint and checklist dropdown options', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
  const shot = async (label) => {
    const path = `test-results/dep-inspect-${label}.png`;
    await page.screenshot({ path, fullPage: true }).catch((e) => log(`screenshot failed: ${e.message}`));
    log(`screenshot -> ${path}`);
  };

  await loginAsRole(page, 'CI');
  const myTasks = new MyTasksPage(page);
  await myTasks.clickCreateRFI();

  const rfiCreate = new RFICreatePage(page);
  await rfiCreate.selectOption(rfiCreate.workLocationDropdown, 'A-06c');
  await rfiCreate.selectOption(rfiCreate.workAreaDropdown, 'BL01');
  await rfiCreate.selectOption(rfiCreate.packageDropdown, 'Civil');
  await rfiCreate.selectOption(rfiCreate.subPackageDropdown, 'Piling (MMS, Inverter, LT Cable Hangers)');
  await rfiCreate.selectOption(rfiCreate.activityDropdown, 'Piling - MMS');
  await rfiCreate.selectOption(rfiCreate.subActivityDropdown, 'Piling - MMS');
  await shot('01-after-subactivity');

  // Dump every Inspection Checkpoint option WITHOUT picking one yet.
  const checkpointListbox = await rfiCreate._openDropdown(rfiCreate.inspectionCheckpointDropdown);
  const checkpointOptions = (await checkpointListbox.locator('[role="option"]').allInnerTexts())
    .map((t) => t.trim());
  log(`Inspection Checkpoint options for Piling - MMS: ${JSON.stringify(checkpointOptions)}`);
  await page.keyboard.press('Escape').catch(() => {});
  await shot('02-checkpoint-options-dumped');

  // For each checkpoint, pick it and dump its Inspection Checklist options.
  for (const checkpoint of checkpointOptions) {
    log(`--- checking checklist options for checkpoint "${checkpoint}" ---`);
    await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, checkpoint);
    await page.waitForTimeout(500);

    const checklistVisible = await rfiCreate.inspectionChecklistDropdown.isVisible({ timeout: 3000 }).catch(() => false);
    log(`checkpoint "${checkpoint}": Inspection Checklist field visible = ${checklistVisible}`);
    if (checklistVisible) {
      const checklistListbox = await rfiCreate._openDropdown(rfiCreate.inspectionChecklistDropdown);
      const checklistOptions = (await checklistListbox.locator('[role="option"]').allInnerTexts())
        .map((t) => t.trim());
      log(`checkpoint "${checkpoint}": Inspection Checklist options = ${JSON.stringify(checklistOptions)}`);
      await page.keyboard.press('Escape').catch(() => {});
    } else {
      log(`checkpoint "${checkpoint}": no Inspection Checklist field rendered — dumping page text for clues`);
      console.log((await page.locator('body').innerText()).slice(0, 2000));
    }
    await shot(`03-checkpoint-${checkpointOptions.indexOf(checkpoint)}`);
  }

  log('DONE');
});
