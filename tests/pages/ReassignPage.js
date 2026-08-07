const { BasePage } = require('./BasePage');

// Covers the "Pending with others" list (RFI and NC use the exact same
// react-data-grid shape and the exact same "Reassign User" modal) and the
// modal itself, opened from a row's Actions column.
//
// The list is react-data-grid, which virtualizes COLUMNS by horizontal
// scroll position, same as any real user sees — the rightmost Actions
// column (eye/view + reassign icons) only exists in the DOM once the grid
// is actually scrolled right far enough to bring it into view (confirmed
// via DOM dump: RFI has 15 columns / NC has 14; at a normal ~1280-1920px
// viewport only the first 8-12 render at scrollLeft=0). `openReassign()`
// below scrolls the grid itself (`[role="grid"]`, which IS the scrollable
// element) to reveal it, rather than requiring an oversized viewport —
// an earlier version of this page forced a 3600x1440 viewport to make
// every column render at once, which worked but made the browser window
// visibly overflow any real monitor when watching the (headed) test run.
//
// Horizontal scroll un-mounts whatever columns are now off-screen (so the
// ID column used to find a row can disappear once scrolled right) — rows
// themselves are NOT affected by horizontal scroll, so `aria-rowindex` is
// used as a scroll-position-independent handle to re-find the same row
// after scrolling (see openReassign).
//
// Row shape: `[role="row"].rdg-row` > `[role="gridcell"][aria-colindex=N]`.
// Column 1 is the RFI/NC ID; columns 5/6/7 are Contractor Incharge/Assigned
// EE/Assigned QI (confirmed identical indices on both RFI's and NC's grid);
// the last column is Actions, holding two icon buttons with no aria-label —
// told apart by their lucide icon: eye = view, "replace" = reassign.
//
// Reassign modal ("Reassign User"):
//  - Shows "<ID>" + "v<N>", then a "Select Assignee Type" dropdown.
//    Its aria-labelledby points to an id that has no matching element in
//    the DOM (a broken label association — the same pattern already seen
//    in SO Mapping/WAM activity rows), so getByRole('combobox', {name})
//    can't find it; it's targeted by position (the only combobox present
//    before an assignee type is picked).
//  - Picking a type reveals a read-only "Current <Role>" line and a second
//    "Assign to" dropdown — THIS one has a real <label>, targeted by name.
//  - "Assign to" options are pre-filtered by the app to exclude the current
//    assignee (confirmed live: current assignee's name never appears in the
//    eligible list) — any option can be picked without an extra check.
class ReassignPage extends BasePage {
  constructor(page) {
    super(page);
    this.grid = page.locator('[role="grid"]').first();

    this.dialog = page.locator('[role="dialog"], [data-scope="dialog"][data-part="content"]')
      .filter({ hasText: 'Reassign User' }).first();
    this.assigneeTypeDropdown = this.dialog.locator('[role="combobox"]').first();
    this.assignToDropdown = this.dialog.getByRole('combobox', { name: /Assign to/i });
    this.assignUserButton = this.dialog.getByRole('button', { name: 'Assign User' });
    this.closeButton = this.dialog.locator('[data-part="close-trigger"]');
    this.toast = page.locator('[data-scope="toast"]').first();
  }

  async waitForGrid() {
    await this.grid.waitFor({ state: 'visible', timeout: 20000 });
  }

  getFirstRow() {
    return this.grid.locator('.rdg-row[role="row"]').first();
  }

  // Scopes to the data row whose ID column (aria-colindex="1") contains the
  // given RFI/NC id — same div.d_grid-style `has:` row-scoping pattern used
  // by SOMappingPage/WAMPage.
  getRowById(id) {
    return this.grid.locator('.rdg-row[role="row"]').filter({
      has: this.page.locator('[role="gridcell"][aria-colindex="1"]', { hasText: id }),
    });
  }

  getCell(row, colIndex) {
    return row.locator(`[role="gridcell"][aria-colindex="${colIndex}"]`);
  }

  async getRowId(row) {
    return (await this.getCell(row, 1).innerText()).trim();
  }

  // Rows survive horizontal scroll unchanged — only their cells virtualize
  // in/out — so aria-rowindex is a stable handle for re-finding this exact
  // row once its ID column (used to locate it originally) is scrolled away.
  getRowByAriaIndex(rowIndex) {
    return this.grid.locator(`.rdg-row[role="row"][aria-rowindex="${rowIndex}"]`);
  }

  // A single scrollLeft=scrollWidth isn't enough: react-data-grid only
  // measures/renders columns as they scroll into range, so scrollWidth
  // itself grows once new (previously-unmeasured) columns to the right
  // come into play (confirmed live: scrollWidth went 2454 -> 2830 across
  // two scroll attempts before settling). Re-reading "has scrollWidth
  // stopped changing yet" as the sole stop condition is itself racy — how
  // long React takes to re-render after the scroll event varies run to run
  // (confirmed live: the exact same code intermittently exited this loop
  // one check too early), so callers needing a specific element to exist
  // afterward should poll for that element directly (see openReassign)
  // rather than trusting this alone.
  async scrollGridToEnd() {
    let prevWidth = -1;
    for (let i = 0; i < 15; i++) {
      const scrollWidth = await this.grid.evaluate(el => {
        el.scrollLeft = el.scrollWidth;
        return el.scrollWidth;
      });
      await this.page.waitForTimeout(400);
      if (scrollWidth === prevWidth) break;
      prevWidth = scrollWidth;
    }
  }

  async scrollGridToStart() {
    await this.grid.evaluate(el => { el.scrollLeft = 0; });
    await this.page.waitForTimeout(500);
  }

  // Virtualization only keeps columns near the CURRENT scroll position
  // rendered, not everything scrolled past — so bringing a middling column
  // (e.g. 5/6/7, Contractor Incharge/Assigned EE/Assigned QI) into view
  // needs a partial scroll, not scrollGridToEnd() (confirmed live: at a
  // normal ~1280px viewport those three columns sit right at/past the
  // default render edge, and scrolling all the way to the end virtualizes
  // them right back out again). Scrolls right in small increments and
  // stops as soon as the target column's cell for this row exists.
  async scrollUntilColumnVisible(row, colIndex) {
    const cell = this.getCell(row, colIndex);
    for (let i = 0; i < 20; i++) {
      if (await cell.count() > 0) return cell;
      const atEnd = await this.grid.evaluate(el => {
        const before = el.scrollLeft;
        el.scrollLeft += el.clientWidth * 0.6;
        return el.scrollLeft === before;
      });
      await this.page.waitForTimeout(300);
      if (atEnd) break;
    }
    return cell;
  }

  // Polls scroll+check together rather than trusting scrollGridToEnd's
  // "scrollWidth stopped growing" heuristic alone before looking for the
  // button once — that heuristic can report done a render-cycle too early
  // depending on system load (see scrollGridToEnd), which intermittently
  // left the button not yet in the DOM when checked only once afterward.
  async openReassign(row) {
    const rowIndex = await row.getAttribute('aria-rowindex');
    const scrolledRow = this.getRowByAriaIndex(rowIndex);
    const actionsCell = scrolledRow.locator('[role="gridcell"]').last();
    const reassignButton = actionsCell.locator('button:has(svg.lucide-replace)');

    let found = false;
    for (let i = 0; i < 20; i++) {
      await this.grid.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      await this.page.waitForTimeout(400);
      if (await reassignButton.isVisible({ timeout: 500 }).catch(() => false)) {
        found = true;
        break;
      }
    }
    if (!found) {
      // Last attempt with a real timeout, so a genuine failure still
      // throws a clear "not visible" error instead of silently clicking
      // nothing.
      await reassignButton.waitFor({ state: 'visible', timeout: 10000 });
    }

    await reassignButton.click();
    await this.dialog.waitFor({ state: 'visible', timeout: 10000 });
  }

  async selectAssigneeType(roleLabel) {
    await this.selectDropdownOption(this.assigneeTypeDropdown, roleLabel);
  }

  // "Current <Role>" is a label paragraph immediately followed by a sibling
  // paragraph holding the actual current-assignee name.
  async getCurrentAssigneeName() {
    const label = this.dialog.locator('p', { hasText: /^Current / }).first();
    await label.waitFor({ state: 'visible', timeout: 5000 });
    const value = label.locator('xpath=following-sibling::p[1]');
    return (await value.innerText()).trim();
  }

  // Reads the eligible ("Assign to") user names by actually opening the
  // dropdown (its option list is only reliably scoped to THIS field while
  // open — both selects' option text nodes exist in the DOM at all times,
  // open or closed, so reading them unopened risks picking up the OTHER
  // dropdown's options too).
  async getEligibleAssigneeNames() {
    const listbox = await this.openDropdown(this.assignToDropdown);
    const names = (await listbox.locator('[data-part="item-text"]').allInnerTexts())
      .map(n => n.trim())
      .filter(Boolean);
    await this.page.keyboard.press('Escape');
    await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return names;
  }

  async selectNewAssignee(userName) {
    await this.selectDropdownOption(this.assignToDropdown, userName);
  }

  async submitAssignUser() {
    await this.assignUserButton.click();

    // Some app flows show an "Are you sure...?" confirm popup before the
    // action actually persists (see RFIReviewPage.approve/reject) — handle
    // it if present, otherwise fall straight through to the toast.
    const confirmPopup = this.page.locator('[role="dialog"], [data-scope="dialog"]')
      .filter({ hasText: /are you sure/i }).first();
    if (await confirmPopup.isVisible({ timeout: 3000 }).catch(() => false)) {
      const confirmButton = confirmPopup.getByRole('button', { name: /submit|confirm|yes/i });
      await confirmButton.click();
    }

    let toastText = '';
    for (let i = 0; i < 60 && !toastText; i++) {
      toastText = (await this.toast.innerText().catch(() => '')).trim();
      if (!toastText) await this.page.waitForTimeout(300);
    }

    await this.dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle');
    return toastText;
  }
}

module.exports = ReassignPage;
