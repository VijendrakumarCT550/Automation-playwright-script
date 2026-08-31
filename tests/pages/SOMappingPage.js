const { BasePage } = require('./BasePage');

// Covers the Admin "SO Mapping" section (/so-mapping), reached from the
// dashboard sidebar. Fields (top to bottom): Cluster, Site, Project Type,
// Work Location, Work Area (multi-select), Package — then a per-activity
// "Select Service Order" combobox for every activity under the chosen
// Package, and a Save button.
//
// Activity rows have an EMPTY <label> (Ark UI aria-labelledby resolves to no
// text), so their combobox has no accessible name. The visible activity name
// lives in a sibling <p class="text ... fw_medium"> within the same
// `div.d_grid` row — use that to scope to the right row's combobox.
class SOMappingPage extends BasePage {
  constructor(page) {
    super(page);

    // "SO Mapping" text also matches the sidebar link, so use this
    // empty-state hint (unique to the page content) to confirm real load.
    this.emptyStateHint = page.locator('text=Select a package and Work Area to see activities.');

    this.clusterDropdown      = page.getByRole('combobox', { name: /Cluster/i }).first();
    this.siteDropdown         = page.getByRole('combobox', { name: /^Site/i }).first();
    this.projectTypeDropdown  = page.getByRole('combobox', { name: /Project Type/i }).first();
    this.workLocationDropdown = page.getByRole('combobox', { name: /Work Location/i }).first();
    this.workAreaDropdown     = page.getByRole('combobox', { name: /^Work Area/i }).first();
    this.packageDropdown      = page.getByRole('combobox', { name: /^Package/i }).first();

    this.saveButton = page.getByRole('button', { name: 'Save' });
  }

  async goto(dashboard) {
    await dashboard.navSOMapping.click();
    await this.waitForLoad();
  }

  async waitForLoad() {
    await this.emptyStateHint.waitFor({ state: 'visible', timeout: 3000 });
  }

  // Work Area is a multi-select combobox: it stays open between option
  // clicks (like RFICreatePage's workSectionToggle), so it must be closed
  // explicitly by clicking the trigger again once all areas are picked.
  // Work Area is a multi-select, so clicking an option that is ALREADY
  // selected TOGGLES IT OFF. Confirmed live 2026-08-31: re-running
  // selectMappingFilters() for a second Package (to reload its activity rows)
  // re-clicked the same still-selected Work Area, deselecting it — after which
  // the page rendered ZERO activity rows and the second package silently had
  // nothing to map. Same class of bug as the one documented in
  // BasePage.selectMultiAware's checkmark comment.
  //
  // So: skip options that are already checked. Detected via data-state /
  // aria-selected, NOT by comparing text — a checked Ark UI option's
  // innerText gains the checkmark indicator, so text comparison is unreliable.
  //
  // No behaviour change for callers that open a fresh dialog and select
  // previously-unselected areas (e.g. 05_so_mapping.spec.js's 10 BL0x areas):
  // nothing is pre-checked there, so the guard never fires.
  async selectWorkAreas(areas) {
    const listbox = await this.openDropdown(this.workAreaDropdown);
    for (const area of areas) {
      const option = listbox.locator('[role="option"]').filter({ hasText: area }).first();
      await option.waitFor({ state: 'visible', timeout: 5000 });

      const alreadySelected =
        (await option.getAttribute('data-state').catch(() => null)) === 'checked' ||
        (await option.getAttribute('aria-selected').catch(() => null)) === 'true';
      if (alreadySelected) continue;

      await option.click();
      await this.page.waitForTimeout(200);
    }
    await this.workAreaDropdown.click();
    await this.page.locator('[role="listbox"][data-state="open"]')
      .waitFor({ state: 'hidden', timeout: 5000 })
      .catch(() => {});
  }

  // Runs the full Cluster → Site → Project Type → Work Location → Work Area
  // → Package selection and waits for the resulting activity rows to render.
  // `cluster` may be a single string or an array of acceptable candidates —
  // the Cluster field's available options have been observed to vary (e.g.
  // "Gujarat" vs "Khavda") depending on deployment/DB state.
  // The Cluster dropdown can open with ZERO options for a short window after
  // the page loads — its option list is fetched lazily, and waitForLoad()'s
  // empty-state hint appears before that fetch lands. Confirmed live twice:
  // the recon spec read "Cluster (0): []" while the field already displayed a
  // selection, and 00_inspect_wind_so_options_per_package.spec.js then failed
  // outright with "None of the candidate options [Gujarat, Khavda] were found
  // in this dropdown". Existing callers only got away with it by accident —
  // they happened to do other work first, which paid the wait incidentally.
  //
  // Polls open->count->close until the dropdown actually has options. Returns
  // the count found (0 if it never populated) rather than throwing, so the
  // caller's own selection step still produces the more specific error.
  async waitForDropdownOptions(dropdown, { timeout = 20000, intervalMs = 500 } = {}) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      let count = 0;
      try {
        const listbox = await this.openDropdown(dropdown);
        count = await listbox.locator('[role="option"]').count();
      } catch {
        count = 0;
      }
      await this.closeAnyOpenListbox();
      if (count > 0) return count;
      await this.page.waitForTimeout(intervalMs);
    }
    return 0;
  }

  async selectMappingFilters({ cluster, site, projectType, workLocation, workAreas, package: pkg }) {
    // See waitForDropdownOptions above — Cluster is the field that races.
    await this.waitForDropdownOptions(this.clusterDropdown);

    if (Array.isArray(cluster)) {
      await this.selectDropdownOptionAny(this.clusterDropdown, cluster);
    } else {
      await this.selectDropdownOption(this.clusterDropdown, cluster);
    }
    await this.selectDropdownOption(this.siteDropdown, site);
    await this.selectDropdownOption(this.projectTypeDropdown, projectType);
    await this.selectDropdownOption(this.workLocationDropdown, workLocation);
    await this.selectWorkAreas(workAreas);
    await this.selectDropdownOption(this.packageDropdown, pkg);
    // Let the activity rows for the chosen Package render
    await this.page.waitForTimeout(1000);
  }

  // Scopes to the grid row for a given activity name (exact text match —
  // activity names don't overlap as substrings of one another).
  getActivityRow(activityName) {
    return this.page.locator('div.d_grid')
      .filter({ has: this.page.getByText(activityName, { exact: true }) });
  }

  // Switches ONLY the Package dropdown and waits for its activity rows.
  //
  // Use this to walk several packages under one Cluster/Site/Project Type/
  // Work Location/Work Area selection — do NOT re-run selectMappingFilters()
  // per package. Package is single-select so re-selecting it is safe, whereas
  // the Work Area multi-select above it toggles (see selectWorkAreas). Proven
  // by 00_inspect_wind_master_and_mobile.spec.js, which reads all three wind
  // packages' activity rows this way in one pass.
  async selectPackage(pkg) {
    await this.selectDropdownOption(this.packageDropdown, pkg);
    await this.page.waitForLoadState('networkidle').catch(() => {});
    // Render buffer on top of networkidle for the activity rows themselves.
    await this.page.waitForTimeout(1500);
  }

  // ---- Added for WIND. Do not route solar callers through these. ----
  //
  // getActivityRow() above cannot be used for wind, for two reasons found
  // during the 2026-08-31 recon:
  //
  //  1. Wind activity rows render with a POSITION PREFIX — the visible text is
  //     "1. Stone Column Installation", not "Stone Column Installation" — so
  //     `getByText(name, { exact: true })` matches nothing. (The numbering
  //     restarts at 1 within each sub-package, and one row —
  //     "Re-Verification Audit" in the Mechanical package — has no prefix at
  //     all, so the prefix is optional, not guaranteed.)
  //  2. Relaxing to a substring match is NOT a safe fix: in the Mechanical
  //     package "Nacelle" is a substring of "Nacelle Top Cover", so a
  //     substring match would resolve to two rows.
  //
  // So: enumerate the rows once, strip an optional leading "<n>. ", and match
  // the remainder EXACTLY. Exact-after-normalisation — safe for both problems.
  activityRows() {
    return this.page.locator('div.d_grid').filter({ has: this.page.locator('[role="combobox"]') });
  }

  static normalizeActivityName(text) {
    return String(text).replace(/^\s*\d+\.\s*/, '').trim();
  }

  // [{ index, rawName, name, currentServiceOrder }] for every activity row
  // currently rendered for the selected Package.
  async listActivityRows() {
    const rows = this.activityRows();
    const total = await rows.count();
    const out = [];
    for (let i = 0; i < total; i++) {
      const row = rows.nth(i);
      const rawName = (await row.locator('p').first().innerText().catch(() => '')).trim();
      if (!rawName) continue;
      const currentServiceOrder =
        (await row.locator('[role="combobox"]').first().innerText().catch(() => '')).trim();
      out.push({
        index: i,
        rawName,
        name: SOMappingPage.normalizeActivityName(rawName),
        currentServiceOrder,
      });
    }
    return out;
  }

  // Row locator for a normalised activity name. Throws rather than returning
  // an ambiguous or empty locator, so a rename in the activity master fails
  // with a readable message instead of an inscrutable click timeout.
  async getActivityRowByName(activityName) {
    const rows = await this.listActivityRows();
    const matches = rows.filter(r => r.name === activityName);
    if (matches.length === 0) {
      throw new Error(
        `No activity row named "${activityName}". Rendered rows: ` +
        JSON.stringify(rows.map(r => r.name))
      );
    }
    if (matches.length > 1) {
      throw new Error(
        `Activity name "${activityName}" matched ${matches.length} rows (indexes ` +
        `${matches.map(m => m.index).join(', ')}) — cannot pick unambiguously.`
      );
    }
    return this.activityRows().nth(matches[0].index);
  }

  // Sets one row's Service Order by normalised activity name.
  //
  // `serviceOrderText` MUST be the full "<number> - <VENDOR NAME>" string, not
  // just the vendor name. CONFIRMED live: the dropdown holds 137 options and
  // BAUER ENGINEERING INDIA PVT LTD alone appears under five different SO
  // numbers, so a vendor-name match silently picks the wrong service order.
  async selectServiceOrderByName(activityName, serviceOrderText) {
    const row = await this.getActivityRowByName(activityName);
    const combo = row.locator('[role="combobox"]').first();
    const [response] = await Promise.all([
      this.page.waitForResponse(
        res => res.request().method() === 'POST' && res.url().includes('service-order-work-area'),
        { timeout: 5000 }
      ).catch(() => null),
      this.selectDropdownOption(combo, serviceOrderText),
    ]);
    return response;
  }

  // Maps every rendered activity row to one Service Order, skipping rows that
  // already hold it. Returns what it changed and what it skipped, so the
  // caller can report the real scope of a remap rather than assuming.
  async selectServiceOrderForAllActivities(serviceOrderText) {
    const before = await this.listActivityRows();
    const changed = [];
    const alreadySet = [];

    for (const rowInfo of before) {
      if (rowInfo.currentServiceOrder === serviceOrderText) {
        alreadySet.push(rowInfo.name);
        continue;
      }
      await this.selectServiceOrderByName(rowInfo.name, serviceOrderText);
      changed.push({ name: rowInfo.name, from: rowInfo.currentServiceOrder, to: serviceOrderText });
    }

    return { changed, alreadySet, total: before.length };
  }

  // Picking a Service Order fires its own auto-save POST immediately on
  // selection (confirmed via network trace) — the Save button below isn't
  // what persists it. Wait for that response so the next row's selection
  // (or a Save/navigate-away) doesn't race ahead of an in-flight save.
  async selectServiceOrder(activityName, vendorText) {
    const combo = this.getActivityRow(activityName).locator('[role="combobox"]');
    const [response] = await Promise.all([
      this.page.waitForResponse(
        res => res.request().method() === 'POST' && res.url().includes('service-order-work-area'),
        { timeout: 500 }
      ).catch(() => null),
      this.selectDropdownOption(combo, vendorText),
    ]);
    return response;
  }

  async getServiceOrderValue(activityName) {
    const combo = this.getActivityRow(activityName).locator('[role="combobox"]');
    return (await combo.innerText()).trim();
  }

  // Each Service Order selection already auto-saves itself (see
  // selectServiceOrder above) — this button doesn't appear to fire its own
  // network call for that data. Still click it, since that's the real
  // workflow, but the actual persistence guarantee comes from having awaited
  // every selectServiceOrder() call beforehand.
  async clickSave() {
    await this.saveButton.waitFor({ state: 'visible' });
    await this.saveButton.click();
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = SOMappingPage;
