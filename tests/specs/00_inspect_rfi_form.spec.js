/**
 * DOM Inspector — NOT a real test, no assertions.
 * Run this once after SO Mapping / WAM are set up in the test environment.
 * It opens the Create RFI form and writes:
 *   test-results/rfi_form.html      — full page HTML for selector hunting
 *   test-results/rfi_form_fields.json — all inputs/selects/buttons with key attributes
 *   test-results/rfi_form.png       — screenshot of the form
 *
 * Usage (single run, no parallel, headed so you can watch):
 *   npx playwright test tests/specs/00_inspect_rfi_form.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const LoginPage     = require('../pages/LoginPage');
const DashboardPage = require('../pages/DashboardPage');
const MyTasksPage   = require('../pages/MyTasksPage');

test('Capture Create RFI form DOM', async ({ page }) => {
  // ── 1. Login as CI ──────────────────────────────────────────────────────────
  const login = new LoginPage(page);
  await login.goto();
  await login.login(process.env.CI_EMAIL, process.env.CI_PASSWORD);

  const dashboard = new DashboardPage(page);
  await dashboard.waitForLoad();

  // ── 2. Navigate to My Tasks → click Create RFI ──────────────────────────────
  const myTasks = new MyTasksPage(page);
  await myTasks.waitForLoad();
  await myTasks.clickCreateRFI();

  // Wait for at least one input to appear on the form
  await page.waitForSelector('input, select, [role="combobox"], [role="listbox"]', {
    timeout: 30000,
  });
  await page.waitForLoadState('networkidle');

  // ── 3. Dump field metadata ───────────────────────────────────────────────────
  const fields = await page.evaluate(() => {
    const relevant = Array.from(document.querySelectorAll(
      'input, select, textarea, button, [role="combobox"], [role="listbox"], [role="option"]'
    ));

    return relevant.map(el => ({
      tag:          el.tagName,
      type:         el.getAttribute('type') || null,
      role:         el.getAttribute('role') || null,
      id:           el.id || null,
      name:         el.getAttribute('name') || null,
      placeholder:  el.getAttribute('placeholder') || null,
      ariaLabel:    el.getAttribute('aria-label') || null,
      ariaLabelledby: el.getAttribute('aria-labelledby') || null,
      className:    el.className || null,
      innerText:    el.innerText?.trim().slice(0, 80) || null,
      disabled:     el.disabled || false,
    }));
  });

  // ── 4. Capture page label elements (often the visible field names) ───────────
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('label, [class*="label"], [class*="Label"]'))
      .map(el => ({ text: el.innerText?.trim(), forAttr: el.getAttribute('for'), class: el.className }))
      .filter(l => l.text)
  );

  // ── 5. Write outputs ─────────────────────────────────────────────────────────
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync('test-results/rfi_form.html', await page.content());
  fs.writeFileSync(
    'test-results/rfi_form_fields.json',
    JSON.stringify({ fields, labels }, null, 2)
  );

  // Take screenshot with a 2-second pause to let cascading dropdowns settle
  await page.waitForTimeout(2000);
  await page.screenshot({ path: 'test-results/rfi_form.png', fullPage: true });

  console.log('\n=== FIELD SUMMARY ===');
  fields.forEach((f, i) => {
    const id = [f.ariaLabel, f.placeholder, f.name, f.id, f.role, f.tag]
      .filter(Boolean)
      .join(' | ');
    console.log(`  [${i}] ${id}`);
  });
  console.log('\nOutput written to test-results/rfi_form_fields.json');
  console.log('Screenshot: test-results/rfi_form.png\n');
});
