const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
const { resolveRfiFixture } = require('../utils/smoke-rfi-fixture');
const {
  attemptCheckpoint, fillPageOne, getVisibleCodeFor, approveAsRole, resetToMyTasks,
} = require('../utils/rfi-dependency-flow');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const {
  profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers, packageProfile,
} = require('./drs-profile');
const DATA = require('../drs/drs-data');
const state = require('../drs/utils/drs-state');
const { drsEnv, loginSuperAdmin } = require('../drs/utils/drs-ui');
const { buildTree, SITE_CHECKLIST_BINDING } = require('../drs-setting/pc-data');
const ChecklistsConfiguratorPage = require('../drs-setting/ChecklistsConfiguratorPage');

// ===========================================================================
// IN16 — OUR CHECKLISTS + CHECKPOINT DEPENDENCIES, IN PULSE (app owner,
// 2026-10-15; docs/drs-checklists.md §4).
//
// On the Work Area pinned to the newest site catalog version that carries our
// checklists (Automation Site 01 v3 → "BL<nn> S-v3"), for the Civil P-code (PC03):
//   PC03.2.1  a / b / c  → AUTO PC03 Checklist 1 / 2 / 3
//   PC03.2.2  a / b / c  → AUTO PC03 Checklist 4 / 5 / 6
// with a -> b -> c dependencies. Per sub-activity:
//   P1  b is BLOCKED before a exists                 (throwaway Work Section)
//   P3  a is raised: its checklist page shows EVERY question of its DRS checklist
//       (texts + count, read live from the DRS Checklists Configurator)
//   P4  a is submitted, EE + QI approve
//   P1' c is still BLOCKED (b not there yet)          (throwaway Work Section)
//   P2  b now goes through on the SAME Work Section, P3 for b, approve
//   P2  c the same, approve.
// Pulse renders every question as mandatory Text for now (types WIP), so types
// and required/optional are NOT asserted here.
//
// Blocked attempts use a throwaway Work Section ('__random__'): selecting a Work
// Section consumes it for that checkpoint even when Proceed is blocked
// (rfi-dependency-flow.js header). The real chain shares one Work Section.
//
// Prereqs: catalog_site_versions.spec.js (S3+ locked), npm run drs:setup (a project
// with the BL<nn> S-v3 area, SO lines), IN01 (users).
// Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN16_rfi_checklists_dependencies.spec.js --workers=1
// ===========================================================================

const profile = profileForSpec();
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const PACKAGE = 'Civil';
const ROLES = ['CI', 'EE', 'QI'];
const DRS = drsEnv();

// The newest locked site step that made our checklists, and the project's Work
// Area pinned to that version.
function target() {
  if (profile.unavailable) return { workArea: '(unavailable)', code: '?', step: {} };
  const chain = ((state.envRecord(profile.drs.env).catalogs || {})[DATA.site]) || {};
  const step = Object.values(chain).filter((c) => c.status === 'locked' && c.checklists && c.checklistCode).pop();
  if (!step) return { workArea: '(no locked site version with checklists)', code: '?', step: {} };
  const workArea = profile.drs.project.workAreas.find((wa) => DATA.isSiteVersionArea(wa) && DATA.versionFor(wa) === step.label);
  return { workArea: workArea || `(no Work Area pinned to ${step.label})`, version: step.label, code: step.checklistCode, step };
}
const T = target();

// One sub-activity's chain: baseData + its three checkpoints, each with the checklist
// it binds (name + SFQP).
function chainFor(subKey) {
  const tree = buildTree(T.code, { checklists: T.step.checklists, dependencies: true });
  const [a, s] = subKey.split('.').map(Number);
  const activity = tree.activities[a - 1];
  const sub = activity.subActivities[s - 1];
  const base = resolveRfiFixture({
    ...profile,
    rfi: {
      workLocation: profile.drs.project.workLocation, workArea: T.workArea, package: PACKAGE,
      subPackage: tree.name, activity: activity.name, workSection: null, rfiQuantity: null, unit: null, subContractor: null,
      checkpointChain: [{ subActivity: sub.name, checkpoint: sub.checkpoints[0].name, checklist: sub.checkpoints[0].checklist.chip }],
    },
  }).baseData;
  const checkpoints = sub.checkpoints.map((c) => {
    const n = SITE_CHECKLIST_BINDING[subKey][c.key];
    return { name: c.name, checklist: c.checklist.chip, drs: T.step.checklists[n], n };
  });
  return { base, checkpoints, subActivity: sub.name };
}

test.describe.configure({ mode: 'serial' });
const expectedQuestions = {}; // n -> [question texts], read from DRS

test(`IN16a. expected questions of checklists 1-6 read from DRS; ${PACKAGE} WAM on ${T.workArea}`, async ({ browser }) => {
  requireAvailable(profile);
  test.setTimeout(30 * 60 * 1000);
  expect(T.step.checklists, 'no locked site catalog version with our checklists - run catalog_site_versions.spec.js').toBeTruthy();
  expect(T.workArea, `the project has no Work Area pinned to ${T.version} - run npm run drs:setup`).toMatch(/^BL\d+ S-v\d+$/);

  // The source of truth for P3: what the DRS checklist actually holds.
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  const page = await ctx.newPage();
  try {
    await loginSuperAdmin(page, DRS);
    const cl = new ChecklistsConfiguratorPage(page, DRS.baseUrl);
    for (const [n, made] of Object.entries(T.step.checklists)) {
      await cl.goto();
      const got = await cl.read(made.name, made.sfqp);
      expect(got, `${made.name} (${made.sfqp}) not found in DRS`).toBeTruthy();
      expectedQuestions[n] = got.questions.map((q) => q.text);
      console.log(`  checklist ${n} ${made.name} (${made.sfqp}): ${got.questions.length} question(s)`);
    }
  } finally {
    await ctx.close();
  }

  const users = drsUsers(profile, ROLES);
  for (const r of ROLES) expect(users[r], `${r} not recorded - run IN01 first`).toBeTruthy();
  const { assigned } = await ensureWorkAreaMapping(browser, packageProfile(profile, PACKAGE), users, { roles: ROLES, areas: [T.workArea], label: 'IN16' });
  recordPulse(profile, { checklistDeps: { ...(recordedPulse(profile).checklistDeps || {}), wam: { areas: [T.workArea], assigned, at: new Date().toISOString() } } });
});

// P3 + P4 for one checkpoint on the given Work Section: Proceed must go through,
// the checklist page must show every question of the DRS checklist, then submit.
async function raiseWithChecklistCheck(page, base, cp, workSection) {
  const { rfiCreate, workSectionLabel } = await fillPageOne(page, base, { name: cp.name, checklist: cp.checklist }, workSection);
  const outcome = await rfiCreate.clickProceedAndCheckOutcome();
  expect(outcome.proceeded, `"${cp.name}" should proceed (its dependency is approved) but was blocked: "${outcome.toastText}"`).toBe(true);
  const checklist = new RFIChecklistPage(page);
  const filled = await checklist.fillAllObservations('OK - as per standard', true);
  const want = expectedQuestions[cp.n] || [];
  const missing = [];
  for (const text of want) {
    if (!(await page.getByText(text, { exact: false }).first().isVisible().catch(() => false))) missing.push(text);
  }
  console.log(`    ${cp.name}: checklist ${cp.drs.name} - ${filled} question input(s) in Pulse, ${want.length} in DRS${missing.length ? `, MISSING: ${JSON.stringify(missing)}` : ''}`);
  expect(missing, `${cp.name}: questions of ${cp.drs.name} not shown in Pulse`).toEqual([]);
  expect(filled, `${cp.name}: Pulse shows ${filled} question inputs, DRS checklist ${cp.drs.name} has ${want.length}`).toBe(want.length);
  await checklist.submitRFI();
  const m = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  expect(m, `no RFI id after submitting "${cp.name}": ${page.url()}`).toBeTruthy();
  return { rfiId: m[1], workSectionLabel };
}

for (const subKey of Object.keys(SITE_CHECKLIST_BINDING)) {
  test(`IN16. ${T.code}.${subKey} on ${T.workArea}: a → b → c blocked/released, each checklist's questions load`, async ({ browser }) => {
    requireAvailable(profile);
    test.setTimeout(90 * 60 * 1000);
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    expect(Object.keys(expectedQuestions).length, 'IN16a did not read the DRS checklists').toBe(6);
    const users = drsUsers(profile, ROLES);
    const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);
    const { base, checkpoints: [a, b, c], subActivity } = chainFor(subKey);
    console.log(`  ${base.workLocation} / ${base.workArea} / ${base.subPackage} / ${base.activity} / ${subActivity}`);

    const context = await browser.newContext({ permissions: ['geolocation', 'camera'], geolocation: { latitude: 23.0225, longitude: 72.5714 } });
    const page = await context.newPage();
    const record = [];
    try {
      await loginAs(page, 'CI');
      // P1: b blocked before a exists.
      const blocked1 = await attemptCheckpoint(page, base, { name: b.name, checklist: b.checklist }, '__random__');
      console.log(`  P1 ${b.name} before ${a.name}: ${blocked1.proceeded ? 'PROCEEDED (wrong)' : 'blocked'} - "${blocked1.toastText}" (throwaway ${blocked1.workSectionLabel})`);
      expect(blocked1.proceeded, `${b.name} should be BLOCKED before ${a.name} exists`).toBe(false);
      await resetToMyTasks(page);

      // a: no dependency. Its Work Section is shared by the rest of the chain.
      const ra = await raiseWithChecklistCheck(page, base, a, '__random__');
      const ws = ra.workSectionLabel;
      const codeA = await getVisibleCodeFor(page, ra.rfiId);
      record.push({ checkpoint: a.name, code: codeA, checklist: a.drs.name, workSection: ws });
      console.log(`  ✓ ${codeA} for ${a.name} on ${ws}`);
      await resetToMyTasks(page);

      // P1': c still blocked while b does not exist.
      const blocked2 = await attemptCheckpoint(page, base, { name: c.name, checklist: c.checklist }, '__random__');
      console.log(`  P1 ${c.name} before ${b.name}: ${blocked2.proceeded ? 'PROCEEDED (wrong)' : 'blocked'} - "${blocked2.toastText}"`);
      expect(blocked2.proceeded, `${c.name} should be BLOCKED before ${b.name} exists`).toBe(false);
      await resetToMyTasks(page);

      await approveAsRole(page, 'EE', codeA, { loginAs });
      await approveAsRole(page, 'QI', codeA, { loginAs });
      console.log(`  ✓ ${codeA} approved by EE + QI`);

      // P2: b released, on the same Work Section.
      await loginAs(page, 'CI');
      const rb = await raiseWithChecklistCheck(page, base, b, ws);
      const codeB = await getVisibleCodeFor(page, rb.rfiId);
      record.push({ checkpoint: b.name, code: codeB, checklist: b.drs.name, workSection: ws });
      console.log(`  ✓ ${codeB} for ${b.name} (released after ${a.name} approved)`);
      await resetToMyTasks(page);
      await approveAsRole(page, 'EE', codeB, { loginAs });
      await approveAsRole(page, 'QI', codeB, { loginAs });

      // P2: c released.
      await loginAs(page, 'CI');
      const rc = await raiseWithChecklistCheck(page, base, c, ws);
      const codeC = await getVisibleCodeFor(page, rc.rfiId);
      record.push({ checkpoint: c.name, code: codeC, checklist: c.drs.name, workSection: ws });
      console.log(`  ✓ ${codeC} for ${c.name} (released after ${b.name} approved)`);
      await resetToMyTasks(page);
      await approveAsRole(page, 'EE', codeC, { loginAs });
      await approveAsRole(page, 'QI', codeC, { loginAs });
      console.log(`  ✓ ${T.code}.${subKey}: chain a → b → c approved`);
    } finally {
      const prev = recordedPulse(profile).checklistDeps || {};
      recordPulse(profile, { checklistDeps: { ...prev, [subKey]: { rfis: record, at: new Date().toISOString() } } });
      await context.close();
    }
  });
}
