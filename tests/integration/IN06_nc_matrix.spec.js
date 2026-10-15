const { test, expect } = require('@playwright/test');
const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
const { createSmokeNcTracker, prepareRun, printRunSummary, resolveNcCreators } = require('../utils/smoke-tracker');
const { makeNcContext, ncRolesFor, ncUserRolesFor, sessionUsers, runNcRound } = require('../utils/smoke-nc-turns');
const { profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers } = require('./drs-profile');
const { loginFlowSessions } = require('./flow-sessions');

// ===========================================================================
// IN06 — THE FULL 4-TC NC MATRIX ON THE DRS PROJECT.
// docs/drs-pulse-integration.md (Phase 2 as built).
//
// NC-only file. The same engine the smoke chain's SM06 runs (smoke-nc-turns +
// a resumable tracker: happy path plus the EE / QI reject → CI resubmit rounds),
// driven by THIS project's IN01 users on its NC matrix Work Area
// (drs-profile.js matrix.nc) — disjoint from every RFI area, because a
// non-approved NC blocks RFI on the same checkpoint + section.
//
// Tracker: fixtures/smoke/nc-tracker.drs-solar-<tag>.<env>.desktop.<set>.json.
// Resumes by default; SMOKE_RESET=1 starts over.
//
// Needs IN01. Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN06_nc_matrix.spec.js
// ===========================================================================

const profile = profileForSpec();
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
// NC can be raised by QI, EE, PM, EL and QL (app change 2026-10-08), so the matrix
// runs per creator: 5 x 4 = 20 TCs. PM/EL/QL only create (no draft, no review).
// SMOKE_NC_CREATORS narrows it. Their IN01 users + WAM are provisioned below.
const CREATORS = resolveNcCreators();
// Session keys (EE = create-only 'EEC' + reviewer 'EE', same user) vs accounts.
const ROLES = ncRolesFor(CREATORS);
const USER_ROLES = ncUserRolesFor(CREATORS);
const MAX_ROUNDS = 8;
const VIEWPORT = 'desktop';

test(`IN06. NC matrix on ${profile.matrix.nc[0]}`, async ({ browser }) => {
  requireAvailable(profile);
  test.setTimeout(120 * 60 * 1000);
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  const users = drsUsers(profile, USER_ROLES);
  for (const r of USER_ROLES) expect(users[r], `${r} not recorded — run IN01 first`).toBeTruthy();

  const workArea = profile.matrix.nc[0];
  await ensureWorkAreaMapping(browser, profile, users, { roles: USER_ROLES, areas: [workArea], label: 'IN06 prereq' });

  const { tracker, tcSet, file } = createSmokeNcTracker({ profileKey: profile.key, viewport: VIEWPORT, creators: CREATORS });
  console.log(`\n=== DRS NC matrix: ${profile.drs.project.name} / ${tcSet} ===\n` +
    `    ${profile.nc.workLocation} / ${workArea} / ${profile.nc.activity} · vendor ${profile.nc.vendorName}\n` +
    `    tracker: fixtures/smoke/${file}`);
  prepareRun(tracker);

  const { sessions, close } = await loginFlowSessions(browser, sessionUsers(users), ROLES, PASSWORD);
  const ctx = makeNcContext({ profile, tracker, workArea, viewport: VIEWPORT });
  let roundsRun = 0;
  try {
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      const t = tracker.load();
      if (!ROLES.some((role) => tracker.getPendingStepsForActor(t, role).length > 0)) break;
      console.log(`\n--- Round ${round} ---`);
      await runNcRound(sessions, ctx, ROLES);
      roundsRun = round;
    }
  } finally {
    await close();
  }

  const { done, problems } = printRunSummary(tracker, roundsRun, {
    title: `DRS NC (${profile.drs.project.name} / ${tcSet})`, extraProblems: ctx.problems,
  });
  recordPulse(profile, { ncMatrix: { tcSet, file, done: done.length, problems: problems.length, at: new Date().toISOString() } });
  expect(problems, 'Some TCs did not complete cleanly — see the summary above').toEqual([]);
  expect(done.length, 'No TC completed, so nothing was actually proven').toBeGreaterThan(0);
});
