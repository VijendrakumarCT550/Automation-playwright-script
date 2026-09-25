/**
 * DOM INSPECTOR — NOT a test. Answers one operational question:
 *
 *   WHERE IS EACH RECORD OF THE REASSIGNMENT POOL RIGHT NOW, AND WHO HOLDS IT?
 *
 * WHY. Family C's C3 stopped because RFI-A-06c-BL07-CIV-35 was in neither the
 * candidate's nor the EE's queue, and EE_D's "Pending with me" turned out to
 * hold exactly ONE row (CIV-34, the record C2 had just resubmitted). So four
 * pool records are somewhere this spec did not look — and guessing where is
 * precisely the habit that has cost this work two false findings already.
 *
 * Reads, as Admin, every RFI list a pool record could be sitting in, and
 * reports each record's status and its Contractor Incharge / Assigned EE /
 * Assigned QI as the grid shows them. Columns are resolved BY HEADER TEXT, not
 * by index — ReassignPage.resolveColumnIndexByHeader exists because a
 * hardcoded index once read the Work Area column while claiming to read an
 * assignee.
 *
 * Read-only: it opens no record and submits nothing.
 *
 * Usage:
 *   $env:PULSE_ENV="test"
 *   npx playwright test tests/specs/inspection/00_inspect_pool_state.spec.js --project=chromium --workers=1
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser } = require('../../utils/helpers');
const { recordsFor } = require('../../utils/reassign-records');
const ReassignPage = require('../../pages/ReassignPage');

// NO "pending-with-me" HERE. That list belongs to the roles that HOLD a record
// — CI, EE, QI — and Admin has none; asking for it as Admin just renders an
// empty screen, which is a misleading thing to print next to real findings
// (app owner, 2026-09-20). Admin's view of who holds what is
// "pending-with-others", whose grid carries the Contractor Incharge /
// Assigned EE / Assigned QI columns this probe is actually after.
const LISTS = [
  { label: 'pending-with-others', url: '/my-tasks/rfi/list/pending-with-others' },
  { label: 'approved', url: '/my-tasks/rfi/list/approved' },
  { label: 'rejected', url: '/my-tasks/rfi/list/rejected' },
];

test('inspect: where each reassignment-pool record currently sits', async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);

  const pool = recordsFor().rfi;
  const codes = Object.values(pool).map((r) => r.code).filter(Boolean);
  expect(codes.length, 'the RFI pool must have been built first').toBeGreaterThan(0);

  const context = await browser.newContext();
  const page = await context.newPage();
  const report = { baseUrl: process.env.BASE_URL, pool: {}, lists: {} };

  await loginAsFlowUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, {
    navigateToMyTasks: false,
  });

  console.log(`\n=== Pool state on ${process.env.BASE_URL} (as Admin) ===`);
  console.log(`    looking for: ${codes.join(', ')}\n`);

  for (const list of LISTS) {
    await page.goto(`${process.env.BASE_URL}${list.url}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const reassign = new ReassignPage(page);
    const hasGrid = await reassign.waitForGrid().then(() => true).catch(() => false);
    if (!hasGrid) {
      console.log(`  ${list.label.padEnd(22)} (no grid — empty)`);
      report.lists[list.label] = [];
      continue;
    }

    const ids = await reassign.collectAllRowIds();
    const mine = ids.filter((id) => codes.includes(id));
    report.lists[list.label] = ids;
    console.log(`  ${list.label.padEnd(22)} ${String(ids.length).padStart(3)} rows; pool records here: ` +
      `${mine.length ? mine.join(', ') : '(none)'}`);

    // For each pool record found here, read the row's own columns.
    for (const code of mine) {
      // Fresh navigation per record. The previous read leaves the grid
      // scrolled, and a lookup that starts mid-list can miss a row it has
      // already printed — three of seven did exactly that on the first pass.
      await page.goto(`${process.env.BASE_URL}${list.url}`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await reassign.waitForGrid().catch(() => {});

      const row = await reassign.scrollToRowById(code).catch((err) => {
        console.log(`      ${code}: could not locate the row — ${String(err.message).split(String.fromCharCode(10))[0]}`);
        return null;
      });
      if (!row) continue;

      const cells = await row.locator('[role="gridcell"]').allInnerTexts().catch(() => []);
      report.pool[code] = {
        list: list.label,
        cells: cells.map((c) => c.replace(/\s+/g, ' ').trim()),
      };
      console.log(`      ${code}: ${JSON.stringify(report.pool[code].cells.slice(0, 9))}`);
    }
  }

  const missing = codes.filter((c) => !report.pool[c]);
  console.log(`\n  accounted for: ${codes.length - missing.length}/${codes.length}`);
  if (missing.length) console.log(`  NOT FOUND IN ANY LIST: ${missing.join(', ')}`);

  const outDir = path.join('test-results', 'pool-state');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'pool-state.json'), JSON.stringify(report, null, 2));
  console.log(`\n  written: ${path.join(outDir, 'pool-state.json')}`);

  await context.close();
});
