const { expect } = require('@playwright/test');
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
      // The list can be opened before the Version pick has settled and stay shut or
      // empty (D05, 2026-10-19), so wait (isVisible never polls) and, if the option
      // is not there, re-open the list - three tries before "not offered".
      let shown = false;
      for (let attempt = 0; attempt < 3 && !shown; attempt += 1) {
        if (attempt) {
          await this.page.keyboard.press('Escape').catch(() => {});
          await this.page.waitForTimeout(1500);
          await openCombobox(this.page, wa);
        }
        shown = await option.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false);
      }
      if (!shown) {
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

  // Switches ONLY the Package filter of an open matrix (Work Location / Version /
  // Work Area stay as chosen - no reload, app owner 2026-10-21). The edit mode is
  // re-asserted by the caller.
  async choosePackage(pkg) {
    const p = this.page.getByRole('combobox', { name: 'Package' }).first();
    if (!(await chooseOption(this.page, p, pkg))) throw new Error(`Package "${pkg}" not offered`);
    await this.page.getByText('Activity', { exact: true }).waitFor({ state: 'visible', timeout: 30000 });
    await this.page.waitForTimeout(800);
  }

  // Work Area column names in header order (the <p>s between "Activity" and
  // the first activity caption).
  async columns(knownWorkAreas) {
    const texts = await this.page.locator('p').allInnerTexts();
    return texts.map((t) => t.trim()).filter((t) => knownWorkAreas.includes(t));
  }

  // The matrix's activity captions, in row order: the <p>s after the "Activity"
  // header that are not column names and are followed, in DOM order and before
  // the next <p>, by a "Select SO" cell (caption and cells are not siblings).
  async activities(columns) {
    return this.page.locator('p').evaluateAll((ps, cols) => {
      const cells = [...document.querySelectorAll('input[role="combobox"][placeholder="Select SO"]')];
      const after = (a, b) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      const i = ps.findIndex((p) => p.textContent.trim() === 'Activity');
      return ps.slice(i + 1).filter((p, k, rest) => {
        const t = p.textContent.trim();
        if (!t || cols.includes(t)) return false;
        const cell = cells.find((c) => after(p, c));
        return Boolean(cell) && (!rest[k + 1] || after(cell, rest[k + 1]));
      }).map((p) => p.textContent.trim());
    }, columns);
  }

  cell(activity, columnIndex) {
    return this.page.getByText(activity, { exact: true }).first()
      .locator(`xpath=following::*[@role="combobox"][${columnIndex + 1}]`);
  }

  async cellValue(activity, columnIndex) {
    const c = this.cell(activity, columnIndex);
    return ((await c.inputValue().catch(() => '')) || (await c.innerText().catch(() => ''))).trim();
  }

  // Picks one option of a cell's list. On a long matrix the list can shut before
  // the click lands (D05 map-all, 2026-10-19), so up to three tries, each opening
  // the list afresh. An option already "checked" means the cell holds it - the
  // list is just closed again.
  async pickInCell(activity, columnIndex, optionText) {
    const c = this.cell(activity, columnIndex);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await c.scrollIntoViewIfNeeded().catch(() => {});
      await openCombobox(this.page, c);
      const option = this.page.locator('[role="option"]:visible').filter({ hasText: optionText }).first();
      if (await option.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) {
        if ((await option.getAttribute('data-state').catch(() => null)) === 'checked') {
          await this.page.keyboard.press('Escape').catch(() => {});
          await this.page.waitForTimeout(300);
          return;
        }
        if (await option.click({ timeout: 5000 }).then(() => true, () => false)) {
          await this.page.waitForTimeout(400);
          return;
        }
      }
      await this.page.keyboard.press('Escape').catch(() => {});
      await this.page.waitForTimeout(800);
    }
    throw new Error(`${activity} × column ${columnIndex + 1}: could not pick "${optionText}"`);
  }

  async setCell(activity, columnIndex, soNumber) {
    await this.pickInCell(activity, columnIndex, new RegExp(`^\\s*${soNumber}\\b`));
    const v = await this.cellValue(activity, columnIndex);
    if (!v.startsWith(soNumber)) throw new Error(`${activity} × column ${columnIndex + 1}: reads "${v}" after picking ${soNumber}`);
  }

  // Empties a cell: its list starts with a "× Clear" option (round 24, 2026-10-19).
  async clearCell(activity, columnIndex) {
    await this.pickInCell(activity, columnIndex, /^\s*×?\s*Clear\s*$/);
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

  // ---------------------------------------------------------------------------
  // BULK EDIT (inspection round 26, 2026-10-21; app owner's suggestion). The
  // "Edit mode" radiogroup's "Bulk edit" turns the matrix into checkboxes, each
  // followed by its label <p>, in DOM order:
  //   "Select all cells" · Activity · <col 1> ... <col N>      (column checkboxes)
  //   <activity>  <cell 1> ... <cell N>                         per row; a cell's
  //                                                             label is its value:
  //                                                             "<SO> — <vendor>" or "—"
  // A column checkbox selects the whole column, a row checkbox the whole row, a
  // cell checkbox one cell ("N cells selected"). The bar then offers "Select SO to
  // assign to selected" + Apply to selected / Remove SO from selected / Deselect
  // all. Nothing is written until Save.
  async bulkMode() {
    const radio = this.page.getByRole('radio', { name: 'Bulk edit' });
    if ((await radio.getAttribute('aria-checked').catch(() => null)) !== 'true'
      && !(await radio.isChecked().catch(() => false))) {
      await radio.click({ force: true });
    }
    await this.page.getByRole('checkbox', { name: 'Select all cells' }).waitFor({ state: 'visible', timeout: 15000 });
    // A WIDE matrix keeps rendering rows after the header is up (live 2026-10-21,
    // R6: All sites v1 with 17 columns was read part-built - 91 cells planned where
    // 156 were empty - and the later rows shifted every checkbox index, so clicks
    // landed on the wrong boxes). Wait until the checkbox count holds steady.
    const boxes = this.page.locator('input[type="checkbox"], [role="checkbox"]');
    let last = -1;
    let steady = 0;
    for (let i = 0; i < 40 && steady < 3; i += 1) {
      await this.page.waitForTimeout(400);
      const n = await boxes.count();
      steady = n === last ? steady + 1 : 0;
      last = n;
    }
  }

  // The whole matrix in ONE read: { columns: [name], rows: [{ activity,
  // cells: [{ value, box }] }] }, `box` = the cell checkbox's index among the
  // page's checkboxes (for clickBox).
  async readMatrix(knownWorkAreas) {
    const entries = await this.page.evaluate(() => {
      const boxes = [...document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')];
      const all = [...document.querySelectorAll('*')];
      return boxes.map((b, i) => {
        const at = all.indexOf(b);
        const p = all.slice(at + 1).find((e) => e.tagName === 'P');
        return { i, text: p ? p.textContent.trim() : '' };
      });
    });
    const head = entries.findIndex((e) => e.text === 'Activity');
    if (head < 0) throw new Error('bulk matrix: no "Activity" header - is Bulk edit on?');
    const columns = [];
    let k = head + 1;
    while (k < entries.length && knownWorkAreas.includes(entries[k].text)) { columns.push(entries[k].text); k += 1; }
    if (!columns.length) throw new Error('bulk matrix: no Work Area columns read');
    const rows = [];
    for (; k + columns.length < entries.length + 1 && k < entries.length; k += columns.length + 1) {
      const cells = entries.slice(k + 1, k + 1 + columns.length);
      if (cells.length < columns.length) break;
      rows.push({ activity: entries[k].text, box: entries[k].i, cells: cells.map((c) => ({ value: c.text === '—' ? '' : c.text, box: c.i })) });
    }
    return { columns, rows };
  }

  async clickBox(index) {
    await this.page.locator('input[type="checkbox"], [role="checkbox"]').nth(index).click({ force: true });
  }

  async selectedCount() {
    const t = await this.page.getByText(/\d+ cells? selected/i).first().innerText({ timeout: 3000 }).catch(() => '');
    return Number((t.match(/(\d+)/) || [])[1] || 0);
  }

  // Ticks the given cell checkboxes and checks the bar counts exactly them. On a
  // wide matrix (17 columns, live 2026-10-21) some clicks did not register (91
  // ticked, 78 counted), so each box's checked state is read back and the
  // unchecked ones are clicked again - three rounds - before the count is checked.
  async selectCells(boxes) {
    const all = this.page.locator('input[type="checkbox"], [role="checkbox"]');
    const unchecked = async () => {
      const states = await all.evaluateAll((els, idx) => idx.map((i) => {
        const b = els[i];
        return Boolean(b && (b.checked || b.getAttribute('aria-checked') === 'true' || b.getAttribute('data-state') === 'checked'));
      }), boxes);
      return boxes.filter((_, k) => !states[k]);
    };
    let todo = boxes;
    for (let round = 1; round <= 3 && todo.length; round += 1) {
      if (round === 1) {
        for (const b of todo) {
          await all.nth(b).scrollIntoViewIfNeeded().catch(() => {});
          await this.clickBox(b);
          await this.page.waitForTimeout(60);
        }
      } else {
        // The SAME cells missed every round (live 2026-10-21: 13 of 91, one row
        // across the 13 SM columns) - a pointer click there lands on whatever
        // covers them (the bulk bar / the floating help button). A DOM click on
        // the checkbox itself cannot be intercepted.
        await all.evaluateAll((els, idx) => { for (const i of idx) if (els[i]) els[i].click(); }, todo);
      }
      await this.page.waitForTimeout(500);
      todo = await unchecked();
      if (todo.length) console.log(`    bulk: ${todo.length} of ${boxes.length} cells did not tick - round ${round + 1}`);
    }
    await expect.poll(() => this.selectedCount(), { timeout: 10000, message: `bulk: ${boxes.length} cells ticked` }).toBe(boxes.length);
  }

  // With MANY cells ticked the page has scrolled down the matrix, and opening the
  // assign list by its toggle button leaves it EXPANDED BUT EMPTY (live 2026-10-21,
  // R5, 5 of 6 versions; reproduced in inspection round 27 with 28 cells - with 3
  // cells it opens fine). Clicking / typing into the box itself opens it. So: bring
  // the bar into view, click the box, type the number (it searches), wait, and
  // re-open - three tries.
  async assignSelected(soNumber) {
    const pick = this.page.getByPlaceholder('Select SO to assign to selected').first();
    const option = this.page.locator('[role="option"]:visible').filter({ hasText: new RegExp(`^\\s*${soNumber}\\b`) }).first();
    let shown = false;
    for (let attempt = 1; attempt <= 3 && !shown; attempt += 1) {
      if (attempt > 1) {
        await this.page.keyboard.press('Escape').catch(() => {});
        await this.page.waitForTimeout(3000);
      }
      await pick.scrollIntoViewIfNeeded().catch(() => {});
      await pick.click({ force: true }).catch(() => {});
      if (!(await option.isVisible().catch(() => false))) await openCombobox(this.page, pick);
      await pick.fill(soNumber).catch(() => {});
      shown = await option.waitFor({ state: 'visible', timeout: 15000 }).then(() => true, () => false);
    }
    if (!shown) throw new Error(`bulk: SO ${soNumber} is not offered in "Select SO to assign to selected"`);
    await option.click();
    const apply = this.page.getByTestId('so-activity-bulk-apply');
    await expect(apply).toBeEnabled({ timeout: 10000 });
    await apply.click();
    await this.page.waitForTimeout(800);
  }

  async removeSelected() {
    await this.page.getByTestId('so-activity-bulk-remove').click();
    await this.page.waitForTimeout(800);
  }

  async deselectAll() {
    const b = this.page.getByTestId('so-activity-bulk-deselect');
    if (await b.isVisible().catch(() => false)) { await b.click(); await this.page.waitForTimeout(500); }
  }
}

module.exports = DrsSoConfigPage;
