const { expect } = require("@playwright/test");
const {
  loadTracker, getPendingStepsForActor, setRfiId, setRfiCode, advanceStep,
  markFailed, getLastRejectPage,
} = require("./tracker-utils");
const { openFromPendingWithMe } = require("./rfi-nav");
const { loginAsRole } = require("./helpers");
const DashboardPage    = require("../pages/DashboardPage");
const MyTasksPage      = require("../pages/MyTasksPage");
const RFICreatePage    = require("../pages/RFICreatePage");
const RFIChecklistPage = require("../pages/RFIChecklistPage");
const RFIReviewPage    = require("../pages/RFIReviewPage");

// Shared by BOTH the original pass-chain specs (08/09/10_rfi_flow_*.spec.js,
// one login per pass) AND the single-session spec
// (21_rfi_flow_single_session.spec.js, one login for the whole regression) —
// extracted here so the two run paths can never silently drift apart. Each
// runXTurn() re-reads the tracker itself and processes EVERY step currently
// pending for that actor, exactly once, then returns — the caller decides
// how many times / how often to call it.

// Confirmed live (single-session-login-fix-for-passes branch, NC side —
// see nc-flow-turns.js's identical helper): an actor's very first couple of
// actions right after a fresh login can hit a transient failure unrelated
// to the action itself — the exact same action succeeded immediately after
// for later TCs in the SAME session, consistent with the backend/app still
// settling right after simultaneous role logins. Without a retry,
// markFailed() is PERMANENT — getPendingStepsForActor() skips "failed" TCs
// forever after, so a purely transient hiccup on attempt 1 gets zero
// chances to recover. One retry, after a short pause, absorbs this; a
// genuinely broken action still fails for real on the second attempt.
async function withRetry(action) {
  try {
    return await action();
  } catch (err) {
    await new Promise(resolve => setTimeout(resolve, 3000));
    return await action();
  }
}

// App owner confirmed live (2026-08-19): RFICreatePage.clickProceed()'s
// "already exists for the workSections" rejection is a known symptom of
// cookies not being fully cleared before login — the fix is a fresh
// re-login, not picking a different Work Section. Only retries on that
// specific tagged error (`err.staleWorkSection`, see clickProceed's
// comments); anything else rethrows immediately so this doesn't mask
// unrelated failures. `action` is re-run from scratch after the relogin —
// it must be safe to call again from the top (createNewRfi/resubmitRfi
// both are: they start from My Tasks / the RFI's own row, not from
// mid-form state).
async function withLoginRetryOnStaleWorkSection(page, role, action) {
  try {
    return await action();
  } catch (err) {
    if (!err.staleWorkSection) throw err;
    await loginAsRole(page, role);
    return await action();
  }
}

// Same location/activity data used for all 9 TCs — the versioning/routing
// logic under test doesn't depend on field values, only on reject/approve
// sequencing, so every RFI can share one definition.
const RFI_DATA = {
  workLocation:         'A-06c',
  workArea:             'BL02',
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
  // below), not right here. See DashboardPage/backfillRfiCodes header
  // comments for why (DRAFT-code race).
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
  // whose actual next action is "resubmit" — once an RFI is rejected,
  // /view has no Submit button and no editable fields. The actual editable
  // form only exists at /re-submit, reached from /view via a Resubmit/Edit
  // action on the page itself.
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
  // becomes ARCHIVED. Every step after this one must operate on THIS new
  // id, not the one passed in — the caller saves it back to the tracker.
  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  if (!match) throw new Error(`Could not extract new RFI id after resubmit from URL: ${page.url()}`);

  return { newRfiId: match[1] };
}

// After every create/resubmit this pass is done — still the same CI login
// session, never re-logging in — revisits each one's real data by going to
// the DASHBOARD FIRST, then to its /view page by known UUID, and reads the
// now-finalized visible code (and, for a resubmit, the now-bumped version
// badge) off the page, storing them via setRfiCode. Going through the
// dashboard first is what actually clears the stale/DRAFT state and forces
// a full data refresh.
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
      // whole CI turn being lost over one bad read.
    }
  }
}

// Processes every TC currently pending for CI (create OR resubmit) exactly
// once, then returns. Safe to call repeatedly in a loop — each call re-reads
// the tracker fresh, so it naturally picks up new resubmit work created by
// EE/QI rejections that happened since the last call.
async function runCITurn(page) {
  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "CI");
  const pendingCodeBackfill = [];

  for (const { tcId, tc, step } of myTurns) {
    try {
      await withRetry(async () => {
        if (!tc.rfiId) {
          const rfiId = await withLoginRetryOnStaleWorkSection(page, "CI", () => createNewRfi(page));
          setRfiId(loadTracker(), tcId, rfiId);
          pendingCodeBackfill.push({ tcId, rfiId, isResubmit: false });
          return;
        }

        if (step.action === "resubmit") {
          const lastRejectPage = getLastRejectPage(tc);
          const { newRfiId } = await withLoginRetryOnStaleWorkSection(
            page, "CI", () => resubmitRfi(page, tc.rfiCode, lastRejectPage)
          );
          advanceStep(loadTracker(), tcId, { newRfiId, newRfiCode: null });
          pendingCodeBackfill.push({ tcId, rfiId: newRfiId, isResubmit: true });
        }
      });
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }

  await backfillRfiCodes(page, pendingCodeBackfill);
}

// Processes every TC currently pending for EE (approve OR reject) exactly
// once, then returns. Same re-read-fresh-each-call contract as runCITurn.
async function runEETurn(page) {
  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "EE");

  for (const { tcId, tc, step } of myTurns) {
    try {
      await withRetry(async () => {
        await openFromPendingWithMe(page, tc.rfiCode);
        const review = new RFIReviewPage(page);
        await review.expandAllChecklist();

        if (step.action === "approve") {
          await review.approve();
          advanceStep(loadTracker(), tcId);
        }

        if (step.action === "reject") {
          if (step.page === "P1") {
            await review.rejectFromFirstPage("Automated EE rejection - P1");
          } else {
            await review.rejectFromChecklistPage("Automated EE rejection - checklist");
          }
          advanceStep(loadTracker(), tcId);
        }
      });
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }
}

// Processes every TC currently pending for QI (approve OR reject) exactly
// once, then returns. Same re-read-fresh-each-call contract as runCITurn.
async function runQITurn(page) {
  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "QI");

  for (const { tcId, tc, step } of myTurns) {
    try {
      await withRetry(async () => {
        await openFromPendingWithMe(page, tc.rfiCode);
        const review = new RFIReviewPage(page);
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
      });
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }
}

module.exports = {
  RFI_DATA, createNewRfi, resubmitRfi, backfillRfiCodes,
  runCITurn, runEETurn, runQITurn, withLoginRetryOnStaleWorkSection,
};
