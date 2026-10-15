const { specOnDrs, blArea, runSpecBody } = require('./spec-on-drs');

// ===========================================================================
// IN13. nc draft autosave — NC draft autosave (spec 32): what a half-filled NC form keeps.
//
// RUNS tests/specs/32_nc_draft_autosave.spec.js UNCHANGED on the DRS project
// (app owner, 2026-09-26: "add all"). specOnDrs points the spec at the DRS
// profile, users and ground; see spec-on-drs.js. Ground (docs/drs-pulse-integration.md):
// BL08 for the linked-NC specs (IN10-IN12),
// BL05 for the NC-create specs.
//
// Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN13_nc_draft_autosave.spec.js
// ===========================================================================

specOnDrs({ roles: ['QI'], ground: { workArea: blArea(5), ncVendor: true }, wam: { label: 'IN13 prereq' } });
runSpecBody(require.resolve('../specs/32_nc_draft_autosave.body.js'));
