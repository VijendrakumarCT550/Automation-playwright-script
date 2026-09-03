const path = require('path');
const { createFlowTracker } = require('./flow-tracker');
const { SEED_TRACKER: RFI_SEED } = require('./tracker-utils');
// OPTION C (app owner's choice, 2026-09-03) on the "keep NC files independent of
// RFI's" instruction recorded at nc-tracker-utils.js:4-6: that module is left
// COMPLETELY UNTOUCHED — it keeps its own state machine and its own
// fixtures/nc-tracker.json, so specs 15/16/17, 22 and reset-nc-tracker.js are
// unaffected. Only the SMOKE chain's NC state, which is new code, uses the
// shared flow-tracker.
//
// Importing the seed is not "sharing NC's files": SEED_TRACKER is pure data and
// nc-tracker-utils does nothing at module scope except a path.join, so this
// cannot read or write the regression's tracker. It does mean the 4-TC matrix has
// exactly one definition rather than a copy that could drift.
const { SEED_TRACKER: NC_SEED } = require('./nc-tracker-utils');

// SMOKE-CHAIN TRACKER STATE — isolated per (flow x profile x viewport x TC set).
//
// The smoke chain runs the SAME 9-TC matrix as the regression, so the TC
// definitions are IMPORTED rather than copied: tracker-utils.js does nothing at
// module scope except a path.join (it never reads the tracker file until load()
// is called), so importing SEED_TRACKER is side-effect-free and cannot touch
// fixtures/rfi-tracker.json. One source of truth for the matrix, separate state.
//
// WHY THE KEY IS THIS SPECIFIC. Desktop and mobile are separate Playwright
// projects running on separate work areas; sharing one state file would make the
// mobile run resume the desktop run's half-finished TCs against the wrong area.
// The TC set is in the key too, so a "quick" run cannot leave a 1-TC tracker that
// a later "full" run mistakes for finished.
const SMOKE_FIXTURES = path.join(__dirname, '..', 'fixtures', 'smoke');

// SMOKE_TC_SET=quick|full (default full).
//
//   full   all 9 TCs — happy path, EE-reject from P1 and P2, QI-reject from P1
//          and P2, and the four double-reject combinations.
//   quick  TC-01 ONLY, which IS the happy path (create -> EE approve -> QI
//          approve). Not a second code path: the same engine over a filtered
//          seed, so it adds no runtime to a full pass and no implementation to
//          maintain. Useful as a ~20-minute "is the app up" check, and on wind it
//          spends 1 checkpoint instead of 9.
const TC_SETS = ['quick', 'full'];

function resolveTcSet(raw = process.env.SMOKE_TC_SET) {
  const set = String(raw || 'full').trim().toLowerCase();
  if (!TC_SETS.includes(set)) {
    throw new Error(
      'Unknown SMOKE_TC_SET="' + raw + '". Valid values: ' + TC_SETS.join(', ')
    );
  }
  return set;
}

// Deep-cloned so a caller can never mutate the imported regression seed — that
// object is shared with tracker-utils.resetTracker().
function rfiSeedFor(set) {
  const full = JSON.parse(JSON.stringify(RFI_SEED));
  if (set !== 'quick') return full;
  return { 'TC-01': full['TC-01'] };
}

function createSmokeRfiTracker({ profileKey, viewport, set }) {
  const tcSet = resolveTcSet(set);
  const file = 'rfi-tracker.' + profileKey + '.' + viewport + '.' + tcSet + '.json';
  const tracker = createFlowTracker({
    trackerPath: path.join(SMOKE_FIXTURES, file),
    seed: rfiSeedFor(tcSet),
    idField: 'rfiId',
    codeField: 'rfiCode',
    createActor: 'CI',
    // A fresh smoke chain legitimately has no state yet, unlike the committed
    // regression trackers where a missing file means something is wrong.
    seedIfMissing: true,
  });
  return { tracker, tcSet, file };
}

// NC's 4-TC matrix: happy path, EE-reject, QI-reject, and both. There is no
// P1/P2 split because NC has only ONE reject mechanism (a single OK/Not-Ok
// toggle), unlike RFI's page-1-button vs per-item-checklist paths.
function ncSeedFor(set) {
  const full = JSON.parse(JSON.stringify(NC_SEED));
  if (set !== 'quick') return full;
  return { 'TC-01': full['TC-01'] };
}

function createSmokeNcTracker({ profileKey, viewport, set }) {
  const tcSet = resolveTcSet(set);
  const file = 'nc-tracker.' + profileKey + '.' + viewport + '.' + tcSet + '.json';
  const tracker = createFlowTracker({
    trackerPath: path.join(SMOKE_FIXTURES, file),
    seed: ncSeedFor(tcSet),
    idField: 'ncId',
    codeField: 'ncCode',
    // QI creates an NC — the reverse of RFI, which CI creates. A TC with no
    // ncId yet is therefore always QI's turn, whatever steps[0] says.
    createActor: 'QI',
    seedIfMissing: true,
  });
  return { tracker, tcSet, file };
}

// Decides whether this invocation resumes or starts over, and refuses to run a
// no-op that would report as a pass.
//
// DEFAULT IS RESUME, matching how the regression tracker works: a stage that
// dies at hour two picks up where it stopped rather than restarting, which at
// these runtimes is the difference between usable and not.
//
// But "every TC is already done" then reads as "nothing pending", and
// getPendingStepsForActor skips done and failed TCs identically — so without the
// check below a finished-or-failed tracker would sail through with zero work done
// and exit clean. That exact gap once let a 0/9-passed run report as cleanly as a
// 9/9-passed one (see 21_rfi_flow_single_session.spec.js).
function prepareRun(tracker, {
  reset = process.env.SMOKE_RESET,
  retryFailed = process.env.SMOKE_RETRY_FAILED,
  log = console.log,
} = {}) {
  if (reset) {
    tracker.reset();
    log('  SMOKE_RESET set — tracker reset to seed state.');
    return { reset: true };
  }

  // SMOKE_RETRY_FAILED=1 — flip failed TCs back to pending so they RESUME.
  //
  // Failed is otherwise terminal: getPendingStepsForActor skips failed and done
  // TCs identically, so a TC that died on a transient problem can only be
  // recovered by a full reset. That is expensive and wasteful — a reset
  // re-creates every TC from scratch, spending a fresh work section per TC,
  // when the failed ones already have a live RFI sitting mid-flow.
  //
  // Deliberately preserves rfiId, rfiCode, workSection and currentStepIndex, so
  // a revived TC picks up at the exact step it died on rather than creating a
  // second RFI for the same case. Only the failure record is cleared.
  if (retryFailed) {
    const t = tracker.load();
    const revived = [];
    for (const [id, tc] of Object.entries(t)) {
      if (tc.status !== 'failed') continue;
      tc.status = 'pending';
      tc.failureReason = null;
      tc.failureStage = null;
      tc.failureScenario = null;
      tc.failureScreenshot = null;
      tc.failureHtml = null;
      tc.failureUrl = null;
      revived.push(id);
    }
    if (revived.length) {
      tracker.save(t);
      log('  SMOKE_RETRY_FAILED set — revived ' + revived.length +
          ' failed TC(s) to pending, resuming in place: ' + revived.join(', '));
    } else {
      log('  SMOKE_RETRY_FAILED set, but no TC is in the failed state.');
    }
  }

  const t = tracker.load();
  const pending = ['CI', 'EE', 'QI'].some(
    (actor) => tracker.getPendingStepsForActor(t, actor).length > 0
  );
  if (pending) return { reset: false };

  const entries = Object.entries(t);
  const done = entries.filter(([, tc]) => tc.status === 'done');
  const failed = entries.filter(([, tc]) => tc.status === 'failed');
  throw new Error(
    'Nothing is pending in ' + tracker.trackerPath + ' — ' + done.length + ' TC(s) done, ' +
    failed.length + ' failed, of ' + entries.length + '. This run would do no work and ' +
    'exit clean, which is indistinguishable from a pass.\n' +
    'Re-run with SMOKE_RESET=1 to start the set over, or delete that file.' +
    (failed.length
      ? '\nFailed TCs: ' + failed.map(([id, tc]) => id + ' [' + (tc.failureStage || '?') + ']').join(', ')
      : '')
  );
}

// Renders the tracker as a stage-by-stage account. A bare "N TC(s) FAILED" line
// is not enough to trust the automation, and a TC that is neither done nor
// failed ("stuck") gets its own bucket rather than being folded into failed — it
// never got a failureReason at all, so reporting it as if it had one misleads.
function printRunSummary(tracker, roundsRun, {
  title = 'SMOKE RFI FLOW',
  log = console.log,
  // Problems detected after the app had already acted, which therefore did not
  // mark their TC failed. They belong in the returned problem list all the same.
  extraProblems = [],
} = {}) {
  const t = tracker.load();
  const entries = Object.entries(t);
  const done = entries.filter(([, tc]) => tc.status === 'done');
  const failed = entries.filter(([, tc]) => tc.status === 'failed');
  const stuck = entries.filter(([, tc]) => tc.status !== 'done' && tc.status !== 'failed');

  const bar = '='.repeat(72);
  log('\n' + bar);
  log(title + ' SUMMARY — ' + roundsRun + ' round(s) run');
  log(bar);
  log('Tracker: ' + tracker.trackerPath);
  log('Total: ' + entries.length + '  |  Done: ' + done.length +
      '  |  Failed: ' + failed.length + '  |  Stuck: ' + stuck.length);

  if (done.length) {
    log('\n--- DONE ---');
    for (const [id, tc] of done) {
      log('  ' + id + ': ' + (tc.rfiCode || '(no code)') +
          (tc.workArea ? ' @ ' + tc.workArea : '') +
          (tc.checkpointCode ? ' [' + tc.checkpointCode + ']' : '') +
          ' — ' + tc.steps.length + ' step(s)');
    }
  }

  if (failed.length) {
    log('\n--- FAILED (stage by stage) ---');
    for (const [id, tc] of failed) {
      log(id + ': failed at step ' + (tc.currentStepIndex + 1) + '/' + tc.steps.length +
          ' [' + (tc.failureStage || 'unknown stage') + ']' +
          (tc.failureScenario ? ' — scenario: ' + tc.failureScenario : ''));
      log('   ' + tc.failureReason);
      const lastReject = tracker.getLastRejectStep(tc);
      if (lastReject) log('   last reject: ' + lastReject.actor + ' from ' + lastReject.page);
      if (tc.failureScreenshot) log('   screenshot: ' + tc.failureScreenshot);
      if (tc.failureHtml) log('   html dump:  ' + tc.failureHtml);
      if (tc.failureUrl) log('   page URL:   ' + tc.failureUrl);
    }
  }

  if (stuck.length) {
    log('\n--- STUCK (neither done nor failed — a step stopped advancing) ---');
    for (const [id, tc] of stuck) {
      log('  ' + id + ': at step ' + (tc.currentStepIndex + 1) + '/' + tc.steps.length +
          ', status "' + tc.status + '"');
    }
  }
  log(bar + '\n');

  // Both buckets are problems. "stuck" previously had no assertion covering it
  // anywhere, so a run could report 0 failed while leaving real work unfinished.
  if (extraProblems.length) {
    log('\n--- VERIFICATION PROBLEMS (the app had already acted, so the TC continued) ---');
    for (const p of extraProblems) log('  ' + p);
    log('');
  }

  const problems = [
    ...failed.map(([id, tc]) =>
      id + ' [' + (tc.failureStage || 'unknown stage') + ']' +
      (tc.failureScenario ? ' (' + tc.failureScenario + ')' : '') + ': ' + tc.failureReason),
    ...stuck.map(([id, tc]) =>
      id + ': STUCK at step ' + (tc.currentStepIndex + 1) + '/' + tc.steps.length +
      ' — never reached done or failed within ' + roundsRun + ' round(s)'),
    ...extraProblems,
  ];
  return { done, failed, stuck, problems };
}

module.exports = {
  SMOKE_FIXTURES, TC_SETS, resolveTcSet, prepareRun, printRunSummary,
  rfiSeedFor, createSmokeRfiTracker,
  ncSeedFor, createSmokeNcTracker,
};
