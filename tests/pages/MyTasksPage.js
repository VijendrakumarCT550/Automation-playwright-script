const { BasePage } = require('./BasePage');

// Covers /my-tasks — the page CI users land on after the dashboard.
// Contains: RFI | NC tabs, Create RFI button, and three status tiles.
class MyTasksPage extends BasePage {
  constructor(page) {
    super(page);
    this.rfiTab = page.locator('button:has-text("RFI")').first();
    this.ncTab  = page.locator('button:has-text("NC")').first();

    this.createRFIButton = page.locator('button:has-text("Create RFI")').first();

    // Tile card locators: each card has ONLY its own title, not the other tiles' titles.
    // Excluding sibling tile text ensures we match the individual card div,
    // not the parent grid container that has all three tiles. The RFI/NC tabs
    // are Ark UI tabs that keep BOTH tabpanels mounted in the DOM (the
    // inactive one just gets hidden), so without `:visible` these locators'
    // `.first()` can resolve to the other (hidden) tab's tile instead of the
    // currently active one — confirmed live: switching to the NC tab and
    // querying pendingWithOthersTile without `:visible` silently matched the
    // still-mounted, now-hidden RFI tab's tile and every wait on it timed out.
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

  async goto() {
    await this.navigate(`${process.env.BASE_URL}/my-tasks`);
    await this.waitForLoad();
  }

  async waitForLoad() {
    await this.createRFIButton.waitFor({ state: 'visible', timeout: 30000 });
  }

  // Role-agnostic "My Tasks has finished loading".
  //
  // waitForLoad() above waits for the Create RFI button, which ONLY CI has.
  // CONFIRMED LIVE at a mobile viewport (2026-09-01, mobile DOM recon): an EE's
  // My Tasks renders the RFI/NC tabs and all three tiles ("Pending with me",
  // "Pending with others", "Approved") but NO Create RFI button — reviewers do
  // not create RFIs — so waitForLoad() can never resolve for EE or QI and just
  // burns its full 30s before failing on a page that had loaded perfectly well.
  //
  // Deliberately a NEW method rather than a change to waitForLoad: the CI specs
  // that call it are legitimately asserting that CI *can* create an RFI, and
  // loosening it would quietly drop that assertion.
  async waitForTasksReady() {
    const race = (locator, name) =>
      locator.waitFor({ state: 'visible', timeout: 30000 }).then(() => name).catch(() => null);

    const winner = await Promise.race([
      race(this.createRFIButton, 'create-rfi'), // CI only
      race(this.pendingWithMeTile, 'tiles'),    // CI, EE and QI all have this
    ]);
    if (winner) return winner;

    // Neither appeared. Blame the tile, not the button: every role that can
    // reach My Tasks has tiles, whereas only CI has the button, so the tile's
    // own timeout is the honest error message.
    await this.pendingWithMeTile.waitFor({ state: 'visible', timeout: 10000 });
    return 'tiles';
  }

  // Role-agnostic wait for the 7 hierarchy/oversight roles (Cluster Admin,
  // Site Admin, Plot Admin, Project Manager, Execution Lead, Quality Lead,
  // Contractor Manager) — waitForTasksReady() above races createRFIButton
  // (CI only) against pendingWithMeTile (CI/EE/QI), and CONFIRMED LIVE
  // (tests/specs/inspection/00_inspect_online_role_extensive.spec.js, Cluster Admin)
  // that an oversight role's My Tasks has NEITHER: no Create RFI button, no
  // "Pending with me" tile at all — only "Pending with others" + "Approved".
  // waitForTasksReady() would burn its full 10s racing two signals that
  // never appear, then throw on its own fallback wait. This races the two
  // signals these roles actually DO have instead.
  async waitForOversightTasksReady() {
    const race = (locator, name) =>
      locator.waitFor({ state: 'visible', timeout: 30000 }).then(() => name).catch(() => null);

    const winner = await Promise.race([
      race(this.pendingWithOthersTile, 'pending-with-others'),
      race(this.approvedTile, 'approved'),
    ]);
    if (winner) return winner;

    await this.pendingWithOthersTile.waitFor({ state: 'visible', timeout: 10000 });
    return 'pending-with-others';
  }

  // Returns the count number displayed in the tile card.
  // First looks for a child element whose text is only digits (the count number).
  // Falls back to parsing any digit from the tile's full text content.
  async getTileCount(tile) {
    // Small wait for API-loaded tile counts to render after page navigation
    await this.page.waitForTimeout(1000);
    try {
      const numEl = tile.locator('text=/^\\d+$/').first();
      if (await numEl.isVisible({ timeout: 3000 }).catch(() => false)) {
        return parseInt(await numEl.textContent()) || 0;
      }
    } catch { /* fall through */ }
    const text = await tile.textContent().catch(() => '');
    const match = (text || '').match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }

  async clickCreateRFI() {
    await this.createRFIButton.waitFor({ state: 'visible' });
    await this.createRFIButton.click();
    await this.page.waitForLoadState('networkidle');
  }

  // Confirmed live (2026-08-19, user watching): right after certain SPA
  // transitions — e.g. landing back on /my-tasks fresh off a draft-save +
  // un-bounce sequence — this tile can look fully loaded but not yet be
  // responsive to a click. Same "looks ready, isn't yet" quirk
  // DashboardPage.goToMyTasks() already had to retry-click past for the
  // sidebar nav link. Retry the click itself until the list page is
  // verifiably reached (URL change), instead of trusting one click to
  // have landed — a plain click + networkidle can silently "succeed"
  // through this window (no request ever fires, so networkidle is
  // trivially true) while the page never actually navigated.
  async clickPendingWithMe() {
    const arrived = () => this.page.waitForURL(/\/my-tasks\/rfi\/list\/pending-with-me/, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    const deadline = Date.now() + 60000;
    do {
      await this.pendingWithMeTile.click();
      await this.page.waitForLoadState('networkidle');
      if (await arrived()) return;
      await this.page.waitForTimeout(1000);
    } while (Date.now() < deadline);

    // Out of retries — throw for real rather than silently returning to a
    // caller that's still stuck on the tiles page (same principle as
    // RFIListPage.openRowByCode's final real-timeout attempt).
    await this.pendingWithMeTile.click();
    await this.page.waitForLoadState('networkidle');
    await this.page.waitForURL(/\/my-tasks\/rfi\/list\/pending-with-me/, { timeout: 15000 });
  }

  async clickPendingWithOthers() {
    await this.pendingWithOthersTile.click();
    await this.page.waitForLoadState('networkidle');
  }

  async clickApproved() {
    await this.approvedTile.click();
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = MyTasksPage;
