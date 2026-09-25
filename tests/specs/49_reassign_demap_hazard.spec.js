const { test, expect } = require('@playwright/test');
const { getProfile } = require('../config/projects');
const { fleetFor, serviceOrderFor } = require('../utils/reassign-fleet');
const { claimRecord, GROUND } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const { openAssignmentDialog } = require('../utils/smoke-wam');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const ReassignPage = require('../pages/ReassignPage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const RFICreatePage = require('../pages/RFICreatePage');
const DashboardPage = require('../pages/DashboardPage');

// ===========================================================================
// S3 — DEMAPPING THE WORK AREA ENTIRELY: does in-flight work survive?
// (docs/reassignment-scenarios.md, Family S, row S3 — "the sharp one")
// ===========================================================================
// THE HAZARD, in the app owner's own framing: *"if demapping strands in-flight
// records, that is a live operational hazard"*. A contractor leaves the project
// and someone tidies up WAM. Every RFI that person was carrying is real work,
// mid-flight. Does it survive, and can it still be moved?
//
// This is the one scenario the existing WAM demapping specs do NOT cover:
// 25_wam_demapping and 27_wam_demapping_hierarchy both prove that clearing a
// row PERSISTS — they never ask what happened to the records the cleared user
// was holding.
//
// ASSERTED HERE, in the order a real incident would unfold:
//   S3a  the work area's Contractor Incharge is cleared, and it sticks
//   S3b  the in-flight record STILL names its own CI — the snapshot does not
//        follow the demap any more than it followed the remap (S1)
//   S3c  THE HAZARD ITSELF: the EE rejects it, and it lands on that CI anyway,
//        who can still open the resubmit form — with NOBODY mapped to the area
//   S3d  and it is still reassignable, so an admin has a way out
//
// S3c is the point. S3b alone would pass on an app that displays a stale name
// while routing the work nowhere; only pushing the record through a real
// transition shows whether the route still exists.
//
// *** THIS SPEC LEAVES THE GROUND BROKEN IF IT DIES MID-RUN. ***
// While it runs, A-06c/BL07 has NO Contractor Incharge mapped — a state every
// other reassignment spec, and the app owner's manual testing, would inherit.
// So:
//   * the original value is captured BEFORE anything is cleared, and restored
//     in afterAll however the run ends;
//   * a failed restore prints the exact row, filters and Service Order to fix
//     by hand, loudly;
//   * and it is a FILE OF ITS OWN, so it is never dragged in as a side effect
//     of running something else.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/49_reassign_demap_hazard.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const RFI_PENDING_OTHERS = '/my-tasks/rfi/list/pending-with-others';
const RFI_PENDING_ME = '/my-tasks/rfi/list/pending-with-me';
const CI_ROLE = 'Contractor Incharge';

let sessions, fleet, profile, record;
let wamBefore = null;       // what BL07's CI row held when we arrived
let cleared = false;        // set once the row has actually been emptied
let recordCi = null;        // the CI the in-flight record carries
const findings = [];

function note(msg) {
  findings.push(msg);
  console.log(`  ${msg}`);
}

function ciFilters() {
  return {
    role: CI_ROLE,
    cluster: profile.cluster,
    site: profile.site,
    workLocation: GROUND.workLocation,
    package: GROUND.package,
    serviceOrder: serviceOrderFor(CI_ROLE),
  };
}

// Opens WAM's assignment dialog on BL07's Contractor Incharge row, as Admin.
async function openCiRow() {
  const page = await sessions.actAsAdmin();
  const dashboard = new DashboardPage(page);
  return openAssignmentDialog(page, dashboard, ciFilters());
}

// Reads the record's Contractor Incharge off the grid, BY HEADER NAME.
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
    `\n=== S3 — demapping ${GROUND.workArea} entirely, on ${process.env.BASE_URL} ===\n` +
    `    in-flight record: ${record.code}\n` +
    `    *** while this runs, ${GROUND.workArea} has NO Contractor Incharge mapped ***\n`
  );
});

test.afterAll(async () => {
  if (cleared && wamBefore) {
    try {
      const wam = await openCiRow();
      await wam.assignUserIfNeeded(GROUND.workArea, wamBefore);
      await wam.clickSubmit();
      await wam.closeDialog();

      // Reopen and re-read: "the form accepted it" is not "the server stored
      // it", and this is the one restore that must not be taken on trust.
      const check = await openCiRow();
      const restored = await check.getWorkAreaUserValue(GROUND.workArea);
      await check.closeDialog().catch(() => {});

      expect(restored, 'the restore must actually have persisted').toContain(wamBefore);
      note(`RESTORED: ${GROUND.workArea} Contractor Incharge = "${restored}"`);
    } catch (err) {
      const msg = String((err && err.message) || err).split(/\r?\n/)[0];
      console.log(
        `\n  *** RESTORE FAILED — ${GROUND.workLocation}/${GROUND.workArea} HAS NO ` +
        `CONTRACTOR INCHARGE MAPPED. Set it back to "${wamBefore}" BY HAND in WAM: ` +
        `role "${CI_ROLE}", ${GROUND.workLocation} / ${GROUND.package}, Service Order ` +
        `"${serviceOrderFor(CI_ROLE)}", row ${GROUND.workArea}. Reason: ${msg} ***\n`
      );
    }
  }

  console.log('\n--- S3 findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- S3a: clear the mapping, and prove it stuck ----------------------------
test('S3a: the work area\'s Contractor Incharge can be cleared, and it persists', async () => {
  test.setTimeout(30 * 60 * 1000);

  // Capture what the record carries BEFORE touching WAM — that is the value
  // S3b will check survived, and it is read from the record, not from WAM.
  await sessions.actAsAdmin();
  recordCi = await readRecordCi(record.code);
  expect(recordCi, `${record.code} must name a Contractor Incharge to begin with`).toBeTruthy();
  note(`S3a: ${record.code} carries CI "${recordCi}"`);

  const wam = await openCiRow();
  wamBefore = (await wam.getWorkAreaUserValue(GROUND.workArea) || '').trim();
  expect(
    wamBefore,
    `${GROUND.workArea} has no Contractor Incharge mapped to begin with, so there is nothing ` +
    `to demap — and nothing to restore afterwards. Map one before running this.`
  ).toBeTruthy();
  note(`S3a: WAM currently maps ${GROUND.workArea} to "${wamBefore}"`);

  const didClear = await wam.clearWorkAreaUser(GROUND.workArea);
  expect(didClear, 'the "Clear value" control should have been present on a populated row').toBe(true);
  await wam.clickSubmit();
  await wam.closeDialog();
  cleared = true;   // from here on, afterAll MUST restore

  // Reopen fresh: cleared-in-the-form is not cleared-on-the-server.
  const check = await openCiRow();
  const afterClear = await check.getWorkAreaUserValue(GROUND.workArea);
  await check.closeDialog().catch(() => {});
  expect(afterClear, `${GROUND.workArea} should be empty after Clear + Submit`).toBe('');
  note(`S3a: ${GROUND.workArea} now has NO Contractor Incharge mapped`);
});

// --- S3b: the in-flight record keeps its own CI ----------------------------
test('S3b: the in-flight record still names its Contractor Incharge', async () => {
  test.setTimeout(20 * 60 * 1000);
  expect(cleared, 'S3a must have cleared the mapping first').toBe(true);

  await sessions.actAsAdmin();
  const after = await readRecordCi(record.code);
  expect(
    after,
    `S3b: the record's CI changed when the area was DEMAPPED — "${recordCi}" -> "${after}". ` +
    `Assignees are snapshotted at creation; a demap that blanks in-flight records would orphan ` +
    `live work with no way to see who was ever responsible for it.`
  ).toBe(recordCi);
  note(`S3b: PASS — ${record.code} still names "${after}" with nobody mapped to ${GROUND.workArea}`);
});

// --- S3c: THE HAZARD — does the work still route to them? ------------------
test('S3c: a rejection still reaches that CI, who can still open the resubmit form', async () => {
  test.setTimeout(40 * 60 * 1000);
  expect(cleared, 'S3a must have cleared the mapping first').toBe(true);

  const holder = [fleet.CI_A, fleet.CI_B, fleet.CI_C, fleet.CI_D, fleet.CI_E]
    .find((m) => m && m.name === recordCi);
  expect(
    holder,
    `S3c: the record's CI "${recordCi}" is not a fleet member, so this spec cannot log in as ` +
    `them to check the hazard.`
  ).toBeTruthy();

  // Push the record through a real transition. S3b alone would pass on an app
  // that DISPLAYS a stale name while routing the work nowhere; only a genuine
  // hand-back shows whether the route still exists.
  const ee = fleet.EE_D;
  await sessions.actAs(ee.email, PASSWORD);

  const eePage = sessions.current();
  await eePage.goto(`${process.env.BASE_URL}${RFI_PENDING_ME}`);
  await eePage.waitForLoadState('networkidle').catch(() => {});
  const eeGrid = new ReassignPage(eePage);
  const hasGrid = await eeGrid.waitForGrid().then(() => true).catch(() => false);
  const withEe = hasGrid && (await eeGrid.collectAllRowIds()).includes(record.code);

  if (withEe) {
    await openFromPendingWithMe(eePage, record.code, 'S3c / EE rejects into a demapped area');
    await new RFIReviewPage(eePage).rejectFromFirstPage('S3 — rejected while the area is demapped');
    note(`S3c: EE ${ee.name} rejected ${record.code} while ${GROUND.workArea} is unmapped`);
  } else {
    note(`S3c: ${record.code} was not with ${ee.name} — assuming an earlier run already rejected it`);
  }

  // Does it reach the CI who is no longer mapped anywhere near this area?
  await sessions.actAs(holder.email, PASSWORD);
  const ciPage = sessions.current();
  await ciPage.goto(`${process.env.BASE_URL}${RFI_PENDING_ME}`);
  await ciPage.waitForLoadState('networkidle').catch(() => {});

  const ciGrid = new ReassignPage(ciPage);
  const ciHasGrid = await ciGrid.waitForGrid().then(() => true).catch(() => false);
  const ids = ciHasGrid ? await ciGrid.collectAllRowIds() : [];
  expect(
    ids.includes(record.code),
    `S3c: STRANDED BY A DEMAP — ${record.code} was rejected back to its CI ${holder.name}, but ` +
    `it is not in their queue (${ids.length} rows) now that nobody is mapped to ` +
    `${GROUND.workArea}. The record has left the EE and reached nobody: this is the live ` +
    `operational hazard S3 exists to detect.`
  ).toBeTruthy();
  note(`S3c: ${record.code} reached ${holder.name} despite the demap`);

  // Reaching the queue is not being able to work. Open it the way the flow
  // does — a rejected row's eye icon lands straight on /re-submit.
  await openFromPendingWithMe(ciPage, record.code, 'S3c / CI opens the resubmit');
  if (!ciPage.url().includes('/re-submit')) {
    const button = ciPage.getByRole('button', { name: /resubmit|edit/i }).first();
    await button.waitFor({ state: 'visible', timeout: 20000 });
    await button.click();
    await ciPage.waitForLoadState('networkidle').catch(() => {});
  }
  expect(ciPage.url(), `S3c: expected the resubmit form, got ${ciPage.url()}`).toContain('/re-submit');

  const values = await new RFICreatePage(ciPage).readFirstPageValues();
  note(`S3c: page 1 reads ${JSON.stringify(values)}`);
  expect(
    values.workArea && values.workArea.includes(GROUND.workArea),
    `S3c: the resubmit form cannot state its own work area — it reads ` +
    `${JSON.stringify(values.workArea)} for a record on ${GROUND.workArea}. With the area ` +
    `demapped, a form rebuilt from WAM would look exactly like this, and the record could not ` +
    `be resubmitted by anyone.`
  ).toBeTruthy();
  note(`S3c: PASS — ${holder.name} can still open and describe ${record.code}`);
});

// --- S3d: an admin still has a way out -------------------------------------
test('S3d: the record is still reassignable while the area is demapped', async () => {
  test.setTimeout(20 * 60 * 1000);
  expect(cleared, 'S3a must have cleared the mapping first').toBe(true);

  await sessions.actAsAdmin();
  const page = sessions.current();
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();
  const row = await reassign.scrollToRowById(record.code);
  await reassign.openReassign(row);
  await reassign.selectAssigneeType(CI_ROLE);

  // The candidate list must still be populated: eligibility comes from Add User
  // provisioning, not WAM (Family E), so demapping the area must not empty it.
  // If it did, an admin tidying up WAM could lock themselves out of the only
  // mechanism for moving the work that tidy-up just orphaned.
  const offered = await reassign.getEligibleAssigneeNames();
  await reassign.closeButton.click().catch(() => {});

  expect(
    offered.length,
    `S3d: with ${GROUND.workArea} demapped, the "Assign to" list is EMPTY — so the records left ` +
    `behind by the demap cannot be reassigned to anybody, and there is no way out at all.`
  ).toBeGreaterThan(0);
  note(`S3d: PASS — ${offered.length} candidates still offered with the area demapped`);
});
