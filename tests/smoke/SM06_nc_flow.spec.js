const { test, expect } = require('../config/test-base');
const { loginFreshUserSession } = require('../utils/helpers');
const { ensureSmokeUsers } = require('../utils/smoke-users');
const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
const { resolveFlowWorkAreas } = require('../config/projects');
const { createSmokeNcTracker, prepareRun, printRunSummary, resolveNcCreators } = require('../utils/smoke-tracker');
const { makeNcContext, ncRolesFor, ncUserRolesFor, sessionUsers, runNcRound } = require('../utils/smoke-nc-turns');

// Stage 5 of the E2E smoke chain (file SM06): the FULL 4-TC NC flow for one
// project type and one viewport, driven by the users stages 1-3 created,
// SO-mapped and WAM'd.
//
// ---------------------------------------------------------------------------
// FIVE NC CREATORS (app change, 2026-10-08)
// ---------------------------------------------------------------------------
// NC can now be raised by the Execution Engineer, Project Manager, Execution
// Lead and Quality Lead as well as the QI, so the 4-TC matrix runs once per
// creator: 5 x 4 = 20 TCs (smoke-tracker.NC_CREATORS). The new creators can ONLY
// create — no draft, no review steps — and use the same Create NC button. CI
// responds, EE reviews and QI reviews whoever raised it. Sessions: the five
// creators + CI (EE and QI are already in that set) = PM, EL, QL, QI, EE, CI.
// SMOKE_NC_CREATORS=QI,PM narrows it while iterating.
//
// PREREQUISITE: every session role must hold this stage's ground in WAM —
// ensureWorkAreaMapping below does it (PM at its Work Location row, the rest at
// the work area).
//
// Same session model as the RFI stage: log in as CI, EE and QI exactly ONCE
// each, IN PARALLEL, then round-robin turns between the three live sessions
// until every TC reaches done or failed. See SM05_rfi_flow.spec.js for why that
// is worth roughly nine logins per pass.
//
// ---------------------------------------------------------------------------
// WHY THE ACTOR SET LOOKS THE SAME BUT THE ROLES DIFFER
// ---------------------------------------------------------------------------
// Three sessions again, but QI is the CREATOR here, not a pure reviewer:
//
//   QI creates the NC  ->  CI responds  ->  EE reviews  ->  QI reviews
//
// So QI's turn does double duty (create for any TC with no ncId, then its own
// review steps), which is exactly what getPendingStepsForActor's create-actor
// special case is for — configured as createActor: 'QI' for this tracker,
// versus 'CI' for RFI's.
//
// ---------------------------------------------------------------------------
// WHAT MAKES THIS CHEAPER THAN THE RFI STAGE
// ---------------------------------------------------------------------------
//   * NO WORK SECTION CONSUMPTION. Multiple NCs against identical details are
//     legal (app owner), so there is no walk, no exclusion set and no capacity
//     arithmetic. Both viewports share one work area for that reason.
//   * THE NC CODE NEVER CHANGES, so none of the RFI stage's
//     code-changed-on-resubmit machinery is needed.
//   * 4 TCs, not 9, and only one reject mechanism — no P1/P2 split, so no
//     page-1-lock rule to assert.
//
// The NC work area is nonetheless DISJOINT from the RFI areas, and that is a
// hard requirement rather than tidiness: an NC left in a non-approved state
// BLOCKS RFI create/resubmit for the same (inspection checkpoint, work
// section). A bug-interrupted NC cycle on RFI ground would lock the RFI stage
// out of it. See docs/smoke-e2e-framework.md section 4.1, rule R2.
//
//   SMOKE_TC_SET=quick   TC-01 only (the happy path).
//   SMOKE_TC_SET=full    all 4 TCs (default).
//   SMOKE_RESET=1        start the set over instead of resuming.
//   SMOKE_RETRY_FAILED=1 revive failed TCs in place and continue them.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const CREATORS = resolveNcCreators();
// ROLES are SESSION keys (EE gets a create-only 'EEC' session plus its reviewer
// 'EE' session, same user); USER_ROLES are the accounts behind them.
const ROLES = ncRolesFor(CREATORS);
const USER_ROLES = ncUserRolesFor(CREATORS);

// Safety cap, not a round count — the loop exits as soon as every TC is done or
// failed. Each round runs the create-only roles, QI (create + review), CI, then
// EE, so a TC advances by at most one QI step per round. TC-04's eight steps
// (respond, EE reject, resubmit, EE approve, QI reject, resubmit, EE approve, QI
// approve) take FOUR rounds for a QI/PM/EL/QL-raised NC and FIVE for an
// EE-raised one (EE's create lands after CI's turn, so CI answers a round late).
const MAX_ROUNDS = 8;

test('NC full flow, 4 TC, one session per role', async ({ browser, profile, isMobileViewport }) => {
  test.setTimeout(120 * 60 * 1000);

  expect(
    profile.nc,
    `Profile "${profile.key}" has no nc data. For wind this is deliberately null — the NC ` +
    `create form has never been opened for that project type and needs a recon pass first.`
  ).toBeTruthy();
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const viewport = isMobileViewport ? 'mobile' : 'desktop';
  const baseUsers = await ensureSmokeUsers(browser, profile, USER_ROLES);
  const users = sessionUsers(baseUsers);
  const workArea = resolveFlowWorkAreas(profile, { flow: 'nc', viewport })[0];
  // Own prerequisite (app owner, 2026-09-25): CI, EE and QI must hold this stage's
  // ground in WAM. No-op when they already do — see smoke-prereqs.js.
  await ensureWorkAreaMapping(browser, profile, baseUsers, {
    roles: USER_ROLES, areas: [workArea], label: `SM06 ${viewport} prereq`,
  });
  const { tracker, tcSet, file } = createSmokeNcTracker({ profileKey: profile.key, viewport, creators: CREATORS });

  console.log(
    '\n=== Smoke NC flow: "' + profile.key + '" / ' + viewport + ' / TC set "' + tcSet + '" ===\n' +
    '    ' + profile.nc.workLocation + ' / ' + workArea + ' / ' + profile.nc.package +
    ' / ' + profile.nc.activity + '\n' +
    '    vendor: ' + profile.nc.vendorName + '\n' +
    '    tracker: fixtures/smoke/' + file
  );
  for (const role of ROLES) console.log('    ' + role + ': ' + users[role].name + ' <' + users[role].email + '>');
  console.log('');

  prepareRun(tracker);

  // A context created off `browser` does NOT inherit the project's `use` block,
  // so the mobile variant would silently run desktop-sized. Carry the
  // device-shaping fields across explicitly.
  const projectUse = test.info().project.use || {};
  const contextOptions = {};
  for (const key of ['viewport', 'userAgent', 'deviceScaleFactor', 'isMobile', 'hasTouch']) {
    if (projectUse[key] !== undefined) contextOptions[key] = projectUse[key];
  }
  console.log('  context options for this viewport: ' + JSON.stringify(contextOptions) + '\n');

  // allSettled, not all(): one role's login rejecting under three-way
  // contention would otherwise throw before the try/finally starts, leaking the
  // contexts that DID open.
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
  console.log('  all ' + ROLES.length + ' sessions live: ' + ROLES.map((r) => r + '=' + sessions[r].email).join(', ') + '\n');

  const ctx = makeNcContext({ profile, tracker, workArea, viewport });
  let roundsRun = 0;

  try {
    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const t = tracker.load();
      const stillPending = ROLES.some((role) => tracker.getPendingStepsForActor(t, role).length > 0);
      // (ROLES includes every creator, so an NC awaiting only its create counts)
      if (!stillPending) {
        console.log('\nNothing left pending after round ' + (round - 1) + '.');
        break;
      }

      console.log('\n--- Round ' + round + ' ---');
      // QI FIRST, unlike the RFI stage where CI leads. QI both creates the NC
      // and performs the final review, so leading with it means a freshly
      // created NC reaches CI within the SAME round.
      await runNcRound(sessions, ctx, ROLES);
      roundsRun = round;

      if (round === MAX_ROUNDS) {
        console.log('Reached MAX_ROUNDS (' + MAX_ROUNDS + ') with work still pending — check the tracker for a stuck TC.');
      }
    }
  } finally {
    await Promise.all(ROLES.map((role) => sessions[role].context.close().catch(() => {})));
  }

  const { done, problems } = printRunSummary(tracker, roundsRun, {
    title: 'SMOKE NC (' + profile.key + ' / ' + viewport + ' / ' + tcSet + ')',
    extraProblems: ctx.problems,
  });

  expect(problems, 'Some TCs did not complete cleanly — see the summary above').toEqual([]);
  expect(done.length, 'No TC completed, so nothing was actually proven').toBeGreaterThan(0);
});
