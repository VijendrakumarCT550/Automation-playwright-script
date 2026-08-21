const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');

// THROWAWAY inspector — the staged diagnostic proved the Work Section
// stays selectable through CI-relogin/EE-approve/QI-approve, and that
// selectWorkSection() itself works fine in isolation. The one thing NOT
// replicated there: 29_rfi_activity_dependency.spec.js's real flow first
// SELECTS a Work Section in Pile Cap's OWN form, gets blocked on Proceed
// (dependency error, RFI never submitted), then ABANDONS that draft
// before ever coming back to actually create Pile Cap for real. Does the
// mere SELECTION (not submission) of a Work Section permanently consume
// it for that checkpoint? Delete once captured in code comments.
test('INSPECT: does selecting (not submitting) a Work Section consume it?', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  await loginAsRole(page, 'CI');
  const myTasks = new MyTasksPage(page);
  await myTasks.clickCreateRFI();

  const rfiCreate = new RFICreatePage(page);
  await rfiCreate.selectOption(rfiCreate.workLocationDropdown, 'A-06c');
  await rfiCreate.selectOption(rfiCreate.workAreaDropdown, 'BL09');
  await rfiCreate.selectOption(rfiCreate.packageDropdown, 'Civil');
  await rfiCreate.selectOption(rfiCreate.subPackageDropdown, 'Piling (MMS, Inverter, LT Cable Hangers)');
  await rfiCreate.selectOption(rfiCreate.activityDropdown, 'Piling - MMS');
  await rfiCreate.selectOption(rfiCreate.subActivityDropdown, 'Piling - MMS');
  // Deliberately pick "Pre Pour Inspection - Pile Cap" FIRST, matching the
  // real spec's initial (doomed-to-block) attempt.
  await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, 'Pre Pour Inspection - Pile Cap');
  await rfiCreate.selectOption(rfiCreate.inspectionChecklistDropdown, 'Micro Pile Cap Checklist');

  const workSection = await rfiCreate.selectWorkSection('__random__');
  log(`Selected (not submitted) Work Section "${workSection}" for "Pre Pour Inspection - Pile Cap"`);

  // Attempt Proceed (expected to block — Pile doesn't exist) — matches
  // the real spec exactly.
  const outcome = await rfiCreate.clickProceedAndCheckOutcome();
  log(`Proceed outcome: proceeded=${outcome.proceeded} toastText="${outcome.toastText}"`);
  expect(outcome.proceeded, 'should be blocked — Pile does not exist yet').toBe(false);

  // Abandon the draft — same resetToMyTasks() pattern as the real spec.
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(300);
    if (!page.url().includes('/create')) break;
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(300);
    }
  }
  log('Draft abandoned via Cancel/navigate-away — no RFI was ever submitted for this Work Section');

  // Re-open the SAME checkpoint's form, same session, and check whether
  // the same Work Section is still offered.
  const myTasks2 = new MyTasksPage(page);
  await myTasks2.waitForLoad();
  await myTasks2.clickCreateRFI();
  const rfiCreate2 = new RFICreatePage(page);
  await rfiCreate2.selectOption(rfiCreate2.workLocationDropdown, 'A-06c');
  await rfiCreate2.selectOption(rfiCreate2.workAreaDropdown, 'BL09');
  await rfiCreate2.selectOption(rfiCreate2.packageDropdown, 'Civil');
  await rfiCreate2.selectOption(rfiCreate2.subPackageDropdown, 'Piling (MMS, Inverter, LT Cable Hangers)');
  await rfiCreate2.selectOption(rfiCreate2.activityDropdown, 'Piling - MMS');
  await rfiCreate2.selectOption(rfiCreate2.subActivityDropdown, 'Piling - MMS');
  await rfiCreate2.selectOption(rfiCreate2.inspectionCheckpointDropdown, 'Pre Pour Inspection - Pile Cap');
  await rfiCreate2.selectOption(rfiCreate2.inspectionChecklistDropdown, 'Micro Pile Cap Checklist');

  const listbox = await rfiCreate2._openDropdown(rfiCreate2.workSectionToggle);
  const options = (await listbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
  const stillPresent = options.some((o) => o.includes(workSection));
  log(`After abandoning the draft (no submit): "Pre Pour Inspection - Pile Cap": Work Section "${workSection}" still present? ${stillPresent} (${options.length} options)`);

  log('DONE');
});
