const { expect } = require('@playwright/test');
const { openCombobox } = require('../utils/drs-ui');

// Configuration → 3b. Create Service Order (manual SO). docs §3, §11 round 3.
//
// Measured on drs-uat, 2026-09-26:
//   * List view: "Create new service order", then per SO "<number>" +
//     "<code> · <status>" and Edit.
//   * Create page: Header — SO Number* (free text), Vendor* (combobox, options
//     "<code> — <Name>", the name capital-cased by the app, e.g.
//     "997248 — Automation Service Contractor"); Advanced Header Details
//     (all optional text); Service Order Lines — "Add Line" adds a block whose
//     fields are UNLABELLED textboxes following <p> captions: Line Number *,
//     Service Item No *, Quantity *, Actual Qty *, Price Unit *, UOM *.
//   * "A valid service order unlocks SO Configuration": steps 4 and 5 stay
//     disabled until one exists.
//   * WBS Configuration (3a) is NOT used — app owner: SAP-synced SOs only.
class DrsServiceOrderPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  async gotoList(projectId) {
    await this.page.goto(`${this.baseUrl}/projects/${projectId}/configuration?step=so_manual_config`);
    await this.page.getByRole('button', { name: /Create new service order/i })
      .waitFor({ state: 'visible', timeout: 60000 });
  }

  async soListed(number) {
    return this.page.getByText(String(number), { exact: true }).first().isVisible().catch(() => false);
  }

  // The textbox right after a line caption such as "Quantity *".
  lineField(caption) {
    return this.page.locator('p', { hasText: new RegExp(`^\\s*${caption}\\s*\\*\\s*$`) })
      .last().locator('xpath=following::input[1]');
  }

  // Picks the vendor by its CODE (unique), never by list position — the DRS
  // team found downstream systems resolve a project's SO by vendor.
  async pickVendor(code) {
    const combo = this.page.getByRole('combobox', { name: 'Vendor*' });
    await combo.fill(String(code));
    await openCombobox(this.page, combo);
    const option = this.page.locator('[role="option"]:visible')
      .filter({ hasText: new RegExp(`^\\s*${code}\\s*—`) }).first();
    await option.waitFor({ state: 'visible', timeout: 15000 });
    const text = (await option.innerText()).trim();
    await option.click();
    await this.page.waitForTimeout(600);
    return text;
  }

  // Advanced Header Details → Vendor Code + Vendor Name. App owner,
  // 2026-09-26: these are what SO Configuration shows next to the SO number.
  // Measured: picking the Vendor* combobox alone stores VENDOR_CODE "" (the
  // first SO was saved that way, and the Service Orders list then reads NaN).
  async fillAdvancedVendor(code, name) {
    const codeBox = this.page.getByRole('textbox', { name: 'Vendor Code', exact: true });
    if (!(await codeBox.isVisible().catch(() => false))) {
      await this.page.getByRole('button', { name: 'Advanced Header Details' }).click();
      await codeBox.waitFor({ state: 'visible', timeout: 10000 });
    }
    await codeBox.fill(String(code));
    await this.page.getByRole('textbox', { name: 'Vendor Name', exact: true }).fill(name);
  }

  // Opens an existing SO for edit, sets the advanced vendor fields, saves.
  async editVendorDetails(number, code, name) {
    const card = this.page.locator('div').filter({ has: this.page.getByText(String(number), { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: 'Edit' }) }).last();
    await card.getByRole('button', { name: 'Edit' }).click();
    await this.page.getByRole('textbox', { name: 'SO Number*' }).waitFor({ state: 'visible', timeout: 30000 });
    await this.fillAdvancedVendor(code, name);
    const response = this.page.waitForResponse(
      (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\/v1\/service-orders/.test(r.url()),
      { timeout: 90000 },
    );
    await this.page.getByRole('button', { name: 'Save Changes' }).click();
    const res = await response;
    return { status: res.status(), method: res.request().method(), url: res.url(), body: await res.text().catch(() => '') };
  }

  // "Add Line", then fill the NEW block (lineField reads the LAST caption, and the
  // new block is the last one - on the edit form the existing lines are collapsed
  // to "10-10 / 100 EA @ 1/EA" buttons, inspection round 21).
  async addLine(line) {
    await this.page.getByRole('button', { name: 'Add Line' }).click();
    await this.page.waitForTimeout(500);
    await this.lineField('Line Number').fill(String(line.lineNumber));
    await this.lineField('Service Item No').fill(String(line.serviceItemNo));
    await this.lineField('Quantity').fill(String(line.quantity));
    await this.lineField('Actual Qty').fill(String(line.actualQty));
    await this.lineField('Price Unit').fill(String(line.priceUnit));
    await this.lineField('UOM').fill(String(line.uom));
    // THE SERVICE CODE goes in Optional Line Fields → "Activity Code" (app owner,
    // 2026-10-15; the step-5 card shows it as "Service Code"). The newest line's
    // section is the last one; it opens on a click (inspection round 13).
    if (line.serviceCode) {
      await this.page.getByText('Optional Line Fields', { exact: true }).last().click();
      const box = this.page.getByText('Activity Code', { exact: true }).last().locator('xpath=following::input[1]');
      await box.waitFor({ state: 'visible', timeout: 10000 });
      await box.fill(String(line.serviceCode));
      await expect(box).toHaveValue(String(line.serviceCode));
    }
  }

  // ADDS lines to an EXISTING SO (a new catalog version brought onto an existing
  // project, 2026-10-15): Edit → Add Line per line → Save Changes. Returns the
  // save call's answer.
  async addLines(number, lines) {
    const card = this.page.locator('div').filter({ has: this.page.getByText(String(number), { exact: true }) })
      .filter({ has: this.page.getByRole('button', { name: 'Edit' }) }).last();
    await card.getByRole('button', { name: 'Edit' }).click();
    await this.page.getByRole('textbox', { name: 'SO Number*' }).waitFor({ state: 'visible', timeout: 30000 });
    await this.page.waitForTimeout(1000);
    for (const line of lines) await this.addLine(line);
    const response = this.page.waitForResponse(
      (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\/v1\/service-orders/.test(r.url()),
      { timeout: 90000 },
    );
    await this.page.getByRole('button', { name: 'Save Changes' }).click();
    const res = await response;
    return { status: res.status(), method: res.request().method(), url: res.url(), body: await res.text().catch(() => '') };
  }

  async createServiceOrder({ number, vendorCode, vendorName, lines = [] }) {
    await this.page.getByRole('button', { name: /Create new service order/i }).click();
    const soBox = this.page.getByRole('textbox', { name: 'SO Number*' });
    await soBox.waitFor({ state: 'visible', timeout: 30000 });
    await soBox.fill(String(number));
    const vendorText = await this.pickVendor(vendorCode);
    if (vendorName) await this.fillAdvancedVendor(vendorCode, vendorName);

    for (const line of lines) await this.addLine(line);

    const response = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /\/api\/v1\/service-orders/.test(r.url()),
      { timeout: 90000 },
    );
    await this.page.getByRole('button', { name: 'Create Service Order' }).click();
    const res = await response;
    return { status: res.status(), url: res.url(), body: await res.text().catch(() => ''), vendorText };
  }
}

module.exports = DrsServiceOrderPage;
