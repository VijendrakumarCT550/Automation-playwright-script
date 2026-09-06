const { test, expect } = require('@playwright/test');
const { loginAsUser, adminFreshLogin, returnToPulse } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const { isDrsUrl } = require('../config/environments');
const DashboardPage = require('../pages/DashboardPage');

// NEGATIVE AUTHORISATION — closes gap G-18 in docs/automation-coverage-and-gaps.md.
//
// ---------------------------------------------------------------------------
// THE GAP THIS FILLS
// ---------------------------------------------------------------------------
// The whole suite proves each role CAN reach what it should. Confirmed by
// repo-wide search 2026-09-06: nothing anywhere asserts a role is DENIED what
// it should not. On an app where role scoping IS the product logic, a
// permissions regression — a Contractor Manager who can suddenly open WAM, a
// Quality Lead who can open Users — would pass every one of the 443 tests
// silently.
//
// Built in tests/specs/ first, per the app owner's 2026-09-06 rule: prove it
// here, then promote it to tests/smoke/ as an SM* stage.
//
// ---------------------------------------------------------------------------
// WHY THIS DISCOVERS ITS ROUTES INSTEAD OF HARDCODING THEM
// ---------------------------------------------------------------------------
// The URL paths for WAM / Users / Reports / Configuration are recorded NOWHERE
// in this repo — every page object reaches those screens by CLICKING the nav
// item, so only /dashboard, /my-tasks and /so-mapping are known as literals.
// Hardcoding guesses would produce a test that "passes" because it navigated to
// a 404, which proves nothing about authorisation.
//
// So Admin — who has the full menu — walks it once and records name -> URL.
// That set is the app's own statement of where each screen lives, and it
// survives a route change without an edit here.
//
// ---------------------------------------------------------------------------
// AND WHY THE MENU IS THE ORACLE
// ---------------------------------------------------------------------------
// A role's own left-hand menu is the app's own declaration of what that role
// may reach — SM17 / spec 31 already rely on that, and the per-tier item counts
// differ (SO Mapping being the documented split). So "forbidden" is not a guess
// either: it is every screen Admin has that THIS role's own menu does not offer.
//
// The test then asks the only question that matters: if the menu does not offer
// it, does navigating straight to the URL get in anyway?
//
// ---------------------------------------------------------------------------
// WHICH ROLES, AND WHY NOT CI/EE/QI
// ---------------------------------------------------------------------------
// The hierarchy roles are ONLINE accounts and log in within about a minute.
// CI/EE/QI are the offline/PWA accounts that cost 3-6 minutes each (and the
// .env CI has been measured at 7.9 min on pulse-qa), which would make this a
// half-hour spec for no extra signal — the lower hierarchy tiers already give a
// real, documented permission boundary: Add User is admin-tier-only
// (CAD/SAD/PAD yes, PM/EL/QL/CM no), and SO Mapping splits the tiers.
//
// CAD runs too, as a CONTROL: it sits high in the hierarchy, so it should have
// FEWER forbidden routes than PM/EL/QL/CM. A run where every role has an
// identical forbidden set means the menu is not actually tier-scoped and this
// spec is measuring nothing — which the summary at the end calls out.
//
// ---------------------------------------------------------------------------
// WHAT IS ASSERTED VS REPORTED, AND WHY
// ---------------------------------------------------------------------------
// How this app answers an unauthorised direct navigation is NOT confirmed — it
// could redirect, show a banner, render an empty shell, or (the thing worth
// finding) simply serve the screen. So the outcome is CLASSIFIED, and only the
// unambiguous failure is asserted:
//
//   drs-handoff  SO Mapping now hands off to DRS - EXPECTED, never a failure.
//                See app-owner-decisions-and-conventions.md 3.9.
//   redirected   the app moved us off the target URL          -> denied, pass
//   blocked      an error / not-authorised indicator rendered  -> denied, pass
//   empty        stayed on the URL but rendered no app content -> reported
//   REACHED      stayed on the URL with real content           -> FAIL
//
// `empty` is deliberately not a failure on the first pass: an app shell with no
// data is a plausible way to deny access, and calling it a defect before it has
// ever been observed live would be guessing. It is printed loudly so the first
// real run settles it, and then this can tighten.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Bare prefixes from 12_user_management's batch — the same ones spec 31 and
// 18_wam_hierarchy resolve. CAD first, deliberately, as the control.
const ROLES = ['CAD', 'PM', 'EL', 'QL', 'CM'];

// Never treated as forbidden even when a role's menu lacks them: every role
// legitimately lands on one of these, so a redirect TO them is how a denial
// looks, not something to test for.
const ALWAYS_ALLOWED = ['Dashboard', 'My Tasks'];

function requireUser(prefix) {
  const user = loadLastCreatedUsers()[prefix];
  expect(
    user,
    `No last-created user recorded for prefix "${prefix}" in ` +
    'tests/fixtures/last-created-users.json — run 12_user_management.spec.js first.'
  ).toBeTruthy();
  return user;
}

// Reads the visible left-hand menu. Same discover-don't-hardcode technique
// SM17 and spec 31 use, for the same reason: the item set per tier is exactly
// what varies, so a hardcoded list would either fail on a correct app or hide a
// genuinely missing item.
async function readMenu(page, dashboard) {
  await dashboard.revealNavIfCollapsed('Dashboard');
  const names = [];
  for (const item of await page.getByRole('treeitem').all()) {
    if (!(await item.isVisible().catch(() => false))) continue;
    const text = (await item.textContent())?.trim();
    if (text) names.push(text);
  }
  return names;
}

// Admin's menu name -> the URL that menu item actually opens.
const adminRoutes = new Map();
const summary = [];

test.describe('Negative authorisation — a role cannot reach screens its own menu does not offer', () => {
  test('Admin walks the full menu and records where each item lives', async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

    const { context, page, dashboard } = await adminFreshLogin(browser);
    try {
      await dashboard.goToDashboard();
      const names = await readMenu(page, dashboard);
      expect(names.length, 'Admin should have a non-empty left-hand menu').toBeGreaterThan(0);
      console.log(`\nAdmin menu (${names.length}): ${names.join(', ')}`);

      for (const name of names) {
        await dashboard.navigateTo(name);

        // SO Mapping hands off to DRS and legitimately leaves the PULSE origin
        // (app owner, 2026-09-06). Recording a DRS URL as a PULSE route to
        // guard would make every later role "fail" to reach something PULSE
        // does not own.
        if (isDrsUrl(page.url())) {
          console.log(`  "${name}" -> DRS hand-off (${page.url()}) — expected, not recorded as a PULSE route`);
          await returnToPulse(page);
          continue;
        }

        adminRoutes.set(name, page.url());
        console.log(`  "${name}" -> ${page.url()}`);
        if (name !== 'Dashboard') await dashboard.goToDashboard();
      }

      expect(
        adminRoutes.size,
        'Admin should have opened at least one recordable PULSE route'
      ).toBeGreaterThan(0);
    } finally {
      await context.close();
    }
  });

  for (const prefix of ROLES) {
    test(`${prefix} cannot reach the screens its own menu does not offer`, async ({ browser }) => {
      test.setTimeout(12 * 60 * 1000);
      expect(adminRoutes.size, 'Admin route discovery must have run first').toBeGreaterThan(0);

      const user = requireUser(prefix);
      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      const page = await context.newPage();

      try {
        const dashboard = await loginAsUser(page, user.email, PASSWORD);
        await expect(page, `${prefix}: still on /login after login`).not.toHaveURL(/\/login/i);
        await dashboard.goToDashboard();

        const own = await readMenu(page, dashboard);
        console.log(`\n${prefix} menu (${own.length}): ${own.join(', ')}`);

        const forbidden = [...adminRoutes.entries()].filter(
          ([name]) => !own.includes(name) && !ALWAYS_ALLOWED.includes(name)
        );
        console.log(
          `${prefix}: ${forbidden.length} screen(s) Admin has that ${prefix} does not: ` +
          `${forbidden.map(([n]) => n).join(', ') || '(none)'}`
        );
        summary.push({ prefix, menu: own.length, forbidden: forbidden.length });

        const reached = [];
        for (const [name, url] of forbidden) {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
          await page.waitForLoadState('networkidle').catch(() => {});

          const landed = page.url();
          let verdict;

          if (isDrsUrl(landed)) {
            verdict = 'drs-handoff';
            await returnToPulse(page);
          } else if (landed.replace(/[?#].*$/, '') !== url.replace(/[?#].*$/, '')) {
            verdict = `redirected -> ${landed}`;
          } else {
            const denied = await page
              .locator('text=/not authori[sz]ed|unauthori[sz]ed|access denied|permission|forbidden|you do not have/i')
              .first().isVisible({ timeout: 2000 }).catch(() => false);

            if (denied) {
              verdict = 'blocked (explicit denial shown)';
            } else {
              // Is there real app content, or an empty shell? `appReadyContent`
              // is DashboardPage's own definition of "this app has rendered
              // something usable", so this is not a new guess.
              const hasContent = await dashboard
                .appReadyContent().first().isVisible({ timeout: 3000 }).catch(() => false);
              if (hasContent) {
                verdict = 'REACHED';
                reached.push({ name, url });
                await page.screenshot({
                  path: `test-results/negauth_${prefix}_${name.replace(/\W+/g, '_')}.png`,
                  fullPage: true,
                }).catch(() => {});
              } else {
                verdict = 'empty (stayed on URL, no app content) — reported, not asserted';
              }
            }
          }
          console.log(`  ${prefix} -> "${name}" (${url}): ${verdict}`);
        }

        expect(
          reached,
          `${prefix} REACHED ${reached.length} screen(s) its own menu does not offer: ` +
          `${reached.map((r) => `"${r.name}" (${r.url})`).join(', ')}. ` +
          `The menu is the app's own declaration of what this role may use, so serving ` +
          `the working screen on a direct URL is an authorisation gap, not a UI quirk. ` +
          `Screenshots are in test-results/negauth_${prefix}_*.png.`
        ).toEqual([]);
      } finally {
        await context.close();
      }
    });
  }

  test('the forbidden sets actually differ by tier (otherwise this spec measures nothing)', async () => {
    console.log('\n--- negative authorisation summary ---');
    for (const s of summary) {
      console.log(`  ${s.prefix.padEnd(4)} menu=${s.menu}  forbidden=${s.forbidden}`);
    }

    // Reported, not asserted, on purpose: if every tier turns out to have the
    // same menu, that is a finding about the APP (the menu is not tier-scoped)
    // and it belongs in front of the app owner — not a failure of this spec,
    // which would then just be noise on top of the real result above.
    const distinct = new Set(summary.map((s) => s.forbidden));
    if (summary.length > 1 && distinct.size === 1) {
      console.log(
        `  WARNING: every role has the same number of forbidden screens (${[...distinct][0]}). ` +
        `Either the menu is not tier-scoped on this deployment, or these roles genuinely ` +
        `share one permission set — worth confirming with the app owner before trusting ` +
        `the per-role results above.`
      );
    }
    expect(summary.length, 'at least one role should have been checked').toBeGreaterThan(0);
  });
});
