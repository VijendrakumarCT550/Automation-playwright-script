const { BasePage } = require('./BasePage');

class RFIChecklistPage extends BasePage {
  constructor(page) {
    super(page);
    this.submitButton    = page.locator('button:has-text("Submit")').first();
    this.saveDraftButton = page.locator('button:has-text("Draft")').first();

    // Popup: <p>Are you sure you want to submit RFI?</p>
    //   Confirm: <button type="submit" form="rfi-form">Submit</button>
    //   Cancel:  <button type="button" class="...destructive...">Cancel</button>
    this.confirmPopup     = page.locator('[role="dialog"], [data-scope="dialog"]')
      .filter({ hasText: /submit RFI/i }).first();
    this.confirmYesButton = page.locator('button[type="submit"][form="rfi-form"]').first();
    this.confirmNoButton  = page.locator('[role="dialog"] button[type="button"]:has-text("Cancel"), [data-scope="dialog"] button[type="button"]:has-text("Cancel")').first();
  }

  async _dismissDialogIfOpen() {
    const dialog = this.page.locator('[data-scope="dialog"][data-state="open"]');
    if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await this.page.waitForTimeout(500);
    }
  }

  async fillAllObservations(value = 'OK', incrementSuffix = false) {
    // Dismiss any dialog that auto-opened on the checklist page
    await this._dismissDialogIfOpen();

    // Click the expand-all button (Lucide square-plus SVG icon, no text content)
    const plusBtn = this.page.locator('button:has(svg.lucide-square-plus)').first();
    if (await plusBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
      await plusBtn.click();
      await this.page.waitForTimeout(2000);
    } else {
      // Fallback: expand accordion items one by one.
      // Must use :not([data-disabled]) — disabled form-field dropdowns on page 2
      // also have data-state="closed" and would be clicked first otherwise.
      for (let attempt = 0; attempt < 30; attempt++) {
        const closed = this.page.locator('button[data-state="closed"]:not([data-disabled])').first();
        if (!await closed.isVisible({ timeout: 500 }).catch(() => false)) break;
        await closed.click();
        await this.page.waitForTimeout(300);
      }
    }

    // Observation inputs have label "Observation/Measured Value" with for/id linkage
    // (no placeholder attribute). getByLabel resolves the label→input association.
    const inputs = this.page.getByLabel('Observation/Measured Value');
    await inputs.first().waitFor({ state: 'visible', timeout: 15000 });
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const input = inputs.nth(i);
      if (await input.isVisible().catch(() => false)) {
        await input.scrollIntoViewIfNeeded();
        await input.click({ clickCount: 3 });
        const filledValue = incrementSuffix ? `${value} ${i + 1}` : value;
        await input.pressSequentially(filledValue, { delay: 3 });
        await this.page.keyboard.press('Tab');
      }
    }
  }

  async clickSubmit() {
    await this.submitButton.waitFor({ state: 'visible' });
    await this.submitButton.click();
  }

  async confirmSubmit() {
    await this.confirmPopup.waitFor({ state: 'visible', timeout: 10000 });
    await this.confirmYesButton.click();
    // networkidle alone isn't a reliable "submit actually finished" signal —
    // confirmed via screenshot that the confirm button can still show its
    // loading spinner (mid-submit) after networkidle already resolved, so
    // the URL hadn't moved on yet. Wait for that explicitly.
    //
    // Two bugs fixed here (user-confirmed live: this let a resubmit that
    // never actually went through get recorded as successful, with the
    // version badge silently unchanged):
    //  1. The old check was `!url.includes('/create')` — true for the
    //     RESUBMIT flow from the very first instant, since /re-submit never
    //     contains "/create" at all. It never actually waited for anything
    //     on resubmit. Checking for arrival at /view (the real post-submit
    //     destination for BOTH create and resubmit, confirmed by
    //     createNewRfi's own id-extraction regex) is the correct, positive
    //     signal for either flow.
    //  2. The wait was wrapped in .catch(() => {}), silently swallowing a
    //     genuine failure — the exact false-positive class of bug already
    //     called out in RFIReviewPage._waitForPopupToClose's comments, just
    //     not applied here. Let a real timeout throw for real: the caller
    //     (resubmitRfi/createNewRfi) must NOT read a version badge or record
    //     success after a submit that never actually completed.
    //
    // Timeout widened 30s -> 60s — confirmed live: a resubmit can actually
    // succeed server-side (new child record created, visible pending with
    // EE) while still taking longer than 30s for the browser to redirect,
    // which threw a false failure here even though the real problem was
    // just "not patient enough," not a broken submit.
    await this.page.waitForURL(/\/rfi\/[a-f0-9-]+\/view/i, { timeout: 60000 });
    await this.page.waitForLoadState('networkidle');
  }

  async cancelSubmit() {
    await this.confirmPopup.waitFor({ state: 'visible', timeout: 10000 });
    await this.confirmNoButton.click();
  }

  async submitRFI() {
    await this.clickSubmit();
    await this.confirmSubmit();
  }
}

module.exports = RFIChecklistPage;
