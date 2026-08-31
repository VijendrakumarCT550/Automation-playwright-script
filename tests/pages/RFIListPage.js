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
    // EXCLUDING the date picker is load-bearing, not defensive. Ark UI's
    // date-picker renders its calendar as <table role="grid"
    // data-scope="date-picker" aria-roledescription="calendar month">, so a bare
    // [role="grid"].first() can resolve to a HIDDEN calendar instead of the data
    // grid. Confirmed live on mobile 2026-09-01: waitForGrid logged
    //   43 x locator resolved to hidden <table role="grid" data-scope="date-picker">
    // and burned its full 20s timeout while the real RFI grid was on the page.
    this.grid = page.locator('[role="grid"]:not([data-scope="date-picker"])').first();
  }

  // ---- TWO LAYOUTS ----
  //
  // MOBILE DOES NOT RENDER A DATA GRID AT ALL. Confirmed live 2026-09-01 by
  // screenshot: at a phone viewport "RFIs Pending with me" is a list of CARDS —
  // "Total RFIs: 2" followed by one card per RFI, each showing the code as a link
  // plus Work Location / Work Area / Package / Contractor Name and an
  // "In-Review (EE)" status pill. There is no [role="grid"], no .rdg-row and no
  // eye icon anywhere, so every grid-based method below simply cannot work there.
  //
  // This is the first genuine mobile difference that is NOT navigation — the list
  // is a different component, not a reflow of the same one. So each method picks
  // its layout at runtime. The desktop path is untouched: when the grid exists,
  // the original grid code runs exactly as before.
  async hasGrid() {
    return this.grid.isVisible().catch(() => false);
  }

  // A code rendered as a card title (mobile). Anchored with a regex so a
  // four-digit code cannot match a longer one.
  cardByCode(code) {
    const escaped = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByText(new RegExp(`^\\s*${escaped}\\s*$`)).first();
  }

  // Waits for ANY of the three ready states and reports which. Kept under the
  // original name so rfi-nav.js and every existing caller need no change.
  //
  //   'grid'  — desktop react-data-grid
  //   'cards' — mobile card list, header "Total RFIs: N"
  //   'empty' — the list is legitimately EMPTY
  //
  // The empty case is not an error and must not be treated as one. Confirmed by
  // screenshot: an empty mobile list renders "No RFIs found" and NO "Total RFIs"
  // header at all. An earlier version of this method raced only grid vs "Total
  // RFIs" and asserted in a comment that the header appears even when empty —
  // it does not, so the very first check made straight after an approval (which
  // by definition empties that role's queue) blew its timeout on a page that had
  // loaded perfectly well.
  async waitForGrid() {
    const race = (locator, name, timeout = 20000) =>
      locator.waitFor({ state: 'visible', timeout }).then(() => name).catch(() => null);

    const winner = await Promise.race([
      race(this.grid, 'grid'),
      race(this.page.locator('text=/Total\\s+RFIs/i').first(), 'cards'),
      race(this.page.locator('text=/No\\s+RFIs?\\s+found/i').first(), 'empty'),
    ]);
    if (winner) return winner;

    // Nothing appeared. Give the empty-state one more short look before blaming
    // the grid — an empty list is far likelier here than a broken page.
    if (await this.page.locator('text=/No\\s+RFIs?\\s+found/i').first()
      .isVisible().catch(() => false)) return 'empty';

    // Genuinely nothing recognisable — let the grid wait produce the real error.
    await this.grid.waitFor({ state: 'visible', timeout: 5000 });
    return 'grid';
  }

  // `exact: true` anchors the match to the WHOLE code cell instead of doing a
  // substring match. Added for WIND, where the default is genuinely unsafe.
  //
  // A substring lookup for a code ending "-CIV-303" would ALSO match
  // "-CIV-3030".."-CIV-3039", the filter would resolve to several rows, and
  // openRowByCode's row.waitFor()/getAttribute() would die on a Playwright
  // strict-mode violation.
  //
  // This is DEFENSIVE rather than a fix for a live break: the wind code counter
  // turned out to be GLOBAL and sequential across work areas (observed 3034,
  // 3036, 3037, 3038, 3039 across KH 34/35/52), not restarting per
  // Work-Location/Work-Area/Package as first assumed from
  // docs/rfi-business-logic.md. Still worth having — a four-digit code becomes
  // a prefix of a five-digit one soon enough.
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
    const layout = await this.waitForGrid();

    // An empty list is a legitimate answer — "no rows" — not a failure. This is
    // the normal state immediately after a role approves its last item, which is
    // exactly when the post-approval check asks.
    if (layout === 'empty') return [];

    // MOBILE: cards, no grid and no virtualization — every code is already in
    // the DOM as a card title, so scan for them directly. textContent rather
    // than innerText, for the same CSS-truncation reason as
    // BasePage.getVisibleCode.
    if (layout === 'cards' && !(await this.hasGrid())) {
      return this.page.evaluate(() => {
        const rx = /^(RFI|NC)-[A-Za-z0-9][A-Za-z0-9 ._/-]*\d$/;
        const found = [];
        for (const el of document.querySelectorAll('a,p,span,div,h1,h2,h3,h4')) {
          if (el.children.length) continue;
          const t = (el.textContent || '').trim();
          if (t.length >= 10 && rx.test(t) && !found.includes(t)) found.push(t);
        }
        return found;
      });
    }

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
    // MOBILE has no grid to scroll and no row virtualization — every card is
    // already in the DOM — so return the card locator directly. Without this the
    // grid.evaluate() below waits 30s for an element that does not exist.
    if (!(await this.hasGrid())) return this.cardByCode(code);

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
    // MOBILE: no grid, no Actions column, no eye icon — and clicking the card's
    // code does NOT navigate. It EXPANDS THE CARD IN PLACE (confirmed by
    // screenshot: the expanded card reveals Activity, Sub-Activity, Created at /
    // Last updated on, the CI -> EE -> QI chips, and a "Review" button). It is
    // that Review button which opens the RFI.
    //
    // Getting this wrong was silent and misleading rather than a clean failure:
    // an earlier version clicked only the code, stayed on the LIST page, and the
    // caller's readAllFields() then happily parsed the list — returning the FIRST
    // card's Work Area ("KH 35") for an RFI on KH 52, with nulls for every field
    // that only exists on the review page. It failed later at a missing "Submit"
    // button, far from the cause.
    if (!(await this.hasGrid())) {
      const card = this.cardByCode(code);
      await card.waitFor({ state: 'visible', timeout: 15000 });
      await card.click();

      // Scope the Review button to THIS card. Nested elements appear
      // outer-before-inner in document order, so .last() of the ancestors that
      // contain both this code and a Review button is the tightest container —
      // which matters because another card could also be expanded.
      const cardContainer = this.page
        .locator('div')
        .filter({ has: this.cardByCode(code) })
        .filter({ has: this.page.getByRole('button', { name: /^\s*review\s*$/i }) })
        .last();

      const reviewBtn = cardContainer
        .getByRole('button', { name: /^\s*review\s*$/i }).first();
      await reviewBtn.waitFor({ state: 'visible', timeout: 15000 });
      await reviewBtn.click();
      await this.page.waitForLoadState('networkidle');

      // Confirm we actually left the list, so a future UI change surfaces here
      // rather than as a mystery missing button on the "review" page.
      await this.page.waitForURL(/\/my-tasks\/rfi\/[a-f0-9-]+\/view/i, { timeout: 20000 });
      return;
    }

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
