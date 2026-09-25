// SESSION HANDLING FOR THE REASSIGNMENT SPECS — one browser context per login.
//
// WHY THIS EXISTS, and why it is not just a convenience wrapper.
//
// Reusing a single browser context across logins makes this app show the WRONG
// WORKLIST, reproducibly. Live on pulse-test 2026-09-20: after a few role
// switches inside one context, EE_D's "Pending with me" returned exactly ONE
// row — the record the previous test had touched — while a brand-new context
// logged in as the SAME user at the SAME moment returned all SEVEN. It is not a
// load race (five polled re-navigations read the same single row), and it is
// not the standing PULSE login rule either: `loginAsFlowUser` already clears
// cookies and localStorage, and a dashboard-first refresh did not shift it.
//
// It is also not merely a reading fault — the row that does not appear cannot
// be CLICKED, so the stale session cannot do the work at all.
//
// THE CAUSE IS NOT UNDERSTOOD. This is a structural workaround, recorded as an
// open unknown in docs/automation-coverage-and-gaps.md section 2d rather than
// dressed up as a fix. What matters for the specs is that a fresh context is
// the one condition under which these queues are known to read correctly, and
// a login costs the same either way.
//
// Bonus, and the reason this would be worth doing even without that bug: a spec
// that signs in as five different people gets no cross-login bleed at all —
// nothing one actor leaves behind can reach the next.
const { loginAsFlowUser } = require('./helpers');

// Geolocation and permissions are NOT inherited by a hand-made context (they
// live in playwright.config.js's `use` block), and several screens need them:
// geolocation for the RFI/NC forms, camera for NC's mandatory Capture Photo.
const CONTEXT_OPTIONS = {
  permissions: ['geolocation', 'camera'],
  geolocation: { latitude: 23.0225, longitude: 72.5714 },
};

// Creates a session factory bound to one browser. The caller keeps whatever
// `current()` returns as its page, and must call `close()` in afterAll.
function createSessionFactory(browser, { log = () => {} } = {}) {
  let context = null;
  let page = null;

  async function open(email, password, opts = {}) {
    if (context) await context.close().catch(() => {});
    context = await browser.newContext(CONTEXT_OPTIONS);
    page = await context.newPage();
    await loginAsFlowUser(page, email, password, opts);
    return page;
  }

  return {
    // Sign in as a fleet member (or anyone) in a brand-new context.
    async actAs(email, password, opts = {}) {
      log(`session: ${email}`);
      return open(email, password, opts);
    },

    // Admin has no "Pending with me" — it is a CI/EE/QI queue — so admin
    // sessions skip the My Tasks hop entirely.
    async actAsAdmin(opts = {}) {
      log('session: admin');
      return open(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, {
        navigateToMyTasks: false,
        ...opts,
      });
    },

    current() {
      return page;
    },

    async close() {
      if (context) await context.close().catch(() => {});
      context = null;
      page = null;
    },
  };
}

module.exports = { createSessionFactory, CONTEXT_OPTIONS };
