/**
 * DOM INSPECTOR — NOT a test. Diagnoses WHY a login fails.
 *
 * THE QUESTION. Logins for the generated smoke users fail on pulse-qa
 * (CISLcliUser151 on 2026-09-15, CMSLwceUser151 on 2026-09-16) with the
 * unhelpful "Login failed - still on login page. App message: " — while the
 * .env accounts log in fine on the identical code path. The app owner reports
 * seeing the failure on screen and suspects the LOGIN PAGE has changed.
 *
 * 00_inspect_login_page.spec.js already established the page has NOT changed:
 * all four locators LoginPage depends on resolve, and the form sits behind the
 * "Testing purpose login" accordion exactly as the page object expects.
 *
 * So this run separates the two remaining explanations, which need different
 * fixes and must not be guessed between:
 *
 *   (a) THE ACCOUNT is rejected — not provisioned in this deployment's identity
 *       store. Fix: create/provision users, or use different accounts.
 *   (b) THE FLOW is broken for some accounts — e.g. the form never reveals, the
 *       submit never fires, a validation blocks it. Fix: LoginPage.
 *
 * A CONTROL ARM is what makes the answer conclusive: the same code path is
 * driven with a .env account (known good) and a smoke account (known bad) in
 * one run. If the control succeeds and the other fails at the SAME step, it is
 * the account. If both fail at the same step, it is the flow.
 *
 * Captures for each: every auth-ish network response (status + body), the form
 * state at each stage, any toast, the final URL, and a screenshot.
 *
 * Usage:
 *   $env:PULSE_ENV="qa"
 *   npx playwright test tests/specs/inspection/00_inspect_login_failure.spec.js --project=chromium --workers=1 --headed
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const LoginPage = require('../../pages/LoginPage');
const { clearBrowserSession } = require('../../utils/helpers');

const OUT = path.join('test-results', 'login-failure');
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

function qaUsers() {
  const store = require('../../fixtures/last-created-users.json');
  return (store.environments || {})[process.env.PULSE_ENV || 'qa'] || {};
}

// Drives the login form step by step, reporting what happened at each stage
// rather than throwing at the first problem — the stage that differs between
// the control and the failing account IS the diagnosis.
async function attemptLogin(page, label, email, password) {
  const report = { label, email, stages: {}, responses: [], toast: null, finalUrl: null };

  const onResponse = async (res) => {
    const url = res.url();
    if (!/auth|login|token|session|user/i.test(url)) return;
    let body = null;
    try {
      const text = await res.text();
      body = text.slice(0, 400);
    } catch (e) {
      body = '(body unavailable)';
    }
    report.responses.push({ status: res.status(), url: url.slice(0, 160), body });
  };
  page.on('response', onResponse);

  try {
    await clearBrowserSession(page.context(), page);

    const login = new LoginPage(page);
    await page.goto(process.env.BASE_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    report.stages.landed = page.url();

    // Stage 1 — reveal the form behind the accordion.
    const formVisibleBefore = await login.emailInput.isVisible().catch(() => false);
    report.stages.formVisibleBeforeReveal = formVisibleBefore;
    await login.revealLoginFormIfLandingPage().catch((e) => {
      report.stages.revealError = String(e.message).split(/\r?\n/)[0];
    });
    report.stages.formVisibleAfterReveal = await login.emailInput.isVisible().catch(() => false);

    if (!report.stages.formVisibleAfterReveal) {
      report.stages.verdict = 'the form never appeared — this is a FLOW problem, not an account one';
      return report;
    }

    // Stage 2 — type the credentials and check the button actually enables.
    await login.typeInField(login.emailInput, email);
    await page.keyboard.press('Tab');
    await login.typeInField(login.passwordInput, password);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(500);
    report.stages.submitDisabled = await login.loginButton.isDisabled().catch(() => null);

    // Stage 3 — submit, and wait for the app to leave /login.
    await login.loginButton.click({ force: true }).catch((e) => {
      report.stages.clickError = String(e.message).split(/\r?\n/)[0];
    });
    const left = await page.waitForURL((u) => !u.href.includes('/login'), { timeout: 45000 })
      .then(() => true).catch(() => false);
    report.stages.leftLoginPage = left;
    report.finalUrl = page.url();

    report.toast = ((await page
      .locator('[data-scope="toast"], [role="alert"], [class*="error"]')
      .first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim() || null;

    report.stages.verdict = left
      ? 'LOGIN SUCCEEDED'
      : 'form filled and submitted, but the app kept us on /login — the credentials were refused';
  } catch (err) {
    report.stages.threw = String(err.message).split(/\r?\n/)[0];
  } finally {
    page.off('response', onResponse);
  }

  return report;
}

test('Why does a smoke-user login fail where a .env login succeeds?', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });

  const users = qaUsers();
  const cm = users.CMSL;

  const attempts = [
    // CONTROL — known good, same code path.
    { label: 'CONTROL .env EE', email: process.env.EE_EMAIL, password: process.env.EE_PASSWORD },
    // The failing one.
    { label: 'SMOKE Contractor Manager', email: cm && cm.email, password: PASSWORD },
  ];

  const reports = [];
  for (const a of attempts) {
    if (!a.email || !a.password) {
      console.log(`\n  ${a.label}: SKIPPED — no credentials available`);
      continue;
    }
    console.log(`\n=== ${a.label} — ${a.email} ===`);
    const report = await attemptLogin(page, a.label, a.email, a.password);
    reports.push(report);

    console.log(`  form visible before reveal : ${report.stages.formVisibleBeforeReveal}`);
    console.log(`  form visible after reveal  : ${report.stages.formVisibleAfterReveal}`);
    console.log(`  submit button disabled     : ${report.stages.submitDisabled}`);
    console.log(`  left /login                : ${report.stages.leftLoginPage}`);
    console.log(`  final URL                  : ${report.finalUrl}`);
    console.log(`  toast/error on screen      : ${JSON.stringify(report.toast)}`);
    console.log(`  VERDICT                    : ${report.stages.verdict || report.stages.threw}`);
    if (report.responses.length) {
      console.log('  auth-ish responses:');
      for (const r of report.responses.slice(0, 10)) {
        console.log(`    ${r.status}  ${r.url}`);
        if (r.status >= 400) console.log(`         body: ${JSON.stringify(r.body.slice(0, 200))}`);
      }
    }

    await page.screenshot({
      path: path.join(OUT, `${a.label.replace(/[^a-z0-9]+/gi, '-')}.png`),
      fullPage: true,
    });
  }

  fs.writeFileSync(path.join(OUT, 'reports.json'), JSON.stringify(reports, null, 2));

  console.log('\n--- CONCLUSION ---');
  const control = reports.find((r) => r.label.startsWith('CONTROL'));
  const subject = reports.find((r) => !r.label.startsWith('CONTROL'));
  if (control && subject) {
    if (control.stages.leftLoginPage && !subject.stages.leftLoginPage) {
      console.log('  The control logged in and the smoke account did not, on the SAME code path.');
      console.log('  => THE ACCOUNT is the problem, not the login page.');
    } else if (!control.stages.leftLoginPage && !subject.stages.leftLoginPage) {
      console.log('  BOTH failed => the login FLOW is broken; LoginPage needs the fix.');
    } else {
      console.log('  Mixed/!unexpected result — read the per-stage output above.');
    }
  }
  console.log(`\n  artefacts in ${OUT}\n`);
});
