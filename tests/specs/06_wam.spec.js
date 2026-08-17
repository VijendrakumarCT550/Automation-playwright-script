const { test, expect } = require('@playwright/test');
const WAMPage              = require('../pages/WAMPage');
const { adminFreshLogin }  = require('../utils/helpers');

// Cluster's available options have been observed to vary between "Gujarat"
// and "Khavda"/"KHAVDA" for what's meant to be the same location, depending
// on deployment/DB state — accept either.
const LOCATION_FILTERS = {
  cluster:      ['Gujarat', 'Khavda'],
  site:         'Khavda',
  workLocation: 'A-06c',
  package:      'Civil',
};

const TARGET_WORK_AREAS = ['BL01', 'BL02', 'BL03', 'BL04', 'BL05',
'BL06', 'BL07', 'BL08', 'BL09', 'BL10',
'BL11', 'BL12', 'BL13', 'BL14', 'BL15',
'BL16', 'BL17', 'BL18', 'BL19', 'BL20'];

// more work areas exist in the DB, but the test is limited to a smaller set to keep the test runtime reasonable. The full set of work areas is commented out below for reference.
// const TARGET_WORK_AREAS = ['BL01', 'BL02', 'BL03', 'BL04', 'BL05',
// 'BL06', 'BL07', 'BL08', 'BL09', 'BL10',
// 'BL11', 'BL12', 'BL13', 'BL14', 'BL15',
// 'BL16', 'BL17', 'BL18', 'BL19', 'BL20',
// 'BL21', 'BL22', 'BL23', 'BL24', 'BL25',
// 'BL26', 'BL27', 'BL28', 'BL29', 'BL30',
// 'BL31', 'BL32', 'BL33', 'BL34', 'BL35',
// 'BL36', 'BL37', 'BL38', 'BL39', 'BL40'];

const SCENARIOS = [
  // Roster has "Jay Kishan Suthar" (no exact "Jay Kishan Sutha" entry exists).
  { role: 'Execution Engineer', assignee: 'Jay Kishan Suthar' },
  { role: 'Quality Inspector',  assignee: 'Udit Sharma' },

    // { role: 'Execution Engineer', assignee: 'Chetan Singh' },
    // { role: 'Quality Inspector',  assignee: 'Gopal Jantua' },

];

test.describe('Admin - Work Area Mapping (WAM)', () => {
  let context, page, dashboard;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, dashboard } = await adminFreshLogin(browser));
  });

  test.afterAll(async () => {
    await context.close();
  });

  for (const { role, assignee } of SCENARIOS) {
    test(`Admin can assign a ${role} to work areas and submit`, async () => {
      const filters = { role, ...LOCATION_FILTERS };
      const wam = new WAMPage(page);
      await wam.goto(dashboard);
      await wam.openAddDetails();
      await wam.fillAssignmentFilters(filters);

      for (const area of TARGET_WORK_AREAS) {
        await wam.selectWorkAreaUser(area, assignee);
      }

      for (const area of TARGET_WORK_AREAS) {
        await expect(wam.getWorkAreaRow(area).locator('[role="combobox"]')).toContainText(assignee);
      }

      await wam.clickSubmit();

      // Submit resets the dialog's fields rather than closing it — reselect
      // the same filters in place and confirm the assignment persisted.
      await wam.fillAssignmentFilters(filters);

      for (const area of TARGET_WORK_AREAS) {
        const value = await wam.getWorkAreaUserValue(area);
        expect(value).toContain(assignee);
      }

      // Submit doesn't close the dialog — close it explicitly so the next
      // scenario's navigation isn't blocked by its backdrop.
      await wam.closeDialog();
    });
  }
});
