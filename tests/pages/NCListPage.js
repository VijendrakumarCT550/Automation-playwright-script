const { BasePage } = require('./BasePage');

// Covers the "Pending with me" / "Pending with others" NC grid, reached via
// NCTasksPage's tile clicks — the exact same react-data-grid shape as
// RFI's equivalent grid (confirmed live for RFI's own list AND documented
// in ReassignPage.js's header comment: "RFI and NC use the exact same
// react-data-grid shape"), column 1 = the NC's visible code.
//
// Deliberately a separate file from RFIListPage.js, not a shared/reused
// class — explicit user instruction to keep NC 100% isolated from RFI's
// files even where the logic looks reusable (see project_nc_creation_feature
// memory). The logic below mirrors RFIListPage.js's, including the
// vertical-scroll fix (newly created/modified rows sort to the BOTTOM of
// "Pending with me", virtualized out of the DOM until scrolled down) —
// applied here preemptively since it's the same app/grid component, not
// yet separately re-confirmed live for NC specifically.
class NCListPage extends BasePage {
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

  // Scrolls the grid down in steps until the target row exists — see this
  // file's header comment for why (newest rows sort to the bottom of
  // "Pending with me", virtualized out of the DOM until scrolled into
  // range).
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
  // by aria-rowindex each scroll step), then clicks its eye icon to open
  // the NC — the UI-click equivalent of a direct page.goto to
  // /my-tasks/nc/<id>.
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
    // real, rather than silently clicking nothing.
    await eyeButton.waitFor({ state: 'visible', timeout: 10000 });
    await eyeButton.click();
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = NCListPage;
