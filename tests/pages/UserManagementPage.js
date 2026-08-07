const { BasePage } = require('./BasePage');

// Covers the Admin "Users" section (/users/list) and its "Add User" dialog.
//
// List page: a search box (`input[placeholder="Search by name or email"]`)
// and one card per user (role badge + "Personnel Name" + value). The add
// trigger is a bare `<svg class="lucide-user-plus">` — same not-a-real-
// <button> pattern as WAM's add-assignment icon (see WAMPage.js).
//
// Add User dialog fields, all with real <label> associations EXCEPT the
// Vendor (vendor company) field, whose combobox has no aria-labelledby
// match at all (confirmed via DOM dump — same class of broken-label bug
// already seen in SO Mapping/WAM activity rows and the Reassign modal) —
// it's targeted by position instead, only valid once User Type=VENDOR and
// Vendor Category are both already selected (index 2 of 4 comboboxes):
//   User Type* -> [Vendor Category* -> Vendor*  (VENDOR only)] -> UserRole*
//     -> [Cluster* -> Sites* -> Project type -> Work Locations*] (dynamic
//        per role — some roles stop partway through this cascade, or skip
//        it entirely; only fill whichever of these is actually visible)
//     -> Name* -> Email* -> Phone* -> Submit
//
// Confirmed live (2026-08): AGEL's UserRole list has exactly 10 options
// (no separate "Super Admin" — "Admin" is the only admin-tier role, its
// broader/narrower scope comes from which cascade fields it happens to ask
// for, not a separate role choice). VENDOR's UserRole list has exactly 2
// options: Contractor Manager, Contractor Incharge.
//
// Selecting UserRole (and Vendor Category/Vendor) triggers an async fetch
// for the next cascade field — confirmed live: checking for Cluster
// immediately after picking a role intermittently found nothing, even
// though the field reliably appears once you wait for networkidle plus a
// short buffer (same lesson as WAM's Work Area rows, see WAMPage.js).
class UserManagementPage extends BasePage {
  constructor(page) {
    super(page);

    this.searchInput = page.locator('input[placeholder="Search by name or email"]');
    this.addUserIcon = page.locator('svg.lucide-user-plus, svg.lucide-user-round-plus, svg.lucide-user-plus-2').first();

    this.dialog = page.locator('[role="dialog"], [data-scope="dialog"][data-part="content"]')
      .filter({ hasText: 'Add User' }).first();

    this.userTypeDropdown = this.dialog.getByRole('combobox', { name: /^User Type/i });
    this.userRoleDropdown = this.dialog.getByRole('combobox', { name: /^UserRole/i });
    this.vendorCategoryDropdown = this.dialog.getByRole('combobox', { name: /Vendor Category/i });
    this.vendorDropdown = this.dialog.locator('[role="combobox"]').nth(2);
    this.clusterDropdown = this.dialog.getByRole('combobox', { name: /^Cluster/i });
    this.sitesDropdown = this.dialog.getByRole('combobox', { name: /^Sites/i });
    this.projectTypeDropdown = this.dialog.getByRole('combobox', { name: /Project type/i });
    this.workLocationsDropdown = this.dialog.getByRole('combobox', { name: /Work Locations/i });

    this.nameInput = this.dialog.getByRole('textbox', { name: /^Name/i });
    this.emailInput = this.dialog.getByRole('textbox', { name: /^Email/i });
    this.phoneInput = this.dialog.getByRole('textbox', { name: /^Phone/i });

    this.submitButton = this.dialog.getByRole('button', { name: 'Submit' });
    this.closeButton = this.dialog.locator('[data-part="close-trigger"]');
    this.toast = page.locator('[data-scope="toast"]').first();
  }

  async goto(dashboard) {
    // Defensive: a previous test sharing this same page/session may have
    // left a stray open listbox (or the dialog itself) stuck — recover
    // before this test's own interactions can be blocked by it.
    await this.closeAnyOpenListbox();
    await this.closeDialog();
    await dashboard.navUsers.click();
    await this.page.waitForLoadState('networkidle');
    await this.searchInput.waitFor({ state: 'visible', timeout: 20000 });
  }

  async search(text) {
    await this.searchInput.fill(text);
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForTimeout(500);
  }

  async openAddUserDialog() {
    await this.addUserIcon.waitFor({ state: 'visible', timeout: 15000 });
    await this.addUserIcon.click();
    await this.dialog.waitFor({ state: 'visible', timeout: 10000 });
    await this.page.waitForTimeout(500);
  }

  async _settleAfterCascadeChange() {
    await this.page.waitForLoadState('networkidle').catch(() => {});
    await this.page.waitForTimeout(600);
  }

  async selectUserType(type) {
    await this.selectDropdownOption(this.userTypeDropdown, type);
    await this._settleAfterCascadeChange();
  }

  async selectUserRole(role) {
    await this.selectDropdownOption(this.userRoleDropdown, role);
    await this._settleAfterCascadeChange();
  }

  async selectVendorCategory(category) {
    await this.selectDropdownOption(this.vendorCategoryDropdown, category);
    await this._settleAfterCascadeChange();
  }

  async selectVendor(vendorNameSubstring) {
    await this.selectDropdownOption(this.vendorDropdown, vendorNameSubstring);
    await this._settleAfterCascadeChange();
  }

  // Fills whichever of Cluster/Sites/Project type/Work Locations the
  // currently selected role actually asks for, in that fixed order,
  // stopping naturally once a field isn't present — different roles ask
  // for different prefixes of this cascade (confirmed live: it's always a
  // clean prefix, never a gap), so no per-role field list is needed here.
  //
  // ALL FOUR go through selectMultiAware, not just Project type/Work
  // Locations: Cluster and Sites are single-select for most roles, but
  // confirmed live (user-observed) that for some roles (Project Manager,
  // Plot Admin, Site Admin, Admin) Cluster and/or Sites render as
  // multi-select instead and don't auto-close — plain selectDropdownOption
  // has no way to notice that, so it left their listbox open, and that
  // still-open floating positioner silently blocked clicks on the NEXT
  // cascade field. selectMultiAware detects open-vs-closed at runtime per
  // field and closes explicitly either way, so passing count:1 for
  // Cluster/Sites is safe regardless of which behavior a given role's
  // fields actually have.
  async fillLocationCascade({
    cluster = ['Gujarat', 'Khavda'],
    site = ['Khavda'],
    workLocations = ['A-06c', 'S05b'],
    projectTypeCount = 2,
    workLocationCount = 2,
  } = {}) {
    const picked = {};

    if (await this.clusterDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      picked.cluster = await this.selectMultiAware(this.clusterDropdown, { preferred: cluster, count: 1 });
      await this._settleAfterCascadeChange();
    }
    if (await this.sitesDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      picked.sites = await this.selectMultiAware(this.sitesDropdown, { preferred: site, count: 1 });
      await this._settleAfterCascadeChange();
    }
    if (await this.projectTypeDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      picked.projectType = await this.selectMultiAware(this.projectTypeDropdown, { count: projectTypeCount });
      await this._settleAfterCascadeChange();
    }
    if (await this.workLocationsDropdown.isVisible({ timeout: 3000 }).catch(() => false)) {
      picked.workLocations = await this.selectMultiAware(
        this.workLocationsDropdown, { preferred: workLocations, count: workLocationCount }
      );
      await this._settleAfterCascadeChange();
    }

    return picked;
  }

  // Plain locator.fill() left Name/Email showing a red "invalid" border
  // even with a value present (confirmed live) — same "React controlled
  // input ignores fill()'s synthetic event" issue already worked around in
  // LoginPage.typeInField/RFICreatePage's text inputs elsewhere in this
  // app. pressSequentially fires the real keyboard events React expects.
  async fillIdentity({ name, email, phone }) {
    const type = async (locator, value) => {
      await locator.waitFor({ state: 'visible' });
      await locator.click({ clickCount: 3 });
      await locator.pressSequentially(value, { delay: 30 });
    };
    await type(this.nameInput, name);
    await type(this.emailInput, email);
    await type(this.phoneInput, phone);
    await this.page.keyboard.press('Tab');
  }

  async submit() {
    await this.submitButton.waitFor({ state: 'visible' });
    await this.submitButton.click();

    let toastText = '';
    for (let i = 0; i < 40 && !toastText; i++) {
      toastText = (await this.toast.innerText().catch(() => '')).trim();
      if (!toastText) await this.page.waitForTimeout(300);
    }

    await this.dialog.waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
    await this.page.waitForLoadState('networkidle');
    return toastText;
  }

  async closeDialog() {
    if (await this.closeButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      await this.closeButton.click();
      await this.dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  // A user card on the list page: role badge + "Personnel Name" + value.
  getUserCardByName(name) {
    return this.page.locator(':has-text("Personnel Name")')
      .filter({ hasText: name });
  }

  // A freshly created user does NOT show up in search immediately —
  // confirmed live: an immediate search after Submit's success toast found
  // nothing, but the same search found it about 5s later. Re-searches
  // (not just re-checks) on each attempt in case the list needs the query
  // re-run, not just more render time.
  async waitForUserSearchResult(name, timeout = 25000) {
    const card = this.getUserCardByName(name);
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await this.search(name);
      if (await card.first().isVisible({ timeout: 2000 }).catch(() => false)) return true;
      await this.page.waitForTimeout(1500);
    }
    return false;
  }
}

module.exports = UserManagementPage;
