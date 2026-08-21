const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');

// THROWAWAY inspector — 29_rfi_activity_dependency.spec.js's first live run
// (Piling - MMS) found that a Work Section available for "Pre Pour
// Inspection - Pile" ("R01-T01") was NOT offered at all for "Pre Pour
// Inspection - Pile Cap" in the same Work Area (BL05) — invalidating the
// assumption that Work Sections are identical across checkpoints. Dump the
// Work Section list for all three in-scope checkpoints, same Work
// Area/Activity, to see whether they're disjoint, overlapping, or one is a
// subset of another. Delete once captured in code comments.
test('INSPECT: Work Section options per checkpoint, Piling - MMS, BL05', async ({ page }) => {
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
  await rfiCreate.selectOption(rfiCreate.activityDropdown, 'Piling - MMS');
  await rfiCreate.selectOption(rfiCreate.subActivityDropdown, 'Piling - MMS');

  const checkpoints = [
    { name: 'Pre Pour Inspection - Pile', checklist: 'Micro Pile Checklist' },
    { name: 'Pre Pour Inspection - Pile Cap', checklist: 'Micro Pile Cap Checklist' },
    { name: 'Post Pour Inspection', checklist: 'Post Pour Check' },
  ];

  for (const cp of checkpoints) {
    await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, cp.name);
    await page.waitForTimeout(300);
    await rfiCreate.selectOption(rfiCreate.inspectionChecklistDropdown, cp.checklist);
    await page.waitForTimeout(300);

    const listbox = await rfiCreate._openDropdown(rfiCreate.workSectionToggle);
    const options = (await listbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
    log(`checkpoint "${cp.name}": Work Section options (${options.length}) = ${JSON.stringify(options)}`);
    // DO NOT press Escape here — the form's Escape handler navigates back
    // to My Tasks when the Work Section multi-select combobox is open (see
    // RFICreatePage.selectWorkSection()'s comment). Close it the same way
    // that method does: click the toggle again.
    await rfiCreate.workSectionToggle.click({ timeout: 1500 }).catch(() => {});
    await page.locator('[role="listbox"][data-state="open"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  log('DONE');
});
