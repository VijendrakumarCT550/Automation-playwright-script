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
const { resolveEnvironment } = require('../config/environments');

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
//
// ---------------------------------------------------------------------------
// AND THE ENVIRONMENT — added 2026-09-06, and it is the same bug as the users file
// ---------------------------------------------------------------------------
// A tracker stores LIVE SERVER STATE: real rfiId/ncId UUIDs and visible codes,
// which exist on exactly one deployment. Before this, the filename had no
// environment dimension, so pointing the suite at another deployment silently
// reused the previous one's ids.
//
// Found the moment the app owner moved this work from pulse-test to pulse-qa on
// 2026-09-06: the desktop tracker on disk held
// `rfiId 4c788644-...` / `RFI-S05b-BL03-CIV-149`, created on pulse-test. On qa
// those resolve to nothing, and the failure would NOT have looked like a
// stale-state problem — a resumed TC hunts for an RFI that is not there and
// surfaces as RFI_NOT_VISIBLE_TO_ACTOR, which section 11 of
// docs/smoke-e2e-framework.md already records as reading exactly like an app
// bug. Alternatively every TC reads `done` and the run is refused, which looks
// like a clean pass.
//
// This is precisely the failure smoke-users.js's baseUrl guard was written for
// ("THE FILE HAS NO ENVIRONMENT DIMENSION"), one layer down. Keying the FILENAME
// rather than guarding the contents is the better fix here: both deployments'
// state can coexist, so switching environments and switching back does not
// destroy either, and there is no reset step to remember.
//
// Legacy files without the env segment are ignored (seedIfMissing then starts a
// fresh one). listLegacyTrackerFiles() below exists so a caller can say so out
// loud rather than letting state appear to vanish.
const SMOKE_FIXTURES = path.join(__dirname, '..', 'fixtures', 'smoke');

// 'qa' | 'test' | 'dev' | 'uat' | <host-derived> — whatever the run targets.
//
// THE HOST-DERIVED CASE IS NOT COSMETIC, and it was found the hard way on
// 2026-09-08. resolveEnvironment() returns the literal key `custom` for ANY
// deployment that has no entry in ENVIRONMENTS — so a full chain run against
// pulse-uat (unnamed at the time) wrote `rfi-tracker.solar-e2e.custom.*.json`.
//
// That reintroduces the exact bug this whole key exists to prevent: `custom` is
// shared by every unnamed deployment, so pointing the suite at a second unknown
// host would silently resume the first one's rfiId/ncId values. Naming pulse-uat
// in ENVIRONMENTS fixes today; deriving the key from the HOSTNAME fixes the
// class, so the next unnamed deployment cannot collide either.
//
// The first label of the hostname is enough to be readable and unique here
// ('pulse-uat.cfapps...' -> 'pulse-uat'), and it is sanitised because it lands
// in a filename.
function envKey() {
  let env;
  try {
    env = resolveEnvironment();
  } catch (e) {
    // resolveEnvironment throws when neither PULSE_ENV nor BASE_URL is set. A
    // tracker filename is not the right place to surface that — the run will
    // fail with a far clearer message the moment it tries to navigate.
    return 'unknown';
  }

  if (env.key !== 'custom') return env.key;

  try {
    const host = new URL(env.baseUrl).hostname.split('.')[0].toLowerCase();
    const safe = host.replace(/[^a-z0-9-]/g, '');
    return safe ? `host-${safe}` : 'custom';
  } catch (e) {
    return 'custom';
  }
}

// Tracker files from before the env segment existed. Reported, never deleted:
// they are the record of a real run against some deployment, and which one is
// no longer knowable from the name, so removing them is not this code's call.
// Two kinds of file are reported here, and both are AMBIGUOUS about which
// deployment they describe — which is the only reason to single them out. A
// tracker for a *named* environment other than the current one is perfectly
// fine and is deliberately left alone, so both deployments' state can coexist.
//
//   1. no env segment at all  — pre-2026-09-06, before the key existed;
//   2. env segment `custom`   — written between 2026-09-06 and 2026-09-08, when
//      any unnamed deployment shared that one literal key. Which host it was is
//      not knowable from the name, which is precisely why envKey() now derives
//      a per-host key instead.
function listLegacyTrackerFiles() {
  const fs = require('fs');
  if (!fs.existsSync(SMOKE_FIXTURES)) return [];
  return fs.readdirSync(SMOKE_FIXTURES).filter((f) => {
    if (!f.endsWith('.json')) return false;
    const parts = f.replace(/\.json$/, '').split('.');
    // <flow>-tracker.<profile>.<env>.<viewport>.<set>  = 5 parts once keyed.
    if (parts.length === 4) return true;               // (1) no env segment
    return parts.length === 5 && parts[2] === 'custom'; // (2) ambiguous key
  });
}

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
// Says so out loud in the ONE case where someone would reasonably think their
// state disappeared: env-keyed file does not exist yet, but pre-env-keying files
// do. Silent on every other run.
function warnAboutLegacyTrackersOnce(newFilePath) {
  const fs = require('fs');
  if (fs.existsSync(newFilePath)) return;
  const legacy = listLegacyTrackerFiles();
  if (!legacy.length) return;
  const lines = [
    `[tracker] starting FRESH state at ${path.basename(newFilePath)}.`,
    '[tracker] tracker filenames now include the environment (added 2026-09-06) because a',
    '[tracker] tracker holds live rfiId/ncId values that exist on ONE deployment only.',
    '[tracker] these pre-existing files predate that and are being IGNORED, not lost:',
    ...legacy.map((f) => `[tracker]   ${f}`),
  ];
  console.log(lines.join('\n'));
}

function rfiSeedFor(set) {
  const full = JSON.parse(JSON.stringify(RFI_SEED));
  if (set !== 'quick') return full;
  return { 'TC-01': full['TC-01'] };
}

function createSmokeRfiTracker({ profileKey, viewport, set }) {
  const tcSet = resolveTcSet(set);
  const file = 'rfi-tracker.' + profileKey + '.' + envKey() + '.' + viewport + '.' + tcSet + '.json';
  warnAboutLegacyTrackersOnce(path.join(SMOKE_FIXTURES, file));
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
  const file = 'nc-tracker.' + profileKey + '.' + envKey() + '.' + viewport + '.' + tcSet + '.json';
  warnAboutLegacyTrackersOnce(path.join(SMOKE_FIXTURES, file));
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
  envKey,
  listLegacyTrackerFiles,
  SMOKE_FIXTURES, TC_SETS, resolveTcSet, prepareRun, printRunSummary,
  rfiSeedFor, createSmokeRfiTracker,
  ncSeedFor, createSmokeNcTracker,
};
