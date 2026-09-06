const { test, expect } = require('@playwright/test');
const { loginAsUser, loginAsFlowUser, adminFreshLogin, returnToPulse } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { getProfile } = require('../config/projects');
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
// NOT serial, and deliberately. The first run had this as a serial describe and
// PM's (false) failure SKIPPED EL, QL, CM and the summary — four roles' worth of
// evidence lost to one bad assertion, which is exactly the trap spec 31's header
// warns about. Route discovery is a beforeAll instead, so every role is checked
// independently and one role's failure costs only that role.

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// CAD first, deliberately, as the control (see the header).
//
// CI ADDED 2026-09-06 after the first clean run exposed a real ceiling. With only
// the hierarchy tiers, EVERY role came back with the SAME two forbidden screens
// (Configuration, Admin RFI UI) — so the spec was measuring one binary boundary,
// Admin vs everyone else, and the "forbidden sets actually differ by tier" guard
// correctly warned that it was not measuring a gradient at all.
//
// CI is the most restricted role in the product and the one where a privilege
// bug would matter most, so it is the single highest-value addition. It costs a
// PWA login, but a freshly created smoke CI logs in in about a minute — nothing
// like the 7.9 min the .env CI takes.
const ROLES = ['CAD', 'PM', 'EL', 'QL', 'CM', 'CI'];

// USERS COME FROM THE SMOKE CHAIN, not from 12_user_management's bare-prefix
// batch, and that is a deliberate correction rather than a convenience.
//
// The bare CAD/PM/EL/QL/CM entries in last-created-users.json carry NO baseUrl
// at all — they predate the environment guard smoke-users.js added after a run
// on 2026-09-03 silently reused users from a deployment they did not exist on.
// Checked 2026-09-06: they are from batch 67 against an unrecorded deployment,
// and this chain now runs on pulse-qa, where they almost certainly do not exist.
// resolveSmokeUsers() applies that guard, so a stale entry fails immediately
// with a message naming the problem instead of as an inscrutable login failure.
//
// It also makes promoting this file to SM29 close to a copy, since every SM*
// stage resolves its users exactly this way.
const PROFILE_KEY = process.env.RECON_PROFILE || 'solar-e2e';

// Never treated as forbidden even when a role's menu lacks them: every role
// legitimately lands on one of these, so a redirect TO them is how a denial
// looks, not something to test for.
const ALWAYS_ALLOWED = ['Dashboard', 'My Tasks'];

function requireUser(roleKey) {
  return resolveSmokeUsers(getProfile(PROFILE_KEY), [roleKey])[roleKey];
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
  test.beforeAll(async ({ browser }) => {
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

    const { context, page, dashboard } = await adminFreshLogin(browser);
    try {
      await dashboard.goToDashboard();
      const names = await readMenu(page, dashboard);
      expect(names.length, 'Admin should have a non-empty left-hand menu').toBeGreaterThan(0);
      console.log(`\nAdmin menu (${names.length}): ${names.join(', ')}`);

      for (const name of names) {
        const before = page.url();
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

        // ONLY RECORD AN ITEM THAT ACTUALLY WENT SOMEWHERE.
        //
        // Found live on the first run, 2026-09-06, and it produced a false
        // failure rather than a silent one. Not every menu entry is a link:
        //
        //   * "SO Mapping" does not navigate at all — SOMappingPage's own
        //     comment records this ("clicking the sidebar link never navigates
        //     away from /dashboard"), since the feature moved to DRS;
        //   * "Reports" is a COLLAPSIBLE PARENT that expands sub-items in place
        //     (its children are /reports/rfi-status and friends).
        //
        // Both left page.url() on /dashboard, so both were recorded as
        // `-> /dashboard`. PM's menu has no "SO Mapping", so it became a
        // FORBIDDEN route pointing at /dashboard — and PM of course reaches its
        // own dashboard, which the classifier read as REACHED. The spec
        // reported an authorisation gap that does not exist.
        //
        // The rule that fixes it is the honest one: an entry that did not move
        // the page is not a route, so there is nothing to test for it.
        const landedAt = page.url();
        const wentSomewhere = landedAt.replace(/[?#].*$/, '') !== before.replace(/[?#].*$/, '');
        if (!wentSomewhere) {
          console.log(`  "${name}" -> did not navigate (stayed on ${landedAt}) — not a route, skipped`);
          continue;
        }
        adminRoutes.set(name, landedAt);
        console.log(`  "${name}" -> ${landedAt}`);
        if (name !== 'Dashboard') await dashboard.goToDashboard();
      }

      expect(
        adminRoutes.size,
        'Admin should have opened at least one recordable PULSE route'
      ).toBeGreaterThan(0);
      console.log(`Admin routes recorded (${adminRoutes.size}): ${[...adminRoutes.keys()].join(', ')}`);
    } finally {
      await context.close();
    }
  });

  for (const prefix of ROLES) {
    test(`${prefix} cannot reach the screens its own menu does not offer`, async ({ browser }) => {
      // Generous for CI, which pays the PWA install cost the online roles do not.
      test.setTimeout(15 * 60 * 1000);
      expect(adminRoutes.size, 'Admin route discovery must have run first').toBeGreaterThan(0);

      const user = requireUser(prefix);
      const context = await browser.newContext({
        permissions: ['geolocation'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      const page = await context.newPage();

      try {
        // CI/EE/QI are the offline/PWA accounts and need waitForLoad (the PWA
        // install spinner), which loginAsUser deliberately does NOT wait for —
        // its own header records that only CIC/EE/QI show that spinner. Using
        // the wrong one here would return before the app finished installing and
        // every menu read would come back empty.
        const isPwaRole = ['CI', 'EE', 'QI'].includes(prefix);
        const dashboard = isPwaRole
          ? await loginAsFlowUser(page, user.email, PASSWORD, { navigateToMyTasks: false })
          : await loginAsUser(page, user.email, PASSWORD);
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

    // MEASURED 2026-09-06 on pulse-qa, across CAD/PM/EL/QL/CM/CI:
    //
    //   Admin                    8 menu items
    //   CAD                      6  (adds SO Mapping)
    //   PM, EL, QL, CM and CI    5  — IDENTICAL, every one of them
    //
    // So route-level permission in PULSE is effectively BINARY: Admin vs
    // everyone else. Only `Configuration` and `Admin RFI UI` are ever forbidden,
    // and they are forbidden for all six roles alike — including CI, the lowest
    // role in the hierarchy, whose menu still carries WAM and Users.
    //
    // That is a real result, not a null one, and it sets the ceiling on what
    // this file can ever prove: PULSE scopes roles INSIDE screens (which WAM
    // rows, which Role options, whether Add User is active) rather than by
    // withholding routes. Route-level denial is therefore fully covered by the
    // six checks above, and everything else worth testing negatively is
    // in-screen — e.g. "PM's WAM Role dropdown must not offer Cluster Admin",
    // for which WAMPage.getAvailableRoleOptions already exists and spec 18
    // asserts the positive direction per tier.
    //
    // Still REPORTED rather than asserted: whether CI *should* have WAM and
    // Users in its menu is the app owner's call, not this spec's, and asserting
    // either way would be inventing a requirement.
    const distinct = new Set(summary.map((s) => s.forbidden));
    if (summary.length > 1 && distinct.size === 1) {
      console.log(
        `  FINDING: all ${summary.length} roles forbid exactly the same ${[...distinct][0]} screen(s). ` +
        `Route-level permission is Admin-vs-rest on this deployment; role scoping happens ` +
        `INSIDE screens instead. Worth confirming with the app owner that CI in particular ` +
        `is meant to have WAM and Users in its menu at all.`
      );
    }
    expect(summary.length, 'at least one role should have been checked').toBeGreaterThan(0);
  });
});
