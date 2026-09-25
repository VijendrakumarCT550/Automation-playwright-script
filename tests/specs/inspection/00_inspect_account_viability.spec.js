/**
 * DOM INSPECTOR — NOT a test. Answers one operational question:
 *
 *   WHICH ACCOUNTS CAN ACTUALLY LOG IN TO THIS DEPLOYMENT?
 *
 * Established by 00_inspect_login_failure.spec.js (pulse-qa, 2026-09-16): the
 * login page and LoginPage are fine — a .env account logs in (POST
 * /api/v1/auth/login -> 200) while a generated smoke account is refused by the
 * server (-> 401) on the identical code path. Generated users must be added to
 * the deployment's user auth separately, and .env notes that
 * BULK_USER_DEFAULT_PASSWORD is only ASSUMED to be their password.
 *
 * Which of them are usable therefore cannot be reasoned about, only measured —
 * and it decides what the reassignment work (docs/reassignment-scenarios.md,
 * Family R) can be built on: that family needs Contractor Manager, Execution
 * Lead, Quality Lead and Project Manager logins.
 *
 * Reports per account: reached the dashboard, or refused (with the auth status
 * code). Never throws on a refusal — a refusal is the finding.
 *
 * Usage:
 *   $env:PULSE_ENV="qa"
 *   npx playwright test tests/specs/inspection/00_inspect_account_viability.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const LoginPage = require('../../pages/LoginPage');
const { clearBrowserSession } = require('../../utils/helpers');

const OUT = path.join('test-results', 'account-viability');
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// The generated fleet, in the order that matters for the reassignment work:
// the four reassigner roles first, then the flow roles, then the admin tiers.
const SMOKE_KEYS = [
  'CMSL', 'ELSL', 'QLSL', 'PMSL',
  'CISL', 'EESL', 'QISL',
  'PADSL', 'SADSL', 'CADSL',
];

function qaUsers() {
  const store = require('../../fixtures/last-created-users.json');
  return (store.environments || {})[process.env.PULSE_ENV || 'qa'] || {};
}

async function tryLogin(page, email, password) {
  const result = { email, authStatus: null, reachedApp: false, error: null };

  const onResponse = (res) => {
    if (/\/api\/v1\/auth\/login/i.test(res.url())) result.authStatus = res.status();
  };
  page.on('response', onResponse);

  try {
    await clearBrowserSession(page.context(), page);
    const login = new LoginPage(page);
    await page.goto(process.env.BASE_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    await login.revealLoginFormIfLandingPage();

    await login.typeInField(login.emailInput, email);
    await page.keyboard.press('Tab');
    await login.typeInField(login.passwordInput, password);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    await login.loginButton.click({ force: true });

    result.reachedApp = await page.waitForURL((u) => !u.href.includes('/login'), { timeout: 45000 })
      .then(() => true).catch(() => false);
  } catch (err) {
    result.error = String(err.message).split(/\r?\n/)[0];
  } finally {
    page.off('response', onResponse);
  }
  return result;
}

test('Which accounts can log in to this deployment?', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });

  const users = qaUsers();
  const rows = [];

  console.log(`\n=== Account viability on ${process.env.BASE_URL} ===\n`);

  // The .env accounts are the control group — they are known to work, and if
  // one of THEM starts failing the conclusion is completely different.
  for (const [label, email, password] of [
    ['.env CI', process.env.CI_EMAIL, process.env.CI_PASSWORD],
    ['.env EE', process.env.EE_EMAIL, process.env.EE_PASSWORD],
    ['.env QI', process.env.QI_EMAIL, process.env.QI_PASSWORD],
    ['.env ADMIN', process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD],
  ]) {
    if (!email || !password) { console.log(`  ${label.padEnd(22)} SKIPPED (not set in .env)`); continue; }
    const r = await tryLogin(page, email, password);
    rows.push({ group: '.env', label, ...r });
    console.log(`  ${label.padEnd(22)} ${r.reachedApp ? 'OK     ' : 'REFUSED'} ` +
      `auth=${r.authStatus ?? 'n/a'}  ${email}${r.error ? ` — ${r.error}` : ''}`);
  }

  console.log('');

  for (const key of SMOKE_KEYS) {
    const user = users[key];
    if (!user) { console.log(`  ${key.padEnd(22)} NO RECORD for this deployment`); continue; }
    const r = await tryLogin(page, user.email, PASSWORD);
    rows.push({ group: 'smoke', label: `${key} (${user.role})`, ...r });
    console.log(`  ${(key + ' ' + user.role).padEnd(30)} ${r.reachedApp ? 'OK     ' : 'REFUSED'} ` +
      `auth=${r.authStatus ?? 'n/a'}  ${user.email}`);
  }

  fs.writeFileSync(path.join(OUT, 'viability.json'), JSON.stringify(rows, null, 2));

  const usable = rows.filter((r) => r.reachedApp);
  const refused = rows.filter((r) => !r.reachedApp);
  console.log('');
  console.log(`  usable: ${usable.length}/${rows.length}`);
  console.log(`  refused: ${refused.map((r) => r.label).join(', ') || '(none)'}`);

  // What this means for the reassignment work, stated in the run's own output
  // so it does not have to be re-derived later.
  const reassigners = ['CMSL', 'ELSL', 'QLSL', 'PMSL'];
  const okReassigners = rows.filter((r) => r.reachedApp && reassigners.some((k) => r.label.startsWith(k)));
  console.log('');
  console.log(`  REASSIGNER ROLES USABLE: ${okReassigners.length}/4` +
    `${okReassigners.length ? ' — ' + okReassigners.map((r) => r.label).join(', ') : ''}`);
  console.log(okReassigners.length === 4
    ? '  => Family R (who may reassign what) can be built on these accounts.'
    : '  => Family R CANNOT use these accounts as-is; they need adding to user auth first.');
  console.log(`\n  artefacts in ${OUT}\n`);
});
