const { test, expect } = require('../config/test-base');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const { getVisibleCodeFor } = require('../utils/rfi-dependency-flow');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const RFIListPage = require('../pages/RFIListPage');

// Smoke replica of 24_rfi_draft_autosave.spec.js — run as the smoke chain's own
// created CI/EE/QI instead of the .env accounts.
//
// WHY A REPLICA: same two reasons as SM07/SM08 (see their header comments) —
// .env CI/EE are unusably slow/hung on pulse-qa, and this needs a live,
// continuous CI session (the draft is LOCAL BROWSER STATE, not server-side —
// see spec 24's header comment), so it cannot share a session with anything
// else regardless of which account drives it.
//
// GROUND: reuses profile.rfi (S05b/BL03 for solar), same reasoning as SM08 —
// ad-hoc creates against an area with ~490 sections, not a dedicated area.
// Each level consumes exactly one (checkpoint, Work Section) pair, so a full
// run of this file consumes EIGHT — see the trigger note below for why that
// is 8 and not 24.
//
// ===========================================================================
// PROGRESSIVE DRAFT LEVELS + ALL THREE TRIGGERS (app owner, 2026-09-05)
// ===========================================================================
// This file used to draft at exactly ONE depth (Work Location only), once per
// navigate-away trigger. It now mirrors spec 24's rebuilt shape: a draft is
// taken at EVERY depth of the Page 1 cascade, because each additional level is
// a different amount of state the app has to persist and restore — and the
// form's own "Draft" BUTTON is exercised alongside the two navigate-away
// triggers, a path nothing in this suite tested until 2026-09-05.
//
// ALL EIGHT LEVELS PROVEN LIVE in spec 24 on pulse-test, 2026-09-05: 10/10
// including both review passes, on ONE login. The confirmed app behaviour
// behind them:
//   - RFI autosaves from the very first field — Work Location alone is enough
//     (app owner, confirmed live). This is NOT true of NC, whose draft floor
//     is the Work Section and whose autosave does not work at all right now
//     (see 32_nc_draft_autosave.spec.js, parked as .fixme).
//   - Both navigate-away triggers AND the explicit Draft button all produce
//     the same resumable "In-Draft" row.
//   - Drafting from the CHECKLIST page (after Proceed) works too — L8.
//
// TRIGGERS ARE ROTATED ACROSS LEVELS, NOT MULTIPLIED BY THEM, and that is a
// deliberate ground-cost decision. Every completed level SUBMITS its RFI, and
// a submitted RFI permanently consumes a Work Section. Running all 8 levels
// against all 3 triggers would burn 24 Work Sections per smoke run instead of
// 8, for a dimension that is orthogonal to depth — the triggers were confirmed
// to behave identically. Rotating gives every trigger real coverage on every
// run at a third of the cost.
//
// ONE LOGIN FOR ALL LEVELS. What requires an unbroken session is a SINGLE
// level (create the draft, verify it, resume it, complete it, submit it);
// once a level has submitted, its draft no longer exists. A per-level
// re-login was tried in spec 24 as a workaround for STALE_WORK_SECTION and
// then removed once the real cause turned out to be picking the FIRST Work
// Section (so consecutive levels chose the same one) — '__random__' fixes
// that properly, and one continuous session is both simpler and a truer
// representation of how a real CI uses the feature.
//
// THE CODE-NOT-FINALIZED RACE — this file found it first (2026-09-04), and it
// is the one thing here that spec 24 originally lacked: reading the code
// straight after submit can return the literal "RFI-S05b-BL03-CIV-DRAFT"
// placeholder, after which EE's exact-code lookup fails. Same race already
// documented for the RESUBMIT case in smoke-rfi-turns.js. Spec 24 has since
// grown its own guard; this file's polling version below predates and
// outlives it.
//
// SESSION MODEL: one context/page created in beforeAll and shared by every
// level, then reused for the EE and QI review passes at the end. `serial` is
// genuinely required — playwright.config.js sets `fullyParallel: true`, so
// without it these tests would be spread across workers, each with its own
// context, and every draft would vanish mid-level.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const ROLES = ['CI', 'EE', 'QI'];

const TRIGGER_METHODS = [
  { key: 'browser-back', label: 'browser Back button' },
  { key: 'nav-click', label: 'in-app nav click away (My Tasks sidebar link)' },
  { key: 'draft-button', label: 'the form\'s own "Draft" button' },
];

// The Draft button lives on Page 1, so a level that deliberately Proceeds onto
// the checklist page before drafting has no button to press and always takes a
// navigate-away trigger instead.
function triggerFor(index, level) {
  const picked = TRIGGER_METHODS[index % TRIGGER_METHODS.length];
  if (level.proceedBeforeDrafting && picked.key === 'draft-button') return TRIGGER_METHODS[0];
  return picked;
}

// Every Page 1 dropdown, in the order RFICreatePage.fillForm fills them. A
// level's `fields` is a cumulative prefix of this list.
const PAGE_ONE_FIELDS = [
  'workLocation',
  'workArea',
  'package',
  'subPackage',
  'activity',
  'subActivity',
  'inspectionCheckpoint',
  'inspectionChecklist',
];

// `workSection` is NOT in the list above because it is not a plain dropdown
// pick: it is a MULTI-select, so re-clicking an already-selected option
// TOGGLES IT OFF. Levels that include it must leave it strictly alone when
// completing the resumed draft.
const LEVELS = [
  { key: 'L1-work-location', label: 'Work Location only', fields: ['workLocation'] },
  { key: 'L2-work-area', label: 'Work Location + Work Area', fields: ['workLocation', 'workArea'] },
  { key: 'L3-package', label: 'through Package', fields: ['workLocation', 'workArea', 'package'] },
  {
    // Sub-Package rides along with Activity rather than getting its own level:
    // Activity's options do not populate until Sub-Package is set, so "till
    // Activity" is unreachable without it.
    key: 'L4-activity',
    label: 'through Sub-Package + Activity',
    fields: ['workLocation', 'workArea', 'package', 'subPackage', 'activity'],
  },
  {
    key: 'L5-sub-activity',
    label: 'through Sub-Activity',
    fields: ['workLocation', 'workArea', 'package', 'subPackage', 'activity', 'subActivity'],
  },
  {
    key: 'L6-checkpoint',
    label: 'through Inspection Checkpoint',
    fields: [
      'workLocation', 'workArea', 'package', 'subPackage',
      'activity', 'subActivity', 'inspectionCheckpoint',
    ],
  },
  {
    key: 'L7-full-page-one',
    label: 'all of Page 1 including the Work Section',
    fields: [...PAGE_ONE_FIELDS, 'workSection'],
    complete: true,
  },
  {
    key: 'L8-checklist-page',
    label: 'all of Page 1, then Proceeded onto the checklist page',
    fields: [...PAGE_ONE_FIELDS, 'workSection'],
    complete: true,
    proceedBeforeDrafting: true,
  },
];

// Flat object matching what RFICreatePage.fillForm() reads directly — the SAME
// construction as SM08's resolveRfiFixture, carrying the two extra fields
// fillForm needs that createAndSubmitCheckpoint's baseData/checkpoint split
// normally keeps apart.
function resolveRfiFields(profile) {
  const rfi = profile.rfi;
  expect(rfi, `Profile "${profile.key}" has no rfi data — see tests/config/projects.js`).toBeTruthy();
  const cp = rfi.checkpointChain[0];
  return {
    workLocation: rfi.workLocation,
    workArea: rfi.workArea,
    package: rfi.package,
    subPackage: cp.subPackage || rfi.subPackage,
    activity: cp.activity || rfi.activity,
    subActivity: cp.subActivity,
    rfiQuantity: rfi.rfiQuantity,
    unit: rfi.unit,
    subContractor: rfi.subContractor,
    inspectionCheckpoint: cp.checkpoint,
    inspectionChecklist: cp.checklist,
  };
}

// What to fill BEFORE triggering the draft: this level's fields, nothing else.
function draftPayload(level, fields) {
  const data = {};
  for (const key of PAGE_ONE_FIELDS) {
    data[key] = level.fields.includes(key) ? fields[key] : null;
  }
  // A level meant to represent a COMPLETE Page 1 also needs the optional
  // quantity/unit, or Proceed could legitimately still be blocked and L8 would
  // never reach the checklist page it exists to draft from.
  if (level.complete) {
    data.rfiQuantity = fields.rfiQuantity;
    data.unit = fields.unit;
  }
  // '__skip__' stops fillForm short of the Work Section entirely — the right
  // thing for a level not meant to reach it, and important because merely
  // SELECTING a Work Section and abandoning the form can consume it.
  //
  // '__random__' rather than null for the levels that DO reach it: null means
  // "first option", and the app does NOT drop Work Sections that already have
  // an RFI from the list, so "first" is not "first available" and consecutive
  // levels would keep colliding on the same one (confirmed live in spec 24 as
  // STALE_WORK_SECTION at L2).
  data.workSection = level.fields.includes('workSection') ? '__random__' : '__skip__';
  return data;
}

// What to fill AFTER resuming: exactly the fields this level did NOT already
// set, plus the marker. Restored fields are deliberately not re-picked —
// re-selecting an already-selected option is a documented hang risk
// (BasePage.selectDropdownOption's `alreadyChecked` comment), and leaving them
// untouched is the stronger test: whatever the resumed form carries is what
// gets submitted.
function completionPayload(level, fields, marker) {
  const data = {};
  for (const key of PAGE_ONE_FIELDS) {
    data[key] = level.fields.includes(key) ? null : fields[key];
  }
  if (!level.complete) {
    data.rfiQuantity = fields.rfiQuantity;
    data.unit = fields.unit;
  }
  data.subContractor = marker;
  // A level that already selected its Work Section must NOT touch it again —
  // multi-select, second click deselects.
  data.workSection = level.fields.includes('workSection') ? '__skip__' : '__random__';
  return data;
}

function fieldLocator(rfiCreate, key) {
  return {
    workLocation: rfiCreate.workLocationDropdown,
    workArea: rfiCreate.workAreaDropdown,
    package: rfiCreate.packageDropdown,
    subPackage: rfiCreate.subPackageDropdown,
    activity: rfiCreate.activityDropdown,
    subActivity: rfiCreate.subActivityDropdown,
    inspectionCheckpoint: rfiCreate.inspectionCheckpointDropdown,
    inspectionChecklist: rfiCreate.inspectionChecklistDropdown,
  }[key];
}

// Returns the page to a clean My Tasks with no create form open and no
// half-finished draft in the way. Same un-bounce loop
// 02_rfi_ci.spec.js/03_rfi_bulk_create.spec.js established for an auto-resumed
// draft blocking plain navigation — needed between levels too, since a level
// that failed mid-form would otherwise leave its draft for the NEXT level to
// silently auto-resume.
//
// The final navigation is UNCONDITIONAL: a completed RFI lands on
// "/my-tasks/rfi/<uuid>/view", which CONTAINS "/my-tasks" as a substring, so
// an "am I already there?" check wrongly concludes yes and then waits forever
// for a Create RFI button that only exists on the real list page (found live
// in spec 24, 2026-09-05).
async function resetToMyTasks(page, myTasks) {
  for (let attempt = 0; attempt < 5 && page.url().includes('/create'); attempt++) {
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(2000);
    }
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(2000);
  }
  await page.goto(`${process.env.BASE_URL}/my-tasks`);
  await myTasks.waitForLoad();
}

test.describe('Smoke stage SM09 - RFI draft-autosave at every depth of the Page 1 cascade', () => {
  let context, page, myTasks, rfiFields, loginAs;
  const completed = [];

  test.beforeAll(async ({ browser, profile }) => {
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    rfiFields = resolveRfiFields(profile);
    const users = resolveSmokeUsers(profile, ROLES);
    loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);

    // Own context rather than the `page` fixture, because every level shares
    // ONE session. Permissions/geolocation replicate playwright.config.js's
    // `use` block — a manually created context does not inherit them.
    context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();
    await loginAs(page, 'CI');
    myTasks = new MyTasksPage(page);

    console.log(
      `\n=== SM09 draft-autosave: ${LEVELS.length} levels @ ` +
      `${rfiFields.workLocation}/${rfiFields.workArea} ===\n` +
      `    CI: ${users.CI.name}, EE: ${users.EE.name}, QI: ${users.QI.name}\n`
    );
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  LEVELS.forEach((level, index) => {
    const { key: method, label: triggerLabel } = triggerFor(index, level);

    test(`${level.key}: draft with ${level.label} — persists, resumes and completes (${method})`, async () => {
      test.setTimeout(20 * 60 * 1000);
      const marker = `Draft-Smoke-${level.key} (${method})`;

      await resetToMyTasks(page, myTasks);

      // ---- Fill this level's fields, and nothing beyond them ----
      await myTasks.clickCreateRFI();
      const rfiCreate = new RFICreatePage(page);
      await rfiCreate.fillForm(draftPayload(level, rfiFields));

      // ---- For every INCOMPLETE level, confirm Proceed is blocked
      // (validation enforced) before proving the draft-save is not
      // (validation NOT enforced). A complete level would legitimately pass
      // validation, so the check is meaningless there. ----
      if (!level.complete) {
        await rfiCreate.proceedButton.waitFor({ state: 'visible' });
        if (!(await rfiCreate.proceedButton.isDisabled())) {
          await rfiCreate.proceedButton.click();
          await page.waitForTimeout(1000);
          await expect(
            page.locator('text=Answer all the questions'),
            `${level.key}: Proceed should stay blocked with only "${level.label}" filled`
          ).not.toBeVisible();
          await expect(
            rfiCreate.workAreaDropdown,
            `${level.key}: should still be on Page 1 after a blocked Proceed`
          ).toBeVisible();
        }
      }

      // ---- "then next": L8 deliberately advances onto the checklist page and
      // drafts from there instead of from Page 1 ----
      if (level.proceedBeforeDrafting) {
        await rfiCreate.clickProceed();
        // `.first()` on the COMBINED locator: the checklist page renders BOTH
        // its heading and its Submit button, so `A.first().or(B)` resolves to
        // two elements and dies on strict mode (found live in spec 24).
        await expect(
          page.locator('text=Answer all the questions')
            .or(new RFIChecklistPage(page).submitButton).first(),
          `${level.key}: Proceed should have reached the checklist page before drafting`
        ).toBeVisible({ timeout: 20000 });
      }

      // ---- Trigger the draft ----
      if (method === 'browser-back') {
        await page.goBack();
      } else if (method === 'nav-click') {
        await page.locator('a:has-text("My Tasks"), nav >> text=My Tasks').first().click();
      } else {
        await rfiCreate.clickSaveDraft();
      }
      await page.waitForTimeout(3000);
      await resetToMyTasks(page, myTasks);

      // ---- Confirm the draft shows up as an "In-Draft" row in the grid. See
      // spec 24's header for why the tile's COUNT badge is deliberately NOT
      // asserted on. ----
      await myTasks.pendingWithMeTile.waitFor({ state: 'visible' });
      await myTasks.clickPendingWithMe();
      await expect(
        page.getByText('In-Draft').first(),
        `${level.key}: a draft holding "${level.label}" should show as an "In-Draft" row in ` +
        `Pending with me after ${triggerLabel}`
      ).toBeVisible({ timeout: 10000 });

      // ---- Resume via the Actions-column eye icon, falling back to
      // re-clicking "Create RFI" (also confirmed to auto-resume the same local
      // draft) ----
      const rfiList = new RFIListPage(page);
      await rfiList.waitForGrid();
      await rfiList.openDraftRow();
      console.log(`${level.key}: url after eye-icon click = ${page.url()}`);

      if (!page.url().includes('/create')) {
        const resumeButton = page.getByRole('button', { name: /resubmit|edit/i }).first();
        if (await resumeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await resumeButton.click();
          await page.waitForLoadState('networkidle');
        }
      }

      if (!page.url().includes('/create')) {
        console.log(`${level.key}: eye icon didn't land on /create — falling back to "Create RFI"`);
        await page.goto(`${process.env.BASE_URL}/my-tasks`);
        await myTasks.waitForLoad();
        await myTasks.clickCreateRFI();
      }

      expect(
        page.url(),
        `${level.key}: should have landed on the editable draft form one way or another`
      ).toContain('/create');

      // ---- The heart of this level: every field it had filled must have
      // survived the round trip. Checked field by field so a partial restore
      // names the exact field that was lost. ----
      for (const fieldKey of level.fields) {
        if (fieldKey === 'workSection') continue;
        const shown = (await fieldLocator(rfiCreate, fieldKey).innerText()).trim();
        expect(
          shown,
          `${level.key}: "${fieldKey}" should survive the draft/resume round trip ` +
          `(expected it to still show "${rfiFields[fieldKey]}")`
        ).toContain(rfiFields[fieldKey]);
      }

      // ---- Complete only what this level left empty, then submit ----
      await rfiCreate.fillForm(completionPayload(level, rfiFields, marker));
      await rfiCreate.clickProceed();

      const checklist = new RFIChecklistPage(page);
      await checklist.fillAllObservations('OK - as per standard', true);
      await checklist.submitRFI();

      const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
      if (!match) {
        throw new Error(
          `${level.key}: could not extract an RFI id after completing the draft — ` +
          `landed on ${page.url()}`
        );
      }
      const rfiId = match[1];

      // THE CODE IS NOT FINALIZED IMMEDIATELY AFTER SUBMIT — found live
      // 2026-09-04 on this file's first real run: read back the literal
      // "RFI-S05b-BL03-CIV-DRAFT" placeholder, after which EE's exact-code
      // lookup failed once the app had resolved a real code. Same race
      // documented for the RESUBMIT case in smoke-rfi-turns.js. Polls rather
      // than falling back, because unlike resubmit there is no earlier real
      // code to fall back TO.
      let rfiCode = null;
      for (let attempt = 1; attempt <= 5; attempt++) {
        rfiCode = await getVisibleCodeFor(page, rfiId).catch(() => null);
        if (rfiCode && !/draft/i.test(rfiCode)) break;
        console.log(`${level.key}: code reads "${rfiCode}" (attempt ${attempt}/5) — not finalized yet`);
        if (attempt < 5) await page.waitForTimeout(5000);
      }
      if (!rfiCode || /draft/i.test(rfiCode)) {
        throw new Error(
          `${level.key}: RFI code never finalized past the DRAFT placeholder after 5 attempts ` +
          `(last read: "${rfiCode}") — cannot proceed to EE/QI review, which looks the row up ` +
          `by exact code.`
        );
      }

      completed.push({ level, marker, rfiCode, rfiId });
      console.log(`${level.key}: completed drafted RFI as ${rfiCode} (${rfiId}) marker="${marker}"`);
    });
  });

  // ---- EE / QI review, deliberately LAST ----
  //
  // Switching user destroys the CI browser session and every draft in it, so
  // these cannot be interleaved with the levels above. They run once, at the
  // end, over every RFI the levels produced — also far cheaper than the shape
  // this file used to have, which logged in as EE and QI once per draft.
  for (const role of ['EE', 'QI']) {
    test(`${role} sees every drafted-then-completed RFI with its marker intact`, async () => {
      test.setTimeout(20 * 60 * 1000);
      expect(
        completed.length,
        `No drafted RFIs were completed, so there is nothing for ${role} to review — see the ` +
        `level tests above for the real failure`
      ).toBeGreaterThan(0);

      await loginAs(page, role);
      for (const { level, marker, rfiCode } of completed) {
        await openFromPendingWithMe(page, rfiCode);
        const review = new RFIReviewPage(page);
        await review.expandAllChecklist();
        const subContractor = await review.getFieldValue('Sub-Contractor Name');
        expect(
          subContractor,
          `${role} review of ${rfiCode} (drafted at ${level.key}) should carry that level's ` +
          `marker unchanged`
        ).toBe(marker);
        await review.approve();
        console.log(`${role}: approved ${rfiCode} (${level.key}), marker verified`);
      }
    });
  }
});
