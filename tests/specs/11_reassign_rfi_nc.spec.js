const { test, expect } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const ReassignPage = require('../pages/ReassignPage');

// Admin can reassign Contractor Incharge / Execution Engineer / Quality
// Inspector on any RFI/NC that isn't yet approved/closed (confirmed: Admin
// is the only role that can reassign all three assignee types, per the
// app's reassignment rules — CI/EE/QI-level roles are each restricted to
// reassigning within their own single role).
//
// The CI/EE/QI columns are located by HEADER NAME at run time, never by a
// hardcoded aria-colindex: this spec used 5/6/7 from a one-off DOM dump, and
// on pulse-test 2026-09-30 column 5 was the Work Area ("BL07"), so a correct
// reassignment read back as a wrong value. See
// ReassignPage.resolveColumnIndexByHeader; the header names match
// tests/utils/reassign-rfi-ops.js (EE/QI are "Assigned EE" / "Assigned QI").
const ASSIGNEE_TYPES = [
  { label: 'Contractor Incharge', headers: ['Contractor Incharge', 'Contractor In-Charge'] },
  { label: 'Execution Engineer', headers: ['Assigned EE', 'Execution Engineer'] },
  { label: 'Quality Inspector', headers: ['Assigned QI', 'Quality Inspector'] },
];

// Fill in a specific RFI/NC id here to target it manually (must currently
// be a "Pending with others" row — i.e. not yet approved/closed). Leave
// null to fall back to whichever row is first in the list at run time.
const TARGET_RFI_ID = null; // e.g. 'RFI-A-06c-BL01-CIV-528'
const TARGET_NC_ID = null; // e.g. 'NC-S-07b - 300MW-BL02-CIV-22'

// Runs all three reassignment types (CI, EE, QI) against one row — either
// the manually specified id, or the first pending row if none was given —
// re-locating it by id before each one since a prior reassignment changes
// the row's Updated At, which can move it to a different position in the
// (Updated-At-sorted) list.
async function reassignAllTypesOnRow(page, listUrl, entityLabel, manualId) {
  const reassign = new ReassignPage(page);
  await reassign.waitForGrid();

  let rowId;
  if (manualId) {
    rowId = manualId;
    await reassign.getRowById(rowId).waitFor({ state: 'visible', timeout: 15000 });
    console.log(`${entityLabel}: using manually specified id "${rowId}"`);
  } else {
    rowId = await reassign.getRowId(reassign.getFirstRow());
    expect(rowId, `Could not read an id from the first ${entityLabel} row`).toBeTruthy();
    console.log(`${entityLabel}: no id specified, using first available pending row "${rowId}"`);
  }

  for (const { label, headers } of ASSIGNEE_TYPES) {
    await page.goto(listUrl);
    await page.waitForLoadState('networkidle');
    await reassign.waitForGrid();

    const row = reassign.getRowById(rowId);
    await row.waitFor({ state: 'visible', timeout: 15000 });

    await reassign.openReassign(row);
    await reassign.selectAssigneeType(label);

    const currentAssignee = await reassign.getCurrentAssigneeName();
    const eligible = await reassign.getEligibleAssigneeNames();

    if (eligible.length === 0) {
      console.log(`${entityLabel} ${rowId}: role "${label}" not available to reassign - no eligible users, skipping`);
      continue;
    }
    expect(eligible, `Eligible ${label} list should exclude the current assignee`).not.toContain(currentAssignee);

    const newAssignee = eligible[0];
    await reassign.selectNewAssignee(newAssignee);
    await reassign.submitAssignUser();

    // Confirm the grid's own column reflects the new assignee after the
    // mutation, not just that the modal closed without error.
    await page.goto(listUrl);
    await page.waitForLoadState('networkidle');
    await reassign.waitForGrid();
    const updatedRow = reassign.getRowById(rowId);
    await updatedRow.waitFor({ state: 'visible', timeout: 15000 });
    const colIndex = await reassign.resolveColumnIndexByHeader(headers);
    expect(colIndex, `no "${label}" column header in the ${entityLabel} grid (tried ${headers.join(' / ')})`).not.toBeNull();
    const updatedCell = await reassign.scrollUntilColumnVisible(updatedRow, colIndex);
    await expect(updatedCell).toHaveText(newAssignee, { timeout: 15000 });

    console.log(`${entityLabel} ${rowId}: ${label} reassigned from "${currentAssignee}" to "${newAssignee}"`);
  }
}

test.describe('Admin - Reassign RFI/NC', () => {
  // Running both headed Admin sessions concurrently (2 full browser windows
  // doing real logins + grid scrolling at once) starved each other enough to
  // blow the row-lookup timeouts, even though each test is fully reliable on
  // its own — confirmed live: both passed individually, both flaked only
  // when run in parallel. Same tradeoff already made for the RFI flow specs.
  test.describe.configure({ mode: 'serial' });

  test('Admin can reassign CI, EE and QI on a pending RFI', async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    const { context, page } = await adminFreshLogin(browser);
    try {
      const listUrl = `${process.env.BASE_URL}/my-tasks/rfi/list/pending-with-others`;
      await page.goto(listUrl);
      await page.waitForLoadState('networkidle');

      await reassignAllTypesOnRow(page, listUrl, 'RFI', TARGET_RFI_ID);
    } finally {
      await context.close();
    }
  });

  test('Admin can reassign CI, EE and QI on a pending NC', async ({ browser }) => {
    test.setTimeout(10 * 60 * 1000);
    const { context, page } = await adminFreshLogin(browser);
    try {
      const listUrl = `${process.env.BASE_URL}/my-tasks/nc/list/pending-with-others`;
      await page.goto(listUrl);
      await page.waitForLoadState('networkidle');

      await reassignAllTypesOnRow(page, listUrl, 'NC', TARGET_NC_ID);
    } finally {
      await context.close();
    }
  });
});
