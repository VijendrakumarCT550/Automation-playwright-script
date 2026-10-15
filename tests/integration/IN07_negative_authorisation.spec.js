const { specOnDrs, runSpecBody } = require('./spec-on-drs');

// ===========================================================================
// IN07. negative authorisation — Negative authorisation (spec 33): each role is refused what it may not do.
//
// RUNS tests/specs/33_negative_authorisation.spec.js UNCHANGED on the DRS project
// (app owner, 2026-09-26: "add all"). specOnDrs points the spec at the DRS
// profile, users and ground; see spec-on-drs.js. Ground (docs/drs-pulse-integration.md):
// BL08 for the linked-NC specs (IN10-IN12),
// IN04's NC Robotic Docking, so no triple is shared), BL05 for the NC-create specs.
//
// Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN07_negative_authorisation.spec.js
// ===========================================================================

specOnDrs({});
runSpecBody(require.resolve('../specs/33_negative_authorisation.body.js'));
