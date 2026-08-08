// online eedigt

/**
 * DOM Inspector — NOT a real test, no assertions.
 * Logs in as Admin, opens the Dashboard's Detail Records "Filter" drawer,
 * then opens the "From" date picker specifically to see its real calendar
 * structure (the input is readonly, so typing isn't an option).
 *
 * Usage (single run, headed so you can watch):
 *   npx playwright test tests/specs/00_inspect_dashboard_filter.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const { adminFreshLogin } = require('../utils/helpers');

test('Inspect the date-picker calendar popup', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  fs.mkdirSync('test-results', { recursive: true });

  const { context, page } = await adminFreshLogin(browser);
  await page.goto(`${process.env.BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  await page.locator('text=Filter').first().click();
  await page.waitForTimeout(1000);

  const openDatePickerBtn = page.getByRole('button', { name: 'Open date picker' }).first();
  await openDatePickerBtn.click();
  await page.waitForTimeout(1000);

  const content = await page.evaluate(() => {
    const el = document.querySelector('[data-scope="date-picker"][data-part="content"]');
    return el ? el.outerHTML : 'NOT FOUND';
  });
  fs.writeFileSync('test-results/inspect_datepicker.html', content);
  console.log('Date picker content length:', content.length);

  const view = await page.evaluate(() => {
    const el = document.querySelector('[data-scope="date-picker"][data-part="content"] [data-part="view-control"], [data-scope="date-picker"] [data-part="view-trigger"]');
    return el ? el.outerHTML.slice(0, 300) : 'view control not found';
  });
  console.log('View control:', view);

  const cells = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-scope="date-picker"] [data-part="table-cell-trigger"]'))
      .slice(0, 10)
      .map(el => ({ text: el.innerText, view: el.getAttribute('data-view'), value: el.getAttribute('data-value'), today: el.hasAttribute('data-today') }))
  );
  console.log('First 10 cell triggers:', JSON.stringify(cells, null, 2));

  await page.screenshot({ path: 'test-results/inspect_datepicker.png' });
  await context.close();
});
