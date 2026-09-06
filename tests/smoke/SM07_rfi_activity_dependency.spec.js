const { test, expect } = require('../config/test-base');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { runDependencyChainForActivity } = require('../utils/rfi-dependency-flow');

// Tail stage (file SM07): the smoke replica of 29_rfi_activity_dependency.spec.js
// — checkpoint-level dependency enforcement (checkpoint[i+1] blocked until
// checkpoint[i] is approved) — run as the SMOKE chain's own created CI/EE/QI
// instead of the .env accounts.
//
// ---------------------------------------------------------------------------
// WHY A REPLICA AND NOT A REUSE
// ---------------------------------------------------------------------------
// App owner, 2026-09-04: "dont use cic, EE and QI from env, use last created
// users; if required make replica of all specs in smoke and keep separate."
// Two independent reasons the .env accounts don't work here on pulse-qa:
//
//   1. SLOW/HUNG. Measured: .env CI takes 7.9 minutes to log in and .env EE
//      HANGS at a 100% PWA spinner past the 10-minute test timeout — both carry
//      months of accumulated offline data. The smoke users are freshly created
//      and log in in seconds.
//   2. WRONG GROUND. 29/30 run on A-06c/BL09/BL10, which the smoke CI/EE/QI are
//      never WAM'd onto, and WAM-ing them there would EVICT the .env users from
//      the regression's own areas (CI/QI rows are single-assignee — rule R3).
//
// So this drives the SAME driver function (runDependencyChainForActivity, from
// rfi-dependency-flow.js — zero duplicated dependency logic) with an injected
// login and the profile's OWN work area (S05b/BL07 for solar — see
// dependencyChain's header comment in tests/config/projects.js). The driver
// defaults its login to loginAsRole when no override is given, so
// 29_rfi_activity_dependency.spec.js itself is completely unaffected by this.
//
// ---------------------------------------------------------------------------
// SESSION MODEL
// ---------------------------------------------------------------------------
// NOT the three-parallel-session model SM05/SM06 use. The dependency driver is
// an inherently SERIAL chain on ONE page — CI creates, then EE approves, then
// QI approves, then CI creates the next checkpoint — so there is nothing to
// round-robin between. This mirrors spec 29's own single-`page` shape exactly,
// just with the login swapped out.
//
// ---------------------------------------------------------------------------
// SOLAR ONLY, FOR NOW
// ---------------------------------------------------------------------------
// profile.dependencyChain is null for wind (parked, see projects.js) — this
// fails loudly rather than skipping, the same way SM06 fails loudly on wind's
// `nc: null` rather than silently passing.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const ROLES = ['CI', 'EE', 'QI'];

test('RFI Activity Dependency chain (smoke, created users)', async ({ page, profile }) => {
  // Up to 9 logins in one linear run (see runDependencyChainForActivity's header
  // comment), each now a fast created-user login rather than a multi-minute .env
  // PWA load — 45 minutes leaves generous headroom for withRetry's retries.
  test.setTimeout(45 * 60 * 1000);

  expect(
    profile.dependencyChain,
    `Profile "${profile.key}" has no dependencyChain — WTG RFI/dependency work is ` +
    `parked (app owner, 2026-09-02: "no need WTG as of now"). See project_wtg_inclusion memory.`
  ).toBeTruthy();
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const users = resolveSmokeUsers(profile, ROLES);

  console.log(
    `\n=== Smoke RFI activity dependency: "${profile.key}" ===\n` +
    `    ${profile.dependencyChain.workLocation} / ${profile.dependencyChain.workArea} / ` +
    `${profile.dependencyChain.package} / ${profile.dependencyChain.activity}\n` +
    `    checkpoints: ${profile.dependencyChain.checkpoints.map((c) => c.name).join(' -> ')}`
  );
  for (const role of ROLES) console.log(`    ${role}: ${users[role].name} <${users[role].email}>`);
  console.log('');

  // Injected into every internal loginAsRole(page, role) call inside
  // rfi-dependency-flow.js — see its header comment. Resolves the smoke user for
  // whichever role the driver asks for, on the SAME page (this chain never
  // parallelises sessions, so the reused-page login is the right one, not
  // loginFreshUserSession's fresh-context variant).
  const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);

  await runDependencyChainForActivity(page, profile.dependencyChain, { loginAs });
});
