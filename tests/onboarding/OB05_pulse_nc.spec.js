const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { openFromPendingWithMe } = require('../utils/nc-nav');
const DashboardPage = require('../pages/DashboardPage');
const NCCreatePage = require('../pages/NCCreatePage');
const NCResponsePage = require('../pages/NCResponsePage');
const NCReviewPage = require('../pages/NCReviewPage');
const {
  profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers, ciRoleFor,
} = require('../integration/drs-profile');
const { onboardingOnly, plan } = require('./pulse-plan');

// ===========================================================================
// OB05 — ONE NC CYCLE ON EVERY WORK AREA OF THE RUN'S PROJECT (onboarding suite,
// docs/drs-onboarding-suite.md §5): QI raises -> CI responds -> EE approves ->
// QI approves (the Electrical one: CIE responds).
//   WA<nn>       Civil       Piling - Robotic Docking System (the proven NC data, IN04)
//   WA<nn>       Electrical  the first standard Electrical activity
//   Road<nn>     Civil       Road Works - IDT Road GSB
//   Drain<nn>    Civil       Drain Work
//   Culvert<nn>  Civil       Culvert Works -PCC
// Plus one NC per sub-activity of every new code (PCxx / QCxx / PExx / QExx).
// NC-only file (standing rule: NC never shares code with RFI). Runs AFTER OB04, so
// a not-yet-approved NC never blocks an OB04 RFI on the same section.
// Each NC is recorded on the project (pulse.onboardingNc); a re-run skips passed ones.
// Run (one project): DRS_PROJECT_TAG=<tag> PULSE_ENV=uat npx playwright test --project=onboarding tests/onboarding/OB05_pulse_nc.spec.js --workers=1
// ===========================================================================

const profile = onboardingOnly(profileForSpec());
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

const COMMON = { defectType: '__first__', category: 'Critical', targetDateClosureDays: 14 };
const KINDS = [
  { kind: 'WA', pkg: 'Civil', activity: 'Piling - Robotic Docking System', subActivity: 'Piling - Robotic Docking System', workSectionCount: 2, ncQuantity: 2, unit: 'EA' },
  { kind: 'WA', pkg: 'Electrical', activity: '__first__', subActivity: '__first__', workSectionCount: 1, ncQuantity: 1, unit: '__first__' },
  { kind: 'Road', pkg: 'Civil', activity: 'Road Works - IDT Road GSB', subActivity: '__first__', workSectionCount: 1, ncQuantity: 1, unit: '__first__' },
  { kind: 'Drain', pkg: 'Civil', activity: 'Drain Work', subActivity: '__first__', workSectionCount: 1, ncQuantity: 1, unit: '__first__' },
  { kind: 'Culvert', pkg: 'Civil', activity: 'Culvert Works -PCC', subActivity: '__first__', workSectionCount: 1, ncQuantity: 1, unit: '__first__' },
];
// The vendor as the NC form's Vendor Name list shows it (substring match).
const VENDOR = { Civil: 'AUTOMATION SERVICE', Electrical: 'AUTOMATION ELECTRICAL' };

function items() {
  if (profile.unavailable) return [];
  const out = [];
  for (const wa of profile.drs.project.workAreas) {
    const kind = (wa.match(/^(WA|Road|Drain|Culvert)\d+$/) || [])[1];
    for (const k of KINDS.filter((x) => x.kind === kind)) {
      out.push({ id: `${wa}/${k.pkg}/NC`, workArea: wa, version: profile.drs.project.areaVersions[wa], ...k });
    }
  }
  // EVERY SUB-ACTIVITY OF EVERY NEW CODE (app owner, 2026-10-21: "all newly added
  // entities tested fully"): one NC each - PCxx / QCxx with the Civil vendor + CI,
  // PExx / QExx with the Electrical vendor + CIE (pulse-plan ncItems).
  for (const v of plan(profile.drs.project)) {
    for (const n of v.ncItems) {
      out.push({ id: n.id, workArea: n.workArea, version: v.version, kind: 'code', pkg: n.pkg,
        activity: n.activity, subActivity: n.subActivity, workSectionCount: 1, ncQuantity: 1, unit: '__first__' });
    }
  }
  return out;
}

const done = (id) => ((recordedPulse(profile).onboardingNc || {})[id] || {}).status === 'passed';
// Merged into the CURRENT map inside the state lock: lanes run in parallel.
function record(id, patch) {
  recordPulse(profile, (cur) => {
    const all = cur.onboardingNc || {};
    return { onboardingNc: { ...all, [id]: { ...(all[id] || {}), ...patch, at: new Date().toISOString() } } };
  });
}

if (profile.unavailable) test('OB05. NCs on the run\'s Work Areas', () => requireAvailable(profile));

// ONE VERSION = ONE LANE, in order (2026-10-21): Pulse's per-Work-Area code counter
// handed two concurrent RFI creates the same code, and NC codes are numbered the
// same way - so a version's NCs never run side by side; versions run in parallel.
const byVersion = items().reduce((m, it) => ((m[it.version] = m[it.version] || []).push(it), m), {});
for (const [version, list] of Object.entries(byVersion)) test.describe(version, () => {
test.describe.configure({ mode: 'default' });
for (const item of list) {
  test(`OB05. ${item.id} (${item.version}): QI -> ${ciRoleFor(item.pkg)} -> EE -> QI`, async ({ browser }) => {
    requireAvailable(profile);
    test.setTimeout(60 * 60 * 1000);
    if (done(item.id)) { console.log(`  ${item.id}: passed earlier - skipped`); return; }
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    const CI = ciRoleFor(item.pkg);
    const users = drsUsers(profile, [CI, 'EE', 'QI']);
    for (const r of [CI, 'EE', 'QI']) expect(users[r], `${r} not recorded - run IN01 first`).toBeTruthy();
    const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);

    const context = await browser.newContext({ permissions: ['geolocation', 'camera'], geolocation: { latitude: 23.0225, longitude: 72.5714 } });
    const page = await context.newPage();
    let code = null;
    try {
      console.log(`  QI ${users.QI.name}: NC on ${profile.drs.project.workLocation} / ${item.workArea} / ${item.pkg} / ${item.activity}`);
      await loginAs(page, 'QI');
      const ncCreate = new NCCreatePage(page);
      await ncCreate.goto();
      await ncCreate.clickCreateNC();
      const sections = await ncCreate.fillForm({
        workLocation: profile.drs.project.workLocation, workArea: item.workArea, vendorName: VENDOR[item.pkg],
        package: item.pkg, activity: item.activity, subActivity: item.subActivity,
        workSectionCount: item.workSectionCount, ncQuantity: item.ncQuantity, unit: item.unit, ...COMMON,
        ncDescription: `Onboarding NC ${item.id} - ${profile.drs.project.name}`,
      });
      await ncCreate.submitNC();
      const m = page.url().match(/nc\/([a-f0-9-]+)$/i);
      expect(m, `no NC id in the post-submit URL "${page.url()}"`).toBeTruthy();
      const ncId = m[1];
      const dashboard = new DashboardPage(page);
      await dashboard.goToDashboard().catch(() => {});
      await dashboard.waitForContentOnly().catch(() => {});
      await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${ncId}`);
      await page.waitForLoadState('networkidle');
      code = await new NCReviewPage(page).getVisibleCode();
      expect(code, 'no visible NC code after create').toBeTruthy();
      console.log(`  ✓ NC ${code} raised on ${(sections || []).join(', ')}`);
      record(item.id, { status: 'raised', code, id: ncId, version: item.version, workSections: sections });

      await loginAs(page, CI);
      await openFromPendingWithMe(page, code);
      const response = new NCResponsePage(page);
      expect(await response.getAttachmentCount(), `${CI} sees 0 attachments - the QI's mandatory photo did not propagate`).toBeGreaterThan(0);
      await response.fillResponse({ rootCause: 'Onboarding - automated root cause', correctiveActions: 'Onboarding - automated corrective actions' });
      await response.submitResponse();
      console.log(`  ✓ ${CI} responded`);

      for (const role of ['EE', 'QI']) {
        await loginAs(page, role);
        await openFromPendingWithMe(page, code);
        const review = new NCReviewPage(page);
        expect(await review.getAttachmentCount(), `${role} sees 0 attachments on ${code}`).toBeGreaterThan(0);
        await review.approve();
        console.log(`  ✓ ${role} approved ${code}`);
      }
      record(item.id, { status: 'passed' });
    } catch (err) {
      record(item.id, { status: 'failed', code, error: err.message.split('\n')[0].slice(0, 300) });
      throw err;
    } finally {
      await context.close();
    }
  });
}
});
