const { test, expect } = require('@playwright/test');
const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
const { createSmokeRfiTracker, prepareRun, printRunSummary } = require('../utils/smoke-tracker');
const { makeRfiContext, runCITurn, runEETurn, runQITurn } = require('../utils/smoke-rfi-turns');
const { profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers } = require('./drs-profile');
const { loginFlowSessions } = require('./flow-sessions');

// ===========================================================================
// IN05 — THE FULL 9-TC RFI MATRIX ON THE DRS PROJECT.
// docs/drs-pulse-integration.md (Phase 2 as built).
//
// The same engine the smoke chain's SM05 runs (smoke-rfi-turns + a resumable
// tracker: happy path, EE/QI rejects from page 1 and from the checklist,
// resubmit rounds up to V3), driven by THIS project's IN01 users on its matrix
// Work Areas (drs-profile.js matrix.rfi). Nothing about the flow is new — the
// point is that it holds on DRS-created ground.
//
// Tracker: fixtures/smoke/rfi-tracker.drs-solar-<tag>.<env>.desktop.<set>.json —
// one per DRS project. Resumes by default; SMOKE_RESET=1 starts over,
// SMOKE_TC_SET=quick runs TC-01 only.
//
// Needs IN01. Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN05_rfi_matrix.spec.js
// ===========================================================================

const profile = profileForSpec();
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const ROLES = ['CI', 'EE', 'QI'];
const MAX_ROUNDS = 10;
const VIEWPORT = 'desktop';

test(`IN05. RFI matrix on ${profile.matrix.rfi.join(', ')}`, async ({ browser }) => {
  requireAvailable(profile);
  test.setTimeout(150 * 60 * 1000);
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  const users = drsUsers(profile);
  for (const r of ROLES) expect(users[r], `${r} not recorded — run IN01 first`).toBeTruthy();

  const pool = profile.matrix.rfi;
  await ensureWorkAreaMapping(browser, profile, users, { roles: ROLES, areas: pool, label: 'IN05 prereq' });

  const { tracker, tcSet, file } = createSmokeRfiTracker({ profileKey: profile.key, viewport: VIEWPORT });
  console.log(`\n=== DRS RFI matrix: ${profile.drs.project.name} / ${tcSet} ===\n` +
    `    ${profile.rfi.workLocation} / ${profile.rfi.activity} · pool ${JSON.stringify(pool)}\n` +
    `    tracker: fixtures/smoke/${file}`);
  prepareRun(tracker);

  const { sessions, close } = await loginFlowSessions(browser, users, ROLES, PASSWORD);
  const ctx = makeRfiContext({ profile, tracker, pool, viewport: VIEWPORT });
  let roundsRun = 0;
  try {
    for (let round = 1; round <= MAX_ROUNDS; round += 1) {
      const t = tracker.load();
      if (!ROLES.some((role) => tracker.getPendingStepsForActor(t, role).length > 0)) break;
      console.log(`\n--- Round ${round} ---`);
      await runCITurn(sessions.CI.page, ctx);
      await runEETurn(sessions.EE.page, ctx);
      await runQITurn(sessions.QI.page, ctx);
      roundsRun = round;
    }
  } finally {
    await close();
  }

  const { done, problems } = printRunSummary(tracker, roundsRun, {
    title: `DRS RFI (${profile.drs.project.name} / ${tcSet})`, extraProblems: ctx.problems,
  });
  recordPulse(profile, { rfiMatrix: { tcSet, file, done: done.length, problems: problems.length, at: new Date().toISOString() } });
  expect(problems, 'Some TCs did not complete cleanly — see the summary above').toEqual([]);
  expect(done.length, 'No TC completed, so nothing was actually proven').toBeGreaterThan(0);
});
