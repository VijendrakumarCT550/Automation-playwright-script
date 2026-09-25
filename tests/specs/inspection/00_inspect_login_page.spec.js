/**
 * DOM INSPECTOR — NOT a test. No login is attempted; it only looks.
 *
 * WHY: logins started failing on 2026-09-16 and the app owner reports the login
 * page has CHANGED. LoginPage.revealLoginFormIfLandingPage() currently knows
 * about exactly one intermediate shape — an "AGEL / Partner login" landing page
 * whose "Testing purpose login" accordion reveals the email/password form. If
 * that shape has moved on, every spec in the suite fails at step one, and the
 * failure message ("Login failed - still on login page. App message: ") says
 * nothing about why.
 *
 * Dumps whatever is actually on screen so LoginPage can be corrected from
 * evidence: every button, link, input and heading, plus the raw HTML and a
 * screenshot.
 *
 * Usage:
 *   $env:PULSE_ENV="qa"
 *   npx playwright test tests/specs/inspection/00_inspect_login_page.spec.js --project=chromium --workers=1 --headed
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const OUT = path.join('test-results', 'login-page');

test('What does the login page render now?', async ({ page }) => {
  test.setTimeout(5 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });

  await page.goto(process.env.BASE_URL);
  await page.waitForLoadState('networkidle').catch(() => {});
  // The landing page is a React SPA; give it a moment to paint before reading.
  await page.waitForTimeout(3000);

  console.log(`\n=== ${page.url()} ===\n`);

  const surface = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const describe = (el) => ({
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute('type') || '',
      role: el.getAttribute('role') || '',
      text: (el.innerText || el.value || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      placeholder: el.getAttribute('placeholder') || '',
      ariaLabel: el.getAttribute('aria-label') || '',
      id: el.id || '',
      name: el.getAttribute('name') || '',
      disabled: el.disabled === true,
      href: el.getAttribute('href') || '',
      visible: visible(el),
    });

    return {
      title: document.title,
      headings: Array.from(document.querySelectorAll('h1,h2,h3,p'))
        .filter(visible)
        .map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim())
        .filter((t) => t && t.length < 120)
        .slice(0, 25),
      buttons: Array.from(document.querySelectorAll('button, [role="button"]')).map(describe),
      inputs: Array.from(document.querySelectorAll('input, textarea, select')).map(describe),
      links: Array.from(document.querySelectorAll('a')).map(describe).filter((l) => l.visible),
    };
  });

  console.log(`  title    : ${surface.title}`);
  console.log(`  headings : ${JSON.stringify(surface.headings, null, 2)}`);
  console.log('');
  console.log('  BUTTONS:');
  for (const b of surface.buttons) {
    console.log(`    ${b.visible ? 'visible' : 'hidden '} text=${JSON.stringify(b.text)} ` +
      `type=${b.type} aria=${JSON.stringify(b.ariaLabel)} disabled=${b.disabled}`);
  }
  console.log('');
  console.log('  INPUTS:');
  for (const i of surface.inputs) {
    console.log(`    ${i.visible ? 'visible' : 'hidden '} type=${i.type} ` +
      `placeholder=${JSON.stringify(i.placeholder)} name=${JSON.stringify(i.name)} id=${JSON.stringify(i.id)}`);
  }
  console.log('');
  console.log('  LINKS:');
  for (const l of surface.links) console.log(`    text=${JSON.stringify(l.text)} href=${l.href}`);

  // What the CURRENT page object looks for, checked one by one so the exact
  // broken assumption is named rather than inferred.
  const probes = {
    'emailInput  input[placeholder="contractor@domain.com"]':
      await page.locator('input[placeholder="contractor@domain.com"]').count(),
    'passwordInput  input[type="password"]':
      await page.locator('input[type="password"]').count(),
    'loginButton  button[type="submit"]':
      await page.locator('button[type="submit"]').count(),
    'testingPurposeToggle  text=/Testing purpose login/':
      await page.getByText('Testing purpose login', { exact: false }).count(),
    'any button named /login/i':
      await page.getByRole('button', { name: /login|sign in/i }).count(),
  };
  console.log('');
  console.log('  WHAT LoginPage CURRENTLY LOOKS FOR:');
  for (const [what, count] of Object.entries(probes)) {
    console.log(`    ${count > 0 ? 'FOUND   ' : 'MISSING '} ${what}  (${count})`);
  }

  fs.writeFileSync(path.join(OUT, 'surface.json'), JSON.stringify({ url: page.url(), surface, probes }, null, 2));
  fs.writeFileSync(path.join(OUT, 'page.html'), await page.content());
  await page.screenshot({ path: path.join(OUT, 'login-page.png'), fullPage: true });
  console.log(`\n  artefacts in ${OUT}\n`);
});
