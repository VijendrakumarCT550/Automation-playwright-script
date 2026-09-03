const { test, expect } = require('../config/test-base');
const { loginFreshUserSession } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { resolveFlowWorkAreas } = require('../config/projects');
const { createSmokeRfiTracker, prepareRun, printRunSummary } = require('../utils/smoke-tracker');
const { makeRfiContext, runCITurn, runEETurn, runQITurn } = require('../utils/smoke-rfi-turns');

// Stage 5 of the E2E smoke chain: the FULL 9-TC RFI flow for one project type
// and one viewport, driven by the users stages 1-3 created, SO-mapped and WAM'd.
//
// ---------------------------------------------------------------------------
// SESSION MODEL — one login per role, kept alive for the whole pass
// ---------------------------------------------------------------------------
// Adopted from 21_rfi_flow_single_session.spec.js on the app owner's
// instruction, and it is the single biggest saving available here. The
// alternative — a login per actor turn — costs 3-6 minutes of PWA load EACH, and
// a 9-TC pass needs roughly nine of them, serially. This logs in as CI, EE and
// QI exactly ONCE each, IN PARALLEL, then round-robins turns between the three
// live sessions until every TC reaches done or failed. Wall-clock login cost
// drops from ~45 minutes to roughly one login.
//
// This supersedes the previous version of this stage, which drove ONE page and
// hopped roles sequentially on the belief that the app is one-session-at-a-time.
// Spec 21 has been running three concurrent contexts against this app for a
// while, so that belief was wrong. It also removes the role hopping that the app
// owner suspects is behind the partial-RFI-data cookie issue — see the Work
// Section re-selection note in smoke-rfi-turns.js, which may become dead code
// as a result.
//
// ---------------------------------------------------------------------------
// STATE
// ---------------------------------------------------------------------------
// Its own tracker file per (profile x viewport x TC set), under
// fixtures/smoke/ — never the regression's fixtures/rfi-tracker.json. See
// docs/smoke-e2e-framework.md section 5.
//
// Runs RESUME by default: a pass that dies mid-way picks up where it stopped.
//   SMOKE_TC_SET=quick   TC-01 only (the happy path) — a fast "is the app up"
//                        check. Same engine, filtered seed.
//   SMOKE_TC_SET=full    all 9 TCs (default).
//   SMOKE_RESET=1        start the set over instead of resuming.
//
// The old SMOKE_RFI_CODE and SMOKE_REJECT_CYCLES knobs are gone, both
// superseded: the reject/resubmit cycles ARE TCs 02-09 now, and SMOKE_RFI_CODE
// existed to avoid re-creating an RFI while iterating on the review steps, which
// resuming the tracker does properly.
//
// ---------------------------------------------------------------------------
// THE TWO PROJECT TYPES BEHAVE VERY DIFFERENTLY
// ---------------------------------------------------------------------------
// Driven by profile.workSectionGranularity, never by a project-type check.
//
//   SOLAR many-per-work-area (264 Work Sections for Piling - MMS on this band).
//     Every TC takes a FRESH section, so a 9-TC pass costs ~9 of 264 and the
//     stage is effectively idempotent. This is why solar carries the mobile
//     coverage and the repeated runs.
//
//   WIND one-per-work-area, section NAMED AFTER the area. Merely SELECTING it
//     consumes that (checkpoint, Work Section) pair permanently. So each TC
//     lands on its OWN work area — 12 are provisioned for the RFI pool — and the
//     walk moves on as pairs are spent. Wind is desktop-only and NOT
//     indefinitely repeatable: ~5 clean passes before re-provisioning.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const ROLES = ['CI', 'EE', 'QI'];

// Safety cap, not a round count — the loop exits early via the "nothing
// pending" check as soon as every TC is done or failed. The deepest TCs (06-09)
// need exactly 3 rounds: each round runs CI, then EE, then QI, and because they
// share one process and one tracker file, EE immediately sees what CI just did.
// This only guards against a step that silently stops advancing.
const MAX_ROUNDS = 10;

test('RFI full flow, 9 TC, one session per role', async ({ browser, profile, isMobileViewport }) => {
  // Three parallel PWA logins plus up to 9 TCs x 7 steps of form and grid work.
  test.setTimeout(150 * 60 * 1000);

  expect(profile.rfi, 'Profile "' + profile.key + '" has no rfi data — see tests/config/projects.js').toBeTruthy();
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const viewport = isMobileViewport ? 'mobile' : 'desktop';

  // Resolves the users stages 1-3 created, checking BOTH that they belong to
  // this profile and that they were created against THIS deployment — see
  // smoke-users.js for why the second check exists.
  const users = resolveSmokeUsers(profile, ROLES);

  const pool = resolveFlowWorkAreas(profile, { flow: 'rfi', viewport });
  const { tracker, tcSet, file } = createSmokeRfiTracker({ profileKey: profile.key, viewport });

  console.log(
    '\n=== Smoke RFI flow: "' + profile.key + '" / ' + viewport + ' / TC set "' + tcSet + '" ===\n' +
    '    ' + profile.rfi.workLocation + ' / ' + profile.rfi.package + ' / ' +
    profile.rfi.subPackage + ' / ' + profile.rfi.activity + '\n' +
    '    work area pool (in order): ' + JSON.stringify(pool) + '\n' +
    '    tracker: fixtures/smoke/' + file
  );
  for (const role of ROLES) console.log('    ' + role + ': ' + users[role].name + ' <' + users[role].email + '>');
  console.log('');

  prepareRun(tracker);

  // A context created straight off `browser` does NOT inherit the project's
  // `use` block, so the mobile variants would silently run at desktop size.
  // Carry the device-shaping fields across explicitly.
  const projectUse = test.info().project.use || {};
  const contextOptions = {};
  for (const key of ['viewport', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch']) {
    if (projectUse[key] !== undefined) contextOptions[key] = projectUse[key];
  }
  console.log('  context options for this viewport: ' + JSON.stringify(contextOptions) + '\n');

  // allSettled, not all(): with plain Promise.all one role's login rejecting
  // makes the destructure throw BEFORE the try/finally starts, so whichever of
  // the other two DID log in never gets its context closed. Confirmed live on
  // spec 21 under three-concurrent-login contention.
  const results = await Promise.allSettled(
    ROLES.map((role) => loginFreshUserSession(browser, users[role].email, PASSWORD, contextOptions))
  );

  const failures = results
    .map((r, i) => ({ role: ROLES[i], r }))
    .filter(({ r }) => r.status === 'rejected');

  if (failures.length) {
    await Promise.all(
      results.filter((r) => r.status === 'fulfilled').map((r) => r.value.context.close().catch(() => {}))
    );
    throw new Error(
      'Login failed for: ' +
      failures.map((f) => f.role + ' (' + String(f.r.reason && f.r.reason.message).split('\n')[0] + ')').join('; ')
    );
  }

  const sessions = {};
  ROLES.forEach((role, i) => { sessions[role] = results[i].value; });
  console.log('  all three sessions live: ' + ROLES.map((r) => r + '=' + sessions[r].email).join(', ') + '\n');

  const ctx = makeRfiContext({ profile, tracker, pool, viewport });
  let roundsRun = 0;

  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const t = tracker.load();
      const stillPending = ROLES.some((role) => tracker.getPendingStepsForActor(t, role).length > 0);
      if (!stillPending) {
        console.log('\nNothing left pending after round ' + (round - 1) + '.');
        break;
      }

      console.log('\n--- Round ' + round + ' ---');
      // CI first (creates and resubmits), then EE, then QI — the causal order.
      await runCITurn(sessions.CI.page, ctx);
      await runEETurn(sessions.EE.page, ctx);
      await runQITurn(sessions.QI.page, ctx);
      roundsRun = round;

      if (round === MAX_ROUNDS) {
        console.log('Reached MAX_ROUNDS (' + MAX_ROUNDS + ') with work still pending — check the tracker for a stuck TC.');
      }
    }
  } finally {
    // Close all three regardless of how the loop ended, so a mid-run failure
    // does not leak browser contexts.
    await Promise.all(ROLES.map((role) => sessions[role].context.close().catch(() => {})));
  }

  const { done, problems } = printRunSummary(tracker, roundsRun, {
    title: 'SMOKE RFI (' + profile.key + ' / ' + viewport + ' / ' + tcSet + ')',
    // Soft problems: verifications that failed AFTER the app had already acted,
    // so the TC was allowed to continue and its tracker step was kept in line
    // with reality. They still fail the run — see ctx.problems in
    // smoke-rfi-turns.js for why they cannot simply throw.
    extraProblems: ctx.problems,
  });

  // Guards the gap that makes a bad run look clean: getPendingStepsForActor
  // skips done and failed TCs identically, so "nothing pending" alone reads as
  // success either way.
  expect(problems, 'Some TCs did not complete cleanly — see the summary above').toEqual([]);
  expect(done.length, 'No TC completed, so nothing was actually proven').toBeGreaterThan(0);
});
