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
  async _openDropdown(trigger) {
    await trigger.waitFor({ state: 'visible' });
    await trigger.click();

    const listbox = this.page.locator('[role="listbox"][data-state="open"]');
    if (!(await listbox.isVisible({ timeout: 2000 }).catch(() => false))) {
      await trigger.press('Space');
    }
    await listbox.waitFor({ state: 'visible', timeout: 8000 });
    return listbox;
  }

  async selectOption(dropdown, optionText) {
    const listbox = await this._openDropdown(dropdown);
    // Options are plain <div role="option"> elements — not <a> links, safe to click.
    // filter({ hasText }) is a plain substring match, safe for special chars like ()+
    const option = listbox.locator('[role="option"]').filter({ hasText: optionText }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    await this.page.waitForTimeout(300);
  }

  async selectFirstAvailable(dropdown) {
    const listbox = await this._openDropdown(dropdown);
    const first = listbox.locator('[role="option"]').first();
    await first.waitFor({ state: 'visible', timeout: 5000 });
    await first.click();
    await this.page.waitForTimeout(30);
  }

  async selectWorkSection() {
    const listbox = await this._openDropdown(this.workSectionToggle);
    const first = listbox.locator('[role="option"]').first();
    await first.waitFor({ state: 'visible', timeout: 5000 });
    await first.click();
    // Multi-select combobox stays open after selection.
    // Click the toggle button again to close it.
    // DO NOT press Escape — the form's Escape handler navigates back to My Tasks.
    await this.workSectionToggle.click();
    await this.page.locator('[role="listbox"][data-state="open"]')
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
    await this.page.waitForTimeout(30);
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
    await this.selectWorkSection();
  }

  async clickProceed() {
    await this.proceedButton.waitFor({ state: 'visible' });
    await this.proceedButton.click();
    // "Answer all the questions" is the heading of the checklist panel on page 2.
    // It appears ONLY after a successful Proceed navigation, not during page-1 validation.
    await this.page.locator('text=Answer all the questions')
      .waitFor({ state: 'visible', timeout: 30000 });
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
