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
    // EXCLUDING the date picker is load-bearing, not defensive. Ark UI's
    // date-picker renders its calendar as <table role="grid"
    // data-scope="date-picker" aria-roledescription="calendar month">, so a bare
    // [role="grid"].first() can resolve to a HIDDEN calendar instead of the data
    // grid. Confirmed live on mobile 2026-09-01: waitForGrid logged
    //   43 x locator resolved to hidden <table role="grid" data-scope="date-picker">
    // and burned its full 20s timeout while the real RFI grid was on the page.
    this.grid = page.locator('[role="grid"]:not([data-scope="date-picker"])').first();

    // Bound to the .first() matching dialog here, and RE-BOUND in openReassign()
    // to the exact dialog the clicked row owns — see _bindDialog and the long
    // note in openReassign for why .first() is wrong once the grid has more than
    // one row.
    this._bindDialog(
      page.locator('[role="dialog"], [data-scope="dialog"][data-part="content"]')
        .filter({ hasText: 'Reassign User' }).first()
    );
    this.toast = page.locator('[data-scope="toast"]').first();
  }

  // Every locator inside the dialog is derived from `this.dialog`, so switching
  // dialogs means re-deriving all of them — a bare `this.dialog = x` would leave
  // assigneeTypeDropdown and friends pointing at the previous one.
  _bindDialog(dialog) {
    this.dialog = dialog;
    this.assigneeTypeDropdown = dialog.locator('[role="combobox"]').first();
    this.assignToDropdown = dialog.getByRole('combobox', { name: /Assign to/i });
    this.assignUserButton = dialog.getByRole('button', { name: 'Assign User' });
    this.closeButton = dialog.locator('[data-part="close-trigger"]');
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

  // Reads the id (column 1) of every currently rendered data row, in order.
  //
  // Used to CHOOSE a row on the caller's own terms instead of blindly taking
  // the first one. That distinction caused a real failure on 2026-09-04: this
  // grid is Admin's GLOBAL "Pending with others" queue, so it holds every
  // unapproved RFI on the deployment — including rows belonging to DRS's own
  // automation (ids like `RFI-E2E-WL-A-15-...`, confirmed by the app owner) and
  // to the regression tier. "First available pending row" therefore meant
  // "whatever anyone else happened to create most recently", and a smoke run
  // reassigned a row it did not own.
  //
  // Only rows currently rendered are returned — the grid virtualises
  // vertically — which is fine for picking a row to act on, and is NOT a
  // reliable way to prove a given id is absent.
  async listRowIds(limit = 40) {
    const rows = this.grid.locator('.rdg-row[role="row"]');
    const count = Math.min(await rows.count(), limit);
    const ids = [];
    for (let i = 0; i < count; i++) {
      const id = await this.getRowId(rows.nth(i)).catch(() => null);
      if (id) ids.push(id.trim());
    }
    return ids;
  }

  // Every row id in the list, by SCROLLING DOWN THROUGH IT — the answer
  // `listRowIds` cannot give, and the one to use whenever an id's ABSENCE is
  // the thing being concluded.
  //
  // WHY THIS EXISTS — a real failure, pulse-test 2026-09-20.
  // 41_reassign_eligibility.spec.js's step 0 searched `listRowIds()` for a
  // pending RFI in A-06c, found only S05b codes and reported that the
  // deployment had none. It had ELEVEN; they were simply below the fold, since
  // only rows near the current scrollTop are mounted. The test failed with a
  // message telling us to go and create data that already existed — the
  // expensive kind of wrong answer, because acting on it would have written
  // real records to a shared environment for no reason.
  //
  // Steps down by roughly a viewport at a time rather than jumping to the
  // bottom: a jump mounts the last page and skips everything between, which is
  // the same trap recorded for RFIListPage.scrollToRowByCode in
  // docs/automation-coverage-and-gaps.md §2b. Stops when scrollTop stops
  // moving. Leaves the grid scrolled to the bottom; call scrollGridToStart()
  // (which resets scrollLeft) or re-navigate if the caller needs the top.
  // Waits until the grid stops GROWING, not just until it exists.
  //
  // waitForGrid resolves as soon as the grid element is visible, which happens
  // while it still holds its first row or two. Reading then yields a list that
  // is real but INCOMPLETE — and an incomplete list is indistinguishable from a
  // short one, so "the record is not here" comes back with total confidence.
  //
  // Live on pulse-test 2026-09-20: EE_D's "Pending with me" read as ONE row
  // across five separate navigations inside a long-running spec, while a fresh
  // session read SEVEN — all seven pool records, including the one the run had
  // just declared missing. Re-navigating does not help when the read after each
  // navigation is equally early; only waiting for the count to settle does.
  // networkidle does not cover it either: the rows arrive after it resolves.
  async waitForGridToSettle({ timeout = 15000, quietMs = 900 } = {}) {
    const rows = this.grid.locator('.rdg-row[role="row"]');
    const deadline = Date.now() + timeout;
    let last = -1;

    while (Date.now() < deadline) {
      const count = await rows.count().catch(() => 0);
      if (count > 0 && count === last) return count;   // unchanged across one quiet period
      last = count;
      await this.page.waitForTimeout(quietMs);
    }
    return last;
  }

  async collectAllRowIds({ maxPasses = 60 } = {}) {
    const seen = new Set();
    let prevTop = -1;

    // Let the first screenful settle before reading anything — otherwise this
    // starts scrolling a list that is still arriving, and the early passes read
    // rows that are about to be replaced.
    await this.waitForGridToSettle();

    for (let pass = 0; pass < maxPasses; pass++) {
      for (const id of await this.listRowIds(60)) seen.add(id);

      const top = await this.grid.evaluate((el) => {
        const step = Math.max(el.clientHeight - 60, 120);
        el.scrollTop += step;
        return el.scrollTop;
      });
      await this.page.waitForTimeout(350);
      if (top === prevTop) break;
      prevTop = top;
    }
    for (const id of await this.listRowIds(60)) seen.add(id);

    return [...seen];
  }

  // Scrolls DOWN until the row with this id is mounted, and returns it.
  //
  // The companion to collectAllRowIds, and needed for the same reason: a row
  // the list genuinely contains is not in the DOM until its neighbourhood is
  // scrolled into range, so `getRowById(id).waitFor({state:'visible'})` on a
  // row below the fold waits out its whole timeout and then reports the row as
  // missing (pulse-test 2026-09-20, every Family E case in turn).
  //
  // Returns immediately if the row is already mounted, so it costs nothing on
  // a short list. Throws with the row count it searched — "not found among 44
  // rows" is a real finding, while a bare timeout is ambiguous between "absent"
  // and "not scrolled to".
  async scrollToRowById(id, { maxPasses = 60 } = {}) {
    const row = this.getRowById(id);
    if (await row.count()) {
      await row.first().scrollIntoViewIfNeeded().catch(() => {});
      return row.first();
    }

    // START FROM THE TOP. This scans DOWNWARD, so it can only find rows below
    // wherever the grid happens to be sitting — and a caller that has just run
    // collectAllRowIds() leaves it at the BOTTOM, where there is nothing below
    // anything. Live on pulse-test 2026-09-20: a probe listed all seven pool
    // records successfully and then failed to locate a single one of them,
    // reporting "0/7 accounted for" about rows it had just printed. Resetting
    // costs one scroll and removes the ordering dependency entirely.
    await this.grid.evaluate((el) => { el.scrollTop = 0; });
    await this.page.waitForTimeout(250);
    if (await row.count()) {
      await row.first().scrollIntoViewIfNeeded().catch(() => {});
      return row.first();
    }

    let prevTop = -1;
    let scanned = 0;
    for (let pass = 0; pass < maxPasses; pass++) {
      const top = await this.grid.evaluate((el) => {
        const step = Math.max(el.clientHeight - 60, 120);
        el.scrollTop += step;
        return el.scrollTop;
      });
      await this.page.waitForTimeout(350);
      scanned = await this.grid.locator('.rdg-row[role="row"]').count();

      if (await row.count()) {
        await row.first().scrollIntoViewIfNeeded().catch(() => {});
        return row.first();
      }
      if (top === prevTop) break;
      prevTop = top;
    }

    throw new Error(
      `Row "${id}" not found in the grid after scrolling to the bottom ` +
      `(${scanned} rows mounted at the end of the scan). It is absent from this list, ` +
      `not merely unmounted.`
    );
  }

  // Resolves a column's aria-colindex by its HEADER TEXT, scrolling as needed.
  //
  // WHY THIS EXISTS — a real failure, 2026-09-04. 11_reassign_rfi_nc.spec.js
  // hardcodes `aria-colindex` 5/6/7 for Contractor Incharge / Execution
  // Engineer / Quality Inspector, from a one-off DOM dump of the headers. A
  // smoke run then failed with:
  //
  //     Expected: "CICeenUser67"   Received: "BL05"
  //     locator: ...[aria-colindex="5"]
  //
  // Column 5 was the WORK AREA column, not Contractor Incharge. The cell was
  // found and read cleanly; the index simply meant something different than it
  // did when the dump was taken. A hardcoded index is a snapshot of a layout
  // that the app is free to change, and when it does the failure looks like a
  // wrong VALUE rather than a wrong COLUMN — which sends you looking at the
  // reassignment logic instead of at the locator.
  //
  // Reading the header row instead makes the mapping self-correcting: the test
  // asks for "the Contractor Incharge column" and gets whichever index that is
  // today.
  //
  // Returns the numeric index, or null when no header matches — callers decide
  // whether that is a skip or a failure, since a column can legitimately be
  // absent from one list and present in another.
  async resolveColumnIndexByHeader(candidates) {
    const wanted = [].concat(candidates).filter(Boolean).map((c) => c.toLowerCase().trim());
    const headerCells = () => this.grid.locator('[role="columnheader"]');

    await this.scrollGridToStart();

    const seen = new Map();
    // Same incremental-scroll shape as scrollUntilColumnVisible, and for the
    // same reason: react-data-grid only keeps columns near the current scroll
    // offset rendered, so the full header set is never in the DOM at once and
    // has to be accumulated across scroll positions.
    for (let i = 0; i < 25; i++) {
      const count = await headerCells().count();
      for (let h = 0; h < count; h++) {
        const cell = headerCells().nth(h);
        const [text, idx] = await Promise.all([
          cell.innerText().catch(() => ''),
          cell.getAttribute('aria-colindex').catch(() => null),
        ]);
        const label = (text || '').replace(/\s+/g, ' ').trim();
        if (label && idx) seen.set(label.toLowerCase(), Number(idx));
      }

      for (const w of wanted) {
        for (const [label, idx] of seen) {
          if (label === w || label.includes(w)) return idx;
        }
      }

      const atEnd = await this.grid.evaluate((el) => {
        const before = el.scrollLeft;
        el.scrollLeft += el.clientWidth * 0.6;
        return el.scrollLeft === before;
      });
      await this.page.waitForTimeout(300);
      if (atEnd) break;
    }

    console.log(
      `    ReassignPage: no column header matched ${JSON.stringify(candidates)}. ` +
      `Headers seen: ${JSON.stringify([...seen.entries()])}`
    );
    return null;
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

    // ---------------------------------------------------------------------
    // EVERY GRID ROW OWNS ITS OWN DIALOG, so `.first()` is the wrong one
    // ---------------------------------------------------------------------
    // Found live on pulse-uat, 2026-09-08, and it took two runs to read
    // correctly — the first diagnosis was wrong and is worth recording as such.
    //
    // The NC half of SM14 failed with the dialog never becoming visible:
    //
    //   waiting for ...filter({ hasText: 'Reassign User' }) to be visible
    //   23 x locator resolved to hidden <div ... data-state="closed">
    //
    // FIRST (WRONG) READING: the click never landed, because a lingering toast
    // from the RFI half intercepted it — a real, documented failure mode in this
    // app. A dismiss-and-retry was added on that basis. It did not help, and the
    // retry's own log gave the actual answer:
    //
    //   locator resolved to <button data-state="open" aria-expanded="true"
    //     aria-haspopup="dialog" aria-controls="dialog::r3n::content" ...>
    //   <html> intercepts pointer events
    //
    // The trigger was ALREADY `open` and a modal backdrop was already blocking
    // the page. So the first click had worked perfectly — a dialog *was* open.
    // Just not the one being waited on: `this.dialog` is `.first()` of every
    // dialog containing "Reassign User", and this grid renders ONE TRIGGER AND
    // ONE DIALOG PER ROW. Clicking row 3's trigger opens row 3's dialog while
    // `.first()` keeps watching row 1's, which is correctly still closed.
    //
    // This is exactly the Ark UI hazard already recorded for this codebase:
    // never `.first()` a bare dialog selector, because several dialog elements
    // are present at once and only `data-part=content` reflects open state. The
    // RFI half passes only because it happens to target the first row.
    //
    // The trigger names its own dialog in `aria-controls`, so that is what gets
    // waited on. The blind retry is gone: re-clicking while the first dialog is
    // open is worse than useless, since its backdrop swallows the click (which
    // is what "<html> intercepts pointer events" was).
    //
    // The toast dismiss stays. It is cheap, toasts genuinely do intercept clicks
    // here, and it is not what was wrong this time.
    await this.dismissToastIfPresent().catch(() => {});
    await reassignButton.click();

    // An ATTRIBUTE selector, not `#id`. These ids are Ark UI's own generated
    // form — `dialog::r3n::content` — and in a CSS selector those colons parse
    // as pseudo-elements, so `#dialog::r3n::content` matches nothing (and
    // CSS.escape is a browser API, not available here in Node). `[id="..."]`
    // needs no escaping.
    const dialogId = await reassignButton.getAttribute('aria-controls').catch(() => null);
    if (dialogId) this._bindDialog(this.page.locator(`[id="${dialogId}"]`));
    await this.dialog.waitFor({ state: 'visible', timeout: 15000 });
  }

  // Enumerates EVERY combobox in the open dialog, with its label and options.
  //
  // WHY EVERY ONE, rather than reading `[role="combobox"].first()`. The modal
  // ADAPTS TO THE REASSIGNER: Admin gets two dropdowns (type, then Assign to),
  // while a role permitted exactly one type — Contractor Manager, Execution
  // Lead, Quality Lead — gets ONE, and that one holds PEOPLE, not types. So
  // `.first()` reads types for Admin and people for the others, and comparing
  // those people against a list of expected role names reports a permission
  // leak that does not exist. That happened on the first pass of the 2026-09-16
  // recon.
  //
  // The caller decides which box is which by looking at the OPTIONS (role names
  // => the type picker), never by position.
  async dumpDialogComboboxes() {
    const boxes = this.dialog.locator('[role="combobox"]');
    const count = await boxes.count();
    const out = [];

    for (let i = 0; i < count; i += 1) {
      const box = boxes.nth(i);
      const entry = { index: i, label: null, options: [] };

      // Several of this app's dropdowns have broken label associations, so fall
      // back to the field root's own text.
      entry.label = (await box.getAttribute('aria-label').catch(() => null))
        || (await box.locator('xpath=ancestor::*[@data-scope="field" or @data-scope="select"][1]')
          .innerText().catch(() => ''))
          .replace(/\s+/g, ' ').trim().slice(0, 60)
        || null;

      try {
        const listbox = await this.openDropdown(box);
        entry.options = (await listbox.locator('[data-part="item-text"]').allInnerTexts())
          .map((n) => n.trim()).filter(Boolean);
        await this.page.keyboard.press('Escape');
        await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      } catch (err) {
        entry.error = String((err && err.message) || err).split(/\r?\n/)[0];
      }
      out.push(entry);
    }
    return { count, boxes: out };
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
    const confirmPopup = this.page.locator('[role="dialog"], [data-scope="dialog"][data-part="content"]')
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
