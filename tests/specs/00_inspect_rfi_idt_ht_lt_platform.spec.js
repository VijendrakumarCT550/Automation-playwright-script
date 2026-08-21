const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');

// THROWAWAY inspector — before extending the scarce-Work-Section spec to
// Sub-Activity "IDT Civil - HT / LT Platform" (under Activity "IDT Civil &
// Structural"), confirm its real Inspection Checkpoint options (the
// spreadsheet, rows 21-26, shows a LONGER 6-checkpoint chain than Cable
// Rack's 3, and checkpoints 1-2 have CONDITIONAL checklists — "If Open
// Foundation: ... / If Micropiling Foundation: ..." — possibly the first
// real case of "more than one selectable Inspection Checklist option").
// Also confirm the Work Section shape (expect single-option/"Block"-level,
// same as Cable Rack, but verify rather than assume). Delete once captured
// in code comments.
test('INSPECT: IDT Civil - HT / LT Platform checkpoint/checklist/Work Section shape', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  await loginAsRole(page, 'CI');
  const myTasks = new MyTasksPage(page);
  await myTasks.clickCreateRFI();

  const rfiCreate = new RFICreatePage(page);
  await rfiCreate.selectOption(rfiCreate.workLocationDropdown, 'A-06c');
  await rfiCreate.selectOption(rfiCreate.workAreaDropdown, 'BL10');
  await rfiCreate.selectOption(rfiCreate.packageDropdown, 'Civil');
  await rfiCreate.selectOption(rfiCreate.subPackageDropdown, 'Piling (MMS, Inverter, LT Cable Hangers) + IDT Civil & Structural');
  await rfiCreate.selectOption(rfiCreate.activityDropdown, 'IDT Civil & Structural');
  await rfiCreate.selectOption(rfiCreate.subActivityDropdown, 'IDT Civil - HT / LT Platform');

  const checkpointListbox = await rfiCreate._openDropdown(rfiCreate.inspectionCheckpointDropdown);
  const checkpointOptions = (await checkpointListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
  log(`Sub-Activity "IDT Civil - HT / LT Platform": Inspection Checkpoint options (${checkpointOptions.length}) = ${JSON.stringify(checkpointOptions)}`);
  await page.keyboard.press('Escape').catch(() => {});

  for (const checkpoint of checkpointOptions.slice(0, 3)) {
    await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, checkpoint);
    await page.waitForTimeout(300);
    const checklistListbox = await rfiCreate._openDropdown(rfiCreate.inspectionChecklistDropdown);
    const checklistOptions = (await checklistListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
    log(`checkpoint "${checkpoint}": Inspection Checklist options (${checklistOptions.length}) = ${JSON.stringify(checklistOptions)}`);
    await page.keyboard.press('Escape').catch(() => {});

    if (checklistOptions.length) {
      const firstChecklist = checklistOptions[0].replace(/\s*✓\s*$/, '').trim();
      await rfiCreate.selectOption(rfiCreate.inspectionChecklistDropdown, firstChecklist);
      await page.waitForTimeout(300);
      const workSectionListbox = await rfiCreate._openDropdown(rfiCreate.workSectionToggle);
      const workSectionOptions = (await workSectionListbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
      log(`checkpoint "${checkpoint}" / checklist "${firstChecklist}": Work Section options (${workSectionOptions.length}) = ${JSON.stringify(workSectionOptions)}`);
      await rfiCreate.workSectionToggle.click({ timeout: 1500 }).catch(() => {});
      await page.locator('[role="listbox"][data-state="open"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
  }

  log('DONE');
});
