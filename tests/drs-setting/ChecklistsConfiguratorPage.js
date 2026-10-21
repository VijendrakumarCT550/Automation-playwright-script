const { expect } = require('@playwright/test');

// DRS App Settings → Checklists Configurator (/appSettings/checklistsConfigurator).
// docs/drs-checklists.md §1. Measured on drs-uat, 2026-10-15 (inspection rounds 18-19):
//   * list: "Search by name, serial or SFQP number…", Project Type / activity
//     filters, cards "<name> / <SFQP> / Used by N inspection point(s)". NAMES REPEAT
//     (Micro Pile Checklist ×4: …/C/012, -R1, -R3, -R5) - a checklist is name + SFQP.
//   * detail: SFQP, SERIAL, FORMAT, "Questions N", "Used by N", the questions
//     (no., text, type, Required) and "Fork to edit". No in-place edit.
//   * "New checklist" dialog: textboxes "Checklist name", "SERIAL", "SFQP", "FORMAT";
//     per question row: spinbutton "No.", textbox "Question text", combobox "Answer
//     type" (Text / YesNo / Number), a checkbox "Value required" (on by default),
//     button "Remove"; "Add question"; "Create" (disabled until a question exists).
//   * "Fork "<name>"" dialog: "Checklist name" (pre-filled), the copied question rows
//     (same shape), "Add question", "Create fork". The SFQP is assigned on save.
// CHECKLISTS CANNOT BE DELETED - the caller records each one the moment it exists.
class ChecklistsConfiguratorPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async goto() {
    await this.page.goto(`${this.baseUrl}/appSettings/checklistsConfigurator`);
    await this.page.getByRole('button', { name: 'New checklist' }).waitFor({ state: 'visible', timeout: 60000 });
  }

  search() { return this.page.getByPlaceholder(/Search by name, serial or SFQP/i).first(); }

  // The list card of a checklist: by name, and by SFQP when given (names repeat).
  // The search is server-side and can take longer than a fixed wait as the list
  // grows (live 2026-10-21, R6-S2: a checklist made a minute earlier was "not
  // found" after 2 s), so the list is POLLED for up to 20 s per search term - by
  // SFQP, then by name.
  async card(name, sfqp) {
    const cards = this.page.getByRole('button').filter({ hasText: name });
    const find = async () => {
      const n = await cards.count();
      for (let i = 0; i < n; i += 1) {
        const lines = (await cards.nth(i).innerText().catch(() => '')).split('\n').map((t) => t.trim()).filter(Boolean);
        if (lines[0] === name && (!sfqp || lines[1] === sfqp)) return { card: cards.nth(i), sfqp: lines[1] };
      }
      return null;
    };
    for (const term of [...new Set([sfqp || name, name])]) {
      await this.search().fill(term);
      const started = Date.now();
      while (Date.now() - started < 20000) {
        await this.page.waitForTimeout(1000);
        const hit = await find();
        if (hit) return hit;
      }
    }
    return null;
  }

  // { name, sfqp, serial, format, questions: [{ no, text, type, required }] } read
  // from the detail view, or null when no such checklist exists.
  async read(name, sfqp) {
    const hit = await this.card(name, sfqp);
    if (!hit) return null;
    await hit.card.click();
    await this.page.getByRole('button', { name: 'Fork to edit' }).waitFor({ state: 'visible', timeout: 15000 });
    await this.page.waitForTimeout(1000);
    const text = await this.page.locator('body').innerText();
    const detail = text.slice(text.lastIndexOf('Fork to edit') + 'Fork to edit'.length);
    const lines = detail.split('\n').map((t) => t.trim()).filter(Boolean);
    const after = (label) => { const i = lines.indexOf(label); return i >= 0 ? lines[i + 1] : null; };
    // Questions follow "Used by" + its number: "<no>" "<text>" "<Type>" ["Required"].
    const out = { name, sfqp: after('SFQP'), serial: after('SERIAL'), format: after('FORMAT'), questions: [] };
    let i = lines.indexOf('Used by') + 2;
    while (i < lines.length && /^\d+$/.test(lines[i])) {
      const q = { no: Number(lines[i]), text: lines[i + 1], type: lines[i + 2], required: lines[i + 3] === 'Required' };
      out.questions.push(q);
      i += q.required || lines[i + 3] === 'Optional' ? 4 : 3;
    }
    return out;
  }

  // Fills question rows starting at row `from` (0-based) in a dialog.
  async fillQuestions(dialog, questions, from = 0) {
    for (const [k, q] of questions.entries()) {
      await dialog.getByRole('button', { name: 'Add question' }).click();
      await this.page.waitForTimeout(400);
      const row = from + k;
      await dialog.getByRole('textbox', { name: 'Question text' }).nth(row).fill(q.text);
      const type = dialog.getByRole('combobox', { name: 'Answer type' }).nth(row);
      if ((await type.innerText().catch(() => '')).trim() !== q.type) {
        await type.click();
        await this.page.locator('[role="option"]:visible').filter({ hasText: new RegExp(`^\\s*${q.type}\\s*$`) }).first().click();
        await this.page.waitForTimeout(300);
      }
      await expect(type).toContainText(q.type);
      const req = dialog.getByRole('checkbox').nth(row);
      const isOn = async () => (await req.isChecked().catch(() => null)) === true
        || (await req.getAttribute('data-state').catch(() => '')) === 'checked'
        || (await req.getAttribute('aria-checked').catch(() => '')) === 'true';
      if ((await isOn()) !== q.required) {
        await req.click({ force: true });
        await this.page.waitForTimeout(300);
      }
      expect(await isOn(), `question "${q.text}": Value required should be ${q.required}`).toBe(q.required);
    }
  }

  // Waits for the create / fork write and returns its answer.
  async submit(dialog, buttonName) {
    const response = this.page.waitForResponse(
      (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\//.test(r.url())
        && !/\/api\/v1\/query\//.test(r.url()),
      { timeout: 60000 },
    );
    await dialog.getByRole('button', { name: buttonName, exact: true }).click();
    const res = await response;
    await dialog.waitFor({ state: 'hidden', timeout: 20000 }).catch(() => {});
    await this.page.waitForTimeout(1500);
    // The request too, so a refusal (first live run: HTTP 500 "Internal server
    // error" on create) can be reported with exactly what was sent.
    return {
      status: res.status(), url: res.url(), body: await res.text().catch(() => ''),
      method: res.request().method(), payload: (res.request().postData() || '').slice(0, 3000),
    };
  }

  async create({ name, serial, sfqp, format, questions }) {
    await this.goto();
    await this.page.getByRole('button', { name: 'New checklist' }).click();
    const dialog = this.page.getByRole('dialog', { name: 'New checklist' });
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await dialog.getByRole('textbox', { name: 'Checklist name' }).fill(name);
    await dialog.getByRole('textbox', { name: 'SERIAL' }).fill(serial);
    await dialog.getByRole('textbox', { name: 'SFQP' }).fill(sfqp);
    await dialog.getByRole('textbox', { name: 'FORMAT' }).fill(format);
    await this.fillQuestions(dialog, questions, 0);
    return this.submit(dialog, 'Create');
  }

  // Forks the checklist `source` (name + SFQP) under a new name, keeping its
  // questions and appending `addQuestions`.
  async fork(source, { name, addQuestions }) {
    await this.goto();
    const hit = await this.card(source.name, source.sfqp);
    if (!hit) throw new Error(`fork source "${source.name}" (${source.sfqp}) not found`);
    await hit.card.click();
    await this.page.getByRole('button', { name: 'Fork to edit' }).click();
    const dialog = this.page.getByRole('dialog').filter({ hasText: /Fork "/ }).last();
    await dialog.waitFor({ state: 'visible', timeout: 15000 });
    await dialog.getByRole('textbox', { name: 'Checklist name' }).fill(name);
    const copied = await dialog.getByRole('textbox', { name: 'Question text' }).count();
    await this.fillQuestions(dialog, addQuestions, copied);
    return { ...(await this.submit(dialog, 'Create fork')), copied };
  }
}

module.exports = ChecklistsConfiguratorPage;
