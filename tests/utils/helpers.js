const { expect } = require('@playwright/test');
const LoginPage     = require('../pages/LoginPage');
const DashboardPage = require('../pages/DashboardPage');

// Fresh session (new context, cleared cookies, geolocation pre-granted) logged
// in as Admin, landed on the dashboard. Admin is an "online"/cached account —
// no PWA install spinner wait needed, see DashboardPage.waitForContentOnly().
// Caller is responsible for closing the returned context when done.
async function adminFreshLogin(browser, contextOptions = {}) {
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
    ...contextOptions,
  });
  await context.clearCookies();
  const page = await context.newPage();

  const login = new LoginPage(page);
  await login.goto();
  await login.login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);

  const dashboard = new DashboardPage(page);
  await dashboard.waitForContentOnly();

  return { context, page, dashboard };
}

const ROLE_CREDENTIALS = {
  CI: { email: process.env.CI_EMAIL, password: process.env.CI_PASSWORD },
  EE: { email: process.env.EE_EMAIL, password: process.env.EE_PASSWORD },
  QI: { email: process.env.QI_EMAIL, password: process.env.QI_PASSWORD },
};

// Same shape as adminFreshLogin, but for CI/EE/QI — its own independent
// context/page, logged in once, landed on My Tasks. Built for the
// single-session flow spec (21_rfi_flow_single_session.spec.js): instead of
// each role's turn re-logging in via loginAsRole(page, role) on the shared
// `page` fixture (the pass-chain specs' model — one login PER PASS, up to 9
// logins for a full 9-TC/3-round regression), this opens all three roles'
// sessions ONCE up front and keeps them alive for the whole regression.
// Confirmed no app-side idle-session timeout blocks this (user-confirmed
// live) — otherwise a long-idle EE/QI session would need a keep-alive
// heartbeat while waiting its turn, which this does NOT implement.
// Caller is responsible for closing the returned context when done.
async function loginFreshRoleSession(browser, role) {
  const creds = ROLE_CREDENTIALS[role];
  if (!creds) throw new Error(`Unknown role: ${role}`);

  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });

  // If anything below throws (a slow/broken login), close the context THIS
  // call just opened before rethrowing — otherwise it leaks regardless of
  // what the caller does, since the caller never gets a handle to it (the
  // throw happens before this function returns anything).
  try {
    await context.clearCookies();
    const page = await context.newPage();

    const login = new LoginPage(page);
    await login.goto();
    await login.login(creds.email, creds.password);

    const dashboard = new DashboardPage(page);
    await dashboard.waitForLoad();
    await dashboard.goToMyTasks();

    return { context, page };
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

// Logs the test's own `page` fixture in as CI/EE/QI and lands on My Tasks.
// Unlike adminFreshLogin, this doesn't create its own context — the RFI flow
// specs (08/09/10) use the built-in `page` fixture directly, which already
// inherits geolocation/permissions from playwright.config.js's `use` block.
// Cookies are cleared first so no session/cookie state can carry over from
// a previous role's login within the same run.
async function loginAsRole(page, role) {
  const creds = ROLE_CREDENTIALS[role];
  if (!creds) throw new Error(`Unknown role: ${role}`);

  await page.context().clearCookies();

  const login = new LoginPage(page);
  await login.goto();
  await login.login(creds.email, creds.password);

  const dashboard = new DashboardPage(page);
  await dashboard.waitForLoad();
  // Give the dashboard a moment to finish rendering before navigating away.
  await page.waitForTimeout(2000);
  await dashboard.goToMyTasks();
}

// Logs the test's own `page` fixture in with an arbitrary email/password —
// for roles with no fixed .env entry (e.g. the bulk-created hierarchy users
// in tests/fixtures/last-created-users.json). Unlike loginAsRole, does NOT
// navigate to My Tasks afterward — these roles (Cluster Admin, Project
// Manager, Execution Lead, etc.) don't necessarily have an RFI/NC My Tasks
// view; the caller navigates wherever it actually needs (e.g. WAM) itself.
// Returns the DashboardPage so the caller can do that navigation.
//
// Uses waitForContentOnly, NOT waitForLoad — confirmed live (user watched
// the browser directly): only CIC/EE/QI show the slow first-time PWA
// install spinner ("100%" text); Cluster Admin/Project Manager/Execution
// Lead/Quality Lead/Contractor Manager log in within about a minute with
// no spinner at all. waitForLoad's spinner wait would sit for up to 10
// minutes waiting for "100%" text that never appears for these roles,
// looking exactly like a hung page even though the dashboard was actually
// already fully loaded underneath.
async function loginAsUser(page, email, password) {
  await page.context().clearCookies();

  const login = new LoginPage(page);
  await login.goto();
  await login.login(email, password);

  const dashboard = new DashboardPage(page);
  await dashboard.waitForContentOnly();
  await page.waitForTimeout(2000);
  return dashboard;
}

async function waitAndClick(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  await page.click(selector);
}

async function waitAndFill(page, selector, value, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  await page.fill(selector, value);
}

async function assertText(page, selector, expectedText) {
  const element = page.locator(selector);
  await expect(element).toContainText(expectedText);
}

async function assertVisible(page, selector) {
  const element = page.locator(selector);
  await expect(element).toBeVisible();
}

async function assertURL(page, expectedURL) {
  await expect(page).toHaveURL(expectedURL);
}

async function clearAndFill(page, selector, value) {
  await page.locator(selector).clear();
  await page.locator(selector).fill(value);
}

module.exports = {
  waitAndClick,
  waitAndFill,
  assertText,
  assertVisible,
  assertURL,
  clearAndFill,
  adminFreshLogin,
  loginAsRole,
  loginAsUser,
  loginFreshRoleSession,
};
