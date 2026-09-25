const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { fleetFor } = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const ReassignPage = require('../pages/ReassignPage');

// ===========================================================================
// FAMILY R — WHO MAY REASSIGN WHOM (docs/reassignment-scenarios.md section 3,
// Family R). The rules, as confirmed by the app owner:
//
//   Contractor Manager -> Contractor In-Charge
//   Execution Lead     -> Execution Engineer
//   Quality Lead       -> Quality Inspector
//   Project Manager    -> Execution Engineer, Quality Inspector
//   Admin              -> all three
//
// THIS IS THE FAMILY WHERE A BUG COSTS THE MOST. Eligibility (Family E) is
// about which NAMES a permitted reassigner sees; this is about whether the
// reassigner should be able to re-route that work at all. A leak here lets one
// discipline's manager move another discipline's inspection work.
//
// READ-ONLY. Every case opens the modal, reads it and closes without
// submitting, so this spec needs no ground of its own, cannot strand a record,
// and can be re-run any number of times.
//
// THE ASSERTION IS ROLE-SHAPED, NOT POSITIONAL. The modal ADAPTS: a role
// permitted exactly one type gets a single dropdown holding PEOPLE and no type
// choice at all, while Admin gets two. So each case below asks what a dropdown
// CONTAINS (role names => the type picker) rather than reading `.first()` — the
// mistake that made the 2026-09-16 recon report a leak that did not exist.
//
// Acts on the pool's R_READ record (42_reassign_rfi_records_setup), not on
// "whatever is at the top of the list": a shared list is written to by every
// other tier, so picking the newest row means a re-run can silently measure a
// different record — or someone else's.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/44_reassign_permissions.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const RFI_PENDING_OTHERS = '/my-tasks/rfi/list/pending-with-others';

// A combobox is the TYPE picker only if its options are role names.
const ROLE_WORDS = /contractor in-?charge|execution engineer|quality inspector/i;

const SINGLE_TYPE_ROLES = [
  { key: 'RA_CM', role: 'Contractor Manager', mayReassign: 'Contractor Incharge', ownKeys: ['CI_A', 'CI_B', 'CI_C', 'CI_D', 'CI_E'], foreignKeys: ['EE_A', 'EE_D', 'QI_A', 'QI_D'] },
  { key: 'RA_EL', role: 'Execution Lead', mayReassign: 'Execution Engineer', ownKeys: ['EE_A', 'EE_B', 'EE_C', 'EE_D'], foreignKeys: ['CI_A', 'CI_C', 'QI_A', 'QI_D'] },
  { key: 'RA_QL', role: 'Quality Lead', mayReassign: 'Quality Inspector', ownKeys: ['QI_A', 'QI_C', 'QI_D'], foreignKeys: ['CI_A', 'CI_C', 'EE_A', 'EE_D'] },
];

let context, page, fleet, record;
const findings = [];

function note(msg) {
  findings.push(msg);
  console.log(`  ${msg}`);
}

function nameOf(key) {
  return fleet[key] && fleet[key].name;
}

// Opens the pool record's Reassign modal as whoever is currently logged in.
// Returns the dialog's dropdowns, or null when the row is not reachable at all.
async function openModalOnPoolRecord(label) {
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();

  // scrollToRowById, not a bare waitFor — the grid virtualises vertically and
  // the record is rarely at the top. See ReassignPage.collectAllRowIds.
  const row = await reassign.scrollToRowById(record.code).catch((err) => {
    note(`${label}: ${record.code} is not in this reassigner's list — ${String(err.message).split('\n')[0]}`);
    return null;
  });
  if (!row) return null;

  await reassign.openReassign(row);
  const dump = await reassign.dumpDialogComboboxes();
  return { reassign, dump };
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  fleet = fleetFor();
  record = claimRecord('rfi', 'R_READ');

  context = await browser.newContext();
  page = await context.newPage();

  console.log(
    `\n=== Family R — who may reassign whom, on ${process.env.BASE_URL} ===\n` +
    `    record under test: ${record.code} (read-only — nothing here submits a reassignment)\n`
  );
});

test.afterAll(async () => {
  console.log('\n--- Family R findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (context) await context.close();
});

// --- R1..R3: the single-type roles ----------------------------------------
for (const { key, role, mayReassign, ownKeys, foreignKeys } of SINGLE_TYPE_ROLES) {
  test(`R: ${role} may reassign ${mayReassign}, and nothing else`, async () => {
    test.setTimeout(15 * 60 * 1000);

    const user = fleet[key];
    expect(user && user.email, `${key} must be in the fleet — run 40_reassign_fleet_setup first`).toBeTruthy();

    await loginAsFlowUser(page, user.email, PASSWORD);
    const opened = await openModalOnPoolRecord(role);
    expect(
      opened,
      `${role} could not open the Reassign modal on ${record.code}. A reassigner only sees ` +
      `records in the work area they are MAPPED to, so check ${key}'s WAM before reading this ` +
      `as a permission failure.`
    ).toBeTruthy();

    const { reassign, dump } = opened;
    const typeBox = dump.boxes.find((b) => b.options.some((o) => ROLE_WORDS.test(o)));
    const peopleBox = dump.boxes.find((b) => b !== typeBox);

    // (a) No type choice at all — the app does not offer a decision this role
    //     is not permitted to make. This is the strongest shape of the rule:
    //     the permission is enforced by ABSENCE, exactly as an approved RFI
    //     hides its reassign icon entirely (discovery item B1).
    expect(
      typeBox,
      `${role} is permitted exactly one assignee type (${mayReassign}), so the modal must offer ` +
      `no type choice. It offered: ${JSON.stringify(typeBox && typeBox.options)}`
    ).toBeFalsy();

    expect(peopleBox, `${role}'s modal should still offer a list of people to assign to`).toBeTruthy();
    const offered = peopleBox.options;
    note(`${role}: 1 dropdown "${peopleBox.label}", ${offered.length} people, no type choice`);

    // (b) The people offered are of the RIGHT ROLE. Asserted through the fleet,
    //     because its members' roles are known by construction — every other
    //     name in the list belongs to a user this suite did not create and
    //     cannot make claims about.
    const ownPresent = ownKeys.map(nameOf).filter(Boolean).filter((n) => offered.includes(n));
    expect(
      ownPresent.length,
      `${role}'s list should contain at least one fleet ${mayReassign} ` +
      `(looked for ${JSON.stringify(ownKeys.map(nameOf))}). Offered: ${JSON.stringify(offered.slice(0, 12))}`
    ).toBeGreaterThan(0);

    // (c) ...and NOBODY of another role. This is the leak test, and the reason
    //     the fleet carries a control arm for each of the three roles.
    for (const foreign of foreignKeys) {
      const name = nameOf(foreign);
      if (!name) continue;
      expect(
        offered,
        `LEAK: ${role} may reassign only ${mayReassign}, but its list offers ${foreign} (${name}), ` +
        `who is a ${fleet[foreign].role}.`
      ).not.toContain(name);
    }
    note(`${role}: offers ${ownPresent.length} fleet ${mayReassign}(s), no cross-role names`);

    await reassign.closeButton.click().catch(() => {});
  });
}

// --- R4: Admin -------------------------------------------------------------
test('R: Admin may reassign all three types', async () => {
  test.setTimeout(15 * 60 * 1000);

  await loginAsFlowUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, {
    navigateToMyTasks: false,
  });
  const opened = await openModalOnPoolRecord('Admin');
  expect(opened, `Admin could not open the Reassign modal on ${record.code}`).toBeTruthy();

  const { reassign, dump } = opened;
  const typeBox = dump.boxes.find((b) => b.options.some((o) => ROLE_WORDS.test(o)));
  expect(typeBox, 'Admin must get a type dropdown — it is the one role that chooses between all three').toBeTruthy();

  for (const type of ['Contractor Incharge', 'Execution Engineer', 'Quality Inspector']) {
    expect(
      typeBox.options.some((o) => o.includes(type)),
      `Admin's type list must offer "${type}". It offered: ${JSON.stringify(typeBox.options)}`
    ).toBeTruthy();
  }
  note(`Admin: type dropdown offers ${JSON.stringify(typeBox.options)}`);

  await reassign.closeButton.click().catch(() => {});
});

// --- R5: Project Manager — THE KNOWN DEFECT --------------------------------
//
// MARKED test.fail() DELIBERATELY: this asserts the rule as the app owner's
// "Reassignment Rules by Role" screen states it, and the app does NOT currently
// meet it. Measured identically on pulse-qa (2026-09-16, twice) and pulse-test
// (2026-09-20, twice): the type list offers
//
//     ["Contractor Incharge", "Execution Engineer"]
//
// i.e. Contractor Incharge is offered where it must not be — a PM re-routing
// contractor work — and Quality Inspector is missing where it must be present.
// Eligible QIs demonstrably exist for the record: Admin lists them for the same
// RFI moments earlier, so this is not an empty-candidate-list artefact.
//
// WHY test.fail() RATHER THAN A SKIP OR AN INVERTED ASSERTION. A skip records
// nothing and rots quietly. Asserting the app's CURRENT behaviour would bake the
// defect in as the expectation, and the day it is fixed the suite would fail and
// blame the fix. test.fail() encodes exactly what is true: the rule is known,
// the app does not meet it, and IF THIS TEST EVER PASSES the run goes red — which
// is the signal that the app changed and this file needs its verdict updated.
//
// The open question is the app owner's to settle, and it is recorded in
// docs/reassignment-scenarios.md section 3a: is the rules screen the
// specification, or is the app's behaviour the intended rule?
test('R: Project Manager may reassign Execution Engineer and Quality Inspector', async () => {
  // Inside the test body, NOT at file scope: a bare test.fail() at file scope
  // marks every test declared after it, so a case added below this one would
  // silently inherit "expected to fail" — and a genuinely broken new test would
  // then read as green.
  test.fail();
  test.setTimeout(15 * 60 * 1000);

  const user = fleet.RA_PM;
  expect(user && user.email, 'RA_PM must be in the fleet').toBeTruthy();

  await loginAsFlowUser(page, user.email, PASSWORD);
  const opened = await openModalOnPoolRecord('Project Manager');
  expect(opened, `Project Manager could not open the Reassign modal on ${record.code}`).toBeTruthy();

  const { reassign, dump } = opened;
  const typeBox = dump.boxes.find((b) => b.options.some((o) => ROLE_WORDS.test(o)));
  expect(typeBox, 'Project Manager gets a type dropdown — it may reassign more than one type').toBeTruthy();

  const offered = typeBox.options;
  note(`Project Manager: type dropdown offers ${JSON.stringify(offered)}`);

  expect(
    offered.some((o) => /quality inspector/i.test(o)),
    `Project Manager must be able to reassign a Quality Inspector. Offered: ${JSON.stringify(offered)}`
  ).toBeTruthy();
  expect(
    offered.some((o) => /contractor in-?charge/i.test(o)),
    `Project Manager must NOT be offered Contractor Incharge — that is contractor work. ` +
    `Offered: ${JSON.stringify(offered)}`
  ).toBeFalsy();

  await reassign.closeButton.click().catch(() => {});
});
