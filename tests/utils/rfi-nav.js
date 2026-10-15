const DashboardPage = require('../pages/DashboardPage');
const MyTasksPage   = require('../pages/MyTasksPage');
const RFIListPage   = require('../pages/RFIListPage');

// Opens a specific RFI by clicking through the UI — nav "My Tasks" ->
// "Pending with me" tile -> find the row by its visible code -> click its
// Actions column's eye icon — instead of a direct page.goto to its URL.
// This is the UI-click path every RFI-flow actor actually uses to reach
// their next action: CI's resubmit turn and EE/QI's review turn all land in
// their own "Pending with me" list (confirmed live for all three).
//
// DashboardPage.navMyTasks (`a:has-text("My Tasks"), nav >> text=My Tasks`)
// is the persistent sidebar link, present on every screen in the app —
// clicking it is safe and correct from wherever the caller currently is:
// right after login (already on My Tasks), or coming from a previous TC's
// finished review/resubmit (still on that RFI's own page).
//
// `context` (optional, e.g. "CI resubmit after EE P1 reject") is purely for
// the error message below — every call site in this flow (CI's resubmit
// turn, EE/QI's review turn) is ALWAYS looking for an RFI that the previous
// actor just finished acting on, so a timeout here always means the same
// underlying negative scenario: the previous actor's action reported
// success, but the RFI never actually became visible to the NEXT actor
// within a reasonable wait. Confirmed live (2026-08-27): every RFI flow
// failure whose currentStepIndex sat right after a reject/resubmit/create
// step had this exact shape — a generic Playwright locator timeout with no
// indication of WHICH handoff silently didn't happen, indistinguishable
// from any other kind of failure until someone cross-referenced the
// tracker's steps[] by hand. Tagging it here, at the one place this class
// of failure can actually occur, means every caller gets it for free
// without duplicating detection logic.
// PRECONDITION: the logged-in user must be CI, EE or QI.
//
// Per the app owner, the "Pending with me" tile exists ONLY for those three
// roles — they are the ones involved in RFI/NC creation and review. Admin,
// Contractor Manager and every hierarchy role (Cluster Admin, Project Manager,
// Execution Lead, Quality Lead, ...) have NO "Pending with me" tile at all;
// Admin sees "Pending with others" and "Approved" instead. So calling this as any
// other role cannot work, and would surface as an inscrutable 30s timeout on the
// tile below rather than as "wrong role".
//
// (This is also why an Admin-based "does this RFI already exist" check has to use
// the Approved and "Pending with others" tiles — never this one.)
//
// `opts.exact` (default false, i.e. unchanged for every existing caller) is
// forwarded to RFIListPage.openRowByCode. WIND needs it: its RFI code suffix
// restarts per Work-Location/Work-Area/Package combination, so wind codes begin
// at 1 and a substring lookup for "...-CIV-1" also matches "-CIV-10"/"-11"/...,
// resolving to several rows and dying on a Playwright strict-mode violation.
// See RFIListPage.getRowByCode's comment.
async function openFromPendingWithMe(page, rfiCode, context, opts = {}) {
  const dashboard = new DashboardPage(page);
  // Defensive, same reasoning as WAMPage.goto()/NCCreatePage.goto(): a
  // previous attempt on this SAME page/session (withRetry re-running a
  // turn from scratch after an earlier failure, or the previous TC in this
  // actor's loop) may have left a stray dialog/listbox/toast open — its
  // backdrop can then block even THIS nav click. Confirmed live
  // (2026-08-27): a leftover "Are you sure you want to approve RFI?"
  // confirm popup did exactly this, surfacing as `<html>...intercepts
  // pointer events` on the very "My Tasks" click below. Recover before
  // this turn's own interactions can be blocked by it.
  await dashboard.closeAnyOpenDialog();
  await dashboard.closeAnyOpenListbox();
  await dashboard.dismissToastIfPresent();
  await dashboard.goToMyTasks();

  const myTasks = new MyTasksPage(page);
  await myTasks.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
  await myTasks.clickPendingWithMe();

  const list = new RFIListPage(page);
  await list.waitForGrid();
  try {
    try {
      await list.openRowByCode(rfiCode, opts);
    } catch (firstErr) {
      // OBSERVED RETRY (2026-09-26, DRS integration matrices on pulse-uat): in
      // every "not in Pending with me" failure there, the saved HTML showed the
      // row PRESENT in column 1 with the exact code — the lookup had simply run
      // before the freshly-updated list was usable (it alternated: the lookup
      // right after a successful resubmit failed, the next one worked). One
      // reload + re-navigate, logged either way, tells that apart from a real
      // "never became visible" — which still throws below, unchanged.
      // PATIENT, AND MEASURED (2026-09-26): one reload was not always enough on
      // pulse-uat — ROW_DIAG caught CIV-37 VISIBLE seconds after two 15 s looks
      // had failed. So keep reloading (every ~20 s, up to ~90 s) and log how
      // long the record took: a slow list is a measurement, not a missing RFI.
      console.log(`  [observe] ROW_LATE ${rfiCode}${context ? ` (${context})` : ''}: not usable on first look — retrying with reloads`);
      const started = Date.now();
      let opened = false;
      for (let attempt = 1; attempt <= 4 && !opened; attempt++) {
        await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
        await dashboard.dismissToastIfPresent();
        await dashboard.goToMyTasks();
        await myTasks.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
        await myTasks.clickPendingWithMe();
        await list.waitForGrid();
        opened = await list.openRowByCode(rfiCode, opts).then(() => true).catch(() => false);
      }
      try {
        if (!opened) throw new Error('still not openable');
        console.log(`  [observe] ROW_LATE ${rfiCode}: found after ${Math.round((Date.now() - started) / 1000)}s of retries (timing, not a missing record)`);
      } catch {
        console.log(`  [observe] ROW_MISSING ${rfiCode}: still not usable after a reload`);
        // WHAT THE LOOKUP SAW (app owner could not reproduce this by hand,
        // 2026-09-26 — so record the grid state, including the horizontal
        // scroll openRowByCode uses to reach the Actions column's eye icon).
        const diag = await list.grid.evaluate((grid, code) => {
          const rows = [...grid.querySelectorAll('.rdg-row[role="row"]')];
          const row = rows.find((r) => {
            const c = r.querySelector('[aria-colindex="1"]');
            return c && c.textContent.includes(code);
          });
          const box = (el) => { const b = el.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
          return {
            rows: rows.length,
            scrollLeft: grid.scrollLeft, scrollWidth: grid.scrollWidth, clientWidth: grid.clientWidth,
            scrollTop: grid.scrollTop,
            rowFound: !!row,
            rowIndex: row && row.getAttribute('aria-rowindex'),
            cells: row ? [...row.querySelectorAll('[role="gridcell"]')].map((c) => `${c.getAttribute('aria-colindex')}:${box(c).join('x')}${c.getAttribute('aria-selected') === 'true' ? ':sel' : ''}`) : [],
            eyeIcon: !!(row && row.querySelector('svg.lucide-eye')),
          };
        }, rfiCode).catch((e) => ({ error: e.message }));
        const rowLoc = list.getRowByCode(rfiCode, opts);
        diag.playwrightMatches = await rowLoc.count().catch(() => -1);
        diag.playwrightVisible = await rowLoc.first().isVisible().catch(() => false);
        console.log(`  [observe] ROW_DIAG ${rfiCode}: ${JSON.stringify(diag)}`);
        throw firstErr;
      }
    }
  } catch (err) {
    const wrapped = new Error(
      `RFI ${rfiCode} not found in "Pending with me"${context ? ` (${context})` : ''} — ` +
      `the previous actor's action reported success but this RFI never became visible here. ${err.message}`
    );
    wrapped.negativeScenario = 'RFI_NOT_VISIBLE_TO_ACTOR';
    wrapped.rfiCode = rfiCode;
    throw wrapped;
  }
}

module.exports = { openFromPendingWithMe };
