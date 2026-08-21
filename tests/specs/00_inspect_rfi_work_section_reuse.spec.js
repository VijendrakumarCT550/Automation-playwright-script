const { test } = require('@playwright/test');
const { expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// THROWAWAY inspector — 29_rfi_activity_dependency.spec.js's live runs
// (3 occurrences, including one with a fresh-relogin retry that STILL
// failed) all show a Work Section vanishing from checkpoint[1]'s list
// right after being used for checkpoint[0] of the SAME activity — even
// after full EE+QI approval and a relogin. Isolate exactly WHEN this
// happens: immediately on submit (same CI session, no relogin, no
// approval at all), which would prove it's a straightforward "used, gone"
// rule unrelated to session/cache desync. Delete once captured in code
// comments.
test('INSPECT: does a Work Section vanish for the NEXT checkpoint immediately after submit?', async ({ page }) => {
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
  await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, 'Pre Pour Inspection - Pile');
  await rfiCreate.selectOption(rfiCreate.inspectionChecklistDropdown, 'Micro Pile Checklist');

  const workSection = await rfiCreate.selectWorkSection('__random__');
  log(`Selected Work Section "${workSection}" for "Pre Pour Inspection - Pile"`);

  const outcome = await rfiCreate.clickProceedAndCheckOutcome();
  log(`Proceed outcome: proceeded=${outcome.proceeded} toastText="${outcome.toastText}"`);
  expect(outcome.proceeded, 'Pre Pour Inspection - Pile has no dependency, should proceed').toBe(true);

  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations('OK - as per standard', true);
  await checklist.submitRFI();
  const code = await checklist.getVisibleCode();
  log(`Submitted ${code} for "Pre Pour Inspection - Pile" / Work Section "${workSection}"`);

  // --- SAME session, no relogin, no approval yet: is workSection still
  // offered for "Pre Pour Inspection - Pile Cap"? ---
  await page.goto(`${process.env.BASE_URL}/my-tasks`);
  await page.waitForTimeout(500);
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
  log(`checkpoint "Pre Pour Inspection - Pile Cap": Work Section "${workSection}" still present in list (${options.length} options total)? ${stillPresent}`);
  if (!stillPresent) {
    const near = options.filter((o) => o.startsWith(workSection.slice(0, 3))).slice(0, 10);
    log(`Nearby options (same "${workSection.slice(0, 3)}" prefix): ${JSON.stringify(near)}`);
  }

  log('DONE');
});
