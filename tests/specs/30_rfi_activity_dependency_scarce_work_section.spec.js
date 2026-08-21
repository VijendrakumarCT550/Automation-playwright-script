const { test } = require('@playwright/test');
const { SCARCE_WORK_SECTION_CHAINS } = require('../utils/rfi-dependency-data');
const { runDependencyChainForScarceWorkSectionActivity } = require('../utils/rfi-dependency-flow');

test.describe.configure({ mode: 'serial' });

// Activity Dependency (checkpoint-level) validation for activities whose
// Work Section granularity is at the whole WORK AREA level — "IDT Civil &
// Structural"'s Sub-Activities each have exactly ONE Work Section option
// per Work Area, literally the Work Area's own name (confirmed live, see
// tests/utils/rfi-dependency-data.js's header comments). Companion to
// 29_rfi_activity_dependency.spec.js, which covers the three Piling
// activities (hundreds of Work Sections each, so a
// throwaway-Work-Section-per-blocked-attempt strategy works fine there).
// That strategy is impossible here — sacrificing the ONLY Work Section
// for a blocked-attempt would leave nothing for the real chain — so this
// spec uses a different orchestration function
// (runDependencyChainForScarceWorkSectionActivity, in
// tests/utils/rfi-dependency-flow.js): every blocked-attempt happens on
// one dedicated, sacrificial Work Area, while the real chain runs
// entirely on a separate, untouched one.
//
// Same isolation from the tracked regression as 29_rfi_activity_dependency.spec.js
// (no tracker-utils, ad-hoc RFIs only) and same V1-only, EE+QI-approved
// scope — see docs/rfi-activity-dependency-chain.md.
for (const activityChain of SCARCE_WORK_SECTION_CHAINS) {
  const chainLabel = activityChain.checkpoints.map((c) => c.name).join(' -> ');
  test(`RFI Activity Dependency chain (scarce Work Section): ${activityChain.label} (${chainLabel})`, async ({ page }) => {
    test.setTimeout(60 * 60 * 1000);
    await runDependencyChainForScarceWorkSectionActivity(page, activityChain);
  });
}
