const { BasePage } = require('./BasePage');

// Covers the "Pending with me" / "Pending with others" RFI grid, reached via
// MyTasksPage's tile clicks — the exact same react-data-grid shape as
// ReassignPage's grid (confirmed live via DOM dump: aria-colcount="15",
// same `.rdg-row[role="row"]` > `[role="gridcell"][aria-colindex=N]`
// structure, column 1 = the RFI's visible code). See ReassignPage.js's
// header comment for the full write-up of react-data-grid's column
// virtualization mechanics — this reuses the same scroll-and-re-find
// pattern rather than duplicating that explanation.
//
// Unlike ReassignPage (whose Actions column has 2 icons — eye=view,
// replace=reassign — since it manages OTHER people's tasks), a "Pending
// with me" row's Actions column has exactly ONE button, `svg.lucide-eye`
// (confirmed live) — clicking it navigates straight to
// /my-tasks/rfi/<id>/view, the same destination RFIReviewPage.goto() used
// to reach directly by URL. This page is the UI-click replacement for that
// direct navigation, used by all three RFI-flow actors (CI's resubmit turn,
// EE/QI's review turn all land in their own "Pending with me" list).
class RFIListPage extends BasePage {
  constructor(page) {
    super(page);
    this.grid = page.locator('[role="grid"]').first();
  }

  async waitForGrid() {
    await this.grid.waitFor({ state: 'visible', timeout: 20000 });
  }

  // `exact: true` anchors the match to the WHOLE code cell instead of doing a
  // substring match. Added for WIND, where the default is genuinely unsafe.
  //
  // The RFI code's numeric suffix restarts per unique Work-Location/Work-Area/
  // Package combination (docs/rfi-business-logic.md), so wind's brand-new
  // "WTG-Khavda / KH 34 / CIV" combination starts at 1 and produces
  // single-digit codes. A substring lookup for a code ending "-CIV-1" then
  // ALSO matches "-CIV-10", "-CIV-11", "-CIV-12"..., the filter resolves to
  // several rows, and openRowByCode's row.waitFor()/getAttribute() dies on a
  // Playwright strict-mode violation. Solar never hit this purely because its
  // counter is already in the hundreds.
  //
  // Default stays `false`, i.e. byte-identical behaviour for every existing
  // caller (rfi-nav.js's openFromPendingWithMe is the only one).
  getRowByCode(code, { exact = false } = {}) {
    // Same escape expression already used by WAMPage.getWorkAreaRow. Wind codes
    // contain a hyphenated Work Location and a Work Area with a SPACE
    // ("RFI-WTG-Khavda-KH 34-CIV-1"), so nothing may assume the code is
    // whitespace-free or safe to interpolate raw.
    const escaped = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const cellMatch = exact
      // Anchored, with tolerance for surrounding whitespace in the cell.
      ? { hasText: new RegExp('^\\s*' + escaped + '\\s*$') }
      : { hasText: code };
    return this.grid.locator('.rdg-row[role="row"]').filter({
      has: this.page.locator('[role="gridcell"][aria-colindex="1"]', cellMatch),
    });
  }

  // Every code currently rendered in the grid's column 1, after scrolling to the
  // bottom (newly touched rows sort there — see scrollToRowByCode).
  //
  // Added for the review-queue drain utility, which has to act on whatever is
  // pending WITHOUT knowing the codes in advance — the normal flow always knows
  // the code it just created, but an orphaned RFI (created by a run that died
  // before capturing its code) can only be found by enumeration.
  async listRowCodes() {
    await this.waitForGrid();
    // Same bottom-scroll as scrollToRowByCode: react-data-grid virtualizes rows,
    // so codes further down do not exist in the DOM until scrolled into range.
    for (let i = 0; i < 30; i++) {
      const atEnd = await this.grid.evaluate((el) => {
        const before = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        return el.scrollTop === before;
      });
      await this.page.waitForTimeout(300);
      if (atEnd) break;
    }
    const cells = this.grid.locator('[role="gridcell"][aria-colindex="1"]');
    const texts = await cells.allInnerTexts();
    return texts
      .map((t) => t.trim())
      .filter((t) => /^(RFI|NC)-/.test(t));
  }

  // Rows survive horizontal scroll unchanged — only their cells virtualize
  // in/out — so aria-rowindex is a stable handle for re-finding the same row
  // once its ID column (used to locate it originally) scrolls out of view.
  getRowByAriaIndex(rowIndex) {
    return this.grid.locator(`.rdg-row[role="row"][aria-rowindex="${rowIndex}"]`);
  }

  // Newly created/modified RFIs sort to the BOTTOM of "Pending with me" —
  // the REVERSE of "Pending with others"/"Approved", where newest sorts to
  // the top (user-confirmed live: EE's review kept missing recently-created
  // rows — they simply weren't on screen — until scrolled to the bottom
  // manually; true for every role's own "Pending with me" tile, not just
  // EE). React-data-grid virtualizes ROWS by vertical scroll position the
  // same way it virtualizes COLUMNS by horizontal position (see this file's
  // header comment / ReassignPage.js's write-up) — a row far down a long
  // list may not exist in the DOM at all until scrolled into range. Scrolls
  // the grid down in steps until the target row exists, same polling shape
  // as openRowByCode's horizontal scroll below.
  async scrollToRowByCode(code, opts) {
    const row = this.getRowByCode(code, opts);
    for (let i = 0; i < 30; i++) {
      if (await row.count() > 0) break;
      const atEnd = await this.grid.evaluate(el => {
        const before = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        return el.scrollTop === before;
      });
      await this.page.waitForTimeout(400);
      if (atEnd) break;
    }
    return row;
  }

  // Finds the row by its visible code — scrolling down first, since newly
  // touched rows sort to the bottom (see scrollToRowByCode) — then scrolls
  // the grid right until the Actions column renders for THIS row (re-found
  // by aria-rowindex each scroll step, same reasoning as
  // ReassignPage.openReassign), then clicks its eye icon to open the RFI —
  // the UI-click equivalent of RFIReviewPage.goto(rfiId) / a direct
  // page.goto to .../view.
  async openRowByCode(code, opts) {
    const row = await this.scrollToRowByCode(code, opts);
    await row.waitFor({ state: 'visible', timeout: 15000 });
    const rowIndex = await row.getAttribute('aria-rowindex');

    let eyeButton = this.getRowByAriaIndex(rowIndex).locator('[role="gridcell"]').last()
      .locator('button:has(svg.lucide-eye)').first();
    for (let i = 0; i < 20; i++) {
      if (await eyeButton.isVisible({ timeout: 500 }).catch(() => false)) break;
      const atEnd = await this.grid.evaluate(el => {
        const before = el.scrollLeft;
        el.scrollLeft = el.scrollWidth;
        return el.scrollLeft === before;
      });
      await this.page.waitForTimeout(400);
      if (atEnd) break;
    }
    // Last attempt with a real timeout so a genuine failure throws for
    // real, rather than silently clicking nothing (same principle as
    // ReassignPage.openReassign's fallback wait).
    await eyeButton.waitFor({ state: 'visible', timeout: 10000 });
    await eyeButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  // Opens an "In-Draft" row — same Actions-column eye icon as
  // openRowByCode, but located by its status text instead of a visible
  // code, since a still-local draft has no RFI ID/code assigned yet
  // (confirmed live, 2026-08-19: the ID column is blank for these rows).
  // App-owner-confirmed (2026-08-19, live screenshot): this row DOES have
  // a working eye icon in its Actions column, same as any submitted
  // row — an earlier automated probe missed it only because it gave up
  // scrolling too early; this row genuinely has more columns than a
  // first glance suggests (Activity, Sub Activity, Created AT, Updated
  // AT, Last Reviewed By, then Actions).
  getRowByStatus(statusText) {
    return this.grid.locator('.rdg-row[role="row"]').filter({ hasText: statusText });
  }

  async scrollToRowByStatus(statusText) {
    const row = this.getRowByStatus(statusText);
    for (let i = 0; i < 30; i++) {
      if (await row.count() > 0) break;
      const atEnd = await this.grid.evaluate(el => {
        const before = el.scrollTop;
        el.scrollTop = el.scrollHeight;
        return el.scrollTop === before;
      });
      await this.page.waitForTimeout(400);
      if (atEnd) break;
    }
    return row;
  }

  async openDraftRow() {
    const row = await this.scrollToRowByStatus('In-Draft');
    await row.first().waitFor({ state: 'visible', timeout: 15000 });
    const rowIndex = await row.first().getAttribute('aria-rowindex');

    let eyeButton = this.getRowByAriaIndex(rowIndex).locator('[role="gridcell"]').last()
      .locator('button:has(svg.lucide-eye)').first();
    for (let i = 0; i < 20; i++) {
      if (await eyeButton.isVisible({ timeout: 500 }).catch(() => false)) break;
      const atEnd = await this.grid.evaluate(el => {
        const before = el.scrollLeft;
        el.scrollLeft = el.scrollWidth;
        return el.scrollLeft === before;
      });
      await this.page.waitForTimeout(400);
      if (atEnd) break;
    }
    await eyeButton.waitFor({ state: 'visible', timeout: 10000 });
    await eyeButton.click();
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = RFIListPage;
