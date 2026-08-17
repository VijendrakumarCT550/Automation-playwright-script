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
  await list.openRowByCode(ncCode);
}

module.exports = { openFromPendingWithMe };
