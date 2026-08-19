const { test, expect } = require("@playwright/test");
const { loginFreshRoleSession } = require("../utils/helpers");
const { loadTracker, getPendingStepsForActor } = require("../utils/tracker-utils");
const { runCITurn, runEETurn, runQITurn } = require("../utils/rfi-flow-turns");

// EXPERIMENTAL — alternative to the ci-pass-N/ee-pass-N/qi-pass-N dependency
// chain in playwright.config.js (08/09/10_rfi_flow_*.spec.js). That chain
// logs in fresh for EVERY pass — up to 9 logins total for a full 9-TC/
// 3-round regression (3 roles x 3 rounds), each a brand-new browser context
// paying the full PWA-install cost again. This spec logs in as CI/EE/QI
// exactly ONCE EACH, in parallel, then keeps all three sessions alive for
// the whole regression, round-robining turns between them until every TC's
// tracker entry reaches "done" (or the safety cap trips).
//
// Reuses the EXACT SAME runCITurn/runEETurn/runQITurn as 08/09/10 (see
// tests/utils/rfi-flow-turns.js) — only the login/session-lifecycle model
// differs, not the actual RFI-flow logic. Operates on the SAME
// tests/fixtures/rfi-tracker.json as the pass-chain specs, so run
// `npm run reset:rfi-tracker` first and don't run this alongside (or
// interleaved with) the ci-pass-N/ee-pass-N/qi-pass-N chain — both would
// race on the same tracker file.
//
// Standalone (not part of any project dependency chain) — runs under the
// default `chromium` project:
//   npx playwright test tests/specs/21_rfi_flow_single_session.spec.js --project=chromium
test("RFI: full regression, one session per role (CI/EE/QI logged in once each)", async ({ browser }) => {
  test.setTimeout(90 * 60 * 1000);

  // Parallelizes the slow login/PWA-load cost across all three roles instead
  // of paying it serially (3x) — let alone the pass-chain's up-to-9x.
  //
  // allSettled, not all() — confirmed live: with plain Promise.all, one
  // role's login rejecting (e.g. a slow PWA install under 3-concurrent-
  // login contention) makes the whole destructure throw immediately,
  // BEFORE the try/finally below ever starts — so whichever of the other
  // two roles DID finish logging in never gets its context closed. allSettled
  // lets every login run to completion (success or failure) so any
  // successfully-opened context can be closed here before failing loudly.
  const roles = ["CI", "EE", "QI"];
  const results = await Promise.allSettled(
    roles.map(role => loginFreshRoleSession(browser, role))
  );

  const failures = results
    .map((r, i) => ({ role: roles[i], r }))
    .filter(({ r }) => r.status === "rejected");

  if (failures.length > 0) {
    await Promise.all(
      results
        .filter(r => r.status === "fulfilled")
        .map(r => r.value.context.close().catch(() => {}))
    );
    throw new Error(
      `Login failed for: ${failures.map(f => `${f.role} (${f.r.reason.message})`).join('; ')}`
    );
  }

  const [ci, ee, qi] = results.map(r => r.value);

  try {
    // Safety cap, not a hardcoded round count — the loop naturally exits
    // early via the "nothing pending" check below once every TC reaches
    // "done"/"failed". This just guards against a logic bug (e.g. a step
    // that never advances the tracker) spinning forever.
    const MAX_ROUNDS = 10;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const tracker = loadTracker();
      const stillPending = ["CI", "EE", "QI"].some(
        actor => getPendingStepsForActor(tracker, actor).length > 0
      );
      if (!stillPending) {
        const failed = Object.entries(tracker).filter(([, tc]) => tc.status === "failed");
        console.log(failed.length === 0
          ? `All TCs done after round ${round - 1}.`
          : `Stopped after round ${round - 1}: ${failed.length} TC(s) FAILED — ${failed.map(([id]) => id).join(', ')}.`);
        break;
      }

      console.log(`--- Round ${round} ---`);
      // CI first (creates/resubmits), then EE, then QI — same causal order
      // as the pass chain. Because this all runs in one process against the
      // same tracker file, EE's turn immediately sees whatever CI just
      // created THIS round (no separate login/project boundary in between).
      await runCITurn(ci.page);
      await runEETurn(ee.page);
      await runQITurn(qi.page);

      if (round === MAX_ROUNDS) {
        console.log(`Reached MAX_ROUNDS (${MAX_ROUNDS}) with work still pending — check tracker for a stuck TC.`);
      }
    }
  } finally {
    // Close all three sessions regardless of how the loop above ended, so a
    // mid-run failure doesn't leak browser contexts.
    await Promise.all([
      ci.context.close(),
      ee.context.close(),
      qi.context.close(),
    ]);
  }

  // Without this, a run where every single TC failed still exits 0 —
  // getPendingStepsForActor() skips "failed" TCs exactly the same as "done"
  // ones, so "nothing left pending" reads as success either way unless
  // explicitly checked here. Confirmed live: this exact gap let a 0/9-passed
  // run report as cleanly as a 9/9-passed one.
  const finalTracker = loadTracker();
  const failedTCs = Object.entries(finalTracker).filter(([, tc]) => tc.status === "failed");
  expect(failedTCs.map(([id, tc]) => `${id}: ${tc.failureReason}`), 'Some TCs failed — see tracker for details').toEqual([]);
});
