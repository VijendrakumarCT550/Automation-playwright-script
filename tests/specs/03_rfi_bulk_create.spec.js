const { test, expect } = require('@playwright/test');
const LoginPage        = require('../pages/LoginPage');
const DashboardPage    = require('../pages/DashboardPage');
const MyTasksPage      = require('../pages/MyTasksPage');
const RFICreatePage    = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

const TOTAL_RFIS = 2;

const RFI_DATA = {
  // workLocation:         null,
  workLocation:         'A-06c',
  workArea:             'BL01',
  package:              'Civil',
  // subPackage:           'Piling (MMS, Inverter, LT Cable Hangers) + IDT Civil & Structural',
  subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
  activity:             'Piling - MMS',
  subActivity:          'Piling - MMS',
  rfiQuantity:          null,
  unit:                 null,
  subContractor:        null,
  inspectionCheckpoint: 'Pre Pour Inspection - Pile',
  inspectionChecklist:  'Micro Pile Checklist',
};

test.describe('RFI Bulk Creation - CI', () => {
  let page;
  const results = [];

  test.beforeAll(async ({ browser }) => {
    // beforeAll has its own timeout ceiling (defaults to playwright.config.js's
    // `timeout: 600000`), separate from test.setTimeout() below which only
    // covers the test() body. DashboardPage's spinner wait alone is also
    // 600000ms, so this needs real headroom above that.
    test.setTimeout(15 * 60 * 1000);

    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    await context.clearCookies();
    page = await context.newPage();

    const login = new LoginPage(page);
    await login.goto();
    await login.login(process.env.CI_EMAIL, process.env.CI_PASSWORD);

    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
    await dashboard.goToMyTasks();
  });

  test.afterAll(async () => {
    console.log('\n=== Bulk RFI Creation Summary ===');
    results.forEach(r =>
      console.log(`  RFI ${String(r.index).padStart(2, '0')}: ${r.status}${r.error ? ' — ' + r.error : ''}`)
    );
    const submitted = results.filter(r => r.status === 'submitted').length;
    console.log(`\n  Total submitted: ${submitted} / ${TOTAL_RFIS}`);
    await page.close();
  });

  test(`Create ${TOTAL_RFIS} RFIs as CI in a single session`, async () => {
    // Allow up to 45 min for 15 RFIs (~3 min each including form fill + checklist)
    test.setTimeout(45 * 60 * 1000);

    for (let i = 1; i <= TOTAL_RFIS; i++) {
      console.log(`\n→ RFI ${i}/${TOTAL_RFIS}: starting`);

      try {
        // Navigate to My Tasks and cancel any auto-resumed draft from previous iteration
        for (let attempt = 0; attempt < 5; attempt++) {
          await page.goto(`${process.env.BASE_URL}/my-tasks`);
          await page.waitForTimeout(30);
          if (!page.url().includes('/create')) break;
          const cancelBtn = page.getByRole('button', { name: 'Cancel' });
          if (await cancelBtn.isVisible({ timeout: 30 }).catch(() => false)) {
            await cancelBtn.click();
            await page.waitForTimeout(30);
          }
        }

        const myTasks = new MyTasksPage(page);
        await myTasks.waitForLoad();
        await myTasks.clickCreateRFI();

        const rfiCreate = new RFICreatePage(page);
        await rfiCreate.fillForm(RFI_DATA);
        await rfiCreate.clickProceed();

        const checklist = new RFIChecklistPage(page);
        await checklist.fillAllObservations('OK - as per standard', true);
        await checklist.submitRFI();

        results.push({ index: i, status: 'submitted' });
        console.log(`✓ RFI ${i} submitted`);

        // Brief pause between submissions
        await page.waitForTimeout(30);

      } catch (err) {
        const msg = err.message.split('\n')[0];
        results.push({ index: i, status: 'failed', error: msg });
        console.log(`✗ RFI ${i} failed: ${msg}`);
        // Continue to next iteration — don't abort on a single failure
      }
    }

    const submitted = results.filter(r => r.status === 'submitted').length;
    expect(submitted).toBeGreaterThan(0);
  });
});
