/**
 * DOM INSPECTOR — NOT a test. Resolves one contradiction before it is either
 * reported as a defect or worked around as a quirk:
 *
 *   ADMIN'S GRID SAYS   RFI-A-06c-BL07-CIV-35 is "In-Review (EE)" with
 *                       Assigned EE = RAEED39533444 (EE_D).
 *   EE_D'S OWN QUEUE    holds exactly ONE row, and it is a different record
 *                       (CIV-34, the one that has been through a resubmit).
 *
 * Both cannot be true. Either the queue is filtered/paginated in a way this
 * suite has not accounted for, or the "Assigned EE" column and the EE's actual
 * worklist disagree — and THAT would be a real defect worth reporting: a record
 * that names a reviewer who never sees it is stalled with nobody at fault.
 *
 * It is not a load race: the queue read is already polled until the row count
 * stops growing (45_reassign_capability.isInPendingWithMe), and it still
 * reported one row across five passes.
 *
 * WHAT THIS DUMPS, and why each part is needed to tell those two apart:
 *   1. EE_D's three tabs — Pending with me / Pending with others / Approved.
 *      If the pool records are sitting under "Pending with others" for their
 *      own assigned EE, the queue is not broken and our navigation is.
 *   2. The pool records as ADMIN sees them, with the status and assignee
 *      columns read by header name.
 *   3. Each missing record's own DETAIL PAGE, which is the record speaking for
 *      itself rather than a grid column speaking for it.
 *
 * Read-only throughout: opens pages, reads them, submits nothing.
 *
 * Usage:
 *   $env:PULSE_ENV="test"
 *   npx playwright test tests/specs/inspection/00_inspect_ee_queue_gap.spec.js --project=chromium --workers=1
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser } = require('../../utils/helpers');
const { fleetFor } = require('../../utils/reassign-fleet');
const { recordsFor } = require('../../utils/reassign-records');
const ReassignPage = require('../../pages/ReassignPage');

test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const TABS = [
  { label: 'pending-with-me', url: '/my-tasks/rfi/list/pending-with-me' },
  { label: 'pending-with-others', url: '/my-tasks/rfi/list/pending-with-others' },
  { label: 'approved', url: '/my-tasks/rfi/list/approved' },
];

let context, page, fleet, pool;
const report = { baseUrl: process.env.BASE_URL };

async function dumpTabs(who) {
  const out = {};
  for (const tab of TABS) {
    await page.goto(`${process.env.BASE_URL}${tab.url}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const reassign = new ReassignPage(page);
    const hasGrid = await reassign.waitForGrid().then(() => true).catch(() => false);
    if (!hasGrid) {
      console.log(`  ${who} / ${tab.label.padEnd(20)} (no grid)`);
      out[tab.label] = [];
      continue;
    }
    const ids = await reassign.collectAllRowIds();
    const poolHere = ids.filter((id) => pool.includes(id));
    out[tab.label] = ids;
    console.log(`  ${who} / ${tab.label.padEnd(20)} ${String(ids.length).padStart(3)} rows; ` +
      `pool records: ${poolHere.length ? poolHere.join(', ') : '(none)'}`);
  }
  return out;
}

test.beforeAll(async ({ browser }) => {
  fleet = fleetFor();
  pool = Object.values(recordsFor().rfi).map((r) => r.code).filter(Boolean);
  expect(pool.length, 'the RFI pool must exist').toBeGreaterThan(0);

  context = await browser.newContext();
  page = await context.newPage();
  console.log(`\n=== EE queue gap on ${process.env.BASE_URL} ===`);
  console.log(`    pool: ${pool.join(', ')}\n`);
});

test.afterAll(async () => {
  const outDir = path.join('test-results', 'ee-queue-gap');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'ee-queue-gap.json'), JSON.stringify(report, null, 2));
  console.log(`\n  written: ${path.join(outDir, 'ee-queue-gap.json')}`);
  if (context) await context.close();
});

test('1. what EE_D sees across all three tabs', async () => {
  test.setTimeout(20 * 60 * 1000);
  const ee = fleet.EE_D;
  await loginAsFlowUser(page, ee.email, PASSWORD);
  report.eeD = { user: ee.name, email: ee.email, tabs: await dumpTabs(`EE_D(${ee.name})`) };
});

test('2. what the ORIGINAL CI (CI_C) sees — is the record back with the CI?', async () => {
  test.setTimeout(20 * 60 * 1000);
  const ci = fleet.CI_C;
  await loginAsFlowUser(page, ci.email, PASSWORD);
  report.ciC = { user: ci.name, email: ci.email, tabs: await dumpTabs(`CI_C(${ci.name})`) };
});

test('3. what each pool record says about itself, as Admin', async () => {
  test.setTimeout(20 * 60 * 1000);

  await loginAsFlowUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, {
    navigateToMyTasks: false,
  });

  report.records = {};
  for (const [key, rec] of Object.entries(recordsFor().rfi)) {
    if (!rec.code || !rec.id) continue;

    await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rec.id}/view`);
    await page.waitForLoadState('networkidle').catch(() => {});

    // The record speaking for itself: whatever the detail page prints for
    // status/version and the three assignee roles.
    const text = await page.evaluate(() => {
      const wanted = /contractor in-?charge|assigned ee|execution engineer|assigned qi|quality inspector|status|version/i;
      const out = [];
      for (const el of document.querySelectorAll('p, span, div')) {
        if (el.children.length) continue;
        const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
        if (t && t.length < 80 && wanted.test(t)) {
          const sib = el.nextElementSibling;
          out.push(sib ? `${t} => ${(sib.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)}` : t);
        }
      }
      return [...new Set(out)].slice(0, 25);
    });

    report.records[key] = { code: rec.code, id: rec.id, url: page.url(), fields: text };
    console.log(`  ${key.padEnd(16)} ${rec.code}: ${JSON.stringify(text.slice(0, 8))}`);
  }
});

test('4. the verdict', async () => {
  const me = (report.eeD && report.eeD.tabs['pending-with-me']) || [];
  const others = (report.eeD && report.eeD.tabs['pending-with-others']) || [];
  const ciMe = (report.ciC && report.ciC.tabs['pending-with-me']) || [];

  const inEeMe = pool.filter((c) => me.includes(c));
  const inEeOthers = pool.filter((c) => others.includes(c));
  const inCiMe = pool.filter((c) => ciMe.includes(c));

  console.log('\n--- VERDICT ---');
  console.log(`  pool records in EE_D "pending with me"     : ${inEeMe.length ? inEeMe.join(', ') : '(none)'}`);
  console.log(`  pool records in EE_D "pending with others" : ${inEeOthers.length ? inEeOthers.join(', ') : '(none)'}`);
  console.log(`  pool records in CI_C "pending with me"     : ${inCiMe.length ? inCiMe.join(', ') : '(none)'}`);

  if (inCiMe.length) {
    console.log('  => They are sitting with the CI, not the EE. The records were never');
    console.log('     submitted onward, or came back — our assumption about their state');
    console.log('     was wrong, and there is nothing to report to developers.');
  } else if (inEeOthers.length) {
    console.log('  => They are under EE_D\'s "pending with OTHERS" tab, i.e. waiting on');
    console.log('     somebody else despite the grid naming EE_D. Read that tab instead.');
  } else if (!inEeMe.length) {
    console.log('  => They appear in NO tab of their own assigned EE while Admin shows');
    console.log('     them as In-Review (EE) with that EE. THAT is reportable: a record');
    console.log('     naming a reviewer who never sees it is stalled with nobody at fault.');
  }
});
