/**
 * DOM INSPECTOR — NOT a test. Answers ONE question, and the whole reassignment
 * plan depends on it:
 *
 *   CAN A USER CREATED VIA ADMIN ACTUALLY LOG IN?
 *
 * WHY IT IS IN DOUBT. The Add User dialog captures name, email and phone — and
 * NO PASSWORD. So creating a user makes a PULSE user record, but the login
 * credential lives in a separate auth store. Measured on pulse-qa 2026-09-16:
 * the generated smoke users are refused at the server
 * (POST /api/v1/auth/login -> 401) while .env accounts succeed (-> 200) on the
 * identical code path, and .env itself notes that BULK_USER_DEFAULT_PASSWORD is
 * only ASSUMED to be their password, "confirm/correct after adding these users
 * to user auth".
 *
 * Family R of docs/reassignment-scenarios.md needs Contractor Manager,
 * Execution Lead, Quality Lead and Project Manager logins, and .env has only
 * CI/EE/QI/Admin. The app owner's instruction is to create them via Admin — so
 * this run creates exactly ONE and tries to log in as it, rather than building
 * a 15-user fleet and discovering at the end that none of them can sign in.
 *
 *   login succeeds -> the fleet is buildable; Phase 1 proceeds as designed.
 *   login refused  -> creating users does NOT grant auth, and no amount of
 *                     further creation helps. The accounts need provisioning
 *                     outside the app, and that is a decision for the app owner.
 *
 * DELIBERATELY DOES NOT touch tests/fixtures/last-created-users.json: that file
 * is the smoke chain's own record, keyed per deployment, and a probe user has no
 * business in it. The created user is reported here and in the artefact only.
 *
 * Usage:
 *   $env:PULSE_ENV="qa"
 *   npx playwright test tests/specs/inspection/00_inspect_created_user_can_login.spec.js --project=chromium --workers=1 --headed
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser, clearBrowserSession } = require('../../utils/helpers');
const { getProfile } = require('../../config/projects');
const LoginPage = require('../../pages/LoginPage');
const DashboardPage = require('../../pages/DashboardPage');
const UserManagementPage = require('../../pages/UserManagementPage');

const OUT = path.join('test-results', 'created-user-login');
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// A prefix that CANNOT collide with the smoke fleet's naming scheme
// (CMSL/ELSL/...User<n>), so ensureSmokeUsers can never mistake this probe user
// for one of its own.
const STAMP = String(Date.now()).slice(-6);
const CANDIDATE = {
  role: 'Contractor Manager',
  userType: 'VENDOR',
  name: `RAPROBECM${STAMP}`,
  email: `raprobecm${STAMP}@adani.com`,
  phone: `9${String(Date.now()).slice(-9)}`.slice(0, 10),
};

test('Can a user created via Admin log in?', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });

  const profile = getProfile('solar-e2e');
  const report = { candidate: CANDIDATE, created: false, toast: null, authStatus: null, loggedIn: false };

  console.log(`\n=== Create-then-login probe on ${process.env.BASE_URL} ===`);
  console.log(`    candidate: ${CANDIDATE.role} — ${CANDIDATE.email}\n`);

  // --- 1. Create the user as Admin ------------------------------------------
  const dashboard = await loginAsFlowUser(
    page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, { navigateToMyTasks: false }
  );

  const users = new UserManagementPage(page);
  await users.goto(dashboard);
  await users.openAddUserDialog();

  await users.selectUserType(CANDIDATE.userType);
  // VENDOR roles need the vendor cascade before the role list is meaningful.
  await users.selectVendorCategory(profile.vendor.category);
  await users.selectVendor(profile.vendor.name);
  await users.selectUserRole(CANDIDATE.role);

  const picked = await users.fillLocationCascade({
    cluster: profile.cluster,
    site: [profile.site],
    projectTypes: [profile.projectType],
    projectTypeCount: 1,
    // BOTH work locations on purpose: the reassignment fleet needs users
    // provisioned across two locations (docs/reassignment-scenarios.md §2), so
    // the probe should exercise the same shape it will later rely on.
    workLocations: ['A-06c', 'S05b'],
    workLocationCount: 2,
  });
  console.log(`  cascade picked: ${JSON.stringify(picked)}`);
  report.picked = picked;

  await users.fillIdentity(CANDIDATE);
  report.toast = await users.submit().catch((e) => `submit threw: ${String(e.message).split(/\r?\n/)[0]}`);
  console.log(`  create toast: ${JSON.stringify(report.toast)}`);
  report.created = !!report.toast && !/error|fail/i.test(String(report.toast));

  await page.screenshot({ path: path.join(OUT, '01-after-create.png'), fullPage: true });

  // --- 2. Try to log in as that brand-new user ------------------------------
  const onResponse = (res) => {
    if (/\/api\/v1\/auth\/login/i.test(res.url())) report.authStatus = res.status();
  };
  page.on('response', onResponse);

  await clearBrowserSession(page.context(), page);
  const login = new LoginPage(page);
  await page.goto(process.env.BASE_URL);
  await page.waitForLoadState('networkidle').catch(() => {});
  await login.revealLoginFormIfLandingPage();

  await login.typeInField(login.emailInput, CANDIDATE.email);
  await page.keyboard.press('Tab');
  await login.typeInField(login.passwordInput, PASSWORD);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(400);
  await login.loginButton.click({ force: true });

  report.loggedIn = await page.waitForURL((u) => !u.href.includes('/login'), { timeout: 45000 })
    .then(() => true).catch(() => false);
  report.finalUrl = page.url();
  page.off('response', onResponse);

  await page.screenshot({ path: path.join(OUT, '02-after-login-attempt.png'), fullPage: true });
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

  console.log('');
  console.log(`  user created        : ${report.created}`);
  console.log(`  auth/login status   : ${report.authStatus ?? 'n/a'}`);
  console.log(`  reached the app     : ${report.loggedIn}`);
  console.log(`  final URL           : ${report.finalUrl}`);
  console.log('');
  console.log('--- CONCLUSION ---');
  if (report.loggedIn) {
    console.log('  A freshly created user CAN log in with BULK_USER_DEFAULT_PASSWORD.');
    console.log('  => The reassignment fleet is buildable; the older smoke accounts must have');
    console.log('     been disabled or created with a different password.');
  } else {
    console.log(`  A freshly created user CANNOT log in (auth ${report.authStatus}).`);
    console.log('  => Creating users via Admin does NOT grant a login credential. The fleet');
    console.log('     cannot be built this way, and the accounts need provisioning in the');
    console.log('     deployment\'s auth store before Family R can run.');
  }
  console.log(`\n  artefacts in ${OUT}\n`);

  // The only hard assertion: the user was actually created. Whether it can log
  // in is the FINDING this run exists to report, not a pass/fail condition.
  expect(report.created, `Creating the probe user failed outright: ${report.toast}`).toBe(true);
});
