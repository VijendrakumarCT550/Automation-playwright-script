const { test, expect } = require('@playwright/test');

test.describe('Example Tests', () => {
  test('should load the homepage', async ({ page }) => {
    await page.goto('https://playwright.dev/');
    await expect(page).toHaveTitle(/Playwright/);
  });

  test('should navigate to docs page', async ({ page }) => {
    await page.goto('https://playwright.dev/');
    await page.getByRole('link', { name: 'Docs' }).click();
    await expect(page).toHaveURL(/.*docs/);
  });

  test('should find search button', async ({ page }) => {
    await page.goto('https://playwright.dev/');
    const searchButton = page.getByRole('button', { name: /search/i });
    await expect(searchButton).toBeVisible();
  });
});
