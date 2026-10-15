const { expect } = require('@playwright/test');
const { versionPrefix, buildTree, expectedNames } = require('./pc-data');

// DRS Packages Configurator (App Settings -> Packages Configurator,
// /appSettings/packagesConfigurator?projectType=solar). Locators and gotchas are
// from RUNBOOK.md section 8 - read it before changing anything here.
//
// RULES THIS FILE NEVER BREAKS (runbook 0, 4.4):
//   * never clicks Reset draft, Discard draft or Delete;
//   * 'New draft' is only reachable through ensureDraft()/newDraftFrom(), which only
//     build specs call;
//   * Lock version only through lockVersion(), which only catalog_site_versions.spec.js
//     calls, after a full verify (app owner, 2026-10-15: lock the AUTOMATION SITE
//     versions). A lock is PERMANENT - no unlock, no delete (catalog guide section 2).
//
// Every tree method takes the PACKAGE ("Civil" / "Electrical"); the default is
// Electrical, which is where the runbook's historic letters live.
//
// The catalog guide (Azure wiki "Catalog Versions", 2026-10-09) is the reference for
// the version rules quoted below.

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A form textbox by its caption. Required fields carry a "*" in the accessible name
// ("Name*", "Base UOM*", "Description*" - first live build, 2026-10-15), and whether
// a field is required differs per form (Code is optional on a Sub-Package, required
// on an Activity), so the "*" is optional in the match.
const field = (panel, caption) => panel.getByRole('textbox', { name: new RegExp(`^${escapeRe(caption)}\\*?$`) }).first();

// Fills a field the form may not have. Code is gone from the Activity create form
// (first live build, 2026-10-15: Name* + Base UOM* only; the runbook still lists
// Code*), so Code is written wherever the form still offers it.
async function fillIfShown(box, value) {
  if (await box.isVisible().catch(() => false)) await box.fill(value);
}

class PackagesConfiguratorPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  // ---- left panel: Project Type / Site / Catalog version -------------------

  async goto() {
    await this.page.goto(`${this.baseUrl}/appSettings/packagesConfigurator?projectType=solar`);
    await this.combo('Project Type').waitFor({ state: 'visible', timeout: 60000 });
  }

  combo(name) { return this.page.getByRole('combobox', { name, exact: true }).first(); }

  // Ark UI selects open on pointer-down and keep OTHER selects' options in the
  // DOM (gotcha 1), so only VISIBLE options count. Waits for aria-expanded
  // before clicking and retries once (gotcha 3). `match` is a RegExp or a string
  // prefix; the option text may carry a trailing check mark.
  async choose(comboName, match) {
    const re = match instanceof RegExp ? match : new RegExp(`^\\s*${escapeRe(match)}`, 'i');
    const combo = this.combo(comboName);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await combo.click();
      await expect(combo).toHaveAttribute('aria-expanded', 'true', { timeout: 5000 }).catch(() => {});
      const option = this.page.locator('[role="option"]:visible').filter({ hasText: re }).first();
      if (await option.isVisible({ timeout: 4000 }).catch(() => false)) {
        const label = (await option.innerText()).replace(/✓/g, '').trim();
        await option.click();
        await this.page.waitForTimeout(800);
        return label;
      }
      await this.page.keyboard.press('Escape').catch(() => {});
    }
    throw new Error(`"${comboName}" has no visible option matching ${re}`);
  }

  async optionLabels(comboName) {
    const combo = this.combo(comboName);
    await combo.click();
    await this.page.waitForTimeout(600);
    const labels = (await this.page.locator('[role="option"]:visible').allInnerTexts())
      .map((t) => t.replace(/✓/g, '').trim()).filter(Boolean);
    await this.page.keyboard.press('Escape').catch(() => {});
    return labels;
  }

  // The Site list holds look-alikes ("AUTOMATION SITE", "AUTOMATION SITE 2-PTG",
  // "AUTOMATION SITE 3-CRV" - round 10), so the site is matched EXACTLY.
  async selectProjectTypeAndSite(site) {
    await this.choose('Project Type', 'Solar');
    await this.choose('Site', new RegExp(`^\\s*${escapeRe(site)}\\s*✓?\\s*$`, 'i'));
  }

  // VERIFY MODE: open the newest version for the site, draft or locked. Reads only.
  async openNewestVersion(site) {
    const labels = await this.optionLabels('Catalog version');
    const re = versionPrefix(site);
    const label = labels.find((l) => re.test(l));
    if (!label) throw new Error(`No catalog version for "${site}". Offered: ${JSON.stringify(labels)}`);
    await this.choose('Catalog version', new RegExp(`^${escapeRe(label)}$`, 'i'));
    return label;
  }

  // VERIFY MODE, better: a site can have several versions and the letters live in
  // only some of them (2026-10-01: Khavda R,S are in the runbook's "Khavda v1";
  // the newer Khavda v2-v4 do not carry them). Opens the first version, newest
  // first, whose tree has EVERY requested sub-package; returns the label and a
  // line per version tried so a failure says where the letters actually are.
  async openVersionWithLetters(site, letters, pkg = 'Electrical') {
    const re = versionPrefix(site);
    const labels = (await this.optionLabels('Catalog version')).filter((l) => re.test(l));
    const tried = [];
    for (const label of labels) {
      await this.choose('Catalog version', new RegExp(`^${escapeRe(label)}$`, 'i'));
      await this.expand(pkg);
      const found = [];
      for (const L of letters) if (await this.has(buildTree(L).name)) found.push(L);
      tried.push(`${label}: ${found.length ? found.join(',') : 'none'}`);
      if (found.length === letters.length) return { label, tried };
    }
    return { label: null, tried };
  }

  // BUILD MODE (runbook 4.3): select the open draft; if there is only locked
  // history, 'New draft' then reload, then select it. Never Lock/Reset/Discard.
  async ensureDraft(site) {
    const draftFor = new RegExp(site === 'All sites' ? '^(All sites )?v\\d+.*draft$' : `^${escapeRe(site)} v\\d+.*draft$`, 'i');
    let labels = await this.optionLabels('Catalog version');
    if (!labels.some((l) => draftFor.test(l))) {
      await this.page.getByRole('button', { name: 'New draft' }).click();
      // Success is silent (gotcha 4): the dropdown shows it only after a reload.
      // A 409 "draft already exists" modal is harmless - Close it.
      await this.page.waitForTimeout(2500);
      const modalClose = this.page.getByRole('button', { name: 'Close' }).first();
      if (await modalClose.isVisible().catch(() => false)) await modalClose.click().catch(() => {});
      await this.page.reload();
      await this.combo('Project Type').waitFor({ state: 'visible', timeout: 60000 });
      await this.selectProjectTypeAndSite(site);
      labels = await this.optionLabels('Catalog version');
    }
    const label = labels.find((l) => draftFor.test(l));
    if (!label) throw new Error(`No draft for "${site}" after New draft. Offered: ${JSON.stringify(labels)}`);
    await this.choose('Catalog version', new RegExp(`^${escapeRe(label)}$`, 'i'));
    // Edit mode shows these; a locked version shows "... is locked and cannot be edited".
    await expect(this.page.getByRole('button', { name: 'Lock version' })).toBeVisible({ timeout: 15000 });
    return label;
  }

  // Selects the version whose label starts with `label` ("All sites v1",
  // "AUTOMATION SITE v1") - the option reads "<label> — locked" / "<label> — draft".
  async chooseVersion(label) {
    return this.choose('Catalog version', new RegExp(`^\\s*${escapeRe(label)}\\s+—`, 'i'));
  }

  // "AUTOMATION SITE v1 — draft" -> "AUTOMATION SITE v1".
  static bareLabel(option) { return String(option).replace(/\s+—.*$/, '').trim(); }

  // NEW DRAFT FROM A CHOSEN VERSION (app owner, 2026-10-15: "we can make any version
  // draft" - pick the source version, then New draft; the draft is a copy of it).
  // The catalog guide (4.6) says a draft copies the NEWEST locked version instead, so
  // the caller compares the draft's tree with the source's to record which it got.
  // A chain holds ONE open draft (guide 4.5): an existing one is refused here, not
  // reused - the caller decides. Returns the new draft's label ("AUTOMATION SITE v1").
  async newDraftFrom(site, sourceLabel) {
    const draftRe = new RegExp(`^${escapeRe(site)} v\\d+\\s+—\\s+draft$`, 'i');
    const before = await this.optionLabels('Catalog version');
    const open = before.find((l) => draftRe.test(l));
    if (open) throw new Error(`"${site}" already has an open draft (${open}) - only one may be open per chain`);
    await this.chooseVersion(sourceLabel);
    const response = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /master-data-versions\/drafts/.test(r.url()),
      { timeout: 60000 },
    );
    await this.page.getByRole('button', { name: 'New draft' }).click();
    const res = await response;
    const body = await res.text().catch(() => '');
    if (res.status() >= 300) throw new Error(`New draft answered ${res.status()}: ${body.slice(0, 300)}`);
    // Gotcha 4: the list shows the draft after a reload.
    await this.page.reload();
    await this.combo('Project Type').waitFor({ state: 'visible', timeout: 60000 });
    await this.selectProjectTypeAndSite(site);
    const after = await this.optionLabels('Catalog version');
    const draft = after.find((l) => draftRe.test(l));
    if (!draft) throw new Error(`No "${site}" draft after New draft (HTTP ${res.status()}). Offered: ${JSON.stringify(after)}`);
    await this.choose('Catalog version', new RegExp(`^${escapeRe(draft)}$`, 'i'));
    await expect(this.page.getByRole('button', { name: 'Lock version' })).toBeVisible({ timeout: 15000 });
    return { label: PackagesConfiguratorPage.bareLabel(draft), status: res.status(), body };
  }

  // Selects an EXISTING open draft by its label (resume after a failed build).
  async openDraft(label) {
    await this.choose('Catalog version', new RegExp(`^\\s*${escapeRe(label)}\\s+—\\s+draft`, 'i'));
    await expect(this.page.getByRole('button', { name: 'Lock version' })).toBeVisible({ timeout: 15000 });
  }

  // LOCK (guide 5): "Lock version" -> confirmation "Lock <label> permanently?" ->
  // "Lock permanently". The server checks the draft first and REFUSES with a list
  // (no project type, no Min Unit, dependency loop ...). A sub-activity without
  // inspection points is only an ADVISORY behind a second button - our trees give
  // every sub-activity three points, so an advisory means something is wrong, and
  // this method never accepts one. Returns the dialog text + the lock call's answer.
  async lockVersion(label) {
    await this.page.getByRole('button', { name: 'Lock version' }).click();
    const dialog = this.page.getByRole('dialog').filter({ hasText: /permanently/i }).last();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    const dialogText = (await dialog.innerText().catch(() => '')).trim();
    if (!new RegExp(escapeRe(label), 'i').test(dialogText)) {
      throw new Error(`Lock dialog does not name "${label}" - not locking. Dialog: ${dialogText.slice(0, 300)}`);
    }
    const response = this.page.waitForResponse(
      (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /master-data-versions/.test(r.url())
        && !/\/query\//.test(r.url()),
      { timeout: 120000 },
    );
    await dialog.getByRole('button', { name: /^Lock permanently$/i }).click();
    const res = await response;
    const body = await res.text().catch(() => '');
    await this.page.waitForTimeout(2000);
    const after = (await this.page.getByRole('dialog').last().innerText().catch(() => '')).trim();
    return { status: res.status(), url: res.url(), body, dialogText, after };
  }

  // The sub-package names directly under a package, in tree order (read-only).
  async subPackageNames(pkg) {
    await this.expand(pkg);
    const items = await this.page.getByRole('treeitem').evaluateAll((els) => els.map((e) => ({
      name: e.getAttribute('aria-label') || '', level: e.getAttribute('aria-level'),
    })));
    const start = items.findIndex((i) => i.level === '1' && i.name === pkg);
    const out = [];
    for (let i = start + 1; i < items.length && items[i].level !== '1'; i += 1) {
      if (items[i].level === '2') out.push(items[i].name);
    }
    return out;
  }

  async isLockedVersion() {
    return this.page.getByText(/is locked and cannot be edited/i).first().isVisible().catch(() => false);
  }

  // ---- tree -----------------------------------------------------------------

  tree(name) { return this.page.getByRole('treeitem', { name, exact: true }).first(); }

  async has(name) { return this.tree(name).isVisible().catch(() => false); }

  // Children are in the DOM only while the parent is expanded (gotcha 11). A
  // collapsed parent makes existing children look missing and CREATES DUPLICATES,
  // so every existence check goes through expand() first.
  async expand(name) {
    const item = this.tree(name);
    await item.waitFor({ state: 'visible', timeout: 30000 });
    if ((await item.getAttribute('aria-expanded')) === 'false') {
      await item.locator('svg').first().click();
      await expect(item).toHaveAttribute('aria-expanded', 'true', { timeout: 8000 });
      await this.page.waitForTimeout(500);
    }
  }

  async select(name) {
    const item = this.tree(name);
    await item.waitFor({ state: 'visible', timeout: 30000 });
    await item.click();
    await this.page.waitForTimeout(700);
  }

  // ---- forms ------------------------------------------------------------------

  // The Details panel holding a create form (has Create) or an edit form (Save).
  createPanel() { return this.page.getByRole('tabpanel').filter({ has: this.page.getByRole('button', { name: 'Create' }) }).first(); }
  editPanel() { return this.page.getByRole('tabpanel').filter({ has: this.page.getByRole('button', { name: 'Save', exact: true }) }).first(); }

  // The row's kebab is scrolled to the MIDDLE of the view first: with a long tree
  // (Civil A..L, 2026-10-15) a row near the bottom opened its menu outside the
  // viewport and "Add Activity" could not be clicked ("element is outside of the
  // viewport" ×50). If the item is still off-screen, it is clicked programmatically.
  async openAddForm(parentName, menuItem) {
    const kebab = this.page.getByRole('button', { name: `Add or delete ${parentName}`, exact: true }).first();
    await kebab.evaluate((el) => el.scrollIntoView({ block: 'center' })).catch(() => {});
    await this.page.waitForTimeout(300);
    await kebab.click();
    const item = this.page.getByRole('menuitem', { name: menuItem, exact: true });
    await item.waitFor({ state: 'visible', timeout: 10000 });
    await item.click({ timeout: 5000 }).catch(() => item.dispatchEvent('click'));
    // Gotcha 17: the form lags behind the menu - wait for the empty Create form.
    await this.createPanel().waitFor({ state: 'visible', timeout: 15000 });
    return this.createPanel();
  }

  // Success = the toast OR the new node in the tree with its edit form open. The
  // toast alone is not enough: live 2026-10-15 the "Sub-Activity created" toast never
  // showed while the previous "Inspection Point created" one was still up, yet the
  // sub-activity WAS created (its edit form was open, Save disabled).
  async submitCreate(panel, toastRe, name) {
    await panel.getByRole('button', { name: 'Create' }).click();
    const toast = this.page.getByText(toastRe).first();
    const created = name
      ? this.page.getByRole('tabpanel').filter({ has: this.page.getByRole('button', { name: 'Save', exact: true }) })
        .getByRole('textbox', { name: /Name\*?$/ }).first()
      : null;
    await expect.poll(async () => {
      if (await toast.isVisible().catch(() => false)) return true;
      if (!created) return false;
      const formShowsIt = (await created.inputValue().catch(() => '')) === name;
      return formShowsIt && (await this.has(name));
    }, { timeout: 20000, message: `"${name || toastRe}" was not created` }).toBe(true);
    await this.page.waitForTimeout(1500); // gotcha 6: the tree re-renders
  }

  // A Radix/Ark-style select that has a placeholder and no useful accessible name.
  async chooseByPlaceholder(panel, placeholder, optionRe) {
    const trigger = panel.locator('button[role="combobox"]').filter({ hasText: placeholder }).first();
    await trigger.click();
    const option = this.page.locator('[role="option"]:visible').filter({ hasText: optionRe }).first();
    await option.waitFor({ state: 'visible', timeout: 8000 });
    await option.click();
    await this.page.waitForTimeout(400);
  }

  // ---- build steps (runbook section 6) - each is a no-op when the node exists ----

  async ensureSubPackage(t, pkg = 'Electrical') {
    await this.expand(pkg);
    if (!(await this.has(t.name))) {
      const panel = await this.openAddForm(pkg, 'Add Sub-Package');
      await field(panel, 'Name').fill(t.name);
      await fillIfShown(field(panel, 'Code'), t.code);
      await this.submitCreate(panel, /Sub-Package created/i, t.name);
    }
    // 6.2 - the app auto-assigns the next free letter. A Letter may only be ONE or
    // TWO letters A-Z (catalog guide 6.4: a digit is refused), so a counter code such
    // as PC01 lives in the Name and Code only and the app's own letter is kept. Only
    // a historic letter code (P, Q, AB ...) is forced into the Letter field.
    if (!/^[A-Z]{1,2}$/.test(t.letter)) return;
    await this.select(t.name);
    const edit = this.editPanel();
    const letter = field(edit, 'Letter');
    if (await letter.isVisible().catch(() => false)) {
      const current = (await letter.inputValue().catch(() => '')).trim();
      if (current !== t.letter) {
        await letter.fill(t.letter);
        await edit.getByRole('button', { name: 'Save', exact: true }).click();
        await edit.getByRole('button', { name: 'Change letter' }).click();
        await expect(this.page.getByText(new RegExp(`Letter changed to ${t.letter}`, 'i')).first()).toBeVisible({ timeout: 20000 });
        await this.page.waitForTimeout(1500);
      }
    }
  }

  async ensureActivity(parent, a) {
    await this.expand(parent);
    if (await this.has(a.name)) return;
    const panel = await this.openAddForm(parent, 'Add Activity');
    await field(panel, 'Name').fill(a.name);
    await fillIfShown(field(panel, 'Code'), a.code);
    await field(panel, 'Base UOM').fill(a.baseUom);
    await this.submitCreate(panel, /Activity created/i, a.name);
  }

  async ensureSubActivity(parent, s) {
    await this.expand(parent);
    if (await this.has(s.name)) return;
    const panel = await this.openAddForm(parent, 'Add Sub-Activity');
    await field(panel, 'Name').fill(s.name);
    await fillIfShown(field(panel, 'Code'), s.code);
    // Min Unit: searchable combobox (gotcha 16 - assert the chosen value before Create).
    // Found by its LABEL "Min Unit*" (2026-10-15: the old placeholder "Search Min
    // Unit" no longer matched once a value was typed), and the option is WAITED for -
    // isVisible() is one immediate read, and the list lists all units (CABLE,
    // CULVERT ... TABLE, WORKAREA) a moment after typing.
    const minUnit = panel.getByRole('combobox', { name: /^Min Unit\*?$/ }).first();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await minUnit.fill(s.minUnit);
      const opt = this.page.locator('[role="option"]:visible').filter({ hasText: new RegExp(`^\\s*${escapeRe(s.minUnit)}\\s*$`, 'i') }).first();
      if (await opt.waitFor({ state: 'visible', timeout: 6000 }).then(() => true).catch(() => false)) { await opt.click(); break; }
      await minUnit.fill('');
    }
    await expect(minUnit).toHaveValue(new RegExp(escapeRe(s.minUnit), 'i'));
    await this.chooseByPlaceholder(panel, 'Choose a unit', new RegExp(`^\\s*${escapeRe(s.uom)}`, 'i'));
    await this.submitCreate(panel, /Sub-Activity created/i, s.name);
  }

  async ensureCheckpoint(parent, c) {
    await this.expand(parent);
    if (!(await this.has(c.name))) {
      const panel = await this.openAddForm(parent, 'Add Inspection Point');
      await field(panel, 'Inspection Point Name').fill(c.name);
      await this.chooseByPlaceholder(panel, 'Choose a type', new RegExp(`^\\s*${escapeRe(c.type)}`, 'i'));
      await field(panel, 'Description').fill(c.description);
      const required = panel.getByRole('checkbox', { name: 'Checklist Required' });
      if (c.checklistRequired && !(await required.isChecked().catch(() => false))) await required.click({ force: true });
      await this.submitCreate(panel, /Inspection Point created/i, c.name);
    }
    await this.ensureChecklist(c);
    if (c.after) await this.ensureDependency(c);
  }

  // DEPENDENCY (catalog guide §8; docs/drs-checklists.md §3): "Must be completed
  // first" on the inspection point's form → "Choose an inspection point…" (it offers
  // the other points of the same sub-activity) → the change is marked "not saved
  // yet" → "Save dependencies". Idempotent: a point already waiting on c.after is
  // left alone. The point is selected (ensureChecklist just did).
  async ensureDependency(c) {
    const edit = this.editPanel();
    const section = edit.getByText('Must be completed first', { exact: true }).first();
    await section.scrollIntoViewIfNeeded();
    if (await this.hasDependency(edit, c.after, 4000)) return;
    // Live 2026-10-15: the control is the combobox "Add a preceding inspection point";
    // its options read "L.1.1.1 — PC03.1.1 Checkpoint a  PC03 Sub Package › PC03.1
    // Activity › PC03.1.1 Sub Activity" (serial — name, then the path). The option is
    // WAITED for (isVisible is one immediate read).
    const box = edit.getByRole('combobox', { name: /Add a preceding inspection point/i }).first();
    await box.scrollIntoViewIfNeeded();
    let picked = false;
    for (let attempt = 1; attempt <= 2 && !picked; attempt += 1) {
      await box.fill(c.after);
      const opt = this.page.locator('[role="option"]:visible').filter({ hasText: ` — ${c.after}` }).first();
      if (await opt.waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)) {
        await opt.click();
        picked = true;
      } else {
        await box.fill('');
      }
    }
    if (!picked) throw new Error(`${c.name}: "${c.after}" is not offered as a preceding inspection point`);
    await edit.getByRole('button', { name: 'Save dependencies' }).click();
    await expect(edit.getByText(/not saved yet/i)).toHaveCount(0, { timeout: 15000 });
    expect(await this.hasDependency(edit, c.after), `${c.name}: dependency on ${c.after} not shown after save`).toBe(true);
  }

  // Does the point's "Must be completed first" list hold `name`? (The tree is not
  // in the tab panel, so a name found in the panel is the dependency, not the node.)
  // A listed dependency carries its serial and path ("L.1.1.1 — PC03.1.1 Checkpoint a"
  // …), so the match is on " — <name>" anywhere in the text, and never on the
  // combobox (an input's value is not text) nor on an open option (excluded).
  async hasDependency(panel, name, timeout = 8000) {
    // with or without the serial in front ("… — PC03.1.1 Checkpoint a" / the bare name)
    const hit = panel.getByText(new RegExp(`(^|— )${escapeRe(name)}$`))
      .filter({ hasNot: this.page.locator('[role="option"]') }).first();
    return hit.waitFor({ state: 'visible', timeout }).then(async () => {
      return !(await hit.evaluate((el) => !!el.closest('[role="option"], [role="listbox"]')).catch(() => false));
    }).catch(() => false);
  }

  // 6.6 - the checklist is its own save (gotcha 7) and only exists once the point does.
  async ensureChecklist(c) {
    await this.select(c.name);
    const edit = this.editPanel();
    if (await this.hasChecklistChip(edit, c.checklist, 4000)) return;
    const box = edit.getByPlaceholder('Choose a checklist…');
    await box.scrollIntoViewIfNeeded();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await box.fill(c.checklist.search);
      const opt = this.page.locator('[role="option"]:visible')
        .filter({ hasText: new RegExp(`^\\s*${escapeRe(c.checklist.label)}`) }).first();
      if (await opt.isVisible({ timeout: 5000 }).catch(() => false)) { await opt.click(); break; }
      await box.fill('');
    }
    await edit.getByRole('button', { name: 'Save checklists' }).click();
    await expect(edit.getByText(/not saved yet/i)).toHaveCount(0, { timeout: 15000 });
    await expect(edit.getByText(c.checklist.chip).first()).toBeVisible({ timeout: 10000 });
  }

  // WAITS for the chip (isVisible alone is a single immediate read). Live
  // 2026-10-15: right after a reload the first three checkpoints opened read
  // "no checklist" although the draft check minutes earlier had found all three -
  // the Checklists section loads after the form.
  async hasChecklistChip(panel, checklist, timeout = 8000) {
    return panel.getByText(checklist.chip).first().waitFor({ state: 'visible', timeout })
      .then(() => true).catch(() => false);
  }

  // Every "<code> Sub Package" under a package right now (read-only) - historic
  // letters and counter codes alike (PC01 ...), for picking the next counter.
  async usedLetters(pkg = 'Electrical') {
    const names = await this.subPackageNames(pkg);
    return names.map((n) => (n.match(/^([A-Z]{1,3}\d{0,2}) Sub Package$/) || [])[1]).filter(Boolean);
  }

  // ---- whole letter -------------------------------------------------------------

  // opts -> buildTree (site catalog builds: our checklists on .2.1/.2.2, dependencies).
  async buildLetter(L, pkg = 'Electrical', opts = {}) {
    const t = buildTree(L, opts);
    await this.ensureSubPackage(t, pkg);
    for (const a of t.activities) {
      await this.ensureActivity(t.name, a);
      for (const s of a.subActivities) {
        await this.ensureSubActivity(a.name, s);
        for (const c of s.checkpoints) await this.ensureCheckpoint(s.name, c);
      }
    }
  }

  // Section 7 - READ ONLY. Returns { missing, wrongChecklist, missingDependency }.
  async verifyLetter(L, pkg = 'Electrical', opts = {}) {
    const t = buildTree(L, opts);
    const missing = [];
    const wrongChecklist = [];
    const missingDependency = [];
    await this.expand(pkg);
    // No sub-package means none of its 18 descendants exist either - report the
    // whole tree as missing so the count reads 0/19, not a misleading 18/19.
    if (!(await this.has(t.name))) return { missing: expectedNames(L), wrongChecklist, missingDependency };
    await this.expand(t.name);
    for (const a of t.activities) {
      if (!(await this.has(a.name))) { missing.push(a.name); continue; }
      await this.expand(a.name);
      for (const s of a.subActivities) {
        if (!(await this.has(s.name))) { missing.push(s.name); continue; }
        await this.expand(s.name);
        for (const c of s.checkpoints) {
          if (!(await this.has(c.name))) { missing.push(c.name); continue; }
          await this.select(c.name);
          // Locked versions open read-only (gotcha 18), so the panel is not always an edit form.
          const panel = this.page.getByRole('tabpanel').first();
          if (!(await this.hasChecklistChip(panel, c.checklist))) wrongChecklist.push(`${c.name} (expected ${c.checklist.chip})`);
          if (c.after && !(await this.hasDependency(panel, c.after))) missingDependency.push(`${c.name} (after ${c.after})`);
        }
      }
    }
    return { missing, wrongChecklist, missingDependency };
  }
}

module.exports = PackagesConfiguratorPage;
