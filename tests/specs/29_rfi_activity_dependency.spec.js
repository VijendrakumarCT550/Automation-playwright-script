const { test } = require('@playwright/test');
const { PILING_ACTIVITY_CHAINS } = require('../utils/rfi-dependency-data');
const { runDependencyChainForActivity } = require('../utils/rfi-dependency-flow');

test.describe.configure({ mode: 'serial' });

// Activity Dependency (checkpoint-level) validation, for all three Piling
// activities: Piling - MMS, Piling - Inverter, Piling - LT Cable Hanger
// System. Deliberately its own file, separate from every existing RFI/NC
// flow-pass spec (08-10, 15-17, 21-22, 23, 24) — doesn't touch
// rfi-tracker.json/nc-tracker.json, creates purely ad-hoc RFIs (same
// convention as 23_rfi_data_integrity.spec.js / 24_rfi_draft_autosave.spec.js),
// so a failure here can never block or corrupt the tracked regression.
//
// Scope: only the FIRST version (V1) of every RFI — no reject/resubmit
// cycles. Every RFI created here is approved by BOTH EE and QI, and only
// the first three checkpoints of each activity's five-checkpoint sequence
// (see docs/rfi-activity-dependency-chain.md and
// tests/utils/rfi-dependency-data.js's header comment for why the other
// two, Epoxy Coating/Routine Testing, are out of scope for now).
//
// Repeatability: this spec picks ONE specific Work Section per run (never
// "select all") — the app owner's other suggested option was selecting
// ALL available Work Sections and rotating the Work Area on every rerun,
// but pinning one specific section is simpler and self-repeating: each
// run's blocked first attempt naturally picks whichever Work Section is
// still unused for that checkpoint (already-consumed ones drop out of the
// dropdown), so rerunning this spec against the same Work Area just picks
// a different Work Section automatically — no manual rotation needed.
//
// The "any ONE of several mutually-exclusive Inspection Checklist options
// may be selected" note (e.g. Fixed Tilt vs. Tracker for solar panel
// installation) doesn't come up for these three checkpoints — each has
// exactly one Inspection Checklist option (confirmed live via
// 00_inspect_rfi_dependency_checkpoints.spec.js /
// 00_inspect_rfi_piling_activities.spec.js), so there's nothing to choose
// between here. Documented for whoever extends this to a checkpoint that
// does have more than one.
for (const activityChain of PILING_ACTIVITY_CHAINS) {
  test(`RFI Activity Dependency chain: ${activityChain.label} (Pile -> Pile Cap -> Post Pour Inspection)`, async ({ page }) => {
    // 3 checkpoints x (create + EE approve + QI approve), plus 2 deliberately-
    // blocked attempts along the way -> up to 9 logins in one run (each
    // loginAsRole() is a fresh, full PWA login — see project_pulse_app memory).
    test.setTimeout(60 * 60 * 1000);
    await runDependencyChainForActivity(page, activityChain);
  });
}
