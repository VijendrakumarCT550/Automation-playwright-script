/**
 * DOM INSPECTOR — NOT a test. Answers one operational question:
 *
 *   ON THIS DEPLOYMENT, IS THERE A PENDING RFI IN A-06c FOR FAMILY E TO READ?
 *
 * 41_reassign_eligibility.spec.js needs one (read-only — it opens the Reassign
 * modal, reads the "Assign to" list and closes without submitting). On
 * pulse-test its step 0 reported none, listing ten S05b codes.
 *
 * THAT REPORT CANNOT BE TRUSTED AS-IS, and this file exists to settle it before
 * anything is created. `ReassignPage.listRowIds` reads only the rows CURRENTLY
 * MOUNTED in the react-data-grid — it never scrolls vertically — so it sees the
 * top of the list and nothing else. A row further down is invisible to it, and
 * "absent from the DOM" then reads as "absent from the deployment". That is the
 * same family of silently-wrong reading already recorded in
 * docs/automation-coverage-and-gaps.md §2b (scrollToRowByCode jumping to the
 * grid's bottom, so a mid-list row never mounts).
 *
 * So: scroll the whole list, collect every row id, and group by work location.
 * Read-only — it opens nothing and submits nothing.
 *
 * Usage:
 *   $env:PULSE_ENV="test"
 *   npx playwright test tests/specs/inspection/00_inspect_pending_rfi_ground.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser } = require('../../utils/helpers');
const ReassignPage = require('../../pages/ReassignPage');

const LISTS = [
  { label: 'RFI pending with others', url: '/my-tasks/rfi/list/pending-with-others' },
  { label: 'RFI pending with me', url: '/my-tasks/rfi/list/pending-with-me' },
];

test('inspect: which work locations have pending RFIs on this deployment', async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);

  const context = await browser.newContext();
  const page = await context.newPage();
  const report = { baseUrl: process.env.BASE_URL, lists: {} };

  await loginAsFlowUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, {
    navigateToMyTasks: false,
  });

  for (const list of LISTS) {
    console.log(`\n=== ${list.label} — ${list.url} ===`);
    await page.goto(`${process.env.BASE_URL}${list.url}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const reassign = new ReassignPage(page);
    const seen = new Set();

    try {
      await reassign.waitForGrid();
    } catch {
      console.log('  no grid rendered — list is empty or the route differs here');
      report.lists[list.label] = { rows: [], note: 'no grid' };
      continue;
    }

    // Step DOWN the grid rather than jumping to the bottom: only rows near the
    // current scrollTop are mounted, so a jump would skip everything between.
    let prevTop = -1;
    for (let pass = 0; pass < 60; pass++) {
      for (const id of await reassign.listRowIds(60)) seen.add(id);

      const top = await reassign.grid.evaluate((el) => {
        const step = Math.max(el.clientHeight - 60, 120);
        el.scrollTop = el.scrollTop + step;
        return el.scrollTop;
      });
      await page.waitForTimeout(350);
      if (top === prevTop) break;   // hit the bottom
      prevTop = top;
    }
    for (const id of await reassign.listRowIds(60)) seen.add(id);

    const ids = [...seen];
    const byLocation = {};
    for (const id of ids) {
      // Codes are shaped RFI-<workLocation>-<workArea>-<PKG>-<n>.
      const wl = (id.match(/^RFI-([^-]+)-/) || [])[1] || '(unparsed)';
      (byLocation[wl] = byLocation[wl] || []).push(id);
    }

    console.log(`  rows collected: ${ids.length}`);
    for (const [wl, codes] of Object.entries(byLocation).sort()) {
      console.log(`    ${wl.padEnd(10)} ${String(codes.length).padStart(3)}  e.g. ${codes.slice(0, 3).join(', ')}`);
    }
    report.lists[list.label] = { rows: ids, byLocation };
  }

  const outDir = path.join('test-results', 'pending-rfi-ground');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'pending-rfi-by-location.json'), JSON.stringify(report, null, 2));
  console.log(`\n  written: ${path.join(outDir, 'pending-rfi-by-location.json')}`);

  await context.close();
});
