const {
  loadTracker, getPendingStepsForActor, setNcId, setNcCode, advanceStep, markFailed,
} = require("./nc-tracker-utils");
const { openFromPendingWithMe } = require("./nc-nav");
const DashboardPage  = require("../pages/DashboardPage");
const NCCreatePage   = require("../pages/NCCreatePage");
const NCResponsePage = require("../pages/NCResponsePage");
const NCReviewPage   = require("../pages/NCReviewPage");

// Deliberately a separate file from tests/utils/rfi-flow-turns.js, not a
// shared/reused module — same explicit user instruction to keep NC 100%
// isolated from RFI's files even where the logic looks reusable (see
// NCListPage.js's header comment / project_nc_creation_feature memory).
//
// Shared by BOTH the original NC pass-chain specs (15/16/17_nc_flow_*.spec.js,
// one login per pass) AND 22_nc_flow_single_session.spec.js (one login for
// the whole regression) — extracted here so the two run paths can never
// silently drift apart, mirroring the RFI side's rfi-flow-turns.js in
// structure only, not in code.

// Same field choices already validated in 14_nc_create_qi.spec.js — see
// 15_nc_flow_qi.spec.js's original header comment for why workLocation is
// explicit and workArea stays '__first__'.
const NC_DATA = {
  workLocation:     'A-06c',
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

  // Only the id — the visible code is read later, in one batch (see
  // backfillNcCodesForQI below), not right here. Mirrors RFI's identical
  // DRAFT-placeholder fix.
  return match[1];
}

// QI's create-turn backfill — no version badge read (creation has no prior
// version to bump), unlike CI's respond/resubmit backfill below.
async function backfillNcCodesForQI(page, pending) {
  for (const { tcId, ncId } of pending) {
    try {
      const dashboard = new DashboardPage(page);
      await dashboard.goToDashboard();
      await dashboard.waitForContentOnly();
      await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${ncId}`);
      await page.waitForLoadState('networkidle');
      const code = await new NCReviewPage(page).getVisibleCode().catch(() => null);
      setNcCode(loadTracker(), tcId, code);
    } catch {
      // Best-effort — a miss here just means this TC's next "Pending with
      // me" lookup fails loudly and diagnosably later.
    }
  }
}

// Opens the NC through the UI — My Tasks -> NC tab -> "Pending with me" ->
// find the row by its visible code -> eye icon (see nc-nav.js). Unlike RFI,
// there's no separate /view-vs-/re-submit distinction — NC's response page
// is the SAME /my-tasks/nc/<id> URL for every role/status.
async function respondOrResubmit(page, ncCode, tcId, actionLabel) {
  await openFromPendingWithMe(page, ncCode);

  const response = new NCResponsePage(page);
  await response.fillResponse({
    rootCause: `Automated root cause - ${tcId} (${actionLabel})`,
    correctiveActions: `Automated corrective actions - ${tcId} (${actionLabel})`,
  });
  await response.submitResponse();

  const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
  return match ? match[1] : null;
}

// CI's respond/resubmit-turn backfill — DOES read the version badge, since
// (unlike QI's create) this can be a resubmit bumping the version.
async function backfillNcCodesForCI(page, pending) {
  for (const { tcId, ncId } of pending) {
    try {
      const dashboard = new DashboardPage(page);
      await dashboard.goToDashboard();
      await dashboard.waitForContentOnly();
      await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${ncId}`);
      await page.waitForLoadState('networkidle');
      const response = new NCResponsePage(page);
      const code = await response.getVisibleCode().catch(() => null);
      const version = await response.getVersionBadge().catch(() => null);
      setNcCode(loadTracker(), tcId, code, version);
    } catch {
      // Best-effort — same reasoning as backfillNcCodesForQI.
    }
  }
}

// QI has TWO distinct turns in the NC flow: creating the NC in the first
// place (the reverse of RFI, which CI creates), and reviewing it last each
// round (identical mechanics to EE's review). Processes every TC currently
// pending for QI (create OR approve/reject) exactly once, then returns.
async function runQITurn(page) {
  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "QI");
  const pendingCodeBackfill = [];

  for (const { tcId, tc, step } of myTurns) {
    try {
      if (!tc.ncId) {
        const ncId = await createNewNc(page, tcId);
        setNcId(loadTracker(), tcId, ncId);
        pendingCodeBackfill.push({ tcId, ncId });
        continue;
      }

      const review = new NCReviewPage(page);
      await openFromPendingWithMe(page, tc.ncCode);

      if (step.action === "approve") {
        await review.approve();
        advanceStep(loadTracker(), tcId);
      }

      if (step.action === "reject") {
        await review.reject("Automated QI rejection - issue not properly addressed");
        advanceStep(loadTracker(), tcId);
      }
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }

  await backfillNcCodesForQI(page, pendingCodeBackfill);
}

// CI's job is the same UI action whether this is the very first response or
// a resubmit after a reject — "respond" and "resubmit" steps share this one
// handler. Processes every TC currently pending for CI exactly once.
async function runCITurn(page) {
  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "CI");
  const pendingCodeBackfill = [];

  for (const { tcId, tc, step } of myTurns) {
    try {
      const newNcId = await respondOrResubmit(page, tc.ncCode, tcId, step.action);

      // Resubmitting creates a NEW CHILD RECORD with its OWN id, same as
      // RFI's does. newNcCode deliberately null here — backfillNcCodesForCI
      // below re-reads the real value once this turn's work is all done.
      advanceStep(loadTracker(), tcId, { newNcId, newNcCode: null });
      if (newNcId) pendingCodeBackfill.push({ tcId, ncId: newNcId });
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }

  await backfillNcCodesForCI(page, pendingCodeBackfill);
}

// Processes every TC currently pending for EE (approve OR reject) exactly
// once, then returns.
async function runEETurn(page) {
  const tracker = loadTracker();
  const myTurns = getPendingStepsForActor(tracker, "EE");

  for (const { tcId, tc, step } of myTurns) {
    try {
      await openFromPendingWithMe(page, tc.ncCode);
      const review = new NCReviewPage(page);

      if (step.action === "approve") {
        await review.approve();
        advanceStep(loadTracker(), tcId);
      }

      if (step.action === "reject") {
        await review.reject("Automated EE rejection - formwork not inspected correctly");
        advanceStep(loadTracker(), tcId);
      }
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }
}

module.exports = {
  NC_DATA, createNewNc, respondOrResubmit, backfillNcCodesForQI, backfillNcCodesForCI,
  runQITurn, runCITurn, runEETurn,
};
