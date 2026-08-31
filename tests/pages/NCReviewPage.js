const { BasePage } = require('./BasePage');

// Covers EE/QI's review of an NC on /my-tasks/nc/<uuid> — same URL as
// NCResponsePage (see its header comment). Unlike RFI, NC has only ONE
// reject mechanism (confirmed live by the app owner: "in NC we dont have
// multiple page rejection its only one page rejection") — a single "Select
// Inspection Status: OK / Not Ok" toggle, then a "Review" button (not
// "Submit" — that label is CI's, on the response page). QI's review page
// is confirmed identical in mechanics to EE's; both use this one class.
//
// Per app change: Capture Photo and an "I confirm that the check has been
// conducted for the entire Work Area" acknowledgement checkbox are now
// BOTH mandatory on every review — approve or reject alike. Remarks stay
// reject-only (unchanged).
class NCReviewPage extends BasePage {
  constructor(page) {
    super(page);

    this.okRadio    = page.getByRole('radio', { name: 'OK', exact: true });
    this.notOkRadio = page.getByRole('radio', { name: 'Not Ok' });
    // Same placeholder already confirmed for RFI's reject-remarks field —
    // a shared component reused app-wide, not guessed independently for NC.
    this.remarksInput  = page.getByPlaceholder('Type your comments here').first();
    // Newly mandatory (per app change), on BOTH approve and reject — "I
    // confirm that the check has been conducted for the entire Work Area."
    // BUG FOUND LIVE (user caught it via screenshots — see
    // project_nc_ack_checkbox_bug memory): force-clicking the native
    // <input type="checkbox"> directly (the getByRole('checkbox') target,
    // same approach that works for the OK/Not-Ok radios) did NOT actually
    // toggle it — the box stayed visually unchecked and Review submission
    // was silently blocked by client-side validation, while
    // _waitForReviewToComplete's swallowed timeout let the caller think it
    // succeeded anyway. This app's checkbox anatomy (Zag.js) is root(a
    // <label for="...">) > control (visible box) + hiddenInput as
    // SIBLINGS — clicking the ROOT LABEL is what actually works (confirmed
    // live: input.checked false->true, data-state unchecked->checked), and
    // needs no force since the label itself is genuinely visible/clickable,
    // unlike the radios' bare hidden input.
    this.acknowledgeCheckbox = page.locator('[data-scope="checkbox"][data-part="root"]')
      .filter({ hasText: /entire Work Area/i });
    this.reviewButton  = page.getByRole('button', { name: 'Review' }).first();
  }

  async goto(ncId) {
    await this.page.goto(`${process.env.BASE_URL}/my-tasks/nc/${ncId}`);
    await this.page.waitForLoadState('networkidle');
  }

  // Clicks the acknowledgement checkbox and verifies it actually toggled
  // (via the root's data-state attribute) before returning — so a future
  // regression of the bug documented above fails loudly right here, not
  // silently 20s later at _waitForReviewToComplete.
  async checkAcknowledgement() {
    await this.acknowledgeCheckbox.click();
    const state = await this.acknowledgeCheckbox.getAttribute('data-state').catch(() => null);
    if (state !== 'checked') {
      throw new Error(`Acknowledgement checkbox did not toggle to checked (data-state="${state}")`);
    }
  }

  async confirmIfPopup() {
    const popup = this.page.getByRole('dialog').filter({ hasText: /sure/i }).first();
    if (await popup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await popup.getByRole('button', { name: /review|submit|yes|confirm/i }).first().click();
    }
  }

  // BUG FOUND LIVE: this used to swallow the "Review button never hides"
  // timeout with a bare .catch(() => {}), treating a BLOCKED submission
  // (client-side validation error, e.g. the ack-checkbox bug above) as
  // silent success — the caller (nc-flow-turns.js) would then advance the
  // tracker past this step even though the record was never actually
  // reviewed. Now throws for real when the button never hides, so a
  // genuine failure surfaces as a failed TC with a diagnosable reason
  // instead of corrupting tracker state.
  async _waitForReviewToComplete() {
    const submitted = await this.reviewButton.waitFor({ state: 'hidden', timeout: 20000 })
      .then(() => true).catch(() => false);
    if (!submitted) {
      const errorText = await this.page.locator('text=/required|error/i').first().innerText().catch(() => null);
      throw new Error(
        `NC review did not submit — Review button still visible 20s after clicking.`
        + (errorText ? ` Possible cause: "${errorText}"` : '')
      );
    }
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
  }

  async approve() {
    // force:true — same custom-radio pattern already confirmed for RFI
    // (the real <input> is visually covered by a sibling styled control).
    await this.okRadio.click({ force: true });
    // Capture Photo + the acknowledgement checkbox are both newly
    // mandatory on approve, not just reject.
    await this.capturePhoto();
    await this.checkAcknowledgement();
    await this.reviewButton.click();
    await this.confirmIfPopup();
    await this._waitForReviewToComplete();
  }

  async reject(remarks) {
    await this.notOkRadio.click({ force: true });
    await this.remarksInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.remarksInput.fill(remarks);
    // Capture Photo + acknowledgement checkbox are mandatory here too —
    // same as approve() (see there for the "not yet live-confirmed"
    // caveat on acknowledgeCheckbox's selector).
    await this.capturePhoto();
    await this.checkAcknowledgement();
    await this.reviewButton.click();
    await this.confirmIfPopup();
    await this._waitForReviewToComplete();
  }
}

module.exports = NCReviewPage;
