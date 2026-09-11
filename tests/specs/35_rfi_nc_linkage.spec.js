const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { getProfile } = require('../config/projects');
const { resolveRfiFixture } = require('../utils/smoke-rfi-fixture');
const { fillPageOne, resetToMyTasks, getVisibleCodeFor } = require('../utils/rfi-dependency-flow');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
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
  await tryFill('Defect Type', async () => {
    await nc.defectTypeInput.fill(src.defectType || 'Workmanship defect');
  });
  await tryFill('Category', async () => {
    await nc.selectDropdownOption(nc.categoryDropdown, src.category || 'Critical');
  });
  await tryFill('Target Date', async () => {
    await nc.selectTargetDate(src.targetDateClosureDays || 14);
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

    // Everything from here is REPORTED, not asserted. The submit mechanics for
    // a reject-with-NC have never been observed, and asserting a shape nobody
    // has seen would just fail for the wrong reason.
    const box = raiseNcCheckbox(page);
    const clickable = (await box.isVisible().catch(() => false)) ? box : raiseNcAnyControl(page);

    await clickable.click({ force: true }).catch((e) => note(`could not click Raise NC: ${e.message.split('\n')[0]}`));
    await page.waitForTimeout(1500);

    const descVisible = await ncDescriptionField(page).isVisible().catch(() => false);
    note(`after checking Raise NC: an NC Description field visible = ${descVisible}`);

    // Fill the whole panel, not just the description — every starred field has
    // to be valid or the app no-ops rather than complaining. See fillLinkedNcPanel.
    await fillLinkedNcPanel(page, profile);

    // What else did checking the box put on screen? This is the map the next
    // iteration is built from.
    const textboxes = await page.getByRole('textbox').count().catch(() => 0);
    const comboboxes = await page.getByRole('combobox').count().catch(() => 0);
    const photoBoxes = await page.getByText('Use Camera', { exact: false }).count().catch(() => 0);
    note(`form after Raise NC: textboxes=${textboxes} comboboxes=${comboboxes} photoBoxes=${photoBoxes}`);

    // THE LINKED NC BRINGS ITS OWN MANDATORY PHOTO, and not filling it is very
    // probably why Submit did nothing on run 3 ("reject dialog never appeared").
    //
    // Evidence: the checklist carries 16 photo boxes, and checking Raise NC
    // makes it 17 — the extra one belongs to the NC. The reference note for this
    // feature says the linked NC has "8 fields, photo required", and
    // RFIReviewPage.approve() independently documents that this app's Submit
    // SILENTLY NO-OPS on an unfilled mandatory Capture Photo rather than
    // reporting it. Those three line up exactly.
    //
    // The NEW box is the last one on the page, so that is the one filled here.
    // Reported rather than asserted: which box belongs to the NC is inferred
    // from the count going 16 -> 17, not yet confirmed.
    const beforeNcPhoto = await page.locator('img:not([alt*="logo" i])').count().catch(() => 0);
    const ncPhotoBox = page.getByText('Use Camera', { exact: false }).last();
    const boxContainer = ncPhotoBox.locator('xpath=..');
    await review_capture(page, boxContainer);
    const afterNcPhoto = await page.locator('img:not([alt*="logo" i])').count().catch(() => 0);
    note(`NC photo capture: images ${beforeNcPhoto} -> ${afterNcPhoto}`);

    const review = new RFIReviewPage(page);
    const submitted = await submitRejectWithNc(page, review, 'Linked NC raised by automation (G-01)');
    note(`submit outcome: ${submitted}`);
    rejectCompleted = /redirected to \/my-tasks/.test(submitted);

    // THE PRECONDITION, ASSERTED HERE RATHER THAN ASSUMED LATER.
    //
    // Run 3 passed this spec while the reject never happened at all ("reject
    // dialog never appeared"), because the next test's rule-(4) check is
    // satisfied by the RFI simply not being in CI's queue — which is ALSO what
    // an RFI that was never rejected looks like. The suite reported a green run
    // that had proven nothing.
    //
    // A test that can pass without exercising its subject is worse than no test,
    // so the reject completing is now its own hard assertion. Rule (4) is only
    // ever evaluated against a genuinely rejected RFI.
    expect(
      rejectCompleted,
      `The reject-with-NC did not complete, so nothing downstream can be evidence about rule (4). ` +
      `Submit outcome: ${JSON.stringify(submitted)}. ` +
      `Most likely cause: the linked NC has its own MANDATORY fields (the photo box count goes ` +
      `16 -> 17 when Raise NC is checked, and the reference note says "8 fields, photo required"), ` +
      `and RFIReviewPage.approve() documents that this app's Submit SILENTLY NO-OPS on an ` +
      `unfilled mandatory Capture Photo instead of reporting it. Fill the NC's own fields, then ` +
      `re-run.`
    ).toBe(true);
  });

  // -------------------------------------------------------------------------
  test('CI cannot resubmit while the linked NC is open (the rule that matters)', async () => {
    test.setTimeout(25 * 60 * 1000);

    await loginAsFlowUser(page, users.CI.email, PASSWORD);

    // RULE (4) CAN BE SATISFIED TWO WAYS, and they must be told apart.
    //
    // Either the rejected RFI never reaches CI's queue at all while a linked NC
    // is open, or it does and the RESUBMIT is refused. Both are "CI cannot
    // resubmit"; only the second needs an attempt to prove. Run 1 saw the first
    // shape — but with a reject that had probably never completed (the mandatory
    // Remarks field was left empty), so it proved nothing either way.
    let reachable = true;
    await openFromPendingWithMe(page, rfiCode).catch((e) => {
      reachable = false;
      note(`CI cannot open ${rfiCode} from "Pending with me": ${firstLine(e)}`);
    });
    note(`rejected RFI reachable by CI = ${reachable}`);

    let resubmitOutcome = 'not attempted (RFI not reachable)';
    let resubmitSucceeded = false;

    if (reachable) {
      // Reached the resubmit form — try to push it through and see what the app
      // says. clickProceedAndCheckOutcome reports the refusal instead of
      // throwing, which is exactly what is wanted here.
      const rfiCreate = new (require('../pages/RFICreatePage'))(page);
      const proceeded = await rfiCreate.clickProceedAndCheckOutcome()
        .catch((e) => ({ proceeded: false, toastText: `threw: ${firstLine(e)}` }));
      resubmitSucceeded = !!proceeded.proceeded;
      resubmitOutcome = proceeded.proceeded
        ? 'PROCEEDED — CI got through to the checklist page'
        : `refused${proceeded.toastText ? ` — app said: ${JSON.stringify(proceeded.toastText)}` : ''}`;
      note(`CI resubmit attempt: ${resubmitOutcome}`);
      await resetToMyTasks(page).catch(() => {});
    }

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
      `an RFI while a linked NC is still open, but CI reached the checklist page for ${rfiCode}. ` +
      `Reachable from "Pending with me" = ${reachable}; resubmit outcome = ${resubmitOutcome}. ` +
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
