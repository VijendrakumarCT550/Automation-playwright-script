const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const MyTasksPage   = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');

// THROWAWAY inspector — nails down the exact draft-autosave mechanics for
// tests/specs/24_rfi_draft_autosave.spec.js before writing it for real:
// (1) does selecting ONLY Work Location then going back actually create a
// draft, (2) how is it labeled in "Pending with me" (separate Status badge
// vs. the row's code column literally showing "DRAFT" — the codebase's
// existing "DRAFT-code race"/"DRAFT-placeholder" comments in
// rfi-flow-turns.js/nc-flow-turns.js hint at the latter), (3) does browser
// Back behave the same as an in-app nav click away. Delete once captured
// in code comments, matching this repo's 00_inspect_*.spec.js convention.
test('INSPECT: RFI draft-autosave — minimal field + both back mechanisms', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
  let shotCount = 0;
  const shot = async (label) => {
    shotCount++;
    const path = `test-results/draft-inspect-${String(shotCount).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path, fullPage: true }).catch((e) => log(`screenshot failed: ${e.message}`));
    log(`screenshot -> ${path}`);
  };

  await loginAsRole(page, 'CI');
  const myTasks = new MyTasksPage(page);

  // ---- Path A: browser Back button, only Work Location filled ----
  log('PATH A: browser Back — filling only Work Location');
  await myTasks.clickCreateRFI();
  const rfiCreateA = new RFICreatePage(page);
  await rfiCreateA.selectOption(rfiCreateA.workLocationDropdown, 'A-06c');
  await shot('a-work-location-only');
  log(`PATH A: url before back = ${page.url()}`);

  await page.goBack();
  await page.waitForTimeout(3000);
  log(`PATH A: url after goBack = ${page.url()}`);
  await shot('a-after-goback');

  // Same un-bounce loop 02_rfi_ci.spec.js already established for
  // auto-resumed drafts — Cancel breaks the resume cycle so a subsequent
  // nav to /my-tasks actually lands there.
  for (let attempt = 0; attempt < 5 && page.url().includes('/create'); attempt++) {
    log(`PATH A: still on /create (auto-resumed?), attempt ${attempt + 1} — clicking Cancel`);
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(2000);
    }
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(2000);
  }
  log(`PATH A: final url = ${page.url()}`);
  await myTasks.waitForLoad();
  await shot('a-my-tasks-landed');

  await myTasks.pendingWithMeTile.waitFor({ state: 'visible' });
  await myTasks.clickPendingWithMe();
  await page.waitForTimeout(2000);
  await shot('a-pending-with-me-grid');
  const gridTextA = await page.locator('[role="grid"]').first().innerText().catch(() => '(grid not found)');
  log('PATH A: grid text dump:');
  console.log(gridTextA);

  // ---- Path B: in-app nav click away (My Tasks sidebar link), only Work Location filled ----
  log('PATH B: in-app nav click — filling only Work Location');
  await myTasks.waitForLoad().catch(() => {});
  await page.goto(`${process.env.BASE_URL}/my-tasks`);
  await myTasks.waitForLoad();
  await myTasks.clickCreateRFI();
  const rfiCreateB = new RFICreatePage(page);
  await rfiCreateB.selectOption(rfiCreateB.workLocationDropdown, 'A-06c');
  await shot('b-work-location-only');

  const myTasksNav = page.locator('a:has-text("My Tasks"), nav >> text=My Tasks').first();
  await myTasksNav.click();
  await page.waitForTimeout(3000);
  log(`PATH B: url after nav click = ${page.url()}`);
  await shot('b-after-navclick');

  for (let attempt = 0; attempt < 5 && page.url().includes('/create'); attempt++) {
    log(`PATH B: still on /create (auto-resumed?), attempt ${attempt + 1} — clicking Cancel`);
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(2000);
    }
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(2000);
  }
  log(`PATH B: final url = ${page.url()}`);
  await myTasks.waitForLoad();

  await myTasks.pendingWithMeTile.waitFor({ state: 'visible' });
  await myTasks.clickPendingWithMe();
  await page.waitForTimeout(2000);
  await shot('b-pending-with-me-grid');
  const gridTextB = await page.locator('[role="grid"]').first().innerText().catch(() => '(grid not found)');
  log('PATH B: grid text dump:');
  console.log(gridTextB);

  log('DONE');
});
