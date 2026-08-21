const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { RFI_DATA } = require('../utils/rfi-flow-turns');
const MyTasksPage      = require('../pages/MyTasksPage');
const RFICreatePage    = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// THROWAWAY inspector, part 2 — follow-up to 00_inspect_rfi_draft.spec.js.
// That run confirmed a draft shows as an "In-Draft" status row (pencil
// icon, blank RFI ID) in Pending with me for both browser Back and an
// in-app nav click, with only Work Location filled.
//
// IMPORTANT, user-confirmed (2026-08-19): the draft is stored LOCALLY in
// the browser, not server-side — logging out (or, same effect, starting a
// brand-new browser context/session) deletes it. This is WHY a follow-up
// run in a fresh context found zero "In-Draft" rows even though the prior
// run's screenshot clearly showed two — they were never durable, so there
// was nothing to clean up either. Consequence for the real spec: create,
// verify, resume, and complete must all happen within ONE continuous
// session/page — never split across separate logins.
//
// This run: creates ONE fresh draft (Work Location only), confirms it
// shows as "In-Draft", resumes it by clicking that badge, confirms Work
// Location survived the resume, then completes it to a real submission —
// all in one continuous flow. Delete once captured in code comments,
// matching this repo's 00_inspect_*.spec.js convention.
test('INSPECT: create, resume, and complete an In-Draft RFI in one session', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
  const shot = async (label) => {
    const path = `test-results/draft-resume-${label}.png`;
    await page.screenshot({ path, fullPage: true }).catch((e) => log(`screenshot failed: ${e.message}`));
    log(`screenshot -> ${path}`);
  };

  await loginAsRole(page, 'CI');
  const myTasks = new MyTasksPage(page);

  log('creating a fresh draft — Work Location only, then browser Back');
  await myTasks.clickCreateRFI();
  const rfiCreate = new RFICreatePage(page);
  await rfiCreate.selectOption(rfiCreate.workLocationDropdown, RFI_DATA.workLocation);
  await page.goBack();
  await page.waitForTimeout(3000);

  for (let attempt = 0; attempt < 5 && page.url().includes('/create'); attempt++) {
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(2000);
    }
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(2000);
  }
  await myTasks.waitForLoad();
  log(`url after draft creation settled = ${page.url()}`);

  await myTasks.pendingWithMeTile.waitFor({ state: 'visible' });
  await myTasks.clickPendingWithMe();
  await page.waitForTimeout(2000);
  await shot('01-grid-with-draft');

  const draftBadge = page.getByText('In-Draft').first();
  const hasDraft = await draftBadge.isVisible({ timeout: 5000 }).catch(() => false);
  log(`draft row visible = ${hasDraft}`);
  if (!hasDraft) {
    console.log((await page.locator('body').innerText()).slice(0, 1500));
    return;
  }

  log('attempt 1: clicking the In-Draft badge text');
  await draftBadge.click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1000);
  log(`url after attempt 1 = ${page.url()}`);
  await shot('02-attempt1-badge-click');

  let onCreateForm = page.url().includes('/create');

  if (!onCreateForm) {
    log('attempt 2: double-clicking the In-Draft badge text');
    await draftBadge.dblclick().catch((e) => log(`dblclick failed: ${e.message}`));
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    log(`url after attempt 2 = ${page.url()}`);
    await shot('03-attempt2-dblclick');
    onCreateForm = page.url().includes('/create');
  }

  if (!onCreateForm) {
    log('attempt 3: clicking the whole grid row');
    const row = page.locator('.rdg-row[role="row"]').filter({ hasText: 'In-Draft' }).first();
    await row.click({ position: { x: 5, y: 5 } }).catch((e) => log(`row click failed: ${e.message}`));
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    log(`url after attempt 3 = ${page.url()}`);
    await shot('04-attempt3-row-click');
    onCreateForm = page.url().includes('/create');
  }

  if (!onCreateForm) {
    log('attempt 4: scrolling grid right to look for an action icon on this row');
    const grid = page.locator('[role="grid"]').first();
    const row = page.locator('.rdg-row[role="row"]').filter({ hasText: 'In-Draft' }).first();
    const rowIndex = await row.getAttribute('aria-rowindex').catch(() => null);
    for (let i = 0; i < 20; i++) {
      const anyIcon = page.locator(`.rdg-row[role="row"][aria-rowindex="${rowIndex}"] button, .rdg-row[role="row"][aria-rowindex="${rowIndex}"] svg`);
      if (await anyIcon.first().isVisible({ timeout: 300 }).catch(() => false)) break;
      const atEnd = await grid.evaluate((el) => {
        const before = el.scrollLeft;
        el.scrollLeft = el.scrollWidth;
        return el.scrollLeft === before;
      });
      await page.waitForTimeout(300);
      if (atEnd) break;
    }
    await shot('05-attempt4-scrolled-right');
    const rowNow = page.locator(`.rdg-row[role="row"][aria-rowindex="${rowIndex}"]`);
    const rowHtml = await rowNow.innerHTML().catch(() => '(row not found)');
    log('attempt 4: scrolled row HTML dump:');
    console.log(rowHtml.slice(0, 3000));

    const icon = rowNow.locator('button, svg').last();
    if (await icon.isVisible({ timeout: 2000 }).catch(() => false)) {
      await icon.click().catch((e) => log(`icon click failed: ${e.message}`));
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(1000);
      log(`url after attempt 4 = ${page.url()}`);
      await shot('06-attempt4-after-icon-click');
      onCreateForm = page.url().includes('/create');
    }
  }

  if (!onCreateForm) {
    log('attempt 5: theory — the badge is informational only; resuming just means');
    log('attempt 5: clicking "Create RFI" again, same auto-resume 02_rfi_ci.spec.js documented');
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await myTasks.waitForLoad();
    await myTasks.clickCreateRFI();
    await page.waitForTimeout(1500);
    log(`url after attempt 5 (Create RFI click) = ${page.url()}`);
    await shot('07-attempt5-create-rfi-click');
    onCreateForm = page.url().includes('/create');
    if (onCreateForm) {
      const wl = (await rfiCreate.workLocationDropdown.innerText().catch(() => '(unreadable)')).trim();
      log(`attempt 5: Work Location shown = "${wl}" (non-empty ⇒ auto-resumed the same draft)`);
    }
  }

  log(`landed back on /create = ${onCreateForm}`);
  if (!onCreateForm) {
    console.log((await page.locator('body').innerText()).slice(0, 1500));
    log('DONE (could not find the resume trigger — see attempts above)');
    return;
  }

  const workLocationValue = (await rfiCreate.workLocationDropdown.innerText().catch(() => '(unreadable)')).trim();
  log(`Work Location on resume = "${workLocationValue}"`);

  log('completing the draft with the rest of RFI_DATA');
  const { workLocation, ...rest } = RFI_DATA;
  await rfiCreate.fillForm({ workLocation: null, ...rest });
  await rfiCreate.clickProceed();

  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations('OK - as per standard', true);
  await checklist.submitRFI();
  log(`submitted, url = ${page.url()}`);
  await shot('03-after-submit');

  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  log(`extracted rfi id after completing draft = ${match ? match[1] : '(none — did not land on /view)'}`);

  log('DONE');
});
