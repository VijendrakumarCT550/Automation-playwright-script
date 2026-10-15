// VENDOR MANAGEMENT in the USER MANAGEMENT app - where it lives since the app
// owner's change on 2026-10-01 (it used to be DRS App Settings -> Vendors, at
// /appSettings/vendors on the DRS host; those routes no longer show a vendor
// screen). docs/drs-pulse-integration.md section 3.
//
// User Management is a SEPARATE app: its own host (auth-mgmt-<env>, see
// tests/config/drs-environments.js), its own email + password login page, and
// its own session - logging in to DRS does not log you in here. The DRS Super
// Admin credentials work. It opens from the DRS profile menu in a new tab.
//
// Measured on auth-mgmt-uat, 2026-10-01 (inspection/00_drs_explore_round6_*):
//   * Route /appSettings/vendors - a "Vendors" tab beside "Users" and "Roles".
//   * "Search vendors" box + "Add Vendor" button + a Code | Name | GST |
//     Category grid, each row carrying an "Edit vendor" button. (The old screen
//     had NO edit; the new one does. Nothing here edits.)
//   * "Add Vendor" opens a dialog: Code*, Name*, GST Number*, Category
//     (defaults to "Service Contractor"), then optional address/contact fields,
//     Cancel and Save.
//   * NOT yet observed: the create request's URL/status. The old one was
//     POST /api/v1/boq/db/vendors on the DRS host; this one is on a different
//     host, so createVendor() matches ANY POST whose URL mentions "vendor" and
//     reports what it saw - and D01 then proves the vendor by finding it in the
//     list rather than trusting the status.
//
// Every create waits for the server's own answer and returns its status - a
// closed dialog is not proof of a create (this suite's "silent no-op" lesson).
class UserManagementVendorPage {
  constructor(page, baseUrl) {
    this.page = page;
    this.baseUrl = baseUrl;
  }

  url(p) { return `${this.baseUrl}${p}`; }

  // ---- Session ------------------------------------------------------------

  async login({ email, password }) {
    await this.page.goto(this.url('/login'));
    const emailBox = this.page.getByRole('textbox', { name: 'Email' });
    // Already signed in (a stored session sends /login straight onward).
    if (!(await emailBox.isVisible({ timeout: 15000 }).catch(() => false))) {
      if (!/\/login/.test(this.page.url())) return;
    }
    await emailBox.fill(email);
    await this.page.getByRole('textbox', { name: 'Password' }).fill(password);
    await this.page.getByRole('button', { name: 'Log In', exact: true }).click();
    await this.page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 60000 });
  }

  // ---- Vendors ------------------------------------------------------------

  get searchBox() { return this.page.getByRole('textbox', { name: 'Search vendors' }); }

  async gotoVendors() {
    await this.page.goto(this.url('/appSettings/vendors'));
    if (!(await this.searchBox.isVisible({ timeout: 20000 }).catch(() => false))) {
      // The URL alone did not land on the tab (it can open Users first).
      await this.page.getByRole('tab', { name: 'Vendors' }).click();
    }
    await this.searchBox.waitFor({ state: 'visible', timeout: 60000 });
    await this.page.getByRole('grid').waitFor({ state: 'visible', timeout: 60000 });
  }

  // Returns { code, name } of the first vendor row whose Name matches, or null.
  async findVendor(name) {
    await this.gotoVendors();
    await this.searchBox.fill(name);
    await this.page.waitForTimeout(1500);
    const row = this.page.getByRole('row').filter({ hasText: name }).first();
    if (!(await row.isVisible().catch(() => false))) return null;
    const cells = await row.getByRole('gridcell').allInnerTexts();
    return { code: (cells[0] || '').trim(), name: (cells[1] || '').trim() };
  }

  async createVendor({ name, code, gst }) {
    await this.gotoVendors();
    await this.page.getByRole('button', { name: 'Add Vendor' }).click();
    const dialog = this.page.getByRole('dialog', { name: /Add Vendor/i });
    await dialog.waitFor({ state: 'visible', timeout: 30000 });

    await dialog.getByRole('textbox', { name: 'Code*' }).fill(code);
    await dialog.getByRole('textbox', { name: 'Name*' }).fill(name);
    await dialog.getByRole('textbox', { name: 'GST Number*' }).fill(gst);

    const category = dialog.getByRole('combobox', { name: 'Category' });
    const categoryValue = (await category.inputValue().catch(() => '')) || (await category.innerText().catch(() => ''));
    if (!/Service Contractor/i.test(categoryValue)) {
      throw new Error(`Vendor Category is "${categoryValue}", expected the default "Service Contractor"`);
    }

    const response = this.page.waitForResponse(
      (r) => r.request().method() === 'POST' && /vendor/i.test(r.url()),
      { timeout: 60000 },
    );
    await dialog.getByRole('button', { name: 'Save' }).click();
    const res = await response;
    await dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    return { status: res.status(), url: res.url(), body: await res.text().catch(() => '') };
  }
}

module.exports = UserManagementVendorPage;
