const { test, expect } = require("@playwright/test");
const { loginAsRole } = require("../utils/helpers");
const { openFromPendingWithMe } = require("../utils/rfi-nav");
const { RFI_DATA, createNewRfi, withLoginRetryOnStaleWorkSection } = require("../utils/rfi-flow-turns");
const DashboardPage = require("../pages/DashboardPage");
const RFICreatePage = require("../pages/RFICreatePage");
const RFIChecklistPage = require("../pages/RFIChecklistPage");
const RFIReviewPage = require("../pages/RFIReviewPage");

test.describe.configure({ mode: "serial" });

// Data-integrity check: does the exact data CI enters at creation (and,
// separately, at resubmission) reach EE's and QI's review screens
// unchanged? Deliberately separate from the flow-mechanics specs (08-10,
// 21) — those only verify the approve/reject/version lifecycle completes,
// never the field values themselves. A failure here should read as "data
// got mangled," not "the flow broke," so it's kept as its own dedicated
// spec rather than assertions bolted onto the existing ones.
//
// Reuses RFI_DATA/createNewRfi from rfi-flow-turns.js (same values the
// real regression uses) so this isn't testing against different data than
// what's actually validated elsewhere. Doesn't touch rfi-tracker.json —
// these are ad-hoc RFIs, not part of the 9-TC tracked regression, same
// convention as the throwaway inspector spec
// (00_inspect_rfi_data_integrity.spec.js) this was built from.
//
// See docs/rfi-data-integrity-scenarios.md for the scope decision (field
// values only, not validation-rule enforcement) and open questions this
// still doesn't cover (a second Activity/Checklist combination — every
// other spec in this repo uses the same "Piling - MMS" combo, so there's
// no already-validated alternative to reuse safely; picking a new one
// blind risks a false failure from an unrelated Activity-dependency block,
// see docs/rfi-business-logic.md §6 — and QI-raised linked NC, explicitly
// parked by the app owner).
test("RFI data integrity: CI-entered values reach EE and QI review screens unchanged", async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  // ---- CI: create, then re-read via the dashboard-first pattern (same
  // as backfillRfiCodes in rfi-flow-turns.js — going through the
  // dashboard first is what actually clears the stale/DRAFT state) ----
  await loginAsRole(page, "CI");
  const rfiId = await withLoginRetryOnStaleWorkSection(page, "CI", () => createNewRfi(page));

  const dashboard = new DashboardPage(page);
  await dashboard.goToDashboard();
  await dashboard.waitForContentOnly();
  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/view`);
  await page.waitForLoadState("networkidle");

  const rfiCode = await new RFIChecklistPage(page).getVisibleCode();
  console.log(`Created ${rfiCode} (${rfiId})`);

  const ciView = new RFIReviewPage(page);
  await ciView.expandAllChecklist();
  const createdFields = await ciView.readAllFields();
  assertFieldsMatch(createdFields, RFI_DATA, "CI create-echo", {});

  // ---- EE: review — read fields BEFORE approving, so a mangled value
  // can't be masked by the approve action having "fixed" the display ----
  await loginAsRole(page, "EE");
  await openFromPendingWithMe(page, rfiCode);
  const eeView = new RFIReviewPage(page);
  await eeView.expandAllChecklist();
  const eeFields = await eeView.readAllFields();
  assertFieldsMatch(eeFields, RFI_DATA, "EE review", { expectedWorkSection: createdFields.workSection });
  await eeView.approve();

  // ---- QI: review ----
  await loginAsRole(page, "QI");
  await openFromPendingWithMe(page, rfiCode);
  const qiView = new RFIReviewPage(page);
  await qiView.expandAllChecklist();
  const qiFields = await qiView.readAllFields();
  assertFieldsMatch(qiFields, RFI_DATA, "QI review", { expectedWorkSection: createdFields.workSection });
  await qiView.approve();
});

// Resubmit scenario (open question 7a in docs/rfi-data-integrity-scenarios.md):
// does CI's data survive a reject → resubmit round-trip? Specifically —
// (a) fields CI never touches on resubmit (Page 1 is locked after a
// checklist-page rejection — see docs/rfi-business-logic.md's RFI flow
// notes) must still show the ORIGINAL creation values, not go blank or
// reset; (b) fields CI DOES re-enter on resubmit (the checklist
// observations) must show the NEW values, not stale leftover text from
// before the reject. Uses deliberately different observation text on
// resubmit ("Resubmitted - verified OK N") specifically so a false-pass
// (old text silently still there) would be caught, not just re-confirming
// the same values twice.
test("RFI data integrity: resubmit after reject reaches EE and QI review screens correctly", async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  // ---- CI: create ----
  await loginAsRole(page, "CI");
  const rfiId = await withLoginRetryOnStaleWorkSection(page, "CI", () => createNewRfi(page));

  const dashboard = new DashboardPage(page);
  await dashboard.goToDashboard();
  await dashboard.waitForContentOnly();
  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/view`);
  await page.waitForLoadState("networkidle");

  const rfiCode = await new RFIChecklistPage(page).getVisibleCode();
  console.log(`Created ${rfiCode} (${rfiId}) — will reject-from-checklist then resubmit`);

  const ciView = new RFIReviewPage(page);
  await ciView.expandAllChecklist();
  const createdFields = await ciView.readAllFields();
  assertFieldsMatch(createdFields, RFI_DATA, "CI create-echo", {});

  // ---- EE: reject from the checklist page (page 1 locks on resubmit) ----
  await loginAsRole(page, "EE");
  await openFromPendingWithMe(page, rfiCode);
  const eeReject = new RFIReviewPage(page);
  await eeReject.rejectFromChecklistPage("Automated data-integrity test — reject to exercise resubmit");

  // ---- CI: resubmit with DELIBERATELY different observation text, so a
  // stale-text false-pass would be caught ----
  await loginAsRole(page, "CI");
  const newRfiId = await withLoginRetryOnStaleWorkSection(
    page, "CI", () => ciResubmitWithEditedObservations(page, rfiCode, "Resubmitted - verified OK")
  );

  // Resubmitting creates a NEW child record (docs/rfi-business-logic.md /
  // project_rfi_flow_fixes memory) — re-read via the dashboard-first
  // pattern to get the now-finalized code (confirmed live: it doesn't
  // necessarily change when Page-1 data is untouched, but must always be
  // freshly read, never assumed).
  await dashboard.goToDashboard();
  await dashboard.waitForContentOnly();
  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${newRfiId}/view`);
  await page.waitForLoadState("networkidle");

  const newRfiCode = await new RFIChecklistPage(page).getVisibleCode();
  const version = await new RFIReviewPage(page).getVersionBadge().catch(() => null);
  console.log(`Resubmitted as ${newRfiCode} (${newRfiId}), version ${version}`);
  expect(version, "version should bump on resubmit").toBe("v2");

  const ciResubmitView = new RFIReviewPage(page);
  await ciResubmitView.expandAllChecklist();
  const resubmittedFields = await ciResubmitView.readAllFields();
  assertFieldsMatch(resubmittedFields, RFI_DATA, "CI resubmit-echo", {
    expectedWorkSection: createdFields.workSection,
    observationPrefix: "Resubmitted - verified OK",
  });

  // ---- EE: review the resubmitted version ----
  await loginAsRole(page, "EE");
  await openFromPendingWithMe(page, newRfiCode);
  const eeView = new RFIReviewPage(page);
  await eeView.expandAllChecklist();
  const eeFields = await eeView.readAllFields();
  assertFieldsMatch(eeFields, RFI_DATA, "EE review (post-resubmit)", {
    expectedWorkSection: createdFields.workSection,
    observationPrefix: "Resubmitted - verified OK",
  });
  await eeView.approve();

  // ---- QI: review the resubmitted version ----
  await loginAsRole(page, "QI");
  await openFromPendingWithMe(page, newRfiCode);
  const qiView = new RFIReviewPage(page);
  await qiView.expandAllChecklist();
  const qiFields = await qiView.readAllFields();
  assertFieldsMatch(qiFields, RFI_DATA, "QI review (post-resubmit)", {
    expectedWorkSection: createdFields.workSection,
    observationPrefix: "Resubmitted - verified OK",
  });
  await qiView.approve();
});

// Mirrors resubmitRfi() in rfi-flow-turns.js, EXCEPT it fills the
// checklist with caller-supplied text instead of always refilling the
// same "OK - as per standard" pattern — needed here so the resubmitted
// text is verifiably different from the original, not just re-confirming
// identical values twice.
async function ciResubmitWithEditedObservations(page, rfiCode, observationPrefix) {
  await openFromPendingWithMe(page, rfiCode);

  if (!page.url().includes("/re-submit")) {
    const resubmitButton = page.getByRole("button", { name: /resubmit|edit/i }).first();
    await resubmitButton.waitFor({ state: "visible", timeout: 15000 });
    await resubmitButton.click();
    await page.waitForLoadState("networkidle");
  }

  const rfiCreate = new RFICreatePage(page);
  const locked = await rfiCreate.isFirstPageLocked();
  expect(locked, "Page 1 should be locked after a checklist-page rejection").toBe(true);
  await rfiCreate.clickProceed();

  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations(observationPrefix, true);
  await checklist.submitRFI();

  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  if (!match) throw new Error(`Could not extract new RFI id after resubmit from URL: ${page.url()}`);
  return match[1];
}

// `expectedWorkSection` (optional): asserts consistency with the value
// captured at creation time instead of a hardcoded string — Work Section
// has no fixed expected value in RFI_DATA, see docs/rfi-business-logic.md
// §3a. Omit it (as CI's own create-echo does) when there's nothing yet to
// compare against — this call IS the capture.
//
// `observationPrefix` (optional, defaults to `fillAllObservations()`'s
// standard "OK - as per standard"): the resubmit test overrides this to
// its own deliberately-different text so a stale-value false-pass would
// be caught.
function assertFieldsMatch(actual, expected, context, { expectedWorkSection, observationPrefix = "OK - as per standard" } = {}) {
  expect(actual.workLocation, `${context}: Work Location`).toBe(expected.workLocation);
  expect(actual.workArea, `${context}: Work Area`).toBe(expected.workArea);
  expect(actual.package, `${context}: Package`).toBe(expected.package);

  // Sub-Package is a KNOWN naming-migration discrepancy, not a bug — see
  // docs/rfi-business-logic.md §5. The app can display the longer "Old"
  // name; assert the "New" name we selected is at least a substring of
  // whatever's shown, not an exact match.
  expect(actual.subPackage, `${context}: Sub-Package should contain "${expected.subPackage}"`)
    .toContain(expected.subPackage);

  expect(actual.activity, `${context}: Activity`).toBe(expected.activity);
  expect(actual.subActivity, `${context}: Sub-Activity`).toBe(expected.subActivity);

  // Quantity/Unit render the literal placeholder "-" when left null;
  // Sub-Contractor Name renders as truly empty (null) instead — see
  // RFIReviewPage.readAllFields()'s header comment for why these two
  // empty-field styles need different expected values here.
  expect(actual.quantity, `${context}: Quantity`)
    .toBe(expected.rfiQuantity == null ? "-" : String(expected.rfiQuantity));
  expect(actual.unit, `${context}: Unit`).toBe(expected.unit == null ? "-" : expected.unit);
  expect(actual.subContractor, `${context}: Sub-Contractor Name`).toBe(expected.subContractor);

  expect(actual.inspectionCheckpoint, `${context}: Inspection Checkpoint`).toBe(expected.inspectionCheckpoint);
  expect(actual.inspectionChecklist, `${context}: Inspection Checklist`).toBe(expected.inspectionChecklist);

  if (expectedWorkSection) {
    expect(actual.workSection, `${context}: Work Section should match the value captured at creation`)
      .toBe(expectedWorkSection);
  } else {
    expect(actual.workSection, `${context}: Work Section should have SOME value selected`).toBeTruthy();
  }

  // Checklist item count isn't hardcoded — it depends on which Inspection
  // Checklist RFI_DATA points at (16 for "Micro Pile Checklist" today, but
  // this shouldn't break if that ever changes). Every item's text must
  // match the expected prefix + its 1-based index exactly.
  expect(actual.observations.length, `${context}: at least one checklist observation`).toBeGreaterThan(0);
  actual.observations.forEach((obs, i) => {
    expect(obs, `${context}: observation #${i + 1}`).toBe(`${observationPrefix} ${i + 1}`);
  });
}
