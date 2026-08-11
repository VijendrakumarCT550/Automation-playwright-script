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

  getRowByCode(code) {
    return this.grid.locator('.rdg-row[role="row"]').filter({
      has: this.page.locator('[role="gridcell"][aria-colindex="1"]', { hasText: code }),
    });
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
  async scrollToRowByCode(code) {
    const row = this.getRowByCode(code);
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
  async openRowByCode(code) {
    const row = await this.scrollToRowByCode(code);
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
}

module.exports = RFIListPage;
