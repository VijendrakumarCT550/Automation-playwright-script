const { test, expect } = require('@playwright/test');
const { fleetFor } = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const {
  TYPE, rfiQueueHas, readAssignee, reassignRfi, openAs, expectHandOff,
} = require('../utils/reassign-rfi-ops');
const RFIReviewPage = require('../pages/RFIReviewPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// ===========================================================================
// FAMILY C, rows C4 and C6 — the remaining "can the new assignee do the work?"
// (docs/reassignment-scenarios.md, Family C — "the most important family")
// ===========================================================================
// 45 proved it for a CI with NO WAM (C2), a CI mapped only in the other
// location (C3) and an EE with no WAM (C5). The remaining arms:
//
//   C4a  CI_D — right work location, WRONG PACKAGE (mapped A-06c/Electrical)
//   C4b  CI_E — right location and package, WRONG WORK AREA (mapped BL08; the
//        record is on BL07)
//   C6   EE_B — provisioned for SOLAR AND WIND, no WAM. (E7 — that EE_B is
//        OFFERED for a solar record — is already asserted by 41.)
//
// Same standard as 45: the record must REACH the new assignee, the resubmit
// form must still DESCRIBE ITS OWN RFI (page 1 is rebuilt per user, so a user
// mapped elsewhere could get a healthy-looking form that cannot state the
// record's work area), and the step must COMPLETE.
//
// The expected outcome is stated (section 1.2 rule 3): a reassigned user may act
// irrespective of WAM, so every case should pass.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/53_reassign_capability_more.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

const CI_CASES = [
  { id: 'C4a', recordKey: 'C_CI_WRONG_PKG', candidate: 'CI_D', why: 'right location, WRONG package (Electrical)' },
  { id: 'C4b', recordKey: 'C_CI_WRONG_AREA', candidate: 'CI_E', why: 'right location and package, WRONG work area (BL08)' },
];

let sessions, fleet;
const findings = [];
function note(msg) { findings.push(msg); console.log(`  ${msg}`); }

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  for (const k of ['CI_C', 'CI_D', 'CI_E', 'EE_B', 'EE_D', 'QI_D']) {
    expect(fleet[k] && fleet[k].email, `${k} must be in the fleet for this deployment`).toBeTruthy();
  }
  sessions = createSessionFactory(browser, { log: () => {} });
  console.log(
    `\n=== Family C4 / C6 — capability after reassignment, on ${process.env.BASE_URL} ===\n` +
    `    expected outcome: EVERY case passes — a reassigned user may act irrespective of WAM\n`
  );
});

test.afterAll(async () => {
  console.log('\n--- C4 / C6 findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

for (const { id, recordKey, candidate, why } of CI_CASES) {
  test(`${id}: a CI with ${why} can resubmit a record reassigned to them`, async () => {
    test.setTimeout(40 * 60 * 1000);

    const record = claimRecord('rfi', recordKey);
    const newCi = fleet[candidate];
    const oldCi = fleet.CI_C;
    const ee = fleet.EE_D;
    note(`${id}: ${record.code} -> ${candidate} (${newCi.name}) — ${why}`);

    // --- get it "rejected, and held by the candidate" (resumable) -----------
    const held = await rfiQueueHas(sessions, newCi, record.code);
    if (held.present) {
      note(`${id}: ${record.code} is already with ${candidate} — prepared by an earlier run`);
    } else {
      const withEe = await rfiQueueHas(sessions, ee, record.code);
      expect(
        withEe.present,
        `${id}: ${record.code} is with neither ${candidate} nor its EE ${ee.name} — cannot set up ` +
        `the precondition. Check the record in the app before re-running.`
      ).toBeTruthy();

      // PAGE-1 rejection: it leaves page 1 EDITABLE on the resubmit, which is
      // what exposes whether the form can describe the RFI for this user.
      const page = await openAs(sessions, ee, record.code, `${id} / EE rejects`);
      await new RFIReviewPage(page).rejectFromFirstPage(`Family C ${id} — rejected to create a CI step`);
      note(`${id}: EE ${ee.name} rejected ${record.code} from page 1`);

      await reassignRfi(sessions, record.code, TYPE.CI, newCi.name, note);
      await expectHandOff(sessions, record.code, { to: newCi, from: oldCi }, id);
      note(`${id}: ${record.code} reached ${candidate}`);
    }

    // --- the form still describes its own RFI -------------------------------
    const page = await openAs(sessions, newCi, record.code, `${id} / ${candidate} resubmits`);
    if (!page.url().includes('/re-submit')) {
      const button = page.getByRole('button', { name: /resubmit|edit/i }).first();
      await button.waitFor({ state: 'visible', timeout: 20000 });
      await button.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    expect(page.url(), `${id}: expected the editable resubmit form, got ${page.url()}`).toContain('/re-submit');

    const create = new RFICreatePage(page);
    expect(await create.isFirstPageLocked(), `${id}: page 1 should be editable after a page-1 rejection`).toBe(false);

    const values = await create.readFirstPageValues();
    note(`${id}: page 1 reads ${JSON.stringify(values)}`);
    for (const field of ['workLocation', 'workArea', 'package', 'activity']) {
      const shown = values[field];
      expect(
        shown && !/^select\b/i.test(shown),
        `${id}: page 1's "${field}" does not describe the RFI for ${candidate} — it reads ` +
        `${JSON.stringify(shown)} (record ${record.code} is on ` +
        `${record.ground.workLocation}/${record.ground.package}/${record.ground.workArea}). A form ` +
        `that cannot state its own RFI cannot be resubmitted: a stranded record.`
      ).toBeTruthy();
    }
    expect(values.workArea, `${id}: page 1 names the wrong work area`).toContain(record.ground.workArea);
    expect(values.package, `${id}: page 1 names the wrong package`).toContain(record.ground.package);

    // --- and the step completes ---------------------------------------------
    await create.clickProceed();
    const checklist = new RFIChecklistPage(page);
    await checklist.fillAllObservations('OK - as per standard', true);
    await checklist.submitRFI();
    const match = page.url().match(/\/rfi\/([a-f0-9-]+)\/view/i);
    expect(match, `${id}: no /view URL after resubmit — got ${page.url()}`).toBeTruthy();
    note(`${id}: PASS — ${candidate} resubmitted ${record.code} (new child id ${match[1]})`);
  });
}

test('C6: an EE provisioned for SOLAR and WIND (no WAM) can review a solar record reassigned to them', async () => {
  test.setTimeout(35 * 60 * 1000);

  const record = claimRecord('rfi', 'C_EE_WIND');
  const newEe = fleet.EE_B;
  const oldEe = fleet.EE_D;
  const qi = fleet.QI_D;
  note(`C6: ${record.code} -> EE_B (${newEe.name}) — solar + wind provisioning, no WAM`);

  // RESUMABLE: an earlier run may already have had EE_B approve it, in which
  // case it now sits with the QI and EE_B's step is done.
  const currentEe = await readAssignee(sessions, record.code, TYPE.EE);
  if (currentEe === newEe.name && !(await rfiQueueHas(sessions, newEe, record.code)).present) {
    const atQi = await rfiQueueHas(sessions, qi, record.code);
    expect(
      atQi.present,
      `C6: ${record.code} names EE_B as its EE but is in neither EE_B's nor the QI's queue — ` +
      `check the record by hand.`
    ).toBeTruthy();
    note(`C6: PASS (earlier run) — EE_B already approved ${record.code}; it is with the QI`);
    return;
  }

  await reassignRfi(sessions, record.code, TYPE.EE, newEe.name, note);
  await expectHandOff(sessions, record.code, { to: newEe, from: oldEe }, 'C6');

  const page = await openAs(sessions, newEe, record.code, 'C6 / EE_B reviews');
  const review = new RFIReviewPage(page);
  await review.expandAllChecklist().catch(() => {});
  await review.approve();

  // Approval is only proven by the record moving on — to the QI.
  const atQi = await rfiQueueHas(sessions, qi, record.code);
  expect(
    atQi.present,
    `C6: EE_B's approval of ${record.code} did not move it to the QI ${qi.name}.`
  ).toBeTruthy();
  note(`C6: PASS — EE_B approved ${record.code} and it moved on to the QI`);
});
