const { test } = require('@playwright/test');
const {
  loadTracker, getPendingStepsForActor, setNcId, advanceStep, markFailed,
} = require('../utils/nc-tracker-utils');
const { loginAsRole } = require('../utils/helpers');
const NCCreatePage = require('../pages/NCCreatePage');
const NCReviewPage = require('../pages/NCReviewPage');

test.describe.configure({ mode: 'serial' });

// Same field choices already validated in 14_nc_create_qi.spec.js —
// '__first__' for Work Area rather than a hardcoded value (A-06c's list
// doesn't reliably contain any one fixed area, see project_nc_creation_feature
// memory). ncDescription gets a per-TC suffix below for traceability.
const NC_DATA = {
  workLocation:     null,
  workArea:         '__first__',
  vendorName:       'CHOUHAN',
  package:          'Civil',
  activity:         'Piling - Robotic Docking System',
  subActivity:      'Piling - Robotic Docking System',
  workSectionCount: 2,
  ncQuantity:       2,
  unit:             'EA',
  defectType:       'Workmanship defect',
  category:         'Critical',
};

async function createNewNc(page, tcId) {
  const ncCreate = new NCCreatePage(page);
  await ncCreate.goto();
  await ncCreate.clickCreateNC();
  await ncCreate.fillForm({ ...NC_DATA, ncDescription: `Automated NC flow - ${tcId}` });
  await ncCreate.submitNC();

  const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
  if (!match) throw new Error(`Could not extract NC id from URL: ${page.url()}`);
  return match[1];
}

// QI has TWO distinct turns in the NC flow: creating the NC in the first
// place (the reverse of RFI, which CI creates), and reviewing it last each
// round (identical mechanics to EE's review — see NCReviewPage). Both live
// in this one spec, mirroring how 08_rfi_flow_ci.spec.js combines CI's
// create-or-resubmit turns into a single file.
test('QI: create pending TCs and review every NC whose next step is mine', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  await loginAsRole(page, 'QI');

  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, 'QI');

  for (const { tcId, tc, step } of myTurns) {
    try {
      if (!tc.ncId) {
        const ncId = await createNewNc(page, tcId);
        setNcId(loadTracker(), tcId, ncId);
        continue;
      }

      const review = new NCReviewPage(page);
      await review.goto(tc.ncId);

      if (step.action === 'approve') {
        await review.approve();
        advanceStep(loadTracker(), tcId);
      }

      if (step.action === 'reject') {
        await review.reject('Automated QI rejection - issue not properly addressed');
        advanceStep(loadTracker(), tcId);
      }
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }
});
