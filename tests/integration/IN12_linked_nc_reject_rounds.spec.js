const { specOnDrs, blArea, runSpecBody } = require('./spec-on-drs');

// ===========================================================================
// IN12. linked nc reject rounds — Linked-NC reject rounds (spec 38): the gate survives EE/QI rejections.
//
// RUNS tests/specs/38_rfi_linked_nc_reject_rounds.spec.js UNCHANGED on the DRS project
// (app owner, 2026-09-26: "add all"). specOnDrs points the spec at the DRS
// profile, users and ground; see spec-on-drs.js. Ground (docs/drs-pulse-integration.md):
// BL08 for the linked-NC specs (WAM-sweep ground, no RFI/NC consumers; BL02 was the first
// choice but the CI's RFI form does not offer it on pulse-uat, 2026-09-27 — see the doc),
// BL05 for the NC-create specs.
//
// Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN12_linked_nc_reject_rounds.spec.js
// ===========================================================================

specOnDrs({ roles: ['CI', 'EE', 'QI'], ground: { workArea: blArea(8) }, wam: { label: 'IN12 prereq' } });
runSpecBody(require.resolve('../specs/38_rfi_linked_nc_reject_rounds.body.js'));
