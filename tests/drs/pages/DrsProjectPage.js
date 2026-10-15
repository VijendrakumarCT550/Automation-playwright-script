const fs = require('fs');
const { chooseOption } = require('../utils/drs-ui');

// DRS project creation (D4) and the Configuration wizard's Location step (D5).
// docs/drs-pulse-integration.md §3, §5 and §11 (rounds 1–2, drs-uat 2026-09-26).
//
//   * Add Project (/onboarding/new): Project Name, Project Type*, Project
//     Category*, Construction By*, SPV* + optional fields; "Create & Continue".
//     Comboboxes open from a "Toggle suggestions" button (drs-ui.openCombobox).
//     Create = POST /api/v1/projects. A project can NOT be deleted.
//   * Configuration → 2. Location Configuration: Cluster + Site comboboxes,
//     then "Import CSV" → dialog "Import Locations from CSV" → Choose File →
//     preview → Commit. App owner: the import is only accepted once a Site is
//     chosen, and re-importing the same names UPDATES those nodes (upsert by
//     parent + name) — hence a fresh Work Location name per run.
class DrsProjectPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  url(p) { return `${this.baseUrl}${p}`; }

  combo(name) { return this.page.getByRole('combobox', { name, exact: true }).first(); }

  async pick(name, value) {
    const ok = await chooseOption(this.page, this.combo(name), value);
    if (!ok) throw new Error(`"${value}" is not an option of ${name}`);
    const shown = (await this.combo(name).inputValue().catch(() => '')) || (await this.combo(name).innerText().catch(() => ''));
    if (!shown.includes(value)) throw new Error(`${name} reads "${shown}" after picking "${value}"`);
  }

  // Creates the project and returns { id, status, body }. The id comes from the
  // server's answer when it carries one, else from the Configuration URL the
  // app lands on.
  async createProject({ name, type, category, constructionBy, spv }) {
    await this.page.goto(this.url('/onboarding/new'));
    const nameBox = this.page.getByRole('textbox', { name: 'Project Name' });
    await nameBox.waitFor({ state: 'visible', timeout: 60000 });
    await nameBox.fill(name);
    await this.pick('Project Type*', type);
    await this.pick('Project Category*', category);
    await this.pick('Construction By*', constructionBy);
    await this.pick('SPV*', spv);

    const response = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/v1\/projects$/.test(r.url()),
      { timeout: 90000 },
    );
    await this.page.getByRole('button', { name: 'Create & Continue' }).click();
    const res = await response;
    const body = await res.text().catch(() => '');
    let id = null;
    try { id = JSON.parse(body).ID || JSON.parse(body).id || (JSON.parse(body).data || {}).ID || null; } catch { /* not JSON */ }
    if (!id) {
      await this.page.waitForURL(/\/projects\/[0-9a-f-]{36}\//i, { timeout: 60000 }).catch(() => {});
      const m = this.page.url().match(/\/projects\/([0-9a-f-]{36})/i);
      id = m ? m[1] : null;
    }
    return { id, status: res.status(), body };
  }

  async gotoLocationStep(projectId) {
    await this.page.goto(this.url(`/projects/${projectId}/configuration?step=location_config`));
    await this.combo('Cluster').waitFor({ state: 'visible', timeout: 60000 });
  }

  async chooseClusterSite(cluster, site) {
    await this.pick('Cluster', cluster);
    await this.pick('Site', site);
  }

  // Uploads `csvPath` through the real Import dialog and commits it. Returns
  // the commit call's { status, url, body } — whatever POST the Commit fires.
  async importCsv(csvPath) {
    await this.page.getByRole('button', { name: 'Import CSV' }).click();
    const dialog = this.page.getByRole('dialog', { name: 'Import Locations from CSV' });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await dialog.locator('input[type="file"]').setInputFiles(csvPath);
    const commit = dialog.getByRole('button', { name: 'Commit' });
    await commit.waitFor({ state: 'visible', timeout: 30000 });
    await this.page.waitForFunction(
      // A ~4k-row CSV (13 × 300 sections) takes a while to preview.
      (el) => el && !el.disabled, await commit.elementHandle(), { timeout: 240000 },
    );
    const response = this.page.waitForResponse(
      (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\//.test(r.url())
        && !/\/api\/v1\/query\//.test(r.url()),
      { timeout: 600000 }, // the bulk-import of ~4k rows
    );
    await commit.click();
    const res = await response;
    return { status: res.status(), url: res.url(), body: await res.text().catch(() => '') };
  }

  treeItem(name, level) {
    return this.page.getByRole('treeitem', { name, exact: true, level });
  }

  // The version badge the tree shows on a Work Area, or '' when unpinned
  // (measured 2026-09-26: an imported Work Area shows only "∗").
  //   * default: the bare version number ("v1") - what the older stages compare;
  //   * { label: true }: the full LABEL ("All sites v1", "AUTOMATION SITE v2"). Since
  //     sites have their own chains, "v1" alone no longer says which version
  //     (stage-d03 aria: "text: All sites v1 ∗").
  async workAreaVersionBadge(workArea, { label = false } = {}) {
    const text = await this.treeItem(workArea, 2).innerText().catch(() => '');
    // Skip the row's own NAME line: version Work Areas are named "BL04 S-v1", which
    // also ends in "v1" (live 2026-10-15: the name "WABL03 AS-v2" was read as a pin).
    const line = text.split('\n').map((t) => t.replace(/∗/g, '').trim())
      .filter((t) => !t.includes(workArea))
      .find((t) => /\bv\d+$/.test(t)) || '';
    if (label) return line;
    const m = line.match(/\bv\d+\b/);
    return m ? m[0] : '';
  }

  // Selects a Work Area AND PROVES the pane now shows it (its Name field).
  // Caught live 2026-09-26 on the one-page-load pin loop: after BL01's save,
  // clicking BL02 only EXPANDED it (300 children) and moved focus to a child —
  // the pane still showed BL01, now pinned and read-only. Acting on "whatever
  // the pane shows" there would edit the wrong Work Area; checking the name
  // turns that into a retry instead.
  async selectWorkArea(workArea) {
    const item = this.treeItem(workArea, 2);
    const nameBox = this.page.getByRole('textbox', { name: 'Name*' });
    // Five ways in, tried in order. A click on the row can land on the branch
    // toggle (only expands), on a node that is mid-refresh, or be overridden by the
    // pane snapping back to the Work Area saved a moment ago; each strategy waits
    // up to ~2.5 s for the pane's Name to read THIS Work Area before moving on.
    const label = () => item.locator('p').filter({ hasText: workArea }).first();
    const strategies = [
      ['row click', () => item.click()],
      ['label click', () => label().click()],
      ['row left edge', () => item.click({ position: { x: 40, y: 12 } })],
      ['focus + Enter', async () => { await item.focus(); await this.page.keyboard.press('Enter'); }],
      ['forced label click', () => label().click({ force: true })],
    ];
    for (const [i, [how, act]] of strategies.entries()) {
      await item.waitFor({ state: 'visible', timeout: 15000 });
      await item.scrollIntoViewIfNeeded();
      await act().catch(() => {});
      for (let w = 0; w < 5; w += 1) {
        if ((await nameBox.inputValue().catch(() => '')).trim() === workArea) {
          if (i > 0) console.log(`    ${workArea}: selected via ${how}`);
          return;
        }
        await this.page.waitForTimeout(500);
      }
    }
    throw new Error(`Could not select Work Area "${workArea}": the pane still shows ` +
      `"${await nameBox.inputValue().catch(() => '?')}"`);
  }

  // Collapses a Work Area's branch (its 300 sections otherwise stay expanded
  // and push every later row down the tree).
  async collapseWorkArea(workArea) {
    const item = this.treeItem(workArea, 2);
    const expanded = async () => (await item.getAttribute('aria-expanded').catch(() => null)) === 'true';
    if (await expanded()) {
      await item.press('ArrowLeft').catch(() => {});
      await this.page.waitForTimeout(300);
    }
    // Fallback (app owner, 2026-09-26): double-clicking an expanded row
    // collapses it.
    if (await expanded()) {
      await item.locator('p').filter({ hasText: workArea }).first().dblclick().catch(() => {});
      await this.page.waitForTimeout(300);
    }
  }

  // PINS a Work Area to a package catalog version (app owner, 2026-09-26: an
  // imported Work Area has none, and SO Configuration lists a Work Area under
  // its own version only once pinned). Select it, pick the version in the
  // pane's "Catalog version (optional)", Save. Returns the save call's answer.
  // `version` is the badge value ("v1"); `optionLabel` is the dropdown option's
  // text when it differs ("All sites v1" since 2026-10-01). Defaults to `version`.
  async pinWorkAreaVersion(workLocation, workArea, version, optionLabel = version) {
    const wl = this.treeItem(workLocation, 1);
    await wl.waitFor({ state: 'visible', timeout: 30000 });
    if ((await wl.getAttribute('aria-expanded')) !== 'true') {
      await wl.click();
      await this.page.waitForTimeout(1000);
    }
    const nameBox = this.page.getByRole('textbox', { name: 'Name*' });
    const save = this.page.getByRole('button', { name: 'Save' });

    // SELECT, PICK, CONFIRM - and only then Save. A pin is permanent, so Save is
    // never pressed unless the pane STILL shows this Work Area and Save is live.
    // Seen 2026-10-01 (pulse-uat DRS projects CPW and TGB): right after one
    // Work Area's save the pane SNAPS BACK to it, so the next pick landed on the
    // Work Area just saved - already pinned, Save disabled - and the one meant
    // to be pinned was never selected (the tester saw "Culvert is not selected").
    let ready = false;
    for (let attempt = 1; attempt <= 4 && !ready; attempt += 1) {
      try {
        await this.selectWorkArea(workArea);
        await this.pick('Catalog version (optional)', optionLabel);
        await this.page.waitForTimeout(800); // let a late snap-back show itself
        const stillThis = (await nameBox.inputValue().catch(() => '')).trim() === workArea;
        ready = stillThis && (await save.isEnabled().catch(() => false));
        if (!ready) console.log(`    ${workArea}: attempt ${attempt} - pane shows "${(await nameBox.inputValue().catch(() => '?')).trim()}", Save ${(await save.isEnabled().catch(() => false)) ? 'enabled' : 'disabled'} - retrying`);
      } catch (err) {
        console.log(`    ${workArea}: attempt ${attempt} - ${String(err.message).split('\n')[0]} - retrying`);
      }
      if (!ready) await this.page.waitForTimeout(1500);
    }
    if (!ready) throw new Error(`Could not get "${workArea}" selected with a live Save after 4 attempts - not pinning anything else`);

    const response = this.page.waitForResponse(
      (r) => ['PATCH', 'PUT', 'POST'].includes(r.request().method())
        && /\/api\/v1\/locations-configurator/.test(r.url()) && !/\/query\//.test(r.url()),
      { timeout: 60000 },
    );
    await save.click();
    const res = await response;

    // SETTLE: wait for the "updated" toast and for the pane to snap back to the
    // Work Area just saved, so the NEXT Work Area's selection is not overridden.
    await this.page.getByText(/Work Area updated/i).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    await this.page.waitForTimeout(1500);
    return { status: res.status(), method: res.request().method(), url: res.url(), body: await res.text().catch(() => '') };
  }
}

// Builds the leaf-only import CSV (docs §5): every row is the full path to one
// Work Section; the importer creates the ancestors. No blank lines.
//
// ~300 SECTIONS IN EACH BL WORK AREA (app owner, 2026-09-26). RFI permanently
// consumes the (checkpoint, Work Section) it lands on, and Pulse's existing
// solar areas hold ~264-490 per area, so the first template's 12 per area ran
// out almost at once. Each BL gets `sectionsPerArea` sections: 12 INVERTER
// (I01..I12) and the rest TABLE, named R<row>-T<table> in rows of 12
// (300 → 24 rows × 12 = 288 TABLE + 12 INVERTER).
//
// `extraAreas` (app owner, 2026-10-15): further Work Areas with their own section
// count - the catalog-version areas (drs-data.js versionAreas), one per version.
function buildLocationCsv({ cluster, site, workLocation, workAreas = 2, sectionsPerArea = 300, extraAreas = [] }) {
  const rows = ['cluster,site,worklocation,workarea,worksection,worksection_type'];
  const add = (wa, ws, type) => rows.push([cluster, site, workLocation, wa, ws, type].join(','));
  const pad = (n) => String(n).padStart(2, '0');
  const addBlock = (wa, sections) => {
    const inverters = Math.min(12, sections);
    const tables = Math.max(0, sections - inverters);
    for (let i = 0; i < tables; i += 1) add(wa, `R${pad(Math.floor(i / 12) + 1)}-T${pad((i % 12) + 1)}`, 'TABLE');
    for (let i = 1; i <= inverters; i += 1) add(wa, `I${pad(i)}`, 'INVERTER');
  };
  for (let b = 1; b <= workAreas; b += 1) addBlock(`BL${pad(b)}`, sectionsPerArea);
  for (const { name, sections } of extraAreas) addBlock(name, sections);
  for (const [wa, type] of [['Culvert-01', 'CULVERT'], ['Drain-01', 'DRAIN'], ['Road-01', 'ROAD']]) {
    for (let s = 0; s < 10; s += 1) add(wa, `${s * 100}-${(s + 1) * 100}`, type);
  }
  return `${rows.join('\n')}\n`;
}

function writeCsv(filePath, content) {
  fs.writeFileSync(filePath, content);
  return filePath;
}

module.exports = { DrsProjectPage, buildLocationCsv, writeCsv };
