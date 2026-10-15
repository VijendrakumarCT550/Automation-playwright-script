const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');

// ===========================================================================
// DRS EXPLORATION — ROUND 6. READ-ONLY, ENFORCED.
// App owner, 2026-10-01: Vendor Management has MOVED from App Settings to User
// Management. D01 still drives /appSettings/vendors and /appSettings/createVendor.
// This finds where it lives now and what its list + create form look like, so
// DrsAppSettingsPage's vendor methods can be pointed at the right place:
//   1. dumps the sidebar / navigation as Super Admin;
//   2. opens User Management and dumps it, then every tab / link in it that
//      mentions "vendor";
//   3. opens the vendor list and the create form (never fills or saves them);
//   4. checks whether the OLD /appSettings/vendors routes still answer.
// The write guard aborts any non-GET, so nothing here can create a vendor.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round6_vendor_in_user_management.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round6');

let context, page, dump;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (context) await context.close();
});

test('where did Vendor Management go?', async ({ browser }) => {
  test.setTimeout(8 * 60 * 1000);
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  // User Management is a SEPARATE app on its own host (auth-mgmt-<env>), which
  // installWriteGuard (DRS host only) does not cover - so guard EVERY host here.
  // Reads are GETs, logins (/auth/ or /login) and DRS's POST /query/ read shape.
  await context.route('**/*', async (route) => {
    const req = route.request();
    const isApi = ['fetch', 'xhr'].includes(req.resourceType());
    const allowed = req.method() === 'GET' || /\/(auth|login|query|search)(\/|$|\?)/i.test(req.url());
    if (isApi && !allowed) { blocked.push(`${req.method()} ${req.url()}`); return route.abort(); }
    return route.continue();
  });
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);

  await loginSuperAdmin(page, ENV);
  await dump('after-login-projects');

  // Every link / menu item on the page, with its target — the navigation map.
  const links = await page.evaluate(() =>
    [...document.querySelectorAll('a[href], [role="menuitem"], [role="tab"], nav button')]
      .map((el) => ({
        text: (el.innerText || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' '),
        href: el.getAttribute('href') || '',
        role: el.getAttribute('role') || el.tagName.toLowerCase(),
      }))
      .filter((l) => l.text || l.href));
  summary.findings.navLinks = links;
  console.log('  nav entries:\n' + links.map((l) => `    [${l.role}] "${l.text}" -> ${l.href}`).join('\n'));

  // /projects has no sidebar. The only thing that can hold the navigation is
  // the profile avatar at the top right (the bell opens Notifications, the
  // funnel opens Filter) - so click the avatar the way a user would and see
  // what it offers.
  const avatar = page.getByText('Super Admin').first();
  const box = await avatar.boundingBox();
  summary.findings.avatarBox = box;
  // The round avatar sits just right of the two "Super Admin" lines.
  if (box) await page.mouse.click(box.x + box.width + 28, box.y + box.height / 2);
  await page.waitForTimeout(1000);
  await dump('after-avatar-click');
  const menuTexts = await page.locator('[role="menu"], [role="menuitem"], [data-scope="menu"], [data-part="content"]')
    .evaluateAll((els) => els.map((e) => (e.innerText || '').trim().replace(/\s+/g, ' ')).filter((t) => t && t.length < 300));
  summary.findings.avatarMenu = menuTexts;
  console.log(`  avatar menu reveals: ${JSON.stringify(menuTexts)}`);

  // The menu text appears twice in the DOM; the real item is the menuitem.
  const um = page.getByRole('menuitem', { name: /user management/i }).first();
  if (!(await um.isVisible().catch(() => false))) {
    summary.findings.userManagementEntry = 'NOT FOUND after the avatar click';
    console.log('  User Management entry not found after the avatar click');
    return;
  }
  // The item opens the separate User Management app - usually in a NEW TAB.
  const popupPromise = context.waitForEvent('page', { timeout: 15000 }).catch(() => null);
  await um.click();
  const popup = await popupPromise;
  if (popup) {
    summary.findings.openedInNewTab = true;
    page = popup;
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(3000);
    dump = makeDumper(page, OUT, summary);
  } else {
    summary.findings.openedInNewTab = false;
    await page.waitForURL((u) => !/\/projects\/?$/.test(u.pathname), { timeout: 15000 }).catch(() => {});
  }
  console.log(`  new tab: ${!!popup}; now at ${page.url()}`);
  await dump('user-management');

  // The User Management app has its OWN login (email + password). ONE attempt
  // with the DRS Super Admin credentials from .env - a second try could lock the
  // account - and record whether it worked.
  if (/\/login/.test(page.url())) {
    const { drsSuperAdmin } = require('../../config/drs-environments');
    const { email, password } = drsSuperAdmin();
    await page.getByRole('textbox', { name: 'Email' }).fill(email);
    await page.getByRole('textbox', { name: 'Password' }).fill(password);
    await page.getByRole('button', { name: 'Log In', exact: true }).click();
    await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 45000 }).catch(() => {});
    summary.findings.authMgmtLoginWithDrsCreds = /\/login/.test(page.url()) ? 'DID NOT LEAVE /login' : 'LOGGED IN';
    console.log(`  auth-mgmt login with DRS Super Admin creds: ${summary.findings.authMgmtLoginWithDrsCreds} -> ${page.url()}`);
    await dump('user-management-after-login');
  }
  summary.findings.userManagementUrl = page.url();
  console.log(`  User Management -> ${page.url()}`);

  // Anything in User Management that mentions vendor: tabs, links, buttons.
  const vendorEntries = page.locator('a, button, [role="tab"], [role="menuitem"], [role="treeitem"]')
    .filter({ hasText: /vendor/i });
  const count = await vendorEntries.count();
  summary.findings.vendorEntryTexts = [];
  for (let i = 0; i < count; i += 1) {
    summary.findings.vendorEntryTexts.push((await vendorEntries.nth(i).innerText()).trim().replace(/\s+/g, ' '));
  }
  console.log(`  entries mentioning vendor: ${JSON.stringify(summary.findings.vendorEntryTexts)}`);

  if (count > 0) {
    await vendorEntries.first().click();
    await dump('vendor-list');
    summary.findings.vendorListUrl = page.url();
    console.log(`  vendor screen -> ${page.url()}`);

    // The create entry point, opened but never filled or saved.
    const add = page.getByRole('button', { name: /add|create|new|onboard/i }).filter({ hasText: /vendor/i }).first();
    const addAny = page.getByRole('button', { name: /add|create|new|onboard/i }).first();
    const target = (await add.isVisible().catch(() => false)) ? add : addAny;
    if (await target.isVisible().catch(() => false)) {
      summary.findings.createEntryText = (await target.innerText().catch(() => '')).trim();
      await target.click();
      await dump('vendor-create-form');
      summary.findings.vendorCreateUrl = page.url();
      console.log(`  create entry "${summary.findings.createEntryText}" -> ${page.url()}`);
      const fields = await page.getByRole('textbox').evaluateAll((els) =>
        els.map((e) => e.getAttribute('aria-label') || e.getAttribute('name') || e.getAttribute('placeholder') || e.id));
      summary.findings.createFormTextboxes = fields;
      console.log(`  create form textboxes: ${JSON.stringify(fields)}`);
    } else {
      console.log('  no create button visible on the vendor screen');
    }
  }

  // Do the old routes still exist?
  for (const old of ['/appSettings/vendors', '/appSettings/createVendor']) {
    await page.goto(`${ENV.baseUrl}${old}`);
    await page.waitForTimeout(2500);
    const landed = page.url();
    const textbox = await page.getByRole('textbox', { name: /Search vendors|Vendor Name/i }).first()
      .isVisible().catch(() => false);
    summary.findings[`old:${old}`] = { landed, vendorUiPresent: textbox };
    console.log(`  old route ${old} -> ${landed} (vendor UI present: ${textbox})`);
  }
  await dump('old-route-check');
});
