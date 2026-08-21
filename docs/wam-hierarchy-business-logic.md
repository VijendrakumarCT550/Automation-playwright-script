# WAM Role Hierarchy — Business Logic

Durable reference for who can assign whom in Work Area Management (WAM),
and what scope each role is limited to. Captures the app owner's
corrected/expanded hierarchy description (2026-08-21), superseding the
narrower version `tests/specs/18_wam_hierarchy.spec.js` was originally
built from (see `project_wam_hierarchy_feature` memory for that
session's history — this doc replaces its hierarchy description, not
its findings about bugs fixed along the way, which still stand).

## 1. Full chain (app owner, 2026-08-21)

```
Admin
  └─ assigns → Cluster Admin (within their scope: everything)
Cluster Admin
  └─ assigns → Site Admin (within their own Cluster)
Site Admin
  └─ assigns → Plot Admin (within their own Site)
Plot Admin
  └─ assigns → Project Manager (within their own Plot / Work Location)
Project Manager
  └─ assigns → Execution Lead + Quality Lead (within their own Work Location)
Execution Lead
  └─ assigns → Contractor Manager + Execution Engineer (within their own Work Area)
Quality Lead
  └─ assigns → Quality Inspector (within their own Work Area)
Contractor Manager
  └─ assigns → Contractor In-Charge (within their own Work Area)
```

The last three steps (Execution Lead/Quality Lead/Contractor Manager
downward) are unchanged from the original hierarchy description and
already validated in `18_wam_hierarchy.spec.js` — nothing new there.

## 2. Key rule: every tier ABOVE Project Manager can assign Project Manager directly

Not just the tier immediately above PM. **Admin, Cluster Admin, Site
Admin, and Plot Admin can each assign Project Manager directly**, each
within their own scope:

- **Admin**: broadest scope — can assign PM at any Work Location, anywhere.
- **Cluster Admin**: can assign PM at any Work Location within their own Cluster.
- **Site Admin**: can assign PM at any Work Location within their own Site.
- **Plot Admin**: can assign PM only at their own Plot (= Work Location).

This is a direct consequence of the containment structure:

```
Cluster → (multiple) Sites → (multiple) Plots/Work Locations
```

A higher tier's scope spans more Sites/Plots than a lower tier's, so it
naturally has more Work Locations available to map a Project Manager
into — but the ACTION each of them takes is the same ("assign Project
Manager"), just scoped differently.

**Only Cluster Admin's version of this step is currently tested**
(`18_wam_hierarchy.spec.js`'s first test). Admin, Site Admin, and Plot
Admin each independently assigning PM within their own scope is NOT yet
covered — see Open Questions below.

## 3. Cluster Admin, Site Admin, and Plot Admin all have Admin's full authority within their own scope

Per app owner (2026-08-21, generalized beyond the original Site-Admin-only
framing): **Cluster Admin, Site Admin, and Plot Admin each have the SAME
authority as Admin, scoped to their own assigned Cluster/Site/Plot
respectively** — not just for WAM assignment, but also for:
- **SO Mapping**
- **RFI/NC visibility and reassignment**

So the mental model isn't "WAM-hierarchy role with an assign-PM
side-capability" — it's **Admin, scoped down to progressively narrower
geography**:

| Role | Scope | Has Admin's full authority (WAM, SO Mapping, RFI/NC) within... |
|---|---|---|
| Admin | everything | everywhere |
| Cluster Admin | their own Cluster | that Cluster (all its Sites/Plots) |
| Site Admin | their own Site | that Site (all its Plots) |
| Plot Admin | their own Plot (= Work Location) | that one Plot |

None of this is yet reflected in `05_so_mapping.spec.js` or
`11_reassign_rfi_nc.spec.js` (both currently only exercise Admin logins) —
see Open Questions below.

## 4. Terminology note

"Plot" = "Work Location" (renamed at some point; both terms refer to the
same entity). `18_wam_hierarchy.spec.js`'s existing comments and code
already use "Work Location" throughout — no change needed there,
just noting the two terms are interchangeable when discussing the
hierarchy with the app owner.

## 5. Existing test infrastructure (confirmed ready, no new setup needed)

`tests/fixtures/last-created-users.json` already has a bulk-created,
WAM-mappable user for every tier in the full chain, including the ones
not yet exercised by any spec:

| Prefix | Role | "Assigns every role below its own tier" coverage |
|---|---|---|
| ADM | Admin | Yes — pre-existing (`13_wam_all_roles.spec.js` assigns all 10 non-Admin roles) |
| CAD | Cluster Admin | Yes — new (9 roles: SAD/PAD/PM + all 6 work-area roles) |
| SAD | Site Admin | Yes — new (8 roles: PAD/PM + all 6 work-area roles) |
| PAD | Plot Admin | Yes — new (7 roles: PM + all 6 work-area roles) |
| PM | Project Manager | Cascade only (assigns EL+QL) — not part of this broader coverage |
| EL | Execution Lead | Cascade only (assigns EE+CM) |
| QL | Quality Lead | Cascade only (assigns QI) |
| EE | Execution Engineer | N/A (leaf role) |
| CM | Contractor Manager | Cascade only (assigns CIC) |
| QI | Quality Inspector | N/A (leaf role) |
| CIC | Contractor In-Charge | N/A (leaf role) |

## Status: validated (2026-08-21)

All 29 tests in `18_wam_hierarchy.spec.js` pass cleanly (9.6 min) — both
the original one-role-at-a-time cascade (Part 1, 5 tests) and the new
"every tier assigns everything below it" coverage (Part 2, 24 tests
across Cluster Admin/Site Admin/Plot Admin). Two real test-infra bugs
found and fixed along the way (both in `WAMPage.js`, both about the
Gujarat/KHAVDA Cluster naming inconsistency §... see below):

- `getWorkAreaRow()`'s row-label matching is now case-INSENSITIVE (a
  regex exact-match, not Playwright's case-sensitive `exact: true`
  string form) — a row can render as "KHAVDA" while a caller passes
  "Khavda", which is a pure casing difference, not a different name.
- For GENUINELY different names for the same location (e.g. "Gujarat"
  vs "KHAVDA" for the same Cluster — confirmed by the app owner as a
  real database/deployment data discrepancy on the environment tested
  against at the time, not a display-only quirk), a new
  `getWorkAreaRowAny()`/`resolveRowLabel()` candidate-list mechanism
  mirrors the existing `selectDropdownOptionAny()` pattern already used
  for dropdown OPTIONS.
- On a later, separate environment, this same Cluster resolved cleanly
  to "Gujarat" with no mismatch — confirming the naming discrepancy was
  specific to the deployment being tested against at the time, not a
  permanent characteristic of the app itself.

## Resolved open questions

1. **Resolved**: Admin/Cluster Admin/Site Admin/Plot Admin each
   assigning every role below their own tier is now tested — Admin via
   the pre-existing `13_wam_all_roles.spec.js`, the other three via new
   `18_wam_hierarchy.spec.js` "Part 2" describe blocks, all reusing the
   same already-WAM-mapped bulk users and the same idempotent
   assignUserIfNeeded/addAssigneeToRow pattern.
2. **Resolved (app owner decision)**: positive path only — no negative
   ("CANNOT act outside own scope") testing built. Matches the existing
   cascade tests' own style.
3. **Still open, planned as a follow-up** (app owner: "plan it as a
   follow-up," not immediate): Cluster Admin/Site Admin/Plot Admin's
   SO-Mapping and RFI/NC-reassignment authority — not yet started,
   `05_so_mapping.spec.js`/`11_reassign_rfi_nc.spec.js` are still
   Admin-only.
