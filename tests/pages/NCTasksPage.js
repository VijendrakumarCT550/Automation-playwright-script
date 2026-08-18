const { BasePage } = require('./BasePage');

// Covers the NC side of /my-tasks — the NC tab plus its three status tiles
// (Pending with me / Pending with others / Approved), same shape as RFI's
// tiles on MyTasksPage.js.
//
// Deliberately a separate file, not a shared/reused class — explicit user
// instruction to keep NC 100% isolated from RFI's files (see
// project_nc_creation_feature memory). The ONE real difference from RFI's
// flow, per explicit user description: My Tasks defaults to the RFI tab,
// so reaching NC's tiles always requires an explicit NC-tab click first —
// RFI's flow never needed this since its tab is already the default.
class NCTasksPage extends BasePage {
  constructor(page) {
    super(page);
    this.ncTab = page.locator('button:has-text("NC")').first();

    // Same tile-locator pattern as MyTasksPage.js's RFI tiles (`:visible`-
    // scoped so this doesn't match the OTHER, currently-hidden tab's
    // same-labeled tile — Ark UI tabs keep both tabpanels mounted at once).
    this.pendingWithMeTile = page
      .locator(':has-text("Pending with me"):not(:has-text("Pending with others")):visible')
      .first();
    this.pendingWithOthersTile = page
      .locator(':has-text("Pending with others"):not(:has-text("Pending with me")):not(:has-text("Approved")):visible')
      .first();
    this.approvedTile = page
      .locator(':has-text("Approved"):not(:has-text("Pending")):visible')
      .first();
  }

  async clickNcTab() {
    await this.ncTab.waitFor({ state: 'visible', timeout: 15000 });
    await this.ncTab.click();
    await this.page.waitForLoadState('networkidle');
    // Confirmed live: right after switching tabs, the "Pending with me"
    // tile locator resolves and initially reports visible/enabled/stable,
    // but Playwright's own click() actionability check then does its own
    // "scroll into view if needed" step, which flips it to NOT visible and
    // it never recovers — a scroll-triggered layout shift RFI's flow never
    // hits (its tab is already the default, no tab-click/scroll ever
    // happens before its own tile clicks). Explicitly resetting scroll
    // position to the top right after the tab switch, before anything
    // tries to locate/click a tile, avoids triggering that shift at all.
    await this.page.evaluate(() => window.scrollTo(0, 0));
    await this.page.waitForTimeout(500);
  }

  async clickPendingWithMe() {
    await this.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
    // force: true — confirmed live (single-session-login-fix-for-passes
    // branch): even with clickNcTab()'s scroll-reset mitigation, click()'s
    // own internal "scroll into view if needed" actionability step can
    // still flip this tile to reporting not-visible and never recover —
    // the exact permanent quirk clickNcTab()'s header comment already
    // describes, just not fully eliminated by that fix under this run's
    // conditions. The tile passed its own explicit waitFor above (genuinely
    // visible/enabled/stable at that point), so bypassing click()'s
    // redundant re-check here is safe, same reasoning as
    // RFIReviewPage.rejectFromChecklistPage()'s force-clicked radio.
    await this.pendingWithMeTile.click({ force: true });
    await this.page.waitForLoadState('networkidle');
  }

  async clickPendingWithOthers() {
    await this.pendingWithOthersTile.waitFor({ state: 'visible', timeout: 30000 });
    await this.pendingWithOthersTile.click();
    await this.page.waitForLoadState('networkidle');
  }

  async clickApproved() {
    await this.approvedTile.waitFor({ state: 'visible', timeout: 30000 });
    await this.approvedTile.click();
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = NCTasksPage;
