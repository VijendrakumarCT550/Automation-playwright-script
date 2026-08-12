const { test } = require('@playwright/test');
const {
  loadTracker, getPendingStepsForActor, advanceStep, markFailed,
} = require('../utils/nc-tracker-utils');
const { loginAsRole } = require('../utils/helpers');
const { openFromPendingWithMe } = require('../utils/nc-nav');
const NCReviewPage = require('../pages/NCReviewPage');

test.describe.configure({ mode: 'serial' });

test('EE: approve/reject every NC whose next step is mine', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  await loginAsRole(page, 'EE');

  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, 'EE');

  for (const { tcId, tc, step } of myTurns) {
    try {
      // My Tasks -> NC tab -> "Pending with me" -> find row by visible
      // code -> eye icon (see nc-nav.js), instead of a direct page.goto to
      // the NC's URL. ncCode is already known by now — CI's own
      // backfillNcCodes (see 16_nc_flow_ci.spec.js) reads it right after
      // every respond/resubmit, in the same CI session, before EE's turn
      // ever starts. EE never reads or guesses at the code itself, same as
      // RFI's EE spec.
      await openFromPendingWithMe(page, tc.ncCode);
      const review = new NCReviewPage(page);

      if (step.action === 'approve') {
        await review.approve();
        advanceStep(loadTracker(), tcId);
      }

      if (step.action === 'reject') {
        await review.reject('Automated EE rejection - formwork not inspected correctly');
        advanceStep(loadTracker(), tcId);
      }
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }
});
