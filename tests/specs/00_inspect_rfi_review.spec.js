/**
 * DOM Inspector — NOT a real test, no assertions.
 * Creates one throwaway RFI as CI, then opens it as EE from "Pending with
 * me" to discover the review page's real structure: Approve/Reject
 * buttons, the remarks popup, and where the RFI version is displayed.
 *
 * Usage (single run, headed so you can watch):
 *   npx playwright test tests/specs/00_inspect_rfi_review.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const LoginPage        = require('../pages/LoginPage');
const DashboardPage     = require('../pages/DashboardPage');
const MyTasksPage       = require('../pages/MyTasksPage');
const RFICreatePage     = require('../pages/RFICreatePage');
const RFIChecklistPage  = require('../pages/RFIChecklistPage');

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

test('Inspect EE review page for a freshly-created RFI', async ({ browser }) => {
  // Two full logins (CI, then EE) plus RFI creation — well over the default 10min.
  test.setTimeout(25 * 60 * 1000);
  fs.mkdirSync('test-results', { recursive: true });

  // --- 1. CI creates one throwaway RFI ---
  const ciContext = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const ciPage = await ciContext.newPage();
  const ciLogin = new LoginPage(ciPage);
  await ciLogin.goto();
  await ciLogin.login(process.env.CI_EMAIL, process.env.CI_PASSWORD);
  const ciDashboard = new DashboardPage(ciPage);
  await ciDashboard.waitForLoad();
  await ciDashboard.goToMyTasks();

  const myTasks = new MyTasksPage(ciPage);
  await myTasks.waitForLoad();
  await myTasks.clickCreateRFI();
  const rfiCreate = new RFICreatePage(ciPage);
  await rfiCreate.fillForm(RFI_DATA);
  await rfiCreate.clickProceed();
  const checklist = new RFIChecklistPage(ciPage);
  await checklist.fillAllObservations('OK - as per standard', true);
  await checklist.submitRFI();

  console.log('CI post-submit URL:', ciPage.url());
  const rfiIdMatch = ciPage.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  console.log('RFI URL id segment:', rfiIdMatch ? rfiIdMatch[1] : 'NOT FOUND');

  await ciPage.screenshot({ path: 'test-results/review_ci_after_submit.png', fullPage: true });
  fs.writeFileSync('test-results/review_ci_after_submit.html', await ciPage.content());
  await ciContext.close();

  // --- 2. EE opens it from Pending with me ---
  const eeContext = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const eePage = await eeContext.newPage();
  const eeLogin = new LoginPage(eePage);
  await eeLogin.goto();
  await eeLogin.login(process.env.EE_EMAIL, process.env.EE_PASSWORD);
  const eeDashboard = new DashboardPage(eePage);
  await eeDashboard.waitForLoad();
  await eeDashboard.goToMyTasks();

  // NOT eeMyTasks.waitForLoad() — that waits for the "Create RFI" button,
  // which only exists on CI's My Tasks page. EE/QI have no create button.
  const eeMyTasks = new MyTasksPage(eePage);
  await eeMyTasks.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
  await eeMyTasks.clickPendingWithMe();
  await eePage.waitForTimeout(1500);
  await eePage.screenshot({ path: 'test-results/review_ee_pending_list.png', fullPage: true });
  fs.writeFileSync('test-results/review_ee_pending_list.html', await eePage.content());

  // Click the first row/card in the pending list to open the most recent RFI
  const rows = eePage.locator('table tbody tr, [role="row"], a[href*="/rfi/"]');
  console.log('Pending-with-me row count:', await rows.count());
  if (await rows.count() > 0) {
    await rows.first().click();
    await eePage.waitForLoadState('networkidle');
    await eePage.waitForTimeout(1500);

    console.log('EE review page URL:', eePage.url());
    await eePage.screenshot({ path: 'test-results/review_ee_rfi_detail.png', fullPage: true });
    fs.writeFileSync('test-results/review_ee_rfi_detail.html', await eePage.content());

    const buttons = await eePage.evaluate(() =>
      Array.from(document.querySelectorAll('button')).map(b => ({
        text: b.innerText?.trim(),
        ariaLabel: b.getAttribute('aria-label'),
        className: b.className,
      })).filter(b => b.text || b.ariaLabel)
    );
    console.log('Buttons on EE RFI detail page:', JSON.stringify(buttons, null, 2));

    // Look for anything version-like
    const versionTexts = await eePage.evaluate(() =>
      Array.from(document.querySelectorAll('*'))
        .map(el => el.innerText)
        .filter(t => t && /^V\d+$/.test(t.trim()))
    );
    console.log('Version-like texts found:', JSON.stringify([...new Set(versionTexts)]));
  }

  await eeContext.close();
});
