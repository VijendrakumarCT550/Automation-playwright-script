const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');

// THROWAWAY inspector — "IDT Civil & Structural" (Sub-Activity "Cable
// Rack") has exactly ONE Work Section option ("BL09", same as the Work
// Area) — confirmed via 00_inspect_rfi_idt_civil_structural.spec.js. The
// throwaway-Work-Section strategy 29_rfi_activity_dependency.spec.js uses
// is impossible here (there's nothing else to sacrifice). The app owner's
// proposed fix: clicking Cancel and CONFIRMING the resulting "are you
// sure?" popup should properly delete the draft/RFI (not just abandon it
// locally), releasing the Work Section. Test that directly: select the
// Work Section, get blocked on Proceed (Pile doesn't exist), Cancel +
// confirm the popup, then check whether the Work Section is available
// again for the SAME checkpoint. Delete once captured in code comments.
test('INSPECT: does Cancel + confirming the popup release a consumed Work Section?', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  const fillThroughCheckpoint = async (rfiCreate, checkpoint, checklist) => {
    await rfiCreate.selectOption(rfiCreate.workLocationDropdown, 'A-06c');
    await rfiCreate.selectOption(rfiCreate.workAreaDropdown, 'BL09');
    await rfiCreate.selectOption(rfiCreate.packageDropdown, 'Civil');
    await rfiCreate.selectOption(rfiCreate.subPackageDropdown, 'Piling (MMS, Inverter, LT Cable Hangers) + IDT Civil & Structural');
    await rfiCreate.selectOption(rfiCreate.activityDropdown, 'IDT Civil & Structural');
    await rfiCreate.selectOption(rfiCreate.subActivityDropdown, 'IDT Civil & Structural - Cable Rack');
    await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, checkpoint);
    await rfiCreate.selectOption(rfiCreate.inspectionChecklistDropdown, checklist);
  };

  await loginAsRole(page, 'CI');
  const myTasks = new MyTasksPage(page);
  await myTasks.clickCreateRFI();

  const rfiCreate = new RFICreatePage(page);
  await fillThroughCheckpoint(rfiCreate, 'Pre Pour Inspection - Pile Cap', 'Micro Pile Cap Checklist');

  const listboxBefore = await rfiCreate._openDropdown(rfiCreate.workSectionToggle);
  const before = (await listboxBefore.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
  log(`BEFORE selecting: Work Section options = ${JSON.stringify(before)}`);
  await rfiCreate.workSectionToggle.click({ timeout: 1500 }).catch(() => {});
  await page.locator('[role="listbox"][data-state="open"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});

  const selected = await rfiCreate.selectWorkSection('BL09');
  log(`Selected Work Section "${selected}"`);

  const outcome = await rfiCreate.clickProceedAndCheckOutcome();
  log(`Proceed outcome: proceeded=${outcome.proceeded} toastText="${outcome.toastText}"`);
  expect(outcome.proceeded, 'should be blocked - Pile does not exist yet').toBe(false);

  // Cancel AND confirm the popup — the app-owner-described proper discard.
  const cancelBtn = page.getByRole('button', { name: 'Cancel' });
  await cancelBtn.waitFor({ state: 'visible', timeout: 5000 });
  await cancelBtn.click();
  log('Clicked Cancel — checking for a confirmation popup...');
  await page.waitForTimeout(500);

  const confirmPopup = page.locator('[role="dialog"], [data-scope="dialog"]').first();
  const popupVisible = await confirmPopup.isVisible({ timeout: 3000 }).catch(() => false);
  log(`Confirmation popup visible after Cancel? ${popupVisible}`);
  if (popupVisible) {
    const popupText = await confirmPopup.innerText().catch(() => '(could not read)');
    log(`Popup text: "${popupText}"`);
    const allButtons = await confirmPopup.getByRole('button').allInnerTexts().catch(() => []);
    log(`Popup buttons: ${JSON.stringify(allButtons)}`);
    const confirmBtn = confirmPopup.getByRole('button', { name: /yes|confirm|discard|cancel/i }).first();
    if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await confirmBtn.click();
      log('Clicked the popup confirm button');
    }
  }
  await page.waitForTimeout(500);
  await page.goto(`${process.env.BASE_URL}/my-tasks`);
  await page.waitForTimeout(500);

  // Re-check: is "BL09" available again for the SAME checkpoint?
  const myTasks2 = new MyTasksPage(page);
  await myTasks2.waitForLoad();
  await myTasks2.clickCreateRFI();
  const rfiCreate2 = new RFICreatePage(page);
  await fillThroughCheckpoint(rfiCreate2, 'Pre Pour Inspection - Pile Cap', 'Micro Pile Cap Checklist');
  const listboxAfter = await rfiCreate2._openDropdown(rfiCreate2.workSectionToggle);
  const after = (await listboxAfter.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
  log(`AFTER cancel+confirm: Work Section options = ${JSON.stringify(after)}`);

  log('DONE');
});
