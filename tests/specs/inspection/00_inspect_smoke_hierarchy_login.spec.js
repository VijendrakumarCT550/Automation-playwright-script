const { test, expect } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const { SOLAR_E2E } = require('../../config/projects');
const { resolveSmokeUsers } = require('../../utils/smoke-users');

// RECON, not part of the smoke chain: can the smoke chain's HIERARCHY-TIER users
// actually log in, and what does each tier's left-hand menu contain?
//
// WHY THIS EXISTS. SM04 (the WAM hierarchy cascade) only works if each tier can
// log in and map the tier below — that is the whole mechanism. Two reasons that
// was not a safe assumption:
//
//   1. 18_wam_hierarchy.spec.js's header records that bulk-created hierarchy
//      users needed the app owner to add them to user auth MANUALLY in the DB
//      before they could log in. The app owner has since confirmed (2026-09-03)
//      that the backend now does this at creation time, so that note is stale —
//      but "confirmed stale" is worth one cheap check before building a cascade
//      spec on top of it.
//   2. The four flow users (CI/CM/EE/QI) logging in successfully today proves
//      nothing about these six: those are PWA/OFFLINE accounts, while
//      CAD/SAD/PAD/PM/EL/QL are ONLINE roles like Admin — a different auth path.
//
// Modelled on 31_hierarchy_roles_dashboard_menu.spec.js, which does the same
// sweep for 12_user_management.spec.js's bare-prefix users. This one targets the
// SMOKE profile's own project-scoped users (CADSL/SADSL/... ) instead.
//
// NOT serial, and each test opens and closes its own context: one tier's login
// failure must not skip the others, because the useful outcome here is knowing
// WHICH tiers work, not just that something broke. (18_wam_hierarchy's cascade
// is serial for the opposite reason — there each tier genuinely depends on the
// previous one's assignment.)
//
// Run:
//   npx playwright test tests/specs/inspection/00_inspect_smoke_hierarchy_login.spec.js --project=chromium --workers=1

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const PROFILE = SOLAR_E2E;

// Top of the hierarchy first, matching the order SM04's cascade will walk.
const TIERS = PROFILE.users.hierarchyRoles;

test.describe('RECON: smoke hierarchy users — login + left-hand menu', () => {
  for (const roleKey of TIERS) {
    test(`${roleKey}: logs in and the dashboard menu loads`, async ({ browser }) => {
      // Online accounts skip the long PWA first-install allowance CI/EE/QI need,
      // but a menu sweep is still several navigations.
      test.setTimeout(5 * 60 * 1000);

      expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

      // Same resolver the smoke stages use, so this cannot disagree with them
      // about which user is current or whether it belongs to this deployment.
      const users = resolveSmokeUsers(PROFILE, [roleKey]);
      const user = users[roleKey];
      console.log(`\n${roleKey} (${user.role}): ${user.name} <${user.email}>`);

      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      const page = await context.newPage();

      try {
        const dashboard = await loginAsUser(page, user.email, PASSWORD);

        // THE ASSERTION THAT MATTERS. A failed login on this app does not throw —
        // it leaves you sitting on /login, which every later step would then
        // misreport as a missing element.
        await expect(
          page,
          `${roleKey} (${user.name}): still on /login after logging in. If this fails for ` +
          `every tier, the backend is NOT auto-provisioning user auth for online roles ` +
          `and SM04's cascade cannot be built until it does.`
        ).not.toHaveURL(/\/login/i);
        console.log(`  ${roleKey}: login OK -> ${page.url()}`);

        await dashboard.goToDashboard();

        // Discover the menu live rather than hardcoding a guess — the item set
        // per tier is exactly what is unconfirmed. Reported, and only the
        // "there is a menu at all" part is asserted.
        await dashboard.revealNavIfCollapsed('Dashboard');
        const names = [];
        for (const item of await page.getByRole('treeitem').all()) {
          if (await item.isVisible().catch(() => false)) {
            const text = (await item.textContent())?.trim();
            if (text) names.push(text);
          }
        }
        expect(names.length, `${roleKey}: no visible left-hand menu items found`).toBeGreaterThan(0);
        console.log(`  ${roleKey}: ${names.length} menu item(s): ${names.join(', ')}`);

        // Whether WAM is reachable is the specific thing SM04 depends on: a tier
        // that cannot open WAM cannot map the tier below it. Reported rather
        // than asserted, because which tiers SHOULD have it is the open
        // question this recon is answering, not something to presume.
        const hasWam = names.some((n) => /^wam$/i.test(n));
        console.log(`  ${roleKey}: WAM in menu = ${hasWam}`);

        await page.screenshot({ path: `test-results/smoke-hier-${roleKey}.png`, fullPage: true });
      } finally {
        await context.close();
      }
    });
  }
});
