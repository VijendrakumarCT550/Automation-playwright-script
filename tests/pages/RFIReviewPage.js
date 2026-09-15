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

    // "Reject RFI" popup (Page 1 reject).
    //
    // BOTH popup locators below are scoped to data-part="content", and that
    // matters far more than it looks. Ark UI mounts THREE elements per dialog —
    // positioner, content, title — and the POSITIONER also carries
    // data-scope="dialog" while having NO role attribute. Only the CONTENT gets
    // `hidden` + data-state="closed" when the dialog closes; the positioner is a
    // permanently-mounted full-viewport container (pointer-events: none) that
    // Playwright therefore considers VISIBLE AT ALL TIMES.
    //
    // An earlier version selected '[role="dialog"], [data-scope="dialog"]' and
    // took .first() to dodge the strict-mode violation — but .first() IS the
    // positioner, i.e. precisely the wrong one of the two. Measured live at a
    // mobile viewport (2026-09-01, tests/fixtures/mobile-dom-recon 54/55/56):
    //   before opening : positioner present and "visible", content absent
    //   popup OPEN     : content data-state="open",   no hidden attribute
    //   popup DISMISSED: content data-state="closed" + hidden=""
    // So waitFor({ state: 'visible' }) resolved INSTANTLY whether or not the
    // popup had actually opened (asserting nothing at all), and
    // waitFor({ state: 'hidden' }) could never resolve.
    //
    // The same trap is documented in DashboardFilterPage.js, and it is what made
    // 00_inspect_rfi_cancel_confirm_releases_section.spec.js wrongly conclude that
    // Cancel+confirm does not release a Work Section — see the SUPERSEDED note in
    // docs/rfi-activity-dependency-chain.md.
    this.rejectPopup = page.locator('[role="dialog"], [data-scope="dialog"][data-part="content"]')
      .filter({ hasText: 'Reject RFI Details' }).first();
    this.rejectRemarksInput = this.rejectPopup.locator('input, textarea').first();
    this.rejectPopupButton = this.rejectPopup.getByRole('button', { name: 'Reject' });

    // Generic "Are you sure...?" confirm popup — shared shape for both the
    // approve confirmation and the checklist-reject confirmation. The
    // action already taken (left everything Ok vs marked something Not Ok)
    // determines which one appears; the click target is the same either way.
    //
    // MOUNTING DIFFERS PER DIALOG in this app, which is why some popup waits
    // used to be silently meaningless while others happened to work:
    //   * mounted ONLY WHILE OPEN — this approve/reject confirm. It detaches on
    //     close, so both the visible and hidden waits behaved correctly even
    //     before the positioner bug above was fixed.
    //   * PERMANENTLY MOUNTED — the "Reject RFI Details" popup above, and the
    //     create page's "Cancel RFI" / "submit RFI" confirms. Their positioners
    //     sit in the DOM from first render (measured live: mobile-dom-recon
    //     screen 54 shows the reject positioner present before anything was
    //     clicked, and screen 03 shows both create-page confirms present on an
    //     untouched form), so a wait against the positioner resolved instantly
    //     and proved nothing.
    // Do not assume either behaviour for a NEW dialog — check it, and always
    // scope to data-part="content" so the wait keys off `hidden` either way.
    this.confirmPopup = page.locator('[role="dialog"], [data-scope="dialog"][data-part="content"]')
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

  // MOBILE SPLITS THE REVIEW ACROSS TWO SCREENS. Confirmed by screenshot
  // 2026-09-01: at a phone viewport the review page is "Page 1 of 2" — RFI
  // Details with Close / Reject RFI / PROCEED and NO Submit button at all. The
  // checklist and its Submit live on page 2, reached via Proceed. Desktop renders
  // both panes at once and has Submit on the same screen, which is why the
  // original single-click version worked there.
  //
  // Without this, EE's approval died on a 30s wait for a Submit button that does
  // not exist on mobile page 1.
  // Gets us onto the screen that actually holds the checklist and the Submit
  // button, whichever viewport we are on. Returns true if it had to navigate.
  //
  // CONFIRMED LIVE (mobile-dom-recon screen 54): mobile review page 1 offers
  // only Close / Reject RFI / Proceed — no Submit button and no checklist radios
  // at all. Desktop renders both panes on one screen, so this is a no-op there.
  //
  // Needed by BOTH approve() and rejectFromChecklistPage(): the "Not Ok" radios
  // a checklist rejection depends on live on page 2 alongside Submit.
  async _ensureChecklistPage() {
    if (await this.submitButton.isVisible().catch(() => false)) return false;

    const proceed = this.page.getByRole('button', { name: /^\s*proceed\s*$/i }).first();
    if (!(await proceed.isVisible().catch(() => false))) return false;

    await proceed.click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.submitButton.waitFor({ state: 'visible', timeout: 20000 });
    return true;
  }

  // Public form of the hop above. A caller that needs to TOUCH the checklist
  // before approving — clearing carried-over "Not Ok" marks, say — has to get
  // onto the right screen first, or it silently operates on mobile page 1,
  // which has no checklist radios at all, and reports a confident zero.
  async goToChecklistPage() {
    return this._ensureChecklistPage();
  }

  async approve() {
    // Expand AFTER the hop — a caller that expanded before approve() was
    // looking at page 1, where there is nothing to expand.
    if (await this._ensureChecklistPage()) {
      await this.expandAllChecklist().catch(() => {});
    }

    await this.submitButton.click();

    // A bare waitFor here reported only "locator resolved to hidden ... 23x",
    // which says the dialog never opened but not WHY — and the why IS on screen,
    // in a toast or an unfilled required field. CONFIRMED LIVE (2026-09-01, wind
    // mobile on the OGL Checklist): Submit SILENTLY NO-OPS when a checklist item
    // has an empty mandatory "Capture Photo" box, so this wait just burned its
    // timeout and blamed the dialog.
    //
    // Deliberately a try/catch around the SAME wait rather than a race against
    // the toast: a lingering unrelated toast could otherwise win a race and make
    // a perfectly good approval look like a failure. This only enriches the
    // error, so no working path changes behaviour.
    try {
      await this.confirmPopup.waitFor({ state: 'visible', timeout: 15000 });
    } catch (firstMiss) {
      // ONE retry after a settle, because a Submit click can simply not register
      // on a form that is not fully ready yet — no toast, no dialog, nothing.
      //
      // HISTORY, so nobody re-derives the wrong conclusion: this presented on
      // wind's OGL Checklist, where EE's review page also showed five empty
      // "Capture Photo" boxes. I inferred the photos were mandatory, filled
      // them, and Submit then worked — but the app owner disproved that by
      // approving the SAME checklist manually with "No photos added" on every
      // item. The photos were never the cause; the ~30 seconds that filling
      // them took is the far likelier explanation, i.e. a timing problem. So the
      // remedy is to wait and click again, NOT to fill anything.
      await this.page.waitForTimeout(3000);
      await this.page.waitForLoadState('networkidle').catch(() => {});
      await this.submitButton.click({ timeout: 10000 }).catch(() => {});
    }

    try {
      await this.confirmPopup.waitFor({ state: 'visible', timeout: 15000 });
    } catch (err) {
      const toastText = ((await this.page
        .locator('[data-scope="toast"], [role="alert"]').first()
        .innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      const photoBoxes = await this.page
        .getByText('Use Camera', { exact: false }).count().catch(() => 0);

      const wrapped = new Error(
        `SUBMIT_DID_NOT_CONFIRM: clicking Submit did not open the approve/reject ` +
        `confirm dialog within 15s.\n` +
        `  app message : ${toastText ? JSON.stringify(toastText) : '(no toast/alert visible)'}\n` +
        `  "Use Camera" boxes still on the page: ${photoBoxes}\n` +
        `  If that count is > 0, a checklist item's mandatory Capture Photo is ` +
        `probably unfilled — Submit no-ops rather than reporting it. ` +
        `BasePage.capturePhoto() fills one (NCReviewPage does this on the ` +
        `reviewer's page for exactly this reason).`
      );
      wrapped.submitDidNotConfirm = true;
      wrapped.toastText = toastText;
      wrapped.photoBoxes = photoBoxes;
      throw wrapped;
    }

    // The SAME Submit button approves or rejects depending on checklist state,
    // and the only thing distinguishing the two is this popup's wording
    // ("...approve RFI?" vs "...reject RFI?"). If any item is still marked
    // "Not Ok" — exactly the state a resubmitted RFI can arrive in after a
    // checklist rejection — clicking through would REJECT while the caller
    // believes it approved, sending the RFI back to CI instead of on to QI,
    // and the "left Pending with me" post-check would still pass. Fail loudly.
    const confirmText = ((await this.confirmPopup.innerText().catch(() => '')) || '')
      .replace(/\s+/g, ' ').trim();
    if (/reject/i.test(confirmText)) {
      throw new Error(
        `approve() was about to submit a REJECTION — the confirm popup reads ` +
        `"${confirmText}". At least one checklist item is still marked "Not Ok"; ` +
        `call setAllChecklistOk() before approving.`
      );
    }

    await this.confirmSubmitButton.click();
    await this._waitForPopupToClose(this.confirmPopup);
  }

  // Flips every checklist item back to "Ok", returning how many it changed.
  // Needed before approving an RFI that was previously rejected on the checklist
  // page, where the "Not Ok" selections can carry over to the resubmitted child.
  //
  // `exact: true` matters: "Not Ok" contains "Ok" as a substring, so a loose
  // name match would also grab the very radios we are trying to move away from.
  //
  // force: true for the reason rejectFromChecklistPage documents below — the real
  // <input> sits under a styled [data-part="item-control"] sibling that
  // permanently intercepts pointer events at the input's own coordinates.
  // Returns { total, flipped }, NOT a bare count. A bare 0 is ambiguous — it
  // could mean "all items were already Ok" or "no radios were found at all",
  // which are opposite conclusions, and the second happens whenever the caller
  // forgot goToChecklistPage()/expandAllChecklist() (the radios only exist in
  // the DOM once the accordion is expanded). `total` disambiguates it.
  async setAllChecklistOk() {
    const okRadios = this.page.getByRole('radio', { name: 'Ok', exact: true });
    const total = await okRadios.count();
    let flipped = 0;
    for (let i = 0; i < total; i++) {
      const radio = okRadios.nth(i);
      if (await radio.isChecked().catch(() => false)) continue;
      await radio.click({ force: true }).catch(() => {});
      flipped++;
    }
    return { total, flipped };
  }

  // Page-1 reject's REAL completion signal is the app's OWN automatic
  // redirect back to /my-tasks, not just the popup closing — confirmed live
  // (2026-08-27, user watching the browser directly): _waitForPopupToClose's
  // "popup hidden + networkidle + 3s" can resolve before the rejection has
  // actually finished processing server-side, so the next actor's turn
  // (CI's resubmit) can run against an RFI that isn't really in its
  // post-rejection state yet, breaking the flow. Wait for the redirect
  // itself to happen — do NOT force it with page.goto(), which would just
  // race the app's own in-flight navigation and mask a rejection that
  // silently never went through underneath.
  async _waitForRedirectToMyTasks() {
    await this.page.waitForURL('**/my-tasks', { timeout: 30000 });
    await this.page.waitForLoadState('networkidle');
  }

  async rejectFromFirstPage(remarks) {
    await this.rejectRfiButton.click();
    await this.rejectPopup.waitFor({ state: 'visible', timeout: 10000 });
    await this.rejectRemarksInput.fill(remarks);
    await this.rejectPopupButton.click();
    await this._waitForRedirectToMyTasks();
  }

  async rejectFromChecklistPage(remarks) {
    // MOBILE: the checklist — and the "Not Ok" radios this whole method depends
    // on — live on review page 2, behind Proceed. Without this hop
    // expandAllChecklist() finds nothing to expand on page 1 and the "Not Ok"
    // lookup then times out against a screen that never had any radios at all
    // (confirmed live: mobile-dom-recon screen 54 lists only Close / Reject RFI
    // / Proceed). No-op on desktop, which shows both panes at once.
    await this._ensureChecklistPage();
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

  // -------------------------------------------------------------------------
  // RAISE NC — rejecting an RFI *with* a linked non-conformance (gap G-01)
  // -------------------------------------------------------------------------
  // Marking a checklist item "Not Ok" reveals a "Raise NC" checkbox for THAT
  // item; checking it opens a full NC form inline and turns the rejection into
  // a rejection-with-NC. Every starred field below must be valid or Submit
  // SILENTLY NO-OPS (this app's documented behaviour — see approve()), which is
  // exactly how four earlier runs mistook an unfilled panel for "the reject
  // dialog never appeared".
  //
  // ALL LOCATORS HERE WERE READ OFF A LIVE DOM CAPTURE, not guessed:
  // tests/specs/inspection/00_inspect_rfi_linked_nc_panel.spec.js, run against
  // pulse-qa 2026-09-15 (artefacts under test-results/linked-nc-panel/). Two
  // things that capture settled, and that cost the previous attempt four runs:
  //
  //   * NC Description and Defect Type have NO placeholder and NO aria-label.
  //     The standalone form's `getByPlaceholder('Enter NC Description')` cannot
  //     match them. They ARE properly label-associated
  //     (<label for=":r1r:"> + <input id=":r1r:">) inside their own
  //     [data-scope="field"][data-part="root"], which is what is used below.
  //   * The panel carries its OWN mandatory "Capture Photo *", and it is NOT
  //     the last camera box on the page — the checklist has one box per item
  //     (16 of them) and the NC's is inserted at item 1. Scoping the capture to
  //     the panel is the whole reason this works.

  // The panel container: the parent of the "Raise NC" checkbox root, which
  // holds the checkbox and every NC field including its camera box. `index`
  // selects which checklist item's panel, so one rejection can carry several
  // independent NCs ("one NC per question" — confirmed live: marking a second
  // item Not Ok produces a second "Raise NC" control).
  linkedNcPanel(index = 0) {
    return this.raiseNcCheckbox(index).locator('xpath=..');
  }

  // The checkbox ROOT (a <label>), not the hidden <input>. The input is
  // visually hidden with a 1px clip rect, so clicking it times out — the same
  // anatomy NCReviewPage documents for the acknowledgement checkbox, where
  // clicking the root label is what actually toggles it.
  raiseNcCheckbox(index = 0) {
    return this.page
      .locator('[data-scope="checkbox"][data-part="root"]')
      .filter({ hasText: /raise\s*nc/i })
      .nth(index);
  }

  // Marks one checklist item Not Ok and fills its mandatory Remark.
  //
  // force:true on the radio for the reason rejectFromChecklistPage documents:
  // the real <input> sits under a styled sibling that permanently intercepts
  // pointer events at the input's own coordinates.
  async markChecklistItemNotOk(index, remark) {
    const notOk = this.page.getByRole('radio', { name: 'Not Ok' }).nth(index);
    await notOk.waitFor({ state: 'attached', timeout: 15000 });
    await notOk.click({ force: true });

    const remarkInput = this.page.getByPlaceholder('Type your comments here').nth(index);
    await remarkInput.waitFor({ state: 'visible', timeout: 10000 });
    await remarkInput.fill(remark);
  }

  // Checks "Raise NC" for one item and verifies it actually toggled, so a
  // regression fails here rather than 20s later as a mystifying silent no-op.
  async checkRaiseNc(index = 0) {
    const root = this.raiseNcCheckbox(index);
    await root.waitFor({ state: 'visible', timeout: 15000 });
    if ((await root.getAttribute('data-state').catch(() => null)) === 'checked') return;

    await root.click();
    const state = await root.getAttribute('data-state').catch(() => null);
    if (state !== 'checked') {
      throw new Error(`"Raise NC" did not toggle to checked (data-state="${state}")`);
    }
    // The panel's fields are rendered by the toggle — wait for the first of
    // them rather than a fixed sleep.
    await this.linkedNcDescriptionInput(index).waitFor({ state: 'visible', timeout: 15000 });
  }

  // One field of the panel, by its label text. The label is a real <label for>
  // pointing at the input's id, but the ids are React-generated (":r1r:") and
  // not CSS-selectable, so the field ROOT is the anchor.
  _linkedNcField(index, labelText) {
    return this.linkedNcPanel(index)
      .locator('[data-scope="field"][data-part="root"]')
      .filter({ hasText: labelText })
      .first();
  }

  linkedNcDescriptionInput(index = 0) {
    return this._linkedNcField(index, 'NC Description').locator('input');
  }

  linkedNcDefectTypeInput(index = 0) {
    return this._linkedNcField(index, 'Defect Type').locator('input');
  }

  // The panel's own camera box — scoped to the panel, never `.last()` on the
  // page. Returns the field root, which is what capturePhoto() expects (it
  // looks for a "Use Camera" DESCENDANT of whatever it is given).
  linkedNcPhotoBox(index = 0) {
    return this._linkedNcField(index, 'Capture Photo');
  }

  // Target Date for Closure. Same Ark UI date picker as the standalone NC form,
  // so the calendar mechanics are NCCreatePage.selectTargetDate's — including
  // the "three next-triggers are mounted at once, so match the day view's by
  // its aria-label" correction. The TRIGGER is scoped to the panel; the
  // calendar CONTENT is page-level, because Ark mounts it in a positioner
  // outside the field.
  async selectLinkedNcTargetDate(index = 0, daysFromNow = 14) {
    const target = new Date();
    target.setDate(target.getDate() + daysFromNow);
    const dataValue = [
      target.getFullYear(),
      String(target.getMonth() + 1).padStart(2, '0'),
      String(target.getDate()).padStart(2, '0'),
    ].join('-');

    await this.linkedNcPanel(index).getByRole('button', { name: /open date picker/i }).first().click();

    // SCOPED TO THE OPEN CALENDAR, and with more than one linked NC that is not
    // optional. Ark UI mounts a date-picker content element PER PICKER and keeps
    // it in the DOM when closed (hidden, data-state="closed"), so a page with two
    // linked-NC panels has two of them and a bare
    // `[data-scope="date-picker"][data-part="content"]` is a strict-mode
    // violation — caught live 2026-09-15 by the two-NC spec, on a panel the
    // single-NC path had filled correctly hundreds of times.
    //
    // Keying on data-state="open" picks the one that just opened, which is also
    // the only one that can be interacted with. Same family of trap as the
    // positioner-vs-content note at the top of this file.
    const calendar = this.page
      .locator('[data-scope="date-picker"][data-part="content"][data-state="open"]')
      .first();
    await calendar.waitFor({ state: 'visible', timeout: 10000 });

    for (let i = 0; i < 6; i += 1) {
      const cell = calendar.locator(`[data-part="table-cell-trigger"][data-value="${dataValue}"]`);
      if (await cell.isVisible({ timeout: 1000 }).catch(() => false)) {
        await cell.click();
        await calendar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        return;
      }
      await calendar.getByRole('button', { name: 'Switch to next month' }).click();
      await this.page.waitForTimeout(200);
    }
    throw new Error(`Linked NC Target Date: no cell for ${dataValue} within 6 months of forward navigation`);
  }

  // Fills every field of one item's linked-NC panel. Defaults mirror
  // nc-flow-turns.js's NC_DATA so a linked NC and a standalone one carry
  // comparable data; Debit Amount is the one optional field and is only touched
  // when a caller passes it.
  async fillLinkedNc(index, data = {}) {
    const {
      description = 'Linked NC raised by automation',
      defectType = 'Workmanship defect',
      category = 'Critical',
      targetDateDays = 14,
      quantity = 1,
      unit = 'EA',
      debitAmount = null,
      capturePhoto = true,
    } = data;

    const panel = this.linkedNcPanel(index);

    await this.linkedNcDescriptionInput(index).fill(description);
    await this.linkedNcDefectTypeInput(index).fill(defectType);

    await this.selectDropdownOption(
      this._linkedNcField(index, 'Category').getByRole('combobox').first(),
      category
    );

    await this.selectLinkedNcTargetDate(index, targetDateDays);

    await panel.getByPlaceholder('Enter Quantity').fill(String(quantity));
    await this.selectDropdownOption(
      this._linkedNcField(index, 'Unit of Measurement').getByRole('combobox').first(),
      unit
    );

    if (debitAmount != null) {
      await panel.getByPlaceholder('Debit Amount (INR)').fill(String(debitAmount));
    }

    // Mandatory, unlike the checklist item's own photo (which carries no
    // asterisk — app owner confirmed). Left until last so the camera modal's
    // full-viewport backdrop cannot intercept clicks meant for other fields.
    if (capturePhoto) {
      await this.captureLinkedNcPhoto(index);
    }
  }

  // Captures into the NC panel's own camera box AND VERIFIES A THUMBNAIL
  // ACTUALLY LANDED.
  //
  // WHY THE VERIFICATION IS THE POINT. BasePage.capturePhoto() returns
  // successfully as soon as the camera modal closes, which is not the same as
  // the photo having been attached — its own comments record that clicking
  // Capture can silently no-op on a fake stream that has not started rendering
  // frames. Caught live 2026-09-15: two runs of identical code, one attached
  // the photo and one did not, and the failing one surfaced 15s later as
  // "Submit did not open the confirm dialog" with the app's real complaint —
  // "At least one photo is required" — buried in the page rather than raised.
  //
  // A thumbnail is an <img> inside this field root (the camera glyph itself is
  // an inline <svg>, so a count of 0 before and >=1 after is unambiguous).
  async captureLinkedNcPhoto(index = 0, { attempts = 3 } = {}) {
    const box = this.linkedNcPhotoBox(index);
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      await this.capturePhoto(box).catch((err) => { lastError = err; });
      await this.page.waitForTimeout(500);
      const thumbnails = await box.locator('img').count().catch(() => 0);
      if (thumbnails > 0) return thumbnails;
    }

    throw new Error(
      `The linked NC's mandatory Capture Photo is still empty after ${attempts} attempts — ` +
      `no thumbnail appeared in the panel's photo box. Submitting now would silently no-op ` +
      `and the app would report "At least one photo is required" only on screen.` +
      (lastError ? `\n  last camera error: ${String(lastError.message).split(/\r?\n/)[0]}` : '')
    );
  }

  // Submits a checklist rejection — with or without linked NCs — and INSISTS
  // that the app confirmed a REJECTION.
  //
  // IT DOES NOT REDIRECT, and callers must not wait for one. Confirmed live
  // 2026-09-15: unlike rejectFromFirstPage (whose completion signal IS the
  // app's own redirect to /my-tasks — see _waitForRedirectToMyTasks), a
  // CHECKLIST reject leaves the reviewer on the RFI's view page and flips the
  // breadcrumb from "RFIs Pending with me" to "RFIs Pending with others". A
  // waitForURL('**/my-tasks') here times out after a rejection that actually
  // succeeded.
  //
  // The same Submit button approves or rejects depending on checklist state,
  // and only the confirm popup's wording tells them apart. approve() already
  // guards the opposite direction (refusing to submit a rejection it thinks is
  // an approval); this is that guard's mirror, so a run that silently reverted
  // every item to Ok cannot report a successful reject-with-NC.
  async submitChecklistRejection() {
    await this.submitButton.click();

    try {
      await this.confirmPopup.waitFor({ state: 'visible', timeout: 15000 });
    } catch (firstMiss) {
      // ONE retry after a settle, for the same reason approve() does it: a
      // Submit click can simply not register on a form that is not fully ready,
      // with no toast and no dialog. Only ever reached when nothing opened, so
      // a working path is untouched.
      await this.page.waitForTimeout(3000);
      await this.page.waitForLoadState('networkidle').catch(() => {});
      await this.submitButton.click({ timeout: 10000 }).catch(() => {});
    }

    try {
      await this.confirmPopup.waitFor({ state: 'visible', timeout: 15000 });
    } catch (err) {
      const toastText = ((await this.page
        .locator('[data-scope="toast"], [role="alert"]').first()
        .innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();

      // THE APP'S OWN COMPLAINT, which is on the page rather than in a toast.
      // Confirmed live 2026-09-15: an unattached NC photo renders "At least one
      // photo is required" inline next to the field, and the run that hit it
      // reported only "no toast/alert visible" — the diagnosis was sitting in
      // the DOM the whole time. Read it out rather than listing guesses.
      const inlineErrors = [...new Set(
        (await this.page.getByText(/is required|required field/i).allInnerTexts().catch(() => []))
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .filter((t) => t && t.length < 120)
      )];

      throw new Error(
        `SUBMIT_DID_NOT_CONFIRM: Submit did not open the reject-confirm dialog within 15s.\n` +
        `  app message  : ${toastText ? JSON.stringify(toastText) : '(no toast/alert visible)'}\n` +
        `  on-page errors: ${inlineErrors.length ? JSON.stringify(inlineErrors) : '(none found)'}\n` +
        `  This app no-ops rather than blocking on an invalid mandatory field. On a ` +
        `reject-with-NC the usual cause is the NC panel's OWN "Capture Photo *" ` +
        `(fillLinkedNc verifies that one now), or an empty NC Description / ` +
        `Defect Type / Target Date.`
      );
    }

    const confirmText = ((await this.confirmPopup.innerText().catch(() => '')) || '')
      .replace(/\s+/g, ' ').trim();
    if (!/reject/i.test(confirmText)) {
      throw new Error(
        `submitChecklistRejection() was about to submit something that is NOT a ` +
        `rejection — the confirm popup reads "${confirmText}". No checklist item is ` +
        `marked "Not Ok".`
      );
    }

    await this.confirmSubmitButton.click();
    await this._waitForPopupToClose(this.confirmPopup);
    return confirmText;
  }
}

module.exports = RFIReviewPage;
