const { test, expect } = require("@playwright/test");
const {
  loadTracker, getPendingStepsForActor, setRfiId, advanceStep, markFailed, getLastRejectPage,
} = require("../utils/tracker-utils");
const { loginAsRole } = require("../utils/helpers");
const MyTasksPage      = require("../pages/MyTasksPage");
const RFICreatePage    = require("../pages/RFICreatePage");
const RFIChecklistPage = require("../pages/RFIChecklistPage");

test.describe.configure({ mode: "serial" });

// Same location/activity data used for all 9 TCs — the versioning/routing
// logic under test doesn't depend on field values, only on reject/approve
// sequencing, so every RFI can share one definition.
const RFI_DATA = {
  workLocation:         'A-06c',
  workArea:             'BL01',
  package:              'Civil',
  subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
  activity:             'Piling - MMS',
  subActivity:          'Piling - MMS',
  rfiQuantity:          null,
  unit:                 null,
  subContractor:        null,
  inspectionCheckpoint: 'Pre Pour Inspection - Pile',
  inspectionChecklist:  'Micro Pile Checklist',
};

async function createNewRfi(page) {
  // Reset to a clean My Tasks state, cancelling any auto-resumed draft from
  // a previous TC's iteration (same defensive pattern as 03_rfi_bulk_create.spec.js).
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(300);
    if (!page.url().includes('/create')) break;
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(300);
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

  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  if (!match) throw new Error(`Could not extract RFI id from URL: ${page.url()}`);
  return match[1];
}

// Direct URL navigation instead of finding the row in "Pending with me" and
// clicking its eye icon — simpler and avoids depending on table sort/scroll.
//
// MUST be /re-submit, not /view — user-confirmed live: once an RFI is
// rejected, /view is read-only (no Submit button, form fields not editable)
// and only /re-submit is the actual editable resubmission form. This
// function is only ever called for a step whose action is "resubmit" (i.e.
// only after a reject already happened), so /re-submit is always correct
// here — confirmed this was the root cause of every CI-resubmit timeout
// waiting on the Work Location combobox (it simply never appears on /view).
async function resubmitRfi(page, rfiId, lastRejectPage) {
  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/re-submit`);
  await page.waitForLoadState('networkidle');

  const rfiCreate = new RFICreatePage(page);
  const locked = await rfiCreate.isFirstPageLocked();
  if (lastRejectPage === 'P1') {
    expect(locked, 'Page 1 should be editable after a Page-1 rejection').toBe(false);
  } else {
    expect(locked, 'Page 1 should be locked after a checklist-page rejection').toBe(true);
  }

  await rfiCreate.clickProceed();

  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations('OK - as per standard', true);
  await checklist.submitRFI();

  // Resubmitting creates a NEW CHILD RECORD with its OWN id — the original
  // id becomes ARCHIVED (user-confirmed live: visible in the app as the
  // previous RFI code permanently showing "Rejected", while a new RFI code
  // carries the live version forward). Every step after this one (EE/QI
  // review, or a further resubmit) must operate on THIS new id, not the one
  // passed in — the caller is responsible for saving it back to the tracker.
  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  if (!match) throw new Error(`Could not extract new RFI id after resubmit from URL: ${page.url()}`);

  return { newRfiId: match[1], version: await checklist.getVersionBadge() };
}

test("CI: create pending TCs and resubmit rejected RFIs", async ({ page }) => {
  // Up to 9 RFI creations/resubmissions in one session — each is a multi-step
  // form fill + checklist submit (~2-3 min), well over the default 10min.
  test.setTimeout(60 * 60 * 1000);
  await loginAsRole(page, "CI");

  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "CI");

  for (const { tcId, tc, step } of myTurns) {
    try {
      if (!tc.rfiId) {
        const rfiId = await createNewRfi(page);
        setRfiId(loadTracker(), tcId, rfiId);
        continue;
      }

      if (step.action === "resubmit") {
        const lastRejectPage = getLastRejectPage(tc);
        const { newRfiId, version } = await resubmitRfi(page, tc.rfiId, lastRejectPage);
        advanceStep(loadTracker(), tcId, { newVersion: version, newRfiId });
      }
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }
});
