const { test, expect } = require('@playwright/test');
const LoginPage        = require('../pages/LoginPage');
const DashboardPage    = require('../pages/DashboardPage');
const MyTasksPage      = require('../pages/MyTasksPage');
const RFICreatePage    = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// Creates ONE RFI per entry below, across DIFFERENT Work Locations/Work
// Areas, with each entry running as its OWN independent Playwright test —
// unlike 03_rfi_bulk_create.spec.js (same single location, N RFIs, one
// serial session/loop), this lets Playwright's own `fullyParallel: true`
// (already set in playwright.config.js) schedule the entries across
// multiple workers automatically, so N locations finish in roughly the
// time of the slowest ONE instead of N times that. Kept as a fully
// separate file — 03_rfi_bulk_create.spec.js is untouched.
//
// EDIT THIS LIST before each run — add/remove/change entries for whatever
// blocks/locations you actually need that day. Every field below is
// exactly what RFICreatePage.fillForm() accepts (see that file for the
// full list of optional fields: rfiQuantity, unit, subContractor).
//
// Confirmed live: user CAN run this with multiple parallel workers all
// logged in as the SAME CI_EMAIL account — this app supports concurrent
// sessions for one account, no need for separate accounts per worker.
//
// Run examples:
//   npx playwright test tests/specs/20_rfi_bulk_create_multi_location.spec.js --project=chromium
//   npx playwright test tests/specs/20_rfi_bulk_create_multi_location.spec.js --project=chromium --workers=4
const RFI_LOCATIONS = [
  {
    workLocation:         'A-06c',
    workArea:             'BL01',
    package:              'Civil',
    subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
    activity:             'Piling - MMS',
    subActivity:          'Piling - MMS',
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist:  'Micro Pile Checklist',
  },
  // Add one entry per additional block/work location here, e.g.:
  {
    workLocation:         'A-06c',
    workArea:             'BL02',
    package:              'Civil',
    subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
    activity:             'Piling - MMS',
    subActivity:          'Piling - MMS',
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist:  'Micro Pile Checklist',
  },

   // Add one entry per additional block/work location here, e.g.:
  {
    workLocation:         'A-06c',
    workArea:             'BL03',
    package:              'Civil',
    subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
    activity:             'Piling - MMS',
    subActivity:          'Piling - MMS',
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist:  'Micro Pile Checklist',
  },
   // Add one entry per additional block/work location here, e.g.:
  {
    workLocation:         'A-06c',
    workArea:             'BL04',
    package:              'Civil',
    subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
    activity:             'Piling - MMS',
    subActivity:          'Piling - MMS',
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist:  'Micro Pile Checklist',
  },
   // Add one entry per additional block/work location here, e.g.:
  {
    workLocation:         'A-06c',
    workArea:             'BL05',
    package:              'Civil',
    subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
    activity:             'Piling - MMS',
    subActivity:          'Piling - MMS',
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist:  'Micro Pile Checklist',
  },
    // Add one entry per additional block/work location here, e.g.:
  {
    workLocation:         'A-06c',
    workArea:             'BL06',
    package:              'Civil',
    subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
    activity:             'Piling - MMS',
    subActivity:          'Piling - MMS',
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist:  'Micro Pile Checklist',
  },
    // Add one entry per additional block/work location here, e.g.:
  {
    workLocation:         'A-06c',
    workArea:             'BL07',
    package:              'Civil',
    subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
    activity:             'Piling - MMS',
    subActivity:          'Piling - MMS',
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist:  'Micro Pile Checklist',
  },
];

for (const [index, location] of RFI_LOCATIONS.entries()) {
  test(`Create RFI ${index + 1}/${RFI_LOCATIONS.length} — ${location.workLocation}/${location.workArea}`, async ({ page }) => {
    // Fresh login (~5-6min PWA install on first load in this env) + form
    // fill + checklist submit, all in one worker's own session.
    test.setTimeout(15 * 60 * 1000);

    const login = new LoginPage(page);
    await login.goto();
    await login.login(process.env.CI_EMAIL, process.env.CI_PASSWORD);

    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
    await dashboard.goToMyTasks();

    const myTasks = new MyTasksPage(page);
    await myTasks.waitForLoad();
    await myTasks.clickCreateRFI();

    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.fillForm(location);
    await rfiCreate.clickProceed();

    const checklist = new RFIChecklistPage(page);
    await checklist.fillAllObservations('OK - as per standard', true);
    await checklist.submitRFI();

    const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
    expect(match, `Could not extract RFI id from URL: ${page.url()}`).toBeTruthy();
    console.log(`✓ Created RFI for ${location.workLocation}/${location.workArea}: ${match[1]}`);
  });
}
