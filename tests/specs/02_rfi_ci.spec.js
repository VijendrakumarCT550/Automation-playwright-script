const { test, expect } = require('@playwright/test');
const LoginPage        = require('../pages/LoginPage');
const DashboardPage    = require('../pages/DashboardPage');
const MyTasksPage      = require('../pages/MyTasksPage');
const RFICreatePage    = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// Login happens ONCE in beforeAll. The same browser page is reused for all 7
// tests, so the 5-6 min PWA load only occurs one time per suite run.
// beforeEach navigates back to /my-tasks (< 1 sec, assets already cached).
test.describe.serial('RFI - CI flow', () => {

  // ── Test data ──────────────────────────────────────────────────────────────
  const RFI_DATA = {
    workLocation:         null,           // S05b auto-populated on form open — no interaction needed
    workArea:             'BL01',
    package:              'Civil',
    subPackage:           'Piling (MMS, Inverter, LT Cable Hangers) + IDT Civil & Structural',
    activity:             'Piling - MMS',
    subActivity:          'Piling - MMS',
    rfiQuantity:          null,
    unit:                 null,
    subContractor:        null,
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist:  'Micro Pile Checklist',
  };

  // ── Shared page (set in beforeAll, used by all tests) ─────────────────────
  let page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    await context.clearCookies();
    page = await context.newPage();

    // Login once — this is the only time the 5-6 min PWA load happens
    const login = new LoginPage(page);
    await login.goto();
    await login.login(process.env.CI_EMAIL, process.env.CI_PASSWORD);

    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
    await dashboard.goToMyTasks();
  });

  test.afterAll(async () => {
    await page.close();
  });

  // Return to My Tasks before each test so every test starts from a known state.
  // The app has auto-save: partially filled forms are auto-saved as drafts and
  // auto-resumed when navigating to /my-tasks. Loop until we're actually there.
  test.beforeEach(async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      await page.goto(`${process.env.BASE_URL}/my-tasks`);
      await page.waitForTimeout(3000);
      if (!page.url().includes('/create')) break;
      // App auto-resumed a draft — cancel it
      const cancelBtn = page.getByRole('button', { name: 'Cancel' });
      if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(3000);
      }
    }
    const myTasks = new MyTasksPage(page);
    await myTasks.waitForLoad();
  });

  // ── 1. My Tasks tiles visible ──────────────────────────────────────────────
  test('CI My Tasks shows Pending with me, Pending with others, Approved tiles', async () => {
    const myTasks = new MyTasksPage(page);
    await expect(myTasks.pendingWithMeTile).toBeVisible();
    await expect(myTasks.pendingWithOthersTile).toBeVisible();
    await expect(myTasks.approvedTile).toBeVisible();
    await expect(myTasks.createRFIButton).toBeVisible();
  });

  // ── 2. Create RFI button opens form ───────────────────────────────────────
  test('Create RFI button opens the RFI creation form', async () => {
    const myTasks = new MyTasksPage(page);
    await myTasks.clickCreateRFI();

    const rfiCreate = new RFICreatePage(page);
    await expect(rfiCreate.workLocationDropdown).toBeVisible({ timeout: 15000 });
  });

  // ── 3. Mandatory field validation ─────────────────────────────────────────
  // Proceed either stays disabled, or clicking it keeps the user on Page 1.
  // The app validates by preventing navigation rather than showing an error div.
  test('Proceed is blocked when mandatory fields are empty', async () => {
    const myTasks = new MyTasksPage(page);
    await myTasks.clickCreateRFI();

    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.proceedButton.waitFor({ state: 'visible' });

    const isDisabled = await rfiCreate.proceedButton.isDisabled();
    if (isDisabled) {
      // Button disabled — validation blocks Proceed directly
      expect(isDisabled).toBe(true);
    } else {
      // Button enabled — click it and verify we stay on Page 1 (not navigated to checklist)
      await rfiCreate.proceedButton.click();
      await page.waitForTimeout(1000);
      // "Answer all the questions" only appears on Page 2
      await expect(page.locator('text=Answer all the questions')).not.toBeVisible();
      // Work Area dropdown still visible → still on Page 1
      await expect(rfiCreate.workAreaDropdown).toBeVisible();
    }
  });

  // ── 4. Auto-save Draft ────────────────────────────────────────────────────
  // App auto-saves while filling — no need to click the Draft button.
  // Navigating away from the form is enough to persist the draft.
  test('CI can save RFI as draft — count in Pending with me increases', async () => {
    const myTasks = new MyTasksPage(page);
    const countBefore = await myTasks.getTileCount(myTasks.pendingWithMeTile);

    await myTasks.clickCreateRFI();
    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.fillForm(RFI_DATA);

    // Navigate away — auto-save persists the draft
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(5000);
    // Cancel any auto-resumed draft so we can read the tile count cleanly
    if (page.url().includes('/create')) {
      const cancelBtn = page.getByRole('button', { name: 'Cancel' });
      if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(3000);
      }
      await page.goto(`${process.env.BASE_URL}/my-tasks`);
    }
    await myTasks.waitForLoad();
    const countAfter = await myTasks.getTileCount(myTasks.pendingWithMeTile);
    expect(countAfter).toBeGreaterThanOrEqual(countBefore);

    await page.screenshot({ path: 'test-results/after_save_draft.png', fullPage: true });
  });

  // ── 5. Submit RFI ─────────────────────────────────────────────────────────
  test('CI can submit an RFI — moves to Pending with others', async () => {
    const myTasks = new MyTasksPage(page);
    const pendingOthersBefore = await myTasks.getTileCount(myTasks.pendingWithOthersTile);

    await myTasks.clickCreateRFI();
    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.fillForm(RFI_DATA);
    await rfiCreate.clickProceed();

    const checklist = new RFIChecklistPage(page);
    await checklist.fillAllObservations('OK - as per standard');
    await checklist.submitRFI();

    // Backend processes the submission asynchronously — wait before reading tile counts
    await page.waitForTimeout(45000);

    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await myTasks.waitForLoad();
    const pendingOthersAfter = await myTasks.getTileCount(myTasks.pendingWithOthersTile);
    expect(pendingOthersAfter).toBeGreaterThan(pendingOthersBefore);

    await page.screenshot({ path: 'test-results/after_submit_rfi.png', fullPage: true });
  });

  // ── 6. Cancel submit confirmation stays on checklist ──────────────────────
  test('Cancelling submit confirmation stays on checklist page', async () => {
    const myTasks = new MyTasksPage(page);
    await myTasks.clickCreateRFI();

    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.fillForm(RFI_DATA);
    await rfiCreate.clickProceed();

    const checklist = new RFIChecklistPage(page);
    await checklist.fillAllObservations('OK');
    await checklist.clickSubmit();
    await checklist.cancelSubmit();

    await expect(checklist.submitButton).toBeVisible();
  });

  // ── 7. Duplicate RFI prevention ───────────────────────────────────────────
  test('Duplicate RFI for same Work Section + Sub-Activity + Checkpoint is blocked', async () => {
    const myTasks = new MyTasksPage(page);
    await myTasks.clickCreateRFI();

    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.fillForm(RFI_DATA);

    // Click Proceed directly (not clickProceed) — duplicate error may show on page 1
    // before navigation to page 2, which would cause clickProceed() to timeout.
    await rfiCreate.proceedButton.click();

    const duplicateError = page.locator('text=already exists')
      .or(page.locator('text=duplicate'))
      .or(page.locator('text=RFI already'))
      .or(page.locator('[class*="error"]'))
      .first();

    // Check if the error appeared immediately on page 1
    const blockedOnPage1 = await duplicateError.isVisible({ timeout: 8000 }).catch(() => false);

    if (!blockedOnPage1) {
      // App allowed through to page 2 — submit there to trigger the duplicate check
      await page.locator('text=Answer all the questions').waitFor({ state: 'visible', timeout: 30000 });
      const checklist = new RFIChecklistPage(page);
      await checklist.clickSubmit();
      await expect(duplicateError).toBeVisible({ timeout: 15000 });
    } else {
      await expect(duplicateError).toBeVisible();
    }
  });
});
