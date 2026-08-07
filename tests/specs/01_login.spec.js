const { test, expect } = require('@playwright/test');
const fs = require('fs');
const LoginPage      = require('../pages/LoginPage');
const DashboardPage  = require('../pages/DashboardPage');

test.describe('Login - all roles', () => {

  // Full login sequence including the NN% loading screen.
  // The spinner can take 3–5 minutes; we wait for a real dashboard element
  // rather than polling percentages.
  async function loginAndWaitForDashboard(page, email, password) {
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.login(email, password);

    // login() already waits for URL to leave /login and networkidle.
    // Now wait for the post-login loading spinner to finish by watching
    // for the first element that only appears on the loaded dashboard.
    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
  }

  test('CI user can login and reach dashboard', async ({ page }) => {
    await loginAndWaitForDashboard(page, process.env.CI_EMAIL, process.env.CI_PASSWORD);

    fs.mkdirSync('test-results', { recursive: true });
    fs.writeFileSync('test-results/ci_dashboard.html', await page.content());
    await page.screenshot({ path: 'test-results/ci_dashboard.png', fullPage: true });

    console.log('CI post-login URL:', page.url());

    const navItems = await page.$$eval(
      'nav a, [class*="sidebar"] a, [class*="nav"] a',
      els => els.map(el => el.innerText.trim()).filter(Boolean)
    );
    console.log('CI NAV ITEMS:', navItems);

    const buttons = await page.$$eval('button', els =>
      els.map(el => el.innerText.trim()).filter(Boolean)
    );
    console.log('CI BUTTONS:', buttons);

    await expect(page).not.toHaveURL(/.*\/login.*/i);
    // waitForLoad() may land on /dashboard or /my-tasks depending on cache state;
    // accept any landmark content from either page
    const appContent = page.locator('text=RFI Distribution')
      .or(page.locator('text=Create RFI'))
      .or(page.locator('text=Pending with me'));
    await expect(appContent.first()).toBeVisible();
  });

  test('EE user can login and reach dashboard', async ({ page }) => {
    await loginAndWaitForDashboard(page, process.env.EE_EMAIL, process.env.EE_PASSWORD);

    fs.writeFileSync('test-results/ee_dashboard.html', await page.content());
    await page.screenshot({ path: 'test-results/ee_dashboard.png', fullPage: true });

    console.log('EE post-login URL:', page.url());

    const navItems = await page.$$eval(
      'nav a, [class*="sidebar"] a, [class*="nav"] a',
      els => els.map(el => el.innerText.trim()).filter(Boolean)
    );
    console.log('EE NAV ITEMS:', navItems);

    await expect(page).not.toHaveURL(/.*\/login.*/i);
  });

  test('QI user can login and reach dashboard', async ({ page }) => {
    await loginAndWaitForDashboard(page, process.env.QI_EMAIL, process.env.QI_PASSWORD);

    fs.writeFileSync('test-results/qi_dashboard.html', await page.content());
    await page.screenshot({ path: 'test-results/qi_dashboard.png', fullPage: true });

    console.log('QI post-login URL:', page.url());

    const navItems = await page.$$eval(
      'nav a, [class*="sidebar"] a, [class*="nav"] a',
      els => els.map(el => el.innerText.trim()).filter(Boolean)
    );
    console.log('QI NAV ITEMS:', navItems);

    await expect(page).not.toHaveURL(/.*\/login.*/i);
  });
});
