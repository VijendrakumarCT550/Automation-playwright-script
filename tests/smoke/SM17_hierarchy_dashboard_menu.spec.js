const { test, expect } = require('../config/test-base');
const { loginAsUser, returnToPulse } = require('../utils/helpers');
const { isDrsUrl } = require('../config/environments');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');

// Feature stage SM17: the smoke replica of
// 31_hierarchy_roles_dashboard_menu.spec.js — each of the seven hierarchy /
// oversight roles logs in, its dashboard loads, and every item in its left-hand
// menu opens without bouncing to /login or showing an error banner.
//
// The question is per-tier ACCESS, not any single screen: these roles see
// different menus (SM04's cascade and the earlier live work found the item count
// differs by tier, with SO Mapping as the split), and a role that can log in but
// whose menu 404s is a real defect that no other stage would catch.
//
// ---------------------------------------------------------------------------
// USERS: SM01'S, NOT THE BARE-PREFIX BATCH
// ---------------------------------------------------------------------------
// The original resolved bare prefixes (CAD, SAD, PAD, PM, EL, QL, CM) from
// 12_user_management's batch, which is also what 13, 25, 27, 28 and
// tests/online-roles/ resolve. This resolves SM01's SL-prefixed users for the
// current run instead, so the stage tests the identities this chain actually
// provisioned and cannot be affected by, or affect, the regression tier.
//
// It also means the tier being tested is one SM03 and SM04 have already mapped —
// which matters, because a hierarchy user with no WAM row can log in but has
// nothing to see. The app owner's point exactly: "user stored in json of smoke
// ... will only get their access if they are mapped".
//
// ---------------------------------------------------------------------------
// NOT SERIAL, AND EACH TEST OWNS ITS CONTEXT
// ---------------------------------------------------------------------------
// Deliberate, and carried over from the original. These seven checks are
// independent — unlike SM04's cascade, where each tier's login depends on the
// previous tier having just assigned it — so one role's login failure must not
// skip the other six. Inside a `serial` describe it would.
const ROLES = ['CAD', 'SAD', 'PAD', 'PM', 'EL', 'QL', 'CM'];

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Plain console.log, NOT expect() and NOT expect.soft().
//
// WHICH chart widgets a given hierarchy role renders is genuinely unconfirmed —
// only Admin's set is documented (DashboardPage.js), which is why SM15 asserts
// them and this file does not. Reporting rather than asserting keeps an
// unconfirmed cosmetic difference from burying the thing this stage exists to
// check: does the menu work.
//
// expect.soft() would be the worst of both: a soft failure still fails the
// containing test, and 18_wam_hierarchy.spec.js confirmed live that inside a
// serial describe it then silently skips every later test too.
function logWidgetVisibility(roleKey, label, visible) {
  console.log(`  ${roleKey} widget "${label}": ${visible ? 'visible' : 'NOT visible'}`);
}

test.describe('Smoke stage SM17 - hierarchy roles: dashboard load + menu sweep', () => {
  for (const roleKey of ROLES) {
    test(`${roleKey}: logs in, dashboard loads, every left-hand menu item opens`, async ({ browser, profile }) => {
      // Wider than SM15's 3 min: these are online accounts too, but a full menu
      // sweep is several navigations each with its own networkidle wait.
      test.setTimeout(5 * 60 * 1000);

      requireFeatureGround(profile);
      expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

      const user = resolveSmokeUsers(profile, [roleKey])[roleKey];
      console.log(`\n${roleKey} (${user.role}): ${user.name} <${user.email}>`);

      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      const page = await context.newPage();

      try {
        const dashboard = await loginAsUser(page, user.email, PASSWORD);
        await expect(page, `${roleKey}: still on /login after loginAsUser`).not.toHaveURL(/\/login/i);

        // Navigate to the Dashboard explicitly rather than trusting wherever
        // login left us. waitForContentOnly's readiness check also matches
        // "Pending with others", which is what the oversight roles' My Tasks
        // page shows — so a successful login can legitimately land there
        // instead of on /dashboard.
        await dashboard.goToDashboard();

        const widgets = {
          'RFI Distribution': dashboard.rfiDistributionChart,
          'NC Distribution': dashboard.ncDistributionChart,
          'TAT Summary': dashboard.tatSummaryChart,
          'Trend Analysis': dashboard.trendAnalysisChart,
          'Detail Records tab': dashboard.detailRecordsTab,
        };
        for (const [label, locator] of Object.entries(widgets)) {
          logWidgetVisibility(roleKey, label, await locator.isVisible().catch(() => false));
        }

        await page.screenshot({ path: `test-results/sm17_${roleKey}_dashboard.png`, fullPage: true });

        // DISCOVER the menu rather than hardcoding it. The item set per tier is
        // exactly what varies, so a hardcoded list would either fail on a
        // correct app or hide a genuinely missing item. Visit everything found
        // and confirm it opens something.
        await dashboard.revealNavIfCollapsed('Dashboard');
        const treeitems = await page.getByRole('treeitem').all();
        const names = [];
        for (const item of treeitems) {
          if (await item.isVisible().catch(() => false)) {
            const text = (await item.textContent())?.trim();
            if (text) names.push(text);
          }
        }
        expect(names.length, `${roleKey}: no visible left-hand menu items found`).toBeGreaterThan(0);
        console.log(`  ${roleKey} menu (${names.length}): ${names.join(', ')}`);

        for (const name of names) {
          await dashboard.navigateTo(name);

          // ---------------------------------------------------------------
          // EXPECTED: a menu item may hand off to DRS. Not a failure.
          // ---------------------------------------------------------------
          // App owner, 2026-09-06: following "SO Mapping" may land on the SO
          // Mapping screen, on the DRS LOGIN page, or on the DRS dashboard
          // when DRS already has an admin session — all three are correct.
          // SO Mapping moved to DRS on 2026-09-04 and PULSE's sidebar entry
          // is a live hand-off, not a dead link.
          //
          // This check has to come BEFORE the /login assertion below, because
          // DRS's own login URL ends in "/login" and would otherwise be
          // reported as "SO Mapping bounced to /login" — a PULSE session
          // failure, which it is not. It also has to come before anything
          // else touches the page: on the DRS origin every PULSE locator
          // resolves to nothing, so the error-banner probe and
          // goToDashboard() would both misbehave.
          if (isDrsUrl(page.url())) {
            console.log(`  ${roleKey}: "${name}" handed off to DRS (${page.url()}) — expected, not a bug`);
            await returnToPulse(page);
            continue;
          }

          await expect(page, `${roleKey}: "${name}" bounced to /login`).not.toHaveURL(/\/login/i);

          // ONE retry before failing, not a hard fail on the first sighting.
          // Found live 2026-09-05: Cluster Admin's "WAM" tripped this check
          // once, but the failure screenshot showed a fully-settled, ORDINARY
          // Dashboard (not WAM, not any visible error content, sidebar
          // highlighting "Dashboard") — consistent with a momentary render
          // flash rather than a real broken screen. navigateTo() already waits
          // for networkidle, but Cluster Admin's own dashboard renders an
          // enormous dataset (45,394 RFIs in this run), so a brief client-side
          // render state AFTER the network settles is plausible. A genuinely
          // broken screen will still be broken on the retry; a momentary flash
          // will not be.
          const errorBanner = page.locator('text=/something went wrong|page not found|404/i').first();
          let bannerShown = await errorBanner.isVisible().catch(() => false);
          if (bannerShown) {
            console.log(`  ${roleKey}: "${name}" showed an error banner on first check — retrying navigation once`);
            await dashboard.navigateTo(name);
            bannerShown = await errorBanner.isVisible().catch(() => false);
          }
          expect(
            bannerShown,
            `${roleKey}: "${name}" showed an error banner on BOTH the first attempt and a retry`
          ).toBe(false);
          console.log(`  ${roleKey}: "${name}" opened OK (${page.url()})`);

          // Return to a top-level screen before the next item. Required on
          // mobile, where the hamburger — and therefore the drawer — only
          // exists on top-level screens; a sub-page shows a back chevron
          // instead (see DashboardPage.revealNavIfCollapsed). Skipped when the
          // item just visited WAS Dashboard, to avoid a redundant click.
          if (name !== 'Dashboard') await dashboard.goToDashboard();
        }
      } finally {
        await context.close();
      }
    });
  }
});
