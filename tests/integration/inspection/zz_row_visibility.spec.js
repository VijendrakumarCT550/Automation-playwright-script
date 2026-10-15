const { test } = require('@playwright/test');
const { loginAsFlowUser } = require('../../utils/helpers');
const DashboardPage = require('../../pages/DashboardPage');
const MyTasksPage = require('../../pages/MyTasksPage');
const RFIListPage = require('../../pages/RFIListPage');
const { profileForSpec, requireAvailable, recordedPulse } = require('../drs-profile');

// READ-ONLY DIAGNOSTIC (2026-09-26). In the DRS integration RFI matrix, rows
// that WERE in an actor's "Pending with me" grid (saved HTML proves it) still
// failed RFIListPage.openRowByCode's `row.waitFor({state:'visible'})`, even
// after a reload. Every such row had its column-1 cell aria-selected="true".
// This opens the list as the stuck actor and prints exactly what the lookup
// sees for each code — no clicks on any row, nothing written.
//
// DIAG_ROLE=EE|QI (default EE), DIAG_CODES=comma list of full RFI codes.

const profile = profileForSpec();
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

test('row visibility diagnostic', async ({ browser }) => {
  requireAvailable(profile);
  test.setTimeout(15 * 60 * 1000);
  const role = process.env.DIAG_ROLE || 'EE';
  const codes = String(process.env.DIAG_CODES || '').split(',').map((s) => s.trim()).filter(Boolean);
  const user = (recordedPulse(profile).users || {})[role];
  const context = await browser.newContext();
  const page = await context.newPage();
  await loginAsFlowUser(page, user.email, PASSWORD);
  await new DashboardPage(page).goToMyTasks();
  const myTasks = new MyTasksPage(page);
  await myTasks.pendingWithMeTile.waitFor({ state: 'visible', timeout: 60000 });
  await myTasks.clickPendingWithMe();
  const list = new RFIListPage(page);
  await list.waitForGrid();
  await page.waitForTimeout(3000);

  console.log(`\n=== ${role} ${user.name} — Pending with me ===`);
  console.log('  grid visible:', await list.grid.isVisible(), '| rows:', await list.grid.locator('.rdg-row[role="row"]').count());
  for (const code of codes) {
    const row = list.getRowByCode(code);
    const count = await row.count();
    const info = count ? await row.first().evaluate((el) => {
      const cs = getComputedStyle(el); const r = el.getBoundingClientRect();
      const cell = el.querySelector('[aria-colindex="1"]');
      return {
        display: cs.display, visibility: cs.visibility, opacity: cs.opacity,
        box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        cellSelected: cell && cell.getAttribute('aria-selected'),
        cellText: cell && JSON.stringify(cell.textContent),
        rowIndex: el.getAttribute('aria-rowindex'),
      };
    }) : null;
    const visible = count ? await row.first().isVisible() : false;
    console.log(`  ${code}: matches=${count} visible=${visible} ${JSON.stringify(info)}`);
  }
  await page.screenshot({ path: 'test-results/zz-row-visibility.png', fullPage: true });
  await context.close();
});
