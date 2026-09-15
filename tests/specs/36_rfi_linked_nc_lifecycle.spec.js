const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { createLinkedNcFlow, linkedNcData } = require('../utils/linked-nc-flow');

// ===========================================================================
// RFI <-> NC LINKAGE, THE LIFECYCLE — gap G-01 (the SINGLE-NC case)
// ===========================================================================
// THE FEATURE, as the app owner describes it:
//
//   QI rejects an RFI and raises one or more NCs against the RFI checklist
//   questions at the time of RFI rejection, one NC per question. The
//   contractor in charge provides root cause and corrective action and submits
//   the NC. It then goes through execution engineer and quality inspector
//   approval, with rejections flowing back to the contractor in charge for
//   resubmission. The RFI can't be resubmitted until all linked NCs are
//   finally approved.
//
// The linked NC is a SECOND, NESTED WORKFLOW that gates the first one. This
// spec walks ONE linked NC through that cycle and proves the gate in BOTH
// directions — blocked while the NC is open, released once it closes. A
// one-directional test would be far weaker: "CI cannot resubmit" is also what a
// broken queue, an unreachable RFI or a never-rejected RFI look like.
//
// THE OTHER TWO THIRDS OF THE FEATURE HAVE THEIR OWN FILES, because each proves
// something this one structurally cannot:
//
//   * 37_rfi_linked_nc_multi.spec.js — TWO NCs. With one linked NC, "is ANY NC
//     approved?" and "are ALL NCs approved?" give identical answers, so this
//     file passes either way and cannot detect the difference.
//   * 38_rfi_linked_nc_reject_rounds.spec.js — the NC being REJECTED back to CI.
//     This file only ever walks the happy path, so it says nothing about
//     whether the RFI stays gated while an NC is bouncing.
//
// ---------------------------------------------------------------------------
// WHAT CAME BEFORE
// ---------------------------------------------------------------------------
// 35_rfi_nc_linkage.spec.js is the DISCOVERY pass: it proved the "Raise NC"
// checkbox appears only after an item is marked Not Ok, and that a rejection
// completes. It could not settle the rule — NC Description and Defect Type
// never filled, so there may never have been a linked NC at all, and an RFI
// that was merely rejected is no evidence about a rule concerning linked NCs.
//
// The panel's real DOM was then captured live —
// tests/specs/inspection/00_inspect_rfi_linked_nc_panel.spec.js, pulse-qa
// 2026-09-15 — and those locators live in RFIReviewPage. The shared steps
// (navigation, identification, the resubmit attempt) live in
// tests/utils/linked-nc-flow.js, which carries the reasoning for each.
//
// ---------------------------------------------------------------------------
// THE FINDING THIS FILE ESTABLISHED: THE GATE BITES AT SUBMIT
// ---------------------------------------------------------------------------
// With a linked NC open, CI DOES see the rejected RFI in "Pending with me"
// (~5s after the rejection) and IS allowed through Proceed onto the checklist
// page. Only the final Submit is refused. So "reached page 2" is NOT
// "resubmitted" — the exact ambiguity spec 35 flagged as unresolved, and a test
// that stops at Proceed reads a working gate as a broken one.
//
// USERS AND GROUND: the .env CI/EE/QI accounts on A-06c / BL01 (the generated
// smoke users would not authenticate on pulse-qa), data imported from
// rfi-flow-turns.js's RFI_DATA so it cannot drift from the tracked regression.
//
// Usage:
//   $env:PULSE_ENV="qa"
//   npx playwright test tests/specs/36_rfi_linked_nc_lifecycle.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const NOT_OK_ITEM = 0;
const LINKED_NC = linkedNcData('G-01');

let context, page, flow;
let rfiCode = null;
let ncCode = null;
let ncCodesBefore = [];
const findings = [];

function note(msg) {
  console.log(`  ${msg}`);
  findings.push(msg);
}

async function loginAs(role) {
  await loginAsRole(page, role);
}

test.beforeAll(async ({ browser }) => {
  for (const role of ['CI', 'EE', 'QI']) {
    expect(process.env[`${role}_EMAIL`], `${role}_EMAIL must be set in .env`).toBeTruthy();
    expect(process.env[`${role}_PASSWORD`], `${role}_PASSWORD must be set in .env`).toBeTruthy();
  }

  context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();
  flow = createLinkedNcFlow({ page, note });

  console.log(
    `\n=== RFI <-> NC linkage lifecycle (G-01) on ${process.env.BASE_URL} ===\n` +
    `    ground: ${flow.FIXTURE.baseData.workLocation} / ${flow.FIXTURE.baseData.workArea}\n` +
    `    CI ${process.env.CI_EMAIL}\n    EE ${process.env.EE_EMAIL}\n    QI ${process.env.QI_EMAIL}\n`
  );
});

test.afterAll(async () => {
  if (findings.length) {
    console.log('');
    console.log('--- G-01 lifecycle findings ---');
    for (const f of findings) console.log(`  ${f}`);
  }
  if (context) await context.close();
});

// ---------------------------------------------------------------------------
test('1. CI raises an RFI and EE approves it through to QI', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');

  // Baseline for the diff that ORDERS the search for this run's linked NC.
  // Taken before anything is created, in CI's own session, because CI is the
  // only actor the NC will be waiting for.
  ncCodesBefore = await flow.ncCodesInPendingWithMe();
  note(`CI's NC queue before the run: ${ncCodesBefore.length ? ncCodesBefore.join(', ') : '(empty)'}`);

  const raised = await flow.raiseRfiToQi({ observation: 'OK - linked NC lifecycle (G-01)', loginAs });
  rfiCode = raised.rfiCode;
});

// ---------------------------------------------------------------------------
test('2. QI rejects the RFI and raises a linked NC on a Not-Ok checklist item', async () => {
  test.setTimeout(25 * 60 * 1000);
  expect(rfiCode, 'step 1 must have produced an RFI').toBeTruthy();

  await loginAs('QI');
  await flow.openRfiRow(rfiCode);

  // rejectWithLinkedNcs asserts the reveal in both directions ("Raise NC" absent
  // before the item is Not Ok, present after) and that the RFI actually left
  // QI's queue afterwards — without which every later step could be measuring an
  // RFI that was never rejected.
  await flow.rejectWithLinkedNcs(rfiCode, [{
    index: NOT_OK_ITEM,
    remark: 'Not Ok - linked NC lifecycle (G-01)',
    nc: LINKED_NC,
  }]);
});

// ---------------------------------------------------------------------------
test('3. the linked NC reaches CI, carrying QI\'s details and a link to the RFI', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  const after = await flow.ncCodesInPendingWithMe();
  const created = after.filter((code) => !ncCodesBefore.includes(code));
  const leftovers = after.filter((code) => ncCodesBefore.includes(code));
  note(`CI's NC queue after the rejection: ${after.length ? after.join(', ') : '(empty)'}`);
  note(`new since the baseline: ${created.length ? created.join(', ') : '(none)'}`);

  const found = await flow.findLinkedNc(created, leftovers, LINKED_NC.description);
  note(`identification: ${found.tried.join(' | ')}`);

  // THE CLAIM THE WHOLE SPEC RESTS ON. If no NC carries QI's description, then
  // either none was created — QI's action was a PLAIN reject and the panel was
  // discarded — or the description did not persist. Either way nothing
  // downstream would be evidence about linked NCs.
  expect(
    found.code,
    `No NC in CI's queue carries the description QI typed into the linked-NC panel ` +
    `(${JSON.stringify(LINKED_NC.description)}). Queue: [${after.join(', ')}]; new since the ` +
    `baseline: [${created.join(', ')}]; opened and checked: ${found.tried.join(' | ')}. ` +
    `If the queue is unchanged, the rejection went through as a PLAIN reject and the NC panel ` +
    `was discarded — which would make every "CI cannot resubmit" observation a statement about ` +
    `an ordinary rejected RFI, not about a linked NC.`
  ).toBeTruthy();

  ncCode = found.code;
  note(`linked NC is ${ncCode} (QI's NC Description reached CI unchanged)`);

  // Section 10 claims the NC detail page shows the parent RFI's id as a link
  // back. SOFT: it is a display claim, not the gate, and failing it must not
  // stop the lifecycle this spec exists to walk.
  const body = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
  const linksBack = body.includes(rfiCode);
  note(`NC detail page shows the parent RFI code (${rfiCode}): ${linksBack}`);
  expect.soft(
    linksBack,
    `docs/rfi-business-logic.md section 10 states the NC detail page shows the parent RFI's id ` +
    `as a clickable link back. ${ncCode}'s page does not mention ${rfiCode}.`
  ).toBe(true);
});

// ---------------------------------------------------------------------------
test('4. CI cannot resubmit the RFI while the linked NC is open — THE RULE', async () => {
  test.setTimeout(25 * 60 * 1000);

  const attempt = await flow.attemptRfiResubmit(rfiCode, 'Resubmit attempt while the NC is open (G-01)');
  note(
    `blocked-state resubmit: reachable=${attempt.reachable} (appeared after ` +
    `${attempt.appearedAfterMs}ms) proceeded=${attempt.proceeded} ` +
    `submitted=${attempt.submitted} app=${JSON.stringify(attempt.toastText)}`
  );

  expect(
    attempt.submitted,
    `RULE VIOLATED: CI resubmitted ${rfiCode} while its linked NC ${ncCode} was still open. ` +
    `The rule is that the RFI cannot be resubmitted until every linked NC is finally approved. ` +
    `Reached: reachable=${attempt.reachable}, proceeded=${attempt.proceeded}, final URL ${attempt.url}.`
  ).toBe(false);

  // WHERE the block bites is a finding, not a requirement — the rule does not
  // say which layer enforces it, and recording it is what tells a future
  // regression apart from a deliberate change. "Not reachable" is only
  // meaningful because attemptRfiResubmit polls for minutes first: an earlier
  // run reported the block as "the RFI never appears", from a single lookup 20s
  // after the rejection, and a direct inspection minutes later found that same
  // RFI sitting in "Pending with me".
  const where = !attempt.reachable
    ? 'the rejected RFI stays out of CI\'s "Pending with me" entirely'
    : !attempt.proceeded
      ? `Proceed (page 1) refuses — the RFI IS reachable (it appeared after ${attempt.appearedAfterMs}ms)`
      : 'the final Submit refuses — the RFI is reachable and Proceed was allowed';
  note(`the block is enforced at: ${where}`);
});

// ---------------------------------------------------------------------------
test('5. CI responds to the linked NC with root cause and corrective action', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  await flow.ciRespondToNc(ncCode, 'G-01 lifecycle');
});

// ---------------------------------------------------------------------------
test('6. EE approves the linked NC', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('EE');
  await flow.reviewNc(ncCode, 'EE', 'approve');
});

// ---------------------------------------------------------------------------
test('7. QI approves the linked NC, closing it', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('QI');
  await flow.reviewNc(ncCode, 'QI', 'approve');
  note(`${ncCode} is now fully approved`);
});

// ---------------------------------------------------------------------------
test('8. with the linked NC approved, CI CAN now resubmit the RFI — the release', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  const attempt = await flow.attemptRfiResubmit(rfiCode, 'Resubmit after the linked NC was approved (G-01)');
  note(
    `released-state resubmit: reachable=${attempt.reachable} (appeared after ` +
    `${attempt.appearedAfterMs}ms) proceeded=${attempt.proceeded} ` +
    `submitted=${attempt.submitted} app=${JSON.stringify(attempt.toastText)}`
  );

  // THE OTHER HALF OF THE RULE, and the reason step 4 alone would prove little:
  // an RFI that can NEVER be resubmitted also satisfies "cannot resubmit while
  // an NC is open". The gate has to open again once the NC closes, or what step
  // 4 measured was not the gate at all.
  expect(
    attempt.submitted,
    `The linked NC ${ncCode} has been approved by BOTH EE and QI, so ${rfiCode} should now be ` +
    `resubmittable — but CI still could not: reachable=${attempt.reachable}, ` +
    `proceeded=${attempt.proceeded}, app said ${JSON.stringify(attempt.toastText)}.`
  ).toBe(true);

  note(`CI resubmitted ${rfiCode} once its linked NC was approved — the gate released`);
});
