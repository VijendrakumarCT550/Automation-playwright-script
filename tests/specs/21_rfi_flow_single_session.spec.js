const { test, expect } = require("@playwright/test");
const { loginFreshRoleSession } = require("../utils/helpers");
const { loadTracker, getPendingStepsForActor, getLastRejectStep } = require("../utils/tracker-utils");
const { runCITurn, runEETurn, runQITurn } = require("../utils/rfi-flow-turns");

// Prints a full stage-by-stage account of the run — added 2026-08-27 per
// user request: a plain "N TC(s) FAILED" line (or, worse, a clean exit that
// doesn't distinguish "every TC actually finished" from "some TC got stuck
// and neither finished nor failed") isn't enough to trust the automation.
// The specific case that prompted this: EE/QI's Page-1 rejection can report
// success while the RFI never actually becomes visible to CI afterward —
// previously this only surfaced as a generic Playwright timeout buried in
// failureReason, indistinguishable from any other kind of failure without
// manually cross-referencing the tracker's steps[]/currentStepIndex. Every
// failure site in rfi-flow-turns.js now tags WHERE it happened (failureStage)
// and, for the specific "previous actor's action reported success but the
// RFI never became visible to the next actor" case, WHAT it was
// (failureScenario: "RFI_NOT_VISIBLE_TO_ACTOR", set in rfi-nav.js at the one
// place that failure can actually occur) — this just renders that
// structured data so it's impossible to miss in the console output.
function printRunSummary(tracker, roundsRun) {
  const entries = Object.entries(tracker);
  const done = entries.filter(([, tc]) => tc.status === "done");
  const failed = entries.filter(([, tc]) => tc.status === "failed");
  // Neither "done" nor "failed" after the round loop exited — either
  // MAX_ROUNDS was hit with real work still pending, or (a logic bug) some
  // step stopped advancing without ever throwing. Deliberately its own
  // bucket, not folded into `failed` — a TC in this state never got a
  // failureReason at all, so reporting it as if it had one would be
  // misleading.
  const stuck = entries.filter(([, tc]) => tc.status !== "done" && tc.status !== "failed");

  console.log('\n' + '='.repeat(72));
  console.log(`RFI FLOW REGRESSION SUMMARY — ${roundsRun} round(s) run`);
  console.log('='.repeat(72));
  console.log(`Total: ${entries.length}  |  Done: ${done.length}  |  Failed: ${failed.length}  |  Stuck (never finished or failed): ${stuck.length}`);

  if (failed.length > 0) {
    console.log('\n--- FAILED (stage-by-stage) ---');
    for (const [id, tc] of failed) {
      const stepNo = tc.currentStepIndex + 1;
      const totalSteps = tc.steps.length;
      console.log(`${id}: failed at step ${stepNo}/${totalSteps} [${tc.failureStage || 'unknown stage'}]${tc.failureScenario ? ` — scenario: ${tc.failureScenario}` : ''}`);
      console.log(`   ${tc.failureReason}`);
      // Screenshot/HTML dump of the exact moment of failure (see
      // rfi-flow-turns.js's captureFailureEvidence) — best-effort, so a
      // missing one (e.g. the screenshot itself failed) just prints
      // nothing extra rather than a broken path.
      if (tc.failureScreenshot) console.log(`   screenshot: ${tc.failureScreenshot}`);
      if (tc.failureHtml) console.log(`   html dump:  ${tc.failureHtml}`);
      if (tc.failureUrl) console.log(`   page URL:   ${tc.failureUrl}`);
    }
  }

  if (stuck.length > 0) {
    console.log('\n--- STUCK (neither done nor failed — check for a step that silently stopped advancing) ---');
    for (const [id, tc] of stuck) {
      console.log(`${id}: at step ${tc.currentStepIndex + 1}/${tc.steps.length}, status "${tc.status}"`);
    }
  }

  // Grouped by failureScenario tag rather than one hardcoded scenario —
  // every TC here genuinely reached the app in a broken intermediate state
  // (an action reported success but the flow silently didn't actually
  // advance), which is the class of finding worth escalating to the app
  // owner/devs, distinct from e.g. a login failure or a locator that
  // changed shape. Untagged failures (failureScenario: null — a caught
  // error that ISN'T one of these known named scenarios) get their own
  // UNCLASSIFIED bucket rather than being silently dropped from this
  // section. Generic by design: a NEW tag (e.g. PROCEED_DID_NOT_NAVIGATE,
  // added 2026-08-27 alongside the original RFI_NOT_VISIBLE_TO_ACTOR) is
  // picked up automatically here without this file needing another edit —
  // only the tagging site (wherever the error is first thrown) needs to
  // change to add a new scenario.
  const SCENARIO_LABELS = {
    RFI_NOT_VISIBLE_TO_ACTOR: 'an action reported success but the RFI never reached the next actor',
    PROCEED_DID_NOT_NAVIGATE: 'clicking "Proceed" did not reach the checklist page, and no error toast appeared either',
    UNCLASSIFIED: 'failed for some other reason not tied to a specifically-tracked negative scenario',
  };
  console.log('\n--- NEGATIVE SCENARIOS ---');
  if (failed.length === 0) {
    console.log('None detected — every TC completed cleanly.');
  } else {
    const byScenario = new Map();
    for (const [id, tc] of failed) {
      const key = tc.failureScenario || 'UNCLASSIFIED';
      if (!byScenario.has(key)) byScenario.set(key, []);
      byScenario.get(key).push([id, tc]);
    }
    for (const [scenario, tcs] of byScenario) {
      console.log(`\n[${scenario}] ${SCENARIO_LABELS[scenario] || scenario} — ${tcs.length} TC(s):`);
      for (const [id, tc] of tcs) {
        const lastReject = getLastRejectStep(tc);
        const rejectedBy = lastReject ? `${lastReject.actor} rejected from ${lastReject.page}` : 'no prior reject on record';
        console.log(`  ${id}: stuck at [${tc.failureStage}] — RFI ${tc.rfiCode || '(code not yet known)'} — last reject: ${rejectedBy}`);
        if (tc.failureScreenshot) console.log(`     screenshot: ${tc.failureScreenshot}`);
      }
    }
  }
  console.log('='.repeat(72) + '\n');

  return { done, failed, stuck };
}

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
  let roundsRun = 0;

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
      roundsRun = round;

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
  const { failed, stuck } = printRunSummary(finalTracker, roundsRun);

  // Both buckets fail the test — "failed" carries a real failureReason;
  // "stuck" (MAX_ROUNDS exhausted with a TC that neither finished nor
  // failed — e.g. a step that silently stopped advancing) previously had NO
  // assertion covering it at all, so a run could report "0 failed" while
  // genuinely leaving work unfinished. Both get their own clearly-labeled
  // message here rather than a bare Playwright locator error.
  const problems = [
    ...failed.map(([id, tc]) =>
      `${id} [${tc.failureStage || 'unknown stage'}]${tc.failureScenario ? ` (${tc.failureScenario})` : ''}: ${tc.failureReason}`),
    ...stuck.map(([id, tc]) =>
      `${id}: STUCK at step ${tc.currentStepIndex + 1}/${tc.steps.length} — never reached done or failed within ${roundsRun} round(s)`),
  ];
  expect(problems, 'Some TCs did not complete cleanly — see the summary above / tracker for details').toEqual([]);
});
