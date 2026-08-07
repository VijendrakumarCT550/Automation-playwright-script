const { test, expect } = require('@playwright/test');
const LoginPage     = require('../pages/LoginPage');
const DashboardPage = require('../pages/DashboardPage');

test.describe('Admin - Login and Dashboard', () => {

  test('Admin can login with a fresh session and reach the dashboard', async ({ browser }) => {
    // Admin is an already-active/online account — login and dashboard load
    // complete within about a minute, no long PWA first-run spinner wait needed
    test.setTimeout(3 * 60 * 1000);

    // Fresh session: new context, no cookies/storage carried over, geolocation pre-granted
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

      await expect(page).not.toHaveURL(/.*\/login.*/i);

      const dashboard = new DashboardPage(page);
      await dashboard.waitForContentOnly();

      // Core dashboard widgets
      await expect(dashboard.rfiDistributionChart).toBeVisible();
      await expect(dashboard.ncDistributionChart).toBeVisible();
      await expect(dashboard.tatSummaryChart).toBeVisible();
      await expect(dashboard.trendAnalysisChart).toBeVisible();
      await expect(dashboard.detailRecordsTab).toBeVisible();

      // Admin-only sidebar links confirm the Admin role loaded (not CI/EE/QI)
      await expect(dashboard.navSOMapping).toBeVisible();
      await expect(dashboard.navUsers).toBeVisible();
      await expect(dashboard.navConfiguration).toBeVisible();
      await expect(dashboard.navAdminRFIUI).toBeVisible();

      // Header shows the Admin role label
      await expect(dashboard.userRoleLabel).toBeVisible();

      await page.screenshot({ path: 'test-results/admin_dashboard.png', fullPage: true });
    } finally {
      await context.close();
    }
  });
});
