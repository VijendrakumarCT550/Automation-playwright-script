const { test } = require('@playwright/test');
const {
  loadTracker, getPendingStepsForActor, advanceStep, markFailed,
} = require('../utils/nc-tracker-utils');
const { loginAsRole } = require('../utils/helpers');
const NCResponsePage = require('../pages/NCResponsePage');

test.describe.configure({ mode: 'serial' });

// CI's job is the same UI action whether this is the very first response
// (fields empty, both mandatory) or a resubmit after a reject (fields
// pre-filled, modification optional per the app owner) — filling fresh text
// either way satisfies both cases, so "respond" and "resubmit" steps share
// this one handler.
test('CI: submit response / resubmit for every NC whose next step is mine', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  await loginAsRole(page, 'CI');

  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, 'CI');

  for (const { tcId, tc, step } of myTurns) {
    try {
      const response = new NCResponsePage(page);
      await response.goto(tc.ncId);
      await response.fillResponse({
        rootCause: `Automated root cause - ${tcId} (${step.action})`,
        correctiveActions: `Automated corrective actions - ${tcId} (${step.action})`,
      });
      await response.submitResponse();

      // Unconfirmed whether NC resubmission creates a new child id the way
      // RFI's does (see nc-tracker-utils.js's advanceStep comment) — pass
      // through whatever id the URL shows now; if it's unchanged this is a
      // harmless no-op.
      const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
      advanceStep(loadTracker(), tcId, { newNcId: match ? match[1] : undefined });
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }
});
