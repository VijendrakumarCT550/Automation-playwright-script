const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { createLinkedNcFlow, linkedNcData } = require('../utils/linked-nc-flow');

// ===========================================================================
// A LINKED NC BEING REJECTED BACK TO CI — the unhappy path (gap G-30;
// filed as G-27b during the run — see 37_rfi_linked_nc_multi.spec.js for why
// the in-file strings still say G-27b.)
// ===========================================================================
// THE FEATURE, in the app owner's words: "The contractor in charge provides root
// cause and corrective action and submits the NC. It then goes through execution
// engineer and quality inspector approval, WITH REJECTIONS FLOWING BACK TO THE
// CONTRACTOR IN CHARGE FOR RESUBMISSION. The RFI can't be resubmitted until all
// linked NCs are finally approved."
//
// WHY THIS IS NOT COVERED BY SPEC 36, which is the whole reason for a third file:
//
//   36_rfi_linked_nc_lifecycle.spec.js only ever walks the HAPPY PATH — CI
//   responds once, EE approves, QI approves. No reviewer ever says "not good
//   enough" and sends it back. So three things are untested there:
//
//     a. does a REJECTED linked NC actually return to CI's queue, and can CI
//        revise and resubmit it?
//     b. does the RFI STAY BLOCKED throughout that bouncing? This is the one
//        with teeth. A reviewer's rejection is a terminal-looking event — if the
//        backend treated "EE rejected the NC" as "this NC is no longer pending",
//        the RFI would be released while the non-conformance is not merely
//        unresolved but has just been judged inadequate. Strictly worse than the
//        bug the plural rule guards against.
//     c. does the gate still release correctly AFTER a bounce, or does a
//        rejection leave some state behind that keeps the RFI blocked forever?
//
// SO THE SHAPE IS: reject the RFI with one linked NC, then bounce that NC TWICE
// — once from EE, once from QI, since they are different reviewers and only EE's
// path is symmetric with the RFI flow — checking the RFI is still blocked after
// each bounce, and finally approve it and confirm the gate releases.
//
//   CI responds -> EE REJECTS   -> [RFI still blocked?] -> CI resubmits
//               -> EE approves  -> QI REJECTS           -> [RFI still blocked?]
//               -> CI resubmits -> EE approves -> QI approves -> [RFI released?]
//
// NOTE ON NC IDENTITY ACROSS A BOUNCE: resubmitting an NC creates a new child
// record with its own id, but the VISIBLE CODE never changes (unlike RFI, whose
// code can change on resubmit). Confirmed in the NC flow work and relied on
// here — every step after the first addresses the NC by the same code.
//
// USERS AND GROUND: the .env CI/EE/QI accounts on A-06c / BL01, same as specs
// 36 and 37 (see tests/utils/linked-nc-flow.js).
//
// Usage:
//   $env:PULSE_ENV="qa"
//   npx playwright test tests/specs/38_rfi_linked_nc_reject_rounds.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const NOT_OK_ITEM = 0;
const LINKED_NC = linkedNcData('G-27b reject rounds');

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

// Asserts the RFI is still gated, and says WHICH bounce it is reporting on —
// the message is what a failure here has to carry, since "CI could resubmit" on
// its own would not say at which point the gate leaked.
async function expectStillBlocked(stage) {
  await loginAs('CI');
  const attempt = await flow.attemptRfiResubmit(rfiCode, `Resubmit attempt — ${stage} (G-27b)`);
  note(
    `${stage}: reachable=${attempt.reachable} (appeared after ${attempt.appearedAfterMs}ms) ` +
    `proceeded=${attempt.proceeded} submitted=${attempt.submitted} app=${JSON.stringify(attempt.toastText)}`
  );

  expect(
    attempt.submitted,
    `RULE VIOLATED at "${stage}": CI resubmitted ${rfiCode} while its linked NC ${ncCode} was ` +
    `NOT yet approved. A rejected NC is further from resolution than a pending one — if a ` +
    `reviewer's rejection releases the RFI, a contractor can resubmit work whose ` +
    `non-conformance has just been judged inadequate. Reached: reachable=${attempt.reachable}, ` +
    `proceeded=${attempt.proceeded}, final URL ${attempt.url}.`
  ).toBe(false);
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
    `\n=== Linked NC rejected back to CI (G-27b) on ${process.env.BASE_URL} ===\n` +
    `    ground: ${flow.FIXTURE.baseData.workLocation} / ${flow.FIXTURE.baseData.workArea}\n` +
    `    CI ${process.env.CI_EMAIL}\n    EE ${process.env.EE_EMAIL}\n    QI ${process.env.QI_EMAIL}\n`
  );
});

test.afterAll(async () => {
  if (findings.length) {
    console.log('');
    console.log('--- G-27b findings ---');
    for (const f of findings) console.log(`  ${f}`);
  }
  if (context) await context.close();
});

// ---------------------------------------------------------------------------
test('1. CI raises an RFI, EE approves, and QI rejects it with a linked NC', async () => {
  test.setTimeout(30 * 60 * 1000);

  await loginAs('CI');
  ncCodesBefore = await flow.ncCodesInPendingWithMe();
  note(`CI's NC queue before the run: ${ncCodesBefore.length ? ncCodesBefore.join(', ') : '(empty)'}`);

  const raised = await flow.raiseRfiToQi({ observation: 'OK - NC reject rounds (G-27b)', loginAs });
  rfiCode = raised.rfiCode;

  await loginAs('QI');
  await flow.openRfiRow(rfiCode);
  await flow.rejectWithLinkedNcs(rfiCode, [{
    index: NOT_OK_ITEM,
    remark: 'Not Ok - NC reject rounds (G-27b)',
    nc: LINKED_NC,
  }]);
});

// ---------------------------------------------------------------------------
test('2. the linked NC reaches CI, who responds with root cause and corrective action', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  const after = await flow.ncCodesInPendingWithMe();
  const created = after.filter((code) => !ncCodesBefore.includes(code));
  const leftovers = after.filter((code) => ncCodesBefore.includes(code));

  const found = await flow.findLinkedNc(created, leftovers, LINKED_NC.description);
  note(`identification: ${found.tried.join(' | ')}`);
  expect(
    found.code,
    `No NC in CI's queue carries the description QI typed (${JSON.stringify(LINKED_NC.description)}). ` +
    `Queue: [${after.join(', ')}]; new: [${created.join(', ')}]; checked: ${found.tried.join(' | ')}.`
  ).toBeTruthy();

  ncCode = found.code;
  note(`linked NC is ${ncCode}`);

  await flow.ciRespondToNc(ncCode, 'G-27b round 1');
});

// ---------------------------------------------------------------------------
test('3. EE REJECTS the linked NC, and it flows back to CI', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('EE');
  await flow.reviewNc(ncCode, 'EE', 'reject', 'Automated EE rejection — root cause not adequate (G-27b)');

  // THE RETURN LEG, asserted rather than assumed. "EE rejected it" is only half
  // the behaviour the app owner described; the other half is that it comes back
  // to the contractor, and an NC that vanished from CI's queue instead would be
  // a dead record nobody can act on.
  await loginAs('CI');
  const queue = await flow.ncCodesInPendingWithMe();
  note(`CI's NC queue after EE's rejection: ${queue.length ? queue.join(', ') : '(empty)'}`);
  expect(
    queue.includes(ncCode),
    `${ncCode} was rejected by EE but is not back in CI's "Pending with me" — a rejection that ` +
    `does not return to the contractor leaves the NC (and the RFI it gates) stuck with nobody ` +
    `able to act on it. Queue: [${queue.join(', ')}].`
  ).toBe(true);
  note(`${ncCode} is back with CI after EE's rejection`);
});

// ---------------------------------------------------------------------------
test('4. the RFI is STILL blocked while the rejected NC is unresolved', async () => {
  test.setTimeout(25 * 60 * 1000);
  await expectStillBlocked('after EE rejected the NC');
});

// ---------------------------------------------------------------------------
test('5. CI resubmits the NC, EE approves it, and QI REJECTS it', async () => {
  test.setTimeout(30 * 60 * 1000);

  await loginAs('CI');
  await flow.ciRespondToNc(ncCode, 'G-27b round 2 (after EE rejection)');

  await loginAs('EE');
  await flow.reviewNc(ncCode, 'EE', 'approve');

  await loginAs('QI');
  await flow.reviewNc(ncCode, 'QI', 'reject', 'Automated QI rejection — corrective action insufficient (G-27b)');

  // QI's rejection must also return the NC to CI — not to EE. The two reviewers
  // are NOT symmetric here (EE reviews first), so QI's return leg is its own
  // claim and not implied by step 3.
  await loginAs('CI');
  const queue = await flow.ncCodesInPendingWithMe();
  note(`CI's NC queue after QI's rejection: ${queue.length ? queue.join(', ') : '(empty)'}`);
  expect(
    queue.includes(ncCode),
    `${ncCode} was rejected by QI but is not back in CI's "Pending with me". Rejections are ` +
    `specified to flow back to the contractor in charge — from EITHER reviewer, not just EE. ` +
    `Queue: [${queue.join(', ')}].`
  ).toBe(true);
  note(`${ncCode} is back with CI after QI's rejection`);
});

// ---------------------------------------------------------------------------
test('6. the RFI is STILL blocked after the second bounce', async () => {
  test.setTimeout(25 * 60 * 1000);
  await expectStillBlocked('after QI rejected the NC');
});

// ---------------------------------------------------------------------------
test('7. CI resubmits once more, both reviewers approve, and the RFI is released', async () => {
  test.setTimeout(30 * 60 * 1000);

  await loginAs('CI');
  await flow.ciRespondToNc(ncCode, 'G-27b round 3 (after QI rejection)');

  await loginAs('EE');
  await flow.reviewNc(ncCode, 'EE', 'approve');

  await loginAs('QI');
  await flow.reviewNc(ncCode, 'QI', 'approve');
  note(`${ncCode} is fully approved after two rejections and three CI submissions`);

  await loginAs('CI');
  const attempt = await flow.attemptRfiResubmit(rfiCode, 'Resubmit after a bounced NC was approved (G-27b)');
  note(
    `released-state resubmit: reachable=${attempt.reachable} (appeared after ${attempt.appearedAfterMs}ms) ` +
    `proceeded=${attempt.proceeded} submitted=${attempt.submitted} app=${JSON.stringify(attempt.toastText)}`
  );

  // The gate must release the same way it does for an NC that was never
  // rejected. If a bounce left state behind, this is where it shows: the RFI
  // would stay blocked forever despite every linked NC being approved — the
  // mirror-image defect of the one steps 4 and 6 guard against, and just as
  // damaging, since the work could then never be resubmitted at all.
  expect(
    attempt.submitted,
    `${ncCode} was rejected twice and is now fully approved, so ${rfiCode} should be ` +
    `resubmittable — but CI could not: reachable=${attempt.reachable}, ` +
    `proceeded=${attempt.proceeded}, app said ${JSON.stringify(attempt.toastText)}. ` +
    `Spec 36 proves the gate releases for an NC approved first time, so a failure HERE and ` +
    `not there points at the rejection rounds leaving state behind.`
  ).toBe(true);

  note(`CI resubmitted ${rfiCode} after the bounced NC was finally approved — the gate released`);
});
