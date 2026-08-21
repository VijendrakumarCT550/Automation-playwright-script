const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const DashboardPage = require('../pages/DashboardPage');

// THROWAWAY inspector — 00_inspect_rfi_work_section_reuse.spec.js already
// confirmed a Work Section remains selectable for the NEXT checkpoint
// immediately after CI submits (same session, no relogin/approval). But
// 29_rfi_activity_dependency.spec.js's full flow (CI create -> EE approve
// -> QI approve -> CI relogin -> attempt next checkpoint) consistently
// fails to find the option at that final step. Stage the SAME sequence
// with an explicit presence-check after EACH step to isolate exactly
// which one causes it: EE approval, QI approval, or the relogin itself.
// Delete once captured in code comments.
test('INSPECT: staged check - which step makes a Work Section vanish for the next checkpoint?', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  const checkPileCapList = async (workSection, stageLabel) => {
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(500);
    const myTasks = new MyTasksPage(page);
    await myTasks.waitForLoad();
    await myTasks.clickCreateRFI();

    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.selectOption(rfiCreate.workLocationDropdown, 'A-06c');
    await rfiCreate.selectOption(rfiCreate.workAreaDropdown, 'BL09');
    await rfiCreate.selectOption(rfiCreate.packageDropdown, 'Civil');
    await rfiCreate.selectOption(rfiCreate.subPackageDropdown, 'Piling (MMS, Inverter, LT Cable Hangers)');
    await rfiCreate.selectOption(rfiCreate.activityDropdown, 'Piling - MMS');
    await rfiCreate.selectOption(rfiCreate.subActivityDropdown, 'Piling - MMS');
    await rfiCreate.selectOption(rfiCreate.inspectionCheckpointDropdown, 'Pre Pour Inspection - Pile Cap');
    await rfiCreate.selectOption(rfiCreate.inspectionChecklistDropdown, 'Micro Pile Cap Checklist');

    const listbox = await rfiCreate._openDropdown(rfiCreate.workSectionToggle);
    const options = (await listbox.locator('[role="option"]').allInnerTexts()).map((t) => t.trim());
    const present = options.some((o) => o.includes(workSection));
    log(`[${stageLabel}] "Pre Pour Inspection - Pile Cap": Work Section "${workSection}" present? ${present} (${options.length} options)`);

    // Close cleanly (click toggle again — NOT Escape) and cancel the draft.
    await rfiCreate.workSectionToggle.click({ timeout: 1500 }).catch(() => {});
    await page.locator('[role="listbox"][data-state="open"]').waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(300);
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible({ timeout: 500 }).catch(() => false)) await cancelBtn.click();
    return present;
  };

  // --- CI creates Pile ---
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
  expect(outcome.proceeded).toBe(true);
  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations('OK - as per standard', true);
  await checklist.submitRFI();
  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  const rfiId = match[1];

  const dashboard = new DashboardPage(page);
  await dashboard.goToDashboard();
  await dashboard.waitForContentOnly();
  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/view`);
  await page.waitForLoadState('networkidle');
  const rfiCode = await new RFIChecklistPage(page).getVisibleCode();
  log(`Created ${rfiCode} (${rfiId}) for Work Section "${workSection}"`);

  // Stage 0: immediately after CI submit, same session — expect PRESENT (already confirmed separately).
  await checkPileCapList(workSection, 'stage0-after-CI-submit-same-session');

  // Stage 1: after a CI relogin, BEFORE any approval — isolates "does relogin alone do it?"
  await loginAsRole(page, 'CI');
  await checkPileCapList(workSection, 'stage1-after-CI-relogin-no-approval-yet');

  // Stage 2: after EE approves, checked via a FRESH CI relogin.
  await loginAsRole(page, 'EE');
  await openFromPendingWithMe(page, rfiCode);
  const eeReview = new RFIReviewPage(page);
  await eeReview.expandAllChecklist();
  await eeReview.approve();
  await loginAsRole(page, 'CI');
  await checkPileCapList(workSection, 'stage2-after-EE-approval-CI-relogin');

  // Stage 3: after QI ALSO approves (fully approved), checked via a FRESH CI relogin.
  await loginAsRole(page, 'QI');
  await openFromPendingWithMe(page, rfiCode);
  const qiReview = new RFIReviewPage(page);
  await qiReview.expandAllChecklist();
  await qiReview.approve();
  await loginAsRole(page, 'CI');
  await checkPileCapList(workSection, 'stage3-after-QI-approval-fully-approved-CI-relogin');

  // Stage 4: apples-to-apples — call the REAL selectWorkSection(label)
  // method (used by the failing spec) in this exact same fully-approved
  // state, instead of the hand-rolled allInnerTexts() read above. If this
  // ALSO fails while stage3's plain read just succeeded, the bug is in
  // selectWorkSection()'s own find/click logic, not list availability.
  await page.goto(`${process.env.BASE_URL}/my-tasks`);
  await page.waitForTimeout(500);
  const myTasks3 = new MyTasksPage(page);
  await myTasks3.waitForLoad();
  await myTasks3.clickCreateRFI();
  const rfiCreate3 = new RFICreatePage(page);
  await rfiCreate3.selectOption(rfiCreate3.workLocationDropdown, 'A-06c');
  await rfiCreate3.selectOption(rfiCreate3.workAreaDropdown, 'BL09');
  await rfiCreate3.selectOption(rfiCreate3.packageDropdown, 'Civil');
  await rfiCreate3.selectOption(rfiCreate3.subPackageDropdown, 'Piling (MMS, Inverter, LT Cable Hangers)');
  await rfiCreate3.selectOption(rfiCreate3.activityDropdown, 'Piling - MMS');
  await rfiCreate3.selectOption(rfiCreate3.subActivityDropdown, 'Piling - MMS');
  await rfiCreate3.selectOption(rfiCreate3.inspectionCheckpointDropdown, 'Pre Pour Inspection - Pile Cap');
  await rfiCreate3.selectOption(rfiCreate3.inspectionChecklistDropdown, 'Micro Pile Cap Checklist');
  try {
    const selected = await rfiCreate3.selectWorkSection(workSection);
    log(`[stage4-real-selectWorkSection-method] SUCCEEDED, selected "${selected}"`);
  } catch (err) {
    log(`[stage4-real-selectWorkSection-method] FAILED: ${err.message}`);
  }

  log('DONE');
});
