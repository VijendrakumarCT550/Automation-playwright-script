const { specOnDrs, blArea, runSpecBody } = require('./spec-on-drs');

// ===========================================================================
// IN11. linked nc multi — Linked-NC plural rule (spec 37): every linked NC must be approved.
//
// RUNS tests/specs/37_rfi_linked_nc_multi.spec.js UNCHANGED on the DRS project
// (app owner, 2026-09-26: "add all"). specOnDrs points the spec at the DRS
// profile, users and ground; see spec-on-drs.js. Ground (docs/drs-pulse-integration.md):
// BL08 for the linked-NC specs (WAM-sweep ground, no RFI/NC consumers; BL02 was the first
// choice but the CI's RFI form does not offer it on pulse-uat, 2026-09-27 — see the doc),
// BL05 for the NC-create specs.
//
// Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN11_linked_nc_multi.spec.js
// ===========================================================================

specOnDrs({ roles: ['CI', 'EE', 'QI'], ground: { workArea: blArea(8) }, wam: { label: 'IN11 prereq' } });
runSpecBody(require.resolve('../specs/37_rfi_linked_nc_multi.body.js'));
