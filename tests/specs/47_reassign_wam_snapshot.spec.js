const { test, expect } = require('@playwright/test');
const { getProfile } = require('../config/projects');
const { fleetFor, serviceOrderFor } = require('../utils/reassign-fleet');
const { claimRecord, GROUND } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const { assignAndProve, openAssignmentDialog } = require('../utils/smoke-wam');
const ReassignPage = require('../pages/ReassignPage');
const DashboardPage = require('../pages/DashboardPage');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// ===========================================================================
// FAMILY S — WAM CHANGES vs THE FROZEN SNAPSHOT
// (docs/reassignment-scenarios.md, Family S; the rule is section 1.2 item 2)
// ===========================================================================
// THE RULE UNDER TEST, and why the feature exists at all: a record's CI/EE/QI
// are SNAPSHOTTED FROM WAM WHEN IT IS CREATED, and later WAM changes do not
// migrate in-flight records. An admin must reassign explicitly to move one.
//
// Both directions of that rule are defects if broken, in opposite ways:
//   * if WAM changes DID propagate retroactively, live work would silently
//     re-route to someone who never accepted it;
//   * if the snapshot were dropped, in-flight records would orphan.
//
// | id | asserted here |
// |----|---------------|
// | S1 | remap the area's CI -> the in-flight record STILL carries the old one |
// | S2 | a NEW record created after the remap carries the NEW one — which is
//        what proves S1 measured a snapshot and not a remap that never took |
// | S4 | an explicit reassignment DOES move the old record — reassignment is
//        the migration path that WAM is not |
//
// S2 IS NOT OPTIONAL PADDING. Without it, S1 passes just as well when the
// remap silently failed — the record would carry the old CI for the most
// boring possible reason, and the test would report the snapshot rule as
// proven. It costs one Work Section on BL07 and buys the difference between
// "the snapshot held" and "nothing happened".
//
// S3 (DEMAP ENTIRELY) IS DELIBERATELY NOT HERE. It is the sharpest case in the
// family, and it is also the one that leaves the ground BROKEN if the run dies
// mid-way: BL07 with no Contractor Incharge mapped at all, which every later
// spec and the app owner's own manual testing would inherit. It also overlaps
// 25_wam_demapping / 27_wam_demapping_hierarchy, which do not currently check
// what happens to records a demapped user was carrying. Worth doing
// deliberately, with the restore rehearsed — not tacked onto this file.
//
// THIS SPEC REWRITES WAM AND PUTS IT BACK. The restore in afterAll runs
// whatever happens; if it ever fails, the log says exactly which row to fix by
// hand.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/47_reassign_wam_snapshot.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const RFI_PENDING_OTHERS = '/my-tasks/rfi/list/pending-with-others';
const CI_ROLE = 'Contractor Incharge';

// The activity chain the pool was built with — a new record must sit on the
// same ground for S2 to be comparable.
const RFI_DATA = {
  workLocation:         GROUND.workLocation,
  workArea:             GROUND.workArea,
  package:              GROUND.package,
  subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
  activity:             'Piling - MMS',
  subActivity:          'Piling - MMS',
  rfiQuantity:          null,
  unit:                 null,
  subContractor:        null,
  inspectionCheckpoint: 'Pre Pour Inspection - Pile',
  inspectionChecklist:  'Micro Pile Checklist',
};

let sessions, fleet, profile, record;
let originalCi = null;      // whoever holds BL07's CI mapping when we arrive
let remappedTo = null;      // set once S1 has rewritten it
const findings = [];

function note(msg) {
  findings.push(msg);
  console.log(`  ${msg}`);
}

// Rewrites BL07's Contractor Incharge mapping, as Admin, and proves it stored.
async function mapCiTo(userName, label) {
  const page = await sessions.actAsAdmin();
  const dashboard = new DashboardPage(page);

  // Vendor-side roles need a Service Order or WAM offers ZERO rows — the trap
  // that cost the fleet build a whole afternoon on 2026-09-16.
  const filters = {
    role: CI_ROLE,
    cluster: profile.cluster,
    site: profile.site,
    workLocation: GROUND.workLocation,
    package: GROUND.package,
    serviceOrder: serviceOrderFor(CI_ROLE),
  };

  // openAssignmentDialog (smoke-wam) rather than a bare WAMPage call: it is the
  // wrapper that knows how to get a dialog with INTERACTIVE rows, retrying the
  // open when the first attempt comes back inert — the same helper the fleet
  // setup and the whole smoke WAM tier rely on.
  const wam = await openAssignmentDialog(page, dashboard, filters);
  await assignAndProve(wam, {
    filters,
    entries: [{ row: GROUND.workArea, userName }],
    label,
  });
  note(`${label}: ${GROUND.workArea} Contractor Incharge <- ${userName}`);
}

// Reads the record's Contractor Incharge straight off the grid, by HEADER NAME
// — never by column index. A hardcoded index once read the Work Area column
// while claiming to read an assignee (see ReassignPage.resolveColumnIndexByHeader).
async function readRecordCi(code) {
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();
  const row = await reassign.scrollToRowById(code);

  const col = await reassign.resolveColumnIndexByHeader([CI_ROLE, 'Contractor In-Charge']);
  const cell = await reassign.scrollUntilColumnVisible(row, col);
  return (await cell.innerText()).replace(/\s+/g, ' ').trim();
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  profile = getProfile('solar-e2e');
  record = claimRecord('rfi', 'S_SNAPSHOT');
  sessions = createSessionFactory(browser);

  console.log(
    `\n=== Family S — the frozen snapshot, on ${process.env.BASE_URL} ===\n` +
    `    in-flight record: ${record.code} on ` +
    `${GROUND.workLocation}/${GROUND.package}/${GROUND.workArea}\n`
  );
});

test.afterAll(async () => {
  // RESTORE, ALWAYS. This spec rewrites a mapping the whole reassignment suite
  // and the app owner's manual testing depend on, so leaving BL07 pointing at
  // the wrong Contractor Incharge would quietly change what every later run
  // measures.
  //
  // It restores to the CI THE IN-FLIGHT RECORD CARRIED at the start, which is
  // also the fleet's intended mapping for this area (CI_C is the control arm
  // mapped to BL07). Those are the same user unless somebody has remapped the
  // area by hand since the fleet was built.
  if (remappedTo && originalCi && remappedTo !== originalCi) {
    try {
      await mapCiTo(originalCi, 'RESTORE');
      note(`restored ${GROUND.workArea}'s Contractor Incharge to ${originalCi}`);
    } catch (err) {
      const msg = String((err && err.message) || err).split(/\r?\n/)[0];
      console.log(
        `\n  *** RESTORE FAILED: ${GROUND.workArea}'s Contractor Incharge is still ` +
        `"${remappedTo}" and must be set back to "${originalCi}" BY HAND in WAM ` +
        `(${GROUND.workLocation} / ${GROUND.package}, Service Order ` +
        `"${serviceOrderFor(CI_ROLE)}"). Reason: ${msg} ***\n`
      );
    }
  }

  console.log('\n--- Family S findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- S1: the in-flight record keeps its original CI ------------------------
test('S1: remapping the work area does NOT move an in-flight record', async () => {
  test.setTimeout(30 * 60 * 1000);

  await sessions.actAsAdmin();
  originalCi = await readRecordCi(record.code);
  expect(originalCi, `${record.code} must show a Contractor Incharge to begin with`).toBeTruthy();
  note(`S1: ${record.code} currently carries CI "${originalCi}"`);

  // Remap the AREA to a different fleet CI. CI_D is provisioned in this work
  // location and mapped to the other package, so it is a legitimate holder of
  // this row and not a synthetic value.
  const replacement = [fleet.CI_D, fleet.CI_E, fleet.CI_A]
    .find((m) => m && m.name && m.name !== originalCi);
  expect(replacement, 'need a fleet CI other than the current one').toBeTruthy();

  await mapCiTo(replacement.name, 'S1 remap');
  remappedTo = replacement.name;

  const after = await readRecordCi(record.code);
  expect(
    after,
    `S1: the in-flight record's CI FOLLOWED a WAM remap — it read "${originalCi}" before and ` +
    `"${after}" after. Assignees are snapshotted at creation (section 1.2 rule 2); if WAM changes ` +
    `propagated retroactively, live work would silently re-route to someone who never accepted it.`
  ).toBe(originalCi);
  note(`S1: PASS — ${record.code} still carries "${after}" after the area was remapped to "${remappedTo}"`);
});

// --- S2: a NEW record picks up the new mapping -----------------------------
test('S2: a record created AFTER the remap carries the NEW assignee', async () => {
  test.setTimeout(30 * 60 * 1000);

  expect(remappedTo, 'S1 must have remapped the area first').toBeTruthy();
  const newCi = [fleet.CI_D, fleet.CI_E, fleet.CI_A].find((m) => m && m.name === remappedTo);
  expect(newCi && newCi.email, 'the remapped CI must be a fleet member we can log in as').toBeTruthy();

  // Raise one RFI as the newly mapped CI. This is the control that makes S1
  // meaningful: it proves the remap actually took, so S1's result is the
  // snapshot holding rather than nothing having happened.
  const page = await sessions.actAs(newCi.email, PASSWORD);
  const myTasks = new MyTasksPage(page);
  await myTasks.waitForLoad();
  await myTasks.clickCreateRFI();

  const create = new RFICreatePage(page);
  await create.fillForm(RFI_DATA);
  await create.clickProceed();

  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations('OK - as per standard', true);
  await checklist.submitRFI();

  const match = page.url().match(/\/rfi\/([a-f0-9-]+)\/view/i);
  expect(match, `S2: no /view URL after submitting — got ${page.url()}`).toBeTruthy();
  note(`S2: ${newCi.name} raised a new RFI (${match[1]}) on ${GROUND.workArea}`);

  // The new record's CI must be the newly mapped user. Read it as Admin, off
  // the grid, by the record's own row.
  await sessions.actAsAdmin();
  const reassign = new ReassignPage(sessions.current());
  await sessions.current().goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await sessions.current().waitForLoadState('networkidle').catch(() => {});
  await reassign.waitForGrid();
  await reassign.waitForGridToSettle();

  // Newest row first: the record just raised is the most recent on this ground.
  const ids = await reassign.collectAllRowIds();
  const onGround = ids.filter((id) => id.includes(`${GROUND.workLocation}-${GROUND.workArea}`));
  expect(onGround.length, 'the new record should be visible on this ground').toBeGreaterThan(0);

  const newestCi = await readRecordCi(onGround[0]);
  note(`S2: newest record on ${GROUND.workArea} is ${onGround[0]} with CI "${newestCi}"`);
  expect(
    newestCi,
    `S2: a record created AFTER the remap carries "${newestCi}", not the newly mapped ` +
    `"${remappedTo}". Then the remap never took effect, and S1's result says nothing about ` +
    `snapshots — it would read the same way if WAM had simply ignored the change.`
  ).toBe(remappedTo);
  note('S2: PASS — the remap did take effect, so S1 measured the snapshot');
});

// --- S4: an explicit reassignment DOES move it -----------------------------
test('S4: reassigning explicitly moves the old record — the migration path WAM is not', async () => {
  test.setTimeout(30 * 60 * 1000);

  expect(remappedTo, 'S1 must have remapped the area first').toBeTruthy();

  await sessions.actAsAdmin();
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();
  const row = await reassign.scrollToRowById(record.code);
  await reassign.openReassign(row);
  await reassign.selectAssigneeType(CI_ROLE);
  await reassign.selectNewAssignee(remappedTo);
  await reassign.submitAssignUser();

  const after = await readRecordCi(record.code);
  expect(
    after,
    `S4: the explicit reassignment did not take — ${record.code} still shows "${after}" rather ` +
    `than "${remappedTo}". WAM deliberately does not migrate in-flight records, so if reassignment ` +
    `does not either, nothing does and the record is stuck with its original assignee forever.`
  ).toBe(remappedTo);
  note(`S4: PASS — ${record.code} moved "${originalCi}" -> "${after}" by explicit reassignment`);
});
