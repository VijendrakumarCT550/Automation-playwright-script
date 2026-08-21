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

  // --- Read-back for data-integrity checks (23_rfi_data_integrity.spec.js) ---
  //
  // Confirmed live: this page renders as plain label-then-value text, NOT
  // a queryable dt/dd or label+sibling DOM shape — a generic `label` /
  // `dt+dd` query mostly matched irrelevant radio-button pairs ("Ok"/"Not
  // Ok", "Capture Photo"/"Use Camera") instead of the real fields. Reading
  // the whole page's visible text and walking it line-by-line is what
  // actually works: every real field is a label line immediately followed
  // by its value line.
  //
  // The one wrinkle: an EMPTY field renders two different ways depending
  // on which field it is — Quantity/Unit render the literal placeholder
  // "-", but Sub-Contractor Name renders NOTHING (the very next line is
  // already the next field's label). KNOWN_LABELS lets _fieldAfter tell
  // the difference: if the line right after a label IS itself another
  // known label, the field in between is empty, not "whatever text
  // happened to be next."
  static KNOWN_LABELS = [
    'Project Name', 'Work Location', 'Work Area', 'Contractor Name',
    'Sub-Contractor Name', 'Service Order', 'Package', 'Sub-Package',
    'Activity', 'Sub-Activity', 'Quantity', 'Unit of Measurement',
    'Inspection Checkpoint', 'Inspection Checklist',
  ];

  async _visibleLines() {
    const text = await this.page.locator('body').innerText();
    return text.split('\n').map(l => l.trim()).filter(Boolean);
  }

  _isLabelLine(line) {
    return RFIReviewPage.KNOWN_LABELS.includes(line) || /^Work Section\b/.test(line);
  }

  // Returns the value for `label`, or null if the field is empty (the next
  // line is itself another label) or the label isn't present at all.
  _fieldAfter(lines, label) {
    const idx = lines.indexOf(label);
    if (idx === -1) return null;
    const next = lines[idx + 1];
    if (next === undefined || this._isLabelLine(next)) return null;
    return next;
  }

  async getFieldValue(label) {
    return this._fieldAfter(await this._visibleLines(), label);
  }

  // Work Section's label isn't a fixed string — it's "Work Section - ( N )
  // *" where N is however many sections are selected — so it needs its own
  // regex-based lookup rather than KNOWN_LABELS' exact match.
  async getWorkSectionValue() {
    const lines = await this._visibleLines();
    const idx = lines.findIndex(l => /^Work Section\b/.test(l));
    if (idx === -1) return null;
    const next = lines[idx + 1];
    return next === undefined || this._isLabelLine(next) ? null : next;
  }

  // Every checklist item repeats the same "Observation/Measured Value"
  // label — collect ALL of them, in the order they appear (matches
  // RFIChecklistPage.fillAllObservations()'s per-item fill order).
  async getAllObservationValues() {
    const lines = await this._visibleLines();
    const values = [];
    lines.forEach((line, i) => {
      if (line === 'Observation/Measured Value') values.push(lines[i + 1] ?? null);
    });
    return values;
  }

  // Convenience: every field this data-integrity spec cares about, in one
  // read (one single innerText() call, not one per field). Deliberately
  // excludes Project Name (fixed/global) — not useful to compare against
  // anything.
  async readAllFields() {
    const lines = await this._visibleLines();
    const field = label => this._fieldAfter(lines, label);

    const workSectionIdx = lines.findIndex(l => /^Work Section\b/.test(l));
    const workSectionNext = workSectionIdx === -1 ? undefined : lines[workSectionIdx + 1];
    const workSection = workSectionNext === undefined || this._isLabelLine(workSectionNext)
      ? null : workSectionNext;

    const observations = [];
    lines.forEach((line, i) => {
      if (line === 'Observation/Measured Value') observations.push(lines[i + 1] ?? null);
    });

    return {
      workLocation: field('Work Location'),
      workArea: field('Work Area'),
      contractorName: field('Contractor Name'),
      subContractor: field('Sub-Contractor Name'),
      serviceOrder: field('Service Order'),
      package: field('Package'),
      subPackage: field('Sub-Package'),
      activity: field('Activity'),
      subActivity: field('Sub-Activity'),
      quantity: field('Quantity'),
      unit: field('Unit of Measurement'),
      inspectionCheckpoint: field('Inspection Checkpoint'),
      inspectionChecklist: field('Inspection Checklist'),
      workSection,
      observations,
    };
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
