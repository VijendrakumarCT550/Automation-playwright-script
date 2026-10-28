const { BasePage } = require('./BasePage');

// Covers QI's NC creation form at /my-tasks/nc/create/<uuid>. Unlike RFI's
// create flow, there is no separate "Proceed" step to a second page — both
// "Page 1 of 2" (location/vendor/activity/work section/quantity) and
// "Page 2 of 2" (description/defect/category/photo) are visible together in
// one scrollable view, with Submit/Draft/Cancel at the bottom.
//
// Fully self-contained (own navigation, own locators) — deliberately kept
// independent of MyTasksPage/RFI page objects so NC work never risks the
// already-validated RFI flow.
class NCCreatePage extends BasePage {
  constructor(page) {
    super(page);

    this.ncTab          = page.locator('button:has-text("NC")').first();
    this.createNCButton = page.locator('button:has-text("Create NC")').first();

    // Page 1 of 2
    this.workLocationDropdown = page.getByRole('combobox', { name: /Work Location/i }).first();
    this.workAreaDropdown     = page.getByRole('combobox', { name: /^Work Area/i }).first();
    this.vendorNameDropdown   = page.getByRole('combobox', { name: /Vendor Name/i }).first();
    this.packageDropdown      = page.getByRole('combobox', { name: /^Package/i }).first();
    this.activityDropdown     = page.getByRole('combobox', { name: /^Activity/i }).first();
    this.subActivityDropdown  = page.getByRole('combobox', { name: /Sub-Activity/i }).first();
    this.workSectionDropdown  = page.getByRole('combobox', { name: /Work Section/i }).first();
    this.ncQuantityInput      = page.getByRole('spinbutton', { name: /NC Quantity/i });
    this.unitDropdown         = page.getByRole('combobox', { name: /Unit/i }).first();

    // Page 2 of 2
    this.ncDescriptionInput = page.getByPlaceholder('Enter NC Description');
    // DEFECT TYPE IS A DROPDOWN, NOT A TEXT INPUT — app change seen
    // 2026-09-17. It used to be free text (`getByPlaceholder('Enter Defect
    // Type')`, removed); it is now a searchable single-select whose trigger
    // reads "Select Defect Type", and whose OPTION LIST THE APP COMPUTES FROM
    // THE REST OF THE FORM (Work Location / Work Area / Package / Activity /
    // Sub-Activity). So it must be filled AFTER that cascade, and no fixed
    // literal is guaranteed to be on offer — see selectDefectType below and
    // BasePage.selectSearchableOption.
    //
    // Two locators because this app's newer fields do not reliably carry an
    // accessible name: the by-name one every other dropdown here uses, and a
    // by-label field-root fallback of the kind RFIReviewPage's linked-NC
    // fields already needed. _defectTypeTrigger() picks whichever resolves.
    this.defectTypeDropdown = page.getByRole('combobox', { name: /Defect Type/i }).first();
    this.defectTypeField    = page
      .locator('[data-scope="field"][data-part="root"]')
      .filter({ hasText: /Defect Type/i })
      .first();
    this.categoryDropdown   = page.getByRole('combobox', { name: /Category/i }).first();
    // Newly mandatory field. Same Ark UI date-picker component already
    // confirmed for the Dashboard Filter's From/To fields (see
    // DashboardFilterPage's header comment) — readonly input, real value
    // set via the calendar popup that opens off the trigger button, not by
    // typing.
    this.targetDateInput   = page.getByPlaceholder('dd/mm/yyyy').first();
    this.targetDateTrigger = page.getByRole('button', { name: /open date picker/i }).first();
    this.dateCalendar      = page.locator('[data-scope="date-picker"][data-part="content"]');
    this.debitAmountInput   = page.getByRole('spinbutton', { name: /Debit Amount/i });

    this.submitButton    = page.getByRole('button', { name: 'Submit' }).first();
    this.saveDraftButton = page.getByRole('button', { name: 'Draft' }).first();
    this.cancelButton    = page.getByRole('button', { name: 'Cancel' }).first();
  }

  async goto() {
    await this.navigate(`${process.env.BASE_URL}/my-tasks?type=nc`);
    await this.createNCButton.waitFor({ state: 'visible', timeout: 30000 });
  }

  async clickCreateNC() {
    await this.createNCButton.waitFor({ state: 'visible' });
    await this.createNCButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  // Some option lists (e.g. Work Area — A-06c alone has dozens of them) open
  // already scrolled past the top, so the target option isn't in view yet —
  // confirmed live: opening Work Area showed BL06.. first, not BL01. Scroll
  // the listbox to the top before giving up. Kept local to NCCreatePage
  // (not added to BasePage's shared selectDropdownOption) so this can't
  // affect RFI/WAM/User-Management's already-validated dropdown handling.
  //
  // RETRIES THE OPEN (2026-10-08). A cascade field opened right after its parent
  // was picked can render "No items found" because its options have not loaded
  // yet (seen live on Sub-Activity straight after Activity, in a 20-NC run: 3 of
  // 20 creates failed with a bare 5s waitFor timeout). The list fills a moment
  // later, so close, give it time, and reopen rather than failing the TC.
  async _selectScrollableOption(dropdown, optionText, attempts = 3) {
    let lastErr;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      const listbox = await this.openDropdown(dropdown);
      const option = listbox.locator('[role="option"]').filter({ hasText: optionText }).first();
      try {
        if (!(await option.isVisible({ timeout: 2000 }).catch(() => false))) {
          await listbox.hover();
          await this.page.mouse.wheel(0, -10000);
        }
        await option.waitFor({ state: 'visible', timeout: 5000 });
        await option.click();
        await this.page.waitForTimeout(300);
        return;
      } catch (err) {
        lastErr = err;
        if (attempt === attempts) break;
        console.log(`  (dropdown option "${optionText}" not on offer yet — reopening, attempt ${attempt}/${attempts})`);
        if (await listbox.isVisible().catch(() => false)) {
          await this.page.keyboard.press('Escape').catch(() => {});
          await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
        }
        await this.page.waitForTimeout(2500);
      }
    }
    throw lastErr;
  }

  // Resolves the Defect Type trigger, by accessible name when it has one and
  // by its labelled field root otherwise. waitFor (not isVisible) because
  // isVisible is a single immediate check and does not poll.
  async _defectTypeTrigger() {
    const byName = await this.defectTypeDropdown
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);
    if (byName) return this.defectTypeDropdown;

    const byLabel = this.defectTypeField.getByRole('combobox').first();
    await byLabel.waitFor({ state: 'visible', timeout: 10000 });
    return byLabel;
  }

  // Picks the option at `index` of an open-able dropdown, WRAPPING ROUND the
  // list (`index % count`), so a loop passing 0,1,2,… cycles first → second →
  // … → first again however short this activity's list is. Returns the option
  // text actually clicked. Kept local to NCCreatePage, like
  // _selectScrollableOption, so no RFI/WAM/User-Management dropdown changes.
  //
  // Added for Defect Type's numeric mode (Defect Type is a dropdown now; index
  // selection added 2026-09-24 for 39_nc_bulk_create_qi.spec.js).
  async _selectOptionByIndex(dropdown, index) {
    const listbox = await this.openDropdown(dropdown);
    const options = listbox.locator('[role="option"]');
    await options.first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
    const count = await options.count();
    if (!count) throw new Error(`Dropdown has no options to pick index ${index} from`);

    const option = options.nth(((index % count) + count) % count);
    await option.scrollIntoViewIfNeeded();
    const text = (await option.innerText()).replace(/\s*✓\s*$/, '').trim();
    await option.click();
    await this.page.waitForTimeout(300);
    // Guarded close — a blind Escape with nothing open bubbles up (see
    // BasePage.selectDropdownOption).
    if (await listbox.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    }
    return text;
  }

  // Picks a Defect Type. `preferred` is a PREFERENCE (a string, or candidates
  // tried in order), not a requirement: the list is activity-dependent, so the
  // first offered option is taken when none of the candidates is present, and
  // the label actually picked is returned and cached on `lastDefectType` for
  // callers that need to assert on the real value (e.g. the draft/resume
  // round-trip in 32_nc_draft_autosave.spec.js).
  //
  // Pass '__first__' to say "whatever this NC's activity offers" explicitly —
  // the same sentinel fillForm's other dropdowns already accept.
  //
  // Pass a NUMBER to pick by position, wrapping round the list — see
  // _selectOptionByIndex (2026-09-24, used by the bulk NC spec to spread NCs
  // across the options on offer).
  //
  // VERIFIES THE PICK LANDED rather than trusting the click: this app no-ops
  // on invalid input, and a Defect Type left unset would surface much later as
  // a silent Submit that never happens.
  async selectDefectType(preferred) {
    const trigger = await this._defectTypeTrigger();
    const byIndex = typeof preferred === 'number';
    const picked = byIndex
      ? await this._selectOptionByIndex(trigger, preferred)
      : await this.selectSearchableOption(trigger, { preferred });

    const shown = (await trigger.innerText()).trim();
    if (!shown || /^select\s+defect\s+type$/i.test(shown)) {
      throw new Error(
        `Defect Type still reads "${shown}" after picking "${picked}" — the selection did not stick`
      );
    }

    const asked = byIndex ? [] : (Array.isArray(preferred) ? preferred : [preferred])
      .filter(v => v != null && v !== '' && v !== '__first__');
    if (asked.length && !asked.some(v => picked.toLowerCase().includes(String(v).toLowerCase()))) {
      console.log(
        `Defect Type: none of [${asked.join(', ')}] is offered for this NC's ` +
        `activity — picked "${picked}" instead`
      );
    }

    this.lastDefectType = picked;
    return picked;
  }

  // Reads the Defect Type currently shown on the form (the dropdown's own
  // text — it is a button now, so inputValue() no longer applies).
  async getDefectTypeText() {
    const trigger = await this._defectTypeTrigger();
    return (await trigger.innerText()).trim();
  }

  // Navigates the calendar forward (this app's target dates are always in
  // the future) until the target day's cell is found, then clicks it.
  // Bounded to 6 months of forward navigation so a wrong assumption about
  // the widget throws a real error instead of looping forever.
  async selectTargetDate(daysFromNow = 14) {
    const target = new Date();
    target.setDate(target.getDate() + daysFromNow);
    const dataValue = [
      target.getFullYear(),
      String(target.getMonth() + 1).padStart(2, '0'),
      String(target.getDate()).padStart(2, '0'),
    ].join('-');

    await this.targetDateTrigger.click();
    await this.dateCalendar.waitFor({ state: 'visible', timeout: 5000 });

    // MUST EXCLUDE DISABLED CELLS, not just look for the date. Ark pads the day
    // grid with the tail of the previous month and the head of the next one,
    // and those padding cells carry data-outside-range / data-disabled /
    // aria-disabled="true". So a date's cell EXISTS AND IS "VISIBLE" a month
    // before it is actually clickable — and clicking it never succeeds:
    // Playwright's actionability retry just spins on "element is not enabled"
    // for the full 30s.
    //
    // CONFIRMED LIVE 2026-09-17 (spec 14 on pulse-test): a 14-day target from
    // the 17th resolves to 2026-10-01, which September's grid renders as a
    // greyed-out padding cell, so NC creation timed out here — for every run
    // from the 17th of any month onwards. DashboardFilterPage documented this
    // exact trap on 2026-09-05 ("the literal first DOM match was 31 August,
    // greyed out"); the fix simply never reached this picker or the linked-NC
    // one in RFIReviewPage.
    const enabledCell = () => this.dateCalendar.locator(
      `[data-part="table-cell-trigger"][data-value="${dataValue}"]` +
      `:not([data-outside-range]):not([data-disabled]):not([aria-disabled="true"])`
    );

    for (let i = 0; i < 6; i++) {
      const clickable = await enabledCell()
        .waitFor({ state: 'visible', timeout: 1000 })
        .then(() => true)
        .catch(() => false);
      if (clickable) {
        await enabledCell().click();
        await this.dateCalendar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        return;
      }
      // Confirmed live: the calendar mounts THREE next-trigger buttons at
      // once (day/month/year views all share [data-part="next-trigger"]),
      // so a bare part-selector is a strict-mode violation. The day view's
      // one is uniquely identified by its aria-label.
      await this.dateCalendar.getByRole('button', { name: 'Switch to next month' }).click();
      await this.page.waitForTimeout(200);
    }
    // Name WHICH failure this is: the date never appeared at all, or it
    // appeared and the app refuses it (a min/max-date restriction).
    const present = await this.dateCalendar
      .locator(`[data-part="table-cell-trigger"][data-value="${dataValue}"]`)
      .count()
      .catch(() => 0);
    throw new Error(
      `Target Date for Closure: no ENABLED date cell for ${dataValue} within 6 months of ` +
      `forward navigation — ${present
        ? 'the cell exists but is disabled, so this is a min/max-date restriction on the field'
        : 'there is no cell for that date at all'}`
    );
  }

  // Target Date for Closure MAY now be auto-filled by the backend from the
  // selected Defect Type (app change, 2026-10-23) — but not for every defect
  // type. So: give the autofill a short window to land, and only pick a date
  // ourselves when the field is still empty. Either way the outcome is logged,
  // so a run shows which path each NC took.
  //
  // Must run AFTER Defect Type is selected. Returns { autoFilled, value }.
  async selectTargetDateIfEmpty(daysFromNow = 14, { waitMs = 5000 } = {}) {
    const autoValue = await this.waitForAutoFilledDate(this.targetDateInput, waitMs);
    if (autoValue) {
      console.log(`Target Date for Closure: auto-filled by app from Defect Type ` +
        `"${this.lastDefectType ?? '?'}" → ${autoValue} (not touched)`);
      return { autoFilled: true, value: autoValue };
    }
    console.log(`Target Date for Closure: NOT auto-filled for Defect Type ` +
      `"${this.lastDefectType ?? '?'}" — filling it (+${daysFromNow} days)`);
    await this.selectTargetDate(daysFromNow);
    const value = (await this.targetDateInput.inputValue().catch(() => '')).trim();
    console.log(`Target Date for Closure: filled → ${value}`);
    return { autoFilled: false, value };
  }

  // NC Quantity is only required when the selected Unit is NOT "Not
  // Applicable (NA)" — caller signals this by simply omitting ncQuantity
  // (and passing a unit like 'NA') vs providing both.
  //
  // Target Date for Closure / Capture Photo are both newly mandatory
  // fields (per app change). targetDateClosureDays picks how many days
  // from today to target (selectTargetDate defaults to 14 if omitted);
  // capturePhoto defaults to true unless a caller explicitly opts out with
  // `capturePhoto: false` (e.g. a test deliberately exercising the "photo
  // required" validation error).
  //
  // `defectType` is a dropdown PREFERENCE, not a literal to type — see
  // selectDefectType. It is filled here, after the cascade, because the app
  // derives the options from those fields; what was actually picked is left on
  // `this.lastDefectType`.
  async fillForm(data) {
    const pick = async (dropdown, value) => {
      if (value == null) return;
      if (value === '__first__') return this.selectFirstDropdownOption(dropdown);
      return this._selectScrollableOption(dropdown, value);
    };

    await pick(this.workLocationDropdown, data.workLocation);
    await pick(this.workAreaDropdown,     data.workArea);
    await pick(this.vendorNameDropdown,   data.vendorName);
    await pick(this.packageDropdown,      data.package);
    await pick(this.activityDropdown,     data.activity);
    await pick(this.subActivityDropdown,  data.subActivity);

    // `pickedWorkSections` is RETURNED (see the end of this method) so a
    // caller can find out WHICH sections the NC actually landed on. Added
    // 2026-09-06 for SM28, which has to raise an RFI against the exact same
    // work section afterwards to prove the NC blocked it. Purely additive:
    // every pre-existing caller ignores the return value.
    //
    // `preferred` pins specific sections when the caller already knows which
    // one it wants; without it selectMultiAware takes the first available,
    // which is the long-standing behaviour and stays the default.
    let pickedWorkSections = [];
    if (data.workSectionCount) {
      pickedWorkSections = await this.selectMultiAware(this.workSectionDropdown, {
        count: data.workSectionCount,
        preferred: data.preferredWorkSections || [],
      });
    }

    if (data.ncQuantity != null) {
      await this.ncQuantityInput.waitFor({ state: 'visible' });
      await this.ncQuantityInput.click({ clickCount: 3 });
      await this.ncQuantityInput.pressSequentially(String(data.ncQuantity), { delay: 40 });
      await this.page.keyboard.press('Tab');
    }

    await pick(this.unitDropdown, data.unit);

    if (data.ncDescription) {
      await this.ncDescriptionInput.waitFor({ state: 'visible' });
      await this.ncDescriptionInput.click({ clickCount: 3 });
      await this.ncDescriptionInput.pressSequentially(data.ncDescription, { delay: 20 });
    }

    // Not a truthiness check: index 0 (the bulk spec's first NC) is a valid
    // Defect Type choice now.
    if (data.defectType != null && data.defectType !== '') {
      await this.selectDefectType(data.defectType);
    }

    await pick(this.categoryDropdown, data.category);

    // May already be auto-filled from the Defect Type — see selectTargetDateIfEmpty.
    if (data.targetDateClosureDays != null) {
      await this.selectTargetDateIfEmpty(data.targetDateClosureDays);
    }

    if (data.debitAmount != null) {
      await this.debitAmountInput.waitFor({ state: 'visible' });
      await this.debitAmountInput.click({ clickCount: 3 });
      await this.debitAmountInput.pressSequentially(String(data.debitAmount), { delay: 40 });
      await this.page.keyboard.press('Tab');
    }

    if (data.capturePhoto !== false) {
      await this.capturePhoto();
    }

    return pickedWorkSections;
  }

  async clickSubmit() {
    await this.submitButton.waitFor({ state: 'visible' });
    await this.submitButton.click();
  }

  // The form's own "Draft" button — the EXPLICIT save path, as opposed to
  // the app autosaving because the user navigated away mid-fill. Added
  // 2026-09-05 for 32_nc_draft_autosave.spec.js; `saveDraftButton` had been
  // declared in this constructor since the page object was written but
  // nothing ever clicked it.
  //
  // Deliberately does NOT assert where it lands: whether clicking Draft
  // navigates away by itself or leaves the form open is unconfirmed for NC
  // (it is unconfirmed for RFI too — see RFICreatePage.clickSaveDraft, which
  // this mirrors). Callers reset their own navigation afterwards.
  async clickSaveDraft() {
    await this.saveDraftButton.waitFor({ state: 'visible' });
    await this.saveDraftButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  // Confirmed live: clicking Submit shows an "Are you sure you want to
  // submit NC?" dialog with Cancel/Submit buttons. Use getByRole('dialog')
  // (accessibility-tree based) rather than a CSS `[role="dialog"]`
  // attribute selector — this dialog's role is computed/implicit, not a
  // literal DOM attribute, so the CSS selector never matched it and the
  // button lookup inside it hung until timeout.
  async confirmSubmitIfPopup() {
    const popup = this.page.getByRole('dialog').filter({ hasText: /sure/i }).first();
    if (await popup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await popup.getByRole('button', { name: 'Submit' }).click();
    }
  }

  async submitNC() {
    await this.clickSubmit();
    await this.confirmSubmitIfPopup();
    // Confirmed live: NC's post-submit destination is /my-tasks/nc/<uuid> —
    // no /view suffix, unlike RFI's /rfi/<id>/view. Wait for genuine arrival
    // there rather than a fixed settle timeout, so a submit that never
    // actually completes throws for real instead of silently continuing.
    await this.page.waitForURL(/\/my-tasks\/nc\/[a-f0-9-]+$/i, { timeout: 60000 });
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = NCCreatePage;
