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
    this.defectTypeInput    = page.getByPlaceholder('Enter Defect Type');
    this.categoryDropdown   = page.getByRole('combobox', { name: /Category/i }).first();
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
  async _selectScrollableOption(dropdown, optionText) {
    const listbox = await this.openDropdown(dropdown);
    const option = listbox.locator('[role="option"]').filter({ hasText: optionText }).first();
    if (!(await option.isVisible({ timeout: 2000 }).catch(() => false))) {
      await listbox.hover();
      await this.page.mouse.wheel(0, -10000);
    }
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    await this.page.waitForTimeout(300);
  }

  // NC Quantity is only required when the selected Unit is NOT "Not
  // Applicable (NA)" — caller signals this by simply omitting ncQuantity
  // (and passing a unit like 'NA') vs providing both.
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

    if (data.workSectionCount) {
      await this.selectMultiAware(this.workSectionDropdown, { count: data.workSectionCount });
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

    if (data.defectType) {
      await this.defectTypeInput.waitFor({ state: 'visible' });
      await this.defectTypeInput.click({ clickCount: 3 });
      await this.defectTypeInput.pressSequentially(data.defectType, { delay: 20 });
    }

    await pick(this.categoryDropdown, data.category);

    if (data.debitAmount != null) {
      await this.debitAmountInput.waitFor({ state: 'visible' });
      await this.debitAmountInput.click({ clickCount: 3 });
      await this.debitAmountInput.pressSequentially(String(data.debitAmount), { delay: 40 });
      await this.page.keyboard.press('Tab');
    }
  }

  async clickSubmit() {
    await this.submitButton.waitFor({ state: 'visible' });
    await this.submitButton.click();
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
