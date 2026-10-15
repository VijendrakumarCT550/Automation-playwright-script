// DRS App Settings — the master data the setup chain needs ONCE per
// environment: the SPV (D2) and the automation Site (D3). docs/drs-pulse-integration.md §3.
//
// VENDORS ARE NOT HERE ANY MORE: Vendor Management moved to User Management
// (a separate app) on 2026-10-01 — see pages/UserManagementVendorPage.js. The old
// /appSettings/vendors and /appSettings/createVendor routes on the DRS host no
// longer show a vendor screen.
//
// Measured on drs-uat, 2026-09-26 (tests/drs/inspection/ rounds 1–2):
//   * SPV Master: a flat list of <p> names + "Search SPVs".
//   * Locations Configurator: a real ARIA tree (treeitem, aria-level); the
//     toolbar offers the level BELOW the selection (Cluster selected → Add
//     Site). Create = POST /api/v1/locations-configurator, answered 201.
//
// Every create waits for the server's own answer and returns its status — a
// closed form is not proof of a create (this suite's "silent no-op" lesson).
class DrsAppSettingsPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  url(p) { return `${this.baseUrl}${p}`; }

  // ---- SPV ----------------------------------------------------------------

  async spvExists(name) {
    await this.page.goto(this.url('/appSettings/spvsConfigurator'));
    const search = this.page.getByRole('textbox', { name: 'Search SPVs' });
    await search.waitFor({ state: 'visible', timeout: 60000 });
    await search.fill(name);
    await this.page.waitForTimeout(1000);
    return this.page.getByText(name, { exact: true }).first().isVisible().catch(() => false);
  }

  // ---- Locations: Cluster → Site ------------------------------------------

  async gotoLocations() {
    await this.page.goto(this.url('/appSettings/locationsConfigurator'));
    await this.page.getByRole('tree').waitFor({ state: 'visible', timeout: 60000 });
  }

  treeItem(name, level) {
    return this.page.getByRole('treeitem', { name, exact: true, level });
  }

  // Expands `cluster` (by selecting it) and reports whether `site` is under it.
  async siteExists(cluster, site) {
    await this.gotoLocations();
    const clusterItem = this.treeItem(cluster, 1);
    await clusterItem.waitFor({ state: 'visible', timeout: 30000 });
    if ((await clusterItem.getAttribute('aria-expanded')) !== 'true') {
      await clusterItem.click();
      await this.page.waitForTimeout(1500);
    }
    return this.treeItem(site, 2).isVisible().catch(() => false);
  }

  // RENAMES a Site in place (same uuid; round 11, 2026-10-15: the Site pane has an
  // editable Name* and Save). Returns the save call's answer.
  async renameSite(cluster, from, to) {
    if (!(await this.siteExists(cluster, from))) throw new Error(`no Site "${from}" under ${cluster} to rename`);
    await this.treeItem(from, 2).click();
    const nameBox = this.page.getByRole('textbox', { name: 'Name*' });
    await nameBox.waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(800);
    const shown = (await nameBox.inputValue()).trim();
    if (shown !== from) throw new Error(`the pane shows "${shown}", not "${from}" - not renaming`);
    await nameBox.fill(to);
    const response = this.page.waitForResponse(
      (r) => ['PATCH', 'PUT', 'POST'].includes(r.request().method())
        && /\/api\/v1\/locations-configurator/.test(r.url()) && !/\/query\//.test(r.url()),
      { timeout: 60000 },
    );
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    const res = await response;
    return { status: res.status(), method: res.request().method(), body: await res.text().catch(() => '') };
  }

  async createSite(cluster, site) {
    await this.gotoLocations();
    const clusterItem = this.treeItem(cluster, 1);
    await clusterItem.waitFor({ state: 'visible', timeout: 30000 });
    await clusterItem.click();
    await this.page.getByRole('button', { name: 'Add Site' }).click();
    const nameBox = this.page.getByRole('textbox', { name: 'Name*' });
    await nameBox.waitFor({ state: 'visible', timeout: 15000 });
    await nameBox.fill(site);

    const response = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/v1\/locations-configurator$/.test(r.url()),
      { timeout: 60000 },
    );
    await this.page.getByRole('button', { name: 'Create' }).click();
    const res = await response;
    return { status: res.status(), body: await res.text().catch(() => '') };
  }
}

module.exports = DrsAppSettingsPage;
