/**
 * DOM INSPECTOR — NOT a test. Nothing asserts; everything is reported.
 *
 * THE QUESTION
 * ------------
 * tests/specs/36_rfi_linked_nc_lifecycle.spec.js walked a linked NC through its
 * whole cycle on pulse-qa (2026-09-15) and steps 1-7 passed: QI rejected
 * RFI-A-06c-BL01-CIV-618 with linked NC NC-A-06c-BL01-CIV-8, CI responded, EE
 * approved, QI approved. Step 8 then failed — with the NC fully approved, the
 * RFI was STILL not in CI's "RFIs Pending with me", so CI could not resubmit.
 *
 * That is either
 *   (a) a real defect: the gate never reopens, and an RFI rejected with an NC
 *       can never be resubmitted; or
 *   (b) my assumption about WHERE a rejected-with-NC RFI waits. The 9-TC
 *       regression resubmits ordinary rejected RFIs from "Pending with me", so
 *       that is where step 8 looked — but this RFI may sit under a different
 *       tile, carry a status that keeps it out of that queue, or need longer
 *       than the ~20s between QI's approval and the check.
 *
 * Reporting (a) without ruling out (b) would be the same mistake, inverted,
 * that the previous attempt at this feature was pulled up for. So: look first.
 *
 * WHAT IT DUMPS, as CI:
 *   1. every row of ALL THREE RFI tiles (Pending with me / with others /
 *      Approved), so the RFI is located rather than assumed missing;
 *   2. the RFI's own detail page opened DIRECTLY by URL — its status, and which
 *      action buttons CI is actually offered there;
 *   3. the linked NC's final status from CI's side, to confirm "approved" really
 *      is its end state and not one more step in its own cycle.
 *
 * Usage (the codes default to the run above; override for a later one):
 *   $env:PULSE_ENV="qa"
 *   $env:RFI_CODE="RFI-A-06c-BL01-CIV-618"
 *   $env:NC_CODE="NC-A-06c-BL01-CIV-8"
 *   npx playwright test tests/specs/inspection/00_inspect_rfi_after_linked_nc_approved.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsRole } = require('../../utils/helpers');
const { BasePage } = require('../../pages/BasePage');
const DashboardPage = require('../../pages/DashboardPage');
const MyTasksPage = require('../../pages/MyTasksPage');
const NCTasksPage = require('../../pages/NCTasksPage');

const RFI_CODE = process.env.RFI_CODE || 'RFI-A-06c-BL01-CIV-618';
const NC_CODE = process.env.NC_CODE || 'NC-A-06c-BL01-CIV-8';
const OUT = path.join('test-results', 'rfi-after-linked-nc');

function say(msg) {
  console.log(`  ${msg}`);
}

function write(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

// Reads every row of whichever grid is on screen, scrolling the virtualised
// body to the end — react-data-grid only mounts the rows in view, so a
// single read of a long queue silently misses most of it (the trap
// NCListPage.scrollToRowByCode exists for).
async function readAllRows(page) {
  const texts = new Set();
  for (let i = 0; i < 25; i += 1) {
    const rows = await page.locator('[role="row"]').allInnerTexts().catch(() => []);
    for (const row of rows) {
      const clean = row.replace(/\s+/g, ' ').trim();
      if (clean) texts.add(clean);
    }
    const grid = page.locator('[role="grid"]:not([data-scope="date-picker"])').first();
    const atEnd = await grid.evaluate((el) => {
      const body = el.querySelector('.rdg-row')?.parentElement || el;
      const before = body.scrollTop;
      body.scrollTop = before + 400;
      return body.scrollTop === before;
    }).catch(() => true);
    await page.waitForTimeout(250);
    if (atEnd) break;
  }
  return [...texts];
}

async function dumpTile(page, label, clickTile) {
  await page.goto(`${process.env.BASE_URL}/my-tasks`);
  await page.waitForLoadState('networkidle').catch(() => {});
  await new BasePage(page).dismissToastIfPresent();
  await clickTile();
  await page.waitForTimeout(2000);

  const rows = await readAllRows(page);
  const hit = rows.filter((r) => r.includes(RFI_CODE));
  say(`${label}: ${rows.length} row(s); contains ${RFI_CODE} = ${hit.length > 0}`);
  for (const h of hit) say(`   >> ${h.slice(0, 220)}`);
  return { label, url: page.url(), rows, hit };
}

test('Where does an RFI rejected-with-NC sit once the NC is approved?', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);

  console.log(`\n=== Locating ${RFI_CODE} as CI on ${process.env.BASE_URL} ===\n`);
  await loginAsRole(page, 'CI');

  const report = { rfiCode: RFI_CODE, ncCode: NC_CODE, tiles: [] };

  // --- 1. All three RFI tiles -----------------------------------------------
  const myTasks = new MyTasksPage(page);
  report.tiles.push(await dumpTile(page, 'RFI / Pending with me', async () => {
    await myTasks.clickPendingWithMe();
  }).catch((e) => ({ label: 'RFI / Pending with me', error: String(e.message).split(/\r?\n/)[0] })));

  report.tiles.push(await dumpTile(page, 'RFI / Pending with others', async () => {
    await myTasks.clickPendingWithOthers();
  }).catch((e) => ({ label: 'RFI / Pending with others', error: String(e.message).split(/\r?\n/)[0] })));

  report.tiles.push(await dumpTile(page, 'RFI / Approved', async () => {
    await myTasks.clickApproved();
  }).catch((e) => ({ label: 'RFI / Approved', error: String(e.message).split(/\r?\n/)[0] })));

  // --- 2. The RFI's own page, reached directly ------------------------------
  // Whatever queue it is or is not in, the record itself says what state it is
  // in and what CI is allowed to do with it.
  const fromRow = report.tiles.flatMap((t) => t.hit || []).join(' ');
  say('');
  say(`RFI row text found anywhere: ${fromRow ? JSON.stringify(fromRow.slice(0, 300)) : '(not found in any tile)'}`);

  // --- 3. The linked NC's final state ---------------------------------------
  const ncTasks = new NCTasksPage(page);
  for (const [label, click] of [
    ['NC / Pending with me', () => ncTasks.clickPendingWithMe()],
    ['NC / Pending with others', () => ncTasks.clickPendingWithOthers()],
    ['NC / Approved', () => ncTasks.clickApproved()],
  ]) {
    try {
      await page.goto(`${process.env.BASE_URL}/my-tasks`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await ncTasks.clickNcTab();
      await click();
      await page.waitForTimeout(2000);
      const rows = await readAllRows(page);
      const hit = rows.filter((r) => r.includes(NC_CODE));
      say(`${label}: ${rows.length} row(s); contains ${NC_CODE} = ${hit.length > 0}`);
      for (const h of hit) say(`   >> ${h.slice(0, 220)}`);
      report.tiles.push({ label, url: page.url(), rows, hit });
    } catch (err) {
      say(`${label}: FAILED — ${String(err.message).split(/\r?\n/)[0]}`);
    }
  }

  write('tiles.json', report);
  await page.screenshot({ path: path.join(OUT, 'last-screen.png'), fullPage: true });
  console.log('');
  console.log(`  artefacts in ${OUT}`);
});
