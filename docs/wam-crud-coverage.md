# WAM CRUD Coverage — Demapping & Patch/Update

Tracks WAM assignment testing beyond "can create from empty," which
`13_wam_all_roles.spec.js`/`18_wam_hierarchy.spec.js` already cover.
See `docs/wam-hierarchy-business-logic.md` for the hierarchy/authority
side of WAM; this doc is about the CRUD mechanics (Clear/Update) that
apply regardless of who's logged in.

## Specs

- `tests/specs/25_wam_demapping.spec.js` — Clear ("de-mapping") actually
  persists server-side, for both row shapes:
  - Single-assignee Work Area row (Execution Engineer @ BL01/A-06c):
    clear → confirm empty (persisted) → restore the exact original value
    (trivial and exact, since a single-select pick always fully
    replaces).
  - Multi-assignee Work Location row (Plot Admin @ **S05b**, not A-06c —
    deliberately the one Work Location `13_wam_all_roles.spec.js` never
    touches for PM/Plot Admin, so there's no shared history at risk):
    captures every existing name first, clears, confirms empty
    (persisted), then restores every captured name plus the newly-added
    test user.
- `tests/specs/26_wam_patch_update.spec.js` — PATCH/update semantics,
  for all 10 WAM-assignable roles. Per app owner (2026-08-21):
  - Single-assignee roles (Execution Engineer/Quality Inspector/
    Execution Lead/Quality Lead/Contractor Incharge/Contractor
    Manager, **and Project Manager** — see discrepancy below): "update"
    = select a different user, which replaces the old one. Restores the
    original value afterward.
  - Multi-assignee roles (Plot Admin/Site Admin/Cluster Admin): "update"
    = add a new person ALONGSIDE existing assignees, not replacing
    anyone (app owner's explicit choice — no single-person-replace
    action exists in this UI). Deliberately targets these roles'
    ALREADY-populated, shared rows (Khavda for Site Admin, Gujarat/
    KHAVDA for Cluster Admin, A-06c for Plot Admin) specifically to
    prove "alongside existing," not just "can add to empty." Purely
    additive, so nothing needs restoring.

Both specs use the SAME idempotent `assignUserIfNeeded`/
`addAssigneeToRow` pattern `13_wam_all_roles.spec.js` already
established, plus two new `WAMPage.js` methods built for these specs:
`selectDifferentWorkAreaUser()` (single-select: picks any option that
isn't the current value) and `addAnyUnassignedUser()` (multi-select:
picks any option not already in the row).

## Real finding: Project Manager's row is single-select, unlike Plot Admin's

Project Manager and Plot Admin are nominally the same tier/depth (both
stop the Role→Cluster→Sites cascade at the same point, rows = Work
Locations — see `wam-hierarchy-business-logic.md`). Confirmed live
(2026-08-21), twice, using the exact same `addAssigneeToRow` method
already proven reliable for genuinely multi-select rows: adding a new
person to Project Manager's A-06c row REPLACED the existing one, while
the identical operation on Plot Admin's row correctly added alongside
5+ existing names. `26_wam_patch_update.spec.js` tests Project Manager
with single-assignee (replace) semantics accordingly, not grouped with
the other multi-assignee roles.

## Real bug found and fixed: Ark UI's checkmark artifact

Ark UI appends a checkmark (✓) to the currently-SELECTED option's own
`innerText` (already independently documented as a false-alarm artifact
in `18_wam_hierarchy.spec.js`'s role-restriction log — "Quality
Inspector\n✓" was the same option, not an extra role). Without
stripping it, code that picks "whichever option ISN'T already
selected/assigned" can misidentify the checkmark-suffixed CURRENT
option as different/unassigned and pick it — which:
- for a single-select row (`selectDifferentWorkAreaUser`) is a no-op
  that silently "succeeds" without ever changing the assignment
  (caused Quality Lead's/Contractor Manager's first update-test run to
  show the OLD value still there afterward), and
- for a multi-select row (`addAnyUnassignedUser`) actually **toggles
  the already-selected person OFF** instead of adding someone new
  (destroyed real data the first time this ran — wiped Cluster Admin's
  row to empty, dropped "Sachin Sane" from Site Admin's row, and
  replaced Project Manager's assignee entirely).

**Fixed**: `WAMPage._stripSelectedMarker()` strips the checkmark before
any equality/inclusion check in both methods. The destroyed shared data
was repaired via a one-off script (`00_inspect_wam_restore.spec.js`) —
confirmed restored, and re-verified via a full `13_wam_all_roles.spec.js`
regression run (16/16 passed) that nothing else broke.

## Real edge case: what if there's nothing to update to?

Raised directly by the app owner: if a role's dropdown genuinely offers
only the current value (single-assignee) or every possible person is
already assigned (multi-assignee), there's nothing to test an update
against — that's a legitimate "can't test here" state, not a failure.
Both `selectDifferentWorkAreaUser()` and `addAnyUnassignedUser()`
return `null` in that case rather than throwing, and
`26_wam_patch_update.spec.js` calls `test.skip()` with a clear reason
when that happens. Confirmed live: Quality Lead and Cluster Admin both
hit this genuinely (only one selectable option existed for each at the
time), and skipped cleanly instead of failing.

## Hierarchy-wise coverage (non-Admin logins)

`27_wam_demapping_hierarchy.spec.js` and
`28_wam_patch_update_hierarchy.spec.js` apply the same two mechanics
(Clear, Update) to NON-ADMIN logins — Cluster Admin/Site Admin/Plot
Admin — same angle `18_wam_hierarchy.spec.js` already applies to WAM
assignment/creation. One representative example per tier per role type
(single-assignee: Execution Engineer, reused across all three tiers;
multi-assignee: Site Admin for Cluster Admin's tier, Plot Admin @
**S05b** for Site Admin's tier) — not every role below each tier again,
since 25/26 already proved the mechanics themselves work for every
role under Admin; these two specs are about confirming non-Admin logins
can invoke the same mechanics within their own scope.

**Plot Admin's tier has no multi-assignee example** — everything below
it (Project Manager downward) turned out to be single-assignee,
including Project Manager's own row (see the discrepancy noted above).
Tested with two single-assignee examples (Execution Engineer + Quality
Inspector) instead of one of each.

## Status: validated (2026-08-21)

- `25_wam_demapping.spec.js`: 2/2 passed.
- `26_wam_patch_update.spec.js`: 8 passed, 2 skipped (genuine edge
  cases, not failures).
- `27_wam_demapping_hierarchy.spec.js`: 6/6 passed.
- `28_wam_patch_update_hierarchy.spec.js`: 5 passed, 1 skipped (Cluster
  Admin updating Site Admin's row — genuinely no unassigned person left
  to add at the time).
- `13_wam_all_roles.spec.js`: re-run in full, and spot-checked again
  after specs 27/28 — 16/16 + 4/4 passed both times, confirming none of
  the above broke existing coverage.
