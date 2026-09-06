const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { openFromPendingWithMe } = require('./rfi-nav');
const { getVisibleCodeFor } = require('./rfi-dependency-flow');
const { walkAndCreateRfi } = require('./rfi-smoke-walk');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIListPage = require('../pages/RFIListPage');
const DashboardPage = require('../pages/DashboardPage');
const MyTasksPage = require('../pages/MyTasksPage');

// THE 9-TC RFI TURN DRIVER FOR THE SMOKE CHAIN.
//
// Mirrors what rfi-flow-turns.js does for the regression — one function per
// actor, each doing every step currently owed by that actor — but takes its
// tracker, its users and its data as PARAMETERS instead of reading module-level
// globals. That is the whole reason it is a separate file:
//
//   * rfi-flow-turns.js requires ./tracker-utils at MODULE scope, so importing
//     anything from it would pull the regression's fixtures/rfi-tracker.json into
//     this file's module graph. The smoke chain must never read or write that
//     file — see docs/smoke-e2e-framework.md section 5.
//   * its turn functions call loginAsRole(page, role), which reads
//     CI_EMAIL/EE_EMAIL/QI_EMAIL from .env — the SOLAR REGRESSION accounts.
//     Smoke logs in as users it created itself.
//   * its RFI_DATA is a single hardcoded S05b/BL02 constant. Smoke resolves its
//     work area per (flow, viewport) from the profile.
//
// WHAT IS REUSED rather than reimplemented: every page object, the
// (work area x checkpoint) walk in rfi-smoke-walk.js, openFromPendingWithMe's
// UI-first navigation, and getVisibleCodeFor's DRAFT-race-dodging code re-read.
// The UI knowledge lives there and is not duplicated here.
//
// SESSION MODEL. These functions take a page that is ALREADY logged in as the
// right role and keep it for the whole run — the caller opens one context per
// role, in parallel, and round-robins turns between them (the model proven by
// 21_rfi_flow_single_session.spec.js). That is worth roughly 9 logins per pass:
// a per-actor-turn login costs 3-6 minutes, serially.

const FAILURE_DIR = path.join('test-results', 'smoke-rfi-failures');

// Per-TC data the REGRESSION never needs and so never stores: it drives one
// global RFI_DATA, whereas each smoke TC can land on a different work area (on
// wind, deliberately — one area per TC). The resubmit and review steps need to
// know which area/checkpoint THIS TC used, and that must survive across rounds,
// so it lives on the tracker entry.
function patchTc(tracker, tcId, fields) {
  const t = tracker.load();
  Object.assign(t[tcId], fields);
  tracker.save(t);
}

// Builds everything the turns need out of one profile plus the resolved pool, so
// the spec stays thin and the two viewports cannot diverge in how they read it.
function makeRfiContext({ profile, tracker, pool, viewport, log = console.log }) {
  const rfi = profile.rfi;

  // Page-1 data for one checkpoint. subActivity varies PER CHECKPOINT (the
  // activity master's rows are 1:1 with (Sub-Activity, Checkpoint) pairs and the
  // form's Checkpoint dropdown is scoped by the selected Sub-Activity), so it
  // cannot be one flat constant.
  // Sub-package and activity come from the CHECKPOINT ENTRY when it carries them,
  // falling back to the profile's single values.
  //
  // That is what lets one chain span SEVERAL activities. Consumption is per
  // (activity/checkpoint, work section), so varying the activity on the same work
  // area re-exposes that area's section — which is the difference between wind
  // needing one work area per TC and needing one area per FIVE TCs. Solar's chain
  // carries neither field, so it still resolves to the profile exactly as before.
  const baseDataFor = (cp, workArea) => ({
    workLocation: rfi.workLocation,
    workArea,
    package: rfi.package,
    subPackage: cp.subPackage || rfi.subPackage,
    activity: cp.activity || rfi.activity,
    subActivity: cp.subActivity,
    rfiQuantity: rfi.rfiQuantity,
    unit: rfi.unit,
    subContractor: rfi.subContractor,
  });

  // Work Section resolution differs FUNDAMENTALLY by project type, driven off the
  // profile's declared granularity rather than a project-type check:
  //
  //   WIND  one-per-work-area, and the section is NAMED AFTER the area
  //         ("WTG 423" => "WTG 423"), so it must track whichever area this TC
  //         resolved to. Hardcoding it would select the wrong section the moment
  //         a second TC runs on a different area.
  //   SOLAR many-per-work-area (264 for Piling - MMS on this band). null means
  //         "take the first available", which yields a FRESH section every time
  //         and is why solar never exhausts.
  const resolveWorkSection = (workArea) => {
    if (rfi.workSection) return rfi.workSection;
    return profile.workSectionGranularity === 'one-per-work-area' ? workArea : null;
  };

  return {
    profile, tracker, pool, viewport, log,
    baseDataFor, resolveWorkSection,
    observationValue: rfi.observationValue,
    // SOFT PROBLEMS — assertion failures that must FAIL THE RUN but must NOT
    // stop the TC or roll back its tracker step.
    //
    // The distinction exists because of a real desync, found live 2026-09-03:
    // TC-02's resubmit SUCCEEDED and the app moved the RFI on to EE, but the
    // code assertion that ran afterwards threw — so markFailed fired and the
    // step was never advanced. The tracker then said "CI still owes a resubmit"
    // while the app said "this is pending with EE", and reviving the TC looked
    // for a row that had correctly left CI's queue (RFI_NOT_VISIBLE_TO_ACTOR).
    //
    // The rule this encodes: advance the step as soon as the ACTION is
    // confirmed, and report anything discovered afterwards through here instead
    // of by throwing. A verification about a detail must not corrupt the record
    // of what the app actually did.
    problems: [],
    // Declared by the profile, not inferred from a project-type check, so a new
    // project type states its own behaviour rather than inheriting one.
    manyPerArea: profile.workSectionGranularity === 'many-per-work-area',
  };
}

// Screenshot + HTML dump at the moment of failure. Playwright's own
// screenshot-on-failure never fires for these: the error is caught deliberately
// so the round-robin can keep processing the OTHER TCs, so the test() never sees
// it where it happened. Best-effort — a failed capture must not mask the real
// error.
async function captureFailureEvidence(page, tcId, stage) {
  const out = { screenshotPath: null, htmlPath: null, url: null };
  try {
    fs.mkdirSync(FAILURE_DIR, { recursive: true });
    const safe = (tcId + '-' + stage).replace(/[^A-Za-z0-9._-]+/g, '-');
    const base = path.join(FAILURE_DIR, safe);
    out.url = page.url();
    await page.screenshot({ path: base + '.png', fullPage: true });
    out.screenshotPath = base + '.png';
    fs.writeFileSync(base + '.html', await page.content());
    out.htmlPath = base + '.html';
  } catch {
    // deliberately swallowed — see above
  }
  return out;
}

async function failTc(page, ctx, tcId, err, stage, scenario = null) {
  const reason = String((err && err.message) || err);
  // PICK UP THE SOURCE-TAGGED SCENARIO. rfi-nav.js sets
  // err.negativeScenario = 'RFI_NOT_VISIBLE_TO_ACTOR' at the one place that
  // failure can actually occur — the previous actor's action reported success
  // but the RFI never became visible to the next actor. That is the class of
  // finding worth escalating to the app owner, distinct from a login failure or
  // a locator that changed shape.
  //
  // Without reading it here the summary would file those under UNCLASSIFIED and
  // lose the most useful diagnostic the suite produces — and the
  // reject -> resubmit handoff that TCs 02-09 exercise is exactly where it
  // fires. Deliberately generic: a NEW tag added at a throw site is picked up
  // here with no change to this file.
  const tag = scenario || (err && err.negativeScenario) || null;
  const evidence = await captureFailureEvidence(page, tcId, stage);
  ctx.tracker.markFailed(ctx.tracker.load(), tcId, reason, { stage, scenario: tag, ...evidence });
  ctx.log('  !! ' + tcId + ' FAILED at [' + stage + ']' +
    (tag ? ' {' + tag + '}' : '') + ': ' + reason.split('\n')[0]);
  if (evidence.screenshotPath) ctx.log('     evidence: ' + evidence.screenshotPath);
}

// Re-checks the CURRENT role's "Pending with me" for a code. listRowCodes() is
// layout-aware (grid cells on desktop, card titles on mobile), so membership is
// both cleaner than a row locator and safe on a viewport that has no grid.
async function isStillPendingWithMe(page, rfiCode) {
  const dashboard = new DashboardPage(page);
  await dashboard.closeAnyOpenDialog();
  await dashboard.dismissToastIfPresent();
  await dashboard.goToMyTasks();

  const myTasks = new MyTasksPage(page);
  await myTasks.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
  await myTasks.clickPendingWithMe();

  const codes = await new RFIListPage(page).listRowCodes();
  return codes.some((c) => c.trim() === String(rfiCode).trim());
}

// ---------------------------------------------------------------------------
// CI: create, and resubmit after a rejection
// ---------------------------------------------------------------------------
async function createFor(page, ctx, tcId) {
  // Work sections THIS tracker has already consumed. Handed to the walk up
  // front instead of letting the form reveal them, because availability does
  // not propagate instantly after a create (confirmed live — see seedExclude in
  // rfi-smoke-walk.js). Nine creates back-to-back in one session all sit inside
  // that lag window, so without this each TC would waste one rejected attempt
  // per section the earlier TCs took.
  const alreadyUsed = Object.values(ctx.tracker.load())
    .map((tc) => tc.workSection)
    .filter(Boolean);

  const result = await walkAndCreateRfi(page, {
    chain: ctx.profile.rfi.checkpointChain,
    pool: ctx.pool,
    seedExclude: alreadyUsed,
    baseDataFor: ctx.baseDataFor,
    resolveWorkSection: ctx.resolveWorkSection,
    observationValue: ctx.observationValue,
    // Lets the walk try a DIFFERENT work section when the server rejects one as
    // already used. Only safe where there are several per area — on wind each
    // attempt spends the area's only pair, so it stays off. See the walk's
    // header on why the app's own option list and summary cannot be trusted to
    // tell a spent section from a free one.
    manyPerArea: ctx.manyPerArea,
    log: (m) => ctx.log(m),
  });

  ctx.tracker.setId(ctx.tracker.load(), tcId, result.rfiId, result.rfiCode);
  patchTc(ctx.tracker, tcId, {
    workArea: result.workArea,
    // The section the SAVED RECORD holds, read back from its view page rather
    // than taken from the label returned at click time — those have been proven
    // to diverge (see the read-back in rfi-smoke-walk.js).
    //
    // Load-bearing twice over: it seeds the next create's exclusion set (see
    // alreadyUsed above), and it is what a resubmit must re-select if the
    // rejection cleared the field — picking "first option" there would grab a
    // DIFFERENT, possibly already-taken section instead of this RFI's own.
    workSection: result.workSection,
    // Kept for diagnosis only. When these two differ, the selection did not
    // land where selectWorkSection reported — worth noticing rather than
    // silently overwriting.
    clickedWorkSection: result.clickedWorkSection,
    workSectionVerified: result.workSectionVerified,
    checkpointCode: result.checkpoint.code,
    subActivity: result.checkpoint.subActivity,
    checklist: result.checkpoint.checklist,
    // Bookend checkpoints whose only checklist is the generic "Documents and
    // report information" may legitimately render zero observation inputs.
    expectObservations: result.checkpoint.expectObservations !== false,
    observationCount: result.observationCount,
  });

  ctx.log(
    '  >> ' + tcId + ': CI created ' + result.rfiCode + ' (id ' + result.rfiId + ') on ' +
    result.checkpoint.code + ' [' + result.checkpoint.subActivity + '] @ ' + result.workArea
  );
}

async function resubmitFor(page, ctx, tcId) {
  const tc = ctx.tracker.load()[tcId];
  expect(tc.rfiCode, tcId + ' has no RFI code recorded, so there is nothing to resubmit').toBeTruthy();

  await openFromPendingWithMe(page, tc.rfiCode, 'CI resubmit for ' + tcId, { exact: true });

  // A rejected RFI opens CI STRAIGHT onto the editable /re-submit form — there is
  // no read-only /view carrying a separate Resubmit button (confirmed live
  // 2026-09-01). The button lookup stays as a fallback in case some route does.
  if (!page.url().includes('/re-submit')) {
    const btn = page.getByRole('button', { name: /resubmit|edit/i }).first();
    await btn.waitFor({ state: 'visible', timeout: 15000 });
    await btn.click();
    await page.waitForLoadState('networkidle').catch(() => {});
  }

  const createPage = new RFICreatePage(page);

  // THE ASSERTION THAT MATTERS — the real behavioural difference between the two
  // reject origins, and the only thing distinguishing TC-02 from TC-03:
  //   rejected from page 1    -> page 1 EDITABLE on resubmit
  //   rejected from checklist -> page 1 LOCKED on resubmit
  const rejectPage = ctx.tracker.getLastRejectPage(tc);
  const locked = await createPage.isFirstPageLocked();
  ctx.log('  ' + tcId + ': rejected from ' + rejectPage + '; page 1 locked on resubmit = ' + locked);
  expect(
    locked,
    rejectPage === 'P2'
      ? tcId + ': page 1 should be LOCKED after a checklist-page rejection'
      : tcId + ': page 1 should be EDITABLE after a page-1 rejection'
  ).toBe(rejectPage === 'P2');

  // A P1-rejected resubmit has been observed arriving with the Work Section
  // selection EMPTY and the field outlined in red, so Proceed silently refuses to
  // advance with no toast at all — which looked exactly like the long-standing
  // "Proceed did not navigate" bug but was plain failed validation.
  //
  // Driven off the form's OWN summary rather than off the reject mode, so it is
  // correct wherever the app happens to retain the selection (P2 resubmits keep
  // it; solar P1 resubmits have been seen keeping it too). selected === 0 means
  // re-select.
  //
  // STILL A SUSPECTED WORKAROUND, not a confirmed fix: the app owner reports
  // cookie issues where logging in as another role in the same session can leave
  // partial RFI data visible. The three-contexts-one-per-role model here removes
  // that role hopping entirely, so if this branch STOPS firing under it, role
  // hopping was the cause and this block can go.
  const ws = await createPage.readWorkSectionSummary().catch(() => null);
  if (ws) {
    ctx.log(
      '  ' + tcId + ': work section summary on resubmit: total=' + ws.total +
      ' selected=' + ws.selected + ' pending=' + ws.pending
    );
  }
  // Tracks whether the Work Section this resubmit ends up on is the SAME one the
  // RFI was raised against. It matters beyond tidiness: per the app owner the
  // visible code is determined by Work Location + Work Area + Package + WORK
  // SECTION + INSPECTION CHECKLIST, so changing the section changes an input to
  // the code — and the DRAFT fallback below is only valid while every input is
  // unchanged.
  let sectionUnchanged = true;

  if (ws && ws.selected === 0) {
    // THIS RFI's OWN section, recorded at create time — not resolveWorkSection's
    // answer. On wind the two agree (one section per area, named after it), but
    // on solar resolveWorkSection returns null, which means "first option" and
    // would attach the resubmit to a DIFFERENT section — quite possibly one
    // another TC already consumed. Falls back only if nothing was recorded.
    const section = tc.workSection || ctx.resolveWorkSection(tc.workArea);
    ctx.log('  ' + tcId + ': work section was cleared by the rejection; re-selecting "' + section + '"');
    const picked = await createPage.selectWorkSection(section);
    if (tc.workSection && picked && String(picked).trim() !== String(tc.workSection).trim()) {
      sectionUnchanged = false;
      ctx.log(
        '  ' + tcId + ': WARNING — re-selected "' + picked + '" but this RFI was raised on "' +
        tc.workSection + '". That changes an input to the visible code.'
      );
    }
  }

  await createPage.clickProceed();

  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations(ctx.observationValue, true, {
    requireObservations: tc.expectObservations !== false,
  });
  await checklist.submitRFI();

  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  expect(match, tcId + ': could not extract the new RFI id after resubmit; URL was ' + page.url()).toBeTruthy();
  const newId = match[1];

  // Resubmitting creates a NEW CHILD RECORD with its own id; the original is
  // archived and every later step must use the new one. This comes from the URL,
  // so it is immediately reliable — assert it first and unconditionally.
  expect(newId, tcId + ': resubmitting should create a NEW child record with its own id').not.toBe(tc.rfiId);

  // THE CODE IS NOT FINALIZED IMMEDIATELY AFTER A RESUBMIT. Confirmed live
  // 2026-09-03: 5 of 9 TCs read back "RFI-S05b-BL03-CIV-DRAFT" here while the
  // other 4 — including two with TWO resubmits each — read the real code. So it
  // is a race, not a rule, and getVisibleCodeFor does a single read with no
  // retry. rfi-flow-turns.js sidesteps it by recording null and letting a later
  // step backfill; this stage cannot do that, because its review turns find the
  // row BY code.
  //
  // So: poll briefly, and if it is still a DRAFT placeholder, KEEP THE ORIGINAL
  // CODE rather than failing. That is not a guess, but it IS conditional. Per
  // the app owner (2026-09-03) the code is determined by FIVE inputs — Work
  // Location, Work Area, Package, WORK SECTION and INSPECTION CHECKLIST — and a
  // resubmit that changes none of them cannot change the code, so the original
  // IS the child's code. `sectionUnchanged` above is what makes that conditional
  // checkable rather than assumed; an earlier version of this comment listed
  // only three inputs and would have justified the fallback in a case where the
  // code could legitimately have moved.
  //
  // The claim is then proven for real by the very next step: the reviewer opens
  // the row via an EXACT-match lookup on this code. If the code had changed,
  // that lookup could not possibly succeed.
  // ADVANCE FIRST, VERIFY SECOND. The new id in the URL is proof the resubmit
  // landed, so the tracker is brought in line with the app HERE — before any
  // check that could throw. The code is recorded provisionally as the original,
  // which is correct while all five inputs are unchanged and, crucially, is
  // always a findable value for the next reviewer's lookup.
  ctx.tracker.advanceStep(ctx.tracker.load(), tcId, { newId, newCode: tc.rfiCode });
  ctx.log('  >> ' + tcId + ': CI resubmitted (new id ' + newId + '), step advanced');

  let newCode = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    newCode = await getVisibleCodeFor(page, newId).catch(() => null);
    if (newCode && !/draft/i.test(newCode)) break;
    ctx.log('  ' + tcId + ': code reads "' + newCode + '" (attempt ' + attempt + '/3) — not finalized yet');
    if (attempt < 3) await page.waitForTimeout(5000);
  }

  if (newCode && !/draft/i.test(newCode)) {
    if (String(newCode).trim() !== String(tc.rfiCode).trim()) {
      // Record the REAL code so the reviewers can still find the row, then report
      // the discrepancy as a soft problem rather than throwing — the resubmit
      // itself was fine, and stopping here would desync the tracker again.
      ctx.tracker.setCode(ctx.tracker.load(), tcId, newCode);
      const msg = tcId + ': the code CHANGED on resubmit ("' + tc.rfiCode + '" -> "' + newCode +
        '") even though work location, work area, package, work section and inspection ' +
        'checklist were all meant to be unchanged' +
        (sectionUnchanged ? '' : ' — NOTE the work section did change, which explains it');
      ctx.problems.push(msg);
      ctx.log('  !! ' + msg);
    } else {
      ctx.log('  ' + tcId + ': code confirmed unchanged at "' + newCode + '"');
    }
  } else if (sectionUnchanged) {
    ctx.log(
      '  ' + tcId + ': code still not finalized; keeping "' + tc.rfiCode + '". ' +
      'The next reviewer\'s exact-code lookup is the real proof it did not change.'
    );
  } else {
    // Both at once: the code could not be read AND an input to it changed, so the
    // provisional original may be wrong. Reported rather than thrown, for the
    // same reason as above; the next reviewer's lookup will fail loudly if the
    // provisional code is indeed stale.
    const msg = tcId + ': could not read the resubmitted code (got "' + newCode + '") AND the ' +
      'work section changed from "' + tc.workSection + '", which is an input to the code — ' +
      'so the recorded code may be stale';
    ctx.problems.push(msg);
    ctx.log('  !! ' + msg);
  }
}

async function runCITurn(page, ctx) {
  const pending = ctx.tracker.getPendingStepsForActor(ctx.tracker.load(), 'CI');
  if (!pending.length) { ctx.log('  CI: nothing pending'); return; }
  ctx.log('  CI: ' + pending.length + ' TC(s) pending -> ' +
    pending.map((p) => p.tcId + ':' + p.step.action).join(', '));

  // Each TC is caught individually so one failure cannot abandon the other
  // eight — the whole point of the round-robin.
  for (const { tcId, step } of pending) {
    try {
      if (step.action === 'create') await createFor(page, ctx, tcId);
      else if (step.action === 'resubmit') await resubmitFor(page, ctx, tcId);
      else throw new Error('Unexpected CI action "' + step.action + '" for ' + tcId);
    } catch (err) {
      await failTc(page, ctx, tcId, err, 'CI ' + step.action);
    }
  }
}

// ---------------------------------------------------------------------------
// EE and QI: identical mechanics by design — the app owner has confirmed both
// reviewers act the same way — so one parameterised function, not two copies.
// ---------------------------------------------------------------------------
async function runReviewTurn(page, ctx, role) {
  const pending = ctx.tracker.getPendingStepsForActor(ctx.tracker.load(), role);
  if (!pending.length) { ctx.log('  ' + role + ': nothing pending'); return; }
  ctx.log('  ' + role + ': ' + pending.length + ' TC(s) pending -> ' +
    pending.map((p) => p.tcId + ':' + p.step.action + (p.step.page ? '/' + p.step.page : '')).join(', '));

  for (const { tcId, step } of pending) {
    const stage = role + ' ' + step.action + (step.page ? ' (' + step.page + ')' : '');
    try {
      const tc = ctx.tracker.load()[tcId];
      expect(tc.rfiCode, tcId + ': no RFI code recorded, so ' + role + ' has nothing to review').toBeTruthy();

      // exact: true anchors the lookup to the WHOLE code cell rather than a
      // substring — the wind code counter is global and in the thousands, so a
      // search for "...-CIV-3037" would also match "...-CIV-30370".
      await openFromPendingWithMe(page, tc.rfiCode, stage, { exact: true });

      const review = new RFIReviewPage(page);

      if (step.action === 'approve') {
        // Reach the checklist screen FIRST — a no-op on desktop, the Proceed hop
        // on mobile. Without it setAllChecklistOk counts radios on mobile page 1,
        // which has none, and returns a confident but meaningless zero.
        await review.goToChecklistPage();
        await review.expandAllChecklist().catch(() => {});

        const { total, flipped } = await review.setAllChecklistOk();
        ctx.log('  ' + tcId + ': ' + role + ' sees ' + total + ' "Ok" radio(s), flipped ' + flipped);
        // total === 0 means the radios were never reached, which is a very
        // different thing from "nothing needed changing".
        expect(total, tcId + ': ' + role + ' should see checklist radios on the review screen').toBeGreaterThan(0);

        // approve() returns NOTHING: it clicks Submit, waits for the confirm
        // popup and waits for it to close, so it throws if the approval does not
        // go through. That IS its assertion — an earlier version of this stage
        // expected a toast string back and failed on `undefined` AFTER the
        // approval had already succeeded.
        await review.approve();
        // ADVANCE HERE. approve() clicks Submit, waits for the confirm popup and
        // waits for it to close, so a return means the app accepted it — that IS
        // the confirmation. Advancing before the secondary check below keeps the
        // tracker in step with the app even if that check throws.
        ctx.tracker.advanceStep(ctx.tracker.load(), tcId, {});
        ctx.log('  >> ' + tcId + ': ' + role + ' approved ' + tc.rfiCode + ', step advanced');

        // Secondary confirmation that the approval actually moved the RFI on:
        // it must no longer sit in THIS role's queue. Reported as a soft problem
        // rather than thrown — by this point the approval has already happened,
        // and throwing would only desync the tracker from it.
        const stillPending = await isStillPendingWithMe(page, tc.rfiCode).catch(() => null);
        if (stillPending === true) {
          const msg = tcId + ': after ' + role + ' approved, ' + tc.rfiCode +
            ' is STILL in ' + role + '\'s "Pending with me" — the approval may not have taken effect';
          ctx.problems.push(msg);
          ctx.log('  !! ' + msg);
        } else if (stillPending === null) {
          ctx.log('  ' + tcId + ': (could not re-check ' + role + '\'s queue; approval already confirmed)');
        }
      } else if (step.action === 'reject') {
        const remarks = 'Automated smoke rejection from ' + step.page + ' (' + tcId + ')';
        if (step.page === 'P1') await review.rejectFromFirstPage(remarks);
        else await review.rejectFromChecklistPage(remarks);
        ctx.tracker.advanceStep(ctx.tracker.load(), tcId, {});
        ctx.log('  >> ' + tcId + ': ' + role + ' rejected ' + tc.rfiCode + ' from ' + step.page + ', step advanced');
      } else {
        throw new Error('Unexpected ' + role + ' action "' + step.action + '" for ' + tcId);
      }
    } catch (err) {
      await failTc(page, ctx, tcId, err, stage);
    }
  }
}

const runEETurn = (page, ctx) => runReviewTurn(page, ctx, 'EE');
const runQITurn = (page, ctx) => runReviewTurn(page, ctx, 'QI');

module.exports = {
  makeRfiContext, runCITurn, runEETurn, runQITurn, runReviewTurn,
  isStillPendingWithMe, patchTc, captureFailureEvidence,
};
