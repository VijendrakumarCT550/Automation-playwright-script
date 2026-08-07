const { BasePage } = require('./BasePage');

// Covers EE/QI's review of an NC on /my-tasks/nc/<uuid> — same URL as
// NCResponsePage (see its header comment). Unlike RFI, NC has only ONE
// reject mechanism (confirmed live by the app owner: "in NC we dont have
// multiple page rejection its only one page rejection") — a single "Select
// Inspection Status: OK / Not Ok" toggle, then a "Review" button (not
// "Submit" — that label is CI's, on the response page). QI's review page
// is confirmed identical in mechanics to EE's; both use this one class.
class NCReviewPage extends BasePage {
  constructor(page) {
    super(page);

    this.okRadio    = page.getByRole('radio', { name: 'OK', exact: true });
    this.notOkRadio = page.getByRole('radio', { name: 'Not Ok' });
    // Same placeholder already confirmed for RFI's reject-remarks field —
    // a shared component reused app-wide, not guessed independently for NC.
    this.remarksInput  = page.getByPlaceholder('Type your comments here').first();
    this.reviewButton  = page.getByRole('button', { name: 'Review' }).first();
  }

  async goto(ncId) {
    await this.page.goto(`${process.env.BASE_URL}/my-tasks/nc/${ncId}`);
    await this.page.waitForLoadState('networkidle');
  }

  async confirmIfPopup() {
    const popup = this.page.getByRole('dialog').filter({ hasText: /sure/i }).first();
    if (await popup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await popup.getByRole('button', { name: /review|submit|yes|confirm/i }).first().click();
    }
  }

  async _waitForReviewToComplete() {
    await this.reviewButton.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
  }

  async approve() {
    // force:true — same custom-radio pattern already confirmed for RFI
    // (the real <input> is visually covered by a sibling styled control).
    await this.okRadio.click({ force: true });
    await this.reviewButton.click();
    await this.confirmIfPopup();
    await this._waitForReviewToComplete();
  }

  async reject(remarks) {
    await this.notOkRadio.click({ force: true });
    await this.remarksInput.waitFor({ state: 'visible', timeout: 5000 });
    await this.remarksInput.fill(remarks);
    await this.reviewButton.click();
    await this.confirmIfPopup();
    await this._waitForReviewToComplete();
  }
}

module.exports = NCReviewPage;
