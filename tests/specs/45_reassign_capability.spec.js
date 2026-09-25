const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { fleetFor } = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const ReassignPage = require('../pages/ReassignPage');
const DashboardPage = require('../pages/DashboardPage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// ===========================================================================
// FAMILY C — CAN A REASSIGNED USER ACTUALLY DO THE WORK?
// (docs/reassignment-scenarios.md, Family C — "the most important family")
// ===========================================================================
// Family E proved that ELIGIBILITY IGNORES WAM: a candidate with no mapping at
// all is offered in the "Assign to" list. Being offered is not being able to
// work. This file asks the other half, and it is the half that can strand a
// record: the RFI has left its old assignee, and if the new one cannot act on
// it, nobody can.
//
// THE EXPECTED OUTCOME IS STATED, NOT OPEN (section 1.2 rule 3, from the app
// owner): a reassigned user can resubmit or review IRRESPECTIVE OF WAM. So
// every case here should pass. That does not make them cheap — it makes this a
// regression test of an explicit requirement, and the only place a stranding
// bug could surface.
//
// WHAT "CAN DO THE WORK" MEANS, CONCRETELY. Not "the page loaded". On a
// resubmit, page 1 is rebuilt from the logged-in user's WAM, so an unmapped CI
// can land on a form that exists, is editable, and CANNOT DESCRIBE ITS OWN RFI
// — every cascading dropdown blank, no error, no toast. That is a healthy
// looking page and a stranded record. So each case asserts three things in
// order: the record REACHES the new assignee's queue, the form still CARRIES
// ITS OWN DATA (RFICreatePage.readFirstPageValues), and the step COMPLETES.
//
// EACH CASE OWNS ITS RECORD, from the pool built by
// 42_reassign_rfi_records_setup. A reassignment cannot be undone from the UI,
// so a shared record would make the second case depend on whether the first
// ran.
//
// THIS SPEC MUTATES: it rejects records, reassigns them, and resubmits them.
// That is the behaviour under test, and it is why the pool exists.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/45_reassign_capability.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const RFI_PENDING_OTHERS = '/my-tasks/rfi/list/pending-with-others';
const RFI_PENDING_ME = '/my-tasks/rfi/list/pending-with-me';

// The CI cases. Each needs its RFI REJECTED first, because a CI's step is the
// resubmit — there is nothing for a CI to do on an RFI that is pending review.
const CI_CASES = [
  {
    id: 'C2',
    recordKey: 'C_CI_UNMAPPED',
    candidate: 'CI_A',
    why: 'no WAM at all — the init-only state the app owner confirmed is assignable',
  },
  {
    id: 'C3',
    recordKey: 'C_CI_FOREIGN',
    candidate: 'CI_B',
    why: 'every mapping is in the OTHER work location and package (S05b/Electrical), ' +
      'so a form re-derived from WAM could not describe this RFI at all',
  },
];

let browser, context, page, fleet;
const findings = [];

function note(msg) {
  findings.push(msg);
  console.log(`  ${msg}`);
}

function firstLine(err) {
  return String((err && err.message) || err || '').split(/\r?\n/)[0];
}


// EVERY ROLE SWITCH GETS A BRAND-NEW BROWSER CONTEXT.
//
// Reusing one context across logins reads — and acts on — the wrong data in
// this app, reproducibly. Live on pulse-test 2026-09-20: after a few switches,
// EE_D's "Pending with me" returned exactly ONE row (the record the previous
// test had just touched) while a fresh context logged in as the same user
// returned all SEVEN. It is not only a reading problem: the missing row cannot
// be CLICKED either, so the session cannot do the work at all.
//
// loginAsFlowUser already clears cookies and localStorage (the standing PULSE
// login rule), and a dashboard-first refresh did not help — so whatever holds
// the stale view survives both. A new context is the one condition under which
// this queue is known to read correctly, and a login costs the same either way.
//
// This also removes a whole class of cross-login bleed from a spec that logs in
// as five different people: nothing any actor did to their session can reach
// the next one.
async function actAs(email) {
  if (context) await context.close().catch(() => {});
  context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();
  await loginAsFlowUser(page, email, PASSWORD);
  return page;
}

async function actAsAdmin() {
  if (context) await context.close().catch(() => {});
  context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();
  await loginAsFlowUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, {
    navigateToMyTasks: false,
  });
  return page;
}

// Reassigns one role on a record, as Admin, and proves the grid took it.
async function reassignAs(recordCode, type, newAssigneeName) {
  await actAsAdmin();
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();
  const row = await reassign.scrollToRowById(recordCode);

  await reassign.openReassign(row);
  await reassign.selectAssigneeType(type);
  const before = await reassign.getCurrentAssigneeName().catch(() => null);

  // ALREADY THERE? Then there is nothing to do, and trying anyway FAILS — the
  // app never offers the current assignee in its own "Assign to" list (rule
  // E1, asserted by 41_reassign_eligibility). Live on pulse-test 2026-09-20:
  // a re-run of C2 found the record back with its EE after the previous run's
  // resubmit, rejected it, and then waited 15s for a name the list correctly
  // refused to show — because that name was already the record's CI.
  //
  // So this is the app being right and the prep being wrong. Treat "already
  // assigned to the target" as the precondition being met.
  if (before && before.trim() === String(newAssigneeName).trim()) {
    note(`${recordCode} ${type} is already "${newAssigneeName}" — no reassignment needed`);
    await reassign.closeButton.click().catch(() => {});
    return before;
  }

  await reassign.selectNewAssignee(newAssigneeName);
  await reassign.submitAssignUser();

  note(`reassigned ${recordCode} ${type}: "${before}" -> "${newAssigneeName}"`);
  return before;
}

// Is the record in this user's "Pending with me"?
//
// "Pending with me" is a CI/EE/QI queue — those are the roles that HOLD a
// record. Admin has no such list at all, so never ask this as Admin; read
// "Pending with others" instead.
//
// POLLED, AND SCROLLED, because every wrong answer this helper can give is
// expensive. A false "absent" reads as the STRAND this whole family is hunting
// — the most damaging wrong answer available here — and there are two separate
// ways to get one:
//
//   1. The grid virtualises vertically, so a single read sees only mounted
//      rows (hence collectAllRowIds).
//   2. THE GRID FILLS IN AFTER IT FIRST RENDERS. Live on pulse-test
//      2026-09-20: C3 read EE_D's queue, saw ONE row, and declared
//      RFI-A-06c-BL07-CIV-35 missing — while Admin's own list showed that
//      record as "In-Review (EE)" with EE_D, exactly where it belonged. The
//      grid simply had not finished loading. networkidle did not cover it.
//
// So: re-read until the record appears, or until the row count stops growing
// across consecutive passes. Absence is only reported once it has outlasted
// the loading, which is the same discipline the RFI-queue timing note in
// docs/automation-coverage-and-gaps.md section 2b already demands.
async function isInPendingWithMe(recordCode, email, { attempts = 5, settleMs = 2500 } = {}) {
  let best = [];

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    // THROUGH THE DASHBOARD FIRST. This is a PWA, and after a login switch
    // inside one browser context it will serve the PREVIOUS user's cached
    // list — clearing cookies and localStorage does not touch that cache.
    //
    // Live on pulse-test 2026-09-20, and it is worth stating precisely because
    // it masqueraded as an app bug twice: reading EE_D's queue straight after
    // C2 returned exactly ONE row, CIV-34 — which is what CI_A, the login
    // immediately before, had in THEIR queue. A fresh session read all seven.
    // So the list was not short, and not still loading; it belonged to someone
    // else.
    //
    // rfi-dependency-flow's getVisibleCodeFor and rfi-flow-turns' backfill
    // already use this same dashboard-first hop for the same reason: it is what
    // actually clears the stale state and forces a full refresh.
    const dashboard = new DashboardPage(page);
    await dashboard.goToDashboard().catch(() => {});
    await dashboard.waitForContentOnly().catch(() => {});

    await page.goto(`${process.env.BASE_URL}${RFI_PENDING_ME}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const reassign = new ReassignPage(page);
    const hasGrid = await reassign.waitForGrid().then(() => true).catch(() => false);
    if (hasGrid) {
      const all = await reassign.collectAllRowIds();
      if (all.includes(recordCode)) return { present: true, seen: all, attempts: attempt };
      // Keep the fullest view seen, so the failure message reports the real
      // size of the list rather than whichever pass happened to be last.
      if (all.length > best.length) {
        best = all;
        await page.waitForTimeout(settleMs);
        continue;   // the list is still growing — do not conclude yet
      }
    }
    if (attempt < attempts) await page.waitForTimeout(settleMs);
  }

  // STILL ABSENT? Do not believe it yet — CONFIRM IN A FRESH BROWSER CONTEXT.
  //
  // A long-lived context that has switched logins several times reads this
  // queue wrongly, and reproducibly so. Live on pulse-test 2026-09-20: as
  // EE_D, five polled reads inside a running spec returned exactly ONE row —
  // the record the previous test had just touched — while a brand-new context
  // logged in as the same user returned all SEVEN, including the one the spec
  // had just declared missing. Neither clearing cookies and localStorage (which
  // loginAsFlowUser already does) nor a dashboard-first refresh changed it.
  //
  // The cause is not understood, and that is exactly why this exists rather
  // than a wait: an unexplained artefact that manufactures FALSE ABSENCES sits
  // on top of the one conclusion this family must never get wrong — "the record
  // has left its old assignee and the new one cannot see it". A fresh context
  // is the condition under which this queue is known to read correctly, so a
  // strand is only ever reported when BOTH agree.
  const fresh = await page.context().browser().newContext();
  try {
    const freshPage = await fresh.newPage();
    await loginAsFlowUser(freshPage, email, PASSWORD);
    await freshPage.goto(`${process.env.BASE_URL}${RFI_PENDING_ME}`);
    await freshPage.waitForLoadState('networkidle').catch(() => {});

    const freshGrid = new ReassignPage(freshPage);
    const ok = await freshGrid.waitForGrid().then(() => true).catch(() => false);
    if (ok) {
      const all = await freshGrid.collectAllRowIds();
      if (all.includes(recordCode)) {
        note(`${recordCode}: NOT seen in the running session (${best.length} rows) but PRESENT in a ` +
          `fresh one (${all.length} rows) — session artefact, not a strand`);
        return { present: true, seen: all, attempts, viaFreshContext: true };
      }
      if (all.length > best.length) best = all;
    }
  } finally {
    await fresh.close().catch(() => {});
  }

  return { present: false, seen: best, attempts, confirmedFresh: true };
}

test.beforeAll(async ({ browser: b }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  browser = b;   // contexts are created per login by actAs()

  console.log(
    `\n=== Family C — capability after reassignment, on ${process.env.BASE_URL} ===\n` +
    `    expected outcome: EVERY case passes — a reassigned user may act irrespective of WAM\n`
  );
});

test.afterAll(async () => {
  console.log('\n--- Family C findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (context) await context.close();
});

// --- C2 / C3: can a reassigned CI resubmit? --------------------------------
for (const { id, recordKey, candidate, why } of CI_CASES) {
  test(`${id}: a CI with ${candidate === 'CI_A' ? 'NO WAM' : 'foreign WAM'} can resubmit a record reassigned to them`, async () => {
    test.setTimeout(30 * 60 * 1000);

    const record = claimRecord('rfi', recordKey);
    const newCi = fleet[candidate];
    expect(newCi && newCi.name, `${candidate} must be in the fleet`).toBeTruthy();
    note(`${id}: ${record.code} -> ${candidate} (${newCi.name}) — ${why}`);

    // --- 1-3. Get the record into "rejected, and held by the candidate" ----
    //
    // CONDITIONAL, BECAUSE THIS SPEC MUTATES AND MUST STILL BE RE-RUNNABLE. An
    // earlier run may have already rejected and reassigned this record; redoing
    // either step would then fail against a state that is already correct —
    // the reject because the record is no longer with the EE, the reassign
    // because the candidate is already the current assignee. A mutating spec
    // that can only ever run once against fresh ground is a spec nobody dares
    // re-run.
    await actAs(newCi.email);
    let queue = await isInPendingWithMe(record.code, newCi.email);

    if (queue.present) {
      note(`${id}: ${record.code} is already with ${candidate} — prepared by an earlier run`);
    } else {
      // Reject it as the record's CURRENT EE (the fleet's control arm,
      // snapshotted from BL07's WAM at creation). A PAGE-1 rejection is
      // deliberate: it leaves page 1 EDITABLE on the resubmit, which is what
      // exposes whether the form can still describe the RFI for a user mapped
      // elsewhere. A checklist rejection locks page 1 and would hide the very
      // thing under test.
      const ee = fleet.EE_D;
      expect(ee && ee.email, "EE_D (the record's EE) must be in the fleet").toBeTruthy();
      await actAs(ee.email);

      const onEeQueue = await isInPendingWithMe(record.code, ee.email);
      expect(
        onEeQueue.present,
        `${id}: ${record.code} is with neither ${candidate} nor its EE (${onEeQueue.seen.length} rows ` +
        `scanned as EE_D), so this case cannot set up its own precondition. An earlier run may have ` +
        `left it mid-flow — check the record in the app before re-running.`
      ).toBeTruthy();

      await openFromPendingWithMe(page, record.code, `${id} / EE_D reject`);
      const review = new RFIReviewPage(page);
      await review.rejectFromFirstPage(`Family C ${id} — rejected to create a CI step`);
      note(`${id}: EE_D rejected ${record.code} from page 1`);

      const previousCi = await reassignAs(record.code, 'Contractor Incharge', newCi.name);
      expect(
        previousCi,
        `${id}: the modal should have shown a current Contractor Incharge before the swap`
      ).toBeTruthy();

      // Does it REACH the new assignee? A false "absent" here would read as the
      // strand this family hunts, so isInPendingWithMe scrolls the whole list.
      await actAs(newCi.email);
      queue = await isInPendingWithMe(record.code, newCi.email);
      expect(
        queue.present,
        `${id}: STRANDED — ${record.code} was reassigned to ${candidate} (${newCi.name}) but does not ` +
        `appear in their "Pending with me" (${queue.seen.length} rows scanned). The record has left its ` +
        `previous CI and the new one cannot see it.`
      ).toBeTruthy();
      note(`${id}: ${record.code} reached ${candidate}'s queue`);
    }

    // --- 4. Does the form still carry its own data? ------------------------
    // THROUGH THE UI — My Tasks -> Pending with me -> the row's eye icon — not
    // by URL. A REJECTED row's eye icon lands STRAIGHT ON /re-submit, with the
    // editable form already open; there is no Resubmit button to click because
    // /view is never visited.
    //
    // Reaching /view by URL instead gives the READ-ONLY page, whose only action
    // is "Close". On 2026-09-20 that cost a false stranding report: this case
    // failed waiting 20s for a Resubmit button, on a page the real flow never
    // opens. See 00_inspect_resubmit_affordance.spec.js, which held the
    // navigation constant and varied only the user to settle it.
    await openFromPendingWithMe(page, record.code, `${id} / ${candidate} resubmit`);

    if (!page.url().includes('/re-submit')) {
      const resubmitButton = page.getByRole('button', { name: /resubmit|edit/i }).first();
      await resubmitButton.waitFor({ state: 'visible', timeout: 20000 });
      await resubmitButton.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    expect(
      page.url(),
      `${id}: expected the editable resubmit form, got ${page.url()}`
    ).toContain('/re-submit');

    const rfiCreate = new RFICreatePage(page);
    const locked = await rfiCreate.isFirstPageLocked();
    expect(locked, `${id}: page 1 should be editable after a page-1 rejection`).toBe(false);

    const values = await rfiCreate.readFirstPageValues();
    note(`${id}: page 1 reads ${JSON.stringify(values)}`);

    // THE HEART OF THE FAMILY. The form is rebuilt from the logged-in user's
    // WAM, and this user is mapped nowhere near this record — so if the app
    // derives the form from WAM rather than from the RECORD, these come back
    // blank or as placeholders while the page looks perfectly healthy.
    for (const field of ['workLocation', 'workArea', 'package', 'activity']) {
      const shown = values[field];
      expect(
        shown && !/^select\b/i.test(shown),
        `${id}: page 1's "${field}" does not describe the RFI for ${candidate} — it reads ` +
        `${JSON.stringify(shown)}. The record is ${record.code} on ` +
        `${record.ground.workLocation}/${record.ground.package}/${record.ground.workArea}. ` +
        `A form that cannot state its own RFI's work location cannot be resubmitted, which ` +
        `would strand the record with an assignee who is allowed to hold it but unable to act.`
      ).toBeTruthy();
    }
    expect(
      values.workLocation,
      `${id}: page 1 shows work location ${JSON.stringify(values.workLocation)}, but the record ` +
      `lives on ${record.ground.workLocation}`
    ).toContain(record.ground.workLocation);

    // --- 5. Does the step COMPLETE? ----------------------------------------
    await rfiCreate.clickProceed();
    const checklist = new RFIChecklistPage(page);
    await checklist.fillAllObservations('OK - as per standard', true);
    await checklist.submitRFI();

    // confirmSubmit only returns once the app reaches /rfi/<id>/view, the one
    // reliable completion signal for a resubmit — reaching here IS the pass.
    // Resubmitting creates a NEW CHILD RECORD with its own id; the code stays
    // the same unless work location / work area / package changed, which is
    // why every later step can still address it by code.
    const match = page.url().match(/\/rfi\/([a-f0-9-]+)\/view/i);
    expect(match, `${id}: no /view URL after resubmit — got ${page.url()}`).toBeTruthy();
    note(`${id}: PASS — ${candidate} resubmitted ${record.code} (new child id ${match[1]})`);
  });
}

// --- C5: can a reassigned EE review? ---------------------------------------
test('C5: an EE with NO WAM can review a record reassigned to them', async () => {
  test.setTimeout(30 * 60 * 1000);

  const record = claimRecord('rfi', 'C_EE_UNMAPPED');
  const newEe = fleet.EE_A;
  expect(newEe && newEe.name, 'EE_A must be in the fleet').toBeTruthy();
  note(`C5: ${record.code} -> EE_A (${newEe.name}) — init-only, no WAM anywhere`);

  // No rejection needed: a freshly raised RFI is already pending with its EE,
  // so the EE's own step — the review — is available immediately.
  const previousEe = await reassignAs(record.code, 'Execution Engineer', newEe.name);
  expect(previousEe, 'the modal should have shown a current Execution Engineer').toBeTruthy();

  await actAs(newEe.email);
  const queue = await isInPendingWithMe(record.code, newEe.email);
  expect(
    queue.present,
    `C5: STRANDED — ${record.code} was reassigned to EE_A (${newEe.name}) but is not in their ` +
    `"Pending with me" (${queue.seen.length} rows scanned).`
  ).toBeTruthy();
  note(`C5: ${record.code} reached EE_A's queue`);

  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${record.id}/view`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const review = new RFIReviewPage(page);
  await review.expandAllChecklist();
  await review.approve();
  note('C5: PASS — EE_A approved the record');
});
