const { BasePage } = require('./BasePage');

class DashboardPage extends BasePage {
  constructor(page) {
    super(page);
    // Sidebar navigation
    this.navDashboard = page.locator('a:has-text("Dashboard"), nav >> text=Dashboard').first();
    this.navMyTasks   = page.locator('a:has-text("My Tasks"), nav >> text=My Tasks').first();
    this.navWAM       = page.locator('a:has-text("WAM"), nav >> text=WAM').first();
    this.navReports   = page.locator('a:has-text("Reports"), nav >> text=Reports').first();
    this.logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout")').first();

    // Main dashboard charts (present at /dashboard URL)
    this.rfiDistributionChart = page.locator('text=RFI Distribution').first();
    this.ncDistributionChart  = page.locator('text=NC Distribution').first();
    this.tatSummaryChart      = page.locator('text=TAT Summary').first();
    this.trendAnalysisChart   = page.locator('text=Trend Analysis').first();

    // Detail Records / Summary View toggle above the table
    this.detailRecordsTab = page.locator('text=Detail Records').first();
    this.summaryViewTab   = page.locator('text=Summary View').first();

    // Admin-only sidebar links
    this.navSOMapping     = page.locator('a:has-text("SO Mapping"), nav >> text=SO Mapping').first();
    this.navUsers         = page.locator('a:has-text("Users"), nav >> text=Users').first();
    this.navConfiguration = page.locator('a:has-text("Configuration"), nav >> text=Configuration').first();
    this.navAdminRFIUI    = page.locator('a:has-text("Admin RFI UI"), nav >> text=Admin RFI UI').first();

    // Header: logged-in user name + role label (e.g. "Admin")
    this.userRoleLabel = page.locator('text=Admin').first();
  }

  // Post-login the app shows a PWA loading spinner (0→100%).
  // At 100% the Service Worker finishes installing but the page doesn't
  // auto-transition — we navigate to /my-tasks to kick the app into gear.
  // On subsequent runs (assets cached) the 100% mark is never reached and
  // the app renders directly; the catch block handles that gracefully.
  async waitForLoad() {
    try {
      // Wait up to 6 min for the 100% mark (first run with no cache)
      await this.page.locator('text=100%').waitFor({
        state: 'visible',
        timeout: 600000,
      });
      // Give the SW a moment to register, then navigate into the app
      await this.page.waitForTimeout(2000);
      await this.page.goto(`${process.env.BASE_URL}/my-tasks`);
      await this.page.waitForLoadState('networkidle');
    } catch {
      // 100% mark never appeared — assets already cached, app rendered directly
    }

    // Confirm actual app content is visible.
    // Use .or() — comma inside a single locator string is NOT an OR in Playwright.
    // "Pending with others" covers hierarchy/oversight roles (Cluster Admin,
    // Project Manager, etc.) — confirmed live their My Tasks page has no
    // "Create RFI" button and no "Pending with me" tile at all (they never
    // create or directly action RFI/NC items themselves), only "Pending
    // with others" + "Approved".
    await this.page.locator('text=RFI Distribution')
      .or(this.page.locator('text=Create RFI'))
      .or(this.page.locator('text=Pending with me'))
      .or(this.page.locator('text=Pending with others'))
      .first()
      .waitFor({ state: 'visible', timeout: 60000 });

    await this.page.waitForLoadState('networkidle');
  }

  // Some accounts (already-cached/online sessions, e.g. Admin) never show the
  // first-run "100%" PWA install spinner, so skip that wait entirely and just
  // confirm the dashboard content itself is visible.
  async waitForContentOnly(timeout = 60000) {
    await this.page.locator('text=RFI Distribution')
      .or(this.page.locator('text=Create RFI'))
      .or(this.page.locator('text=Pending with me'))
      .or(this.page.locator('text=Pending with others'))
      .first()
      .waitFor({ state: 'visible', timeout });

    await this.page.waitForLoadState('networkidle');
  }

  async goToMyTasks() {
    await this.navMyTasks.click();
    await this.page.waitForLoadState('networkidle');
  }

  async goToDashboard() {
    await this.navDashboard.click();
    await this.page.waitForLoadState('networkidle');
  }

  async logout() {
    await this.logoutButton.click();
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = DashboardPage;
