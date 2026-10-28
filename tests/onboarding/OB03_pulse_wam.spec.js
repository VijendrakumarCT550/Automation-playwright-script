const { test, expect } = require('@playwright/test');
const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
const {
  profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers, packageProfile, ciRoleFor,
} = require('../integration/drs-profile');
const { onboardingOnly } = require('./pulse-plan');

// ===========================================================================
// OB03 — PULSE WORK AREA MAPPING FOR THE RUN'S PROJECT (onboarding suite,
// docs/drs-onboarding-suite.md §5). Needs the users (IN01, the runner's stage
// before this) and the DRS side done (D05 / D06 synced to Pulse).
//   Civil       CI  + EE + QI on EVERY Work Area (WA / Road / Drain / Culvert)
//   Electrical  CIE + EE + QI on the WA<nn> areas (the only ones with Electrical
//               activities in SO Configuration)
// WAM is per package (the Package filter is part of the assignment), and each
// package's CI carries that package's vendor SO. ensureWorkAreaMapping only
// assigns what is missing, so a re-run is cheap.
// Run (one project): DRS_PROJECT_TAG=<tag> PULSE_ENV=uat npx playwright test --project=onboarding tests/onboarding/OB03_pulse_wam.spec.js --workers=1
// ===========================================================================

const profile = onboardingOnly(profileForSpec());

// The onboarding areas only: the SM<nn> smoke areas are mapped by the smoke
// stages themselves (SM03 / SM04 ...), exactly as on any smoke ground.
// ONBOARDING_WAM_AREAS (a regex) replaces both lists: onboarding-smoke maps its
// run's coverage areas (CV<nn>-S<k>, Civil + Electrical like WA<nn>) and no others.
const ONLY = process.env.ONBOARDING_WAM_AREAS ? new RegExp(process.env.ONBOARDING_WAM_AREAS) : null;
const AREAS = {
  Civil: () => profile.drs.project.workAreas.filter((wa) => (ONLY || /^(WA|Road|Drain|Culvert)\d+$/).test(wa)),
  Electrical: () => profile.drs.project.workAreas.filter((wa) => (ONLY || /^WA\d+$/).test(wa)),
};

test.describe.configure({ mode: 'serial' });

for (const pkg of Object.keys(AREAS)) {
  const CI = ciRoleFor(pkg);
  const ROLES = [CI, 'EE', 'QI'];
  test(`OB03. ${pkg}: ${CI} / EE / QI mapped on the run's Work Areas`, async ({ browser }) => {
    requireAvailable(profile);
    test.setTimeout(60 * 60 * 1000);
    const users = drsUsers(profile, ROLES);
    for (const r of ROLES) expect(users[r], `${r} not recorded - run IN01 first`).toBeTruthy();
    const areas = AREAS[pkg]();
    expect(areas.length, `${profile.drs.project.name}: no ${pkg} Work Areas`).toBeGreaterThan(0);
    const { assigned } = await ensureWorkAreaMapping(browser, packageProfile(profile, pkg), users, { roles: ROLES, areas, label: `OB03 ${pkg}` });
    const key = ONLY ? `${pkg}_${process.env.ONBOARDING_RECORD || 'only'}` : pkg;
    const wam = recordedPulse(profile).onboardingWam || {};
    recordPulse(profile, { onboardingWam: { ...wam, [key]: { roles: ROLES, areas, assigned, at: new Date().toISOString() } } });
  });
}
