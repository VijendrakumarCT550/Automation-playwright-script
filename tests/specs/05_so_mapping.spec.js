const { test, expect } = require('@playwright/test');
const SOMappingPage       = require('../pages/SOMappingPage');
const { adminFreshLogin } = require('../utils/helpers');

// Cluster's available options have been observed to vary between "Gujarat"
// and "Khavda"/"KHAVDA" for what's meant to be the same location, depending
// on deployment/DB state — accept either.
const MAPPING_FILTERS = {
  cluster:      ['Gujarat', 'Khavda'],
  site:         'Khavda',
  projectType:  'SOLAR',
  workLocation: 'A-06c',
  workAreas:    ['BL01', 'BL02', 'BL03', 'BL04', 'BL05',
'BL06', 'BL07', 'BL08', 'BL09', 'BL10'],
  package:      'Civil',
};

const TARGET_ACTIVITIES = [
  'Piling - MMS',
  'Piling - Inverter',
  'Piling - Robotic Docking System',
  'Piling - LT Cable Hanger System',
];

const VENDOR = 'M S CHOUHAN INFRAVENTURES PVT LTD';

test.describe('Admin - SO Mapping', () => {
  let context, page, dashboard;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, dashboard } = await adminFreshLogin(browser));
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('Admin can map a Service Order to activities and save', async () => {
    const soMapping = new SOMappingPage(page);
    await soMapping.goto(dashboard);
    await soMapping.selectMappingFilters(MAPPING_FILTERS);

    // Select the vendor for each target activity first — Save is only
    // clicked once every selection is made, since re-opening a saved mapping
    // shows the previously saved SO/vendor, so a premature Save would lock
    // in an incomplete mapping.
    for (const activity of TARGET_ACTIVITIES) {
      await soMapping.selectServiceOrder(activity, VENDOR);
    }

    for (const activity of TARGET_ACTIVITIES) {
      await expect(soMapping.getActivityRow(activity).locator('[role="combobox"]')).toContainText('CHOUHAN');
    }

    await soMapping.clickSave();

    // Re-open the same filter combination fresh and confirm the mapping persisted.
    await page.goto(`${process.env.BASE_URL}/so-mapping`);
    await soMapping.waitForLoad();
    await soMapping.selectMappingFilters(MAPPING_FILTERS);

    for (const activity of TARGET_ACTIVITIES) {
      const value = await soMapping.getServiceOrderValue(activity);
      expect(value).toContain('CHOUHAN');
    }
  });
});
