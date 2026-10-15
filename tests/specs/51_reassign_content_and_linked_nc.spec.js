const { test, expect } = require('@playwright/test');
const { fleetFor } = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const {
  TYPE, rfiQueueHas, readAssignee, reassignRfi, openAs, expectHandOff,
} = require('../utils/reassign-rfi-ops');
const { createLinkedNcFlow, linkedNcData } = require('../utils/linked-nc-flow');
const RFIReviewPage = require('../pages/RFIReviewPage');

// ===========================================================================
// FAMILY I, rows I2 and I4 — what must travel WITH a reassigned record.
// (docs/reassignment-scenarios.md, Family I)
// ===========================================================================
// 46 proved the version (I1) and code (I3) do not move across a swap. These
// two cover the record's CONTENT and its DOWNSTREAM routing:
//
//   I2  the observations and the attached photo are UNCHANGED for the new
//       assignee — a swap that dropped them would hand a reviewer an RFI with
//       nothing to review, looking perfectly healthy.
//   I4  after the CI is reassigned, an NC the QI raises from that RFI (the
//       "Raise NC" linked NC) goes to the NEW CI — not to the contractor who
//       was taken off the job.
//
// I2 compares against what the record was CREATED with (42 stores the marker
// text and photo count for I_CONTENT), so it stays meaningful on a re-run after
// the swap has already happened.
//
// I4's linked NC carries a description derived from the RFI's code, so a re-run
// finds the same NC rather than needing a fresh one.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/51_reassign_content_and_linked_nc.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

let sessions, fleet;
const findings = [];
function note(msg) { findings.push(msg); console.log(`  ${msg}`); }

// Images in the record's own content region — the same scoping spec 34 proved
// for RFI checklists (which carry no "View Attachments" label, so
// BasePage.getAttachmentCount does not apply here).
async function countRecordImages(page) {
  const scope = page.locator('form, [role="main"], main').first();
  const target = (await scope.count().catch(() => 0)) ? scope : page.locator('body');
  // The thumbnail mounts a beat after the page — poll briefly.
  let n = 0;
  for (let i = 0; i < 10; i += 1) {
    n = await target.locator('img:not([alt*="logo" i])').count().catch(() => 0);
    if (n > 0) break;
    await page.waitForTimeout(500);
  }
  return n;
}

async function readContent(page) {
  const review = new RFIReviewPage(page);
  await review.goToChecklistPage().catch(() => {});
  await review.expandAllChecklist().catch(() => {});
  await page.waitForTimeout(1500);
  const observations = (await review.getAllObservationValues()).filter(Boolean);
  const images = await countRecordImages(page);
  return { observations, images };
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  for (const k of ['CI_A', 'CI_C', 'EE_C', 'EE_D', 'QI_D']) {
    expect(fleet[k] && fleet[k].email, `${k} must be in the fleet for this deployment`).toBeTruthy();
  }
  sessions = createSessionFactory(browser, { log: () => {} });
  console.log(`\n=== Family I2 / I4 — content and downstream routing, on ${process.env.BASE_URL} ===\n`);
});

test.afterAll(async () => {
  console.log('\n--- I2 / I4 findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- I2: content unchanged ---------------------------------------------------
test('I2: the observations and attached photo are unchanged for the new EE', async () => {
  test.setTimeout(35 * 60 * 1000);

  const record = claimRecord('rfi', 'I_CONTENT');
  expect(
    record.observation && record.photos,
    `I2 needs the I_CONTENT record's creation facts (observation marker + photo count). This ` +
    `record was recorded without them — re-raise it with 42_reassign_rfi_records_setup.`
  ).toBeTruthy();
  const oldEe = fleet.EE_D;
  const newEe = fleet.EE_C;      // mapped only in S05b/Electrical
  note(`I2: ${record.code} created with observations "${record.observation} N" and ${record.photos} photo(s)`);

  // Read it as the CURRENT holder first when it is still with them — that is
  // the strongest "before", taken on the live record rather than from the store.
  const currentEe = await readAssignee(sessions, record.code, TYPE.EE);
  let before = null;
  if (currentEe === oldEe.name) {
    const page = await openAs(sessions, oldEe, record.code, 'I2 / old EE reads');
    before = await readContent(page);
    note(`I2: before the swap ${oldEe.name} sees ${before.observations.length} observations, ` +
      `${before.images} image(s)`);
  }

  await reassignRfi(sessions, record.code, TYPE.EE, newEe.name, note);
  await expectHandOff(sessions, record.code, { to: newEe, from: oldEe }, 'I2');

  const page = await openAs(sessions, newEe, record.code, 'I2 / new EE reads');
  const after = await readContent(page);
  note(`I2: after the swap ${newEe.name} sees ${after.observations.length} observations, ` +
    `${after.images} image(s): ${JSON.stringify(after.observations.slice(0, 3))}…`);

  const marker = new RegExp(`^${record.observation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\d+$`);
  expect(
    after.observations.length,
    `I2: the new EE sees NO observations on ${record.code} — the swap dropped the CI's work.`
  ).toBeGreaterThan(0);
  expect(
    after.observations.every((o) => marker.test(o)),
    `I2: the observations changed across the swap — expected every one to read ` +
    `"${record.observation} N", got ${JSON.stringify(after.observations)}.`
  ).toBeTruthy();
  expect(
    after.images,
    `I2: the photo CI attached is gone for the new EE — ${after.images} image(s), the record was ` +
    `created with ${record.photos}.`
  ).toBeGreaterThanOrEqual(record.photos);

  if (before) {
    expect(after.observations, 'I2: observations differ between the old and the new EE').toEqual(before.observations);
    expect(after.images, 'I2: image count differs between the old and the new EE').toBe(before.images);
  }
  note(`I2: PASS — ${newEe.name} sees the same ${after.observations.length} observations and ` +
    `${after.images} image(s)`);
});

// --- I4: a linked NC follows the NEW CI --------------------------------------
test('I4: a linked NC raised after the CI was reassigned goes to the NEW CI', async () => {
  test.setTimeout(50 * 60 * 1000);

  const record = claimRecord('rfi', 'I_LINKED_NC');
  const ee = fleet.EE_D;
  const qi = fleet.QI_D;
  const oldCi = fleet.CI_C;
  const newCi = fleet.CI_A;
  // Stable per record, so a re-run looks for the same NC.
  const nc = { ...linkedNcData('I4'), description: `Linked NC (I4) for ${record.code}` };
  note(`I4: ${record.code} — reassign CI "${oldCi.name}" -> "${newCi.name}", then QI raises a linked NC`);

  const rejectedToNew = await rfiQueueHas(sessions, newCi, record.code);
  if (rejectedToNew.present) {
    note(`I4: ${record.code} is already rejected back to ${newCi.name} — prepared by an earlier run`);
  } else {
    const withQi = await rfiQueueHas(sessions, qi, record.code);
    if (!withQi.present) {
      const withEe = await rfiQueueHas(sessions, ee, record.code);
      expect(
        withEe.present,
        `I4: ${record.code} is with none of ${newCi.name}, ${qi.name} or ${ee.name} — cannot set up ` +
        `the precondition. Check the record in the app before re-running.`
      ).toBeTruthy();
      const page = await openAs(sessions, ee, record.code, 'I4 / EE approves');
      const review = new RFIReviewPage(page);
      await review.expandAllChecklist().catch(() => {});
      await review.approve();
      note(`I4: EE ${ee.name} approved ${record.code} — now with the QI`);
    }

    await reassignRfi(sessions, record.code, TYPE.CI, newCi.name, note);
    const nowCi = await readAssignee(sessions, record.code, TYPE.CI);
    expect(nowCi, `I4: the CI swap did not take — the modal still reads "${nowCi}"`).toBe(newCi.name);

    // The QI rejects WITH a linked NC — spec 36's proven path (marks the item
    // Not Ok with a remark, fills the panel incl. its photo, submits the
    // checklist rejection and asserts the RFI left the QI's queue).
    const qiPage = await sessions.actAs(qi.email, PASSWORD);
    const flow = createLinkedNcFlow({ page: qiPage, note });
    await flow.openRfiRow(record.code);
    await flow.rejectWithLinkedNcs(record.code, [{
      index: 0, remark: 'Not Ok - Family I4 (CI reassigned first)', nc,
    }]);
    note(`I4: QI ${qi.name} rejected ${record.code} with linked NC "${nc.description}"`);
  }

  // --- the RFI itself went to the new CI ------------------------------------
  await expectHandOff(sessions, record.code, { to: newCi, from: oldCi }, 'I4 (RFI)');

  // --- and so did the linked NC ---------------------------------------------
  const newPage = await sessions.actAs(newCi.email, PASSWORD);
  const newFlow = createLinkedNcFlow({ page: newPage, note });
  const newCodes = await newFlow.ncCodesInPendingWithMe();
  const found = await newFlow.findLinkedNc(newCodes, [], nc.description);
  note(`I4: ${newCi.name}'s NC lookup: ${found.tried.join(' | ') || '(no NCs)'}`);
  expect(
    found.code,
    `I4: the linked NC ("${nc.description}") is NOT in the new CI ${newCi.name}'s NC queue ` +
    `(${newCodes.length} NCs). It was raised after the CI was reassigned, so it must follow the ` +
    `new CI.`
  ).toBeTruthy();

  const oldPage = await sessions.actAs(oldCi.email, PASSWORD);
  const oldFlow = createLinkedNcFlow({ page: oldPage, note });
  const oldCodes = await oldFlow.ncCodesInPendingWithMe();
  const leaked = await oldFlow.findLinkedNc(oldCodes, [], nc.description);
  expect(
    leaked.code,
    `I4: the linked NC ${leaked.code} went to the OLD CI ${oldCi.name}, who was taken off ` +
    `${record.code} before it was raised — work routed to someone explicitly removed from it.`
  ).toBeFalsy();
  note(`I4: PASS — linked NC ${found.code} went to ${newCi.name}, not ${oldCi.name}`);
});
