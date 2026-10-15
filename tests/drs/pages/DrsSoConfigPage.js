const { chooseOption, openCombobox } = require('../utils/drs-ui');

// Configuration → 4. SO Configuration. docs/drs-pulse-integration.md §6, §11.
//
// Measured on drs-uat, 2026-09-26 (round 3, on our own project); filter flow
// changed 2026-10-14 (round 9) - see open():
//   * Filters: Work Location · Version · Work Area (multi) · Package, all chosen
//     by hand in that order. The matrix appears once Package is chosen.
//   * The matrix is a CSS grid, not an ARIA grid: a header row of Work Area
//     names, then per Activity a <p> caption followed by one "Select SO"
//     combobox per Work Area column, in header order. So a cell is "the N-th
//     combobox after the activity's caption" in DOM order.
//   * Cell options read "<SO number> — <vendor>".
//   * Single edit / Bulk edit; Cancel / Save.
class DrsSoConfigPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  // Since 2026-10-14 (round 9) NOTHING is pre-filled and the filters cascade:
  //   Work Location -> Version -> Work Area -> Package -> matrix.
  //   * Version lists the project's catalog versions ("All sites v5 .. v1"); the
  //     Work Area list only fills once a Version is chosen, and holds the areas
  //     pinned to that version (D03).
  //   * Work Area is a MULTI-select (a "Select all" row + one chip per pick); the
  //     list stays open after a pick.
  //   * Package is empty until chosen; the matrix then reads "Select at least one
  //     Package to view activities" until it is.
  // `workAreas` are the areas to show as columns, in the order they are picked.
  async open(projectId, { workLocation, version, workAreas, pkg }) {
    await this.page.goto(`${this.baseUrl}/projects/${projectId}/configuration?step=so_config`);
    const wl = this.page.getByRole('combobox', { name: 'Work Location' }).first();
    await wl.waitFor({ state: 'visible', timeout: 60000 });
    if (!(await chooseOption(this.page, wl, workLocation))) throw new Error(`Work Location "${workLocation}" not offered`);

    const v = this.page.getByRole('combobox', { name: 'Version' }).first();
    // The Version box is a SEARCH field that holds the current value and filters
    // its own list by it; clear it so every version is listed, then pick by the
    // scoped label ("All sites v1").
    await v.fill('').catch(() => {});
    await this.page.waitForTimeout(500);
    if (!(await chooseOption(this.page, v, version))) throw new Error(`Version "${version}" not offered`);

    const wa = this.page.getByRole('combobox', { name: 'Work Area' }).first();
    await openCombobox(this.page, wa);
    for (const area of workAreas) {
      const escaped = String(area).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const option = this.page.locator('[role="option"]:visible')
        .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) }).first();
      if (!(await option.isVisible().catch(() => false))) {
        await this.page.keyboard.press('Escape').catch(() => {});
        throw new Error(`Work Area "${area}" is not offered under Version "${version}" (not pinned to it?)`);
      }
      await option.click();
      await this.page.waitForTimeout(400);
    }
    await this.page.keyboard.press('Escape').catch(() => {});
    await this.page.waitForTimeout(500);

    const p = this.page.getByRole('combobox', { name: 'Package' }).first();
    if (!(await chooseOption(this.page, p, pkg))) throw new Error(`Package "${pkg}" not offered`);
    await this.page.getByText('Activity', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
  }

  // Work Area column names in header order (the <p>s between "Activity" and
  // the first activity caption).
  async columns(knownWorkAreas) {
    const texts = await this.page.locator('p').allInnerTexts();
    return texts.map((t) => t.trim()).filter((t) => knownWorkAreas.includes(t));
  }

  cell(activity, columnIndex) {
    return this.page.getByText(activity, { exact: true }).first()
      .locator(`xpath=following::*[@role="combobox"][${columnIndex + 1}]`);
  }

  async cellValue(activity, columnIndex) {
    const c = this.cell(activity, columnIndex);
    return ((await c.inputValue().catch(() => '')) || (await c.innerText().catch(() => ''))).trim();
  }

  async setCell(activity, columnIndex, soNumber) {
    const c = this.cell(activity, columnIndex);
    await c.scrollIntoViewIfNeeded();
    await openCombobox(this.page, c);
    const option = this.page.locator('[role="option"]:visible')
      .filter({ hasText: new RegExp(`^\\s*${soNumber}\\b`) }).first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    await option.click();
    await this.page.waitForTimeout(400);
  }

  async save() {
    const response = this.page.waitForResponse(
      (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\//.test(r.url())
        && !/\/api\/v1\/query\//.test(r.url()),
      { timeout: 90000 },
    );
    await this.page.getByRole('button', { name: 'Save' }).click();
    const res = await response;
    return { status: res.status(), method: res.request().method(), url: res.url(), body: await res.text().catch(() => '') };
  }
}

module.exports = DrsSoConfigPage;
