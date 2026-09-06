const { BasePage } = require('./BasePage');

// Covers the Dashboard's "Detail Records" table and its "Filter" drawer
// (/dashboard). The table has its own RFI/NC toggle (separate from My
// Tasks' RFI/NC tabs) — same Filter drawer content for both, confirmed via
// DOM dump (tests/specs/inspection/00_inspect_dashboard_filter.spec.js): only the
// underlying data differs.
//
// Filter drawer fields, in DOM order (all correctly wired via
// aria-labelledby, confirmed live — unlike some other broken-label fields
// elsewhere in this app). ALL of these except Work Area are Ark UI
// "select" dropdowns (<button role="combobox">, pick from existing
// values) — including "Project Name" and "Select Contractor", which look
// like free-text search fields by name but are NOT:
//   Cluster -> Site -> Project Type -> Package -> Sub-Package ->
//   Project Name -> Select Contractor -> Work Location ->
//   Work Area (Ark UI "combobox" primitive, a real <input>, gated by
//     Work Location) -> Activity -> Sub-Activity (gated by Activity) ->
//   From (date) -> To (date) -> Apply / Reset buttons.
//
// Work Area/Sub-Activity are NOT html-disabled while their parent is
// unset (no `disabled` attribute or aria-disabled) — they just show a
// "Select X first" hint (a `placeholder` for Work Area's real <input>,
// literal button text for Sub-Activity) and have ZERO options until the
// parent is picked. getFieldOptionCount() checks the real signal (does
// opening it yield any options) rather than trusting the hint text alone.
//
// From/To are `readonly` inputs (confirmed live) — typing into them does
// nothing; the actual value is set by clicking the adjacent "Open date
// picker" button and picking a day cell from the calendar that opens
// directly in day view (`data-view="day"`, cells carry
// `data-value="YYYY-MM-DD"`).
//
// The drawer is an Ark UI dialog styled as a right-side drawer
// (`data-scope="dialog" data-part="content"` — NOT `data-scope="drawer"`).
// IMPORTANT: the TRIGGER button also carries `data-scope="dialog"` and
// gets `data-state="open"` once toggled, so a bare
// `[data-scope="dialog"][data-state="open"]` selector's first DOM match is
// the trigger, not the content panel — confirmed live this silently broke
// every query scoped that way. Always scope to `data-part="content"` too.
//
// The Detail Records table is a react-data-grid (`role="row"`/
// `role="gridcell"`, same library as the Reassign feature's grid) — data
// rows carry `aria-rowindex >= 2` (row 1 is the header); virtualization is
// a real risk for LARGE result sets but not for the small filtered sets
// this page's methods are used to verify. NOTE "Work Area" also appears
// as a table COLUMN HEADER — always scope field locators to `this.drawer`,
// never search the bare page for field label text.
class DashboardFilterPage extends BasePage {
  constructor(page) {
    super(page);

    this.rfiToggle = page.locator('button, div').filter({ hasText: /^RFI$/ }).first();
    this.ncToggle  = page.locator('button, div').filter({ hasText: /^NC$/ }).first();

    this.filterTrigger = page.locator('text=Filter').first();
    this.drawer = page.locator('[data-scope="dialog"][data-part="content"]').filter({ hasText: 'Filter' });
    this.closeButton = this.drawer.locator('[data-part="close-trigger"]');

    // exact:true on Package/Activity — confirmed live that plain substring
    // name-matching makes 'Package' also match 'Sub-Package' (and
    // 'Activity' match 'Sub-Activity'), throwing a strict-mode violation.
    this.clusterField      = this.drawer.getByRole('combobox', { name: 'Cluster' });
    this.siteField         = this.drawer.getByRole('combobox', { name: 'Site' });
    this.projectTypeField  = this.drawer.getByRole('combobox', { name: 'Project Type' });
    this.packageField      = this.drawer.getByRole('combobox', { name: 'Package', exact: true });
    this.subPackageField   = this.drawer.getByRole('combobox', { name: 'Sub-Package' });
    this.projectNameField  = this.drawer.getByRole('combobox', { name: 'Project Name' });
    this.contractorField   = this.drawer.getByRole('combobox', { name: 'Select Contractor' });
    this.workLocationField = this.drawer.getByRole('combobox', { name: 'Work Location' });
    this.workAreaField     = this.drawer.getByRole('combobox', { name: 'Work Area' });
    this.activityField     = this.drawer.getByRole('combobox', { name: 'Activity', exact: true });
    this.subActivityField  = this.drawer.getByRole('combobox', { name: 'Sub-Activity' });

    this.openDatePickerButtons = this.drawer.getByRole('button', { name: 'Open date picker' });
    this.fromDateTrigger = this.openDatePickerButtons.nth(0);
    this.toDateTrigger   = this.openDatePickerButtons.nth(1);
    // MUST be scoped to the OPEN one. Ark UI leaves a CLOSED date-picker's
    // content node in the DOM (same trait documented throughout this suite for
    // listboxes and dialogs — see WAMPage/BasePage), and the From/To date
    // fields each render their OWN content node (distinct ids, e.g.
    // "datepicker::rq::content" vs "datepicker::rv::content"). So the first
    // date field's calendar stays in the DOM, hidden, after use — and the
    // moment a SECOND date field opens its own calendar, this locator without
    // [data-state="open"] matches BOTH and Playwright's strict mode throws:
    //
    //   strict mode violation: locator(...) resolved to 2 elements:
    //     1) <div data-state="open" .../> (the one we want)
    //     2) <div hidden data-state="closed" .../> (left over from before)
    //
    // Confirmed live 2026-09-05: every test in this file that opened a SECOND
    // date field in the same session hit this — 10 of 28 tests, every one of
    // them touching From or To after some earlier test already had.
    this.datePickerCalendar = page.locator(
      '[data-scope="date-picker"][data-part="content"][data-state="open"]'
    );

    this.applyButton = this.drawer.getByRole('button', { name: 'Apply' });
    this.resetButton = this.drawer.getByRole('button', { name: 'Reset' });

    this.gridRows = page.locator('[role="row"][aria-rowindex]').filter({ has: page.locator('[role="gridcell"]') });
    this.noRecordsText = page.locator('text=/no record|no data|nothing found/i').first();
  }

  async goto() {
    await this.navigate(`${process.env.BASE_URL}/dashboard`);
    await this.page.waitForLoadState('networkidle');
    await this.filterTrigger.waitFor({ state: 'visible', timeout: 5000 });
  }

  async switchToRFI() {
    await this.rfiToggle.click();
    await this.page.waitForTimeout(1000);
  }

  async switchToNC() {
    await this.ncToggle.click();
    await this.page.waitForTimeout(1000);
  }

  async openFilter() {
    await this.filterTrigger.click();
    await this.drawer.waitFor({ state: 'visible', timeout: 5000 });
  }

  async closeFilter() {
    if (await this.closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.closeButton.click();
      await this.drawer.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  // selectMultiAware, NOT selectFirstDropdownOption/selectDropdownOption —
  // confirmed live that Work Location (and likely other filter fields) is
  // multi-select (picking one leaves a removable chip AND the listbox
  // open for further picks). A plain single-select method has no way to
  // notice that and leaves the listbox open, whose floating positioner
  // then sits on top of and blocks whatever field comes next in the
  // drawer — exactly the same "stuck-open-listbox" bug class already
  // fixed once for the Add User dialog's Cluster/Sites fields (see
  // BasePage.selectMultiAware's own doc comment) and repeated here because
  // this filter's fields weren't yet proven single-select.
  async selectField(field, value) {
    if (value === '__first__') return this.selectMultiAware(field, { count: 1 });
    return this.selectMultiAware(field, { preferred: [value], count: 1 });
  }

  // Opens a dropdown and counts its options WITHOUT picking one, then
  // closes it again — the direct, reliable signal for whether a
  // cascade-gated field (Work Area/Sub-Activity) actually has anything to
  // offer yet, rather than inferring from placeholder/hint text.
  async getFieldOptionCount(field) {
    const listbox = await this.openDropdown(field);
    const count = await listbox.locator('[role="option"]').count();
    await this.page.keyboard.press('Escape').catch(() => {});
    await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return count;
  }

  // Secondary/informational only — see header comment on why this isn't
  // the primary cascade signal (the field is never HTML-disabled, and this
  // hint text's update timing relative to real option availability is
  // unconfirmed).
  async getFieldGatingText(field) {
    const placeholder = await field.getAttribute('placeholder').catch(() => null);
    if (placeholder) return placeholder;
    return (await field.innerText()).trim();
  }

  // Work Location (and presumably every other multi-select filter field
  // here) is an Ark UI "tags input" combobox: the `role="combobox"`
  // `<input>` (what `workLocationField` resolves to) is ONLY EVER a search/
  // typeahead box. CONFIRMED LIVE 2026-09-05 via a DOM dump
  // (tests/specs/inspection/00_inspect_work_location_chip.spec.js, taken
  // both before and immediately after selecting a real value): its `value`
  // attribute is "" in BOTH states — a selection never touches the input at
  // all. Each picked item instead renders as its own CHIP (a sibling `<div>`
  // holding the label text plus a remove "x" icon), inside the SAME
  // `[data-part="trigger"]` button that wraps the input. So neither
  // `.textContent()` NOR `.inputValue()` on the input itself can ever answer
  // "is X selected" — both were tried here in turn, in successive live
  // reruns, and both always read empty regardless of the real selection
  // state. The trigger button (an Ark UI-stable `data-part`, not a fragile
  // atomic CSS class) is the right scope: its full text content includes
  // whatever chips are currently picked.
  selectedChipsContainer(field) {
    return field.locator('xpath=ancestor::*[@data-scope="combobox" and @data-part="trigger"][1]');
  }

  // Selecting Work Location doesn't always durably commit before the
  // cascade below it (Work Area) is acted on — confirmed live 2026-09-05,
  // ~2h into a full smoke run under load: three tests that proceeded
  // straight to Work Area right after selecting Work Location (previously
  // just `networkidle` + a fixed 1000ms sleep) later found Work Location's
  // own displayed selection missing. Polls for the selected chip to actually
  // render instead of trusting a fixed delay — a strictly stronger
  // precondition than the sleep it replaces: a fast commit is completely
  // unaffected, a slow one now gets real time to land instead of the next
  // step silently racing ahead of it. Throws a named error on timeout (same
  // philosophy as navigateCalendarToMonth) rather than proceeding into a
  // confusing downstream failure.
  async confirmWorkLocationSelected(text, { timeout = 15000, intervalMs = 300 } = {}) {
    const chips = this.selectedChipsContainer(this.workLocationField);
    const deadline = Date.now() + timeout;
    let lastSeen = '';
    while (Date.now() < deadline) {
      lastSeen = await chips.textContent().catch(() => '');
      if (lastSeen && lastSeen.includes(text)) return;
      await this.page.waitForTimeout(intervalMs);
    }
    throw new Error(
      `DashboardFilterPage: Work Location never visibly showed "${text}" within ${timeout}ms of selecting it ` +
      `(last seen: "${lastSeen}"). Either the selection is genuinely slow under load, or something is resetting it.`
    );
  }

  // From/To are readonly — set via the calendar popup, not typing. Opens
  // directly in day view; clicks whichever day cell is passed (default:
  // whatever's first currently rendered, i.e. "some valid date", since
  // exact date rarely matters for exercising the filter itself).
  //
  // `value` (an exact "YYYY-MM-DD") can name a date OUTSIDE the month the
  // calendar opens on — see navigateCalendarToMonth below for how that gets
  // reached at all.
  async selectDateField(trigger, { value } = {}) {
    await trigger.click();
    await this.datePickerCalendar.waitFor({ state: 'visible', timeout: 5000 });

    if (value) {
      // The calendar always OPENS on the current month, regardless of how far
      // away `value` is — so reach its month first, THEN look for the day cell.
      // Cheap when value is already in view (the day-view check below is what
      // most callers hit): navigateCalendarToMonth no-ops immediately if
      // day-view cells with this exact value are already visible.
      await this.navigateCalendarToMonth(value);
    }

    // NOT `.first()` of every day cell when no exact value is asked for — the
    // calendar's day GRID renders "outside range" placeholder cells for the
    // tail of the previous month / head of the next one to fill the grid, and
    // those carry `data-disabled` / `aria-disabled="true"` (confirmed live
    // 2026-09-05: the literal first DOM match was 31 August, greyed out,
    // `data-outside-range=""`). Clicking a disabled cell never succeeds —
    // Playwright's actionability retry just spins on "element is not enabled"
    // for the full 30s. Exclude disabled cells so this always lands on a real,
    // clickable day in the CURRENT month.
    const cell = value
      ? this.datePickerCalendar.locator(`[data-part="table-cell-trigger"][data-value="${value}"]`)
      : this.datePickerCalendar
          .locator('[data-part="table-cell-trigger"][data-view="day"]:not([data-disabled])')
          .first();
    await cell.waitFor({ state: 'visible', timeout: 5000 });
    await cell.click();
    await this.datePickerCalendar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // Navigates the OPEN calendar to the month containing `value` ("YYYY-MM-DD"),
  // via its year-view/month-view drill-down, so a day cell for `value` actually
  // exists in the DOM afterward.
  //
  // WHY THIS EXISTS. Confirmed independently two ways on 2026-09-05 — by a
  // live test failure AND by the app owner manually driving the same open
  // calendar in a headed run — that this picker only ever renders ONE month's
  // day-grid at a time, with no way to jump straight to an arbitrary day.
  // Several SM16 tests carry hardcoded dates from the original spec
  // (2001-01-01, 2020-01-01, 2026-12-31) that are nowhere near "today"'s
  // month, and clicking a day cell that was never rendered just times out —
  // which is what happened here before this existed.
  //
  // THE MECHANISM, now CONFIRMED LIVE 2026-09-05 (from a failure's own page
  // snapshot, captured mid-navigation) — and it is NOT the two-step
  // year-number-grid -> month-grid drill-down originally guessed here. There
  // is no separate grid of bare year numbers at all. "Switch to year view"
  // (the real accessible name, on the day view) lands directly on a grid of
  // the current year's 12 MONTHS (cells are buttons named e.g. "January
  // 2026", rendered text just "Jan") — Zag.js's "year view" name refers to
  // "a whole year's worth of cells", not "a grid of years". That grid pages
  // by YEAR via two buttons with their own real, confirmed accessible names:
  // "Switch to previous year" / "Switch to next year" (the latter disabled
  // once at the current year — consistent with the app owner's separately
  // confirmed "From can't go past today" rule). So reaching an arbitrary
  // year needs no month-view step at all: page year-by-year on this one grid
  // until the exact target month+year button exists, then click it straight
  // into day view.
  async navigateCalendarToMonth(value) {
    const [year, month] = value.split('-').map(Number);

    // Fast path: the target day is already reachable without navigating at
    // all (the common case — most callers ask for a date near "today").
    const already = this.datePickerCalendar.locator(`[data-part="table-cell-trigger"][data-value="${value}"]`);
    if (await already.isVisible({ timeout: 500 }).catch(() => false)) return;

    const viewTrigger = this.datePickerCalendar.getByRole('button', { name: /switch to year view/i });
    if (!(await viewTrigger.isVisible({ timeout: 2000 }).catch(() => false))) {
      throw new Error(
        `DashboardFilterPage: date ${value} is not in the calendar's current month, and no ` +
        `"Switch to year view" control was found to navigate there. Either the accessible ` +
        `name changed, or this picker has no way to jump directly to a distant date.`
      );
    }
    await viewTrigger.click();

    const MONTH_NAMES = [
      'January', 'February', 'March', 'April', 'May', 'June',
      'July', 'August', 'September', 'October', 'November', 'December',
    ];
    // Full accessible name match ("January 2001"), not text-content
    // filtering — the cell's rendered text is just the abbreviation ("Jan"),
    // so a text filter can't tell one year's January from another's; the
    // accessible name is the only place the year actually appears per cell.
    const monthCell = this.datePickerCalendar
      .getByRole('button', { name: `${MONTH_NAMES[month - 1]} ${year}`, exact: true });

    let found = await monthCell.isVisible({ timeout: 3000 }).catch(() => false);
    if (!found) {
      const direction = year < new Date().getFullYear() ? 'previous' : 'next';
      const pager = this.datePickerCalendar.getByRole('button', { name: new RegExp(`switch to ${direction} year`, 'i') });
      for (let attempt = 0; attempt < 100 && !found; attempt++) {
        if (!(await pager.isVisible({ timeout: 1000 }).catch(() => false))) break;
        if (await pager.isDisabled().catch(() => false)) break;
        await pager.click();
        await this.page.waitForTimeout(150);
        found = await monthCell.isVisible({ timeout: 500 }).catch(() => false);
      }
    }
    if (!found) {
      throw new Error(
        `DashboardFilterPage: paged the year-grid toward ${year} looking for a ` +
        `"${MONTH_NAMES[month - 1]} ${year}" button, but it never appeared. Either that year is ` +
        `unreachable this way (blocked by a max/min-date restriction, e.g. the "From" field's ` +
        `today-or-earlier rule), or the pager/cell accessible names differ from what's assumed here.`
      );
    }
    await monthCell.click();

    // Should now be back on day view, scoped to the target year/month.
    await this.datePickerCalendar
      .locator(`[data-part="table-cell-trigger"][data-value="${value}"]`)
      .waitFor({ state: 'visible', timeout: 3000 });
  }

  // User-specified: the table's actual data refresh after Apply/Reset
  // takes 10-15s to reflect server-side, separate from (and longer than)
  // the general UI-interaction wait budget used everywhere else on this
  // page — networkidle alone is not enough of a signal here.
  async clickApply() {
    await this.applyButton.click();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(15000);
  }

  async clickReset() {
    await this.resetButton.click();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(15000);
  }

  async getDataRowCount() {
    return await this.gridRows.count();
  }

  // All visible cell texts in a given 0-indexed column, across every
  // currently-rendered data row — used to confirm a filter's column
  // actually reflects the picked value, not just that the row count changed.
  async getColumnValues(columnIndex) {
    const count = await this.getDataRowCount();
    const values = [];
    for (let i = 0; i < count; i++) {
      const cell = this.gridRows.nth(i).locator('[role="gridcell"]').nth(columnIndex);
      values.push((await cell.innerText()).trim());
    }
    return values;
  }

  async hasNoRecords() {
    if (await this.noRecordsText.isVisible({ timeout: 2000 }).catch(() => false)) return true;
    return (await this.getDataRowCount()) === 0;
  }
}

module.exports = DashboardFilterPage;
