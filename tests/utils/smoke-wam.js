const { expect } = require('@playwright/test');
const WAMPage = require('../pages/WAMPage');

// Shared WAM driver for the smoke feature stages (SM11, SM12, SM13, SM19, SM20,
// SM21, SM22).
//
// WHY THIS MODULE EXISTS. Those seven stages all perform the same cycle —
// open the Add Details dialog, filter it, change some rows, verify before
// submitting, submit, CLOSE AND REOPEN, verify it persisted — and the original
// specs in tests/specs/ each had their own copy. That mattered on 2026-09-04:
// SM04's cascade hit the app closing its own dialog mid-step, twice, at two
// different points, and the fix had to be written into one spec while six other
// copies of the same sequence stayed vulnerable. One implementation means the
// next such quirk is fixed once.
//
// It deliberately does NOT wrap WAMPage. WAMPage owns "how do I talk to this
// dialog"; this owns "what sequence proves an assignment stuck", which is a
// test-level concern and is where the interesting failure modes live.

// The single most important rule in here, and the reason a plain
// `fillAssignmentFilters` call is never enough on its own.
//
// Reading the Role dropdown's options means opening and dismissing an Ark UI
// popover, and this suite has a documented Escape-bubbling bug where dismissing
// a WAM popover closes the WHOLE dialog with it (see WAMPage.addAssigneeToRow).
// Confirmed live on 2026-09-04, twice: once where getAvailableRoleOptions()
// succeeded and the NEXT call timed out for 30s on the Role combobox with no
// dialog on screen at all, and once where the pre-Submit assertion passed and
// then clickSubmit() waited out its full timeout for a Submit button that no
// longer existed.
//
// Both were the same shape — the dialog silently vanishing between two
// statements — so every step that assumes it is open goes through here.
async function ensureDialogOpen(wam, { reason } = {}) {
  if (await wam.dialog.isVisible().catch(() => false)) return false;
  console.log(`    (WAM dialog closed itself${reason ? ` ${reason}` : ''} — reopening)`);
  await wam.openAddDetails();
  return true;
}

// Is the dialog open AND is `row`'s assignee combobox actually interactive?
//
// Returns null when ready, or a human-readable reason when not.
//
// WHY THE ROW CHECK IS SEPARATE FROM THE DIALOG CHECK. When Ark UI closes the
// dialog it hides `[data-part="content"]` but leaves the whole subtree in the
// DOM, so a row locator scoped inside it still RESOLVES — to a hidden element.
// That is what made the 2026-09-04 failure so unhelpful:
//
//     TimeoutError: locator.waitFor: Timeout 30000ms exceeded
//     59 × locator resolved to hidden <button role="combobox" ...>
//
// The row was found fifty-nine times and was hidden every time, because the
// dialog had closed. `openDropdown()` does `trigger.waitFor({state:'visible'})`
// as its first line, so it sat there for the full 30s waiting for something
// that could never become visible.
//
// waitFor rather than isVisible for the row: isVisible({timeout}) is a single
// immediate check, not a wait, so it would report "hidden" for a row that is
// merely still rendering.
async function dialogNotReady(wam, row, { rowTimeout = 8000 } = {}) {
  if (!(await wam.dialog.isVisible().catch(() => false))) return 'the dialog is not visible';
  if (!row) return null;

  const combo = wam.getWorkAreaRow(row).locator('[role="combobox"]');
  const ok = await combo.waitFor({ state: 'visible', timeout: rowTimeout })
    .then(() => true).catch(() => false);
  if (ok) return null;

  const present = await combo.count().catch(() => 0);
  return present
    ? `row "${row}" exists but its combobox is HIDDEN (the dialog closed with its DOM left behind)`
    : `row "${row}" is not present at all`;
}

// Opens the Add Details dialog with `filters` applied and does not return until
// the row it is about to act on is genuinely interactive — retrying the WHOLE
// open-and-filter sequence if not.
//
// ---------------------------------------------------------------------------
// WHY A RETRY LOOP AND NOT ANOTHER ONE-OFF GUARD
// ---------------------------------------------------------------------------
// This dialog closes itself. Confirmed live at four different points across
// three runs on 2026-09-04:
//
//   1. after getAvailableRoleOptions() — reading the Role dropdown means
//      dismissing an Ark UI popover, and Escape BUBBLES when the popover has
//      already closed itself, taking the dialog with it;
//   2. after the pre-Submit assertion, leaving Submit unreachable;
//   3. after a single-select row pick;
//   4. after fillAssignmentFilters — the one that produced the error above,
//      where a guard had ALREADY reopened the dialog once at (1) and the very
//      next step closed it again.
//
// (4) is the important one: it proves a fixed number of checks can never be
// enough. Each guard I added only covered the point it was written for, and the
// dialog simply closed somewhere else. So the sequence is now idempotent and
// retried as a unit, verified by its own postcondition rather than by guessing
// where the next close will happen.
//
// `resolveRow` is a callback rather than a plain label because the Cluster/Site
// rows cannot be named in advance — their rendered label varies ("KHAVDA" vs
// "Khavda" vs "Gujarat" for the same place), so they are resolved from what the
// dialog actually shows, INSIDE the retry, where a failure to resolve is just
// another reason to try again.
//
// Returns { wam, row }.
async function openDialogWithInteractiveRow(page, dashboard, filters, resolveRow, { attempts = 3 } = {}) {
  const wam = new WAMPage(page);
  let lastProblem = 'unknown';

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Full reset each attempt. Re-navigating is what clears a half-torn-down
      // dialog whose backdrop still intercepts clicks — reopening in place has
      // been observed to inherit that state.
      await wam.goto(dashboard);
      await wam.openAddDetails();
      await wam.fillAssignmentFilters(filters);

      const row = await resolveRow(wam);
      const problem = await dialogNotReady(wam, row);
      if (!problem) {
        if (attempt > 1) console.log(`    (WAM dialog ready on attempt ${attempt})`);
        return { wam, row };
      }
      lastProblem = problem;
    } catch (err) {
      lastProblem = `${err.message.split('\n')[0]}`;
    }
    console.log(
      `    (WAM dialog not usable — ${lastProblem}; attempt ${attempt}/${attempts})`
    );
  }

  throw new Error(
    `Could not get the WAM Add Details dialog into a usable state after ${attempts} ` +
    `attempts. Last problem: ${lastProblem}.\n` +
    `Filters were: ${JSON.stringify(filters)}\n` +
    `This dialog is known to close itself at several points (see ` +
    `openDialogWithInteractiveRow); ${attempts} full retries failing means it is ` +
    `closing every time, which is a real app problem rather than the usual flake.`
  );
}

// Navigate to WAM and open the Add Details dialog with `filters` applied.
//
// Thin wrapper over openDialogWithInteractiveRow for callers that do not act on
// one specific known row (the multi-row sweeps, which verify each row as they
// go via assignAndProve). Still retries on a closed dialog — it just has no
// single row to use as its postcondition.
async function openAssignmentDialog(page, dashboard, filters, { attempts = 3 } = {}) {
  const { wam } = await openDialogWithInteractiveRow(
    page, dashboard, filters, () => null, { attempts }
  );
  return wam;
}

// Re-apply the same filters in a freshly reopened dialog.
//
// CLOSE-AND-REOPEN, NOT re-filter-in-place, and the distinction is the whole
// point of the verification. Submit RESETS the dialog's fields but does not
// close it, so re-filtering the same never-closed dialog and reading the rows
// back proves only that front-end state survived — it would pass even if the
// PUT had been rejected. Reopening from the add-icon forces a fresh fetch, so
// what is read back came from the server.
async function reopenWithFilters(wam, filters) {
  await wam.closeDialog();
  await wam.openAddDetails();
  await wam.fillAssignmentFilters(filters);
}

// Assigns `entries` ({ row, userName }) and proves each one persisted.
//
// `multi` picks the interaction, and it is NOT cosmetic: work-area rows for
// Execution Engineer / Quality Inspector / Contractor Incharge are
// SINGLE-ASSIGNEE (one pick replaces whoever held the row), whereas the
// Cluster/Site/Work-Location rows for the admin tiers genuinely hold several
// people at once. Using the single-select path on a multi-assignee row would
// silently drop everyone else; using the multi-select path on a single-select
// row means clicking an already-selected option, which for Ark UI TOGGLES IT
// OFF (that is what once wiped Cluster Admin's row to empty — see
// WAMPage.addAnyUnassignedUser's header).
//
// Returns the rows that actually changed, so a caller can assert the precise
// Submit toast rather than accepting either.
async function assignAndProve(wam, { filters, entries, multi = false, label = '' }) {
  const tag = label ? `${label}: ` : '';
  const changed = [];

  // RE-FILTER after any reopen. openAddDetails() gives a blank dialog, so
  // reopening without re-applying the filters leaves no rows at all — the row
  // lookups below would then fail with "not present" rather than "hidden",
  // which looks like a completely different (data) problem.
  if (await ensureDialogOpen(wam, { reason: 'before assigning' })) {
    await wam.fillAssignmentFilters(filters);
  }

  for (const { row, userName } of entries) {
    const didChange = multi
      ? await wam.addAssigneeToRow(row, userName)
      : await wam.assignUserIfNeeded(row, userName);
    if (didChange) changed.push(row);
    console.log(`    ${tag}${row} <- "${userName}" (${multi ? 'multi' : 'single'}, changed=${didChange})`);
  }

  // Every row must show its user BEFORE Submit, so a silent assign-failure is
  // caught here instead of being misattributed to the submit.
  for (const { row, userName } of entries) {
    await expect(
      wam.getWorkAreaRow(row).locator('[role="combobox"]'),
      `${tag}"${userName}" should be selected on row ${row} before Submit`
    ).toContainText(userName);
  }

  // The dialog can vanish between that assertion passing and Submit being
  // reachable — see ensureDialogOpen. Redo the picks if so; every call here is
  // idempotent, so repeating costs a little time and changes nothing.
  if (await ensureDialogOpen(wam, { reason: 'after the pre-Submit check' })) {
    await wam.fillAssignmentFilters(filters);
    for (const { row, userName } of entries) {
      if (multi) await wam.addAssigneeToRow(row, userName);
      else await wam.assignUserIfNeeded(row, userName);
    }
    for (const { row, userName } of entries) {
      await expect(
        wam.getWorkAreaRow(row).locator('[role="combobox"]'),
        `${tag}"${userName}" should be selected on row ${row} before Submit (after reopen)`
      ).toContainText(userName);
    }
  }

  const toast = await wam.clickSubmit();
  console.log(`    ${tag}submitted: changed=${changed.length}/${entries.length}, toast="${toast}"`);

  // AN EMPTY TOAST IS NOT A FAILURE, and this is not leniency — it is a
  // confirmed app behaviour that 13_wam_all_roles.spec.js found the hard way.
  //
  // A large-payload Work Location (A-06c has 85 work-area rows, not the 20
  // "BL0x" the early specs assumed) can make the PUT come back 502 with no
  // toast at all, while the assignment DOES persist server-side — verified
  // against the actual stored records. It is the HTTP round-trip that is flaky,
  // not the save.
  //
  // So the toast is corroboration, never the proof. The proof is always the
  // close-reopen-reverify below, which reads state back from the server and
  // would catch a genuinely lost write regardless of what the toast said.
  if (!toast) {
    console.log(
      `    ${tag}no toast text — possible gateway/502 blip on a large payload. ` +
      `Relying on the reopen check below, which reads server state.`
    );
  } else {
    expect(
      toast,
      `${tag}Submit reported "${toast}", which is neither a successful assignment nor ` +
      `an explicit no-change`
    ).toMatch(changed.length ? /Assigned successfully/i : /Assigned successfully|No changes to save/i);
  }

  await reopenWithFilters(wam, filters);
  for (const { row, userName } of entries) {
    const persisted = await wam.getWorkAreaUserValue(row);
    expect(
      persisted,
      `${tag}"${userName}" should still be on row ${row} after closing and reopening the ` +
      `dialog — if this fails the assignment was accepted client-side but never stored`
    ).toContain(userName);
  }
  console.log(`    ${tag}confirmed persisted on ${entries.length} row(s) after reopen`);

  await wam.closeDialog();
  return changed;
}

// Puts `userName` back on `row` and proves it, for the mutating stages
// (SM19-SM22) and the SM27 baseline restore.
//
// App owner, 2026-09-04: "after checking creation mapping demapping old SM01
// users should be restored". A stage that clears or re-points a row and then
// dies has left the chain's ground wrong for the NEXT run, and because
// Playwright reports the failure at the point of death there is nothing in the
// report to say the ground is now dirty. So restoration is a first-class
// operation with its own assertion, not a best-effort afterthought.
async function restoreRow(page, dashboard, { filters, row, userName, label = 'restore' }) {
  const wam = await openAssignmentDialog(page, dashboard, filters);
  const current = await wam.getWorkAreaUserValue(row);
  if (current.includes(userName)) {
    console.log(`    ${label}: ${row} already holds "${userName}" — nothing to restore`);
    await wam.closeDialog();
    return false;
  }
  console.log(`    ${label}: ${row} holds "${current}", restoring "${userName}"`);
  await assignAndProve(wam, { filters, entries: [{ row, userName }], label });
  return true;
}

module.exports = {
  ensureDialogOpen,
  dialogNotReady,
  openDialogWithInteractiveRow,
  openAssignmentDialog,
  reopenWithFilters,
  assignAndProve,
  restoreRow,
};
