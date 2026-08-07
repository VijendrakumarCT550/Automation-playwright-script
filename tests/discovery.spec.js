/**
 * DOM Discovery script — NOT a real test, no assertions.
 * Written before any selectors for this app were known: it tries a long
 * list of guessed CSS selectors for the login inputs/button, then dumps
 * screenshots, raw HTML, and every nav link/heading/button/table/menu item
 * it can find on whatever page comes after login.
 *
 * This is the same "explore first, write real selectors after" pattern as
 * the 00_inspect_*.spec.js files in tests/specs/ — once LoginPage.js,
 * DashboardPage.js etc. existed with confirmed real selectors, this file
 * stopped being needed for login/dashboard, but is kept as a fallback way
 * to re-survey the DOM if the app's markup changes again.
 *
 * Usage (single run, headed so you can watch):
 *   npx playwright test tests/discovery.spec.js --project=chromium --workers=1
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');

test('discover app structure after login', async ({ page }) => {
  page.setDefaultTimeout(30000);

  // --- Login page ---
  await page.goto(process.env.BASE_URL);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/01_login_page.png', fullPage: true });

  const loginHTML = await page.content();
  fs.writeFileSync('test-results/login_page.html', loginHTML);

  // Collect all inputs on login page
  const inputs = await page.$$eval('input', els =>
    els.map(el => ({
      id: el.id,
      name: el.name,
      type: el.type,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label'),
      className: el.className,
    }))
  );
  console.log('LOGIN PAGE INPUTS:', JSON.stringify(inputs, null, 2));

  // Collect all buttons on login page
  const buttons = await page.$$eval('button', els =>
    els.map(el => ({
      id: el.id,
      type: el.type,
      text: el.innerText.trim(),
      className: el.className,
    }))
  );
  console.log('LOGIN PAGE BUTTONS:', JSON.stringify(buttons, null, 2));

  // --- Attempt login ---
  // Try common selectors for email/username
  const emailSelectors = [
    'input[placeholder="contractor@domain.com"]',
    'input[type="text"]',
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[id*="email"]',
    'input[id*="user"]',
    'input[placeholder*="email" i]',
    'input[placeholder*="user" i]',
  ];
  const passwordSelectors = [
    'input[type="password"]',
    'input[name="password"]',
    'input[id*="pass"]',
  ];

  let emailFilled = false;
  for (const sel of emailSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.click();
      await el.pressSequentially(process.env.CI_EMAIL, { delay: 50 });
      console.log('Email filled with selector:', sel);
      emailFilled = true;
      break;
    }
  }

  let passwordFilled = false;
  for (const sel of passwordSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      await el.click();
      await el.pressSequentially(process.env.CI_PASSWORD, { delay: 50 });
      console.log('Password filled with selector:', sel);
      passwordFilled = true;
      break;
    }
  }

  await page.screenshot({ path: 'test-results/02_credentials_filled.png', fullPage: true });
  console.log('emailFilled:', emailFilled, '| passwordFilled:', passwordFilled);

  // Click login / submit button — wait for it to be enabled first
  const submitSelectors = [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:has-text("Login")',
    'button:has-text("Sign in")',
    'button:has-text("Log in")',
    'button:has-text("Continue")',
  ];
  for (const sel of submitSelectors) {
    const el = page.locator(sel).first();
    if (await el.count() > 0) {
      console.log('Clicking submit with selector:', sel);
      await el.waitFor({ state: 'visible' });
      // Wait for button to become enabled (React form validation)
      await page.waitForFunction(
        (s) => {
          const btn = document.querySelector(s);
          return btn && !btn.disabled;
        },
        sel,
        { timeout: 10000 }
      );
      await el.click();
      break;
    }
  }

  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'test-results/03_after_login.png', fullPage: true });
  console.log('URL after login:', page.url());

  // --- Post-login: extract navigation and page elements ---
  const postLoginHTML = await page.content();
  fs.writeFileSync('test-results/post_login_page.html', postLoginHTML);

  // Nav links
  const navLinks = await page.$$eval('nav a, [role="navigation"] a, header a, .sidebar a, .menu a', els =>
    els.map(el => ({ text: el.innerText.trim(), href: el.href })).filter(l => l.text)
  );
  console.log('NAV LINKS:', JSON.stringify(navLinks, null, 2));

  // All visible headings
  const headings = await page.$$eval('h1, h2, h3', els =>
    els.map(el => ({ tag: el.tagName, text: el.innerText.trim() })).filter(h => h.text)
  );
  console.log('HEADINGS:', JSON.stringify(headings, null, 2));

  // All visible buttons/actions
  const postButtons = await page.$$eval('button', els =>
    els.map(el => ({
      id: el.id,
      text: el.innerText.trim(),
      className: el.className,
    })).filter(b => b.text)
  );
  console.log('POST LOGIN BUTTONS:', JSON.stringify(postButtons, null, 2));

  // Tables
  const tables = await page.$$eval('table', els =>
    els.map(el => ({
      headers: Array.from(el.querySelectorAll('th')).map(th => th.innerText.trim()),
      rowCount: el.querySelectorAll('tr').length,
    }))
  );
  console.log('TABLES:', JSON.stringify(tables, null, 2));

  // Sidebar / menu items
  const menuItems = await page.$$eval(
    '[class*="menu"] *, [class*="sidebar"] *, [class*="nav"] *, [class*="drawer"] *',
    els => els
      .filter(el => el.innerText && el.children.length === 0)
      .map(el => el.innerText.trim())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
  );
  console.log('MENU/SIDEBAR ITEMS:', JSON.stringify(menuItems, null, 2));
});
