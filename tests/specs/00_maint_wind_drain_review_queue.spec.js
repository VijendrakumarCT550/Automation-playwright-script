const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const DashboardPage = require('../pages/DashboardPage');
const MyTasksPage = require('../pages/MyTasksPage');
const RFIListPage = require('../pages/RFIListPage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const { WIND_E2E } = require('../config/projects');

// MAINTENANCE UTILITY, not coverage. Approves every wind RFI currently sitting
// in the WTG EE's and then the WTG QI's "Pending with me" queue.
//
// WHY THIS IS NEEDED. Wind has exactly ONE Work Section per Work Area, and the
// app enforces the preceding-checkpoint dependency. So an RFI that was CREATED
// but never approved leaves its whole work area stuck: every later checkpoint
// reports
//   "A RFI with for the Inspection point: <X> ... is either pending or rejected"
// and the flow stage correctly abandons that area. Two areas ended up in exactly
// that state during development:
//   * KH 35 — A1.18.1 created by a run that died in getVisibleCodeFor
//   * KH 52 — A1.18.1 created at a MOBILE viewport by a run that died reading
//             the code back (mobile has no breadcrumb; see
//             BasePage.getVisibleCode's fallback)
// Draining the queue returns both areas to a usable state.
//
// Safe to run repeatedly: it approves whatever is pending and reports zero when
// there is nothing to do. It only ever touches the WTG EE/QI users' OWN queues,
// and those users are scoped to WIND / WTG-Khavda alone, so it cannot reach
// solar or anyone else's work.
//
// SPECIFIC_RFI_ID=<uuid> approves just that one RFI by id instead of draining —
// for the case where an RFI's code was never captured (enumeration by code is
// impossible then, but the id is in the failed run's log).
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const MAX_PER_ROLE = 15; // backstop; a queue this long means something else is wrong

test.describe.configure({ mode: 'serial' });

test.describe('Maintenance - drain the WTG review queue', () => {
  let users;

  test.beforeAll(() => {
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    const recorded = loadLastCreatedUsers();
    users = {};
    for (const roleKey of ['EE', 'QI']) {
      const prefix = WIND_E2E.users.prefixes[roleKey];
      const entry = recorded[prefix];
      expect(
        entry && entry.profileKey === WIND_E2E.key,
        `No recorded WTG ${roleKey} (prefix "${prefix}") — run the smoke-wind-users stage first.`
      ).toBeTruthy();
      users[roleKey] = entry;
    }
  });

  for (const role of ['EE', 'QI']) {
    test(`${role} approves everything pending`, async ({ page }) => {
      // Each approval is a full page cycle, and there may be several.
      test.setTimeout(30 * 60 * 1000);

      const user = users[role];
      console.log(`\n=== ${role} (${user.name}) draining "Pending with me" ===`);
      await loginAsFlowUser(page, user.email, PASSWORD);

      // ---- Single-RFI mode: act on one id, no enumeration ----
      if (process.env.SPECIFIC_RFI_ID) {
        const id = process.env.SPECIFIC_RFI_ID;
        const review = new RFIReviewPage(page);
        await review.goto(id);

        // The code is worth logging: it is what a failed run could not capture,
        // and it exercises BasePage.getVisibleCode's mobile/no-breadcrumb
        // fallback on the way past.
        const code = await review.getVisibleCode().catch(() => '(code unreadable)');
        console.log(`  ${role}: opened ${id} -> ${code}`);

        // Only approve if it is genuinely this role's turn — the view page is
        // reachable by id regardless of whose queue the RFI is in, so this must
        // not blindly click Submit on someone else's pending item.
        const submitVisible = await review.submitButton.isVisible({ timeout: 5000 })
          .catch(() => false);
        if (!submitVisible) {
          console.log(`  ${role}: no Submit control on this RFI — not this role's turn. Nothing done.`);
          return;
        }

        await review.expandAllChecklist();
        await review.approve();
        console.log(`  ${role}: approved ${code}`);
        return;
      }

      // ---- Drain mode: enumerate and approve until the queue is empty ----
      const approved = [];
      for (let i = 0; i < MAX_PER_ROLE; i++) {
        const dashboard = new DashboardPage(page);
        await dashboard.closeAnyOpenDialog();
        await dashboard.dismissToastIfPresent();
        await dashboard.goToMyTasks();

        const myTasks = new MyTasksPage(page);
        await myTasks.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
        await myTasks.clickPendingWithMe();

        const list = new RFIListPage(page);
        const codes = await list.listRowCodes();
        console.log(`  ${role}: ${codes.length} pending -> ${JSON.stringify(codes)}`);
        if (codes.length === 0) break;

        // Always take the FIRST remaining code and re-enumerate afterwards
        // rather than iterating a snapshot: approving removes a row, so a cached
        // list goes stale immediately.
        const code = codes[0];
        await openFromPendingWithMe(page, code, `${role} drain`, { exact: true });

        const review = new RFIReviewPage(page);
        await review.expandAllChecklist();
        await review.approve();
        approved.push(code);
        console.log(`  ${role}: approved ${code}`);
      }

      console.log(
        `\n  ${role}: approved ${approved.length} RFI(s)` +
        (approved.length ? `: ${JSON.stringify(approved)}` : ' (queue was already empty)')
      );
    });
  }
});
