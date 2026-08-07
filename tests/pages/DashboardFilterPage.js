const { BasePage } = require('./BasePage');

// Covers the Dashboard's "Detail Records" table and its "Filter" drawer
// (/dashboard). The table has its own RFI/NC toggle (separate from My
// Tasks' RFI/NC tabs) — same Filter drawer content for both, confirmed via
// DOM dump (tests/specs/00_inspect_dashboard_filter.spec.js): only the
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
    this.datePickerCalendar = page.locator('[data-scope="date-picker"][data-part="content"]');

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

  // From/To are readonly — set via the calendar popup, not typing. Opens
  // directly in day view; clicks whichever day cell is passed (default:
  // whatever's first currently rendered, i.e. "some valid date", since
  // exact date rarely matters for exercising the filter itself).
  async selectDateField(trigger, { value } = {}) {
    await trigger.click();
    await this.datePickerCalendar.waitFor({ state: 'visible', timeout: 5000 });

    const cell = value
      ? this.datePickerCalendar.locator(`[data-part="table-cell-trigger"][data-value="${value}"]`)
      : this.datePickerCalendar.locator('[data-part="table-cell-trigger"][data-view="day"]').first();
    await cell.waitFor({ state: 'visible', timeout: 5000 });
    await cell.click();
    await this.datePickerCalendar.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
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
