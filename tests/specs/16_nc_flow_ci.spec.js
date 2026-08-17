const { test } = require('@playwright/test');
const {
  loadTracker, getPendingStepsForActor, setNcCode, advanceStep, markFailed,
} = require('../utils/nc-tracker-utils');
const { loginAsRole } = require('../utils/helpers');
const { openFromPendingWithMe } = require('../utils/nc-nav');
const DashboardPage   = require('../pages/DashboardPage');
const NCResponsePage  = require('../pages/NCResponsePage');

test.describe.configure({ mode: 'serial' });

// Opens the NC through the UI — My Tasks -> NC tab -> "Pending with me" ->
// find the row by its visible code -> eye icon (see nc-nav.js) — instead of
// a direct page.goto to a known URL. Unlike RFI, there's no separate
// /view-vs-/re-submit distinction to navigate past: NC's response page is
// the SAME /my-tasks/nc/<id> URL for every role/status, and the backend
// renders CI's editable Root Cause/Corrective Actions fields directly
// (confirmed live, see NCResponsePage.js's header comment) — no
// Resubmit/Edit button click needed to unlock editing, whether this is
// CI's very first response or a later resubmit after a reject.
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

// After every respond/resubmit this pass is done — still the same CI login
// session, never re-logging in — revisits each one's real data by going to
// the DASHBOARD FIRST, then to its /my-tasks/nc/<id> page by known UUID,
// and reads the now-finalized visible code (and version badge) off the
// page, storing them via setNcCode. Mirrors RFI's backfillRfiCodes exactly
// (see 08_rfi_flow_ci.spec.js) — both the DRAFT-code race and the
// version-badge lag are the same underlying "read before the app has
// refreshed" problem, and going through the dashboard first is what
// actually clears that stale state.
async function backfillNcCodes(page, pending) {
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
      // Best-effort — a miss here just means this TC's next "Pending with
      // me" lookup fails loudly and diagnosably later, rather than the
      // whole CI pass being lost over one bad read.
    }
  }
}

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
  const pendingCodeBackfill = [];

  for (const { tcId, tc, step } of myTurns) {
    try {
      const newNcId = await respondOrResubmit(page, tc.ncCode, tcId, step.action);

      // Confirmed live (see project_nc_flow_feature memory): resubmitting
      // creates a NEW CHILD RECORD with its OWN id, same as RFI's does —
      // every step after this must operate on THIS new id, not the one
      // passed in. newNcCode deliberately null here — same DRAFT-placeholder
      // race as create; backfillNcCodes below re-reads the real value once
      // this whole pass's respond/resubmit turns are all done.
      advanceStep(loadTracker(), tcId, { newNcId, newNcCode: null });
      if (newNcId) pendingCodeBackfill.push({ tcId, ncId: newNcId });
    } catch (err) {
      markFailed(loadTracker(), tcId, err.message);
    }
  }

  await backfillNcCodes(page, pendingCodeBackfill);
});
