const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { fleetFor, WL_A, WL_B, SERVICE_ORDER, OTHER_VENDOR } = require('../utils/reassign-fleet');
const ReassignPage = require('../pages/ReassignPage');
const { BasePage } = require('../pages/BasePage');

// ===========================================================================
// FAMILY E — is the "Assign to" list correct?
// (docs/reassignment-scenarios.md §3, Family E)
// ===========================================================================
// THE QUESTION THIS FAMILY EXISTS TO ANSWER. Eligibility for reassignment is
// driven by the candidate's ADD USER provisioning — work location and project
// type — and NOT by WAM (app owner, 2026-09-15). That is a surprising rule:
// it means the app will offer you someone with no mapping into the work area at
// all. Family E proves the rule holds in both directions; Family C then asks
// whether such a person can actually do the job.
//
// WHY THIS SPEC MUTATES NOTHING. Every assertion is about what the modal
// OFFERS, so it opens the dialog, reads the list, and closes it without ever
// submitting. That has two consequences worth stating: it needs no ground of
// its own and cannot strand a record, and it is safe to run against a
// pre-existing pending RFI rather than creating one.
//
// WHAT IT MEASURES AGAINST. The purpose-built fleet
// (tests/specs/40_reassign_fleet_setup.spec.js), whose members exist in exactly
// known provisioning states. Reading a list of names proves nothing on its own —
// the value comes from knowing that CI_F is provisioned ONLY in S05b and CI_G
// belongs to a DIFFERENT vendor, so their absence is meaningful rather than
// incidental.
//
// Members missing from the store are REPORTED AND SKIPPED, not failed: a
// half-built fleet should narrow what this run can prove, not disguise it as a
// product defect.
//
// Usage:
//   $env:PULSE_ENV="qa"
//   npx playwright test tests/specs/41_reassign_eligibility.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const RFI_PENDING_OTHERS = '/my-tasks/rfi/list/pending-with-others';

// The three assignee types, with the fleet keys expected to appear under each.
const TYPES = [
  {
    type: 'Contractor Incharge',
    present: ['CI_A', 'CI_B', 'CI_C', 'CI_D', 'CI_E'],
    absent: ['CI_F', 'CI_G'],
    why: {
      CI_F: `provisioned only in ${WL_B}, so the same-work-location rule must exclude it`,
      CI_G: `belongs to vendor "${OTHER_VENDOR}", not the record's "${SERVICE_ORDER}"`,
    },
  },
  {
    type: 'Execution Engineer',
    present: ['EE_A', 'EE_B', 'EE_C', 'EE_D'],
    absent: [],
    why: {},
  },
  {
    type: 'Quality Inspector',
    present: ['QI_A', 'QI_C', 'QI_D'],
    absent: [],
    why: {},
  },
];

let context, page, fleet, rfiId;
const findings = [];
const observed = {};

function note(msg) {
  console.log(`  ${msg}`);
  findings.push(msg);
}

function firstLine(err) {
  return String((err && err.message) || err || '').split(/\r?\n/)[0];
}

// A fleet member's display NAME, which is what the dropdown shows.
function nameOf(key) {
  const m = fleet[key];
  return m ? m.name : null;
}

function describe(key) {
  const m = fleet[key];
  return m ? `${key} (${m.name}, ${m.probes || 'no note'})` : `${key} (NOT IN THE STORE)`;
}

test.beforeAll(async ({ browser }) => {
  expect(process.env.ADMIN_EMAIL, 'ADMIN_EMAIL must be set in .env').toBeTruthy();
  fleet = fleetFor();

  context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();

  const have = Object.keys(fleet);
  console.log(
    `\n=== Family E — "Assign to" eligibility, on ${process.env.BASE_URL} ===\n` +
    `    fleet members in the store: ${have.length ? have.join(', ') : '(none)'}\n` +
    `    record ground: ${WL_A}; a candidate provisioned only in ${WL_B} must not appear\n`
  );
});

test.afterAll(async () => {
  console.log('');
  console.log('--- Family E findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (context) await context.close();
});

// ---------------------------------------------------------------------------
test('0. find a pending RFI in the fleet\'s work location', async () => {
  test.setTimeout(20 * 60 * 1000);

  await loginAsFlowUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, {
    navigateToMyTasks: false,
  });
  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();

  // ANY pending RFI in WL_A will do, and taking an existing one is deliberate:
  // eligibility is a property of the record's WORK LOCATION and vendor, not of
  // its age or its position in the flow, and this spec never modifies whatever
  // it lands on. Codes embed the location (RFI-A-06c-...), so the list itself
  // can be searched without opening anything.
  // collectAllRowIds, not listRowIds: the grid virtualises vertically, so a
  // read of the mounted rows alone cannot show that WL_A is absent. It said
  // exactly that on pulse-test 2026-09-20 while eleven A-06c rows sat below
  // the fold — see ReassignPage.collectAllRowIds.
  const codes = await reassign.collectAllRowIds();
  const match = codes.find((c) => c.includes(WL_A));
  expect(
    match,
    `No pending RFI found in ${WL_A} across all ${codes.length} rows of the list. ` +
    `Rows seen: ${JSON.stringify(codes.slice(0, 10))}. ` +
    `Family E needs one to read the "Assign to" list against — raise an RFI in ${WL_A} ` +
    `and leave it pending.`
  ).toBeTruthy();

  rfiId = match;
  note(`using pending RFI ${rfiId} (read-only — this spec never submits a reassignment)`);
});

// ---------------------------------------------------------------------------
for (const { type, present, absent, why } of TYPES) {
  test(`E: "${type}" offers exactly the candidates provisioned for this work location`, async () => {
    test.setTimeout(20 * 60 * 1000);
    expect(rfiId, 'step 0 must have found a record').toBeTruthy();

    await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const reassign = new ReassignPage(page);
    await reassign.waitForGrid();
    // scrollToRowById, not a bare waitFor: the record found in step 0 sits
    // below the fold of the virtualised grid, so waiting for it to become
    // visible just burns the timeout and then blames the row (pulse-test
    // 2026-09-20).
    const row = await reassign.scrollToRowById(rfiId);
    await reassign.openReassign(row);
    await reassign.selectAssigneeType(type);

    const current = await reassign.getCurrentAssigneeName().catch(() => null);
    const eligible = await reassign.getEligibleAssigneeNames();
    observed[type] = { current, eligible };
    note(`${type}: current="${current}", ${eligible.length} eligible`);

    // --- E1: the current assignee is never offered -------------------------
    if (current) {
      expect(
        eligible,
        `E1: the current ${type} ("${current}") must not appear in its own "Assign to" list`
      ).not.toContain(current);
    }

    // --- E2/E3/E7: everyone provisioned for this work location IS offered ---
    //
    // This is the rule's surprising half. CI_A has NO WAM at all; CI_B is mapped
    // in another work location AND another package; CI_D's package is wrong and
    // CI_E's work area is wrong; EE_B carries a WIND provisioning entry
    // alongside its solar one. Per the app owner, none of that disqualifies
    // anybody — Add User provisioning is what counts.
    for (const key of present) {
      const name = nameOf(key);
      if (!name) { note(`  SKIP ${describe(key)} — not built yet, cannot judge`); continue; }
      // A control arm that IS the record's current assignee is absent by rule
      // E1 (asserted above), not by eligibility. This happens when the only
      // pending record is a pool record raised on the fleet's own cell
      // (pulse-test after the 2026-09-30 RFI DB clear: CI_C/EE_D/QI_D hold
      // CIV-640), so the arm cannot be judged here — say so, do not fail it.
      if (current && name === current) {
        note(`  current assignee, so absent by E1: ${describe(key)}`);
        continue;
      }
      expect(
        eligible,
        `${describe(key)} should be OFFERED for "${type}": it is provisioned in ${WL_A}, and ` +
        `eligibility follows Add User provisioning, NOT WAM. Offered: ${JSON.stringify(eligible)}`
      ).toContain(name);
      note(`  offered: ${describe(key)}`);
    }

    // --- E4/E5: the negative arms ------------------------------------------
    //
    // These carry the real weight. Anyone can pass "the list contains people";
    // only a candidate that SHOULD be excluded can show the filter exists at all.
    for (const key of absent) {
      const name = nameOf(key);
      if (!name) { note(`  SKIP ${describe(key)} — not built yet, cannot judge`); continue; }
      expect(
        eligible,
        `${describe(key)} must NOT be offered for "${type}" — ${why[key]}. ` +
        `Offered: ${JSON.stringify(eligible)}`
      ).not.toContain(name);
      note(`  correctly absent: ${describe(key)}`);
    }

    await reassign.closeButton.click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press('Escape').catch(() => {});
  });
}

// ---------------------------------------------------------------------------
test('E6: the three lists do not leak candidates across roles', async () => {
  test.setTimeout(5 * 60 * 1000);

  const types = Object.keys(observed);
  expect(types.length, 'the per-type tests must have run first').toBeGreaterThan(0);

  // A CI must never be offered as an EE, and so on. Checked across the lists
  // actually captured rather than by re-opening the modal — same evidence, no
  // extra navigation.
  const keysByType = {
    'Contractor Incharge': ['CI_A', 'CI_B', 'CI_C', 'CI_D', 'CI_E'],
    'Execution Engineer': ['EE_A', 'EE_B', 'EE_C', 'EE_D'],
    'Quality Inspector': ['QI_A', 'QI_C', 'QI_D'],
  };

  for (const type of types) {
    const { eligible } = observed[type];
    for (const [otherType, keys] of Object.entries(keysByType)) {
      if (otherType === type) continue;
      for (const key of keys) {
        const name = nameOf(key);
        if (!name) continue;
        expect(
          eligible,
          `E6: ${describe(key)} is a ${otherType} and must not be offered under "${type}" — ` +
          `the reassignment must stay within the same role`
        ).not.toContain(name);
      }
    }
  }
  note('no cross-role leakage between the three "Assign to" lists');
});
