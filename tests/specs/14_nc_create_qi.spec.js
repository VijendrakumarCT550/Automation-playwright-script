const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const NCCreatePage = require('../pages/NCCreatePage');

// NC Quantity/UOM rule (per app owner): both required UNLESS the selected
// Unit is "Not Applicable (NA)", in which case NC Quantity is not required.
const NC_DATA = {
  workLocation:     null, // pre-populated to A-06c on form open for this QI — no interaction needed
  // '__first__' rather than a hardcoded 'BL01' — confirmed live that A-06c's
  // Work Area list for NC creation doesn't start at BL01 (BL06 was first),
  // so specific area names aren't reliably present; any valid area works
  // equally well for exercising NC creation itself.
  workArea:         '__first__',
  vendorName:       'CHOUHAN',
  package:          'Civil',
  activity:         'Piling - Robotic Docking System',
  subActivity:      'Piling - Robotic Docking System',
  workSectionCount: 2,
  ncQuantity:       2,
  unit:             'EA',
  ncDescription:    'Automated NC creation - regression test',
  defectType:       'Workmanship defect',
  category:         'Critical',
};

// NC creation is done by the Quality Inspector (QI role) — the reverse of
// RFI, which CI creates. This spec covers creation only; the CI
// corrective-action/resubmit + EE/QI review flow is separate, upcoming work.
test('QI can create a new NC', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await loginAsRole(page, 'QI');

  const ncCreate = new NCCreatePage(page);
  await ncCreate.goto();
  await ncCreate.clickCreateNC();
  await ncCreate.fillForm(NC_DATA);
  await ncCreate.submitNC();
  console.log(`NC post-submit URL: ${page.url()}`);

  const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
  expect(match, `Could not extract NC id from URL: ${page.url()}`).toBeTruthy();

  const version = await ncCreate.getVersionBadge();
  expect(version.toLowerCase()).toBe('v1');
});
