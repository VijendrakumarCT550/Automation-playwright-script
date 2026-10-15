// RFI-SIDE OPERATIONS SHARED BY THE LATER REASSIGNMENT SPECS (50+).
//
// Everything here already exists INLINE in 45-49 and was proven live there;
// this file only stops the new specs from copying it a sixth time. 45-49 are
// left as they are (they pass), per the note in reassign-session.js.
//
// RFI ONLY. The NC side keeps its own helpers inside its own spec files, per the
// standing rule that NC files never share code with RFI ones.
//
// Every read here is written against the false-ABSENCE traps recorded in
// docs/automation-coverage-and-gaps.md section 2d: a helper that cannot see the
// whole search space must never be the source of a negative claim. So a queue
// read polls until the list stops growing, scrolls the whole grid, and confirms
// any absence in a brand-new session before reporting it.
const { expect } = require('@playwright/test');
const { openFromPendingWithMe } = require('./rfi-nav');
const ReassignPage = require('../pages/ReassignPage');
const DashboardPage = require('../pages/DashboardPage');

const PASSWORD = () => process.env.BULK_USER_DEFAULT_PASSWORD;
const RFI_PENDING_ME = '/my-tasks/rfi/list/pending-with-me';
const RFI_PENDING_OTHERS = '/my-tasks/rfi/list/pending-with-others';
const RFI_APPROVED = '/my-tasks/rfi/list/approved';

const TYPE = {
  CI: 'Contractor Incharge',
  EE: 'Execution Engineer',
  QI: 'Quality Inspector',
};

// Grid column headers per type — read by HEADER NAME, never by index (a
// hardcoded index once read the Work Area column while claiming an assignee).
// The grid's own labels, read live on pulse-test 2026-09-27: "Contractor
// Incharge", "Assigned EE", "Assigned QI" — the EE/QI columns are NOT named
// after the role, so the role name alone matches nothing.
const HEADERS = {
  [TYPE.CI]: [TYPE.CI, 'Contractor In-Charge'],
  [TYPE.EE]: ['Assigned EE', TYPE.EE],
  [TYPE.QI]: ['Assigned QI', TYPE.QI],
};

function fleetMemberByName(fleet, name) {
  const wanted = String(name || '').trim();
  return Object.values(fleet).find((m) => m && m.name === wanted) || null;
}

async function readQueueOnce(page) {
  await new DashboardPage(page).goToDashboard().catch(() => {});
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_ME}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const grid = new ReassignPage(page);
  const ok = await grid.waitForGrid().then(() => true).catch(() => false);
  if (!ok) return [];
  await grid.waitForGridToSettle().catch(() => {});
  return grid.collectAllRowIds();
}

// Is `code` in `member`'s "Pending with me"? Signs in as them (fresh context).
//
// Polled until present or until the row count stops growing; an ABSENCE is then
// re-checked in a second brand-new session before it is believed (45's
// isInPendingWithMe, same reasons).
async function rfiQueueHas(sessions, member, code, { attempts = 4, settleMs = 2500 } = {}) {
  let page = await sessions.actAs(member.email, PASSWORD());
  let best = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const ids = await readQueueOnce(page);
    if (ids.includes(code)) return { present: true, rows: ids.length };
    if (ids.length > best.length) best = ids;
    else if (attempt > 1) break;          // list stopped growing — stop polling
    await page.waitForTimeout(settleMs);
  }
  page = await sessions.actAs(member.email, PASSWORD());
  const fresh = await readQueueOnce(page);
  if (fresh.includes(code)) return { present: true, rows: fresh.length, viaFreshSession: true };
  return { present: false, rows: Math.max(best.length, fresh.length), confirmedFresh: true };
}

// Opens the record's Reassign modal as Admin (fresh session).
async function openReassignModal(sessions, code) {
  const page = await sessions.actAsAdmin();
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();
  const row = await reassign.scrollToRowById(code);
  await reassign.openReassign(row);
  return reassign;
}

// The record's current assignee of `type`, read from the modal (Admin).
async function readAssignee(sessions, code, type) {
  const modal = await openReassignModal(sessions, code);
  await modal.selectAssigneeType(type);
  const name = ((await modal.getCurrentAssigneeName()) || '').trim();
  await modal.closeButton.click().catch(() => {});
  return name;
}

// Reassigns `type` on `code` to `toName`, as Admin. "Already assigned" is the
// precondition being met, not a failure: the app never offers the current
// assignee in its own list (rule E1), so trying anyway would wait for a name
// the list correctly refuses to show. Returns { before, changed }.
async function reassignRfi(sessions, code, type, toName, note = () => {}) {
  const modal = await openReassignModal(sessions, code);
  await modal.selectAssigneeType(type);
  const before = ((await modal.getCurrentAssigneeName()) || '').trim();
  if (before === String(toName).trim()) {
    await modal.closeButton.click().catch(() => {});
    note(`${code} ${type} is already "${toName}" — no reassignment needed`);
    return { before, changed: false };
  }
  await modal.selectNewAssignee(toName);
  await modal.submitAssignUser();
  note(`reassigned ${code} ${type}: "${before}" -> "${toName}"`);
  return { before, changed: true };
}

// The record's assignee of `type`, read off Admin's grid BY HEADER — used where
// the modal cannot be opened (e.g. to read several columns in one pass).
async function readRecordColumn(sessions, code, type) {
  const page = await sessions.actAsAdmin();
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  const grid = new ReassignPage(page);
  await grid.waitForGrid();
  const row = await grid.scrollToRowById(code);
  const col = await grid.resolveColumnIndexByHeader(HEADERS[type]);
  const cell = await grid.scrollUntilColumnVisible(row, col);
  return (await cell.innerText()).replace(/\s+/g, ' ').trim();
}

// Signs in as `member` and opens `code` from their "Pending with me" through
// the UI — never by URL (a rejected row's eye icon lands on /re-submit; a URL
// visit to /view gives the read-only page). Returns the page.
async function openAs(sessions, member, code, label) {
  const page = await sessions.actAs(member.email, PASSWORD());
  await openFromPendingWithMe(page, code, label);
  return page;
}

// Expect the record to be with `member` and NOT with `other` — a hand-off is the
// conjunction (see 46's header: either half alone passes for a broken app).
async function expectHandOff(sessions, code, { to, from }, label) {
  const arrived = await rfiQueueHas(sessions, to, code);
  expect(
    arrived.present,
    `${label}: ${code} should be in ${to.name}'s "Pending with me" but is not ` +
    `(${arrived.rows} rows, absence confirmed in a fresh session). A record that arrives ` +
    `nowhere is stranded.`
  ).toBeTruthy();
  if (from && from.email !== to.email) {
    const left = await rfiQueueHas(sessions, from, code);
    expect(
      left.present,
      `${label}: ${code} is STILL in ${from.name}'s "Pending with me" (${left.rows} rows) after ` +
      `it should have gone to ${to.name} — two people now hold the same record.`
    ).toBeFalsy();
  }
}

module.exports = {
  TYPE, RFI_PENDING_ME, RFI_PENDING_OTHERS, RFI_APPROVED,
  fleetMemberByName, rfiQueueHas, openReassignModal, readAssignee,
  reassignRfi, readRecordColumn, openAs, expectHandOff,
};
