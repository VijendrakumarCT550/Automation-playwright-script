const { test } = require("@playwright/test");
const {
  loadTracker, getPendingStepsForActor, advanceStep, markFailed,
} = require("../utils/tracker-utils");
const { loginAsRole } = require("../utils/helpers");
const RFIReviewPage = require("../pages/RFIReviewPage");

test.describe.configure({ mode: "serial" });

test("QI: approve/reject every RFI whose next step is mine", async ({ page }) => {
  test.setTimeout(45 * 60 * 1000);
  await loginAsRole(page, "QI");

  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "QI");

  for (const { tcId, tc, step } of myTurns) {
    try {
      const review = new RFIReviewPage(page);
      await review.goto(tc.rfiId);
      await review.expandAllChecklist();

      if (step.action === "approve") {
        await review.approve();
        // QI approving is the final step — capture the version for the
        // tracker record even though approval itself doesn't change it.
        const newVersion = await review.getVersionBadge();
        advanceStep(loadTracker(), tcId, { newVersion });
      }

      if (step.action === "reject") {
        if (step.page === "P1") {
          await review.rejectFromFirstPage("Automated QI rejection - P1");
        } else {
          await review.rejectFromChecklistPage("Automated QI rejection - checklist");
        }
        advanceStep(loadTracker(), tcId);
      }
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }
});
