const { test, expect } = require('../config/test-base');
const LoginPage = require('../pages/LoginPage');
const DashboardPage = require('../pages/DashboardPage');

// Feature stage SM15: the smoke replica of 04_admin_login_dashboard.spec.js —
// Admin logs in from a genuinely cold session and the dashboard renders.
//
// This is the chain's canary. Every other stage in the tier starts by logging in
// as Admin (adminFreshLogin) and assumes the dashboard came up; when that
// assumption breaks, thirteen leaves fail at once with thirteen different
// downstream symptoms. Having it asserted once, on its own, means the report
// says "Admin cannot log in" instead of making you infer it.
//
// ---------------------------------------------------------------------------
// THE ONE .ENV ACCOUNT THIS TIER STILL USES, AND WHY THAT IS FINE
// ---------------------------------------------------------------------------
// The app owner's instruction was specifically about the flow roles: "dont use
// cic, EE and QI from env, use last created users". Those three are unusable on
// pulse-qa (measured: .env CI takes 7.9 min to log in, .env EE hangs at a 100%
// PWA spinner past the 10-minute timeout) because they carry months of
// accumulated offline data.
//
// ADMIN is not in that category — it is an online account that reaches the
// dashboard in about a minute, and it is what creates the smoke users in the
// first place. There is no bootstrap available that avoids it: something has to
// hold the Users and WAM screens before any created user exists. So Admin stays
// from .env, and this stage is where that dependency is made explicit rather
// than being an unstated assumption inside adminFreshLogin.
test.describe('Smoke stage SM15 - Admin login and dashboard', () => {
  test('Admin can log in with a cold session and reach a fully rendered dashboard', async ({ browser }) => {
    // Three minutes, not the ten the flow users get: Admin is online, so there
    // is no first-run PWA install to sit through.
    test.setTimeout(3 * 60 * 1000);

    expect(
      process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD,
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env — the whole smoke tier ' +
      'bootstraps from the Admin account.'
    ).toBeTruthy();

    // COLD on purpose: a fresh context with no cookies or storage carried over.
    // Reusing a warm session would prove the dashboard renders but not that
    // authentication works, which is the half that actually breaks.
    const context = await browser.newContext({
      permissions: ['geolocation'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    await context.clearCookies();
    const page = await context.newPage();

    try {
      const login = new LoginPage(page);
      await login.goto();
      await login.login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);

      await expect(
        page,
        'Still on /login after submitting the Admin credentials'
      ).not.toHaveURL(/.*\/login.*/i);

      const dashboard = new DashboardPage(page);
      await dashboard.waitForContentOnly();

      // The four chart widgets plus the detail table. Hard assertions here,
      // unlike SM17 which only LOGS widget visibility for the hierarchy tiers —
      // the difference is that Admin's widget set is the one documented set
      // (DashboardPage.js), so a missing widget here is a real regression rather
      // than an unconfirmed per-role difference.
      await expect(dashboard.rfiDistributionChart, 'RFI Distribution chart').toBeVisible();
      await expect(dashboard.ncDistributionChart, 'NC Distribution chart').toBeVisible();
      await expect(dashboard.tatSummaryChart, 'TAT Summary chart').toBeVisible();
      await expect(dashboard.trendAnalysisChart, 'Trend Analysis chart').toBeVisible();
      await expect(dashboard.detailRecordsTab, 'Detail Records tab').toBeVisible();

      // These four sidebar links are what actually confirms the ADMIN role
      // loaded rather than some lesser role that happens to share the dashboard
      // — a wrong-role login otherwise looks identical above.
      await expect(dashboard.navSOMapping, 'SO Mapping nav (Admin-only)').toBeVisible();
      await expect(dashboard.navUsers, 'Users nav (Admin-only)').toBeVisible();
      await expect(dashboard.navConfiguration, 'Configuration nav (Admin-only)').toBeVisible();
      await expect(dashboard.navAdminRFIUI, 'Admin RFI UI nav (Admin-only)').toBeVisible();

      await expect(dashboard.userRoleLabel, 'Header role label').toBeVisible();

      await page.screenshot({ path: 'test-results/sm15_admin_dashboard.png', fullPage: true });
      console.log('SM15: Admin cold login + dashboard confirmed');
    } finally {
      await context.close();
    }
  });
});
