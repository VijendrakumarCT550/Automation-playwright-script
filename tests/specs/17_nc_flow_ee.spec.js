const { test } = require('@playwright/test');
const {
  loadTracker, getPendingStepsForActor, advanceStep, markFailed,
} = require('../utils/nc-tracker-utils');
const { loginAsRole } = require('../utils/helpers');
const NCReviewPage = require('../pages/NCReviewPage');

test.describe.configure({ mode: 'serial' });

test('EE: approve/reject every NC whose next step is mine', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  await loginAsRole(page, 'EE');

  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, 'EE');

  for (const { tcId, tc, step } of myTurns) {
    try {
      const review = new NCReviewPage(page);
      await review.goto(tc.ncId);

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
