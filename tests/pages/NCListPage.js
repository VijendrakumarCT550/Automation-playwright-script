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
    // EXCLUDING the date picker is load-bearing, not defensive. Ark UI's
    // date-picker renders its calendar as <table role="grid"
    // data-scope="date-picker" aria-roledescription="calendar month">, so a bare
    // [role="grid"].first() can resolve to a HIDDEN calendar instead of the data
    // grid. Confirmed live on mobile 2026-09-01: waitForGrid logged
    //   43 x locator resolved to hidden <table role="grid" data-scope="date-picker">
    // and burned its full 20s timeout while the real RFI grid was on the page.
    this.grid = page.locator('[role="grid"]:not([data-scope="date-picker"])').first();
  }

  // MOBILE IS A DIFFERENT COMPONENT, not a reflow of the grid. Confirmed live
  // 2026-09-03 from an HTML dump of "NCs Pending with me" at a Pixel 7
  // viewport: no `.rdg-row` anywhere (count 0), a "Total NCs: N" header, and one
  // card per NC as `<div data-index="N">` containing the code in a plain <p>.
  // Every `role="grid"` on that page belongs to an Ark UI date picker
  // (aria-roledescription="calendar month|year|decade"), so the grid wait below
  // could only ever time out there — which is exactly what happened: all four
  // TCs failed at CI respond with "waiting for [role=grid] to be visible".
  //
  // RFIListPage was already made layout-aware for this; NCListPage never was.
  // Written independently rather than importing RFI's version, per the standing
  // instruction to keep NC isolated from RFI's files (see this file's header).
  async hasGrid() {
    return this.grid.isVisible().catch(() => false);
  }

  // A code rendered as a card title (mobile). Anchored so a short code cannot
  // match a longer one — "…CIV-5" must not match "…CIV-50".
  cardByCode(code) {
    const escaped = String(code).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.page.getByText(new RegExp(`^\\s*${escaped}\\s*$`)).first();
  }

  // THE MOBILE CARD LIST IS VIRTUALIZED, exactly like the desktop grid, and
  // needs the same treatment. `div[data-index="N"]` is the giveaway — that is a
  // virtualizer's row wrapper, and only the cards near the viewport exist in the
  // DOM at all.
  //
  // Measured live 2026-09-03: with 4 NCs pending, two of them were found
  // immediately while the other two burned the full 15s card wait and failed —
  // nav took 37s (22.5s baseline + 15s timeout) for those, versus 22.5s for the
  // ones already rendered. An earlier version of the mobile path had no
  // scrolling and simply could not reach a card outside the initial window,
  // which reads as "the NC is not in my queue" when it is.
  //
  // Scrolls whichever thing actually scrolls: the cards' own scroll container
  // when there is one, otherwise the window. Deliberately checks both rather
  // than assuming, since which one applies is a layout detail.
  async scrollToCardByCode(code) {
    const card = this.cardByCode(code);
    for (let i = 0; i < 30; i++) {
      if (await card.count() > 0) return card;

      const atEnd = await this.page.evaluate(() => {
        // The nearest scrollable ancestor shared by the virtualized cards.
        const anyCard = document.querySelector('div[data-index]');
        let container = null;
        for (let n = anyCard && anyCard.parentElement; n; n = n.parentElement) {
          const s = getComputedStyle(n);
          if (/(auto|scroll)/.test(s.overflowY) && n.scrollHeight > n.clientHeight + 4) {
            container = n;
            break;
          }
        }
        if (container) {
          const before = container.scrollTop;
          container.scrollTop = Math.min(
            container.scrollTop + container.clientHeight * 0.8,
            container.scrollHeight
          );
          return container.scrollTop === before;
        }
        const before = window.scrollY;
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
        return window.scrollY === before;
      });

      await this.page.waitForTimeout(350);
      if (atEnd) break;
    }
    return card;
  }

  // Waits for whichever layout this viewport renders and reports which. KEPT
  // UNDER THE ORIGINAL NAME so nc-nav.js and every existing caller need no
  // change, and the desktop path behaves exactly as before.
  //
  //   'grid'  — desktop react-data-grid
  //   'cards' — mobile card list, header "Total NCs: N"
  //
  // An empty list is included in the race deliberately: it is a valid state, and
  // waiting 20s for a grid that will never appear turns "no NCs pending" into a
  // timeout that reads like a broken page.
  async waitForGrid() {
    // Promise.any, NOT Promise.all — this returns as soon as ONE layout is
    // recognised. An earlier version used Promise.all, which waits for every
    // race to SETTLE: on mobile the 'grid' and 'empty' waits then ran their full
    // 20s each after 'cards' had already won, adding a guaranteed ~20s to every
    // single call for no information.
    const race = (locator, label) =>
      locator.waitFor({ state: 'visible', timeout: 20000 }).then(() => label);

    const winner = await Promise.any([
      race(this.grid, 'grid'),
      race(this.page.locator('text=/Total\\s+NCs/i').first(), 'cards'),
      race(this.page.locator('text=/no\\s+NCs?\\b/i').first(), 'empty'),
    ]).catch(() => null);

    if (winner) return winner;

    // Nothing recognisable — let the grid wait produce the real error rather
    // than inventing one.
    await this.grid.waitFor({ state: 'visible', timeout: 5000 });
    return 'grid';
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
    // MOBILE: no grid, no Actions column, no eye icon (confirmed: no
    // `lucide-eye` anywhere in the DOM). Each card is a `<div data-index="N">`
    // containing the code in a plain <p> and a "Review" button.
    //
    // THE CARD MUST BE EXPANDED FIRST, and the DOM is actively misleading about
    // this. The Review button IS in the markup of a collapsed card — grepping
    // the HTML finds all four — but it sits inside an ancestor div with
    // `display:none`, so it has a 0x0 rect and is absent from the accessibility
    // tree. Measured on the captured DOM 2026-09-03:
    //
    //   locator('button:has-text("Review")')          -> 4   (CSS ignores visibility)
    //   getByRole('button', { name: 'Review' })       -> 0   (hidden, so not in a11y tree)
    //   ancestor check                                -> DIV.display:none, rect 0x0
    //
    // An earlier version of this method read "the button is in the HTML" as "no
    // expand step needed" and waited on a permanently hidden element until it
    // timed out. Presence in the DOM is not visibility. Clicking the code
    // expands the card in place, which is the same behaviour RFIListPage
    // documents for RFI's mobile card.
    if (!(await this.hasGrid())) {
      // Scroll first — the list is virtualized, so a card further down does not
      // exist in the DOM until it is scrolled into range.
      const card = await this.scrollToCardByCode(code);
      await card.waitFor({ state: 'visible', timeout: 15000 });
      await card.scrollIntoViewIfNeeded().catch(() => {});
      await card.click();

      // Scope the Review button to THIS card. `div[data-index]` is the card
      // root — verified to contain both the code and the button — so filtering
      // it by the code gives exactly one card, rather than relying on generic
      // ancestor-nesting order. (Note `[data-index]` also appears on unrelated
      // <input> elements, which the code filter excludes.)
      const container = this.page
        .locator('div[data-index]')
        .filter({ has: this.cardByCode(code) })
        .first();

      // getByRole is deliberate here rather than a CSS text match: it ignores
      // the still-hidden copy, so this wait genuinely gates on the expand
      // having happened instead of resolving to a 0x0 element.
      const reviewBtn = container.getByRole('button', { name: /^\s*review\s*$/i }).first();
      await reviewBtn.waitFor({ state: 'visible', timeout: 15000 });
      await reviewBtn.click();
      // BOUNDED networkidle, deliberately. On this PWA a bare
      // waitForLoadState('networkidle') can fail to settle at all — a service
      // worker plus polling keeps the network busy — and an unbounded one has
      // already caused a multi-hour hang in this suite once (see the CI-login
      // fix). The .catch() alone is NOT enough protection: it swallows the
      // rejection but only AFTER the wait has run its course, which on a test
      // with a two-hour timeout means up to two hours. The URL assertion below
      // is the real confirmation that the click worked, so this wait is a
      // courtesy and must be cheap.
      await this.page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

      // Confirm we actually left the list. Without this a UI change that stops
      // the button navigating would surface far away — the caller would parse
      // the LIST page and report nulls or, worse, another card's values.
      await this.page.waitForURL(/\/my-tasks\/nc\/[a-f0-9-]{8,}/i, { timeout: 20000 });
      return;
    }

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
