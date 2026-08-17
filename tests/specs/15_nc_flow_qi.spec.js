const { test } = require('@playwright/test');
const {
  loadTracker, getPendingStepsForActor, setNcId, setNcCode, advanceStep, markFailed,
} = require('../utils/nc-tracker-utils');
const { loginAsRole } = require('../utils/helpers');
const { openFromPendingWithMe } = require('../utils/nc-nav');
const DashboardPage = require('../pages/DashboardPage');
const NCCreatePage  = require('../pages/NCCreatePage');
const NCReviewPage  = require('../pages/NCReviewPage');

test.describe.configure({ mode: 'serial' });

// Same field choices already validated in 14_nc_create_qi.spec.js —
// '__first__' for Work Area rather than a hardcoded value (A-06c's list
// doesn't reliably contain any one fixed area, see project_nc_creation_feature
// memory). ncDescription gets a per-TC suffix below for traceability.
//
// workLocation is explicitly 'A-06c' — user-confirmed live: unlike when
// this was last validated, Work Location is NOT pre-populated for QI
// anymore and must be explicitly selected, or every downstream dropdown
// (Work Area, Vendor, Package, Activity, ...) stays empty with nothing to
// pick, which was the actual root cause of every create failing at the
// very first dropdown wait.
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

  // Only the id — the visible code is read later, in one batch, after every
  // TC due this pass has been created (see backfillNcCodes below), not
  // right here. Mirrors RFI's identical DRAFT-placeholder fix (see
  // 08_rfi_flow_ci.spec.js's createNewRfi comment) — reading it
  // immediately after submitting risks capturing a stale placeholder
  // before the app finishes assigning the real code, confirmed live for
  // RFI in a back-to-back creation loop just like this one.
  return match[1];
}

// After every create this pass is done — still the same QI login session,
// never re-logging in — revisits each one's real data by going to the
// DASHBOARD FIRST, then to its /my-tasks/nc/<id> page by known UUID, and
// reads the now-finalized visible code off the page, storing it via
// setNcCode. Mirrors RFI's backfillRfiCodes exactly (see
// 08_rfi_flow_ci.spec.js) — going through the dashboard first, not a
// direct goto straight to the record from wherever the page happens to be,
// is what actually clears the stale/DRAFT state.
async function backfillNcCodes(page, pending) {
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
      // me" lookup fails loudly and diagnosably later, rather than the
      // whole QI pass being lost over one bad read.
    }
  }
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
  const pendingCodeBackfill = [];

  for (const { tcId, tc, step } of myTurns) {
    try {
      if (!tc.ncId) {
        const ncId = await createNewNc(page, tcId);
        setNcId(loadTracker(), tcId, ncId);
        pendingCodeBackfill.push({ tcId, ncId });
        continue;
      }

      // My Tasks -> NC tab -> "Pending with me" -> find row by visible
      // code -> eye icon (see nc-nav.js), instead of a direct page.goto to
      // the NC's URL. By now ncCode is already known — either backfilled
      // just above in this same pass, or by CI's own backfillNcCodes in
      // 16_nc_flow_ci.spec.js after its last resubmit.
      const review = new NCReviewPage(page);
      await openFromPendingWithMe(page, tc.ncCode);

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

  await backfillNcCodes(page, pendingCodeBackfill);
});
