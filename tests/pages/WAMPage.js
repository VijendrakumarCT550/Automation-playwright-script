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

    // Main panel's own view-filter dropdowns (viewing your own assignments).
    //
    // viewRoleField is NOT a real combobox — confirmed live
    // (tests/specs/inspection/00_inspect_online_role_extensive.spec.js): the "Role"
    // field here is read-only display text ("Role" label directly above the
    // logged-in user's own role name, e.g. "Cluster Admin"), unlike the Add
    // Details dialog's Role field which genuinely is a combobox
    // (dialogRoleDropdown below). getByRole('combobox', ...) against it
    // resolves to nothing on the main page and hangs for the full timeout —
    // exposed as a `page.getByText(roleName)` check instead, since that's
    // the only thing worth asserting about it (own role is displayed), not a
    // pickable field.
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
    // The dialog renders a literal "Loading..." paragraph in place of the
    // row grid while it fetches the rows for the current filter selection.
    // Its presence is the one unambiguous "rows aren't ready yet" signal —
    // networkidle isn't, since the row fetch starts after the cascade
    // settles (see waitForRowsLoaded / resolveRowLabel).
    this.dialogLoadingText = this.dialog.getByText(/^Loading\.\.\.$/);

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

  // Confirms the "My Assignment" panel actually shows the logged-in user's
  // OWN role — see viewRoleField's comment above for why this is a text
  // check, not a field read.
  async ownRoleVisible(roleName) {
    // Scoped to "anywhere on the WAM page" rather than a specific ancestor
    // depth off myAssignmentHeading — the role name (e.g. "Cluster Admin")
    // is distinctive enough on this page that a false positive is not a
    // realistic risk, and the exact DOM distance from the heading to the
    // role text wasn't confirmed live down to the element.
    return this.page.getByText(roleName, { exact: true }).first()
      .isVisible({ timeout: 5000 }).catch(() => false);
  }

  // Fills whichever of the main panel's OWN view-filter cascade
  // (Cluster -> Sites -> Work Location) is actually visible — role-dependent
  // depth, same pattern as fillAssignmentFilters' dialog cascade (confirmed
  // live: Cluster Admin's own view cascade stops at Cluster).
  //
  // CONFIRMED LIVE this is also role-dependent in a second way, not just
  // depth: Cluster Admin's own Cluster field starts as an empty placeholder
  // and genuinely needs picking, but Plot Admin's whole cascade
  // (Cluster/Sites/Work Location) arrives ALREADY PRE-FILLED with their
  // resolved scope (KHAVDA/KHAVDA/A-06c, screenshot-confirmed) — there is
  // nothing to select, and trying to click-and-pick one anyway raced the
  // dropdown's open/close animation and threw "none of the candidates
  // found" even though the value shown was already correct. So: check the
  // CURRENT displayed value first (via BasePage's combobox innerText, same
  // "read before acting" idiom as WAMPage.assignUserIfNeeded elsewhere in
  // this file) and only attempt an active pick when it still shows a
  // placeholder ("Select ..."), never when a real value is already there.
  async _currentFieldValue(field) {
    return (await field.innerText().catch(() => '')).trim();
  }

  async _fillViewFieldIfPlaceholder(field, value) {
    const current = await this._currentFieldValue(field);
    if (current && !/^select\b/i.test(current)) return { changed: false, value: current };

    if (Array.isArray(value)) await this.selectDropdownOptionAny(field, value);
    else await this.selectDropdownOption(field, value);
    return { changed: true, value: await this._currentFieldValue(field) };
  }

  async viewOwnAssignments({ cluster, site, workLocation } = {}) {
    const hintVisibleBefore = await this.assignedAreasHint.isVisible({ timeout: 2000 }).catch(() => false);
    let filledAny = false;
    const resolved = {};

    if (cluster != null && await this.viewClusterField.isVisible({ timeout: 5000 }).catch(() => false)) {
      resolved.cluster = await this._fillViewFieldIfPlaceholder(this.viewClusterField, cluster);
      filledAny = true;
    }
    if (site != null && await this.viewSitesField.isVisible({ timeout: 3000 }).catch(() => false)) {
      resolved.site = await this._fillViewFieldIfPlaceholder(this.viewSitesField, site);
      filledAny = true;
    }
    if (workLocation != null && await this.viewWorkLocationField.isVisible({ timeout: 3000 }).catch(() => false)) {
      resolved.workLocation = await this._fillViewFieldIfPlaceholder(this.viewWorkLocationField, workLocation);
      filledAny = true;
    }

    if (Object.values(resolved).some(r => r.changed)) {
      await this.page.waitForLoadState('networkidle').catch(() => {});
      await this.page.waitForTimeout(500);
    }

    // NOTE: the "Select to view your assigned areas" hint is a STATIC
    // subheading, not a stateful placeholder — confirmed live it stays
    // visible even once every field already shows a real resolved value
    // (Plot Admin's screenshot: hint text AND "KHAVDA"/"KHAVDA"/"A-06c" all
    // present at once). Still returned for callers that want it, but
    // "resolved" (whether any processed field ended up with a real,
    // non-placeholder value) is the actual signal for "scope confirmed".
    const hintVisibleAfter = await this.assignedAreasHint.isVisible({ timeout: 2000 }).catch(() => false);
    const scopeConfirmed = Object.values(resolved).some(r => r.value && !/^select\b/i.test(r.value));
    return { filledAny, hintVisibleBefore, hintVisibleAfter, resolved, scopeConfirmed };
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
    // `serviceOrder` may be a single string or an array of acceptable
    // candidates, mirroring how `cluster` already works. The array form was
    // added for WIND: BAUER ENGINEERING INDIA PVT LTD holds FIVE different SO
    // numbers (confirmed live), so matching on vendor name alone can pick the
    // wrong service order — but it is not yet confirmed whether this dialog's
    // Service Order combobox renders the full "<number> - <VENDOR>" string the
    // way SO Mapping does, or just one part. Passing
    // [fullServiceOrderString, vendorName] tries the precise form first and
    // falls back to the name.
    //
    // Visibility guard added for the same reason every other field here has
    // one: only some roles render a Service Order field (Contractor Incharge
    // does, Execution Engineer / Quality Inspector don't), and without the
    // guard, passing a serviceOrder for a role that has no such field threw
    // instead of being ignored.
    if (serviceOrder
        && await this.dialogServiceOrderDropdown.isVisible({ timeout: 7000 }).catch(() => false)) {
      await this.page.waitForLoadState('networkidle');
      // 1000 -> 300: the networkidle above already guarantees a 500ms
      // quiet network window, so this is only a render buffer on top.
      await this.page.waitForTimeout(300);
      if (Array.isArray(serviceOrder)) {
        await this.selectDropdownOptionAny(this.dialogServiceOrderDropdown, serviceOrder);
      } else {
        await this.selectDropdownOption(this.dialogServiceOrderDropdown, serviceOrder);
      }
    }
    await this.page.waitForLoadState('networkidle');
    // 2000 -> 500, same reasoning: redundant with the networkidle above.
    // This one fires on EVERY fillAssignmentFilters call, so it was the
    // single largest fixed cost in the mapping flow.
    await this.page.waitForTimeout(500);
    await this.waitForRowsLoaded();
  }

  // Waits out the dialog's "Loading..." placeholder so callers that go
  // straight for a row (resolveRowLabel, getWorkAreaRow, assignUserIfNeeded)
  // aren't racing the row fetch. This replaces what the old flat
  // waitForTimeout(2000) above was really buying: that sleep was long enough
  // to cover the fetch on a fast env, which is why shortening it surfaced as
  // an intermittent "row label not found" on the slower pulse-test.
  //
  // Deliberately never throws — some cascade states legitimately render no
  // rows at all (a partial filter set, or a role whose rows only appear once
  // Package/Service Order is chosen), and it is not this helper's job to
  // decide which of those is expected. It only guarantees "not still
  // fetching"; the caller still asserts on what it needs.
  async waitForRowsLoaded(timeout = 15000) {
    await this.dialogLoadingText.first()
      .waitFor({ state: 'hidden', timeout })
      .catch(() => {});
  }

  // Every row label currently rendered in the dialog's grid for whatever
  // cascade is filled (Site rows, Work Location rows, Work Area rows —
  // whichever granularity the chosen target Role produces). This is the
  // instrument for verifying WAM's tree-visibility rule
  // (docs/work-region-hierarchy.md §2b: "WAM restricts the tree to only
  // what the logged-in user is mapped to") — comparing the row set a
  // narrower role sees against a broader-authority role's (e.g. Admin's)
  // row set for the SAME parent scope is how to tell a genuine visibility
  // bug apart from the parent scope simply having only one real child in
  // this environment (per §8's own warning: confirm structural-vs-WAM
  // before calling an absence a bug).
  async listAssignmentRows() {
    const rows = this.dialog.locator('div.d_grid');
    const texts = await rows.allInnerTexts();
    return texts
      .map(t => WAMPage._stripSelectedMarker(t.split('\n')[0]))
      .filter(Boolean);
  }

  // Scopes to the grid row for a given Work Area code (e.g. "BL01") — same
  // div.d_grid + exact-text pattern as SOMappingPage.getActivityRow.
  //
  // Case-INSENSITIVE exact match (a regex, not Playwright's plain
  // `exact: true` string form, which is case-sensitive) — confirmed live
  // (2026-08-21) that a row can render as "KHAVDA" while callers pass
  // "Khavda", same casing-only variation as Cluster/Site dropdown
  // OPTIONS already tolerate (selectDropdownOption's `.filter({hasText})`
  // is case-insensitive by default for a string). Still "exact" in the
  // sense that it anchors the whole trimmed text, so it won't accidentally
  // match an unrelated row whose label merely contains areaCode as a
  // substring.
  getWorkAreaRow(areaCode) {
    const escaped = areaCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return this.dialog.locator('div.d_grid')
      .filter({ has: this.page.getByText(new RegExp(`^${escaped}$`, 'i')) });
  }

  // For GENUINELY different names, not just a casing difference — e.g.
  // "Gujarat" vs "KHAVDA" for what's meant to be the same Cluster, a real
  // database/deployment data discrepancy (app owner independently
  // confirmed this live, 2026-08-21 — not something case-insensitivity
  // alone can paper over, since those are two different words, not case
  // variants of the same one). getWorkAreaRow above already handles pure
  // casing variation on its own now, so candidates passed here should
  // only ever be genuinely-different labels for the same location.
  //
  // This — not "too many existing assignees" as first suspected — is
  // what actually caused Cluster Admin's and Site Admin's own
  // WAM-mapping assignments to time out waiting for their row.
  // Deliberately stays exact-per-candidate (via the same case-insensitive
  // getWorkAreaRow) rather than switching to fuzzy/substring matching,
  // to avoid a different class of bug (accidentally matching an
  // unrelated row that merely contains the candidate text). Returns the
  // first candidate's row that actually exists; throws if none do, so a
  // genuine miss still fails loudly.
  async getWorkAreaRowAny(candidates) {
    for (const candidate of candidates) {
      const row = this.getWorkAreaRow(candidate);
      if (await row.count() > 0) return row;
    }
    throw new Error(`None of the candidate row labels [${candidates.join(', ')}] were found in this dialog`);
  }

  // Convenience wrapper returning just the matching LABEL string (not the
  // Locator) — for callers that pass a row label into the existing
  // string-based methods (addAssigneeToRow, getWorkAreaUserValue, etc.)
  // rather than chaining off the Locator directly.
  // Polls rather than checking once. `count()` is instantaneous — it never
  // waits — so the original single-pass version silently depended on
  // whatever sleep happened to precede it: if the row grid was still
  // fetching, it saw 0 rows and declared the label absent. Confirmed live
  // 2026-08-31 on pulse-test (Site Admin / Site Khavda): the failure
  // snapshot showed the dialog still rendering "Loading..." with no
  // div.d_grid rows at all, while the only "KHAVDA" on the page was the
  // Cluster FILTER's own selected value. networkidle doesn't cover it
  // either — the row fetch is an XHR kicked off after the cascade settles,
  // so the network can read idle before that request has even started.
  //
  // The error message now reports what was actually on screen, so a real
  // data/naming mismatch is distinguishable from a timing miss at a glance
  // instead of looking identical to one.
  async resolveRowLabel(candidates, timeout = 15000) {
    const deadline = Date.now() + timeout;
    do {
      for (const candidate of candidates) {
        if (await this.getWorkAreaRow(candidate).count() > 0) return candidate;
      }
      await this.page.waitForTimeout(200);
    } while (Date.now() < deadline);

    const stillLoading = await this.dialogLoadingText.count() > 0;
    const presentLabels = await this.dialog.locator('div.d_grid').allInnerTexts()
      .then(texts => texts.map(t => t.split('\n')[0].trim()).filter(Boolean).slice(0, 15))
      .catch(() => []);
    throw new Error(
      `None of the candidate row labels [${candidates.join(', ')}] were found in this dialog ` +
      `after ${timeout}ms. Still showing "Loading...": ${stillLoading}. ` +
      `Row labels actually present: ${presentLabels.length ? presentLabels.join(', ') : '(none)'}`
    );
  }

  // A row's assignee dropdown can list quite a few names (confirmed live,
  // 2026-08-27 — the Plot Admin -> Project Manager assignment step lost
  // its target user "PMcelUser53" because it rendered past the visible
  // slice of the popover and was never actually selected, even though the
  // user WAS present in the list). Same class of "target option not on
  // screen yet" issue NCCreatePage._selectScrollableOption already handles
  // for its own dropdowns — kept local to WAMPage (not folded into
  // BasePage's shared selectDropdownOption) for the same reason that one
  // stayed local: so this can't affect RFI/User-Management's own
  // already-validated dropdown handling. Scrolls the popover DOWN in small
  // steps (unlike NCCreatePage's single jump-to-top, since a long name
  // list here tends to hide the target further down, not past the top)
  // until the option is actually visible, or throws once scrolling stops
  // turning up anything new.
  async _findRowOptionWithScroll(listbox, userName, maxScrolls = 15) {
    const option = listbox.locator('[role="option"]').filter({ hasText: userName }).first();
    for (let i = 0; i < maxScrolls; i++) {
      if (await option.isVisible({ timeout: 500 }).catch(() => false)) return option;
      await listbox.hover().catch(() => {});
      await this.page.mouse.wheel(0, 300);
      // 150 -> 100: per-scroll-step render pause, paid up to maxScrolls(15)
      // times when the target sits far down a long assignee list.
      await this.page.waitForTimeout(100);
    }
    if (await option.isVisible({ timeout: 1000 }).catch(() => false)) return option;
    throw new Error(`User "${userName}" not found in this row's assignee dropdown after scrolling`);
  }

  async selectWorkAreaUser(areaCode, userName) {
    const combo = this.getWorkAreaRow(areaCode).locator('[role="combobox"]');
    const listbox = await this.openDropdown(combo);
    const option = await this._findRowOptionWithScroll(listbox, userName);
    await option.click();
    // 150 -> 80: Ark UI's post-pick state settle. Fires once per work-area
    // row, so it multiplies by row count (5 BL0x rows in the common case).
    await this.page.waitForTimeout(80);
  }

  // Ark UI appends a checkmark to the currently-SELECTED option's own
  // innerText (confirmed live, and already independently documented as
  // a false-alarm artifact in 18_wam_hierarchy.spec.js's role-restriction
  // log: "Quality Inspector\n✓" was the same option, not an extra role).
  // Strip it before comparing an option's text against a plain value —
  // without this, code that picks "whichever option ISN'T already
  // selected" can misidentify the checkmark-suffixed CURRENT option as a
  // different/unassigned one and pick that instead of a genuinely new
  // option. Only affects the COMPARISON; the raw (unstripped) text is
  // still what gets returned/logged for a genuinely different option,
  // which never carries the artifact since it isn't selected.
  static _stripSelectedMarker(text) {
    return text.replace(/\s*✓\s*$/, '').trim();
  }

  // For testing a PATCH/update (replacing whoever's currently assigned
  // with someone else) on a single-assignee row, without needing a
  // second known bulk-created user of that exact role — picks whichever
  // option the dropdown offers that ISN'T the current value, selects it,
  // and returns the name actually picked. Single-select only (a plain
  // pick always fully replaces) — not meant for multi-assignee rows,
  // where "update" means adding someone alongside existing assignees
  // instead (see addAssigneeToRow/addAnyUnassignedUser).
  //
  // Confirmed live (2026-08-21): without stripping the checkmark
  // artifact (see _stripSelectedMarker above), this could pick the
  // ALREADY-selected option right back (its raw text, e.g.
  // "QLjsxUser49\n✓", never equals the plain currentValue) — re-clicking
  // an already-selected single-select option is a no-op, which silently
  // "succeeded" at picking *something* while never actually changing the
  // assignment. That's what caused Quality Lead's and Contractor
  // Manager's update tests to see the OLD value still there afterward.
  //
  // Real edge case, not just a hypothetical: if the dropdown genuinely
  // has only ONE selectable option (the current value itself), there is
  // NO alternative to update to — that's a legitimate "can't test update
  // here" state, not a bug. Returns `null` rather than throwing, so
  // callers can `test.skip()` with a clear reason instead of the test
  // reading as a failure over missing test data.
  async selectDifferentWorkAreaUser(areaCode, currentValue) {
    const combo = this.getWorkAreaRow(areaCode).locator('[role="combobox"]');
    const listbox = await this.openDropdown(combo);
    const options = listbox.locator('[role="option"]');
    const texts = (await options.allInnerTexts()).map(t => t.trim());
    const target = currentValue.trim();
    const differentIndex = texts.findIndex(t => t && WAMPage._stripSelectedMarker(t) !== target);
    if (differentIndex === -1) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      return null;
    }
    const differentName = texts[differentIndex];
    await options.nth(differentIndex).click();
    await this.page.waitForTimeout(150);
    return differentName;
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

  // Clears whatever's currently assigned to a Work Area row via its
  // "Clear value" button (visible whenever the row has a value — see
  // assignUserIfNeeded's row snapshot). No-ops if the row is already empty
  // (no Clear value button to click). Does NOT call Submit — caller does
  // that once, after clearing/reassigning every row it needs to.
  async clearWorkAreaUser(areaCode) {
    const row = this.getWorkAreaRow(areaCode);
    const clearBtn = row.getByRole('button', { name: 'Clear value' });
    if (await clearBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await clearBtn.click();
      await this.page.waitForTimeout(150);
      return true;
    }
    return false;
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
    // See _findRowOptionWithScroll's comment — this row's user list can
    // render the target past the popover's initially-visible slice.
    const option = await this._findRowOptionWithScroll(listbox, userName);
    await option.click();
    // 300 -> 150: settle after a multi-select toggle, before probing whether
    // Ark left the listbox open.
    await this.page.waitForTimeout(150);

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

  // Opposite of addAssigneeToRow — REMOVES userName from a multi-assignee
  // row without disturbing whoever else is there, rather than adding them.
  // Ark UI's multi-select combobox TOGGLES an option on a click (confirmed
  // by addAnyUnassignedUser's own comment, where this toggle-off behavior
  // was originally a bug to avoid) — here that's exactly the wanted
  // mechanism, applied deliberately: clicking an ALREADY-selected option
  // removes it. Added 2026-08-27 per user request, for
  // 18_wam_hierarchy.spec.js's cascade tests — on a shared, persistent-
  // state environment, a cascade step whose intended assignee was ALREADY
  // mapped by an earlier/unrelated run makes the assign step a silent
  // no-op (assignUserIfNeeded/addAssigneeToRow both skip the real UI
  // action when the value already matches), so removing first forces every
  // run to genuinely exercise the assignment mechanism instead of
  // sometimes skipping it. No-ops (returns false) if userName isn't
  // currently in the row at all — nothing to remove.
  async removeAssigneeFromRow(rowLabel, userName) {
    const combo = this.getWorkAreaRow(rowLabel).locator('[role="combobox"]');
    const current = (await combo.innerText()).trim();
    if (!current.includes(userName)) return false;

    const listbox = await this.openDropdown(combo);
    // See _findRowOptionWithScroll's comment — this row's user list can
    // render the target past the popover's initially-visible slice. Still
    // matches here even though the SELECTED option's raw text carries the
    // checkmark artifact (e.g. "QLjsxUser49\n✓") — hasText is a substring
    // match, not exact.
    const option = await this._findRowOptionWithScroll(listbox, userName);
    await option.click();
    // 300 -> 150: settle after a multi-select toggle, before probing whether
    // Ark left the listbox open.
    await this.page.waitForTimeout(150);

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

  // Same shape as addAssigneeToRow, but for testing a multi-assignee row's
  // PATCH/update semantics — app owner's explicit choice (2026-08-21):
  // "update" for these rows means adding a new person ALONGSIDE existing
  // assignees, not replacing anyone (there's no single-person-replace
  // action in this UI). Picks whichever option ISN'T already in the row's
  // current comma-joined value, rather than needing a specific known
  // not-yet-assigned user name. Returns the name actually picked.
  //
  // Confirmed live (2026-08-21) — this is the destructive version of the
  // same checkmark-artifact bug _stripSelectedMarker exists for: an
  // ALREADY-selected option's raw text (e.g. "CADdckUser49\n✓") never
  // matches its plain form in currentNames, so without stripping it here
  // too, this could misidentify an already-selected person as
  // "unassigned" and click them — which for Ark UI's multi-select
  // TOGGLES THEM OFF instead of adding someone new. That's what wiped
  // Cluster Admin's row to empty and dropped names from Site
  // Admin's/Project Manager's rows the first time this ran.
  //
  // Real edge case, not just hypothetical: if literally every possible
  // person is already assigned to this row, there's no one left to add —
  // a legitimate "can't test update here" state, not a bug. Returns
  // `null` rather than throwing, same reasoning as
  // selectDifferentWorkAreaUser, so callers can test.skip() instead of
  // this reading as a failure.
  async addAnyUnassignedUser(rowLabel) {
    const combo = this.getWorkAreaRow(rowLabel).locator('[role="combobox"]');
    const currentText = (await combo.innerText()).trim();
    const currentNames = currentText ? currentText.split(',').map(n => n.trim()) : [];

    const listbox = await this.openDropdown(combo);
    const options = listbox.locator('[role="option"]');
    const texts = (await options.allInnerTexts()).map(t => t.trim());
    const unassignedIndex = texts.findIndex(t => t && !currentNames.includes(WAMPage._stripSelectedMarker(t)));
    if (unassignedIndex === -1) {
      await this.page.keyboard.press('Escape').catch(() => {});
      await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
      return null;
    }
    const pickedName = texts[unassignedIndex];
    await options.nth(unassignedIndex).click();
    // 300 -> 150: settle after a multi-select toggle, before probing whether
    // Ark left the listbox open.
    await this.page.waitForTimeout(150);

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
    return pickedName;
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
    // 1000 -> 300: reached only after the toast has already been read AND
    // the network has gone idle, so the extra second was pure padding.
    await this.page.waitForTimeout(300);
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
