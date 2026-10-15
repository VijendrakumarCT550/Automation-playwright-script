const { specOnDrs, blArea, runSpecBody } = require('./spec-on-drs');

// ===========================================================================
// IN14. nc bulk create — NC bulk create (spec 39): N NCs as the QI in one session.
//
// RUNS tests/specs/39_nc_bulk_create_qi.spec.js UNCHANGED on the DRS project
// (app owner, 2026-09-26: "add all"). specOnDrs points the spec at the DRS
// profile, users and ground; see spec-on-drs.js. Ground (docs/drs-pulse-integration.md):
// BL08 for the linked-NC specs (IN10-IN12),
// BL05 for the NC-create specs.
//
// Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN14_nc_bulk_create.spec.js
// ===========================================================================

specOnDrs({ roles: ['QI'], ground: { workArea: blArea(5), ncVendor: true }, wam: { label: 'IN14 prereq' } });
runSpecBody(require.resolve('../specs/39_nc_bulk_create_qi.body.js'));
