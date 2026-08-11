/**
 * DOM Inspector — NOT a real test, no assertions.
 * Creates a fresh RFI as CI, rejects it as EE (Page 1), then as CI opens it
 * from "Pending with me" via its Actions-column eye icon, to see whether
 * that click lands on the read-only /view page (needing a further
 * Edit/Resubmit button) or routes straight to the editable /re-submit form.
 *
 * Usage (single run, headed so you can watch):
 *   npx playwright test tests/specs/00_inspect_rfi_resubmit_nav.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const LoginPage        = require('../pages/LoginPage');
const DashboardPage     = require('../pages/DashboardPage');
const MyTasksPage       = require('../pages/MyTasksPage');
const RFICreatePage     = require('../pages/RFICreatePage');
const RFIChecklistPage  = require('../pages/RFIChecklistPage');
const RFIReviewPage     = require('../pages/RFIReviewPage');

const RFI_DATA = {
  workLocation:         'A-06c',
  workArea:             'BL01',
  package:              'Civil',
  subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
  activity:             'Piling - MMS',
  subActivity:          'Piling - MMS',
  rfiQuantity:          null,
  unit:                 null,
  subContractor:        null,
  inspectionCheckpoint: 'Pre Pour Inspection - Pile',
  inspectionChecklist:  'Micro Pile Checklist',
};

test('Inspect CI open-from-list navigation after a reject', async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);
  fs.mkdirSync('test-results', { recursive: true });

  // --- 1. CI creates a fresh RFI ---
  const ciContext1 = await browser.newContext({ permissions: ['geolocation'] });
  const ciPage1 = await ciContext1.newPage();
  const ciLogin1 = new LoginPage(ciPage1);
  await ciLogin1.goto();
  await ciLogin1.login(process.env.CI_EMAIL, process.env.CI_PASSWORD);
  const dashboard1 = new DashboardPage(ciPage1);
  await dashboard1.waitForLoad();
  await dashboard1.goToMyTasks();
  const myTasks1 = new MyTasksPage(ciPage1);
  await myTasks1.waitForLoad();
  await myTasks1.clickCreateRFI();
  const rfiCreate = new RFICreatePage(ciPage1);
  await rfiCreate.fillForm(RFI_DATA);
  await rfiCreate.clickProceed();
  const checklist = new RFIChecklistPage(ciPage1);
  await checklist.fillAllObservations('OK - as per standard', true);
  await checklist.submitRFI();

  const visibleCode = (await ciPage1.locator('a[aria-current="page"][href*="/rfi/"]').first().innerText()).trim();
  const rfiIdMatch = ciPage1.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  const rfiId = rfiIdMatch[1];
  console.log('Created RFI id:', rfiId, 'visible code:', visibleCode);
  await ciContext1.close();

  // --- 2. EE rejects it (Page 1) ---
  const eeContext = await browser.newContext({ permissions: ['geolocation'] });
  const eePage = await eeContext.newPage();
  const eeLogin = new LoginPage(eePage);
  await eeLogin.goto();
  await eeLogin.login(process.env.EE_EMAIL, process.env.EE_PASSWORD);
  const review = new RFIReviewPage(eePage);
  await review.goto(rfiId);
  await review.expandAllChecklist();
  await review.rejectFromFirstPage('Automated inspector rejection - P1');
  console.log('EE reject done, URL:', eePage.url());
  await eeContext.close();

  // --- 3. CI opens it from Pending with me via the eye icon ---
  const ciContext2 = await browser.newContext({ permissions: ['geolocation'] });
  const ciPage2 = await ciContext2.newPage();
  const ciLogin2 = new LoginPage(ciPage2);
  await ciLogin2.goto();
  await ciLogin2.login(process.env.CI_EMAIL, process.env.CI_PASSWORD);
  const dashboard2 = new DashboardPage(ciPage2);
  await dashboard2.waitForLoad();
  await dashboard2.goToMyTasks();

  const myTasks2 = new MyTasksPage(ciPage2);
  await myTasks2.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
  await myTasks2.clickPendingWithMe();

  const grid = ciPage2.locator('[role="grid"]').first();
  await grid.waitFor({ state: 'visible', timeout: 20000 });
  const row = grid.locator('.rdg-row[role="row"]').filter({
    has: ciPage2.locator('[role="gridcell"][aria-colindex="1"]', { hasText: visibleCode }),
  });
  await row.waitFor({ state: 'visible', timeout: 15000 });
  const rowIndex = await row.getAttribute('aria-rowindex');

  const statusCell = row.locator('[role="gridcell"][aria-colindex="2"]');
  console.log('Status column text:', (await statusCell.innerText().catch(() => '')).trim());

  for (let i = 0; i < 20; i++) {
    await grid.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await ciPage2.waitForTimeout(400);
    const scrolledRow = grid.locator(`.rdg-row[role="row"][aria-rowindex="${rowIndex}"]`);
    const lastCell = scrolledRow.locator('[role="gridcell"]').last();
    const colIndex = await lastCell.getAttribute('aria-colindex').catch(() => null);
    if (colIndex === '15') break;
  }

  const scrolledRow = grid.locator(`.rdg-row[role="row"][aria-rowindex="${rowIndex}"]`);
  const actionsCell = scrolledRow.locator('[role="gridcell"]').last();
  const eyeButton = actionsCell.locator('button:has(svg.lucide-eye)').first();
  await eyeButton.click();
  await ciPage2.waitForLoadState('networkidle');
  await ciPage2.waitForTimeout(1500);

  console.log('CI URL after clicking eye icon on rejected row:', ciPage2.url());
  await ciPage2.screenshot({ path: 'test-results/resubmit_nav_after_click.png', fullPage: true });
  fs.writeFileSync('test-results/resubmit_nav_after_click.html', await ciPage2.content());

  const buttons = await ciPage2.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => (b.innerText || '').trim()).filter(Boolean)
  );
  console.log('Buttons on landed page:', JSON.stringify(buttons));

  await ciContext2.close();
});
