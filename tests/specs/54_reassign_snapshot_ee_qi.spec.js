const { test, expect } = require('@playwright/test');
const { getProfile } = require('../config/projects');
const { fleetFor, serviceOrderFor } = require('../utils/reassign-fleet');
const { claimRecord, GROUND } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const { assignAndProve, openAssignmentDialog } = require('../utils/smoke-wam');
const { createLinkedNcFlow } = require('../utils/linked-nc-flow');
const { getVisibleCodeFor } = require('../utils/rfi-dependency-flow');
const {
  TYPE, fleetMemberByName, reassignRfi, readRecordColumn,
} = require('../utils/reassign-rfi-ops');
const DashboardPage = require('../pages/DashboardPage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// ===========================================================================
// FAMILY S, row S5 — the frozen snapshot, for the EE and QI legs.
// (docs/reassignment-scenarios.md, Family S; the rule is section 1.2 item 2)
// ===========================================================================
// 47 proved S1/S2/S4 for the CONTRACTOR INCHARGE. The rule is the same for the
// reviewers, and a regression could break one leg without the other, so here it
// is for the Execution Engineer and the Quality Inspector together:
//
//   S1  remap BL07's EE and QI -> the in-flight record still carries its OWN
//   S2  a record created AFTER the remap carries the NEW EE and QI — the control
//       that proves S1 measured the snapshot, not a remap that never took
//   S4  explicit reassignment DOES move the old record's EE and QI
//
// THIS SPEC REWRITES WAM AND PUTS IT BACK. BL07's EE and QI rows are read before
// anything changes, restored in afterAll however the run ends, and the restore
// is RE-READ after a fresh reopen. A failed restore prints the exact rows to fix
// by hand. Run it on its own, like 47 and 49.
//
// S2 costs one Work Section on BL07. It picks a FREE one (createRfiOnFreeSection
// learns from the app's own refusal), because the linked NC raised by 51 blocks
// RFI create on its (checkpoint, work section).
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/54_reassign_snapshot_ee_qi.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const LEGS = [TYPE.EE, TYPE.QI];

// The pool's own activity chain, so the S2 record is comparable.
const FIXTURE = {
  baseData: {
    workLocation: GROUND.workLocation,
    workArea: GROUND.workArea,
    package: GROUND.package,
    subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
    activity: 'Piling - MMS',
    subActivity: 'Piling - MMS',
    rfiQuantity: null,
    unit: null,
    subContractor: null,
  },
  checkpoint: { name: 'Pre Pour Inspection - Pile', checklist: 'Micro Pile Checklist' },
};

let sessions, fleet, profile, record;
const wamBefore = {};        // role -> who BL07's row held when we arrived
const remappedTo = {};       // role -> who it holds after S1
const recordBefore = {};     // role -> who the in-flight record carried
const findings = [];
function note(msg) { findings.push(msg); console.log(`  ${msg}`); }

function filtersFor(role) {
  return {
    role, cluster: profile.cluster, site: profile.site,
    workLocation: GROUND.workLocation, package: GROUND.package,
    // Vendor-side roles (the CI) offer ZERO rows without a Service Order.
    serviceOrder: serviceOrderFor(role),
  };
}

async function readWam(role) {
  const page = await sessions.actAsAdmin();
  const wam = await openAssignmentDialog(page, new DashboardPage(page), filtersFor(role));
  const value = ((await wam.getWorkAreaUserValue(GROUND.workArea)) || '').trim();
  await wam.closeDialog().catch(() => {});
  return value;
}

async function mapTo(role, userName, label) {
  const page = await sessions.actAsAdmin();
  const filters = filtersFor(role);
  const wam = await openAssignmentDialog(page, new DashboardPage(page), filters);
  // EE / QI work-area rows are SINGLE-assignee: a pick replaces the holder.
  await assignAndProve(wam, { filters, entries: [{ row: GROUND.workArea, userName }], label });
  note(`${label}: ${GROUND.workArea} ${role} <- ${userName}`);
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  profile = getProfile('solar-e2e');
  record = claimRecord('rfi', 'S_SNAPSHOT_EE_QI');
  sessions = createSessionFactory(browser, { log: () => {} });
  console.log(
    `\n=== Family S5 — EE / QI snapshot, on ${process.env.BASE_URL} ===\n` +
    `    in-flight record: ${record.code}\n` +
    `    *** while this runs, ${GROUND.workArea}'s EE and QI rows point at other users ***\n`
  );
});

test.afterAll(async () => {
  // RESTORE, ALWAYS, and VERIFY — every reassignment spec and the app owner's
  // manual testing depend on BL07's EE / QI mapping.
  for (const role of LEGS) {
    if (!remappedTo[role] || !wamBefore[role] || remappedTo[role] === wamBefore[role]) continue;
    try {
      await mapTo(role, wamBefore[role], `RESTORE ${role}`);
      const now = await readWam(role);
      expect(now, `the ${role} restore must persist`).toContain(wamBefore[role]);
      note(`RESTORED: ${GROUND.workArea} ${role} = "${now}"`);
    } catch (err) {
      const msg = String((err && err.message) || err).split(/\r?\n/)[0];
      console.log(
        `\n  *** RESTORE FAILED: ${GROUND.workLocation}/${GROUND.workArea} ${role} is still ` +
        `"${remappedTo[role]}" — set it back to "${wamBefore[role]}" BY HAND in WAM ` +
        `(role "${role}", ${GROUND.workLocation} / ${GROUND.package}, row ${GROUND.workArea}). ` +
        `Reason: ${msg} ***\n`
      );
    }
  }
  console.log('\n--- S5 findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- S1 ----------------------------------------------------------------------
test('S1 (EE/QI): remapping the work area does NOT move an in-flight record\'s EE or QI', async () => {
  test.setTimeout(40 * 60 * 1000);

  for (const role of LEGS) {
    recordBefore[role] = await readRecordColumn(sessions, record.code, role);
    expect(recordBefore[role], `${record.code} must show a ${role} to begin with`).toBeTruthy();
    wamBefore[role] = await readWam(role);
    expect(
      wamBefore[role],
      `${GROUND.workArea} has no ${role} mapped — nothing to remap, and nothing to restore.`
    ).toBeTruthy();
    note(`S1: ${record.code} carries ${role} "${recordBefore[role]}"; WAM maps "${wamBefore[role]}"`);
  }

  const candidates = {
    [TYPE.EE]: [fleet.EE_C, fleet.EE_A],
    [TYPE.QI]: [fleet.QI_C, fleet.QI_A],
  };
  for (const role of LEGS) {
    const replacement = candidates[role].find((m) => m && m.name !== wamBefore[role] && m.name !== recordBefore[role]);
    expect(replacement, `need a fleet ${role} other than the current one`).toBeTruthy();
    // Recorded BEFORE the remap: if it submits and then throws, afterAll must
    // still restore. (A restore that turns out unnecessary just re-maps the
    // original user, which is harmless.)
    remappedTo[role] = replacement.name;
    await mapTo(role, replacement.name, `S1 remap ${role}`);
  }

  for (const role of LEGS) {
    const after = await readRecordColumn(sessions, record.code, role);
    expect(
      after,
      `S1: the in-flight record's ${role} FOLLOWED a WAM remap — "${recordBefore[role]}" before, ` +
      `"${after}" after. Assignees are snapshotted at creation; if a remap propagated, live review ` +
      `work would re-route to someone who never accepted it.`
    ).toBe(recordBefore[role]);
    note(`S1: PASS — ${record.code} still carries ${role} "${after}" (area now "${remappedTo[role]}")`);
  }
});

// --- S2 ----------------------------------------------------------------------
test('S2 (EE/QI): a record created AFTER the remap carries the NEW EE and QI', async () => {
  test.setTimeout(40 * 60 * 1000);
  for (const role of LEGS) expect(remappedTo[role], 'S1 must have remapped first').toBeTruthy();

  // Raised by whoever BL07's CI row maps — the same way the pool was raised.
  const ciName = await readWam(TYPE.CI).catch(() => '');
  const creator = fleetMemberByName(fleet, ciName) || fleet.CI_C;
  note(`S2: raising a new RFI on ${GROUND.workArea} as ${creator.name}`);

  const page = await sessions.actAs(creator.email, PASSWORD);
  const flow = createLinkedNcFlow({ page, note });
  await flow.createRfiOnFreeSection(FIXTURE);
  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations('OK - S5 control record', true);
  await checklist.submitRFI();
  const match = page.url().match(/\/rfi\/([a-f0-9-]+)\/view/i);
  expect(match, `S2: no /view URL after submitting — got ${page.url()}`).toBeTruthy();
  const newCode = await getVisibleCodeFor(page, match[1]);
  expect(newCode, 'S2: the new record needs a real code').not.toMatch(/DRAFT/i);
  note(`S2: new record ${newCode} (${match[1]})`);

  for (const role of LEGS) {
    const carried = await readRecordColumn(sessions, newCode, role);
    expect(
      carried,
      `S2: a record created AFTER the remap carries ${role} "${carried}", not the newly mapped ` +
      `"${remappedTo[role]}". Then the remap never took effect, and S1 proves nothing.`
    ).toBe(remappedTo[role]);
    note(`S2: PASS — ${newCode} carries ${role} "${carried}"`);
  }
});

// --- S4 ----------------------------------------------------------------------
test('S4 (EE/QI): reassigning explicitly moves the old record\'s EE and QI', async () => {
  test.setTimeout(30 * 60 * 1000);
  for (const role of LEGS) expect(remappedTo[role], 'S1 must have remapped first').toBeTruthy();

  for (const role of LEGS) {
    await reassignRfi(sessions, record.code, role, remappedTo[role], note);
    const after = await readRecordColumn(sessions, record.code, role);
    expect(
      after,
      `S4: the explicit ${role} reassignment did not take — ${record.code} shows "${after}", ` +
      `not "${remappedTo[role]}". WAM does not migrate in-flight records, so if reassignment does ` +
      `not either, nothing does.`
    ).toBe(remappedTo[role]);
    note(`S4: PASS — ${record.code} ${role} "${recordBefore[role]}" -> "${after}"`);
  }
});
