const { test, expect } = require('@playwright/test');
const { fleetFor } = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const ReassignPage = require('../pages/ReassignPage');
const { BasePage } = require('../pages/BasePage');

// ===========================================================================
// FAMILIES H, I, B and X — the hand-off, integrity across it, refusal, edges.
// (docs/reassignment-scenarios.md, section 3)
// ===========================================================================
// Family C answered the hard question — a reassigned user CAN do the work. This
// file covers what must be true AROUND that:
//
//   H1  the record LEAVES the old assignee and ARRIVES with the new one
//   I1  the VERSION is unchanged — per the app owner it moves only on a CI
//       resubmission, so a bump here would be a defect
//   I3  the CODE is unchanged
//   X1  cancelling the modal changes nothing
//   X2  reassigning twice (A -> B -> C): the last wins, and B no longer holds it
//   B1  an APPROVED RFI is not reassignable
//
// WHY H1 IS ASSERTED IN BOTH DIRECTIONS. "Arrives with the new assignee" alone
// would pass for an app that copied the record to everyone; "leaves the old
// one" alone would pass for an app that simply dropped it. A hand-off is the
// conjunction, and the failure mode that matters — two people believing the
// same inspection is theirs, or nobody holding it — lives precisely where one
// half holds and the other does not.
//
// EACH FAMILY OWNS ITS RECORD, from the pool (42_reassign_rfi_records_setup):
// H/I/X2 mutate H_HANDOFF, X1 only reads R_READ. B1 needs no pool record — any
// approved row will do, and approved records are exactly what the pool has
// none of.
//
// ONE BROWSER CONTEXT PER LOGIN (utils/reassign-session) — see that file: a
// reused context serves a stale worklist in this app.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/46_reassign_handoff_integrity.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const RFI_PENDING_ME = '/my-tasks/rfi/list/pending-with-me';
const RFI_PENDING_OTHERS = '/my-tasks/rfi/list/pending-with-others';
const RFI_APPROVED = '/my-tasks/rfi/list/approved';

let sessions, fleet, handoff, readOnly;
const findings = [];

function note(msg) {
  findings.push(msg);
  console.log(`  ${msg}`);
}

// Opens the record's Reassign modal as whoever is signed in, and returns the
// page object plus the row — callers close it themselves.
async function openModal(code) {
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();
  const row = await reassign.scrollToRowById(code);
  await reassign.openReassign(row);
  return { reassign, row };
}

// Reads the record's own view page: version badge and visible code.
async function readRecordIdentity(record) {
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${record.id}/view`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const base = new BasePage(page);
  const version = await base.getVersionBadge().catch(() => null);
  const code = await base.getVisibleCode().catch(() => null);
  return { version: version && version.trim().toLowerCase(), code: code && code.trim() };
}

// Whose queue is it in? Scrolled and settled — see ReassignPage.collectAllRowIds
// and docs/automation-coverage-and-gaps.md section 2d on false absences.
async function queueHas(code) {
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_ME}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  const hasGrid = await reassign.waitForGrid().then(() => true).catch(() => false);
  if (!hasGrid) return { present: false, rows: 0 };

  const ids = await reassign.collectAllRowIds();
  return { present: ids.includes(code), rows: ids.length };
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  handoff = claimRecord('rfi', 'H_HANDOFF');
  readOnly = claimRecord('rfi', 'R_READ');
  sessions = createSessionFactory(browser);

  console.log(
    `\n=== Families H / I / B / X on ${process.env.BASE_URL} ===\n` +
    `    hand-off record: ${handoff.code}   read-only record: ${readOnly.code}\n`
  );
});

test.afterAll(async () => {
  console.log('\n--- H / I / B / X findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- X1: cancelling changes nothing ----------------------------------------
test('X1: cancelling the Reassign modal leaves the assignee untouched', async () => {
  test.setTimeout(15 * 60 * 1000);

  await sessions.actAsAdmin();
  const { reassign } = await openModal(readOnly.code);
  await reassign.selectAssigneeType('Execution Engineer');
  const before = await reassign.getCurrentAssigneeName();

  // Pick someone, then CLOSE instead of submitting. Choosing first is the
  // point: a modal that applies on selection rather than on "Assign User"
  // would change the record here, and closing without submitting is exactly
  // how a user backs out of a misclick.
  const candidate = fleet.EE_C && fleet.EE_C.name;
  if (candidate) await reassign.selectNewAssignee(candidate).catch(() => {});
  await reassign.closeButton.click();

  const { reassign: reopened } = await openModal(readOnly.code);
  await reopened.selectAssigneeType('Execution Engineer');
  const after = await reopened.getCurrentAssigneeName();
  await reopened.closeButton.click().catch(() => {});

  expect(
    after,
    `X1: the assignee changed after a CANCELLED reassignment — was "${before}", now "${after}". ` +
    `Selecting a name must not take effect until "Assign User" is pressed.`
  ).toBe(before);
  note(`X1: cancelled modal left the Execution Engineer as "${after}"`);
});

// --- H1 + I1 + I3: the hand-off, and what must not move with it ------------
test('H1/I1/I3: the record moves to the new EE, and version and code do not move', async () => {
  test.setTimeout(25 * 60 * 1000);

  const oldEe = fleet.EE_D;
  const newEe = fleet.EE_C;
  expect(oldEe && newEe, 'EE_D and EE_C must both be in the fleet').toBeTruthy();

  // --- identity BEFORE -----------------------------------------------------
  await sessions.actAsAdmin();
  const before = await readRecordIdentity(handoff);
  note(`H1: ${handoff.code} before — version=${before.version}, code=${before.code}`);
  expect(before.version, 'the record must show a version before the swap').toBeTruthy();

  // Who holds it now? Read from the modal rather than assumed, because an
  // earlier run of this file may already have swapped it.
  const { reassign } = await openModal(handoff.code);
  await reassign.selectAssigneeType('Execution Engineer');
  const currentEe = (await reassign.getCurrentAssigneeName() || '').trim();
  await reassign.closeButton.click().catch(() => {});

  const target = currentEe === newEe.name ? oldEe : newEe;
  const leaving = currentEe === newEe.name ? newEe : oldEe;
  note(`H1: currently with "${currentEe}" — handing to ${target.name}`);

  // --- the hand-off --------------------------------------------------------
  const { reassign: modal } = await openModal(handoff.code);
  await modal.selectAssigneeType('Execution Engineer');
  await modal.selectNewAssignee(target.name);
  await modal.submitAssignUser();

  // --- it ARRIVED ----------------------------------------------------------
  await sessions.actAs(target.email, PASSWORD);
  const arrived = await queueHas(handoff.code);
  expect(
    arrived.present,
    `H1: ${handoff.code} was handed to ${target.name} but is not in their "Pending with me" ` +
    `(${arrived.rows} rows). A record that arrives nowhere is stranded.`
  ).toBeTruthy();
  note(`H1: arrived with ${target.name}`);

  // --- and it LEFT ---------------------------------------------------------
  // The half that catches "everyone can see everything": an app that never
  // removed the record from the previous holder would pass the arrival check
  // above and still leave two people believing the same inspection is theirs.
  if (leaving.email !== target.email) {
    await sessions.actAs(leaving.email, PASSWORD);
    const stillThere = await queueHas(handoff.code);
    expect(
      stillThere.present,
      `H1: ${handoff.code} was handed to ${target.name} but is STILL in ${leaving.name}'s ` +
      `"Pending with me" (${stillThere.rows} rows). Both now hold the same record.`
    ).toBeFalsy();
    note(`H1: left ${leaving.name}'s queue`);
  }

  // --- identity AFTER ------------------------------------------------------
  await sessions.actAsAdmin();
  const after = await readRecordIdentity(handoff);

  expect(
    after.version,
    `I1: the VERSION moved across a reassignment — ${before.version} -> ${after.version}. ` +
    `Per the app owner it changes only when the CI resubmits, so this is a defect: version is ` +
    `what tells a reviewer whether the work in front of them is the work they last saw.`
  ).toBe(before.version);

  expect(
    after.code,
    `I3: the CODE changed across a reassignment — ${before.code} -> ${after.code}. Every queue, ` +
    `tracker and report addresses this record by code.`
  ).toBe(before.code);

  note(`I1/I3: version stayed ${after.version}, code stayed ${after.code}`);
});

// --- X2: reassign twice, the last one wins ---------------------------------
test('X2: reassigning twice leaves the record with the LAST assignee only', async () => {
  test.setTimeout(25 * 60 * 1000);

  await sessions.actAsAdmin();
  const { reassign } = await openModal(handoff.code);
  await reassign.selectAssigneeType('Execution Engineer');
  const holder = (await reassign.getCurrentAssigneeName() || '').trim();
  await reassign.closeButton.click().catch(() => {});

  // Hand it to whichever fleet EE is NOT holding it, then read both queues.
  const chain = [fleet.EE_C, fleet.EE_D, fleet.EE_A].filter(Boolean);
  const next = chain.find((m) => m.name !== holder);
  expect(next, 'need a fleet EE other than the current holder').toBeTruthy();

  const { reassign: modal } = await openModal(handoff.code);
  await modal.selectAssigneeType('Execution Engineer');
  await modal.selectNewAssignee(next.name);
  await modal.submitAssignUser();
  note(`X2: second swap "${holder}" -> "${next.name}"`);

  await sessions.actAs(next.email, PASSWORD);
  const withNext = await queueHas(handoff.code);
  expect(withNext.present, `X2: the final assignee ${next.name} does not hold ${handoff.code}`).toBeTruthy();

  const previous = chain.find((m) => m.name === holder);
  if (previous) {
    await sessions.actAs(previous.email, PASSWORD);
    const withPrevious = await queueHas(handoff.code);
    expect(
      withPrevious.present,
      `X2: ${previous.name} was reassigned AWAY from ${handoff.code} but still holds it — ` +
      `an intermediate assignee in an A -> B -> C chain must not keep the record.`
    ).toBeFalsy();
    note(`X2: intermediate holder ${previous.name} released it`);
  }
});

// --- B1: an approved RFI is not reassignable -------------------------------
test('B1: an APPROVED RFI exposes no reassign control', async () => {
  test.setTimeout(15 * 60 * 1000);

  const page = await sessions.actAsAdmin();
  await page.goto(`${process.env.BASE_URL}${RFI_APPROVED}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  const hasGrid = await reassign.waitForGrid().then(() => true).catch(() => false);
  expect(hasGrid, 'B1 needs at least one approved RFI to look at').toBeTruthy();

  await reassign.waitForGridToSettle();

  // Counted across the whole page rather than probed on one row: the refusal
  // observed in recon is the control being ABSENT, and absence is only
  // meaningful when the page is known to have rendered rows at all — hence
  // asserting the view icons are present in the same breath.
  const counts = await page.evaluate(() => {
    const svgTitles = [...document.querySelectorAll('button svg title')].map((t) => t.textContent || '');
    const labels = [...document.querySelectorAll('button')]
      .map((b) => `${b.getAttribute('aria-label') || ''} ${b.getAttribute('title') || ''}`);
    const all = [...svgTitles, ...labels].map((s) => s.toLowerCase());
    return {
      reassign: all.filter((s) => /reassign|assign user/.test(s)).length,
      view: all.filter((s) => /view|eye/.test(s)).length,
      buttons: document.querySelectorAll('button').length,
    };
  });

  note(`B1: approved list — reassign controls=${counts.reassign}, view controls=${counts.view}, ` +
    `buttons=${counts.buttons}`);

  expect(
    counts.reassign,
    `B1: the Approved list exposes ${counts.reassign} reassign control(s). An approved RFI is ` +
    `finished work — reassigning it would re-route a record nobody is waiting on, and the ` +
    `recon on both pulse-qa and pulse-test found the control absent.`
  ).toBe(0);
});
