const { test } = require('@playwright/test');
const { adminFreshLogin } = require('../../utils/helpers');
const { openAssignmentDialog } = require('../../utils/smoke-wam');
const { profileForSpec, drsUsers, packageProfile, ciRoleFor } = require('../../integration/drs-profile');

// READ-ONLY PROBE (2026-10-22): which Work Area rows Admin's WAM "Add Details"
// dialog offers per package for the CI, on the onboarded project. Opened after
// OB03 found CV03-S1 but not CV04-S1. Assigns nothing; closes the dialog.
// Run: DRS_PROJECT_TAG=<tag> PULSE_ENV=uat npx playwright test --project=onboarding tests/onboarding/inspection/probe_wam_rows.spec.js
const profile = profileForSpec();

for (const pkg of ['Civil', 'Electrical']) {
  test(`probe: WAM rows for ${ciRoleFor(pkg)} / ${pkg}`, async ({ browser }) => {
    test.setTimeout(5 * 60 * 1000);
    const role = ciRoleFor(pkg);
    const user = drsUsers(profile, [role])[role];
    const p = packageProfile(profile, pkg);
    const { context, page, dashboard } = await adminFreshLogin(browser, { viewport: { width: 1600, height: 1000 }, isMobile: false, hasTouch: false });
    try {
      const filters = {
        role: user.role, cluster: p.cluster, site: p.site, workLocation: p.workLocations[0], package: p.packages[0],
        serviceOrder: [p.vendor.serviceOrder, p.vendor.name],
      };
      const wam = await openAssignmentDialog(page, dashboard, filters);
      const rows = await wam.dialog.locator('div.d_grid').evaluateAll((els) => els.map((e) => (e.innerText || '').split('\n')[0].trim()));
      console.log(`  ${pkg}: ${rows.length} rows`);
      console.log(`  ${rows.join(' | ')}`);
      const want = Object.keys(profile.drs.project.areaVersions || {});
      console.log(`  in DRS areaVersions but NOT a row: ${want.filter((a) => !rows.includes(a)).join(', ') || '(none)'}`);
      await wam.closeDialog();
    } finally {
      await context.close();
    }
  });
}
