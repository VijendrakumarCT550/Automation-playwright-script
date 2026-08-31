// Extends Playwright's `test` with a `profile` fixture, so one spec file can
// serve several project types and the choice is made by the PROJECT that runs
// it (playwright.config.js) rather than by an env var or a duplicated file.
//
//   // playwright.config.js
//   { name: 'smoke-wind-users', use: { profileKey: 'wind-e2e' } }
//
//   // tests/smoke/s01_user_creation.spec.js
//   const { test, expect } = require('../config/test-base');
//   test('...', async ({ profile }) => { profile.workLocations // ['WTG-Khavda'] });
//
// `profileKey` is declared as a Playwright OPTION fixture (the
// `[default, { option: true }]` form), which is what makes it settable from a
// project's `use` block. Its default is the regression profile so that any
// spec run under the plain `chromium` project — i.e. every existing spec —
// keeps seeing the literals it always has.
//
// Also exposes `isMobileViewport`, derived from the project's own `isMobile`/
// viewport settings rather than from a separate flag, so a page object can ask
// "am I on the phone layout" without every spec having to thread it through.
// CONFIRMED live (2026-08-31): PULSE serves the SAME app at the same URL for
// mobile — no user-agent sniffing, no separate shell — but the desktop sidebar
// nav is replaced by an unlabeled hamburger button, and NONE of DashboardPage's
// eight nav locators resolve at a phone viewport. So viewport alone is the
// correct signal, and navigation is the layer that needs mobile-specific code.
const base = require('@playwright/test');
const { getProfile } = require('./projects');

const MOBILE_MAX_WIDTH = 768;

const test = base.test.extend({
  // Both are WORKER-scoped on purpose. The smoke stages need the profile in
  // test.beforeAll (to decide what to create, and to fail fast on a profile
  // that has no fresh users), and Playwright only allows worker-scoped
  // fixtures there — a test-scoped `profile` fails with "Fixture 'profile' is
  // not available in beforeAll". Neither value varies per test within a
  // project, so worker scope costs nothing.
  //
  // Settable per project: use: { profileKey: 'wind-e2e' }
  profileKey: ['solar-regression', { option: true, scope: 'worker' }],

  profile: [async ({ profileKey }, use) => {
    await use(getProfile(profileKey));
  }, { scope: 'worker' }],

  // Test-scoped, because it derives from `isMobile`/`viewport`, which are.
  isMobileViewport: async ({ isMobile, viewport }, use) => {
    const narrow = !!viewport && viewport.width <= MOBILE_MAX_WIDTH;
    await use(!!isMobile || narrow);
  },
});

module.exports = { test, expect: base.expect, devices: base.devices, MOBILE_MAX_WIDTH };
