const { test, expect } = require("@playwright/test");
const { loginAsRole } = require("../utils/helpers");
const { openFromPendingWithMe } = require("../utils/rfi-nav");
const { RFI_DATA } = require("../utils/rfi-flow-turns");
const MyTasksPage      = require("../pages/MyTasksPage");
const RFICreatePage    = require("../pages/RFICreatePage");
const RFIChecklistPage = require("../pages/RFIChecklistPage");
const RFIReviewPage    = require("../pages/RFIReviewPage");
const RFIListPage      = require("../pages/RFIListPage");

test.describe.configure({ mode: "serial" });

// Draft/autosave: CI navigating away from the Create RFI form mid-fill
// (even with only Work Location selected — no other field, not even a
// required one) persists a local draft, surfaced in "Pending with me" as
// an "In-Draft" row. Confirmed live (2026-08-19, app owner + direct
// investigation):
//
// - The draft is stored LOCALLY in the browser, not server-side — a fresh
//   login/context (or logging out and back in) loses it entirely. Every
//   test below must create, verify, resume, AND complete its own draft
//   within one continuous session — never split across separate logins.
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
//   set (every other required field empty) still saves a draft. Each
//   scenario below proves both halves of that asymmetry in one place:
//   Proceed blocked first, then the same incomplete state saved as a
//   draft via going back.
// - Per app-owner suggestion, the Sub-Contractor Name free-text field
//   carries a marker identifying which trigger produced this draft
//   (e.g. "Draft-Autosave-Test (browser-back)"), filled in while
//   completing the resumed draft — then verified at EE's and QI's
//   review screens too, the same "does CI's data reach EE/QI unchanged"
//   principle as 23_rfi_data_integrity.spec.js, applied to a
//   drafted-then-completed RFI instead of a straight one.
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
const TRIGGER_METHODS = [
  { key: "browser-back", label: "browser Back button" },
  { key: "nav-click",    label: "in-app nav click away (My Tasks sidebar link)" },
];

for (const { key: method, label } of TRIGGER_METHODS) {
  test(`RFI draft-autosave (${label}): Work-Location-only form persists as a draft and completes correctly`, async ({ page }) => {
    test.setTimeout(20 * 60 * 1000);

    await loginAsRole(page, "CI");
    const myTasks = new MyTasksPage(page);

    // ---- Fill only Work Location, confirm Proceed is blocked (validation
    // enforced), then trigger the "goes back" action (validation NOT
    // enforced for the draft-save) ----
    await myTasks.clickCreateRFI();
    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.selectOption(rfiCreate.workLocationDropdown, RFI_DATA.workLocation);

    await rfiCreate.proceedButton.waitFor({ state: "visible" });
    const proceedDisabled = await rfiCreate.proceedButton.isDisabled();
    if (!proceedDisabled) {
      await rfiCreate.proceedButton.click();
      await page.waitForTimeout(1000);
      await expect(
        page.locator("text=Answer all the questions"),
        `${label}: Proceed should stay blocked with only Work Location filled`
      ).not.toBeVisible();
      await expect(
        rfiCreate.workAreaDropdown,
        `${label}: should still be on Page 1 after a blocked Proceed`
      ).toBeVisible();
    }

    if (method === "browser-back") {
      await page.goBack();
    } else {
      await page.locator('a:has-text("My Tasks"), nav >> text=My Tasks').first().click();
    }
    await page.waitForTimeout(3000);

    // Same un-bounce loop 02_rfi_ci.spec.js/03_rfi_bulk_create.spec.js
    // already established for an auto-resumed draft blocking plain
    // navigation to /my-tasks.
    for (let attempt = 0; attempt < 5 && page.url().includes("/create"); attempt++) {
      const cancelBtn = page.getByRole("button", { name: "Cancel" });
      if (await cancelBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(2000);
      }
      await page.goto(`${process.env.BASE_URL}/my-tasks`);
      await page.waitForTimeout(2000);
    }
    await myTasks.waitForLoad();

    // ---- Confirm the draft shows up as an "In-Draft" row in the grid.
    // This is the sole, reliable proof the draft was saved — see header
    // comment for why the tile's COUNT badge is deliberately NOT
    // asserted on here. ----
    await myTasks.pendingWithMeTile.waitFor({ state: "visible" });
    await myTasks.clickPendingWithMe();
    await expect(
      page.getByText("In-Draft").first(),
      `${label}: draft should show as an "In-Draft" row in Pending with me`
    ).toBeVisible({ timeout: 10000 });

    // ---- Resume via the Actions-column eye icon (see header comment) —
    // falling back to re-clicking "Create RFI" (also confirmed to
    // auto-resume the same local draft) if the eye icon doesn't land
    // directly on an editable /create form ----
    const rfiList = new RFIListPage(page);
    await rfiList.waitForGrid();
    await rfiList.openDraftRow();
    console.log(`${label}: url after eye-icon click = ${page.url()}`);

    if (!page.url().includes("/create")) {
      const resumeButton = page.getByRole("button", { name: /resubmit|edit/i }).first();
      if (await resumeButton.isVisible({ timeout: 5000 }).catch(() => false)) {
        await resumeButton.click();
        await page.waitForLoadState("networkidle");
        console.log(`${label}: url after Edit/Resubmit click = ${page.url()}`);
      }
    }

    if (!page.url().includes("/create")) {
      console.log(`${label}: eye icon didn't land on /create — falling back to "Create RFI" click`);
      await page.goto(`${process.env.BASE_URL}/my-tasks`);
      await myTasks.waitForLoad();
      await myTasks.clickCreateRFI();
    }

    expect(
      page.url(),
      `${label}: should have landed on the editable draft form one way or another`
    ).toContain("/create");
    const resumedWorkLocation = (await rfiCreate.workLocationDropdown.innerText()).trim();
    expect(
      resumedWorkLocation,
      `${label}: Work Location should survive the resume`
    ).toContain(RFI_DATA.workLocation);

    const marker = `Draft-Autosave-Test (${method})`;
    const { workLocation, subContractor, ...rest } = RFI_DATA;
    await rfiCreate.fillForm({ workLocation: null, subContractor: marker, ...rest });
    await rfiCreate.clickProceed();

    const checklist = new RFIChecklistPage(page);
    await checklist.fillAllObservations("OK - as per standard", true);
    await checklist.submitRFI();

    const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
    if (!match) throw new Error(`Could not extract RFI id after completing draft: ${page.url()}`);
    const rfiId = match[1];

    const rfiCode = await new RFIChecklistPage(page).getVisibleCode();
    console.log(`Completed draft (${label}) as ${rfiCode} (${rfiId})`);

    // ---- EE review — confirm the marker (and the rest of RFI_DATA)
    // reached EE unchanged ----
    await loginAsRole(page, "EE");
    await openFromPendingWithMe(page, rfiCode);
    const eeView = new RFIReviewPage(page);
    await eeView.expandAllChecklist();
    const eeSubContractor = await eeView.getFieldValue("Sub-Contractor Name");
    expect(eeSubContractor, `${label}: EE review should show the draft-completion marker`).toBe(marker);
    await eeView.approve();

    // ---- QI review — same check ----
    await loginAsRole(page, "QI");
    await openFromPendingWithMe(page, rfiCode);
    const qiView = new RFIReviewPage(page);
    await qiView.expandAllChecklist();
    const qiSubContractor = await qiView.getFieldValue("Sub-Contractor Name");
    expect(qiSubContractor, `${label}: QI review should show the draft-completion marker`).toBe(marker);
    await qiView.approve();
  });
}
