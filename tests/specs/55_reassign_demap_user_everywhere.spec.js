const { test, expect } = require('@playwright/test');
const { getProfile } = require('../config/projects');
const {
  fleetFor, serviceOrderFor, WL_A, WL_B, PKG_MAIN, PKG_OTHER,
} = require('../utils/reassign-fleet');
const { claimRecord } = require('../utils/reassign-records');
const { createSessionFactory } = require('../utils/reassign-session');
const { openAssignmentDialog } = require('../utils/smoke-wam');
const {
  TYPE, fleetMemberByName, rfiQueueHas, openReassignModal, readRecordColumn, openAs,
} = require('../utils/reassign-rfi-ops');
const DashboardPage = require('../pages/DashboardPage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// ===========================================================================
// DEMAP A USER EVERYWHERE — the variant 49 (S3) did not test.
// (docs/reassignment-scenarios.md, section 3h "What this run did NOT test")
// ===========================================================================
// 49 cleared the WORK AREA's Contractor Incharge row, while the record's own CI
// was a different user. This is the sharper incident: the contractor who HOLDS
// the record leaves, and someone removes THEM from every WAM row they have —
// leaving a user with NO mappings at all who is still carrying live work.
//
//   D1  every CI row the record's CI holds (both work locations x both
//       packages) is cleared, and a rescan finds them mapped NOWHERE
//   D2  the in-flight record still names them
//   D3  THE HAZARD: the EE rejects it, it lands on them anyway, and they can
//       open the resubmit form, see their own RFI described, and RESUBMIT
//   D4  it is still reassignable, so an admin has a way out
//
// *** WHILE THIS RUNS the user is mapped nowhere — including BL07, so BL07 has
// no Contractor Incharge (the same state 49 creates). *** Every cleared row is
// recorded BEFORE it is cleared, restored in afterAll however the run ends, and
// the restore is verified by a rescan; a failed restore prints each row to fix
// by hand. A FILE OF ITS OWN — never run it alongside anything else.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/55_reassign_demap_user_everywhere.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const CELLS = [
  { workLocation: WL_A, package: PKG_MAIN },
  { workLocation: WL_A, package: PKG_OTHER },
  { workLocation: WL_B, package: PKG_MAIN },
  { workLocation: WL_B, package: PKG_OTHER },
];

let sessions, fleet, profile, record, holder;
const clearedRows = [];      // { workLocation, package, row } — restored in afterAll
let clearing = false;        // set before the first clear, so afterAll always restores
const findings = [];
function note(msg) { findings.push(msg); console.log(`  ${msg}`); }

function ciFilters(cell) {
  return {
    role: TYPE.CI, cluster: profile.cluster, site: profile.site,
    workLocation: cell.workLocation, package: cell.package,
    serviceOrder: serviceOrderFor(TYPE.CI),
  };
}

async function openCell(cell) {
  const page = await sessions.actAsAdmin();
  return openAssignmentDialog(page, new DashboardPage(page), ciFilters(cell));
}

// Every row in this cell whose assignee is exactly `name` — ONE read of the
// dialog's rows (label on the first line, the assignee(s) after it).
async function rowsHeldBy(wam, name) {
  const texts = await wam.dialog.locator('div.d_grid').allInnerTexts().catch(() => []);
  return texts
    .map((t) => t.split('\n').map((s) => s.replace(/\s*✓\s*$/, '').trim()).filter(Boolean))
    .filter((lines) => lines.length > 1 &&
      lines.slice(1).join(',').split(',').map((s) => s.trim()).includes(name))
    .map((lines) => lines[0]);
}

// Returns { held, unscanned }. A cell that will not open is REPORTED, never
// silently skipped — otherwise "mapped nowhere" could pass without looking.
async function scanEverywhere(name) {
  const held = [];
  const unscanned = [];
  for (const cell of CELLS) {
    const wam = await openCell(cell).catch(() => null);
    if (!wam) { unscanned.push(`${cell.workLocation}/${cell.package}`); continue; }
    await wam.waitForRowsLoaded().catch(() => {});
    for (const row of await rowsHeldBy(wam, name)) held.push({ ...cell, row });
    await wam.closeDialog().catch(() => {});
  }
  return { held, unscanned };
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  fleet = fleetFor();
  profile = getProfile('solar-e2e');
  record = claimRecord('rfi', 'D_USER_DEMAP');
  sessions = createSessionFactory(browser, { log: () => {} });
  console.log(
    `\n=== Demap a user EVERYWHERE, on ${process.env.BASE_URL} ===\n    record: ${record.code}\n` +
    `    *** while this runs, the record's CI is mapped NOWHERE ***\n`
  );
});

test.afterAll(async () => {
  if (clearing) {
    const failed = [];
    for (const c of clearedRows) {
      try {
        const wam = await openCell(c);
        await wam.assignUserIfNeeded(c.row, holder.name);
        await wam.clickSubmit();
        await wam.closeDialog().catch(() => {});
      } catch (err) {
        failed.push({ ...c, reason: String((err && err.message) || err).split(/\r?\n/)[0] });
      }
    }
    // Verify by rescanning — the restore must not be taken on trust.
    const back = holder ? (await scanEverywhere(holder.name).catch(() => ({ held: [] }))).held : [];
    for (const c of clearedRows) {
      const ok = back.some((b) => b.workLocation === c.workLocation && b.package === c.package && b.row === c.row);
      if (!ok && !failed.some((f) => f.row === c.row && f.workLocation === c.workLocation && f.package === c.package)) {
        failed.push({ ...c, reason: 'not found on the rescan after restore' });
      }
    }
    if (failed.length) {
      console.log(
        `\n  *** RESTORE INCOMPLETE — map "${holder && holder.name}" back BY HAND in WAM (role ` +
        `"${TYPE.CI}", Service Order "${serviceOrderFor(TYPE.CI)}") on: ` +
        failed.map((f) => `${f.workLocation}/${f.package}/${f.row} (${f.reason})`).join('; ') + ' ***\n'
      );
    } else {
      note(`RESTORED: ${holder.name} is back on ${clearedRows.map((c) => `${c.workLocation}/${c.package}/${c.row}`).join(', ') || '(nothing to restore)'}`);
    }
  }
  console.log('\n--- demap-everywhere findings ---');
  for (const f of findings) console.log(`  ${f}`);
  if (sessions) await sessions.close();
});

// --- D1 ------------------------------------------------------------------------
test('D1: the record\'s CI is cleared from every WAM row, and a rescan finds them mapped nowhere', async () => {
  test.setTimeout(40 * 60 * 1000);

  const name = await readRecordColumn(sessions, record.code, TYPE.CI);
  holder = fleetMemberByName(fleet, name);
  expect(
    holder,
    `D1: ${record.code}'s CI is "${name}", not a fleet member — this spec cannot log in as them.`
  ).toBeTruthy();
  note(`D1: ${record.code} is held by CI ${holder.name}`);

  const { held, unscanned: notOpened } = await scanEverywhere(holder.name);
  expect(notOpened, `D1: these WAM cells would not open, so the scan is incomplete`).toEqual([]);
  note(`D1: ${holder.name} is mapped on ${held.length} row(s): ` +
    `${held.map((h) => `${h.workLocation}/${h.package}/${h.row}`).join(', ') || '(none)'}`);

  clearing = true;
  for (const cell of CELLS) {
    const rows = held.filter((h) => h.workLocation === cell.workLocation && h.package === cell.package);
    if (!rows.length) continue;
    const wam = await openCell(cell);
    for (const h of rows) {
      clearedRows.push(h);   // recorded BEFORE the clear: afterAll restores it
      const didClear = await wam.clearWorkAreaUser(h.row);
      expect(didClear, `D1: no "Clear value" control on ${h.workLocation}/${h.package}/${h.row}`).toBe(true);
    }
    await wam.clickSubmit();
    await wam.closeDialog().catch(() => {});
  }

  const { held: after, unscanned } = await scanEverywhere(holder.name);
  expect(unscanned, 'D1: the post-clear rescan could not open these WAM cells').toEqual([]);
  expect(
    after,
    `D1: ${holder.name} is still mapped on ${JSON.stringify(after)} after being cleared everywhere.`
  ).toEqual([]);
  note(`D1: ${holder.name} is now mapped NOWHERE (cleared ${clearedRows.length} row(s))`);
});

// --- D2 ------------------------------------------------------------------------
test('D2: the in-flight record still names its CI', async () => {
  test.setTimeout(20 * 60 * 1000);
  expect(holder, 'D1 must have run').toBeTruthy();
  const now = await readRecordColumn(sessions, record.code, TYPE.CI);
  expect(
    now,
    `D2: the record's CI changed when its CI was demapped everywhere — "${holder.name}" -> ` +
    `"${now}". A demap that blanks in-flight records orphans live work.`
  ).toBe(holder.name);
  note(`D2: PASS — ${record.code} still names "${now}"`);
});

// --- D3 ------------------------------------------------------------------------
test('D3: a rejection still reaches that CI, who can open, describe and RESUBMIT the record', async () => {
  test.setTimeout(45 * 60 * 1000);
  expect(holder, 'D1 must have run').toBeTruthy();
  const ee = fleet.EE_D;

  const withHolder = await rfiQueueHas(sessions, holder, record.code);
  if (!withHolder.present) {
    const withEe = await rfiQueueHas(sessions, ee, record.code);
    expect(
      withEe.present,
      `D3: ${record.code} is with neither ${holder.name} nor its EE ${ee.name} — check it by hand.`
    ).toBeTruthy();
    const page = await openAs(sessions, ee, record.code, 'D3 / EE rejects');
    await new RFIReviewPage(page).rejectFromFirstPage('Demap-everywhere — rejected while the CI is mapped nowhere');
    note(`D3: EE ${ee.name} rejected ${record.code}`);

    const reached = await rfiQueueHas(sessions, holder, record.code);
    expect(
      reached.present,
      `D3: STRANDED BY A DEMAP — ${record.code} was rejected back to ${holder.name}, who is mapped ` +
      `nowhere, and it is not in their queue (${reached.rows} rows, confirmed in a fresh session).`
    ).toBeTruthy();
  }
  note(`D3: ${record.code} reached ${holder.name}, who holds no WAM mapping at all`);

  const page = await openAs(sessions, holder, record.code, 'D3 / unmapped CI resubmits');
  if (!page.url().includes('/re-submit')) {
    const button = page.getByRole('button', { name: /resubmit|edit/i }).first();
    await button.waitFor({ state: 'visible', timeout: 20000 });
    await button.click();
    await page.waitForLoadState('networkidle').catch(() => {});
  }
  expect(page.url(), `D3: expected the resubmit form, got ${page.url()}`).toContain('/re-submit');

  const create = new RFICreatePage(page);
  const values = await create.readFirstPageValues();
  note(`D3: page 1 reads ${JSON.stringify(values)}`);
  for (const field of ['workLocation', 'workArea', 'package', 'activity']) {
    expect(
      values[field] && !/^select\b/i.test(values[field]),
      `D3: with its CI mapped nowhere, the resubmit form's "${field}" reads ` +
      `${JSON.stringify(values[field])} — it cannot describe ${record.code}, so nobody can resubmit it.`
    ).toBeTruthy();
  }

  await create.clickProceed();
  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations('OK - resubmitted with no WAM mapping', true);
  await checklist.submitRFI();
  const match = page.url().match(/\/rfi\/([a-f0-9-]+)\/view/i);
  expect(match, `D3: no /view URL after resubmit — got ${page.url()}`).toBeTruthy();
  note(`D3: PASS — ${holder.name}, mapped nowhere, resubmitted ${record.code} (child ${match[1]})`);
});

// --- D4 ------------------------------------------------------------------------
test('D4: the record is still reassignable while its CI is mapped nowhere', async () => {
  test.setTimeout(20 * 60 * 1000);
  expect(holder, 'D1 must have run').toBeTruthy();
  const modal = await openReassignModal(sessions, record.code);
  await modal.selectAssigneeType(TYPE.CI);
  const offered = await modal.getEligibleAssigneeNames();
  await modal.closeButton.click().catch(() => {});
  expect(
    offered.length,
    `D4: with its CI demapped everywhere, ${record.code}'s "Assign to" list is EMPTY — no way out.`
  ).toBeGreaterThan(0);
  note(`D4: PASS — ${offered.length} CI candidates still offered`);
});
