const { expect } = require('@playwright/test');

// DRS App Settings → Service Configurator (/appSettings/serviceConfigurator).
// docs/drs-so-lines-and-service-codes.md §3.1.
//
// Measured on drs-uat, 2026-10-15 (inspection rounds 13-14):
//   * left: "Search service codes", a list of codes ("120021756 / PILING WORK /
//     9 sub-activities"), "Mapped only", "Apply to existing SOs", "Download conflict
//     report";
//   * right, per code: "<n> of <total> selected", "Search sub-activities", a block of
//     "Not available (n)" mappings (sub-activities no catalog version holds any more),
//     and a TREE of treeitems, three levels - sub-package → activity → sub-activity -
//     each labelled "<name> <Type> · <version label>" (e.g. "Piling - MMS Solar ·
//     Automation Site 01 v1") with its own checkbox; Clear mapping / Save.
//   * GLOBAL: saving re-applies the mapping to every existing SO line with this code
//     that has no billed work. So this page only ever ADDS ticks, never unticks.
class ServiceConfiguratorPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async goto() {
    await this.page.goto(`${this.baseUrl}/appSettings/serviceConfigurator`);
    await this.codeSearch().waitFor({ state: 'visible', timeout: 60000 });
  }

  codeSearch() { return this.page.getByPlaceholder(/Search service codes/i).first(); }
  subSearch() { return this.page.getByPlaceholder(/Search sub-activities/i).first(); }

  async openCode(code) {
    await this.codeSearch().fill(code);
    await this.page.waitForTimeout(1500);
    await this.page.getByText(code, { exact: true }).first().click();
    await this.subSearch().waitFor({ state: 'visible', timeout: 20000 });
    await expect(this.page.getByText(code, { exact: true }).last()).toBeVisible();
    await this.page.waitForTimeout(1500);
  }

  async selectedText() {
    return (await this.page.getByText(/\d+ of \d+ selected/).first().innerText().catch(() => '')).trim();
  }

  // The sub-activity's tree row in one version (level 3). The search filters and
  // expands the tree (round 14 screenshot), so search first.
  //
  // THE TREE IS VIRTUALISED (first live run, 2026-10-15): only ~10 versions' rows
  // are in the DOM (All sites v1-v5, Khavda v1-v5 ...), so a row further down -
  // our "Automation Site 01 v1" - does not exist until the tree is scrolled to it.
  // Scrolls the tree's own scroll container a screen at a time until the row is
  // rendered or the bottom is reached.
  // `search` (app owner, 2026-10-15): a term common to the whole group - "Piling"
  // lists every Piling sub-activity at once - so one search serves several rows;
  // the box is only refilled when the term changes.
  async subActivityRow(name, typeLabel, version, search = name) {
    if ((await this.subSearch().inputValue().catch(() => '')) !== search) {
      await this.subSearch().fill(search);
      await this.page.waitForTimeout(2000);
    }
    // back to the top of the tree for every row (it is scrolled below)
    await this.page.getByRole('treeitem').first().evaluate((el) => {
      let box = el.parentElement;
      while (box && !(box.scrollHeight > box.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
      if (box) box.scrollTop = 0;
    }).catch(() => {});
    await this.page.waitForTimeout(300);
    // A version that went through a draft labels its sub-activity rows with their
    // serial: "Piling - MMS (F.3.1) Solar · Automation Site 01 v1" (2026-10-15);
    // older versions have none ("Piling - MMS Solar · All sites v1").
    const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const label = new RegExp(`^${esc(name)}( \\([^)]+\\))? ${esc(typeLabel)} · ${esc(version)}$`);
    const row = this.page.getByRole('treeitem', { name: label, level: 3 }).first();
    for (let i = 0; i < 60; i += 1) {
      if (await row.count()) {
        await row.scrollIntoViewIfNeeded().catch(() => {});
        return row;
      }
      const moved = await this.page.getByRole('treeitem').first().evaluate((el) => {
        let box = el.parentElement;
        while (box && !(box.scrollHeight > box.clientHeight + 5 && /(auto|scroll)/.test(getComputedStyle(box).overflowY))) box = box.parentElement;
        if (!box) return false;
        const top = box.scrollTop;
        box.scrollTop = top + box.clientHeight * 0.8;
        return box.scrollTop !== top;
      }).catch(() => false);
      await this.page.waitForTimeout(400);
      if (!moved && !(await row.count())) break;
    }
    // Not reached with the group term (live 2026-10-15: the LAST row of a long
    // "Piling" list never rendered): search the sub-activity's own name, a much
    // shorter list, and look again.
    if (!(await row.count()) && search !== name) return this.subActivityRow(name, typeLabel, version, name);
    return row;
  }

  // THE ROW IS THE CHECKBOX (inspection round 15, 2026-10-15): the treeitem carries
  // aria-checked; the checkbox drawn inside it is aria-hidden with pointer-events:
  // none, so it is neither found by role nor clickable. Read and set the state on
  // the row. (Reading an inner checkbox always said "not ticked".)
  async isTicked(row) {
    return (await row.getAttribute('aria-checked').catch(() => null)) === 'true';
  }

  // Ticks the row if it is not ticked yet - ONE click on the row, then the state is
  // re-read (a second click would untick it). Returns true when it changed it.
  async tick(row) {
    await row.waitFor({ state: 'visible', timeout: 15000 });
    if (await this.isTicked(row)) return false;
    await row.click({ position: { x: 60, y: 17 } });
    await expect.poll(() => this.isTicked(row), { timeout: 5000, message: 'the row did not tick' }).toBe(true);
    return true;
  }

  // Save, through the confirmation the catalog guide (10.3) describes ("Save the
  // mapping for <code>?" ... "Save and apply") when it appears. Returns the call's answer.
  // Save is TWO calls (live 2026-10-15): Save → POST …/<code>/preview, which only
  // counts what would change ("changes the sub-activities on 19 existing service
  // order lines, on 19 service orders") and opens the confirmation; "Save and apply"
  // → the real write. So the answer awaited is the call AFTER the preview. A first
  // version awaited the preview, moved on, and nothing was applied.
  async save() {
    const isWrite = (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\//.test(r.url())
      && !/\/api\/v1\/query\//.test(r.url());
    const preview = this.page.waitForResponse((r) => isWrite(r) && /\/preview/.test(r.url()), { timeout: 60000 }).catch(() => null);
    await this.page.getByRole('button', { name: 'Save', exact: true }).click();
    const previewRes = await preview;
    const previewBody = previewRes ? await previewRes.text().catch(() => '') : '';
    const confirm = this.page.getByRole('button', { name: /Save and apply/i });
    let dialogText = '';
    const apply = this.page.waitForResponse((r) => isWrite(r) && !/\/preview/.test(r.url()), { timeout: 120000 });
    if (await confirm.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
      dialogText = (await this.page.getByRole('dialog').last().innerText().catch(() => '')).trim();
      await confirm.click();
    }
    const res = await apply;
    dialogText = `${dialogText}\n    preview: ${previewBody.slice(0, 200)}`;
    await this.page.waitForTimeout(2000);
    return { status: res.status(), url: res.url(), body: await res.text().catch(() => ''), dialogText };
  }
}

module.exports = ServiceConfiguratorPage;
