const { test, expect } = require("@playwright/test");
const { loginAsRole } = require("../utils/helpers");
const { openFromPendingWithMe } = require("../utils/rfi-nav");
const { RFI_DATA } = require("../utils/rfi-flow-turns");
const MyTasksPage      = require("../pages/MyTasksPage");
const RFICreatePage    = require("../pages/RFICreatePage");
const RFIChecklistPage = require("../pages/RFIChecklistPage");
const RFIReviewPage    = require("../pages/RFIReviewPage");
const RFIListPage      = require("../pages/RFIListPage");

// SERIAL IS GENUINELY REQUIRED HERE — not the usual "it looked tidier".
//
// A draft lives in the BROWSER, not on the server (see header comment
// below), so a level must create, verify, resume, complete AND submit its
// draft inside one continuous CI session. That means one shared context/page
// created in beforeAll, which in turn means these tests cannot be allowed to
// spread across workers — and playwright.config.js sets `fullyParallel: true`
// globally, so without `mode: "serial"` the tests in this file WOULD be
// handed to different workers, each with its own context, and every draft
// would vanish mid-level.
//
// NOTE the scope carefully: it is one session PER LEVEL, not one session for
// the whole file. Each level re-logs-in at its start (see the comment on that
// call), which is both safe — the previous level already submitted its draft,
// so there is nothing left to lose — and necessary, because carrying one
// login across all eight levels reproducibly caused STALE_WORK_SECTION from
// L2 onward.
//
// This is the opposite of the SM01/SM10-style cases where `serial` was
// removed as pure downside: there the tests were genuinely independent and
// serial only bought abort-on-failure. Here the session IS the dependency.
// The abort-on-failure cost is accepted deliberately for a second reason
// too: a level that fails mid-form leaves a half-filled create form (and
// possibly a stray draft) behind, which the next level would auto-resume
// and silently test the wrong thing.
test.describe.configure({ mode: "serial" });

// Draft/autosave: CI navigating away from the Create RFI form mid-fill
// (even with only Work Location selected — no other field, not even a
// required one) persists a local draft, surfaced in "Pending with me" as
// an "In-Draft" row. Confirmed live (2026-08-19, app owner + direct
// investigation):
//
// - The draft is stored LOCALLY in the browser, not server-side — a fresh
//   login/context (or logging out and back in) loses it entirely. Every
//   level below must create, verify, resume, AND complete its own draft
//   within one continuous session — never split across separate logins.
//   This is why the EE/QI review checks are deliberately deferred to the
//   very END of the file, after every draft level is finished: switching
//   user destroys the CI session and with it any remaining draft.
// - Two distinct "goes back" triggers both produce identical behavior:
//   the browser Back button, and an in-app nav link click away (e.g. "My
//   Tasks" in the sidebar) without using Back at all.
// - The "In-Draft" row's RFI ID column is blank (no code assigned yet —
//   only a real submission gets one). It DOES have a working Actions-
//   column eye icon, same as any submitted row (app-owner-confirmed via
//   live screenshot, 2026-08-19) — an earlier automated probe wrongly
//   concluded otherwise because it gave up scrolling right too early;
//   this row has many more columns than a first glance suggests
//   (Activity, Sub Activity, Created AT, Updated AT, Last Reviewed By,
//   then Actions). `RFIListPage.openDraftRow()` reuses openRowByCode's
//   proven scroll-and-poll technique, just locating the row by its
//   "In-Draft" status text instead of a code.
// - Clicking "Create RFI" again ALSO resumes the same local draft (the
//   app detects it and reloads it — Work Location still selected —
//   instead of starting a fresh blank form; same "auto-resumed draft"
//   quirk 02_rfi_ci.spec.js/03_rfi_bulk_create.spec.js already had to
//   work around, there as an obstacle to Cancel past). Kept as an
//   automatic fallback below in case the eye icon ever lands somewhere
//   that isn't directly resumable.
// - Validation matters most here: 02_rfi_ci.spec.js's test 3 already
//   established Proceed silently blocks navigation (stays on Page 1, no
//   error toast) when required fields are missing. Draft-save does NOT
//   enforce that same validation — going back with only Work Location
//   set (every other required field empty) still saves a draft. Every
//   INCOMPLETE level below proves both halves of that asymmetry in one
//   place: Proceed blocked first, then the same incomplete state saved as
//   a draft via going back.
// - Per app-owner suggestion, the Sub-Contractor Name free-text field
//   carries a marker identifying which level/trigger produced this draft
//   (e.g. "Draft-L3-package (browser-back)"), filled in while completing
//   the resumed draft — then verified at EE's and QI's review screens
//   too, the same "does CI's data reach EE/QI unchanged" principle as
//   23_rfi_data_integrity.spec.js, applied to a drafted-then-completed
//   RFI instead of a straight one.
// - The "Pending with me" tile's COUNT badge is deliberately NOT
//   asserted on (only the "In-Draft" row in the grid is, which has been
//   reliable every single run). Confirmed live (2026-08-19) after 7
//   reproducible failures across every fix tried — a longer wait, a
//   45s poll, a Dashboard-then-My-Tasks round trip, and a genuine
//   `page.reload()` — that the tile's count text never populates within
//   this flow's timeframe: `pendingWithMeTile.textContent()` came back
//   as literally `"Pending with me"` with no digit anywhere, even
//   though `networkidle` had already resolved (so whatever count API
//   call exists had already finished — the DOM just never renders the
//   number afterward in this exact rapid-navigation sequence). Also
//   fixed along the way: `MyTasksPage.clickPendingWithMe()` could be
//   unresponsive to its first click right after this same kind of
//   sequence (user-observed live) — same "looks loaded, isn't
//   interactive yet" quirk `DashboardPage.goToMyTasks()` already had a
//   retry loop for; `clickPendingWithMe()` now has one too.
//
// RFI code format (app owner, 2026-08-19): RFI-<Work Location>-<Work
// Area>-<Package abbreviation, e.g. CIV for Civil>-<incremental
// numerical suffix>. The suffix increments per unique
// Work-Location/Work-Area/Package combination; a different combination
// starts its own suffix from scratch. Not itself asserted on here (the
// exact next number isn't predictable), but explains why every RFI this
// suite creates against the shared RFI_DATA combo shows codes like
// RFI-A-06c-BL02-CIV-NNN with NNN only ever increasing.
//
// ===========================================================================
// PROGRESSIVE DRAFT LEVELS (app owner, 2026-09-05)
// ===========================================================================
// The original file drafted at exactly ONE point in the form — Work Location
// only — once per trigger method. Per the app owner, a draft should be
// exercised at EVERY depth of the Page 1 cascade, because each additional
// level is a different amount of state the app has to persist and restore:
// only Work Location, then + Work Area, then + Package, then through
// Activity, Sub-Activity, Inspection Checkpoint, then the whole of Page 1
// including the Work Section, and finally after Proceeding onto Page 2.
//
// TRIGGER METHODS ARE ALTERNATED ACROSS LEVELS RATHER THAN MULTIPLIED BY
// THEM, and that is a deliberate ground-cost decision, not an oversight.
// Every completed level SUBMITS its RFI, and a submitted RFI permanently
// consumes one Work Section for its (checkpoint, work area) pair — confirmed
// live and documented in RFICreatePage.selectWorkSection. Running all 8
// levels against both triggers would burn 16 Work Sections per run instead
// of 8, on shared ground, for a dimension that is orthogonal to depth: the
// two triggers were already confirmed to behave IDENTICALLY (see header),
// so pairing each level with an alternating trigger still exercises both
// paths every run at half the cost. If both triggers are ever wanted at
// every depth, change `triggerFor` below to return both and expect double
// the Work Section consumption.
// THREE triggers, covering both halves of "draft and autosave":
//   - browser-back / nav-click are the AUTOSAVE paths — the app saving a
//     draft on its own because the user left mid-fill. Both confirmed live
//     (2026-08-19) to behave identically.
//   - draft-button is the EXPLICIT path — the form's own "Draft" button,
//     which every version of this file until 2026-09-05 left completely
//     untested even though the button has been in RFICreatePage all along
//     (`saveDraftButton` / `clickSaveDraft`). Whether it produces the same
//     "In-Draft" row, and whether it navigates away by itself or stays on
//     the form, is NOT confirmed — `resetToMyTasks` below copes with either.
const TRIGGER_METHODS = [
  { key: "browser-back", label: "browser Back button" },
  { key: "nav-click",    label: "in-app nav click away (My Tasks sidebar link)" },
  { key: "draft-button", label: 'the form\'s own "Draft" button' },
];

// The Draft button lives on Page 1. A level that deliberately Proceeds onto
// the checklist page before drafting has no Page 1 button to press, so it
// always uses a navigate-away trigger instead of whatever the rotation would
// otherwise have handed it.
function triggerFor(index, level) {
  const picked = TRIGGER_METHODS[index % TRIGGER_METHODS.length];
  if (level.proceedBeforeDrafting && picked.key === "draft-button") {
    return TRIGGER_METHODS[0];
  }
  return picked;
}

// Every Page 1 dropdown, in the order RFICreatePage.fillForm fills them.
// A level's `fields` is a cumulative prefix of this list — everything in it
// is filled before drafting, everything after it is left empty.
const PAGE_ONE_FIELDS = [
  "workLocation",
  "workArea",
  "package",
  "subPackage",
  "activity",
  "subActivity",
  "inspectionCheckpoint",
  "inspectionChecklist",
];

// `workSection` is NOT in PAGE_ONE_FIELDS above because it is not a plain
// dropdown pick: it is a MULTI-select, so re-clicking an already-selected
// option TOGGLES IT OFF (see RFICreatePage.selectWorkSection). Levels that
// include it must therefore leave it strictly alone when completing the
// resumed draft — handled by `completionPayload` below.
const LEVELS = [
  {
    key: "L1-work-location",
    label: "Work Location only",
    fields: ["workLocation"],
  },
  {
    key: "L2-work-area",
    label: "Work Location + Work Area",
    fields: ["workLocation", "workArea"],
  },
  {
    key: "L3-package",
    label: "through Package",
    fields: ["workLocation", "workArea", "package"],
  },
  {
    // Sub-Package is included here rather than getting its own level because
    // Activity's options do not populate until Sub-Package is set — "till
    // Activity" is unreachable without it.
    key: "L4-activity",
    label: "through Sub-Package + Activity",
    fields: ["workLocation", "workArea", "package", "subPackage", "activity"],
  },
  {
    key: "L5-sub-activity",
    label: "through Sub-Activity",
    fields: ["workLocation", "workArea", "package", "subPackage", "activity", "subActivity"],
  },
  {
    key: "L6-checkpoint",
    label: "through Inspection Checkpoint",
    fields: [
      "workLocation", "workArea", "package", "subPackage",
      "activity", "subActivity", "inspectionCheckpoint",
    ],
  },
  {
    // Page 1 complete, Work Section included — the last point at which
    // Proceed is still expected to be BLOCKED is the level before this one,
    // so this level skips the "Proceed stays blocked" half of the check.
    key: "L7-full-page-one",
    label: "all of Page 1 including the Work Section",
    fields: [...PAGE_ONE_FIELDS, "workSection"],
    complete: true,
  },
  {
    // "then next" — Page 1 fully filled AND Proceeded onto the checklist
    // page, drafted from THERE rather than from Page 1.
    //
    // NOT LIVE-VERIFIED. Every confirmed fact in this file's header is about
    // drafting from Page 1; whether navigating away from the CHECKLIST page
    // saves a draft at all, and whether resuming it returns to Page 1 or
    // straight to the checklist, has never been observed. Written to fail
    // with a specific, named message at whichever step differs rather than a
    // bare timeout, and the resume step below accepts EITHER landing page.
    key: "L8-checklist-page",
    label: "all of Page 1, then Proceeded onto the checklist page",
    fields: [...PAGE_ONE_FIELDS, "workSection"],
    complete: true,
    proceedBeforeDrafting: true,
  },
];

// What to fill BEFORE triggering the draft: this level's fields, nothing else.
function draftPayload(level) {
  const data = {};
  for (const key of PAGE_ONE_FIELDS) {
    data[key] = level.fields.includes(key) ? RFI_DATA[key] : null;
  }
  // '__skip__' stops fillForm short of the Work Section entirely (see its
  // comment) — the right thing for a level that is not meant to reach it,
  // and important because merely SELECTING a Work Section and abandoning the
  // form can consume it permanently.
  //
  // '__random__' rather than leaving it undefined, for levels that DO reach
  // it. Undefined means "first option in the list", and the app does NOT drop
  // Work Sections that already have an RFI from that list — so "first" is not
  // "first available", and every run would keep re-picking whatever the last
  // run consumed. Found live 2026-09-05 exactly that way: L1 passed twice,
  // then the third run died with
  //   STALE_WORK_SECTION: backend rejected a Work Section the dropdown
  //   offered as available
  // on the sections its own earlier passes had used up. SM09, the smoke
  // replica of this spec, already carries the same '__random__' for the same
  // reason; this rewrite had regressed it.
  //
  // NOTE the retry helper `withLoginRetryOnStaleWorkSection` is deliberately
  // NOT used here, even though it exists and handles this error: it recovers
  // by re-logging in, and a fresh login DESTROYS the browser-local draft this
  // whole file is built around. Picking a free section up front is the only
  // safe form of the fix in this spec.
  data.workSection = level.fields.includes("workSection") ? "__random__" : "__skip__";
  return data;
}

// What to fill AFTER resuming the draft: exactly the fields this level did
// NOT already set, plus the marker. Deliberately does not re-pick fields the
// draft restored — partly because re-selecting an already-selected option is
// a documented hang risk (BasePage.selectDropdownOption's `alreadyChecked`
// comment), and partly because leaving them untouched is the stronger test:
// whatever the resumed form carries is what gets submitted.
function completionPayload(level, marker) {
  const data = {};
  for (const key of PAGE_ONE_FIELDS) {
    data[key] = level.fields.includes(key) ? null : RFI_DATA[key];
  }
  data.subContractor = marker;
  // A level that already selected its Work Section must NOT touch it again —
  // it is a multi-select and a second click would deselect it. Every other
  // level picks one here, and picks it at RANDOM for the same reason
  // draftPayload does: "first option" is not "first available", because the
  // app keeps already-used sections in the list.
  data.workSection = level.fields.includes("workSection") ? "__skip__" : "__random__";
  return data;
}

function fieldLocator(rfiCreate, key) {
  return {
    workLocation:         rfiCreate.workLocationDropdown,
    workArea:             rfiCreate.workAreaDropdown,
    package:              rfiCreate.packageDropdown,
    subPackage:           rfiCreate.subPackageDropdown,
    activity:             rfiCreate.activityDropdown,
    subActivity:          rfiCreate.subActivityDropdown,
    inspectionCheckpoint: rfiCreate.inspectionCheckpointDropdown,
    inspectionChecklist:  rfiCreate.inspectionChecklistDropdown,
  }[key];
}

// Returns the page to a clean My Tasks with no create form open and no
// half-finished draft in the way. Same un-bounce loop
// 02_rfi_ci.spec.js/03_rfi_bulk_create.spec.js already established for an
// auto-resumed draft blocking plain navigation to /my-tasks — needed here
// between levels too, since a level that failed mid-form would otherwise
// leave its draft for the NEXT level to silently auto-resume.
async function resetToMyTasks(page, myTasks) {
  for (let attempt = 0; attempt < 5 && page.url().includes("/create"); attempt++) {
    const cancelBtn = page.getByRole("button", { name: "Cancel" });
    if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(2000);
    }
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(2000);
  }
  // UNCONDITIONAL, deliberately. An earlier version only navigated when the
  // URL did not already contain "/my-tasks" — which looked right and was
  // wrong: a completed RFI lands on "/my-tasks/rfi/<uuid>/view", and that
  // CONTAINS "/my-tasks" as a substring. So after any level submitted, this
  // helper concluded it was already on My Tasks, skipped the navigation, and
  // then waited 30s for a "Create RFI" button that only exists on the real
  // list page. Found live 2026-09-05: L1 passed, L2 died here before doing
  // anything, and serial mode skipped the remaining eight tests.
  //
  // Navigating every time costs one page load and cannot be wrong.
  await page.goto(`${process.env.BASE_URL}/my-tasks`);
  await myTasks.waitForLoad();
}

test.describe("RFI draft-autosave at every depth of the Page 1 cascade", () => {
  let context, page, myTasks;
  // Filled in as levels complete; read by the EE/QI review tests at the end.
  const completed = [];

  test.beforeAll(async ({ browser }) => {
    // Own context rather than the `page` fixture, because every level shares
    // ONE session (see the serial-mode comment at the top). Permissions and
    // geolocation are replicated from playwright.config.js's `use` block —
    // a manually created context does not inherit those.
    context = await browser.newContext({
      permissions: ["geolocation", "camera"],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();
    await loginAsRole(page, "CI");
    myTasks = new MyTasksPage(page);
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  LEVELS.forEach((level, index) => {
    const { key: method, label: triggerLabel } = triggerFor(index, level);
    const name = `${level.key}: draft with ${level.label} — persists, resumes and completes (${method})`;

    test(name, async () => {
      test.setTimeout(20 * 60 * 1000);
      const marker = `Draft-${level.key} (${method})`;

      // ONE LOGIN FOR EVERY LEVEL — the CI session opened in beforeAll and
      // never re-established. That is deliberate and it is the point of the
      // file: it proves a real CI can draft, resume and submit repeatedly
      // WITHIN one working session, which is how the feature is actually used.
      //
      // A per-level `loginAsRole` was briefly added here and has been removed
      // again, because the reasoning behind it did not survive checking. It
      // was a workaround for STALE_WORK_SECTION at L2, blamed on leftover
      // localStorage draft state carrying a Work Section across levels. The
      // real cause of the first such failure was much duller: the Work
      // Section was being picked as "first option", so L1 and L2 simply chose
      // the SAME one (see draftPayload's '__random__' comment). With random
      // picking in place, L1 and L2 both pass on a single shared login —
      // verified live 2026-09-05. Re-logging in was solving a problem that
      // random selection had already solved, at the cost of making the spec
      // less representative of real use.
      await resetToMyTasks(page, myTasks);

      // ---- Fill this level's fields, and nothing beyond them ----
      await myTasks.clickCreateRFI();
      const rfiCreate = new RFICreatePage(page);
      await rfiCreate.fillForm(draftPayload(level));

      // ---- For every INCOMPLETE level, confirm Proceed is blocked
      // (validation enforced) before proving the draft-save is not
      // (validation NOT enforced). A complete level would legitimately pass
      // validation, so the check would be meaningless there. ----
      if (!level.complete) {
        await rfiCreate.proceedButton.waitFor({ state: "visible" });
        if (!(await rfiCreate.proceedButton.isDisabled())) {
          await rfiCreate.proceedButton.click();
          await page.waitForTimeout(1000);
          await expect(
            page.locator("text=Answer all the questions"),
            `${level.key}: Proceed should stay blocked with only "${level.label}" filled`
          ).not.toBeVisible();
          await expect(
            rfiCreate.workAreaDropdown,
            `${level.key}: should still be on Page 1 after a blocked Proceed`
          ).toBeVisible();
        }
      }

      // ---- "then next": L8 deliberately advances onto the checklist page
      // and drafts from there instead of from Page 1 ----
      if (level.proceedBeforeDrafting) {
        await rfiCreate.clickProceed();
        // `.first()` on the COMBINED locator, not just on the left-hand side.
        // `A.first().or(B)` still matches both A-first and B, so when the
        // checklist page renders BOTH its "Answer all the questions" heading
        // and its Submit button — which is exactly what arriving there looks
        // like — the assertion resolved to 2 elements and died on strict
        // mode. Found live 2026-09-05: L8 failed with a strict-mode violation
        // that actually PROVED Proceed had worked, since both indicators were
        // present. Collapsing to .first() asserts "either indicator is here",
        // which is what was meant.
        await expect(
          page.locator("text=Answer all the questions")
            .or(new RFIChecklistPage(page).submitButton).first(),
          `${level.key}: Proceed should have reached the checklist page before drafting`
        ).toBeVisible({ timeout: 20000 });
      }

      // ---- Trigger the draft ----
      if (method === "browser-back") {
        await page.goBack();
      } else if (method === "nav-click") {
        await page.locator('a:has-text("My Tasks"), nav >> text=My Tasks').first().click();
      } else {
        // The EXPLICIT path — the form's own Draft button, rather than the
        // app autosaving because we left. Unlike the two navigate-away
        // triggers this may well leave us still sitting on the form;
        // resetToMyTasks immediately below handles either outcome.
        await rfiCreate.clickSaveDraft();
      }
      await page.waitForTimeout(3000);
      await resetToMyTasks(page, myTasks);

      // ---- Confirm the draft shows up as an "In-Draft" row in the grid.
      // This is the sole, reliable proof the draft was saved — see header
      // comment for why the tile's COUNT badge is deliberately NOT
      // asserted on here. ----
      await myTasks.pendingWithMeTile.waitFor({ state: "visible" });
      await myTasks.clickPendingWithMe();
      await expect(
        page.getByText("In-Draft").first(),
        `${level.key}: a draft holding "${level.label}" should show as an "In-Draft" row ` +
        `in Pending with me after ${triggerLabel}`
      ).toBeVisible({ timeout: 10000 });

      // ---- Resume via the Actions-column eye icon (see header comment) —
      // falling back to re-clicking "Create RFI" (also confirmed to
      // auto-resume the same local draft) if the eye icon doesn't land
      // directly on an editable form ----
      const rfiList = new RFIListPage(page);
      await rfiList.waitForGrid();
      await rfiList.openDraftRow();
      console.log(`${level.key}: url after eye-icon click = ${page.url()}`);

      if (!page.url().includes("/create")) {
        const resumeButton = page.getByRole("button", { name: /resubmit|edit/i }).first();
        if (await resumeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
          await resumeButton.click();
          await page.waitForLoadState("networkidle");
          console.log(`${level.key}: url after Edit/Resubmit click = ${page.url()}`);
        }
      }

      if (!page.url().includes("/create")) {
        console.log(`${level.key}: eye icon didn't land on /create — falling back to "Create RFI" click`);
        await page.goto(`${process.env.BASE_URL}/my-tasks`);
        await myTasks.waitForLoad();
        await myTasks.clickCreateRFI();
      }

      expect(
        page.url(),
        `${level.key}: should have landed on the editable draft form one way or another`
      ).toContain("/create");

      // ---- The heart of this level: every field it had filled must have
      // survived the round trip, and nothing beyond them should have been
      // invented. Checked field by field so a partial restore names the
      // exact field that was lost, not just "something differed". ----
      for (const fieldKey of level.fields) {
        if (fieldKey === "workSection") continue; // read separately below
        const locator = fieldLocator(rfiCreate, fieldKey);
        const shown = (await locator.innerText()).trim();
        expect(
          shown,
          `${level.key}: "${fieldKey}" should survive the draft/resume round trip ` +
          `(expected it to still show "${RFI_DATA[fieldKey]}")`
        ).toContain(RFI_DATA[fieldKey]);
      }

      if (level.fields.includes("workSection")) {
        // INFORMATIONAL ONLY — deliberately NOT asserted, and that is a
        // correction of an earlier version of this file which DID assert
        // `summary.selected > 0` here and would have failed for the wrong
        // reason.
        //
        // "Work Sections Selected for RFI" does NOT mean "what this form
        // currently has ticked". It is a property of the work area, and
        // RFICreatePage.selectWorkSection records a live observation
        // (pulse-qa, 2026-09-03) of it reading "Selected for RFI 0" even
        // with an RFI already genuinely raised against one of the sections
        // — so it cannot distinguish a draft that restored its Work Section
        // from one that lost it, in either direction.
        //
        // Proving the restore properly needs the multi-select's own
        // selected-chip DOM, which has never been captured for this widget.
        // Rather than guess at that shape, this logs what the panel says so
        // the first live run shows the real numbers, and the genuine proof
        // of restoration stays where it is unambiguous: the RFI submits
        // successfully below without this level ever re-picking a section.
        const summary = await rfiCreate.readWorkSectionSummary().catch(() => null);
        console.log(
          `${level.key}: Work Section Summary on resume = ${JSON.stringify(summary)} ` +
          `(informational — see comment)`
        );
      }

      // ---- Complete only what this level left empty, then submit ----
      await rfiCreate.fillForm(completionPayload(level, marker));
      await rfiCreate.clickProceed();

      const checklist = new RFIChecklistPage(page);
      await checklist.fillAllObservations("OK - as per standard", true);
      await checklist.submitRFI();

      const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
      if (!match) {
        throw new Error(
          `${level.key}: could not extract an RFI id after completing the draft — ` +
          `landed on ${page.url()} instead of a /rfi/<id>/view URL`
        );
      }
      const rfiId = match[1];

      // POLL until the code stops reading "...-CIV-DRAFT".
      //
      // Confirmed live 2026-09-05, intermittently and across BOTH session
      // strategies (so it is not a side effect of how this file logs in): the
      // freshly-submitted RFI's view page can render its code with a literal
      // "DRAFT" where the assigned number belongs — e.g.
      // "RFI-A-06c-BL01-CIV-DRAFT" — and then settle to the real code
      // ("RFI-A-06c-BL01-CIV-607") a moment later. Three of thirteen
      // submissions across two runs came back that way.
      //
      // This mattered silently, and would have been a nasty flake to chase:
      // the level itself still PASSES on a DRAFT code (the submit really did
      // happen, the URL really is /rfi/<id>/view), but the code is what gets
      // recorded into `completed`, and the EE/QI review tests then search
      // "Pending with me" for a code that does not exist — failing far away
      // from the real cause, in a different test, only sometimes.
      const checklist2 = new RFIChecklistPage(page);
      let rfiCode = await checklist2.getVisibleCode();
      const codeDeadline = Date.now() + 20000;
      while (/-DRAFT$/i.test(rfiCode || '') && Date.now() < codeDeadline) {
        await page.waitForTimeout(500);
        rfiCode = await checklist2.getVisibleCode();
      }
      expect(
        rfiCode,
        `${level.key}: the submitted RFI never got a real code — it still reads "${rfiCode}" ` +
        `after 20s. If this persists, the RFI may not be leaving draft state on submit, which ` +
        `is an app problem rather than a slow render.`
      ).not.toMatch(/-DRAFT$/i);

      completed.push({ level, marker, rfiCode, rfiId });
      console.log(`${level.key}: completed drafted RFI as ${rfiCode} (${rfiId}) marker="${marker}"`);
    });
  });

  // ---- EE / QI review, deliberately LAST ----
  //
  // Switching user destroys the CI browser session and every draft in it, so
  // these cannot be interleaved with the levels above — they run once, at the
  // end, over every RFI the levels produced. That is also cheaper than the
  // original file's shape, which logged in as EE and QI once per draft.
  for (const role of ["EE", "QI"]) {
    test(`${role} sees every drafted-then-completed RFI with its marker intact`, async () => {
      test.setTimeout(20 * 60 * 1000);
      expect(
        completed.length,
        `No drafted RFIs were completed, so there is nothing for ${role} to review — ` +
        `check the level tests above for the real failure`
      ).toBeGreaterThan(0);

      await loginAsRole(page, role);
      for (const { level, marker, rfiCode } of completed) {
        await openFromPendingWithMe(page, rfiCode);
        const review = new RFIReviewPage(page);
        await review.expandAllChecklist();
        const subContractor = await review.getFieldValue("Sub-Contractor Name");
        expect(
          subContractor,
          `${role} review of ${rfiCode} (drafted at ${level.key}) should carry that ` +
          `level's marker unchanged`
        ).toBe(marker);
        await review.approve();
        console.log(`${role}: approved ${rfiCode} (${level.key}), marker verified`);
      }
    });
  }
});
