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
  async selectWorkAreas(areas) {
    const listbox = await this.openDropdown(this.workAreaDropdown);
    for (const area of areas) {
      const option = listbox.locator('[role="option"]').filter({ hasText: area }).first();
      await option.waitFor({ state: 'visible', timeout: 5000 });
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
  async selectMappingFilters({ cluster, site, projectType, workLocation, workAreas, package: pkg }) {
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

  // Picking a Service Order fires its own auto-save POST immediately on
  // selection (confirmed via network trace) — the Save button below isn't
  // what persists it. Wait for that response so the next row's selection
  // (or a Save/navigate-away) doesn't race ahead of an in-flight save.
  async selectServiceOrder(activityName, vendorText) {
    const combo = this.getActivityRow(activityName).locator('[role="combobox"]');
    const [response] = await Promise.all([
      this.page.waitForResponse(
        res => res.request().method() === 'POST' && res.url().includes('service-order-work-area'),
        { timeout: 10000 }
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
