const { test, expect } = require('../config/test-base');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const {
  createAndSubmitCheckpoint,
  getVisibleCodeFor,
} = require('../utils/rfi-dependency-flow');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');

// Tail stage (file SM08): the smoke replica of 23_rfi_data_integrity.spec.js —
// does the exact data CI enters at creation (and, separately, at resubmission)
// reach EE's and QI's review screens unchanged? — run as the smoke chain's own
// created CI/EE/QI instead of the .env accounts.
//
// WHY A REPLICA. Same two reasons as SM07 (see its header comment): the .env CI
// takes 7.9 minutes to log in and .env EE hangs at a 100% spinner on pulse-qa,
// and 23_rfi_data_integrity.spec.js's own ground (rfi-flow-turns.js's RFI_DATA,
// S05b/BL02) is the tracked 9-TC regression's own area — the smoke users are
// never WAM'd there, and WAM-ing them there would evict the .env CI/QI from the
// live regression (single-assignee rows, rule R3).
//
// GROUND: profile.rfi (S05b/BL03 for solar), the SAME area SM05's flow already
// uses — deliberately, not a new area. This mirrors the regression's own
// precedent exactly: 23_rfi_data_integrity.spec.js shares BL02 with specs
// 08-10/21/24 rather than getting a dedicated area, because solar's ~490
// sections per area make a couple of extra ad-hoc creates free. (Contrast with
// SM07, which DID need its own BL07 — that stage runs after SM04 reassigns the
// spare demapWorkArea, which would have evicted a shared area's CI/QI row.)
//
// WHAT IS REUSED, to avoid duplicating dependency logic a second time:
// createAndSubmitCheckpoint/getVisibleCodeFor/resetToMyTasks from
// rfi-dependency-flow.js (already generic — data comes in as a parameter, not a
// module-level constant) plus the same page objects spec 23 itself uses
// (RFIReviewPage.readAllFields/approve, RFIChecklistPage.getVisibleCode). NOT
// reused: RFI_DATA/createNewRfi/withLoginRetryOnStaleWorkSection from
// rfi-flow-turns.js — importing that module at all would pull the tracked
// regression's fixtures/rfi-tracker.json into this file's module graph (see
// smoke-rfi-turns.js's header comment for why that import is avoided
// everywhere in the smoke chain).
//
// SESSION MODEL: one page, reused across CI/EE/QI logins in sequence — same as
// SM07 and spec 23 itself. Nothing here benefits from three parallel sessions;
// each step depends causally on the one before it.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const ROLES = ['CI', 'EE', 'QI'];

// The single checkpoint every profile.rfi declares (checkpointChain[0]) as a
// FLAT object matching createAndSubmitCheckpoint's baseData/checkpoint params
// AND assertFieldsMatch's `expected` shape (inspectionCheckpoint/
// inspectionChecklist alongside the page-1 fields) — the same construction
// smoke-rfi-turns.js's makeRfiContext.baseDataFor does internally, inlined here
// rather than exported from that file to keep this replica self-contained.
function resolveRfiFixture(profile) {
  const rfi = profile.rfi;
  expect(rfi, `Profile "${profile.key}" has no rfi data — see tests/config/projects.js`).toBeTruthy();
  const cp = rfi.checkpointChain[0];
  const baseData = {
    workLocation: rfi.workLocation,
    workArea: rfi.workArea,
    package: rfi.package,
    subPackage: cp.subPackage || rfi.subPackage,
    activity: cp.activity || rfi.activity,
    subActivity: cp.subActivity,
    rfiQuantity: rfi.rfiQuantity,
    unit: rfi.unit,
    subContractor: rfi.subContractor,
  };
  const checkpoint = { name: cp.checkpoint, checklist: cp.checklist };
  const expected = { ...baseData, inspectionCheckpoint: cp.checkpoint, inspectionChecklist: cp.checklist };
  return { baseData, checkpoint, expected };
}

// `expectedWorkSection` (optional): asserts consistency with the value captured
// at creation time instead of a hardcoded string. `observationPrefix`
// (optional): createAndSubmitCheckpoint below always fills 'OK - as per
// standard' verbatim (it is not configurable), so that is the default here too
// — NOT profile.rfi.observationValue, which belongs to the SM05 flow's own
// checklist-filling path and is never used by this replica.
function assertFieldsMatch(actual, expected, context, { expectedWorkSection, observationPrefix = 'OK - as per standard' } = {}) {
  expect(actual.workLocation, `${context}: Work Location`).toBe(expected.workLocation);
  expect(actual.workArea, `${context}: Work Area`).toBe(expected.workArea);
  expect(actual.package, `${context}: Package`).toBe(expected.package);
  expect(actual.subPackage, `${context}: Sub-Package should contain "${expected.subPackage}"`)
    .toContain(expected.subPackage);
  expect(actual.activity, `${context}: Activity`).toBe(expected.activity);
  expect(actual.subActivity, `${context}: Sub-Activity`).toBe(expected.subActivity);

  expect(actual.quantity, `${context}: Quantity`)
    .toBe(expected.rfiQuantity == null ? '-' : String(expected.rfiQuantity));
  expect(actual.unit, `${context}: Unit`).toBe(expected.unit == null ? '-' : expected.unit);
  expect(actual.subContractor, `${context}: Sub-Contractor Name`).toBe(expected.subContractor);

  expect(actual.inspectionCheckpoint, `${context}: Inspection Checkpoint`).toBe(expected.inspectionCheckpoint);
  expect(actual.inspectionChecklist, `${context}: Inspection Checklist`).toBe(expected.inspectionChecklist);

  if (expectedWorkSection) {
    expect(actual.workSection, `${context}: Work Section should match the value captured at creation`)
      .toBe(expectedWorkSection);
  } else {
    expect(actual.workSection, `${context}: Work Section should have SOME value selected`).toBeTruthy();
  }

  expect(actual.observations.length, `${context}: at least one checklist observation`).toBeGreaterThan(0);
  actual.observations.forEach((obs, i) => {
    expect(obs, `${context}: observation #${i + 1}`).toBe(`${observationPrefix} ${i + 1}`);
  });
}

// Mirrors ciResubmitWithEditedObservations() in spec 23 exactly, just without
// the .env-flavoured imports — page-object calls only, nothing regression
// specific.
async function ciResubmitWithEditedObservations(page, rfiCode, observationPrefix) {
  await openFromPendingWithMe(page, rfiCode);

  if (!page.url().includes('/re-submit')) {
    const resubmitButton = page.getByRole('button', { name: /resubmit|edit/i }).first();
    await resubmitButton.waitFor({ state: 'visible', timeout: 15000 });
    await resubmitButton.click();
    await page.waitForLoadState('networkidle');
  }

  const rfiCreate = new RFICreatePage(page);
  const locked = await rfiCreate.isFirstPageLocked();
  expect(locked, 'Page 1 should be locked after a checklist-page rejection').toBe(true);
  await rfiCreate.clickProceed();

  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations(observationPrefix, true);
  await checklist.submitRFI();

  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  if (!match) throw new Error(`Could not extract new RFI id after resubmit from URL: ${page.url()}`);
  return match[1];
}

test('RFI data integrity: CI-entered values reach EE and QI review screens unchanged (smoke, created users)', async ({ page, profile }) => {
  test.setTimeout(20 * 60 * 1000);
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const { baseData, checkpoint, expected } = resolveRfiFixture(profile);
  const users = resolveSmokeUsers(profile, ROLES);
  const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);

  // ---- CI: create, then re-read via the dashboard-first pattern ----
  await loginAs(page, 'CI');
  const created = await createAndSubmitCheckpoint(page, baseData, checkpoint, '__random__');
  const rfiCode = await getVisibleCodeFor(page, created.rfiId);
  console.log(`Created ${rfiCode} (${created.rfiId})`);

  const ciView = new RFIReviewPage(page);
  await ciView.expandAllChecklist();
  const createdFields = await ciView.readAllFields();
  assertFieldsMatch(createdFields, expected, 'CI create-echo', {});

  // ---- EE: review — read fields BEFORE approving ----
  await loginAs(page, 'EE');
  await openFromPendingWithMe(page, rfiCode);
  const eeView = new RFIReviewPage(page);
  await eeView.expandAllChecklist();
  const eeFields = await eeView.readAllFields();
  assertFieldsMatch(eeFields, expected, 'EE review', { expectedWorkSection: createdFields.workSection });
  await eeView.approve();

  // ---- QI: review ----
  await loginAs(page, 'QI');
  await openFromPendingWithMe(page, rfiCode);
  const qiView = new RFIReviewPage(page);
  await qiView.expandAllChecklist();
  const qiFields = await qiView.readAllFields();
  assertFieldsMatch(qiFields, expected, 'QI review', { expectedWorkSection: createdFields.workSection });
  await qiView.approve();
});

test('RFI data integrity: resubmit after reject reaches EE and QI review screens correctly (smoke, created users)', async ({ page, profile }) => {
  test.setTimeout(20 * 60 * 1000);
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const { baseData, checkpoint, expected } = resolveRfiFixture(profile);
  const users = resolveSmokeUsers(profile, ROLES);
  const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);

  // ---- CI: create ----
  await loginAs(page, 'CI');
  const created = await createAndSubmitCheckpoint(page, baseData, checkpoint, '__random__');
  const rfiCode = await getVisibleCodeFor(page, created.rfiId);
  console.log(`Created ${rfiCode} (${created.rfiId}) — will reject-from-checklist then resubmit`);

  const ciView = new RFIReviewPage(page);
  await ciView.expandAllChecklist();
  const createdFields = await ciView.readAllFields();
  assertFieldsMatch(createdFields, expected, 'CI create-echo', {});

  // ---- EE: reject from the checklist page (page 1 locks on resubmit) ----
  await loginAs(page, 'EE');
  await openFromPendingWithMe(page, rfiCode);
  const eeReject = new RFIReviewPage(page);
  await eeReject.rejectFromChecklistPage('Automated smoke data-integrity test — reject to exercise resubmit');

  // ---- CI: resubmit with DELIBERATELY different observation text ----
  await loginAs(page, 'CI');
  const newRfiId = await ciResubmitWithEditedObservations(page, rfiCode, 'Resubmitted - verified OK (smoke)');

  const newRfiCode = await getVisibleCodeFor(page, newRfiId);
  const version = await new RFIReviewPage(page).getVersionBadge().catch(() => null);
  console.log(`Resubmitted as ${newRfiCode} (${newRfiId}), version ${version}`);
  expect(version, 'version should bump on resubmit').toBe('v2');

  const ciResubmitView = new RFIReviewPage(page);
  await ciResubmitView.expandAllChecklist();
  const resubmittedFields = await ciResubmitView.readAllFields();
  assertFieldsMatch(resubmittedFields, expected, 'CI resubmit-echo', {
    expectedWorkSection: createdFields.workSection,
    observationPrefix: 'Resubmitted - verified OK (smoke)',
  });

  // ---- EE: review the resubmitted version ----
  await loginAs(page, 'EE');
  await openFromPendingWithMe(page, newRfiCode);
  const eeView = new RFIReviewPage(page);
  await eeView.expandAllChecklist();
  const eeFields = await eeView.readAllFields();
  assertFieldsMatch(eeFields, expected, 'EE review (post-resubmit)', {
    expectedWorkSection: createdFields.workSection,
    observationPrefix: 'Resubmitted - verified OK (smoke)',
  });
  await eeView.approve();

  // ---- QI: review the resubmitted version ----
  await loginAs(page, 'QI');
  await openFromPendingWithMe(page, newRfiCode);
  const qiView = new RFIReviewPage(page);
  await qiView.expandAllChecklist();
  const qiFields = await qiView.readAllFields();
  assertFieldsMatch(qiFields, expected, 'QI review (post-resubmit)', {
    expectedWorkSection: createdFields.workSection,
    observationPrefix: 'Resubmitted - verified OK (smoke)',
  });
  await qiView.approve();
});
