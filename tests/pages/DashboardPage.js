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

    // ---- Viewport-agnostic navigation (added for mobile support) ----
    //
    // CONFIRMED live 2026-08-31 (tests/specs/00_inspect_mobile_nav.spec.js),
    // measured on both viewports with the same probe:
    //
    //                      role=treeitem visible   .lucide-menu
    //   desktop 1280x720             8                  0
    //   mobile  412x839 closed       0 (0 in DOM)       1
    //   mobile  412x839 open         8                  1
    //
    // and the two visible item SETS are IDENTICAL: Dashboard, My Tasks, WAM,
    // SO Mapping, Users, Reports, Configuration, Admin RFI UI.
    //
    // That is why there is NO separate mobile page-object tree: both layouts
    // render the same nav items with role="treeitem" (as
    // `<a href="/dashboard" role="treeitem">`); mobile merely hides them
    // behind a drawer. So one locator addresses both, and the only extra step
    // on mobile is opening the drawer first.
    //
    // The trigger locator is deliberately `svg.lucide-menu`, NOT
    // `svg.drawer__trigger`: the latter also matches ONE element on DESKTOP
    // (the sidebar's collapse chevron), so it would click the wrong control
    // there. `.lucide-menu` is 1 on mobile and 0 on desktop.
    this.menuTrigger = page.locator('svg.lucide-menu').first();
    this.navDrawer   = page.locator('[data-scope="dialog"][data-state="open"]').first();
  }

  // A sidebar/drawer nav entry by its visible name, on either viewport.
  navItem(name) {
    return this.page.getByRole('treeitem', { name, exact: true }).first();
  }

  // "The app is loaded and usable" content signal, shared by waitForLoad,
  // waitForContentOnly, resolveIncompleteDownloadBanner and goToMyTasks — which
  // had each grown their own copy of the same 4-way .or() chain.
  //
  // Every alternative is filtered with `>> visible=true`, and that is
  // load-bearing rather than tidy: without it the chain resolves to the first
  // DOM match REGARDLESS of visibility and then waits for that element to
  // become visible. Confirmed live on mobile 2026-08-31 — My Tasks renders
  // RFI/NC tabs, so a HIDDEN copy of "Pending with me" exists, the chain latched
  // onto it, and the wait logged "33 x locator resolved to hidden <p>Pending
  // with me</p>" before timing out, on a page where a visible "Pending with me"
  // tile was on screen the entire time.
  //
  // Desktop behaviour is unchanged: there the first match is already the visible
  // one, and every caller was passing state:'visible' anyway, so this only makes
  // the locator do what the callers always meant.
  //
  // "Pending with others" covers hierarchy/oversight roles (Cluster Admin,
  // Project Manager, ...) — confirmed live their My Tasks has no "Create RFI"
  // button and no "Pending with me" tile at all, only "Pending with others" +
  // "Approved". "RFI Distribution" covers the dashboard itself.
  appReadyContent({ includeDashboard = true } = {}) {
    const vis = (sel) => this.page.locator(`${sel} >> visible=true`);
    let chain = includeDashboard
      ? vis('text=RFI Distribution').or(vis('text=Create RFI'))
      : vis('text=Create RFI');
    return chain
      .or(vis('text=Pending with me'))
      .or(vis('text=Pending with others'))
      .first();
  }

  // Opens the mobile nav drawer, but ONLY when the nav items aren't already
  // reachable. Returns true if it actually opened something.
  //
  // On desktop the treeitems are already present, so this is a single cheap
  // check and a no-op — the desktop code path is unchanged.
  //
  // NOTE on isVisible(): this is the one case where a non-polling immediate
  // check is what we WANT (see the isVisible-does-not-poll gotcha) — the
  // question is literally "is the nav reachable right now, or do I need to
  // open the drawer", not "will it become visible eventually".
  // IMPORTANT LIMITATION, confirmed live 2026-08-31: on mobile the hamburger
  // exists only on TOP-LEVEL screens. On a sub-page (e.g. My Tasks) the header
  // renders a BACK CHEVRON instead, so `.lucide-menu` is absent and the drawer
  // cannot be opened from there at all. This returns false in that case rather
  // than hanging, and callers must have a fallback (see goToMyTasks).
  //
  // `targetName` is the item the caller actually wants. It defaults to
  // 'Dashboard' but should be passed: gating on a hardcoded 'Dashboard' is wrong
  // for any role whose nav does not include it.
  async revealNavIfCollapsed(targetName = 'Dashboard') {
    if (await this.navItem(targetName).isVisible().catch(() => false)) return false;

    if (!(await this.menuTrigger.isVisible().catch(() => false))) return false;

    await this.menuTrigger.click();
    // Wait on a nav item rather than the drawer container: several dialogs
    // exist on this page at once (confirmed live: 3 open after the drawer
    // opens), so the item becoming visible is the reliable signal.
    await this.navItem(targetName).waitFor({ state: 'visible', timeout: 10000 });
    return true;
  }

  // Navigate by nav-entry name on either viewport. Prefer this over the
  // individual navX locators in new code.
  async navigateTo(name) {
    // Pass the ACTUAL target, not the default 'Dashboard': gating the reveal on
    // an item this role may not even have would either skip opening the drawer
    // or wait for something that never appears.
    await this.revealNavIfCollapsed(name);
    await this.navItem(name).click();
    await this.page.waitForLoadState('networkidle');
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
    const content = this.appReadyContent();
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

    // Root-caused live (2026-08-19, resubmit-scenario data-integrity spec,
    // 23_rfi_data_integrity.spec.js): on a page that has ALREADY been
    // through a prior role login in this same test (service worker/PWA
    // background sync already active from that earlier session), a reload
    // here can leave network activity in flight indefinitely — `networkidle`
    // never resolves. This call had no explicit timeout, and
    // playwright.config.js's `actionTimeout` does NOT cover
    // waitForLoadState (that's `navigationTimeout`, which isn't set), so it
    // silently inherited the whole TEST timeout instead of failing fast:
    // observed as a 20-minute stall with the stack trace pointing at this
    // exact line. A single fresh login (no prior session on the page)
    // does NOT reproduce this — an isolated instrumented rerun of one lone
    // CI login finished this same reload+networkidle step in ~2s. Bound it
    // and swallow a timeout here; the real gate is the content-visibility
    // wait right below, which already has its own generous timeout.
    await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});

    // Confirmed live: a reload wipes the SPA's in-memory render state, and
    // `networkidle` alone doesn't guarantee it's actually interactive again
    // — the same "networkidle achieved, not yet clickable" gap waitForLoad()
    // already had to fix once for the post-login case. Without this, the
    // caller's next real click (e.g. the "My Tasks" nav link) can hit a
    // sidebar that looks present but isn't responsive yet.
    await this.appReadyContent().waitFor({ state: 'visible', timeout: 300000 });

    const downloadButton = this.page.getByRole('button', { name: 'Download missing data' });
    if (await downloadButton.isVisible({ timeout: 3000 }).catch(() => false)) {
      await downloadButton.click();
      // Same unbounded-networkidle risk as the reload above — bounded for
      // the same reason.
      await this.page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
    }
  }

  // Some accounts (already-cached/online sessions, e.g. Admin) never show the
  // first-run "100%" PWA install spinner, so skip that wait entirely and just
  // confirm the dashboard content itself is visible.
  async waitForContentOnly(timeout = 60000) {
    await this.appReadyContent().waitFor({ state: 'visible', timeout });

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
    // `>> visible=true` on each alternative is load-bearing, not decoration.
    //
    // Without it the chain is `locator(A).or(B).or(C).first()`, which resolves to
    // the first DOM match regardless of visibility — and then waits for THAT
    // element to become visible. Confirmed live on mobile 2026-08-31: My Tasks
    // renders RFI/NC tabs, so a HIDDEN copy of "Pending with me" exists, the
    // chain latched onto it, and the wait logged
    //   33 x locator resolved to hidden <p ...>Pending with me</p>
    // before timing out — on a page where a perfectly visible "Pending with me"
    // tile was on screen the whole time.
    //
    // Filtering to visible matches first means .first() can only ever pick
    // something already visible. This is what the code always intended (it waits
    // for state:'visible'), so desktop behaviour is unchanged — there the first
    // match is the visible one anyway.
    // includeDashboard:false — "RFI Distribution" is the DASHBOARD's signal, and
    // matching it here would let goToMyTasks conclude it had arrived while still
    // on the dashboard.
    const myTasksContent = () => this.appReadyContent({ includeDashboard: false });

    const arrived = () => myTasksContent()
      .waitFor({ state: 'visible', timeout: 5000 })
      .then(() => true)
      .catch(() => false);

    // Mobile fallback, added 2026-08-31 alongside revealNavIfCollapsed().
    // Clicks the desktop sidebar link when it is present (unchanged behaviour
    // for every existing caller — on desktop navMyTasks IS visible, so this
    // always takes the first branch), and only falls back to the
    // drawer + role=treeitem path when it is not. On mobile navMyTasks
    // resolves to NOTHING (confirmed live: 0 of 8 DashboardPage nav locators
    // resolve at a phone viewport), so without this the click would just burn
    // its timeout every iteration.
    // Confirmed live 2026-08-31 on mobile: after login the app ALREADY lands on
    // My Tasks, so there is nothing to click — and worse, the mobile header on a
    // sub-page shows a back chevron instead of the hamburger, so the drawer
    // cannot be opened from there and the nav click can never succeed. Checking
    // "am I already there" BEFORE clicking fixes that and also saves the desktop
    // path a pointless click.
    //
    // Guarded on the URL as well as the content, deliberately: arrived() matches
    // the TEXT "Pending with me"/"Pending with others", which also appears on
    // sub-pages of My Tasks and could appear in the dashboard's Detail Records
    // grid.
    //
    // The URL test must match ONLY the My Tasks tiles page — note the anchoring.
    // A loose /\/my-tasks/ also matches sub-routes like
    // "/my-tasks/rfi/list/pending-with-me", and that caused a real failure:
    // after EE approved an RFI the app left the browser on that LIST route, the
    // loose test passed, the list's own "Pending with me" heading satisfied
    // arrived(), so goToMyTasks returned early while NOT on the tiles page — and
    // the caller's wait for the Pending-with-me TILE then timed out.
    const onMyTasksTilesPage = /\/my-tasks\/?(?:[?#]|$)/i.test(this.page.url());
    if (onMyTasksTilesPage && await arrived()) return;

    const clickMyTasks = async () => {
      // Desktop sidebar link when present — byte-identical to the original
      // behaviour for every existing caller.
      if (await this.navMyTasks.isVisible().catch(() => false)) {
        await this.navMyTasks.click();
        return;
      }

      // Mobile: open the drawer and use the treeitem.
      await this.revealNavIfCollapsed('My Tasks');
      if (await this.navItem('My Tasks').isVisible().catch(() => false)) {
        await this.navItem('My Tasks').click();
        return;
      }

      // Neither route available — the drawer is unreachable from this screen
      // (mobile sub-page: back chevron, no hamburger). Navigate by URL, the same
      // fallback rfi-flow-turns.js's createNewRfi already uses.
      await this.page.goto(`${process.env.BASE_URL}/my-tasks`);
    };

    const deadline = Date.now() + 3 * 60 * 1000;
    do {
      await clickMyTasks();
      await this.page.waitForLoadState('networkidle');
      if (await arrived()) return;
      await this.page.waitForTimeout(1000);
    } while (Date.now() < deadline);

    // Out of retries — throw for real rather than silently returning to a
    // caller that's still stuck on the dashboard (same principle as
    // RFIListPage.openRowByCode's final real-timeout attempt).
    await clickMyTasks();
    await this.page.waitForLoadState('networkidle');
    // Same visible-only filtering as arrived() above — a hidden duplicate here
    // is exactly what made this wait burn its full timeout on mobile.
    await myTasksContent().waitFor({ state: 'visible', timeout: 15000 });
  }

  // Viewport-aware, for the same reasons goToMyTasks is — this was the last nav
  // call still using a bare legacy locator, and it is on a path the flows
  // actually take: rfi-dependency-flow's getVisibleCodeFor() calls it to force
  // the dashboard-first refresh that dodges the DRAFT-code race. On mobile
  // `navDashboard` resolves to nothing, so a wind RFI could be created and
  // submitted successfully and then die here trying to read its code back
  // (confirmed live 2026-08-31).
  async goToDashboard() {
    // Desktop sidebar link when present — unchanged for every existing caller.
    if (await this.navMyTasks.isVisible().catch(() => false)
        || await this.navDashboard.isVisible().catch(() => false)) {
      await this.navDashboard.click();
      await this.page.waitForLoadState('networkidle');
      return;
    }

    // Mobile: the drawer, when this screen has a hamburger at all.
    await this.revealNavIfCollapsed('Dashboard');
    if (await this.navItem('Dashboard').isVisible().catch(() => false)) {
      await this.navItem('Dashboard').click();
      await this.page.waitForLoadState('networkidle');
      return;
    }

    // Neither route available — mobile sub-page with a back chevron instead of a
    // hamburger. Navigate by URL, same fallback as goToMyTasks.
    await this.page.goto(`${process.env.BASE_URL}/dashboard`);
    await this.page.waitForLoadState('networkidle');
  }

  async logout() {
    await this.logoutButton.click();
    await this.page.waitForLoadState('networkidle');
  }
}

module.exports = DashboardPage;
