const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
const { resolveRfiFixture } = require('../utils/smoke-rfi-fixture');
const {
  createAndSubmitCheckpoint, getVisibleCodeFor, approveAsRole, resetToMyTasks,
} = require('../utils/rfi-dependency-flow');
const {
  profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers, packageProfile, ciRoleFor,
} = require('./drs-profile');
const DATA = require('../drs/drs-data');
const state = require('../drs/utils/drs-state');
const { buildTree, CHECKLIST } = require('../drs-setting/pc-data');

// ===========================================================================
// IN15 — RFI ON OUR OWN SITE CATALOG (app owner, 2026-10-15; Civil first).
// docs/drs-catalog-versions-and-so-lines.md.
//
// The existing RFI cycle (CI raises → EE approves → QI approves, as IN03), but on
// the catalog chain WE built and the work region made for it:
//   VER-SITE-V1  (pinned to "<site> v1")  PC01 Sub Package → PC01.1 Activity →
//                PC01.1.1 Sub Activity → PC01.1.1 Checkpoint a (Micro Pile Checklist)
//   VER-SITE-V2  (pinned to "<site> v2")  the same on PC02 - the code v2 added
// Each area uses its version's OWN newest Civil code, so the RFI proves that
// version's catalog reached Pulse (v2 also carries PC01, inherited from v1).
//
// WAM first: CI (with our SO), EE and QI onto the VER-SITE areas - IN02 maps only
// the BL ground.
//
// Prereqs (DRS): tests/drs-setting/catalog_site_versions.spec.js (versions locked),
// npm run drs:setup (VER-* areas pinned, SO line per version, D05/D06 mapping the
// new activities). Pulse: IN01 (users of this project).
// Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN15_rfi_site_catalog.spec.js --workers=1
// ===========================================================================

const profile = profileForSpec();
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
// Civil first, then Electrical (app owner, 2026-10-15). IN15_PACKAGES=Electrical
// runs one package only (e.g. when Civil is already proven on this project).
const PACKAGES = String(process.env.IN15_PACKAGES || 'Civil,Electrical').split(',').map((x) => x.trim()).filter(Boolean);

// One target per (package, site-version Work Area): the version's own newest
// P-code of that package (Civil PC0n, Electrical PE0n).
function targets(pkg) {
  if (profile.unavailable) return [{ pkg, workArea: '(unavailable)', version: '?', code: '?' }];
  const env = state.envRecord(profile.drs.env);
  return profile.drs.project.workAreas
    .filter((wa) => DATA.isSiteVersionArea(wa))
    .map((wa) => {
      const version = DATA.versionFor(wa);
      const codes = DATA.catalogCodes(env, version, pkg).filter((c) => c.startsWith('P'));
      return { pkg, workArea: wa, version, code: codes[codes.length - 1] };
    });
}

// profile.rfi for one target: our catalog's chain on the target's Work Area.
function rfiFor(t) {
  const tree = buildTree(t.code);
  const activity = tree.activities[0];
  const sub = activity.subActivities[0];
  const cp = sub.checkpoints[0];
  return {
    workLocation: profile.drs.project.workLocation,
    workArea: t.workArea,
    package: t.pkg,
    subPackage: tree.name,
    activity: activity.name,
    workSection: null,
    rfiQuantity: null,
    unit: null,
    subContractor: null,
    checkpointChain: [{ subActivity: sub.name, checkpoint: cp.name, checklist: CHECKLIST[cp.key].chip }],
  };
}

test.describe.configure({ mode: 'serial' });

for (const pkg of PACKAGES) {
  const TARGETS = targets(pkg);
  // WAM is per PACKAGE (the Package filter is part of the assignment), so each
  // package maps ITS CI (with ITS vendor's SO), and the shared EE and QI, on the
  // site-version areas. One vendor + SO per package (DRS D01/D04, 2026-10-15):
  // Civil -> CI, Electrical -> CIE.
  const CI = ciRoleFor(pkg);
  const ROLES = [CI, 'EE', 'QI'];
  const pkgProfile = () => packageProfile(profile, pkg);

  test(`IN15a. ${pkg}: CI / EE / QI mapped on ${TARGETS.map((t) => t.workArea).join(' + ')}`, async ({ browser }) => {
    requireAvailable(profile);
    test.setTimeout(30 * 60 * 1000);
    expect(TARGETS.length, 'the project has no site-version Work Areas (BL<nn> S-v<n>) - run npm run drs:setup').toBeGreaterThan(0);
    for (const t of TARGETS) expect(t.code, `${t.version} / ${pkg}: no locked catalog codes recorded - run catalog_site_versions.spec.js`).toBeTruthy();
    const users = drsUsers(profile, ROLES);
    for (const r of ROLES) expect(users[r], `${r} not recorded - run IN01 first`).toBeTruthy();

    const areas = TARGETS.map((t) => t.workArea);
    const { assigned } = await ensureWorkAreaMapping(browser, pkgProfile(), users, { roles: ROLES, areas, label: `IN15 ${pkg}` });
    const wam = recordedPulse(profile).siteCatalogWam || {};
    recordPulse(profile, { siteCatalogWam: { ...(wam.roles ? { Civil: wam } : wam), [pkg]: { roles: ROLES, areas, assigned, at: new Date().toISOString() } } });
  });

  for (const t of TARGETS) {
  test(`IN15. ${pkg}: RFI on ${t.workArea} (${t.version}) - ${t.code}.1.1 Checkpoint a: CI → EE → QI`, async ({ browser }) => {
    requireAvailable(profile);
    test.setTimeout(45 * 60 * 1000);
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    const users = drsUsers(profile, ROLES);
    for (const r of ROLES) expect(users[r], `${r} not recorded - run IN01 first`).toBeTruthy();
    const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);

    const fixture = resolveRfiFixture({ ...profile, rfi: rfiFor(t) });
    const context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    const page = await context.newPage();
    try {
      const b = fixture.baseData;
      console.log(`  ${CI} ${users[CI].name}: ${b.workLocation} / ${b.workArea} / ${b.package} / ${b.subPackage} / ${b.activity} / ${b.subActivity} / ${fixture.checkpoint.name} (${fixture.checkpoint.checklist})`);
      await loginAs(page, CI);
      const { rfiId, workSectionLabel } = await createAndSubmitCheckpoint(page, b, fixture.checkpoint, '__random__');
      const code = await getVisibleCodeFor(page, rfiId);
      console.log(`  ✓ RFI ${code} (${rfiId}) on work section ${workSectionLabel}`);
      expect(code, 'no visible RFI code after submit').toBeTruthy();
      const rfi = {
        id: rfiId, code, package: pkg, workArea: t.workArea, version: t.version, catalogCode: t.code,
        checkpoint: fixture.checkpoint.name, workSection: workSectionLabel, status: 'submitted',
      };
      recordPulse(profile, { siteCatalogRfis: [...(recordedPulse(profile).siteCatalogRfis || []), rfi] });
      await resetToMyTasks(page);

      console.log(`  EE ${users.EE.name}: approving ${code}`);
      await approveAsRole(page, 'EE', code, { loginAs });
      console.log('  ✓ EE approved');
      console.log(`  QI ${users.QI.name}: approving ${code}`);
      await approveAsRole(page, 'QI', code, { loginAs });
      console.log('  ✓ QI approved');

      const rfis = (recordedPulse(profile).siteCatalogRfis || []).map((r) => (r.id === rfiId ? { ...r, status: 'approved' } : r));
      recordPulse(profile, { siteCatalogRfis: rfis });
    } finally {
      await context.close();
    }
  });
}
}
