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
async function openFromPendingWithMe(page, rfiCode) {
  await new DashboardPage(page).goToMyTasks();

  const myTasks = new MyTasksPage(page);
  await myTasks.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
  await myTasks.clickPendingWithMe();

  const list = new RFIListPage(page);
  await list.waitForGrid();
  await list.openRowByCode(rfiCode);
}

module.exports = { openFromPendingWithMe };
