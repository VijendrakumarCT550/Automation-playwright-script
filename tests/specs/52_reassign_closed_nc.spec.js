const { test, expect } = require('@playwright/test');
const { fleetFor } = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const ReassignPage = require('../pages/ReassignPage');
const NCListPage = require('../pages/NCListPage');
const NCResponsePage = require('../pages/NCResponsePage');
const NCReviewPage = require('../pages/NCReviewPage');

// ===========================================================================
// FAMILY B, row B2 — a CLOSED NC must not be reassignable.
// (docs/reassignment-scenarios.md, Family B; "still open on the NC side")
// ===========================================================================
// B1 (46) proved an approved RFI exposes no reassign control. The NC side had no
// closed NC to look at — the pool held only open ones — so this spec CLOSES one
// first, through the full NC cycle the app owner's flow defines:
//
//   QI raised it (43_reassign_nc_records_setup, B_CLOSED_NC)
//   -> CI responds (root cause + corrective action)
//   -> EE approves -> QI approves  = closed
//
// and then asks the question on THAT record's own row, not just on the page:
// its row must carry no reassign control, while the same row DOES carry its
// view control — so "absent" can never mean "the row did not render".
//
// WHY IT MATTERS: reassigning a closed NC would re-open routing on a
// non-conformance everyone has signed off, handing a finished record to someone
// who then sees work that no longer exists.
//
// A SEPARATE NC FILE with its own helpers and routes, per the standing rule that
// NC files never share code with RFI ones. RE-RUNNABLE: each stage of the cycle
// is skipped when the NC is already past it.
//
// Usage (after 43 has raised B_CLOSED_NC):
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/52_reassign_closed_nc.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const NC_PENDING_ME = '/my-tasks/nc/list/pending-with-me';
const NC_PENDING_OTHERS = '/my-tasks/nc/list/pending-with-others';
const NC_APPROVED = '/my-tasks/nc/list/approved';
const TYPES = { CI: 'Contractor Incharge', EE: 'Execution Engineer', QI: 'Quality Inspector' };

let sessions, fleet, record;
const findings = [];
function note(msg) { findings.push(msg); console.log(`  ${msg}`); }

// Straight to the NC route, proven by the "NC ID" header — the tab click has
// silently produced RFI rows read as NC rows three times in this project.
async function gotoNcList(page, url, { required = true } = {}) {
  await page.goto(`${process.env.BASE_URL}${url}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const onNcGrid = await page.getByRole('columnheader', { name: /NC ID/i }).first()
    .waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false);
  if (required) {
    expect(onNcGrid, `The NC grid never rendered at ${url} (no "NC ID" header)`).toBeTruthy();
  }
  return onNcGrid;
}

async function ncListIds(page, url) {
  if (!(await gotoNcList(page, url, { required: false }))) return [];
  const grid = new ReassignPage(page);
  const ok = await grid.waitForGrid().then(() => true).catch(() => false);
  if (!ok) return [];
  await grid.waitForGridToSettle().catch(() => {});
  return grid.collectAllRowIds();
}

// Opens the NC from the CURRENT user's "Pending with me" BY ROUTE and the row's
// own eye icon. NOT nc-nav's My Tasks -> NC tab -> "Pending with me" tile path:
// on 2026-09-27 that tile never rendered for the QI step here (30s timeout),
// the same tab-path fragility 48's header records three times. The route is
// proven by the "NC ID" header, and openRowByCode is the eye-icon click nc-nav
// itself ends in.
async function openFromNcQueue(page, code) {
  await gotoNcList(page, NC_PENDING_ME);
  await new NCListPage(page).openRowByCode(code);
  await page.waitForLoadState('networkidle').catch(() => {});
}

async function ncQueueHas(member, code) {
  const page = await sessions.actAs(member.email, PASSWORD);
  return (await ncListIds(page, NC_PENDING_ME)).includes(code);
}

// The NC's current holder of each type, read from Admin's Reassign modal, and
// resolved to a fleet member we can log in as.
async function readHolders(code) {
  const page = await sessions.actAsAdmin();
  await gotoNcList(page, NC_PENDING_OTHERS);
  const grid = new ReassignPage(page);
  await grid.waitForGrid();
  const holders = {};
  for (const [key, type] of Object.entries(TYPES)) {
    const row = await grid.scrollToRowById(code);
    await grid.openReassign(row);
    await grid.selectAssigneeType(type);
    const name = ((await grid.getCurrentAssigneeName()) || '').trim();
    await grid.closeButton.click().catch(() => {});
    const member = Object.values(fleet).find((m) => m && m.name === name);
    expect(
      member,
      `B2: ${code}'s ${type} is "${name}", who is not a reassignment-fleet member, so this spec ` +
      `cannot log in as them to drive the NC cycle.`
    ).toBeTruthy();
    holders[key] = member;
  }
  return holders;
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  record = claimRecord('nc', 'B_CLOSED_NC');
  sessions = createSessionFactory(browser, { log: () => {} });
  console.log(`\n=== Family B2 — a closed NC, on ${process.env.BASE_URL} ===\n    NC: ${record.code}\n`);
});

test.afterAll(async () => {
  console.log('\n--- B2 findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- close it: the full NC cycle ---------------------------------------------
test('B2 setup: the NC is closed through CI response -> EE approval -> QI approval', async () => {
  test.setTimeout(45 * 60 * 1000);

  const adminPage = await sessions.actAsAdmin();
  if ((await ncListIds(adminPage, NC_APPROVED)).includes(record.code)) {
    note(`B2: ${record.code} is already closed — prepared by an earlier run`);
    return;
  }

  const holders = await readHolders(record.code);
  note(`B2: ${record.code} holders — CI ${holders.CI.name}, EE ${holders.EE.name}, QI ${holders.QI.name}`);

  // CI responds (skipped if the NC is already past the CI).
  if (await ncQueueHas(holders.CI, record.code)) {
    const page = sessions.current();
    await openFromNcQueue(page, record.code);
    const response = new NCResponsePage(page);
    await response.fillResponse({
      rootCause: 'Family B2 — automated root cause',
      correctiveActions: 'Family B2 — automated corrective actions',
    });
    await response.submitResponse();
    note(`B2: CI ${holders.CI.name} responded`);
  }

  // EE, then QI, approve — each only if the NC is actually with them.
  for (const key of ['EE', 'QI']) {
    if (await ncQueueHas(holders[key], record.code)) {
      const page = sessions.current();
      await openFromNcQueue(page, record.code);
      await new NCReviewPage(page).approve();
      note(`B2: ${key} ${holders[key].name} approved`);
    }
  }

  const page = await sessions.actAsAdmin();
  const approvedIds = await ncListIds(page, NC_APPROVED);
  expect(
    approvedIds.includes(record.code),
    `B2: ${record.code} is not in the Approved NC list after the full cycle ` +
    `(${approvedIds.length} rows) — it did not close, so B2 cannot be judged.`
  ).toBeTruthy();
  note(`B2: ${record.code} is closed`);
});

// --- the question -------------------------------------------------------------
test('B2: a CLOSED NC exposes no reassign control on its own row', async () => {
  test.setTimeout(20 * 60 * 1000);

  const page = await sessions.actAsAdmin();
  await gotoNcList(page, NC_APPROVED);
  const grid = new ReassignPage(page);
  await grid.waitForGrid();
  const row = await grid.scrollToRowById(record.code);

  // The Actions column sits at the far right of a horizontally virtualised
  // grid — scroll it into view (as openReassign does) before counting, so an
  // unmounted cell cannot pass for an absent control.
  const rowIndex = await row.getAttribute('aria-rowindex');
  const actions = grid.getRowByAriaIndex(rowIndex).locator('[role="gridcell"]').last();
  let view = 0;
  let replace = 0;
  for (let i = 0; i < 8; i += 1) {
    await grid.grid.evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await page.waitForTimeout(400);
    view = await actions.locator('button:has(svg.lucide-eye)').count().catch(() => 0);
    replace = await actions.locator('button:has(svg.lucide-replace)').count().catch(() => 0);
    if (view > 0) break;
  }
  note(`B2: ${record.code}'s row in the Approved list — view controls=${view}, reassign controls=${replace}`);

  expect(
    view,
    `B2: ${record.code}'s Actions cell shows no view control either, so the row's actions never ` +
    `rendered and an absent reassign control would prove nothing.`
  ).toBeGreaterThan(0);
  expect(
    replace,
    `B2: the CLOSED NC ${record.code} still exposes ${replace} reassign control(s). A closed ` +
    `non-conformance is finished work — reassigning it would re-open routing on something ` +
    `everyone has signed off.`
  ).toBe(0);
  note(`B2: PASS — ${record.code} is closed and not reassignable`);
});
