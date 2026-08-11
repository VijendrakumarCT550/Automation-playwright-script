const { BasePage } = require('./BasePage');

// Covers the EE/QI "review" view of a single RFI.
//
// 09/10 (the real RFI-flow regression) reach this page through the UI — My
// Tasks -> "Pending with me" tile -> find the row by its visible code ->
// click its eye icon — via tests/utils/rfi-nav.js's openFromPendingWithMe(),
// not this class's own goto() below. EE/QI never read or discover the
// visible code themselves; CI captures it for every TC right after
// creating/resubmitting (see 08_rfi_flow_ci.spec.js's backfillRfiCodes),
// in the same CI login session, well before EE/QI's turn. goto() is kept
// for other callers (inspector scripts, ad-hoc debugging) that want a
// direct jump to a known id without caring about list navigation.
//
// Unlike CI's create/resubmit flow, the checklist questions are visible
// immediately (collapsed) — no separate "Proceed" step is needed to reach
// them. Same page structure and same reject/approve mechanics apply to both
// EE and QI (confirmed by the app owner — "same way of rejection for QI").
//
// Two distinct reject paths, mutually exclusive per rejection:
//  - Page 1 reject: "Reject RFI" button -> popup with required Remarks ->
//    "Reject" button.
//  - Checklist (page 2) reject: flip >=1 checklist item from "Ok" to
//    "Not Ok" (each Not Ok item then requires its own Remark) -> "Submit"
//    button (the same button used to approve) -> confirm popup "Are you
//    sure you want to reject RFI?" -> "Submit" in that popup.
// Approving (leaving every item "Ok", clicking "Submit") shows "Are you
// sure you want to approve RFI?" with the same Submit/Cancel shape.
class RFIReviewPage extends BasePage {
  constructor(page) {
    super(page);

    // Same expand-all icon as RFIChecklistPage uses during creation.
    this.expandAllButton = page.locator('button:has(svg.lucide-square-plus)').first();

    this.rejectRfiButton = page.getByRole('button', { name: 'Reject RFI' });
    // The bottom "Submit" button doubles as approve (all Ok) or triggers a
    // reject-confirm (>=1 Not Ok) depending on checklist state.
    this.submitButton = page.getByRole('button', { name: 'Submit' }).first();

    // "Reject RFI" popup (Page 1 reject). NOTE the trailing .first() — both
    // the dialog's "positioner" wrapper and its "content" div carry
    // data-scope="dialog", so without it this resolves to 2 elements and
    // throws a strict-mode violation the instant it's waited on (confirmed
    // live: this exact bug silently ate an EE approval — the real confirm
    // popup appeared in the browser but the test errored out before it
    // could click Submit inside it, leaving the RFI stuck pending).
    this.rejectPopup = page.locator('[role="dialog"], [data-scope="dialog"]')
      .filter({ hasText: 'Reject RFI Details' }).first();
    this.rejectRemarksInput = this.rejectPopup.locator('input, textarea').first();
    this.rejectPopupButton = this.rejectPopup.getByRole('button', { name: 'Reject' });

    // Generic "Are you sure...?" confirm popup — shared shape for both the
    // approve confirmation and the checklist-reject confirmation. The
    // action already taken (left everything Ok vs marked something Not Ok)
    // determines which one appears; the click target is the same either way.
    this.confirmPopup = page.locator('[role="dialog"], [data-scope="dialog"]')
      .filter({ hasText: /are you sure/i }).first();
    this.confirmSubmitButton = this.confirmPopup.getByRole('button', { name: 'Submit' });
    this.confirmCancelButton = this.confirmPopup.getByRole('button', { name: 'Cancel' });
  }

  async goto(rfiId) {
    await this.page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/view`);
    await this.page.waitForLoadState('networkidle');
  }

  async expandAllChecklist() {
    if (await this.expandAllButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await this.expandAllButton.click();
      await this.page.waitForTimeout(1000);
    }
  }

  // networkidle alone is NOT a reliable "the action actually finished and
  // persisted" signal here — confirmed live: approving, then moving on right
  // after networkidle resolved, left the RFI still showing as pending with
  // the reviewer (the approval hadn't actually gone through). Wait for the
  // given popup to actually close — and let that throw for real if it
  // doesn't, rather than swallowing the timeout, since a popup that never
  // closes means the action didn't take effect and the tracker must NOT be
  // advanced to "done" on a false positive (confirmed live: an earlier
  // version of this method used .catch(() => {}) here and let a QI approval
  // that silently failed get recorded as successful).
  async _waitForPopupToClose(popup) {
    await popup.waitFor({ state: 'hidden', timeout: 20000 });
    await this.submitButton.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(3000);
  }

  async approve() {
    await this.submitButton.click();
    await this.confirmPopup.waitFor({ state: 'visible', timeout: 10000 });
    await this.confirmSubmitButton.click();
    await this._waitForPopupToClose(this.confirmPopup);
  }

  async rejectFromFirstPage(remarks) {
    await this.rejectRfiButton.click();
    await this.rejectPopup.waitFor({ state: 'visible', timeout: 10000 });
    await this.rejectRemarksInput.fill(remarks);
    await this.rejectPopupButton.click();
    await this._waitForPopupToClose(this.rejectPopup);
  }

  async rejectFromChecklistPage(remarks) {
    await this.expandAllChecklist();
    const notOkRadio = this.page.getByRole('radio', { name: 'Not Ok' }).first();
    // force:true — confirmed live: this radio group's real <input> is
    // visually covered by a sibling styled `[data-part="item-control"]` div
    // (a standard custom-radio pattern), so a plain click keeps finding that
    // div "intercepting pointer events" at the input's own coordinates and
    // retries forever (30s timeout, never resolves — it's a permanent
    // layout property, not a transient state). Playwright's own
    // actionability checks otherwise pass (visible/enabled/stable), so
    // forcing through this specific check is safe here.
    await notOkRadio.click({ force: true });
    const remarkInput = this.page.getByPlaceholder('Type your comments here').first();
    await remarkInput.waitFor({ state: 'visible', timeout: 5000 });
    await remarkInput.fill(remarks);
    await this.submitButton.click();
    await this.confirmPopup.waitFor({ state: 'visible', timeout: 10000 });
    await this.confirmSubmitButton.click();
    await this._waitForPopupToClose(this.confirmPopup);
  }
}

module.exports = RFIReviewPage;
