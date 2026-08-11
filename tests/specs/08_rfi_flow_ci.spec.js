const { test, expect } = require("@playwright/test");
const {
  loadTracker, getPendingStepsForActor, setRfiId, setRfiCode, advanceStep, markFailed, getLastRejectPage,
} = require("../utils/tracker-utils");
const { loginAsRole } = require("../utils/helpers");
const { openFromPendingWithMe } = require("../utils/rfi-nav");
const DashboardPage    = require("../pages/DashboardPage");
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

  // Only the id — the visible code is read later, in one batch, after every
  // TC due this pass has been created/resubmitted (see backfillRfiCodes
  // below), not right here. User-confirmed live: reading it immediately
  // after submitting can capture a "RFI-...-CIV-DRAFT" placeholder because
  // the app hasn't finished assigning the real code yet — happened for
  // EVERY TC in a back-to-back creation loop, not just occasionally.
  return match[1];
}

// Opens the rejected RFI through the UI — My Tasks -> "Pending with me" ->
// find the row by its visible code -> eye icon (see rfi-nav.js) — instead of
// a direct page.goto to a known URL. rfiCode is expected to already be
// known: backfillRfiCodes (below) fills it in right after every
// create/resubmit in this same CI session, before this is ever called for
// a later resubmit.
async function resubmitRfi(page, rfiCode, lastRejectPage) {
  await openFromPendingWithMe(page, rfiCode);

  // That eye icon always lands on the read-only /view page, even for a row
  // whose actual next action is "resubmit" — user-confirmed live: once an
  // RFI is rejected, /view has no Submit button and no editable fields. The
  // actual editable form only exists at /re-submit, reached from /view via
  // a Resubmit/Edit action on the page itself — confirmed this
  // /view-vs-/re-submit distinction was the root cause of every CI-resubmit
  // timeout waiting on the Work Location combobox (it simply never appears
  // on /view).
  if (!page.url().includes('/re-submit')) {
    const resubmitButton = page.getByRole('button', { name: /resubmit|edit/i }).first();
    await resubmitButton.waitFor({ state: 'visible', timeout: 15000 });
    await resubmitButton.click();
    await page.waitForLoadState('networkidle');
  }

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
  // becomes ARCHIVED (user-confirmed live: visible in the app as the
  // previous RFI code permanently showing "Rejected"). The visible CODE
  // does NOT necessarily change along with it, though — confirmed live:
  // it stayed identical across a resubmit that didn't touch any Page-1
  // field data, and only changes "in some cases... with some data change
  // in RFI first page details" (direct user confirmation). So the code
  // must always be freshly read from the app after every resubmit, never
  // assumed to match (or differ from) the pre-resubmit value. Every step
  // after this one must operate on THIS new id, not the one passed in —
  // the caller saves it back to the tracker. The new code AND the bumped
  // version badge are both read later, in backfillRfiCodes, NOT right here
  // — reading getVersionBadge() immediately after submitRFI() hits the
  // exact same async-lag problem as the code itself: the badge can still
  // show the OLD version (vN) for a moment before updating to vN+1
  // (user-confirmed live via tracker inspection: every resubmitted TC
  // stayed at "v1" instead of bumping to "v2" when read this early).
  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  if (!match) throw new Error(`Could not extract new RFI id after resubmit from URL: ${page.url()}`);

  return { newRfiId: match[1] };
}

// After every create/resubmit this pass is done — still the same CI login
// session, never re-logging in — revisits each one's real data by going to
// the DASHBOARD FIRST, then to its /view page by known UUID, and reads the
// now-finalized visible code (and, for a resubmit, the now-bumped version
// badge) off the page, storing them via setRfiCode.
//
// Going through the dashboard first (not a direct goto straight to /view
// from wherever the page happens to be) matters — user-confirmed live:
// this is what actually clears the stale/DRAFT state and forces a full
// data refresh; a direct goto to /view alone was what kept reading the
// "RFI-...-CIV-DRAFT" placeholder instead of the real numeric code. Same
// fix covers the version-badge lag (see resubmitRfi's comment) — both were
// the same underlying "read before the app has refreshed" problem.
async function backfillRfiCodes(page, pending) {
  for (const { tcId, rfiId, isResubmit } of pending) {
    try {
      const dashboard = new DashboardPage(page);
      await dashboard.goToDashboard();
      await dashboard.waitForContentOnly();
      await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/view`);
      await page.waitForLoadState('networkidle');
      const checklist = new RFIChecklistPage(page);
      const code = await checklist.getVisibleCode().catch(() => null);
      const version = isResubmit ? await checklist.getVersionBadge().catch(() => null) : null;
      setRfiCode(loadTracker(), tcId, code, version);
    } catch {
      // Best-effort — a miss here just means this TC's next "Pending with
      // me" lookup fails loudly and diagnosably later, rather than the
      // whole CI pass being lost over one bad read.
    }
  }
}

test("CI: create pending TCs and resubmit rejected RFIs", async ({ page }) => {
  // Up to 9 RFI creations/resubmissions in one session — each is a multi-step
  // form fill + checklist submit (~2-3 min), well over the default 10min.
  test.setTimeout(60 * 60 * 1000);
  await loginAsRole(page, "CI");

  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "CI");
  const pendingCodeBackfill = [];

  for (const { tcId, tc, step } of myTurns) {
    try {
      if (!tc.rfiId) {
        const rfiId = await createNewRfi(page);
        setRfiId(loadTracker(), tcId, rfiId);
        pendingCodeBackfill.push({ tcId, rfiId, isResubmit: false });
        continue;
      }

      if (step.action === "resubmit") {
        const lastRejectPage = getLastRejectPage(tc);
        const { newRfiId } = await resubmitRfi(page, tc.rfiCode, lastRejectPage);
        advanceStep(loadTracker(), tcId, { newRfiId, newRfiCode: null });
        pendingCodeBackfill.push({ tcId, rfiId: newRfiId, isResubmit: true });
      }
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }

  await backfillRfiCodes(page, pendingCodeBackfill);
});
