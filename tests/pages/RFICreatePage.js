const { BasePage } = require('./BasePage');

// Ark UI Select structure (confirmed from DOM inspection):
//   Trigger: <button role="combobox" data-part="trigger" aria-labelledby="...label">
//   Listbox: <div role="listbox" data-part="content" data-state="closed" hidden>
//   Options: <div role="option" data-part="item" data-state="unchecked/checked">
//              <span data-part="item-text">BL01</span>
//            </div>
//
// CRITICAL: The positioner has transform:translate3d(0,-100vh,0) when closed.
// Playwright considers [role="listbox"] "visible" the moment `hidden` is removed,
// BEFORE the transform moves the dropdown into the viewport. Clicking options at
// that point lands at y=-100vh which scrolls the page and hits nav links.
// Fix: wait for data-state="open" which Ark UI sets only after full positioning.

class RFICreatePage extends BasePage {
  constructor(page) {
    super(page);

    this.workLocationDropdown         = page.getByRole('combobox', { name: /Work Location/i }).first();
    this.workAreaDropdown             = page.getByRole('combobox', { name: /^Work Area/i }).first();
    this.packageDropdown              = page.getByRole('combobox', { name: /^Package/i }).first();
    this.subPackageDropdown           = page.getByRole('combobox', { name: /Sub-Package/i }).first();
    this.activityDropdown             = page.getByRole('combobox', { name: /^Activity/i }).first();
    this.subActivityDropdown          = page.getByRole('combobox', { name: /Sub-Activity/i }).first();
    this.inspectionCheckpointDropdown = page.getByRole('combobox', { name: /Inspection Checkpoint/i }).first();
    this.inspectionChecklistDropdown  = page.getByRole('combobox', { name: /Inspection Checklist/i }).first();
    this.unitDropdown                 = page.getByRole('combobox', { name: /Unit/i }).first();

    this.workSectionToggle = page.getByRole('button', { name: 'Toggle suggestions' });

    this.rfiQuantityInput   = page.getByRole('spinbutton', { name: 'RFI Quantity' });
    this.subContractorInput = page.getByRole('textbox',    { name: 'Sub-Contractor Name' });

    this.proceedButton   = page.getByRole('button', { name: 'Proceed' });
    this.saveDraftButton = page.getByRole('button', { name: 'Draft' });
    this.cancelButton    = page.getByRole('button', { name: 'Cancel' });
  }

  // Open a dropdown and return the listbox ONLY after data-state="open" is set.
  // This guarantees the CSS transform has moved the dropdown into the viewport
  // so that option clicks land at the correct coordinates.
  //
  // Uses short, explicit per-attempt timeouts inside a bounded poll (max
  // 10s total — see BasePage.pollUntil) instead of one plain click/wait
  // with no timeout. User-confirmed live: a plain click() with no timeout
  // silently retries against playwright.config.js's global 30s
  // actionTimeout underneath — with a second such click right after in
  // selectOption below, that's what made simple Work-Location-dependent
  // dropdown selection (Work Area, Package, Activity, ...) feel like it
  // was "waiting 30-60 seconds," when the field was really just briefly
  // blocked/loading for a couple of seconds after Work Location changed.
  // Normal case now resolves in well under a second; a genuinely-still-
  // loading dropdown fails clearly after 10s instead of hanging silently.
  async _openDropdown(trigger) {
    // Confirmed live (single-session-login-fix-for-passes branch): 3
    // concurrently-live browser contexts (21_rfi_flow_single_session.spec.js
    // logs in CI/EE/QI as 3 simultaneous sessions, unlike every other spec's
    // one-context-at-a-time model) create enough CPU/render/backend
    // contention to blow through the original 3000ms budget consistently —
    // confirmed by a diagnostic run at 20000ms, where every TC that
    // previously failed here succeeded instead. Bumped to 10000ms as a
    // middle ground: still far more forgiving than 3000ms under concurrent-
    // context load, without pushing genuine failures (a truly broken
    // dropdown elsewhere in the suite) out to a full 20s before erroring.
    await trigger.waitFor({ state: 'visible', timeout: 10000 });
    const listbox = this.page.locator('[role="listbox"][data-state="open"]');

    const opened = await this.pollUntil(async () => {
      await trigger.click({ timeout: 1500 }).catch(() => {});
      if (await listbox.isVisible({ timeout: 300 }).catch(() => false)) return true;
      await trigger.press('Space', { timeout: 1000 }).catch(() => {});
      return await listbox.isVisible({ timeout: 300 }).catch(() => false);
    });
    // Real error (not silently swallowed) if it genuinely never opened
    // within the 10s budget.
    if (!opened) await listbox.waitFor({ state: 'visible', timeout: 500 });
    return listbox;
  }

  async selectOption(dropdown, optionText) {
    const listbox = await this._openDropdown(dropdown);
    // Options are plain <div role="option"> elements — not <a> links, safe to click.
    // filter({ hasText }) is a plain substring match, safe for special chars like ()+
    const option = listbox.locator('[role="option"]').filter({ hasText: optionText }).first();
    const found = await this.pollUntil(() => option.isVisible({ timeout: 300 }));
    if (!found) await option.waitFor({ state: 'visible', timeout: 500 }); // real error
    await option.click({ timeout: 1500 }).catch(() => option.click());
    await this.page.waitForTimeout(100);
  }

  async selectFirstAvailable(dropdown) {
    const listbox = await this._openDropdown(dropdown);
    const first = listbox.locator('[role="option"]').first();
    const found = await this.pollUntil(() => first.isVisible({ timeout: 300 }));
    if (!found) await first.waitFor({ state: 'visible', timeout: 500 }); // real error
    await first.click({ timeout: 1500 }).catch(() => first.click());
    await this.page.waitForTimeout(100);
  }

  // `label`, when given, picks the option matching that exact text instead
  // of "whatever is first" — needed by the Activity Dependency chain spec
  // (29_rfi_activity_dependency.spec.js), which must reuse the SAME Work
  // Section across a whole checkpoint chain (the app's checkpoint
  // dependency is scoped per Work Section, so checkpoint N and N+1 must be
  // filed against the identical Work Section for the dependency to ever
  // resolve). Returns the selected option's trimmed label so a caller with
  // no `label` (i.e. every existing caller — fillForm()'s no-arg call is
  // unaffected) can capture "whatever got picked" for reuse later.
  //
  // `label === '__random__'` picks a uniformly random option instead of
  // the first — also for the dependency chain spec: confirmed live
  // (00_inspect_rfi_work_sections_per_checkpoint.spec.js) that this
  // dropdown does NOT reliably drop already-used options, so "first
  // available" can keep re-picking a Work Section a PREVIOUS run of that
  // spec already fully created+approved for checkpoint[0] — making a
  // rerun's very first "should be blocked" check false (the dependency
  // really would already be satisfied for that recycled section). Random
  // selection makes colliding with a specific prior run's single choice
  // very unlikely without needing the dropdown to filter anything.
  async selectWorkSection(label) {
    const listbox = await this._openDropdown(this.workSectionToggle);
    // This list is a real scrollable list (also has a "Select All (N)"
    // control at the top — the app owner's other suggested strategy), NOT
    // a short virtualized window — confirmed live that every option exists
    // in the DOM at once, just clipped by the scroll container. A deep
    // option (by random index OR by a specific label re-selected later in
    // a chain — same repro either way, confirmed live: even the labeled
    // branch failed the same way) is very likely scrolled OFF-SCREEN, and
    // Playwright's visibility check on an off-screen-but-present element
    // fails/times out — scroll it into view first, in BOTH branches.
    let option;
    if (label === '__random__') {
      const options = listbox.locator('[role="option"]');
      // Give the (potentially large) list a moment to finish rendering
      // before counting — otherwise a random index chosen against a
      // still-growing count can end up stale.
      await this.page.waitForTimeout(300);
      const count = await options.count();
      option = options.nth(Math.floor(Math.random() * Math.max(count, 1)));
    } else if (label) {
      option = listbox.locator('[role="option"]').filter({ hasText: label }).first();
    } else {
      option = listbox.locator('[role="option"]').first();
    }
    await option.scrollIntoViewIfNeeded().catch(() => {});
    await this.page.waitForTimeout(150);
    const found = await this.pollUntil(() => option.isVisible({ timeout: 300 }));
    if (!found) {
      const err = new Error(`WORK_SECTION_NOT_FOUND: option matching "${label}" not visible in the Work Section list after polling`);
      err.workSectionNotFound = true;
      throw err;
    }
    const selectedLabel = (await option.innerText()).trim();
    await option.click({ timeout: 1500 }).catch(() => option.click());
    // Multi-select combobox stays open after selection.
    // Click the toggle button again to close it.
    // DO NOT press Escape — the form's Escape handler navigates back to My Tasks.
    await this.workSectionToggle.click({ timeout: 1500 }).catch(() => this.workSectionToggle.click());
    await this.page.locator('[role="listbox"][data-state="open"]')
      .waitFor({ state: 'hidden', timeout: 3000 })
      .catch(() => {});
    await this.page.waitForTimeout(100);
    return selectedLabel;
  }

  async fillForm(data) {
    const pick = async (dropdown, value) => {
      if (value == null) return;
      if (value === '__first__') return this.selectFirstAvailable(dropdown);
      return this.selectOption(dropdown, value);
    };

    await pick(this.workLocationDropdown,         data.workLocation);
    await pick(this.workAreaDropdown,             data.workArea);
    await pick(this.packageDropdown,              data.package);
    await pick(this.subPackageDropdown,           data.subPackage);
    await pick(this.activityDropdown,             data.activity);
    await pick(this.subActivityDropdown,          data.subActivity);

    if (data.rfiQuantity != null) {
      await this.rfiQuantityInput.waitFor({ state: 'visible' });
      await this.rfiQuantityInput.click({ clickCount: 3 });
      await this.rfiQuantityInput.pressSequentially(String(data.rfiQuantity), { delay: 40 });
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(30);
    }

    await pick(this.unitDropdown, data.unit);

    if (data.subContractor) {
      await this.subContractorInput.waitFor({ state: 'visible' });
      await this.subContractorInput.click({ clickCount: 3 });
      await this.subContractorInput.pressSequentially(data.subContractor, { delay: 40 });
      await this.page.keyboard.press('Tab');
      await this.page.waitForTimeout(30);
    }

    await pick(this.inspectionCheckpointDropdown, data.inspectionCheckpoint);
    await pick(this.inspectionChecklistDropdown,  data.inspectionChecklist);
    // `data.workSection`, when given, pins the SAME Work Section across a
    // whole dependency chain (see selectWorkSection()'s comment) — every
    // existing caller leaves this unset, so behavior is unchanged (picks
    // "whatever is first," same as before this returned a value at all).
    return await this.selectWorkSection(data.workSection);
  }

  async clickProceed() {
    await this.proceedButton.waitFor({ state: 'visible' });
    await this.proceedButton.click();

    // "Answer all the questions" is the heading of the checklist panel on page 2.
    // It appears ONLY after a successful Proceed navigation, not during page-1 validation.
    //
    // Confirmed live (2026-08-19, app owner): the Work Section dropdown can
    // offer an option the backend then rejects with a "Validation Error: An
    // RFI already exists for the workSections: <code>" toast instead of
    // navigating to page 2 — app owner confirmed this is a known symptom of
    // cookies not being fully cleared before login, and the fix is simply to
    // retry via a fresh login, not to pick a different Work Section. Race
    // the two outcomes so this fails fast and distinguishably (callers key
    // off `err.staleWorkSection` to retry-via-relogin) instead of silently
    // burning the full 30s timeout waiting for a navigation that was never
    // going to happen.
    const success = this.page.locator('text=Answer all the questions');
    const staleWorkSectionError = this.page.getByText(/already exists for the workSections/i);

    const winner = await Promise.race([
      success.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'success').catch(() => 'timeout'),
      staleWorkSectionError.waitFor({ state: 'visible', timeout: 30000 }).then(() => 'stale').catch(() => 'timeout'),
    ]);

    if (winner === 'stale') {
      const err = new Error('STALE_WORK_SECTION: backend rejected a Work Section the dropdown offered as available — retry via fresh login');
      err.staleWorkSection = true;
      throw err;
    }

    // Neither outcome showed up within 30s — re-check for real so a
    // genuinely stuck page still throws Playwright's own clear timeout
    // error (with its usual screenshot/error-context attachments).
    await success.waitFor({ state: 'visible', timeout: 1000 });
  }

  // NEW, for the Activity Dependency chain spec only — clickProceed() above
  // assumes the outcome is either success or the known "stale Work
  // Section" backend glitch, and THROWS otherwise. Here a third, deliberately
  // provoked outcome is the one under test: the app's real checkpoint-
  // dependency validation toast. Its exact wording isn't hardcoded anywhere
  // in this repo yet (confirmed via repo-wide search), so this never asserts
  // on specific text — it just reports whether Proceed actually navigated,
  // and if not, whatever toast text (if any) showed up, so the caller can
  // log/assert on the real, live wording instead of a guessed one.
  async clickProceedAndCheckOutcome() {
    await this.proceedButton.waitFor({ state: 'visible', timeout: 10000 });
    await this.proceedButton.click();

    const success = this.page.locator('text=Answer all the questions');
    // Broader than clickProceed()'s toast-only check — same selector
    // LoginPage.js uses for its own error detection — since the exact
    // presentation of a dependency-validation error (toast vs. inline
    // alert) isn't confirmed yet.
    const toast = this.page.locator('[data-scope="toast"], [role="alert"], [class*="error"]').first();

    await Promise.race([
      success.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
      toast.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {}),
    ]);

    if (await success.isVisible({ timeout: 500 }).catch(() => false)) {
      return { proceeded: true, toastText: '' };
    }

    // Blocked (or nothing rendered yet) — poll for toast/error text; a
    // toast can take a beat to paint its final text after the container
    // mounts.
    let toastText = '';
    for (let i = 0; i < 40; i++) {
      toastText = (await toast.innerText().catch(() => '')).trim();
      if (toastText) break;
      await this.page.waitForTimeout(300);
    }
    return { proceeded: false, toastText };
  }

  async clickSaveDraft() {
    await this.saveDraftButton.waitFor({ state: 'visible' });
    await this.saveDraftButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  // When CI reopens an RFI rejected on the checklist page, Page 1 fields are
  // locked (can't change Work Area/Activity/etc.) — confirmed by the app
  // owner. When rejected on Page 1 instead, these same fields are editable.
  // Work Location is representative of the whole page's lock state.
  async isFirstPageLocked() {
    return await this.workLocationDropdown.isDisabled();
  }
}

module.exports = RFICreatePage;
