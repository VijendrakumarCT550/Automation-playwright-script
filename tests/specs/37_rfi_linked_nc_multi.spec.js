const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { createLinkedNcFlow, linkedNcData } = require('../utils/linked-nc-flow');

// ===========================================================================
// TWO LINKED NCs ON ONE RFI — the PLURAL half of the rule (gap G-29;
// filed as G-27 during the run, renumbered in the register because G-27 was
// already action-level authorisation. The log lines and the NC descriptions
// this file wrote into live data still read G-27 — left as-is on purpose.)
// ===========================================================================
// THE FEATURE, in the app owner's words: "QI rejects an RFI and raises ONE OR
// MORE NCs against the RFI checklist questions, ONE NC PER QUESTION ... The RFI
// can't be resubmitted until ALL linked NCs are finally approved."
//
// WHY THE SINGLE-NC SPEC DOES NOT ALREADY COVER THIS, which is the whole point
// of a second file:
//
//   36_rfi_linked_nc_lifecycle.spec.js proves the SINGULAR case — one NC,
//   approve it, the RFI unblocks. That says nothing about the word "ALL".
//   Suppose the backend asked "does this RFI have ANY approved NC?" instead of
//   "are ALL of its NCs approved?". With one linked NC those two questions
//   return the identical answer for every input, so spec 36 passes either way
//   and the defect is invisible.
//
//   It only becomes visible with two: approve NC #1 and a correct app keeps the
//   RFI blocked, while the buggy one releases it early — letting a contractor
//   resubmit work that still carries a live, unresolved non-conformance. That
//   is a real-world consequence, not a technicality, and it is exactly what the
//   middle assertion below catches.
//
// SO THE SHAPE IS: raise two NCs -> RFI blocked -> approve #1 ONLY -> RFI MUST
// STILL BE BLOCKED -> approve #2 -> RFI released.
//
// The middle assertion is the reason this spec exists. The first and last
// assertions are inherited from spec 36 and are here only to prove the run
// reached a state worth measuring: without the "blocked at the start" check a
// broken queue would look like a passing gate, and without the "released at the
// end" check an RFI that can never be resubmitted would satisfy the middle
// assertion trivially.
//
// USERS AND GROUND: the .env CI/EE/QI accounts on A-06c / BL01, same as spec 36
// (see tests/utils/linked-nc-flow.js). Two work sections are NOT consumed — one
// RFI, two NCs against two questions of its single checklist.
//
// Usage:
//   $env:PULSE_ENV="qa"
//   npx playwright test tests/specs/37_rfi_linked_nc_multi.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

// The two checklist questions that each get their own NC. Indices 0 and 1 —
// the first two items; confirmed live that marking a second item Not Ok
// reveals its own independent "Raise NC" control.
const ITEMS = [0, 1];

let context, page, flow;
let rfiCode = null;
let ncCodes = [];
let ncCodesBefore = [];
const NC_DATA_BY_ITEM = ITEMS.map((i) => linkedNcData(`G-27 item ${i + 1}`));
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
    `\n=== TWO linked NCs on one RFI (G-27) on ${process.env.BASE_URL} ===\n` +
    `    ground: ${flow.FIXTURE.baseData.workLocation} / ${flow.FIXTURE.baseData.workArea}\n` +
    `    CI ${process.env.CI_EMAIL}\n    EE ${process.env.EE_EMAIL}\n    QI ${process.env.QI_EMAIL}\n`
  );
});

test.afterAll(async () => {
  if (findings.length) {
    console.log('');
    console.log('--- G-27 findings ---');
    for (const f of findings) console.log(`  ${f}`);
  }
  if (context) await context.close();
});

// ---------------------------------------------------------------------------
test('1. CI raises an RFI and EE approves it through to QI', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  ncCodesBefore = await flow.ncCodesInPendingWithMe();
  note(`CI's NC queue before the run: ${ncCodesBefore.length ? ncCodesBefore.join(', ') : '(empty)'}`);

  const raised = await flow.raiseRfiToQi({ observation: 'OK - multi linked NC (G-27)', loginAs });
  rfiCode = raised.rfiCode;
});

// ---------------------------------------------------------------------------
test('2. QI rejects the RFI raising TWO linked NCs, one per checklist question', async () => {
  test.setTimeout(25 * 60 * 1000);
  expect(rfiCode, 'step 1 must have produced an RFI').toBeTruthy();

  await loginAs('QI');
  await flow.openRfiRow(rfiCode);

  await flow.rejectWithLinkedNcs(rfiCode, ITEMS.map((index, i) => ({
    index,
    remark: `Not Ok - multi linked NC item ${i + 1} (G-27)`,
    nc: NC_DATA_BY_ITEM[i],
  })));
});

// ---------------------------------------------------------------------------
test('3. BOTH NCs reach CI as separate records', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  const after = await flow.ncCodesInPendingWithMe();
  const created = after.filter((code) => !ncCodesBefore.includes(code));
  const leftovers = after.filter((code) => ncCodesBefore.includes(code));
  note(`CI's NC queue after the rejection: ${after.length ? after.join(', ') : '(empty)'}`);
  note(`new since the baseline: ${created.length ? created.join(', ') : '(none)'}`);

  // "One NC per question" means TWO DISTINCT RECORDS, not one NC mentioning two
  // problems. Each is identified by the description typed into its own panel,
  // so a single record that happened to absorb both would fail to match one of
  // them rather than quietly pass.
  for (let i = 0; i < NC_DATA_BY_ITEM.length; i += 1) {
    const alreadyFound = ncCodes.slice();
    const found = await flow.findLinkedNc(
      created.filter((c) => !alreadyFound.includes(c)),
      leftovers.filter((c) => !alreadyFound.includes(c)),
      NC_DATA_BY_ITEM[i].description
    );
    note(`identification for item ${i + 1}: ${found.tried.join(' | ')}`);

    expect(
      found.code,
      `No NC in CI's queue carries the description QI typed into panel ${i + 1} ` +
      `(${JSON.stringify(NC_DATA_BY_ITEM[i].description)}). Queue: [${after.join(', ')}]; new: ` +
      `[${created.join(', ')}]; opened and checked: ${found.tried.join(' | ')}. ` +
      `"One NC per question" requires one distinct record per Not-Ok item — if only one NC was ` +
      `created for two items, this is where that shows.`
    ).toBeTruthy();

    ncCodes.push(found.code);
  }

  expect(
    new Set(ncCodes).size,
    `The two checklist items produced the same NC record (${ncCodes.join(', ')}). ` +
    `"One NC per question" requires two distinct NCs.`
  ).toBe(2);

  note(`the two linked NCs are ${ncCodes.join(' and ')}`);
});

// ---------------------------------------------------------------------------
test('4. with BOTH NCs open, CI cannot resubmit the RFI', async () => {
  test.setTimeout(25 * 60 * 1000);

  const attempt = await flow.attemptRfiResubmit(rfiCode, 'Resubmit attempt, both NCs open (G-27)');
  note(
    `both-open resubmit: reachable=${attempt.reachable} (appeared after ${attempt.appearedAfterMs}ms) ` +
    `proceeded=${attempt.proceeded} submitted=${attempt.submitted} app=${JSON.stringify(attempt.toastText)}`
  );

  expect(
    attempt.submitted,
    `CI resubmitted ${rfiCode} while BOTH linked NCs (${ncCodes.join(', ')}) were still open.`
  ).toBe(false);
});

// ---------------------------------------------------------------------------
test('5. the FIRST linked NC is driven to full approval (CI -> EE -> QI)', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  await flow.ciRespondToNc(ncCodes[0], 'G-27 NC #1');

  await loginAs('EE');
  await flow.reviewNc(ncCodes[0], 'EE', 'approve');

  await loginAs('QI');
  await flow.reviewNc(ncCodes[0], 'QI', 'approve');

  note(`${ncCodes[0]} is fully approved; ${ncCodes[1]} is still open`);
});

// ---------------------------------------------------------------------------
test('6. THE PLURAL RULE: one NC approved is NOT enough — the RFI stays blocked', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  const attempt = await flow.attemptRfiResubmit(rfiCode, 'Resubmit attempt, one NC still open (G-27)');
  note(
    `one-approved resubmit: reachable=${attempt.reachable} (appeared after ${attempt.appearedAfterMs}ms) ` +
    `proceeded=${attempt.proceeded} submitted=${attempt.submitted} app=${JSON.stringify(attempt.toastText)}`
  );

  // THE ASSERTION THIS WHOLE SPEC EXISTS FOR.
  expect(
    attempt.submitted,
    `RULE VIOLATED — "ALL linked NCs" is not being enforced. ${ncCodes[0]} is approved but ` +
    `${ncCodes[1]} is still open, and CI was nonetheless able to resubmit ${rfiCode}. ` +
    `That lets a contractor resubmit work still carrying a live non-conformance. It is the ` +
    `signature of the gate asking "does this RFI have ANY approved NC?" instead of "are ALL of ` +
    `its NCs approved?" — a distinction the single-NC case (spec 36) cannot detect. ` +
    `Reached: reachable=${attempt.reachable}, proceeded=${attempt.proceeded}, final URL ${attempt.url}.`
  ).toBe(false);

  note('confirmed: approving only the first linked NC does NOT release the RFI');
});

// ---------------------------------------------------------------------------
test('7. the SECOND linked NC is approved, and the RFI is released', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAs('CI');
  await flow.ciRespondToNc(ncCodes[1], 'G-27 NC #2');

  await loginAs('EE');
  await flow.reviewNc(ncCodes[1], 'EE', 'approve');

  await loginAs('QI');
  await flow.reviewNc(ncCodes[1], 'QI', 'approve');
  note(`${ncCodes[1]} is now fully approved — every linked NC is closed`);

  await loginAs('CI');
  const attempt = await flow.attemptRfiResubmit(rfiCode, 'Resubmit after BOTH NCs approved (G-27)');
  note(
    `both-approved resubmit: reachable=${attempt.reachable} (appeared after ${attempt.appearedAfterMs}ms) ` +
    `proceeded=${attempt.proceeded} submitted=${attempt.submitted} app=${JSON.stringify(attempt.toastText)}`
  );

  // Without this, step 6 proves nothing: an RFI that can NEVER be resubmitted
  // also passes "still blocked after one approval".
  expect(
    attempt.submitted,
    `Both linked NCs (${ncCodes.join(', ')}) are approved, so ${rfiCode} should now be ` +
    `resubmittable — but CI could not: reachable=${attempt.reachable}, ` +
    `proceeded=${attempt.proceeded}, app said ${JSON.stringify(attempt.toastText)}.`
  ).toBe(true);

  note(`CI resubmitted ${rfiCode} once BOTH linked NCs were approved — the gate released`);
});
