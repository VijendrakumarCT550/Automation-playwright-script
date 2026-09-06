const { test, expect } = require('@playwright/test');
const { loginAsUser, returnToPulse } = require('../utils/helpers');
const { isDrsUrl } = require('../config/environments');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');

// Online hierarchy roles below Admin (Admin itself is already covered by
// 04_admin_login_dashboard.spec.js) — Cluster Admin -> Site Admin -> Plot
// Admin -> Project Manager -> (Execution Lead + Quality Lead) -> Contractor
// Manager, per docs/wam-hierarchy-business-logic.md /
// [[project_wam_hierarchy_all_roles]]. These are the bulk-created users
// 12_user_management.spec.js tracks in tests/fixtures/last-created-users.json,
// keyed by prefix. CONFIRMED live that every one of them can actually log in
// with this same loginAsUser helper — 18_wam_hierarchy.spec.js's cascade
// already does exactly that for all 7 (all passing, see
// [[project_wam_hierarchy_all_roles]]).
//
// "Online" here is DashboardPage.js's own distinction
// (resolveIncompleteDownloadBanner's comment): unlike CI/EE/QI's
// offline/PWA accounts, these never show the first-run install spinner, so
// loginAsUser's waitForContentOnly (not the PWA-aware loginAsFlowUser) is
// the right wait.
const ROLES = ['CAD', 'SAD', 'PAD', 'PM', 'EL', 'QL', 'CM'];

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const lastCreated = loadLastCreatedUsers();

function requireUser(prefix) {
  const user = lastCreated[prefix];
  expect(
    user,
    `No last-created user recorded for prefix "${prefix}" in ` +
      'tests/fixtures/last-created-users.json — run 12_user_management.spec.js ' +
      '(and 13_wam_all_roles.spec.js / 18_wam_hierarchy.spec.js, so it is actually ' +
      'able to log in) first.'
  ).toBeTruthy();
  return user;
}

// Deliberately plain console.log, NOT expect()/expect.soft(): which of the
// dashboard's chart widgets a given hierarchy role actually renders is
// unconfirmed (only Admin's set is documented, in 04_admin_login_dashboard
// .spec.js / DashboardPage.js), and 18_wam_hierarchy.spec.js's
// logRoleRestrictionCheck already hit the reason NOT to use expect.soft()
// for this kind of "informational, not the point of the test" check: a
// soft-assertion failure still fails the containing test, and — the sharp
// edge specifically — inside a `serial` describe it was confirmed live to
// silently skip every LATER test too. This spec keeps each role's test
// independent (see below) specifically so that never happens here, but the
// widget check stays reported-not-asserted regardless, since an unconfirmed
// cosmetic difference failing the WHOLE test would bury the thing this spec
// actually exists to check: does the menu work.
function logWidgetVisibility(prefix, label, visible) {
  console.log(`${prefix} dashboard widget "${label}": ${visible ? 'visible' : 'NOT visible'}`);
}

test.describe('Hierarchy roles (CAD/SAD/PAD/PM/EL/QL/CM) — dashboard load + left-hand menu sweep', () => {
  // NOT serial, and each test opens/closes its own context below — one
  // role's login or nav failure must not skip or contaminate the next
  // role's check. These 7 checks are independent of each other (unlike
  // 18_wam_hierarchy.spec.js's cascade, where each tier's login depends on
  // the previous tier's WAM assignment having just happened).
  for (const prefix of ROLES) {
    test(`${prefix}: logs in, dashboard loads, every left-hand menu item opens without error`, async ({ browser }) => {
      // Online accounts skip the ~10min first-install allowance CI/EE/QI
      // need, but a full menu sweep (several nav items, each with its own
      // networkidle wait) is slower than a single dashboard check like
      // 04_admin_login_dashboard.spec.js's.
      test.setTimeout(5 * 60 * 1000);

      const user = requireUser(prefix);

      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      const page = await context.newPage();

      try {
        const dashboard = await loginAsUser(page, user.email, PASSWORD);
        await expect(page, `${prefix}: still on /login after loginAsUser`).not.toHaveURL(/\/login/i);

        // --- Dashboard load ---
        // Land on the actual Dashboard page rather than trusting wherever
        // login happened to leave us — appReadyContent() (used internally by
        // waitForContentOnly) also matches "Pending with others", which per
        // DashboardPage.js is what hierarchy/oversight roles' MY TASKS page
        // shows, so post-login could already be there rather than /dashboard.
        await dashboard.goToDashboard();

        const widgets = {
          'RFI Distribution': dashboard.rfiDistributionChart,
          'NC Distribution': dashboard.ncDistributionChart,
          'TAT Summary': dashboard.tatSummaryChart,
          'Trend Analysis': dashboard.trendAnalysisChart,
          'Detail Records tab': dashboard.detailRecordsTab,
        };
        for (const [label, locator] of Object.entries(widgets)) {
          logWidgetVisibility(prefix, label, await locator.isVisible().catch(() => false));
        }

        await page.screenshot({ path: `test-results/${prefix}_dashboard.png`, fullPage: true });

        // --- Left-hand menu sweep ---
        // The item SET is genuinely unconfirmed per role — only Admin's 8
        // (Dashboard, My Tasks, WAM, SO Mapping, Users, Reports,
        // Configuration, Admin RFI UI) are documented in DashboardPage.js.
        // Discover it live instead of hardcoding a guess, then visit every
        // discovered item and confirm it actually opens something rather
        // than bouncing to /login or showing an error banner.
        await dashboard.revealNavIfCollapsed('Dashboard');
        const treeitems = await page.getByRole('treeitem').all();
        const names = [];
        for (const item of treeitems) {
          if (await item.isVisible().catch(() => false)) {
            const text = (await item.textContent())?.trim();
            if (text) names.push(text);
          }
        }
        expect(names.length, `${prefix}: no visible left-hand menu items found`).toBeGreaterThan(0);
        console.log(`${prefix} left-hand menu items (${names.length}): ${names.join(', ')}`);

        for (const name of names) {
          await dashboard.navigateTo(name);

          // EXPECTED, NOT A FAILURE: a menu item may hand off to DRS.
          //
          // App owner, 2026-09-06: following "SO Mapping" may land on the SO
          // Mapping screen, on the DRS LOGIN page, or on the DRS dashboard when
          // DRS already has an admin session — all three are correct. SO
          // Mapping moved out of PULSE to DRS on 2026-09-04, and PULSE's
          // sidebar entry is a live hand-off rather than a dead link.
          //
          // Must be checked BEFORE the /login assertion below: DRS's own login
          // URL ends in "/login", so the hand-off would otherwise be reported
          // as this role's PULSE session bouncing, which it is not. It also has
          // to come before anything else touches the page — on the DRS origin
          // no PULSE locator resolves, so the error-banner probe and
          // goToDashboard() would both misbehave. Same fix as SM17's.
          if (isDrsUrl(page.url())) {
            console.log(`${prefix}: "${name}" handed off to DRS (${page.url()}) — expected, not a bug`);
            await returnToPulse(page);
            continue;
          }

          await expect(page, `${prefix}: "${name}" bounced to /login`).not.toHaveURL(/\/login/i);
          const errorBanner = page.locator('text=/something went wrong|page not found|404/i').first();
          expect(
            await errorBanner.isVisible().catch(() => false),
            `${prefix}: "${name}" showed an error banner`
          ).toBe(false);
          console.log(`${prefix}: "${name}" opened OK (${page.url()})`);

          // Back to a top-level screen before the next item — required on
          // mobile, where the hamburger (and so the drawer) only exists on
          // top-level screens; a sub-page shows a back chevron instead
          // (DashboardPage.js's revealNavIfCollapsed comment). Skipped when
          // the item just visited WAS Dashboard, to avoid a redundant click.
          if (name !== 'Dashboard') await dashboard.goToDashboard();
        }
      } finally {
        await context.close();
      }
    });
  }
});
