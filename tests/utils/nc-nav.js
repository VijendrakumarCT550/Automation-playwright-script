const { BasePage } = require('../pages/BasePage');
const DashboardPage = require('../pages/DashboardPage');
const NCTasksPage   = require('../pages/NCTasksPage');
const NCListPage    = require('../pages/NCListPage');

// Opens a specific NC by clicking through the UI — nav "My Tasks" -> NC tab
// -> "Pending with me" tile -> find the row by its visible code -> click
// its Actions column's eye icon — instead of a direct page.goto to its
// URL. Mirrors tests/utils/rfi-nav.js's openFromPendingWithMe exactly, but
// kept as a fully separate file/module (not shared/imported), per explicit
// user instruction to keep NC 100% isolated from RFI's files.
//
// Two structural differences from RFI's version:
//  1. An explicit NC-tab click is always required first — My Tasks
//     defaults to the RFI tab, so without this the "Pending with me" tile
//     clicked next would be RFI's, not NC's (per explicit user description
//     of this app's actual behavior).
//  2. A leftover toast from an earlier action (e.g. CI's previous TC's
//     resubmit) can block clicks anywhere on the page, including the "My
//     Tasks" nav link and the NC tab itself — confirmed live via
//     Playwright's own actionability log ("<toast> ... intercepts pointer
//     events", one case escalating to the whole <html> once its backdrop
//     had grown). Dismissed defensively before EVERY navigation attempt
//     here, not just once — a toast can appear again between steps just
//     as easily as before them.
async function openFromPendingWithMe(page, ncCode) {
  const base = new BasePage(page);
  await base.dismissToastIfPresent();
  await new DashboardPage(page).goToMyTasks();

  await base.dismissToastIfPresent();
  const ncTasks = new NCTasksPage(page);
  await ncTasks.clickNcTab();
  await ncTasks.clickPendingWithMe();

  const list = new NCListPage(page);
  await list.waitForGrid();
  try {
    await list.openRowByCode(ncCode);
  } catch (firstErr) {
    // OBSERVED RETRY (2026-09-26, DRS integration NC matrix on pulse-uat): all
    // three "next actor's row lookup timed out" failures there had the NC
    // PRESENT in the saved grid, exact code in column 1 — the lookup ran before
    // the freshly-updated list was usable. One reload + re-navigate, logged
    // either way; a record that is still not there throws as before.
    // (NC's own copy — deliberately not shared with rfi-nav.js.)
    // PATIENT, AND MEASURED (2026-09-26): keep reloading (every ~20 s, up to
    // ~90 s) and log how long the NC took — a slow list is a measurement, not
    // a missing NC. NC's own copy of the RFI retry.
    console.log(`  [observe] ROW_LATE ${ncCode}: not usable on first look — retrying with reloads`);
    const started = Date.now();
    let opened = false;
    for (let attempt = 1; attempt <= 4 && !opened; attempt++) {
      await page.reload({ waitUntil: 'networkidle' }).catch(() => {});
      await base.dismissToastIfPresent();
      await new DashboardPage(page).goToMyTasks();
      await base.dismissToastIfPresent();
      await ncTasks.clickNcTab();
      await ncTasks.clickPendingWithMe();
      await list.waitForGrid();
      opened = await list.openRowByCode(ncCode).then(() => true).catch(() => false);
    }
    try {
      if (!opened) throw new Error('still not openable');
      console.log(`  [observe] ROW_LATE ${ncCode}: found after ${Math.round((Date.now() - started) / 1000)}s of retries (timing, not a missing record)`);
    } catch {
      console.log(`  [observe] ROW_MISSING ${ncCode}: still not usable after a reload`);
      // WHAT THE LOOKUP SAW — grid scroll (openRowByCode scrolls right to the
      // Actions column), the row's cell boxes, selection and eye icon. NC's own
      // copy of the RFI diagnostic, per the NC/RFI separation rule.
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
      }, ncCode).catch((e) => ({ error: e.message }));
      const rowLoc = list.getRowByCode(ncCode);
      diag.playwrightMatches = await rowLoc.count().catch(() => -1);
      diag.playwrightVisible = await rowLoc.first().isVisible().catch(() => false);
      console.log(`  [observe] ROW_DIAG ${ncCode}: ${JSON.stringify(diag)}`);
      throw firstErr;
    }
  }
}

module.exports = { openFromPendingWithMe };
