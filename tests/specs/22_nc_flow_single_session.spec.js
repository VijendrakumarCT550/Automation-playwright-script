const { test, expect } = require("@playwright/test");
const { loginFreshRoleSession } = require("../utils/helpers");
const { loadTracker, getPendingStepsForActor } = require("../utils/nc-tracker-utils");
const { runQITurn, runCITurn, runEETurn } = require("../utils/nc-flow-turns");

// EXPERIMENTAL — NC's equivalent of 21_rfi_flow_single_session.spec.js.
// Deliberately its own file, not shared with the RFI version, per the same
// NC/RFI isolation instruction that keeps nc-flow-turns.js separate from
// rfi-flow-turns.js.
//
// Alternative to the nc-qi-create/nc-ci-pass-N/nc-ee-pass-N/nc-qi-pass-N
// dependency chain in playwright.config.js (15/16/17_nc_flow_*.spec.js).
// That chain logs in fresh for every pass — up to 10 logins total for the
// 4-TC/3-round-deep NC matrix (1 create + 3 roles x 3 cycles), each a
// brand-new browser context. This spec logs in as CI/EE/QI exactly ONCE
// EACH, in parallel, then keeps all three sessions alive for the whole
// regression, round-robining turns between them until every TC's tracker
// entry reaches "done" (or the safety cap trips).
//
// Round order is QI -> CI -> EE (not CI -> EE -> QI like RFI's), because QI
// plays TWO roles in NC's flow: creating the NC in the first place AND
// reviewing it last each cycle (the reverse of RFI, where CI creates).
// Calling runQITurn() first each round means it naturally handles BOTH "any
// TC not yet created" AND "any TC pending my review from last round's EE
// action" in the same pass — no separate up-front create call needed, that
// role is just folded into round 1's QI turn instead.
//
// Reuses the EXACT SAME runQITurn/runCITurn/runEETurn as 15/16/17 (see
// tests/utils/nc-flow-turns.js) — only the login/session-lifecycle model
// differs, not the actual NC-flow logic. Operates on the SAME
// tests/fixtures/nc-tracker.json as the pass-chain specs, so run
// `npm run reset:nc-tracker` first and don't run this alongside (or
// interleaved with) the nc-*-pass-N chain — both would race on the same
// tracker file.
//
// Standalone (not part of any project dependency chain) — runs under the
// default `chromium` project:
//   npx playwright test tests/specs/22_nc_flow_single_session.spec.js --project=chromium
test("NC: full regression, one session per role (CI/EE/QI logged in once each)", async ({ browser }) => {
  test.setTimeout(60 * 60 * 1000);

  // allSettled, not all() — see 21_rfi_flow_single_session.spec.js's
  // identical comment: one role's login rejecting must not leak whichever
  // other roles DID finish logging in.
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
    // NC's deepest TC (TC-04, both EE and QI reject once) needs 4 rounds in
    // this QI-first ordering (create+cycle1, cycle2, cycle3, final QI
    // approve) — see this file's header comment. Safety cap, not a
    // hardcoded round count; the loop exits early via the "nothing
    // pending" check below.
    const MAX_ROUNDS = 8;

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      const tracker = loadTracker();
      const stillPending = ["QI", "CI", "EE"].some(
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
      await runQITurn(qi.page);
      await runCITurn(ci.page);
      await runEETurn(ee.page);

      if (round === MAX_ROUNDS) {
        console.log(`Reached MAX_ROUNDS (${MAX_ROUNDS}) with work still pending — check tracker for a stuck TC.`);
      }
    }
  } finally {
    await Promise.all([
      ci.context.close(),
      ee.context.close(),
      qi.context.close(),
    ]);
  }

  // Same "0 passed still exits 0" gap as RFI's version — see
  // 21_rfi_flow_single_session.spec.js's identical comment.
  const finalTracker = loadTracker();
  const failedTCs = Object.entries(finalTracker).filter(([, tc]) => tc.status === "failed");
  expect(failedTCs.map(([id, tc]) => `${id}: ${tc.failureReason}`), 'Some TCs failed — see tracker for details').toEqual([]);
});
