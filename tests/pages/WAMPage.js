const { BasePage } = require('./BasePage');

// Covers the Admin "WAM" (Work Area Management) section (/wam), reached from
// the dashboard sidebar.
//
// Main panel ("My Assignment"): read-only Role field (shows the logged-in
// user's role) plus Cluster/Sites/Work Location filters to VIEW your own
// assignments, and an add-icon (bare `<svg class="lucide-user-plus"
// role="button">`, not wrapped in a real <button>) that opens the
// "Add Details" dialog used to CREATE a new assignment.
//
// Add Details dialog: Role → Cluster → Sites → Work Location → Package,
// each revealing the next once picked. Note WAM's Cluster options
// (Rajasthan/Gujarat) are geographic clusters — a different data set from
// SO Mapping's Cluster field (KHAVDA/Rajasthan), which uses site-level
// names. Under Gujarat, Sites include Khavda; Work Location A-06c exists
// there. Once Package is picked, one row per Work Area appears (BL01...),
// each an assignable user combobox — same row structure as SO Mapping's
// activity rows (empty <label>, visible name in a sibling
// `<p class="fw_medium">` within the same `div.d_grid`).
//
// Persistence model differs from SO Mapping: picking a user in a row does
// NOT auto-save — everything is batched into a single
// `PUT /api/v1/personnel-region-assignments/personnelRegionAssignment` when
// Submit is clicked. Submit resets the dialog's fields back to blank rather
// than closing it (confirmed: "Select Role" reappears in the same dialog).
//
// Contractor Incharge (and presumably similar roles) has an extra "Service
// Order" field after Package — pick the SO Mapping vendor here to gate which
// work this CI can be assigned against. WAM's Cluster field has been
// observed to show "Gujarat" on one load and "KHAVDA" on another for what's
// meant to be the same location (deployment/DB state flakiness) — pass an
// array of candidates to fillAssignmentFilters()'s `cluster` to handle this.
class WAMPage extends BasePage {
  constructor(page) {
    super(page);

    // "WAM" text also matches the sidebar link, so use the panel heading
    // (unique to the page content) to confirm real load.
    this.myAssignmentHeading = page.locator('text=My Assignment');
    this.assignedAreasHint   = page.locator('text=Select to view your assigned areas');

    // Main panel's own view-filter dropdowns (viewing your own assignments)
    this.viewRoleField    = page.getByRole('combobox', { name: /^Role/i }).first();
    this.viewClusterField = page.getByRole('combobox', { name: /Cluster/i }).first();
    this.viewSitesField   = page.getByRole('combobox', { name: /Sites/i }).first();
    this.viewWorkLocationField = page.getByRole('combobox', { name: /Work Location/i }).first();

    this.addAssignmentIcon = page.locator('svg.lucide-user-plus').first();
    this.dialog = page.locator('[data-scope="dialog"][data-part="content"]');

    this.dialogRoleDropdown         = this.dialog.getByRole('combobox', { name: /^Role/i });
    this.dialogClusterDropdown      = this.dialog.getByRole('combobox', { name: /Cluster/i });
    this.dialogSitesDropdown        = this.dialog.getByRole('combobox', { name: /Sites/i });
    this.dialogWorkLocationDropdown = this.dialog.getByRole('combobox', { name: /Work Location/i });
    this.dialogPackageDropdown      = this.dialog.getByRole('combobox', { name: /Package/i });
    // Only present for roles like Contractor Incharge — gates which Service
    // Order (and therefore which SO-mapped work) the assignment applies to.
    // Unlike the other fields (Ark UI `select`, a <button role="combobox">),
    // this is an Ark UI `combobox` — a searchable <input role="combobox">
    // whose selected text lives in the `value` attribute. Assert with
    // toHaveValue(), not toContainText()/innerText().
    this.dialogServiceOrderDropdown = this.dialog.getByRole('combobox', { name: /Service Order/i });

    this.submitButton = this.dialog.getByRole('button', { name: 'Submit' });
    this.dialogCloseButton = this.dialog.locator('[data-part="close-trigger"]');
    this.toast = page.locator('[data-scope="toast"]').first();
  }

  async goto(dashboard) {
    // Defensive: a previous test sharing this same page/session may have
    // left a stray open listbox or dialog stuck — recover before this
    // test's own interactions can be blocked by it (same reasoning as
    // UserManagementPage.goto()).
    await this.closeAnyOpenListbox();
    await this.closeDialog();
    await dashboard.navWAM.click();
    await this.waitForLoad();
  }

  async waitForLoad() {
    await this.myAssignmentHeading.waitFor({ state: 'visible', timeout: 30000 });
  }

  async openAddDetails() {
    await this.addAssignmentIcon.click();
    await this.dialog.waitFor({ state: 'visible', timeout: 10000 });
  }

  // Reads every option currently offered in the Add Details dialog's Role
  // dropdown WITHOUT picking one — used to verify role-hierarchy
  // restriction (e.g. a logged-in Project Manager should only see
  // Execution Lead/Quality Lead here, not the full 10-role list Admin
  // sees). Closes the listbox afterward via Escape so the dialog is left in
  // the same state fillAssignmentFilters() expects to start from.
  async getAvailableRoleOptions() {
    const listbox = await this.openDropdown(this.dialogRoleDropdown);
    const options = (await listbox.locator('[role="option"]').allInnerTexts())
      .map(t => t.trim());
    await this.page.keyboard.press('Escape').catch(() => {});
    await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return options;
  }

  // Runs Role → Cluster → Sites → Work Location → Package (→ Service Order,
  // for roles like Contractor Incharge that have it) in the dialog and waits
  // for the resulting rows to render. A fixed wait after the last field is
  // needed even after networkidle — the per-row assignment comboboxes can
  // render blank/empty-option momentarily right after the request settles.
  //
  // Cluster/Sites/Work Location/Package/Service Order are each filled ONLY
  // if they're actually visible — confirmed live that WAM's cascade depth
  // (and therefore the row granularity that appears afterward) is role-
  // dependent, same as the Add User dialog: Execution Engineer/Quality
  // Inspector/Execution Lead/Quality Lead/Contractor Incharge/Contractor
  // Manager go all the way to Package (rows = Work Areas); Project
  // Manager/Plot Admin stop at Sites (rows = Work Locations); Site Admin
  // stops at Cluster (rows = Sites); Cluster Admin has NO location fields
  // at all (rows = Clusters themselves). Callers can pass the full set of
  // values unconditionally — whichever ones the current role doesn't ask
  // for are simply skipped rather than timing out.
  //
  // `cluster` may be a single string or an array of acceptable candidates —
  // WAM's Cluster options have been observed to vary between "Gujarat" and
  // "KHAVDA" for what's meant to be the same location, depending on
  // deployment/DB state.
  async fillAssignmentFilters({ role, cluster, site, workLocation, package: pkg, serviceOrder }) {
    await this.selectDropdownOption(this.dialogRoleDropdown, role);

    if (cluster != null && await this.dialogClusterDropdown.isVisible({ timeout: 7000 }).catch(() => false)) {
      if (Array.isArray(cluster)) {
        await this.selectDropdownOptionAny(this.dialogClusterDropdown, cluster);
      } else {
        await this.selectDropdownOption(this.dialogClusterDropdown, cluster);
      }
    }
    if (site != null && await this.dialogSitesDropdown.isVisible({ timeout: 7000 }).catch(() => false)) {
      await this.selectDropdownOption(this.dialogSitesDropdown, site);
    }
    if (workLocation != null && await this.dialogWorkLocationDropdown.isVisible({ timeout: 7000 }).catch(() => false)) {
      await this.selectDropdownOption(this.dialogWorkLocationDropdown, workLocation);
    }
    if (pkg != null && await this.dialogPackageDropdown.isVisible({ timeout: 7000 }).catch(() => false)) {
      await this.selectDropdownOption(this.dialogPackageDropdown, pkg);
    }
    if (serviceOrder) {
      await this.page.waitForLoadState('networkidle');
      await this.page.waitForTimeout(1000);
      await this.selectDropdownOption(this.dialogServiceOrderDropdown, serviceOrder);
    }
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(2000);
  }

  // Scopes to the grid row for a given Work Area code (e.g. "BL01") — same
  // div.d_grid + exact-text pattern as SOMappingPage.getActivityRow.
  getWorkAreaRow(areaCode) {
    return this.dialog.locator('div.d_grid')
      .filter({ has: this.page.getByText(areaCode, { exact: true }) });
  }

  async selectWorkAreaUser(areaCode, userName) {
    const combo = this.getWorkAreaRow(areaCode).locator('[role="combobox"]');
    await this.selectDropdownOption(combo, userName);
  }

  async getWorkAreaUserValue(areaCode) {
    const combo = this.getWorkAreaRow(areaCode).locator('[role="combobox"]');
    return (await combo.innerText()).trim();
  }

  // General rule: leave a row alone if it's already mapped to userName;
  // only change it if it's unmapped or mapped to someone else. Returns
  // whether a change was actually made, so the caller can tell which toast
  // to expect from Submit ("Assigned successfully" vs "No changes to save").
  //
  // Only proven safe for Work-Area-level rows (Execution Engineer/Quality
  // Inspector/Contractor Incharge today), which are single-assignee — one
  // pick simply replaces whoever was there. For rows where SEVERAL people
  // can be assigned at once (Site/Cluster/Work-Location-level rows for
  // Plot Admin/Site Admin/Cluster Admin, confirmed live to already show
  // multiple comma-separated names per row), use addAssigneeToRow instead —
  // it doesn't assume the row's popover reliably closes after a pick, which
  // this method's plain selectDropdownOption does.
  async assignUserIfNeeded(areaCode, userName) {
    const current = await this.getWorkAreaUserValue(areaCode);
    if (current.includes(userName)) return false;
    await this.selectWorkAreaUser(areaCode, userName);
    return true;
  }

  // For rows that allow MULTIPLE simultaneous assignees — adds userName
  // without disturbing whoever else is already there (an Ark UI multi-
  // select combobox ADDS on a click of an unchecked option, it doesn't
  // replace). Unlike assignUserIfNeeded/selectWorkAreaUser, this verifies
  // the popover actually closed afterward — same stuck-open-listbox risk
  // already found and fixed for the Add User dialog's Cluster/Sites fields
  // (see BasePage.selectMultiAware) had no prior evidence either way for
  // WAM's row-level comboboxes specifically, so this doesn't assume either.
  //
  // MUST check whether the popover is still open before pressing Escape —
  // confirmed live: for a role whose row combobox turned out to be
  // single-select (auto-closes right on pick, e.g. Project Manager, unlike
  // Plot Admin's genuinely multi-select row), pressing Escape unconditionally
  // found nothing left open to consume it locally, so it bubbled up and
  // closed the WHOLE "Add Details" dialog instead of just the row's
  // popover — leaving Submit unreachable. Same guard selectMultiAware
  // already uses in BasePage.js.
  async addAssigneeToRow(rowLabel, userName) {
    const combo = this.getWorkAreaRow(rowLabel).locator('[role="combobox"]');
    const current = (await combo.innerText()).trim();
    if (current.includes(userName)) return false;

    const listbox = await this.openDropdown(combo);
    const option = listbox.locator('[role="option"]').filter({ hasText: userName }).first();
    await option.waitFor({ state: 'visible', timeout: 5000 });
    await option.click();
    await this.page.waitForTimeout(300);

    const stillOpen = await listbox.isVisible({ timeout: 500 }).catch(() => false);
    if (stillOpen) {
      await this.page.keyboard.press('Escape').catch(() => {});
      const closed = await listbox.waitFor({ state: 'hidden', timeout: 3000 })
        .then(() => true).catch(() => false);
      if (!closed) {
        await combo.click().catch(() => {});
        await listbox.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      }
    }
    return true;
  }

  // Returns the Submit toast's text (e.g. "Assigned successfully" or
  // "No changes to save"). Do NOT gate this on a network response: when
  // nothing actually changed, the app appears to skip the PUT call entirely
  // and show the toast immediately, so waiting for that request first can
  // burn the whole timeout waiting for a call that never comes — and miss
  // the toast, which has often already appeared and auto-dismissed by then.
  // When there ARE changes, the request can take a while (e.g. after
  // manually clearing a mapping so everything needs reassigning), so the
  // poll window here needs real headroom either way. The toast container
  // itself is always present in the DOM (empty most of the time) and Ark UI
  // appears to swap in a fresh element when it actually mounts a toast, so
  // re-resolve the locator on each check rather than reading a single
  // elementHandle snapshot.
  //
  // Poll window widened 30s -> 75s — confirmed live: some Work Locations
  // (e.g. A-06c) have far more total rows than the 20 "BL0x" ones the
  // original EE/QI/CI specs assumed (85 total, including Road/Drain/
  // Culvert entries), so the PUT payload/processing for a submit there can
  // take noticeably longer than for a smaller Work Location.
  async clickSubmit() {
    await this.submitButton.waitFor({ state: 'visible' });
    await this.submitButton.click();

    let toastText = '';
    for (let i = 0; i < 250 && !toastText; i++) {
      toastText = (await this.toast.innerText().catch(() => '')).trim();
      if (!toastText) await this.page.waitForTimeout(300);
    }

    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(1000);
    return toastText;
  }

  // Submit does NOT close the dialog (it resets the fields in place) — its
  // backdrop keeps intercepting clicks on the rest of the page until this is
  // called explicitly. Safe to call speculatively even when no dialog is
  // open (checks visibility first, no-ops otherwise) — used defensively in
  // goto() at the start of every test.
  async closeDialog() {
    if (await this.dialogCloseButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.dialogCloseButton.click();
      await this.dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }
}

module.exports = WAMPage;
