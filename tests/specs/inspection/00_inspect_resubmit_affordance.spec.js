/**
 * DOM INSPECTOR — NOT a test. Answers one question, before anything is
 * reported to developers:
 *
 *   WHEN A REJECTED RFI IS OPENED BY ITS CI, IS THERE A RESUBMIT AFFORDANCE?
 *   And does the answer depend on WHO the CI is, or on HOW the page was reached?
 *
 * WHY THIS EXISTS. 45_reassign_capability.spec.js (C2, pulse-test 2026-09-20)
 * found that `CI_A` — a CI with NO WAM, to whom a rejected RFI had just been
 * reassigned — could SEE the record (it was in "Pending with me", and /view
 * rendered the full checklist, work section R01-S03 and all 16 questions) but
 * the page offered no Resubmit/Edit button at all. Its only action was "Close".
 *
 * If that is the app, it is the STRANDING BUG this whole family exists to find:
 * the record has left its previous CI and the new one cannot act on it.
 *
 * BUT TWO THINGS DIFFERED FROM THE WORKING FLOW AT ONCE, and only one of them
 * is the app:
 *
 *   1. WHO — an unmapped CI rather than the mapped one.
 *   2. HOW — that spec navigated to /view BY URL, whereas rfi-flow-turns'
 *      resubmitRfi always arrives through UI clicks (My Tasks -> Pending with
 *      me -> the row's eye icon). This repo has a standing rule that RFI
 *      navigation goes through the UI (docs: project_rfi_ui_navigation), and a
 *      page reached by URL is not guaranteed to carry the same state.
 *
 * A finding that confounds two variables is not a finding. So this file holds
 * the navigation constant — UI clicks for every case — and varies only the
 * user:
 *
 *   A. `CI_A`  on the already-reassigned record: the suspect case.
 *   B. `CI_C`  on a record rejected but NEVER reassigned: the CONTROL. This is
 *              an ordinary CI, mapped exactly where the record lives, doing the
 *              most ordinary thing in the product.
 *
 * If B shows a Resubmit affordance and A does not, the difference is the app
 * and the bug is real. If NEITHER does, the affordance is not where this probe
 * is looking and nothing should be reported yet.
 *
 * Read-only in the sense that matters: it opens pages and dumps what it sees.
 * It does reject record B first, because a CI step only exists on a rejected
 * RFI, and that record is already earmarked to be rejected by C3.
 *
 * Usage:
 *   $env:PULSE_ENV="test"
 *   npx playwright test tests/specs/inspection/00_inspect_resubmit_affordance.spec.js --project=chromium --workers=1
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser } = require('../../utils/helpers');
const { fleetFor } = require('../../utils/reassign-fleet');
const { claimRecord } = require('../../utils/reassign-records');
const { openFromPendingWithMe } = require('../../utils/rfi-nav');
const ReassignPage = require('../../pages/ReassignPage');
const RFIReviewPage = require('../../pages/RFIReviewPage');

test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const RFI_PENDING_ME = '/my-tasks/rfi/list/pending-with-me';

let context, page, fleet;
const report = { baseUrl: process.env.BASE_URL, cases: {} };

function note(msg) {
  console.log(`  ${msg}`);
}

// Everything clickable on the page, with whatever name it exposes. Icon-only
// buttons are reported as "(icon only)" with their title/aria attributes, since
// the C2 failure landed on a page whose actions were almost all unnamed icons —
// a Resubmit control could be sitting there unnamed.
async function dumpActions(label) {
  const actions = await page.evaluate(() => {
    const out = [];
    const nodes = document.querySelectorAll('button, a[role="button"], [role="button"]');
    for (const el of nodes) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      out.push({
        text: (el.innerText || '').replace(/\s+/g, ' ').trim() || '(icon only)',
        ariaLabel: el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        testid: el.getAttribute('data-testid'),
        disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      });
    }
    return out;
  });

  const named = actions.filter((a) => a.text !== '(icon only)' || a.ariaLabel || a.title);
  note(`${label}: url=${page.url()}`);
  note(`${label}: ${actions.length} action(s); named: ` +
    JSON.stringify(named.map((a) => a.ariaLabel || a.title || a.text).slice(0, 20)));

  const resubmitish = actions.filter((a) =>
    /resubmit|re-submit|edit|submit/i.test([a.text, a.ariaLabel, a.title, a.testid].join(' ')));
  note(`${label}: resubmit-ish controls = ${resubmitish.length} ${JSON.stringify(resubmitish)}`);

  return { url: page.url(), actions, resubmitish };
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();
  console.log(`\n=== Resubmit affordance on ${process.env.BASE_URL} ===\n`);
});

test.afterAll(async () => {
  const outDir = path.join('test-results', 'resubmit-affordance');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'affordance.json'), JSON.stringify(report, null, 2));
  console.log(`\n  written: ${path.join(outDir, 'affordance.json')}`);
  if (context) await context.close();
});

// --- CASE A: the suspect — unmapped CI, record already reassigned to them ---
test('A. the REASSIGNED unmapped CI (CI_A), reached through the UI', async () => {
  test.setTimeout(20 * 60 * 1000);

  const record = claimRecord('rfi', 'C_CI_UNMAPPED');   // CIV-34, rejected + reassigned by C2
  const ci = fleet.CI_A;
  await loginAsFlowUser(page, ci.email, PASSWORD);

  try {
    await openFromPendingWithMe(page, record.code, 'CI_A / resubmit affordance probe');
  } catch (err) {
    note(`A: could not open ${record.code} through the UI — ${String(err.message).split('\n')[0]}`);
    report.cases.A = { user: 'CI_A', record: record.code, opened: false, error: String(err.message).split('\n')[0] };
    return;
  }

  report.cases.A = {
    user: 'CI_A', userName: ci.name, mapped: false, record: record.code,
    opened: true, ...(await dumpActions('A (CI_A, reassigned, unmapped)')),
  };
});

// --- CASE B: the control — mapped CI, record never reassigned ---------------
test('B. CONTROL: the ORIGINAL mapped CI (CI_C) on a rejected record, same path', async () => {
  test.setTimeout(20 * 60 * 1000);

  const record = claimRecord('rfi', 'C_CI_FOREIGN');    // CIV-35, still with CI_C
  const ee = fleet.EE_D;
  const ci = fleet.CI_C;

  // Reject it so a CI step exists. This record is earmarked for C3, which
  // rejects it anyway — doing it here costs nothing extra.
  await loginAsFlowUser(page, ee.email, PASSWORD);
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_ME}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  const hasGrid = await reassign.waitForGrid().then(() => true).catch(() => false);
  const present = hasGrid && (await reassign.collectAllRowIds()).includes(record.code);

  if (present) {
    await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${record.id}/view`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await new RFIReviewPage(page).rejectFromFirstPage('Affordance control — rejected to create a CI step');
    note(`B: EE_D rejected ${record.code}`);
  } else {
    note(`B: ${record.code} was not pending with EE_D — assuming it is already rejected`);
  }

  await loginAsFlowUser(page, ci.email, PASSWORD);
  try {
    await openFromPendingWithMe(page, record.code, 'CI_C / control');
  } catch (err) {
    note(`B: the MAPPED CI could not open ${record.code} either — ${String(err.message).split('\n')[0]}`);
    report.cases.B = { user: 'CI_C', record: record.code, opened: false, error: String(err.message).split('\n')[0] };
    return;
  }

  report.cases.B = {
    user: 'CI_C', userName: ci.name, mapped: true, record: record.code,
    opened: true, ...(await dumpActions('B (CI_C, original, mapped) CONTROL')),
  };
});

test('C. the verdict', async () => {
  const a = report.cases.A;
  const b = report.cases.B;
  const aHas = !!(a && a.resubmitish && a.resubmitish.length);
  const bHas = !!(b && b.resubmitish && b.resubmitish.length);

  console.log('\n--- VERDICT ---');
  console.log(`  A  unmapped reassigned CI_A : opened=${!!(a && a.opened)}  resubmit affordance=${aHas}`);
  console.log(`  B  mapped original CI_C     : opened=${!!(b && b.opened)}  resubmit affordance=${bHas}`);

  if (bHas && !aHas) {
    console.log('  => THE DIFFERENCE IS THE USER. A mapped CI is offered the control and the');
    console.log('     reassigned unmapped CI is not: the record is STRANDED. Report this.');
  } else if (!bHas && !aHas) {
    console.log('  => NEITHER is offered it, INCLUDING an ordinary mapped CI on an ordinary');
    console.log('     rejected RFI. That is our probe looking in the wrong place, not a');
    console.log('     reassignment bug. Do not report it — find the real affordance first.');
  } else if (aHas) {
    console.log('  => The reassigned unmapped CI IS offered the control. C2 failed for a');
    console.log('     navigation reason (it reached /view by URL), not an app reason.');
  }
});
