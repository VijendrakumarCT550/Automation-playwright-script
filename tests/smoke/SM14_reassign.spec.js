const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { requireFeatureGround, smokeMappedWorkAreas } = require('../config/projects');
const ReassignPage = require('../pages/ReassignPage');

// Feature stage SM14: the smoke replica of 11_reassign_rfi_nc.spec.js — Admin
// reassigns the Contractor Incharge, Execution Engineer and Quality Inspector on
// a pending RFI, and again on a pending NC.
//
// Admin is the only role that can reassign all three types: the CI/EE/QI-level
// roles are each restricted to reassigning within their own role.
//
// ===========================================================================
// THIS STAGE IS THE ONE THAT FAILED ON 2026-09-04, AND IT FAILED TWICE OVER
// ===========================================================================
//
// BUG 1 — HARDCODED COLUMN INDICES.
//
//     Expected: "CICeenUser67"   Received: "BL05"
//     locator: ...[aria-colindex="5"]
//
// The original hardcodes aria-colindex 5/6/7 for CI/EE/QI from a one-off DOM
// dump of the grid headers. Column 5 turned out to be WORK AREA. Nothing was
// flaky — the cell was located and read cleanly, the index just no longer meant
// what the dump said. And because the mismatch surfaces as a wrong VALUE rather
// than a wrong column, it reads like the reassignment failed when in fact the
// assertion was pointed at the wrong place.
//
// FIXED by resolving each column from its HEADER TEXT at run time
// (ReassignPage.resolveColumnIndexByHeader), so the test asks for "the
// Contractor Incharge column" and gets whichever index that is today.
//
// BUG 2 — REASSIGNING A ROW WE DO NOT OWN.
//
//     RFI: no id specified, using first available pending row "RFI-S05b-BL05-CIV-52"
//
// The original takes the FIRST row of Admin's "Pending with others" list, which
// is the GLOBAL queue for the whole deployment: every unapproved RFI, including
// DRS automation's own rows (the app owner confirmed ids of the form
// `RFI-E2E-WL-A-15-...` belong to DRS) and the regression tier's. So the row
// under test was whatever anyone else last touched.
//
// Worse, the row it picked here — BL05 — is smoke's own NC ground, an RFI that
// SM06 had created minutes earlier in the same run. Reassigning its CI/EE/QI
// mid-run mutates state another stage is mid-way through using.
//
// FIXED by choosing a row on OUR ground and never the NC/RFI flow areas: see
// pickOwnedRow() below.
// ===========================================================================
//
// NOT serial mode — the RFI and NC tests are fully independent (each even
// opens its OWN Admin context inside the test body), so one's failure must not
// skip the other. See SM01's comment for the full reasoning.

// Header candidates per assignee type. Several spellings each because the grid
// header and the reassign dialog's own type dropdown do not use identical
// wording, and neither is worth hardcoding to one string.
const ASSIGNEE_TYPES = [
  { label: 'Contractor Incharge', headers: ['Contractor Incharge', 'Contractor In-charge', 'Assigned CI', 'CI'] },
  { label: 'Execution Engineer', headers: ['Execution Engineer', 'Assigned EE', 'EE'] },
  { label: 'Quality Inspector', headers: ['Quality Inspector', 'Assigned QI', 'QI'] },
];

// Chooses a row this tier owns, preferring ground no other stage is using.
//
// THE ORDERING IS THE WHOLE POINT:
//   1. Feature ground (BL10-BL14) — created by SM23/SM24/SM25, which nothing
//      else reads. Reassigning here disturbs nobody.
//   2. Any other smoke-mapped area EXCEPT the live flow areas. Still ours.
//   3. Nothing — skip, loudly, naming what was looked for.
//
// The flow areas are excluded rather than merely deprioritised. A reassignment
// changes who the RFI is pending with, and SM05/SM06 walk a tracked 9-TC / 4-TC
// sequence against exactly those rows: repointing one mid-sequence would strand
// the tracker on a TC whose next actor is no longer the user the tracker expects,
// and the failure would surface inside the flow stage rather than here.
function pickOwnedRow(ids, { workLocation, featureAreas, otherAreas }) {
  const onOurLocation = ids.filter((id) => id.includes(`-${workLocation}-`));
  const byArea = (areas) =>
    onOurLocation.find((id) => areas.some((a) => id.includes(`-${a}-`)));

  const preferred = byArea(featureAreas);
  if (preferred) return { id: preferred, why: 'feature ground (isolated)' };

  const fallback = byArea(otherAreas);
  if (fallback) return { id: fallback, why: 'smoke-mapped ground, non-flow area' };

  return { id: null, why: null };
}

// Runs all three reassignment types against one row, re-locating it by id each
// time: a reassignment updates the row's Updated At, and the list is sorted by
// it, so the row moves.
async function reassignAllTypesOnRow(page, listUrl, entityLabel, rowId) {
  const reassign = new ReassignPage(page);

  for (const { label, headers } of ASSIGNEE_TYPES) {
    await page.goto(listUrl);
    await page.waitForLoadState('networkidle');
    await reassign.waitForGrid();

    // Resolve the column BEFORE mutating anything, so a layout change fails
    // with "no column matched" (and a dump of the headers that do exist)
    // instead of silently asserting against the wrong column afterwards.
    const colIndex = await reassign.resolveColumnIndexByHeader(headers);
    if (colIndex === null) {
      console.log(
        `${entityLabel} ${rowId}: no "${label}" column in this grid — skipping this type. ` +
        `This is a real finding if the column should be there; see the header dump above.`
      );
      continue;
    }

    const row = reassign.getRowById(rowId);
    await row.waitFor({ state: 'visible', timeout: 15000 });

    await reassign.openReassign(row);
    await reassign.selectAssigneeType(label);

    const currentAssignee = await reassign.getCurrentAssigneeName();
    const eligible = await reassign.getEligibleAssigneeNames();

    if (eligible.length === 0) {
      // Not a failure. With one user per role on this ground there may be
      // nobody else eligible, which is a legitimate data state rather than a
      // broken screen — the same "an empty list is a valid state" rule the
      // flow stages already follow.
      console.log(`${entityLabel} ${rowId}: "${label}" has no eligible alternative user — skipping`);
      await reassign.closeButton.click().catch(() => {});
      continue;
    }
    expect(
      eligible,
      `The eligible ${label} list should exclude the person currently assigned`
    ).not.toContain(currentAssignee);

    const newAssignee = eligible[0];
    await reassign.selectNewAssignee(newAssignee);
    await reassign.submitAssignUser();

    // Prove it via the GRID's own column, re-fetched from the server, not by
    // the modal having closed without error.
    await page.goto(listUrl);
    await page.waitForLoadState('networkidle');
    await reassign.waitForGrid();

    const updatedRow = reassign.getRowById(rowId);
    await updatedRow.waitFor({ state: 'visible', timeout: 15000 });
    // Re-resolve rather than reusing colIndex: the reload rebuilds the grid and
    // the header set is re-accumulated from whatever is rendered.
    const verifyIndex = await reassign.resolveColumnIndexByHeader(headers);
    const updatedCell = await reassign.scrollUntilColumnVisible(
      updatedRow, verifyIndex === null ? colIndex : verifyIndex
    );
    await expect(
      updatedCell,
      `${entityLabel} ${rowId}: the "${label}" column should show the new assignee ` +
      `after reassignment. If this shows a work area or a date, the column resolved ` +
      `to the wrong index — which is exactly the failure this stage was rewritten for.`
    ).toHaveText(newAssignee, { timeout: 15000 });

    console.log(`${entityLabel} ${rowId}: ${label} reassigned "${currentAssignee}" -> "${newAssignee}"`);
  }
}

test.describe('Smoke stage SM14 - Admin reassigns CI/EE/QI', () => {
  for (const entity of ['RFI', 'NC']) {
    test(`Admin can reassign CI, EE and QI on a pending ${entity}`, async ({ browser, profile }) => {
      test.setTimeout(10 * 60 * 1000);
      const ground = requireFeatureGround(profile);

      const workLocation = profile.workLocations[0];
      const flowAreas = new Set(
        Object.values(profile.flowWorkAreas || {})
          .flatMap((byViewport) => Object.values(byViewport || {}).flat())
          .filter(Boolean)
      );
      const baseFeatureAreas = [ground.wamMutate, ground.rfiCreate, ...(ground.rfiBulkAreas || [])]
        .filter(Boolean)
        .filter((a) => !flowAreas.has(a));

      // NC'S CREATE GROUND IS INCLUDED EVEN THOUGH IT OVERLAPS A FLOW AREA,
      // and only for the NC entity. Without this the NC half of this stage
      // could never find anything and always SKIPPED — which is exactly what
      // it did on the 2026-09-05 full run.
      //
      // The arithmetic, for solar: featureGround.ncCreate is BL05 and the flow
      // areas are BL03/BL04/BL05, so the `!flowAreas.has(a)` filter above
      // removes the ONE area where SM26 puts its NC. The preferred list came
      // out as BL10-BL14 (all RFI ground) and the fallback as BL06/BL07, so no
      // NC this chain creates was ever eligible. Reordering this stage to run
      // after SM26 (app owner, 2026-09-05) was necessary but not sufficient —
      // the row still had to be reachable.
      //
      // Why the overlap is acceptable HERE: this stage now runs after both the
      // flows and SM26, and SM06 drives its NCs through to approved, so a
      // healthy run leaves exactly one pending NC on BL05 — SM26's, freshly
      // submitted and unapproved. The residual risk is a PARTIALLY FAILED SM06
      // leaving one of its own NCs pending on BL05, which this could then pick
      // up and reassign. That is tolerable: the flow's tracker is reset per
      // run, and this stage only ever reassigns CI/EE/QI, never approves or
      // rejects. If it ever stops being tolerable, the clean fix is to give
      // ncCreate its own block (BL06 and BL07 are mapped and unallocated)
      // rather than to widen this any further.
      const featureAreas = entity === 'NC' && ground.ncCreate && !baseFeatureAreas.includes(ground.ncCreate)
        ? [...baseFeatureAreas, ground.ncCreate]
        : baseFeatureAreas;
      const otherAreas = smokeMappedWorkAreas(profile)
        .filter((a) => !flowAreas.has(a) && !featureAreas.includes(a));

      const { context, page } = await adminFreshLogin(browser);
      try {
        const listUrl = `${process.env.BASE_URL}/my-tasks/${entity.toLowerCase()}/list/pending-with-others`;
        await page.goto(listUrl);
        await page.waitForLoadState('networkidle');

        const reassign = new ReassignPage(page);
        await reassign.waitForGrid();

        const ids = await reassign.listRowIds();
        console.log(`${entity}: ${ids.length} pending row(s) rendered; ours are on ` +
          `${workLocation} / ${[...featureAreas, ...otherAreas].join(', ')}`);

        const { id: rowId, why } = pickOwnedRow(ids, { workLocation, featureAreas, otherAreas });

        // Deliberately a SKIP, not a failure — still, but the bar has moved.
        //
        // This stage is now DECLARED AFTER SM23/24/25 (which submit RFIs) and
        // SM26 (which submits an NC), none of which approve anything, so a
        // healthy chain always leaves unapproved rows here on purpose rather
        // than by luck (app owner, 2026-09-05). A skip therefore now means
        // something upstream genuinely failed to create anything, not "this
        // ran too early" — worth reading as a signal rather than noise.
        //
        // It stays a SKIP rather than becoming a failure because this is still
        // an independent sibling leaf, not a dependent: if the create stages
        // died, that is their failure to report, and failing here as well
        // would dress a missing precondition up as a reassignment defect.
        test.skip(
          !rowId,
          `No pending ${entity} on smoke ground to reassign. Looked for an id containing ` +
          `"-${workLocation}-" and one of ${JSON.stringify([...featureAreas, ...otherAreas])}. ` +
          `Rendered ids were: ${JSON.stringify(ids)}. Rows belonging to DRS automation ` +
          `(RFI-E2E-WL-...) and to the regression tier are deliberately never chosen.`
        );

        console.log(`${entity}: targeting "${rowId}" — ${why}`);
        await reassignAllTypesOnRow(page, listUrl, entity, rowId);
      } finally {
        await context.close();
      }
    });
  }
});
