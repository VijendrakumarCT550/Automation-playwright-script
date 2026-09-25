const { test, expect } = require('@playwright/test');
const { fleetFor } = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const ReassignPage = require('../pages/ReassignPage');
const { BasePage } = require('../pages/BasePage');

// ===========================================================================
// REASSIGNMENT ON THE NC SIDE — Families R, H5 and I, against NC records.
// (docs/reassignment-scenarios.md, section 3)
// ===========================================================================
// A SEPARATE FILE WITH ITS OWN ROUTES AND ITS OWN POOL RECORDS, per the standing
// rule that NC files never share code with RFI ones. It looks like
// 46_reassign_handoff_integrity on purpose; that is not an invitation to merge
// them.
//
// WHY THE NC SIDE IS NOT "THE SAME TEST WITH A DIFFERENT URL". The two flows
// differ in the ways that matter to reassignment:
//
//   * An NC is RAISED BY THE QI, not the CI — the reverse of RFI — so a fresh
//     NC's first holder is its CONTRACTOR INCHARGE, who must respond to it.
//   * NC's list lives at its own route, and the "NC ID" column header is the
//     only reliable proof the NC grid rendered at all. Every previous attempt to
//     reach it by clicking the tab produced the same silent failure: RFI rows
//     read as NC rows (see linked-nc-flow.js, and the landmine register).
//   * An NC's CODE IS STABLE ACROSS A RESUBMIT, unlike an RFI's, so a code
//     change here would be a defect with no benign explanation at all.
//
// Reassignment itself is shared UI — the same grid and modal serve both — so
// what is worth asserting is that the RFI-side guarantees hold for NC records:
// the hand-off moves the record in BOTH directions, and neither version nor
// code moves with it.
//
// Uses the NC pool from 43_reassign_nc_records_setup; one browser context per
// login (utils/reassign-session).
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/48_reassign_nc.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const NC_PENDING_ME = '/my-tasks/nc/list/pending-with-me';
const NC_PENDING_OTHERS = '/my-tasks/nc/list/pending-with-others';
const CI_ROLE = 'Contractor Incharge';

let sessions, fleet, handoffNc, readOnlyNc;
const findings = [];

function note(msg) {
  findings.push(msg);
  console.log(`  ${msg}`);
}

// Reaching an NC list is SETUP, not the behaviour under test — so navigate
// straight to its route and prove arrival by the "NC ID" column header rather
// than clicking the My Tasks tab. That tab click has failed silently three
// separate times, and every failure produced the same dangerous outcome: RFI
// rows read as NC rows.
async function gotoNcList(url) {
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}${url}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const onNcGrid = await page.getByRole('columnheader', { name: /NC ID/i }).first()
    .waitFor({ state: 'visible', timeout: 15000 })
    .then(() => true).catch(() => false);

  expect(
    onNcGrid,
    `The NC grid never rendered at ${url} — no "NC ID" column header. Without that proof, ` +
    `any rows read here could be RFI rows, which is the exact confusion this check exists to ` +
    `prevent.`
  ).toBeTruthy();
  return page;
}

async function ncQueueHas(code) {
  await gotoNcList(NC_PENDING_ME);
  const reassign = new ReassignPage(sessions.current());
  const hasGrid = await reassign.waitForGrid().then(() => true).catch(() => false);
  if (!hasGrid) return { present: false, rows: 0 };

  const ids = await reassign.collectAllRowIds();
  return { present: ids.includes(code), rows: ids.length };
}

async function openNcModal(code) {
  await gotoNcList(NC_PENDING_OTHERS);
  const reassign = new ReassignPage(sessions.current());
  await reassign.waitForGrid();
  const row = await reassign.scrollToRowById(code);
  await reassign.openReassign(row);
  return reassign;
}

async function readNcIdentity(record) {
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${record.id}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const base = new BasePage(page);
  const version = await base.getVersionBadge().catch(() => null);
  const code = await base.getVisibleCode().catch(() => null);
  return { version: version && version.trim().toLowerCase(), code: code && code.trim() };
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  handoffNc = claimRecord('nc', 'H_HANDOFF_NC');
  readOnlyNc = claimRecord('nc', 'R_READ_NC');
  sessions = createSessionFactory(browser);

  console.log(
    `\n=== Reassignment on the NC side, on ${process.env.BASE_URL} ===\n` +
    `    hand-off NC: ${handoffNc.code}   read-only NC: ${readOnlyNc.code}\n`
  );
});

test.afterAll(async () => {
  console.log('\n--- NC reassignment findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- R (NC): Admin's type list on an NC ------------------------------------
test('R-NC: Admin can reassign all three roles on an NC', async () => {
  test.setTimeout(20 * 60 * 1000);

  await sessions.actAsAdmin();
  const reassign = await openNcModal(readOnlyNc.code);
  const dump = await reassign.dumpDialogComboboxes();

  const ROLE_WORDS = /contractor in-?charge|execution engineer|quality inspector/i;
  const typeBox = dump.boxes.find((b) => b.options.some((o) => ROLE_WORDS.test(o)));
  expect(
    typeBox,
    `R-NC: Admin's NC reassign modal offered no type dropdown. Dropdowns seen: ` +
    `${JSON.stringify(dump.boxes.map((b) => b.label))}`
  ).toBeTruthy();

  for (const role of ['Contractor Incharge', 'Execution Engineer', 'Quality Inspector']) {
    expect(
      typeBox.options.some((o) => o.includes(role)),
      `R-NC: Admin must be able to reassign "${role}" on an NC. Offered: ${JSON.stringify(typeBox.options)}`
    ).toBeTruthy();
  }
  note(`R-NC: Admin's NC type list offers ${JSON.stringify(typeBox.options)}`);
  await reassign.closeButton.click().catch(() => {});
});

// --- H5 + I: the NC hand-off, and what must not move with it ---------------
test('H5/I: an NC moves to the new CI, and its version and code do not move', async () => {
  test.setTimeout(30 * 60 * 1000);

  // A fresh NC is pending with its CONTRACTOR INCHARGE — the QI raised it and
  // the CI must respond — so the CI is the role whose hand-off matters first.
  await sessions.actAsAdmin();
  const before = await readNcIdentity(handoffNc);
  note(`H5: ${handoffNc.code} before — version=${before.version}, code=${before.code}`);
  expect(before.version, 'the NC must show a version before the swap').toBeTruthy();

  const modal = await openNcModal(handoffNc.code);
  await modal.selectAssigneeType(CI_ROLE);
  const currentCi = (await modal.getCurrentAssigneeName() || '').trim();
  await modal.closeButton.click().catch(() => {});
  note(`H5: ${handoffNc.code} is currently with CI "${currentCi}"`);

  // Hand it to a fleet CI who is not already holding it. Read the holder first
  // rather than assuming, so the file is re-runnable after an earlier swap.
  const target = [fleet.CI_A, fleet.CI_C, fleet.CI_D]
    .find((m) => m && m.name && m.name !== currentCi);
  expect(target, 'need a fleet CI other than the current holder').toBeTruthy();

  const swap = await openNcModal(handoffNc.code);
  await swap.selectAssigneeType(CI_ROLE);
  await swap.selectNewAssignee(target.name);
  await swap.submitAssignUser();
  note(`H5: handed ${handoffNc.code} "${currentCi}" -> "${target.name}"`);

  // --- it ARRIVED ----------------------------------------------------------
  await sessions.actAs(target.email, PASSWORD);
  const arrived = await ncQueueHas(handoffNc.code);
  expect(
    arrived.present,
    `H5: ${handoffNc.code} was handed to ${target.name} but is not in their NC "Pending with me" ` +
    `(${arrived.rows} rows). An NC that arrives nowhere is a non-conformance nobody is answering.`
  ).toBeTruthy();
  note(`H5: arrived with ${target.name}`);

  // --- and it LEFT ---------------------------------------------------------
  const leaving = [fleet.CI_A, fleet.CI_C, fleet.CI_D].find((m) => m && m.name === currentCi);
  if (leaving && leaving.email !== target.email) {
    await sessions.actAs(leaving.email, PASSWORD);
    const stillThere = await ncQueueHas(handoffNc.code);
    expect(
      stillThere.present,
      `H5: ${handoffNc.code} was handed to ${target.name} but is STILL in ${leaving.name}'s NC ` +
      `queue (${stillThere.rows} rows) — two contractors now both believe this NC is theirs.`
    ).toBeFalsy();
    note(`H5: left ${leaving.name}'s queue`);
  }

  // --- identity AFTER ------------------------------------------------------
  await sessions.actAsAdmin();
  const after = await readNcIdentity(handoffNc);

  expect(
    after.version,
    `I1-NC: the VERSION moved across a reassignment — ${before.version} -> ${after.version}. ` +
    `It should change only when the CI resubmits the NC.`
  ).toBe(before.version);

  // AN NC'S CODE IS STABLE EVEN ACROSS A RESUBMIT (unlike an RFI's, which can
  // change when work location / area / package change). So a code change here
  // has no benign explanation whatsoever.
  expect(
    after.code,
    `I3-NC: the CODE changed across a reassignment — ${before.code} -> ${after.code}. An NC's ` +
    `code is stable even across a resubmit, so this cannot be explained away.`
  ).toBe(before.code);

  note(`I-NC: version stayed ${after.version}, code stayed ${after.code}`);
});

// --- C (NC): can an unmapped CI actually reach the NC it was handed? -------
test('C-NC: the CI holding a reassigned NC can open it and is offered its response action', async () => {
  test.setTimeout(30 * 60 * 1000);

  const record = claimRecord('nc', 'C_QI_UNMAPPED_NC');

  // Hand this one to CI_A — no WAM anywhere — and check the NC is not merely
  // listed but actionable. Family C proved this for RFI; the NC response is a
  // different screen and deserves its own evidence.
  await sessions.actAsAdmin();
  const modal = await openNcModal(record.code);
  await modal.selectAssigneeType(CI_ROLE);
  const holder = (await modal.getCurrentAssigneeName() || '').trim();

  if (holder === fleet.CI_A.name) {
    await modal.closeButton.click().catch(() => {});
    note(`C-NC: ${record.code} is already with CI_A — prepared by an earlier run`);
  } else {
    await modal.selectNewAssignee(fleet.CI_A.name);
    await modal.submitAssignUser();
    note(`C-NC: handed ${record.code} "${holder}" -> "${fleet.CI_A.name}"`);
  }

  await sessions.actAs(fleet.CI_A.email, PASSWORD);
  const queue = await ncQueueHas(record.code);
  expect(
    queue.present,
    `C-NC: ${record.code} was handed to CI_A (no WAM anywhere) but is not in their NC queue ` +
    `(${queue.rows} rows).`
  ).toBeTruthy();

  // Open it and look for something to DO. Listing is not acting — an NC the CI
  // can see but not answer is the NC-side form of a stranded record.
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${record.id}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const actions = await page.evaluate(() => [...document.querySelectorAll('button')]
    .map((b) => (b.innerText || b.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean));

  const actionable = actions.filter((t) => /respond|submit|proceed|edit|resubmit|root cause/i.test(t));
  note(`C-NC: CI_A sees actions ${JSON.stringify(actions.slice(0, 12))}`);

  expect(
    actionable.length,
    `C-NC: CI_A holds ${record.code} but its page offers nothing to act on — buttons seen: ` +
    `${JSON.stringify(actions)}. A contractor who can see a non-conformance but cannot answer it ` +
    `leaves the NC open with nobody able to close it.`
  ).toBeGreaterThan(0);
  note(`C-NC: PASS — CI_A can act on ${record.code} (${JSON.stringify(actionable)})`);
});
