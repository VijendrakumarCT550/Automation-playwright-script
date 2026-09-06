const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { BasePage } = require('./BasePage');

// Covers the sidebar "Reports" section and the individual report pages it
// expands to (/reports/rfi-status, /reports/nc-status, /reports/so-mapping,
// /reports/wam, /reports/user-login). "Reports" itself is a COLLAPSIBLE
// PARENT treeitem, not a route — clicking it only expands/collapses its 5
// children in the sidebar (confirmed live: clicking it alone leaves the URL
// at whatever page was already open); the actual navigation happens on one
// of the child treeitems (DashboardPage.navItem('RFI status report') etc.).
//
// Report page layout (confirmed live via DOM dump,
// tests/specs/inspection/00_inspect_online_role_extensive.spec.js and its round-2/3/4
// follow-ups): a "Total Count : N" line, a Filter trigger and a Download
// trigger — BOTH real `<button>` elements but with NO accessible name, only
// an icon (`svg.lucide-funnel` / `svg.lucide-download` respectively; the
// getByRole('button', {name: /download/i}) guess failed live for exactly
// this reason) — then a sortable table (react-data-grid-style column
// headers with `svg.lucide-arrow-down-up`), row status icons
// (`svg.lucide-circle-check` / `svg.lucide-circle-alert`).
//
// The Filter trigger opens an Ark UI dialog (same `[data-scope="dialog"]
// [data-part="content"]` shape used everywhere else in this app) whose
// field set is near-identical to DashboardFilterPage's own drawer — same
// Cluster -> Site -> Project Type -> Package -> Sub-Package -> Project Name
// -> [Vendor Name instead of "Select Contractor"] -> Work Location -> Work
// Area -> Activity -> Sub-Activity -> From/To Date -> Reset/Apply, PLUS an
// "RFI Status" combobox this report has that the dashboard drawer doesn't.
// Only confirmed live for the RFI status report specifically — other
// reports (NC/SO mapping/WAM/User Login) likely have a different subset,
// so every field getter here is visibility-guarded rather than assumed
// present.
//
// Download produces a real .xlsx file (confirmed via magic bytes, "PK\x03\x04"
// = ZIP, which .xlsx is) named "RFI_Status_Report.xlsx" regardless of any
// filter applied — CONFIRMED LIVE that filtering DOES shrink it (82 total
// rows -> unfiltered 18502 bytes; RFI Status=Approved -> 27 rows -> filtered
// 10592 bytes), which is the whole point of downloadAndParse()'s row-count
// cross-check below.
class ReportsPage extends BasePage {
  constructor(page) {
    super(page);

    this.filterButton = page.locator('button').filter({ has: page.locator('svg.lucide-funnel') }).first();
    this.downloadButton = page.locator('button').filter({ has: page.locator('svg.lucide-download') }).first();

    this.filterPanel = page.locator('[data-scope="dialog"][data-part="content"], [role="dialog"]').first();
    this.applyButton = this.filterPanel.getByRole('button', { name: 'Apply' });
    this.resetButton = this.filterPanel.getByRole('button', { name: 'Reset' });

    // Only the RFI status report's confirmed-live field is exposed as a
    // named property — everything else goes through getFilterField() below
    // so an unconfirmed report doesn't get guessed-at dead locators.
    this.rfiStatusField = this.filterPanel.getByRole('combobox', { name: /status/i }).first();

    this.totalCountText = page.getByText(/Total Count\s*:\s*\d+/).first();
  }

  // No dedicated goto() — reached via DashboardPage.navItem('Reports').click()
  // (expands the sidebar section) then DashboardPage.navItem('<report name>').click()
  // (the actual navigation). Kept as two explicit steps in the caller rather
  // than bundled here, since every one of the 7 role specs already holds a
  // DashboardPage instance and the exact report name varies per call site.
  async waitForLoad(timeout = 20000) {
    await this.totalCountText.waitFor({ state: 'visible', timeout });
  }

  async getTotalCount() {
    const text = await this.totalCountText.innerText().catch(() => '');
    const match = text.match(/Total Count\s*:\s*(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  // CONFIRMED LIVE 2026-09-05 on SM18's CAD/SAD sweep: `waitForLoad`'s own
  // regex (`Total Count\s*:\s*\d+`) is satisfied by a "Total Count: 0"
  // PLACEHOLDER just as readily as the real number — the real total loads
  // moments later. Reading `getTotalCount()` immediately after `waitForLoad`
  // can catch that placeholder: both CAD and SAD read an "unfiltered" total
  // of exactly 0 this way, then a MOMENTS-LATER read (after applying the
  // Approved filter) came back with tens of thousands — proving the report
  // genuinely had data the whole time, just not yet rendered at the moment
  // of that first read. Same race class as DashboardPage's chart-fingerprint
  // pre-paint issue. Polls for a non-zero reading instead of trusting the
  // first one — this can only ever replace a premature 0 with the real
  // number; a role that genuinely has zero matching rows just exhausts the
  // timeout and returns 0 as before.
  async waitForRealTotalCount({ timeout = 10000, intervalMs = 300 } = {}) {
    const deadline = Date.now() + timeout;
    let count = await this.getTotalCount();
    while (count === 0 && Date.now() < deadline) {
      await this.page.waitForTimeout(intervalMs);
      count = await this.getTotalCount();
    }
    return count;
  }

  // Any filter-panel field by its accessible name substring — for reports
  // whose exact field set isn't confirmed live (everything except the RFI
  // status report's rfiStatusField), so a spec can still probe "does this
  // field exist" without a dedicated locator per report.
  getFilterField(namePattern) {
    return this.filterPanel.getByRole('combobox', { name: namePattern }).first();
  }

  async openFilter() {
    await this.filterButton.click();
    await this.filterPanel.waitFor({ state: 'visible', timeout: 10000 });
  }

  async closeFilterIfOpen() {
    if (await this.filterPanel.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Same close-trigger shape as every other Ark UI dialog in this app.
      const closeBtn = this.filterPanel.locator('[data-part="close-trigger"]');
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click();
      } else {
        await this.page.keyboard.press('Escape').catch(() => {});
      }
      await this.filterPanel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  // Confirmed live: the table's data refresh after Apply is not instant —
  // mirrors DashboardFilterPage.clickApply's own documented wait, same
  // underlying Detail-Records-style data refresh.
  async clickApply() {
    await this.applyButton.click();
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.waitForTimeout(3000);
    // Apply closes the panel itself (confirmed live) — don't wait on that,
    // just confirm the panel is gone so the next action isn't blocked by its
    // backdrop (this WAS the round-3 recon bug: downloading with the filter
    // dialog still open never fired a download event at all).
    await this.filterPanel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
  }

  // Downloads the current (filtered or not) report, saves it under
  // test-results/, parses it with the `xlsx` package, and returns
  // { rowCount, rows, headers } — `rows` is an array of plain objects keyed
  // by the header row. Caller compares rowCount against getTotalCount() and
  // inspects `rows` to confirm every row actually matches whatever filter
  // was applied (e.g. every row's "RFI Status" column equals "Approved") —
  // the concrete proof that a DOWNLOAD reflects the filter, not just the
  // on-screen table.
  //
  // MUST be called with the filter panel already closed — the panel's own
  // backdrop blocks the Download button's click otherwise (confirmed live,
  // round 3 of the recon: an open filter panel made the download event never
  // fire at all, no error, just a silent timeout).
  async downloadAndParse(labelForFilename = 'report') {
    await this.closeFilterIfOpen();

    // The bare "Timeout 30000ms exceeded while waiting for event download"
    // says nothing about WHY, and it has now cost real time twice. Seen live
    // 2026-09-06 on a pulse-test full-chain run: Execution Lead and Quality
    // Lead both failed here with exactly that message and nothing else —
    // while the SAME two roles' dashboard charts came back completely empty,
    // which points at a zero-row report rather than a broken Download button.
    //
    // That is a HYPOTHESIS, not a finding, so nothing here skips or softens
    // the download: this only captures what was on screen at the moment it
    // timed out — the Total Count, and any toast the app raised — and
    // rethrows. A zero-row report and a genuinely broken button then look
    // different in the log instead of identical, and the next run settles it
    // without needing another investigation from scratch.
    let download;
    try {
      [download] = await Promise.all([
        this.page.waitForEvent('download', { timeout: 30000 }),
        this.downloadButton.click(),
      ]);
    } catch (err) {
      const total = await this.getTotalCount().catch(() => null);
      const toast = await this.page
        .locator('[data-scope="toast"], [role="alert"]').first()
        .innerText({ timeout: 1000 }).catch(() => '');
      err.message =
        `${err.message}\n` +
        `  [downloadAndParse context] label="${labelForFilename}" ` +
        `totalCountOnScreen=${total === null ? 'unreadable' : total} ` +
        `toast=${toast ? JSON.stringify(toast.trim()) : 'none'} url=${this.page.url()}\n` +
        `  A totalCountOnScreen of 0 would mean there was nothing to export, which is a ` +
        `data/scope condition for this role rather than a broken Download control — ` +
        `see this method's comment.`;
      throw err;
    }
    const suggested = download.suggestedFilename();
    const safeLabel = labelForFilename.replace(/[^a-z0-9_-]/gi, '_');
    const savePath = path.join(__dirname, '..', '..', 'test-results', `${safeLabel}_${Date.now()}_${suggested}`);
    await download.saveAs(savePath);

    const workbook = XLSX.readFile(savePath);
    const firstSheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[firstSheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const headers = rows.length ? Object.keys(rows[0]) : [];

    return { suggested, savePath, rowCount: rows.length, rows, headers };
  }
}

module.exports = ReportsPage;
