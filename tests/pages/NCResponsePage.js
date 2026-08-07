const { BasePage } = require('./BasePage');

// Covers the Contractor In-Charge's "Contractor Response" section on
// /my-tasks/nc/<uuid> — the SAME URL NCReviewPage uses, since the backend
// renders different content/actions on this one page depending on the
// logged-in role and the NC's current status (confirmed live: CI sees empty
// Root Cause/Corrective Actions inputs + Submit when status is "Raised";
// EE/QI see the same two fields read-only + an OK/Not-Ok toggle + Review).
//
// Root Cause + Corrective Actions are BOTH required the first time (fresh
// NC, status "Raised"); after a reject, CI's job is to modify them, but per
// the app owner modification itself is optional — filling fresh text either
// way satisfies both cases, so one method covers both the initial response
// and every later resubmit.
class NCResponsePage extends BasePage {
  constructor(page) {
    super(page);

    // Confirmed live via DOM dump: these are the only two inputs on the
    // whole page, with NO placeholder, aria-label, or name — the "Root
    // Cause */Corrective Actions *" text is just an unlinked adjacent label
    // (same broken-label pattern seen elsewhere in this app, e.g. User
    // Management's Vendor field). Position is the only reliable way to
    // target them. NOT `input[type="text"]` — the dump's "type": "text"
    // came from reading the JS property (which defaults to "text" for ANY
    // <input> even with no type attribute at all), not a literal HTML
    // attribute, so that CSS attribute selector matched nothing and hung
    // until timeout; plain tag+position is what actually matches.
    this.rootCauseInput         = page.locator('input').nth(0);
    this.correctiveActionsInput = page.locator('input').nth(1);
    this.submitButton           = page.getByRole('button', { name: 'Submit' }).first();
  }

  async goto(ncId) {
    await this.page.goto(`${process.env.BASE_URL}/my-tasks/nc/${ncId}`);
    await this.page.waitForLoadState('networkidle');
  }

  async fillResponse({ rootCause, correctiveActions }) {
    await this.rootCauseInput.waitFor({ state: 'visible' });
    await this.rootCauseInput.click({ clickCount: 3 });
    await this.rootCauseInput.pressSequentially(rootCause, { delay: 20 });

    await this.correctiveActionsInput.waitFor({ state: 'visible' });
    await this.correctiveActionsInput.click({ clickCount: 3 });
    await this.correctiveActionsInput.pressSequentially(correctiveActions, { delay: 20 });
  }

  // Same confirm-dialog shape as NCCreatePage's submit — getByRole('dialog')
  // (accessibility-tree based), not a CSS [role="dialog"] attribute selector,
  // which was already confirmed live not to match this app's dialogs.
  async confirmSubmitIfPopup() {
    const popup = this.page.getByRole('dialog').filter({ hasText: /sure/i }).first();
    if (await popup.isVisible({ timeout: 5000 }).catch(() => false)) {
      await popup.getByRole('button', { name: /submit|yes|confirm/i }).first().click();
    }
  }

  async submitResponse() {
    await this.submitButton.click();
    await this.confirmSubmitIfPopup();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
  }
}

module.exports = NCResponsePage;
