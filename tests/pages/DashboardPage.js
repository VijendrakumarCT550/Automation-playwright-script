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

  // Post-login the app shows a PWA loading spinner (0→100%) ONLY on a
  // genuinely fresh install (no cached assets). At 100% the Service Worker
  // finishes installing but the page doesn't auto-transition — we navigate
  // to /my-tasks to kick the app into gear.
  //
  // Confirmed live on pulse-test: the spinner can simply never appear for
  // CI/EE/QI too (not just the already-cached hierarchy-role accounts
  // waitForContentOnly() was written for) — the dashboard renders directly.
  // The OLD code waited for the spinner FIRST, sequentially, before ever
  // checking content — so on a run where the spinner never shows, it sat
  // dead for the full 10-minute timeout before its catch block let it fall
  // through to check content that had actually been visible the whole
  // time. Racing the two instead of sequencing them means whichever
  // actually happens takes effect immediately.
  async waitForLoad() {
    // Use .or() — comma inside a single locator string is NOT an OR in Playwright.
    // "Pending with others" covers hierarchy/oversight roles (Cluster Admin,
    // Project Manager, etc.) — confirmed live their My Tasks page has no
    // "Create RFI" button and no "Pending with me" tile at all (they never
    // create or directly action RFI/NC items themselves), only "Pending
    // with others" + "Approved".
    const content = this.page.locator('text=RFI Distribution')
      .or(this.page.locator('text=Create RFI'))
      .or(this.page.locator('text=Pending with me'))
      .or(this.page.locator('text=Pending with others'))
      .first();
    const spinner = this.page.locator('text=100%');

    const winner = await Promise.race([
      spinner.waitFor({ state: 'visible', timeout: 600000 }).then(() => 'spinner').catch(() => 'timeout'),
      content.waitFor({ state: 'visible', timeout: 600000 }).then(() => 'content').catch(() => 'timeout'),
    ]);

    if (winner === 'spinner') {
      // Give the SW a moment to register, then navigate into the app
      await this.page.waitForTimeout(2000);
      await this.page.goto(`${process.env.BASE_URL}/my-tasks`);
      await this.page.waitForLoadState('networkidle');
    }

    // Confirm actual app content is visible — either it already won the
    // race above, or we just navigated in after the spinner and need to
    // check for real now. Confirmed live (single-session-login-fix-for-passes
    // branch, 3 roles logging in truly concurrently via Promise.all): running
    // 3 simultaneous PWA installs on one machine can push this post-spinner
    // content render well past 60s — one run hit this exact timeout after
    // 4.5 total minutes of concurrent-login contention. Widened to 5 min to
    // absorb that load instead of failing the whole login (and, upstream of
    // here, the whole test) over a real-but-slow render.
    await content.waitFor({ state: 'visible', timeout: 300000 });
    await this.page.waitForLoadState('networkidle');
  }

  // User-confirmed live (screenshot): CI/EE/QI (this app's OFFLINE/PWA
  // accounts, unlike Admin/hierarchy roles which are "online") can
  // occasionally show a "Some data didn't finish downloading" banner after
  // login, with a "Download missing data" button — NOT guaranteed, only
  // under slow connectivity or when the account has a lot of data to sync.
  // Never wait FOR it (it may never appear) — reload once to force the
  // banner's real state to show, do one short/quick presence check, act
  // only if actually present, then continue either way. Caller is
  // responsible for only calling this for CI/EE/QI logins, not Admin/
  // hierarchy-role ones.
  async resolveIncompleteDownloadBanner() {
    await this.page.reload();
    await this.page.waitForLoadState('networkidle');

    // Confirmed live: a reload wipes the SPA's in-memory render state, and
    // `networkidle` alone doesn't guarantee it's actually interactive again
    // — the same "networkidle achieved, not yet clickable" gap waitForLoad()
    // already had to fix once for the post-login case. Without this, the
    // caller's next real click (e.g. the "My Tasks" nav link) can hit a
    // sidebar that looks present but isn't responsive yet.
    await this.page.locator('text=RFI Distribution')
      .or(this.page.locator('text=Create RFI'))
      .or(this.page.locator('text=Pending with me'))
      .or(this.page.locator('text=Pending with others'))
      .first()
      .waitFor({ state: 'visible', timeout: 300000 });

    const downloadButton = this.page.getByRole('button', { name: 'Download missing data' });
    if (await downloadButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await downloadButton.click();
      await this.page.waitForLoadState('networkidle');
    }
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

  // Confirmed live: right after the dashboard finishes rendering (content
  // visible + networkidle already satisfied), the app can sit unresponsive
  // to real clicks for 1-3 more minutes — the page looks fully loaded but
  // nothing happens when you click. A plain click + networkidle silently
  // "succeeds" through this window (no request ever fires, so networkidle
  // is trivially true) and the caller sails on to the next step, which then
  // burns its own timeout waiting on a page that was never actually
  // reached. Retry the click itself until My Tasks' own content is
  // verifiably visible — same content signal used by waitForLoad/
  // waitForContentOnly to detect the app is actually usable — instead of
  // trusting one click to have landed.
  async goToMyTasks() {
    const arrived = () => this.page.locator('text=Create RFI')
      .or(this.page.locator('text=Pending with me'))
      .or(this.page.locator('text=Pending with others'))
      .first()
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    const deadline = Date.now() + 3 * 60 * 1000;
    do {
      await this.navMyTasks.click();
      await this.page.waitForLoadState('networkidle');
      if (await arrived()) return;
      await this.page.waitForTimeout(1000);
    } while (Date.now() < deadline);

    // Out of retries — throw for real rather than silently returning to a
    // caller that's still stuck on the dashboard (same principle as
    // RFIListPage.openRowByCode's final real-timeout attempt).
    await this.navMyTasks.click();
    await this.page.waitForLoadState('networkidle');
    await this.page.locator('text=Create RFI')
      .or(this.page.locator('text=Pending with me'))
      .or(this.page.locator('text=Pending with others'))
      .first()
      .waitFor({ state: 'visible', timeout: 15000 });
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
