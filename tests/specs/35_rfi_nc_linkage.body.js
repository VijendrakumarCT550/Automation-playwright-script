const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { getProfile } = require('../config/projects');
const { resolveRfiFixture } = require('../utils/smoke-rfi-fixture');
const { fillPageOne, resetToMyTasks, getVisibleCodeFor } = require('../utils/rfi-dependency-flow');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const { createLinkedNcFlow, linkedNcData } = require('../utils/linked-nc-flow');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');

// RFI <-> NC LINKAGE — gap G-01.
//
// ---------------------------------------------------------------------------
// THE PARK IS LIFTED
// ---------------------------------------------------------------------------
// G-01 has been marked `parked` since 2026-08-19 on the app owner's instruction:
// "wait for RFI linked NC we will do later along with different scenario". The
// app owner asked for it directly on 2026-09-11, which lifts that park. Recorded
// here and in the gap register rather than silently started, because "parked"
// in this repo means do-not-start-unprompted, not do-not-ever.
//
// ---------------------------------------------------------------------------
// WHAT THE DOCS SAY, AND WHICH PARTS ARE ACTUALLY CLAIMS
// ---------------------------------------------------------------------------
// docs/rfi-business-logic.md section 10 describes four behaviours. Three are
// testable claims; the fourth is the one that matters most:
//
//   1. marking a checklist item Not OK reveals a "Raise NC" checkbox for THAT item
//   2. checking it makes NC Description mandatory, creates an NC linked to that
//      exact checklist question, and rejects the RFI
//   3. the NC detail page links back to the parent RFI
//   4. CI CANNOT RESUBMIT the RFI while any linked NC is still open
//
// (4) is the real cross-entity rule and the reason this gap was called the
// largest untested behaviour in the product. It is also the only one whose
// absence would be silent: a regression there lets CI resubmit work that is
// still under a live non-conformance.
//
// ---------------------------------------------------------------------------
// DISCOVERY-FIRST, DELIBERATELY
// ---------------------------------------------------------------------------
// Nothing in this repo has ever driven this path — RFIReviewPage has no concept
// of "Raise NC", and the NC form it spawns is not the standalone NCCreatePage
// form. So the locators below are NOT yet proven, and this spec is written to
// find that out cheaply rather than to look right:
//
//   * it ASSERTS only what section 10 states unambiguously and what a single
//     observation can settle — the checkbox is absent before Not Ok and present
//     after, and CI is blocked from resubmitting afterwards;
//   * it REPORTS everything else (which fields appear, what the submit does,
//     what the NC screen shows) so ONE run maps the feature.
//
// Locators proven by that run get promoted into RFIReviewPage afterwards. Doing
// it the other way round would put guesses into a page object that 15 other
// specs depend on.
//
// ---------------------------------------------------------------------------
// GROUND: featureGround.ncBlock (BL06)
// ---------------------------------------------------------------------------
// This spec deliberately leaves a REJECTED RFI and an OPEN linked NC behind —
// that is the state rule (4) is about, so it cannot be cleaned up without
// destroying what the next run needs. BL06 is already the area whose whole
// purpose is "somewhere a non-approved NC can be left lying" (SM28 uses it for
// exactly that), so the semantics match and no flow stage is at risk.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const PROFILE_KEY = process.env.RECON_PROFILE || 'solar-e2e';

let rfiCode = null;
let rfiId = null;
let rejectCompleted = false;
// Unique per run, so test 4 can find THIS run's linked NC in CI's queue by its
// content — the same identification spec 36 uses.
const LINKED_NC = linkedNcData('G-01 spec 35');
const notes = [];

function note(msg) {
  console.log(`  ${msg}`);
  notes.push(msg);
}

// First line of an error message. A named helper rather than an inline
// `.split('\n')[0]` at each call site — those literals kept getting mangled into
// real newlines by the scripted edits used to build this file, which broke the
// file three separate times. One definition, one place to get right.
function firstLine(err) {
  return String((err && err.message) || err || '').split(/\r?\n/)[0];
}

// Fills the LINKED-NC panel that appears once "Raise NC" is checked.
//
// READ OFF A LIVE SCREENSHOT, not guessed. Run 4's failure capture shows the
// panel on review page 1 with exactly these mandatory fields, the app's own
// validation error ("Target date for NC closure is required") already visible:
//
//   Defect Type *   Category *   Target Date for Closure *
//   NC Quantity *   Unit of Measurement *   Capture Photo *
//   (Debit Amount is the one optional field)
//
// Those are the "8 fields, photo required" the reference note describes, and
// they are the SAME fields the standalone NC form has — so NCCreatePage's
// already-proven locators are reused rather than a second set being invented
// here. The panel is embedded in the RFI review rather than being NCCreatePage's
// own screen, which is why only the field helpers are reused and none of its
// navigation.
async function fillLinkedNcPanel(page, profile) {
  const NCCreatePage = require('../pages/NCCreatePage');
  const nc = new NCCreatePage(page);
  const src = profile.nc || {};
  const filled = [];

  const tryFill = async (label, fn) => {
    try { await fn(); filled.push(label); } catch (e) { note(`  ${label}: ${firstLine(e)}`); }
  };

  await tryFill('NC Description', async () => {
    await nc.ncDescriptionInput.fill('Linked NC raised by automation (G-01)');
  });
  // Defect Type is a searchable dropdown on the standalone NC form since
  // 2026-09-17, and its options are derived from the NC's activity data — so
  // this asks for the profile's preference and accepts whatever the panel
  // actually offers. Routed through RFIReviewPage rather than NCCreatePage
  // because that one is adaptive: dropdown if the PANEL has one too, the old
  // free-text input if it does not.
  await tryFill('Defect Type', async () => {
    const review = new RFIReviewPage(page);
    const picked = await review.setLinkedNcDefectType(0, src.defectType || '__first__');
    note(`  Defect Type set to "${picked}"`);
  });
  await tryFill('Category', async () => {
    await nc.selectDropdownOption(nc.categoryDropdown, src.category || 'Critical');
  });
  // May be auto-filled by the app from the Defect Type — only filled if empty.
  await tryFill('Target Date', async () => {
    const { autoFilled, value } = await nc.selectTargetDateIfEmpty(src.targetDateClosureDays || 14);
    note(`  Target Date ${autoFilled ? 'auto-filled by app' : 'filled by automation'}: ${value}`);
  });
  await tryFill('NC Quantity', async () => {
    await nc.ncQuantityInput.fill(String(src.ncQuantity || 1));
  });
  await tryFill('Unit of Measurement', async () => {
    await nc.selectDropdownOption(nc.unitDropdown, src.unit || 'EA');
  });

  note(`linked NC panel filled: [${filled.join(', ')}]`);
  return filled;
}

// Captures into a specific photo box, reporting instead of throwing — the
// camera modal has documented timing hazards (BasePage.capturePhoto) and a
// failure here should not hide the rest of the map this run is building.
async function review_capture(page, container) {
  const review = new RFIReviewPage(page);
  await review.capturePhoto(container).catch((e) => note(`NC photo capture failed: ${firstLine(e)}`));
  await page.waitForTimeout(800);
}

// Candidate locators for the un-driven parts. Each is a GUESS until the first
// run says otherwise, which is why every one of them is probed and reported
// rather than awaited blindly.
function raiseNcCheckbox(page) {
  return page.getByRole('checkbox', { name: /raise\s*nc/i }).first();
}
function raiseNcAnyControl(page) {
  return page.getByText(/raise\s*nc/i).first();
}
function ncDescriptionField(page) {
  return page
    .getByPlaceholder(/nc description|description/i)
    .or(page.getByRole('textbox', { name: /nc description/i }))
    .first();
}

// Picks a work section the app will actually accept, learning from its own
// rejection. Same approach as spec 34 — `selectWorkSection(null)` means "first
// option", NOT "first FREE option", which is the trap framework doc section 11
// records and which made spec 34 permanently fail on its second run.
async function createRfiOnFreeSection(page, fixture) {
  const excluded = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const { rfiCreate } = await fillPageOne(page, fixture.baseData, fixture.checkpoint, '__skip__');
    const chosen = await rfiCreate.selectWorkSection(null, { exclude: excluded });
    const outcome = await rfiCreate.clickProceedAndCheckOutcome();

    if (outcome.proceeded) {
      note(`work section "${chosen}" accepted (attempt ${attempt})`);
      return chosen;
    }

    const taken = (outcome.toastText || '').match(/workSections?:\s*([^.]+)/i);
    const names = taken ? taken[1].split(',').map((x) => x.trim()).filter(Boolean) : [chosen];
    for (const n of names) if (n && !excluded.includes(n)) excluded.push(n);
    note(`attempt ${attempt}: "${chosen}" refused (${JSON.stringify(outcome.toastText)}); retrying`);
    await resetToMyTasks(page);
  }
  throw new Error(`Could not find a free work section after 6 attempts; excluded: ${excluded.join(', ')}`);
}

test.describe('RFI <-> NC linkage (G-01): Raise NC from a Not-Ok checklist item', () => {
  let profile, fixture, users, page, context;

  test.beforeAll(async ({ browser }) => {
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    profile = getProfile(PROFILE_KEY);

    const area = (profile.featureGround && profile.featureGround.ncBlock) || profile.demapWorkArea;
    expect(area, `Profile "${profile.key}" declares no ncBlock/demap area for this to run on`).toBeTruthy();
    fixture = resolveRfiFixture(profile, { workArea: area });
    users = resolveSmokeUsers(profile, ['CI', 'EE', 'QI']);

    context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();

    console.log(
      `\n=== RFI<->NC linkage (G-01): "${profile.key}" ===\n` +
      `    ground    : ${fixture.baseData.workLocation} / ${area}  (leaves a rejected RFI + open NC behind, by design)\n` +
      `    checkpoint: ${fixture.checkpoint.name}\n` +
      `    CI ${users.CI.email}\n    EE ${users.EE.email}\n    QI ${users.QI.email}\n`
    );
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  // -------------------------------------------------------------------------
  test('CI raises an RFI, EE approves it through to QI', async () => {
    test.setTimeout(25 * 60 * 1000);

    await loginAsFlowUser(page, users.CI.email, PASSWORD);
    await createRfiOnFreeSection(page, fixture);

    const checklist = new RFIChecklistPage(page);
    const filled = await checklist.fillAllObservations('OK - linkage test (G-01)');
    expect(filled, 'the checklist should render at least one observation row').toBeGreaterThan(0);
    await checklist.submitRFI();

    const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
    expect(match, `Could not read an RFI id from the post-submit URL: ${page.url()}`).toBeTruthy();
    rfiId = match[1];
    rfiCode = await getVisibleCodeFor(page, rfiId);
    note(`CI submitted ${rfiCode}`);

    // EE has to approve before QI can see it — the flow lesson spec 34 taught
    // the hard way (EE and QI are NOT symmetric observers).
    await loginAsFlowUser(page, users.EE.email, PASSWORD);
    await openFromPendingWithMe(page, rfiCode);
    await new RFIReviewPage(page).approve();
    note(`EE approved ${rfiCode} — now with QI`);
    await resetToMyTasks(page).catch(() => {});
  });

  // -------------------------------------------------------------------------
  test('QI: "Raise NC" is absent until an item is marked Not Ok, then appears', async () => {
    test.setTimeout(25 * 60 * 1000);
    expect(rfiCode, 'the previous step must have produced an RFI').toBeTruthy();

    await loginAsFlowUser(page, users.QI.email, PASSWORD);
    await openFromPendingWithMe(page, rfiCode);

    const review = new RFIReviewPage(page);
    await review.goToChecklistPage().catch(() => {});
    await review.expandAllChecklist().catch(() => {});
    await page.waitForTimeout(1000);

    // BEFORE: the checkbox must not be offered on an untouched checklist.
    const before = await raiseNcAnyControl(page).isVisible().catch(() => false);
    note(`before marking Not Ok: any "Raise NC" control visible = ${before}`);

    // Mark the FIRST item Not Ok. force:true is required — RFIReviewPage records
    // that this radio group's real <input> sits under a styled sibling that
    // permanently intercepts pointer events, so a plain click never lands.
    const notOk = page.getByRole('radio', { name: 'Not Ok' }).first();
    await notOk.waitFor({ state: 'attached', timeout: 15000 });
    await notOk.click({ force: true });
    await page.waitForTimeout(1500);

    const after = await raiseNcAnyControl(page).isVisible().catch(() => false);
    const asCheckbox = await raiseNcCheckbox(page).isVisible().catch(() => false);
    note(`after marking Not Ok : any "Raise NC" control visible = ${after} (as a checkbox role = ${asCheckbox})`);

    // THE DOCUMENTED CLAIM, and the one thing here a single observation settles.
    expect(
      after,
      'section 10 states that marking a checklist item Not OK reveals a "Raise NC" checkbox for ' +
      'that item. Nothing matching /raise nc/i became visible after the Not Ok click. Either the ' +
      'reveal does not happen (a real finding), or the control is worded differently and this ' +
      "spec's locator needs correcting — the surface dump in the final test says which."
    ).toBe(true);

    expect(
      before,
      'and it must NOT be offered before an item is marked Not Ok — otherwise the "reveal" is ' +
      'not a reveal at all and the rule as documented is wrong.'
    ).toBe(false);
  });

  // -------------------------------------------------------------------------
  test('QI checks Raise NC, and the linked NC + rejection are reported', async () => {
    test.setTimeout(25 * 60 * 1000);

    // THE SAME PROVEN REJECT AS SPEC 36 (app owner, 2026-09-27: keep the expected
    // behaviour as spec 36). Two earlier shapes of this step completed a reject
    // that carried NO linked NC, so test 4 then judged an RFI with nothing
    // blocking it:
    //   * the standalone NC form's locators never matched the panel's fields,
    //     and the panel sat below the viewport (seen live by the app owner);
    //   * the submit redirected to /my-tasks — a PAGE-1 reject's signal. A
    //     CHECKLIST reject keeps QI on the RFI and flips the breadcrumb to
    //     'Pending with others' (linked-nc-flow.rejectWithLinkedNcs).
    // The RFI is reopened first so test 2's unsaved Not Ok click is discarded;
    // rejectWithLinkedNcs then re-asserts the reveal, marks the item Not Ok WITH
    // a remark, fills the panel (photo included) and submits the checklist
    // rejection, asserting the RFI left QI's queue.
    const flow = createLinkedNcFlow({ page, note });
    await flow.openRfiRow(rfiCode);
    await flow.rejectWithLinkedNcs(rfiCode, [{
      index: 0,
      remark: 'Not Ok - RFI <-> NC linkage (G-01, spec 35)',
      nc: LINKED_NC,
    }]);
    // rejectWithLinkedNcs throws unless the reject completed, so reaching here
    // IS the precondition test 4 relies on.
    rejectCompleted = true;
    note(`reject-with-linked-NC completed for ${rfiCode}: ${LINKED_NC.description}`);
  });

  // -------------------------------------------------------------------------
  test('CI cannot resubmit while the linked NC is open (the rule that matters)', async () => {
    test.setTimeout(25 * 60 * 1000);

    await loginAsFlowUser(page, users.CI.email, PASSWORD);

    // EXPECTED BEHAVIOUR (app owner, 2026-09-27, same as spec 36): the rejected
    // RFI OPENS for CI and Proceed is allowed; the validation fires at the final
    // SUBMIT. So the attempt is driven all the way to Submit, by the same helper
    // spec 36 uses, and only a completed Submit breaks the rule. The earlier
    // version failed as soon as CI reached the checklist page, which is the app
    // working as intended.
    // PRECONDITION: a linked NC really exists. A reject can complete WITHOUT one
    // (the 2026-09-27 run did exactly that), and an RFI with no linked NC is no
    // evidence about this rule. Found by the unique description, as in spec 36.
    const flow = createLinkedNcFlow({ page, note });
    const ciNcs = await flow.ncCodesInPendingWithMe();
    const found = await flow.findLinkedNc(ciNcs, [], LINKED_NC.description);
    note(`linked NC lookup: ${found.tried.join(' | ') || '(CI has no NCs)'}`);
    expect(
      found.code,
      `No NC in CI's queue carries the description QI typed ("${LINKED_NC.description}"), so the ` +
      `reject of ${rfiCode} did not create a linked NC. The rule cannot be judged on this RFI — ` +
      `check test 3's panel fill first.`
    ).toBeTruthy();
    note(`linked NC for ${rfiCode}: ${found.code}`);

    const attempt = await flow
      .attemptRfiResubmit(rfiCode, 'Resubmit attempt while the NC is open (G-01, spec 35)');
    const resubmitSucceeded = attempt.submitted;
    const resubmitOutcome =
      `reachable=${attempt.reachable} proceeded=${attempt.proceeded} submitted=${attempt.submitted}` +
      `${attempt.toastText ? ` — app said: ${JSON.stringify(attempt.toastText)}` : ''}`;
    note(`CI resubmit attempt: ${resubmitOutcome}`);
    note(`the block is enforced at: ${!attempt.reachable
      ? 'the rejected RFI stays out of CI\'s "Pending with me"'
      : !attempt.proceeded ? 'Proceed (page 1)' : 'the final Submit'}`);
    await resetToMyTasks(page).catch(() => {});

    console.log('');
    console.log('--- G-01 findings ---');
    for (const n of notes) console.log(`  ${n}`);

    // THE RULE. Satisfied by either shape; violated only if CI actually got
    // through. Stated so the failure message says which half broke.
    // Belt and braces: even if the precondition above were ever relaxed, rule
    // (4) must never be evaluated against an RFI that was not actually rejected.
    expect(
      rejectCompleted,
      'rule (4) can only be judged on a genuinely rejected RFI, and the reject did not complete'
    ).toBe(true);

    expect(
      resubmitSucceeded,
      `RULE (4) IS NOT HOLDING. docs/rfi-business-logic.md section 10 states CI cannot resubmit ` +
      `an RFI while a linked NC is still open, but CI SUBMITTED the resubmit of ${rfiCode}. ` +
      `Resubmit outcome: ${resubmitOutcome}. ` +
      `If the reject-with-NC did not actually complete this run, that is the thing to check first ` +
      `— an RFI that was never rejected is not evidence about resubmission.`
    ).toBe(false);

    expect(notes.length, 'the run should have produced findings').toBeGreaterThan(0);
  });
});

// Submitting the review after checking Raise NC.
//
// CORRECTED after run 1. The first version clicked the confirm button and
// reported "confirmed" — but the dialog it found read
//
//   "Reject RFI Details  Remarks *  Reject"
//
// i.e. the reject dialog carries a MANDATORY Remarks field, and nothing had
// filled it. So the reject very likely never completed, and the run's headline
// observation ("the rejected RFI is not in CI's queue") was ambiguous between
// "the linked NC blocks it" and "it was never rejected at all" — which is the
// difference between rule (4) holding and the test proving nothing.
//
// Now uses RFIReviewPage's own PROVEN locators (rejectPopup /
// rejectRemarksInput / rejectPopupButton) and its documented completion signal:
// the app's own redirect back to /my-tasks, which that page object records as
// the only reliable indicator that a rejection finished server-side.
async function submitRejectWithNc(page, review, remarks) {
  // "REJECT RFI", NOT "SUBMIT" — corrected from run 4's screenshot.
  //
  // The panel's footer carries Close / Reject RFI / Submit. Submit is the
  // APPROVE path, so clicking it with a Not-Ok item and a half-filled NC just
  // no-ops (this app's documented silent-no-op on invalid mandatory fields), and
  // three runs read that as "the reject dialog never appeared". Raising an NC is
  // a rejection, so Reject RFI is the button — and RFIReviewPage already models
  // it, including the remarks popup it opens.
  const rejectBtn = review.rejectRfiButton;
  if (!(await rejectBtn.isVisible().catch(() => false))) return 'no "Reject RFI" button visible';
  await rejectBtn.click({ force: true }).catch(() => {});

  const appeared = await review.rejectPopup
    .waitFor({ state: 'visible', timeout: 20000 })
    .then(() => true).catch(() => false);
  if (!appeared) {
    const toast = (await page.locator('[data-scope="toast"], [role="alert"]').first()
      .innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    return `reject dialog never appeared${toast ? `; toast ${JSON.stringify(toast.slice(0, 160))}` : ''}`;
  }

  await review.rejectRemarksInput.fill(remarks).catch(() => {});
  await review.rejectPopupButton.click().catch(() => {});

  const redirected = await page.waitForURL('**/my-tasks', { timeout: 30000 })
    .then(() => true).catch(() => false);
  return redirected
    ? 'reject submitted and the app redirected to /my-tasks (its own completion signal)'
    : 'reject clicked but the app did NOT redirect to /my-tasks — it may not have completed';
}
