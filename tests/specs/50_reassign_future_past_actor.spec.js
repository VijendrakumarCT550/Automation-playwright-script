const { test, expect } = require('@playwright/test');
const { fleetFor } = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const {
  TYPE, rfiQueueHas, readAssignee, reassignRfi, openAs, expectHandOff,
} = require('../utils/reassign-rfi-ops');
const RFIReviewPage = require('../pages/RFIReviewPage');

// ===========================================================================
// FAMILY H, rows H2 and H3 — reassigning a role that is NOT the current actor.
// (docs/reassignment-scenarios.md, Family H)
// ===========================================================================
// H1 (46) reassigned the role holding the record RIGHT NOW. The two harder
// cases reassign someone whose turn is in the FUTURE or already PAST — the
// swap then has to be remembered by the record and honoured later, at a moment
// nobody is watching:
//
//   H2  FUTURE actor: the RFI is with its EE; reassign its QI. Nothing visible
//       happens yet — the record must NOT appear in the new QI's queue while
//       it is still with the EE — and once the EE approves it must arrive with
//       the NEW QI and never with the old one.
//   H3  PAST actor: the RFI is with its QI (the CI's turn is over); reassign
//       its CI. When the QI then rejects, the rejection must land on the NEW
//       CI — and the new CI must be able to open the resubmit form.
//
// A failure in either is a routing defect of the worst kind: work silently
// delivered to someone who was explicitly taken off it.
//
// EACH CASE OWNS ITS POOL RECORD (42_reassign_rfi_records_setup: H_FUTURE_QI,
// H_PAST_CI). Both are RE-RUNNABLE: each test first works out where its record
// already is and resumes from there, because a reassignment cannot be undone.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/50_reassign_future_past_actor.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

let sessions, fleet;
const findings = [];
function note(msg) { findings.push(msg); console.log(`  ${msg}`); }

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  for (const k of ['CI_A', 'CI_C', 'EE_D', 'QI_A', 'QI_D']) {
    expect(fleet[k] && fleet[k].email, `${k} must be in the fleet for this deployment`).toBeTruthy();
  }
  sessions = createSessionFactory(browser, { log: () => {} });
  console.log(`\n=== Family H2 / H3 — future and past actors, on ${process.env.BASE_URL} ===\n`);
});

test.afterAll(async () => {
  console.log('\n--- H2 / H3 findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- H2: a FUTURE actor ------------------------------------------------------
test('H2: reassigning the QI while the RFI is with its EE takes effect when it reaches QI', async () => {
  test.setTimeout(40 * 60 * 1000);

  const record = claimRecord('rfi', 'H_FUTURE_QI');
  const ee = fleet.EE_D;
  const oldQi = fleet.QI_D;      // snapshotted from BL07's WAM at creation
  const newQi = fleet.QI_A;      // init-only — Family C already proved it can work
  note(`H2: ${record.code} — reassign its QI "${oldQi.name}" -> "${newQi.name}" while it is with EE`);

  const withEe = await rfiQueueHas(sessions, ee, record.code);

  if (withEe.present) {
    // --- the future actor is swapped while the record is elsewhere ----------
    await reassignRfi(sessions, record.code, TYPE.QI, newQi.name, note);
    const nowQi = await readAssignee(sessions, record.code, TYPE.QI);
    expect(nowQi, `H2: the QI swap did not take — the modal still reads "${nowQi}"`).toBe(newQi.name);

    // Not yet: the record is still with the EE, so it must not already sit in
    // the new QI's worklist. An app that pushed it there early would have the
    // QI inspecting work the EE has not signed off.
    const early = await rfiQueueHas(sessions, newQi, record.code);
    expect(
      early.present,
      `H2: ${record.code} is already in the NEW QI's "Pending with me" while it is still with the ` +
      `EE — the QI swap must take effect only when the record reaches the QI.`
    ).toBeFalsy();
    note(`H2: not in ${newQi.name}'s queue yet, as expected (still with the EE)`);

    // --- the EE approves: now it reaches the QI stage ----------------------
    const page = await openAs(sessions, ee, record.code, 'H2 / EE approves');
    const review = new RFIReviewPage(page);
    await review.expandAllChecklist().catch(() => {});
    await review.approve();
    note(`H2: EE ${ee.name} approved ${record.code}`);
  } else {
    // Re-run: the EE already approved on an earlier pass. The swap must
    // already be in place, or this case cannot be judged.
    const nowQi = await readAssignee(sessions, record.code, TYPE.QI);
    expect(
      nowQi,
      `H2: ${record.code} is no longer with its EE and its QI is "${nowQi}", not "${newQi.name}". ` +
      `An earlier run left it in a state this case cannot judge — check the record by hand.`
    ).toBe(newQi.name);
    note(`H2: ${record.code} already past the EE with QI "${nowQi}" — prepared by an earlier run`);
  }

  // --- it went to the NEW QI, and never to the old one ----------------------
  await expectHandOff(sessions, record.code, { to: newQi, from: oldQi }, 'H2');
  note(`H2: PASS — ${record.code} reached ${newQi.name} after EE approval, not ${oldQi.name}`);
});

// --- H3: a PAST actor --------------------------------------------------------
test('H3: reassigning the CI while the RFI is with its QI routes the rejection to the NEW CI', async () => {
  test.setTimeout(45 * 60 * 1000);

  const record = claimRecord('rfi', 'H_PAST_CI');
  const ee = fleet.EE_D;
  const qi = fleet.QI_D;
  const oldCi = fleet.CI_C;      // the creator, snapshotted as the record's CI
  const newCi = fleet.CI_A;      // no WAM anywhere
  note(`H3: ${record.code} — reassign its CI "${oldCi.name}" -> "${newCi.name}" once it is with QI`);

  // Where is it? Resume from there. Latest state first.
  const withNewCi = await rfiQueueHas(sessions, newCi, record.code);
  if (withNewCi.present) {
    note(`H3: ${record.code} is already rejected back to ${newCi.name} — prepared by an earlier run`);
  } else {
    const withQi = await rfiQueueHas(sessions, qi, record.code);
    if (!withQi.present) {
      const withEe = await rfiQueueHas(sessions, ee, record.code);
      expect(
        withEe.present,
        `H3: ${record.code} is with none of ${newCi.name}, ${qi.name} or ${ee.name}, so this case ` +
        `cannot set up its own precondition. Check the record in the app before re-running.`
      ).toBeTruthy();

      // Move it on to the QI — the CI's turn is then in the PAST.
      const page = await openAs(sessions, ee, record.code, 'H3 / EE approves');
      const review = new RFIReviewPage(page);
      await review.expandAllChecklist().catch(() => {});
      await review.approve();
      note(`H3: EE ${ee.name} approved ${record.code} — now with the QI`);
    }

    // --- swap the PAST actor ------------------------------------------------
    await reassignRfi(sessions, record.code, TYPE.CI, newCi.name, note);
    const nowCi = await readAssignee(sessions, record.code, TYPE.CI);
    expect(nowCi, `H3: the CI swap did not take — the modal still reads "${nowCi}"`).toBe(newCi.name);

    // --- the QI rejects: whose desk does it land on? ------------------------
    // A PAGE-1 rejection, so the resubmit form is editable for the new CI.
    const page = await openAs(sessions, qi, record.code, 'H3 / QI rejects');
    await new RFIReviewPage(page).rejectFromFirstPage('Family H3 — rejected after the CI was reassigned');
    note(`H3: QI ${qi.name} rejected ${record.code}`);
  }

  // --- it went to the NEW CI, and not to the old one ------------------------
  await expectHandOff(sessions, record.code, { to: newCi, from: oldCi }, 'H3');

  // Reaching the queue is not being able to act: the new CI must get the
  // editable resubmit form (a rejected row's eye icon lands on /re-submit).
  const ciPage = await openAs(sessions, newCi, record.code, 'H3 / new CI opens the resubmit');
  if (!ciPage.url().includes('/re-submit')) {
    // Same fallback as 45/49: if the eye icon ever lands on /view instead.
    const button = ciPage.getByRole('button', { name: /resubmit|edit/i }).first();
    await button.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {});
    await button.click().catch(() => {});
    await ciPage.waitForLoadState('networkidle').catch(() => {});
  }
  expect(
    ciPage.url(),
    `H3: ${newCi.name} holds the rejected ${record.code} but did not get the resubmit form ` +
    `(${ciPage.url()}).`
  ).toContain('/re-submit');
  note(`H3: PASS — the rejection landed on ${newCi.name}, who can open the resubmit form; ` +
    `${oldCi.name} does not hold it`);
});
