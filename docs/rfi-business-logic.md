# RFI Business Logic Reference

Durable reference notes on how RFI creation/review data is structured and
where it comes from — as opposed to `rfi-data-integrity-scenarios.md`,
which tracks the specific checks we're building and open questions.

Sources: live EE-review-page inspection (`00_inspect_rfi_data_integrity.spec.js`,
2026-08-19, RFI `RFI-A-06c-BL02-CIV-685`), the app owner's direct explanation
(chat, 2026-08-19), `tests/fixtures/Activity Master and Checklist
Mapping_Solar (1).xlsx` (sheets `Inter-process linkage for RFIs` and
`Activity-Checklist_06.05.2026`, the latter being the most recently dated
of several historical snapshots in that workbook), and the **PULSE User
Manual** (shared 2026-08-19, not stored in this repo).

**Caveat on the User Manual, per explicit app owner instruction**: use it
for the general role hierarchy, WAM, SO Mapping, reassignment, and
dashboard-tile overview (§§8-10 below) — that material is reliable. **Do
NOT treat the manual's RFI/NC creation-form field lists or step-by-step
sections as ground truth** — the app owner confirmed "so many changes have
been done as per change request" since the manual was written, so those
specific sections are known to be outdated. Live inspection and the app
owner's direct confirmation remain the source of truth for RFI/NC form
behavior specifically.

## 1. Field provenance — who actually sets each value CI sees on Page 1

Confirmed live that EE's review screen shows several fields CI never
directly picks on `RFICreatePage` at all:

| Field | Who sets it | How |
|---|---|---|
| Project Name | Fixed/global | Not RFI-instance-specific (per app owner, skip verifying — confirmed "MLP T3 AP" showed up with no corresponding input anywhere in our create flow) |
| Work Location, Work Area, Package, Sub-Package, Activity, Sub-Activity, Inspection Checkpoint, Inspection Checklist | CI, directly | Picked via `RFICreatePage`'s cascading dropdowns |
| **Contractor Name, Service Order** | **Derived server-side**, not picked by CI | See §2 — comes from the SO Mapping config for that Work Location + Package + Activity, NOT a form field |
| Work Section (e.g. `"R01-T71"`) | CI picks the *specific instance*, but the *granularity* (Table/Inverter/Block) is fixed per Sub-Activity | See §3 |
| Quantity, Unit, Sub-Contractor Name | CI, optional — render as `-` when left null | Confirmed live: leaving these `null` in `RFI_DATA` shows as `-` on EE's screen, not blank/broken |
| Checklist observation values | CI, per checkpoint item | Confirmed live: all 16 items' typed text reached EE's screen unchanged |

## 2. WAM ↔ SO Mapping ↔ RFI relationship

Per app owner (not yet automated as its own deep-dive — noted as a
follow-up in `rfi-data-integrity-scenarios.md`):

- **SO Mapping** decides, for a given Work Location + Work Area + Package,
  which vendor (Service Order) is assigned to which **Activity**. This is
  the `05_so_mapping.spec.js` flow — e.g. Activity "Piling - MMS" mapped to
  SO `4810024058 - M S CHOUHAN INFRAVENTURES PVT LTD`.
- **WAM** decides which *user* (CI, CM, EE, QI, ...) is assigned to which
  Work Location/Work Area, independent of vendor.
- A CI can only create an RFI for an Activity if **both** are true: (a)
  they're WAM-mapped to that Work Location, and (b) that Activity is
  SO-mapped for that Work Location/Work Area. The Contractor Name +
  Service Order shown on the RFI are the SO Mapping config's vendor for
  that Activity, not something CI chooses on the create form.
- CIC (Contractor In-Charge), CM (Contractor Manager), and the Service
  Order are all related via the same vendor — e.g. everything under the
  "M S CHOUHAN" vendor umbrella in our test data.
- **Not yet covered by our automation**: verifying this linkage itself
  (i.e. that the SO Mapping config the app actually used to derive
  Contractor Name/Service Order matches what `05_so_mapping.spec.js` set
  up). Currently we only observe the *result* on the RFI, not cross-check
  it against the SO Mapping source. Flagged as a future deep-dive per app
  owner ("we will go in deep dive for SO mapping WAM and RFI relation").

## 3. Work Section — what `"R01-T71"` actually means

Confirmed via the Activity Master's "Min. Unit of RFI (Per Table / Per
Inverter / Per Block)" column: every Sub-Activity has a fixed **RFI
granularity unit** — `Table`, `Inverter`, or `Block` (Work Location itself
used to be internally called "Block", hence the `BL01`/`BL02`/... naming
convention still used for Work Area codes today).

Confirmed for our test scenario (Activity `A.1.1`, Sub-Activity
"Piling - MMS"): Min. Unit of RFI = **"Per Table"**. Our automation's
`RFI_DATA` doesn't pick a specific Work Section — `RFICreatePage.selectWorkSection()`
just takes whichever option is first in the dropdown at creation time — and
the live run captured `"R01-T71"` (Row 01, Table 71, presumably).

Per app owner, the exact Work Section format is project-type-dependent —
Solar is what we're covering; other project types would have different
work-section vocabularies. Not in scope beyond Solar right now.

### 3a. Work Section is fixed inventory, not a free choice — **resolved**

Per app owner's direct explanation (2026-08-19), this closes the open
question above:

- For a given Work Area + Activity, the set of Work Sections is **fixed**
  (a real, finite inventory of physical units — e.g. specific tables/rows)
  — it doesn't change except when new ones are administratively added.
- An RFI can be raised against **one or multiple** Work Sections at once
  (matches `RFICreatePage`'s multi-select-capable Work Section field).
- **Uniqueness rule**: for a given **Activity + Sub-Activity + Inspection
  Checkpoint** combination, an RFI can be created for any one Work Section
  **only once**. The app enforces this itself: once an RFI exists for a
  Work Section under that combination, that Work Section is **removed
  from the dropdown** for any further RFI creation attempt against the
  same combination — not a validation error message, an actual option
  disappearing from the list.
- **Resubmit is the exception**: while resubmitting a rejected RFI, CI
  *can* add, remove, or change the selected Work Section(s) — the only
  constraint is the target Work Section must not already have an active
  RFI for that same Activity/Sub-Activity/Checkpoint combination
  elsewhere. Per app owner, this constraint is "well cared [for] in the
  application itself" — we don't need to build defensive logic for it,
  just be aware it exists.

**Implication for data-integrity assertions**: `RFICreatePage.selectWorkSection()`
picking "first available" is legitimate — it's just picking whichever
still-unused physical unit happens to be first, which is a real, valid
choice, not an arbitrary/meaningless one like initially suspected. A real
data-integrity check should capture the *specific* Work Section value
actually selected at creation time (read it back right after selection,
same as the code already does for the visible RFI code) and assert EE/QI's
screen shows that exact same value — not assert against a hardcoded
expected string, since which one is "first" can change run to run as the
available inventory is consumed.

**Not yet automated / potential future test cases** (deferred — see
`rfi-data-integrity-scenarios.md`'s scope note on validation-rule testing):
verifying the "used Work Sections disappear from the dropdown" rule
itself, and verifying the resubmit-time add/remove/change behavior.

## 4. Activity Master hierarchy (Solar) — Package → Sub-Package → Activity → Sub-Activity

This is the cascading structure `RFICreatePage`'s dropdowns walk through,
confirmed against `Activity-Checklist_06.05.2026`:

```
Package (e.g. "Civil")
  └─ Sub-Package (e.g. "Piling (MMS, Inverter, LT Cable Hangers)")
       └─ Activity (e.g. "Piling - MMS")
            └─ Sub-Activity (e.g. "Piling - MMS")
                 ├─ Min. Unit of RFI: Table / Inverter / Block
                 ├─ Unit of Measure (optional qty): EA / Not Applicable / (none)
                 └─ Inspection Checkpoints (ordered, each with its own
                      Inspection Checklist) — e.g. Activity A.1.1 has:
                      1. Pre Pour Inspection - Pile        (checklist: Micro Pile Checklist)
                      2. Pre Pour Inspection - Pile Cap    (checklist: Micro Pile Cap Checklist)
                      3. Post Pour Inspection              (checklist: Post Pour Check)
                      4. Epoxy Coating                     (checklist: Bitumen & Epoxy Paint Checklists)
                      5. Routine Testing                   (no checklist, testing report upload only)
```

Package/Sub-Package/Activity/Checkpoint/Checklist names each have a
"(New)" and "(Old)" column in the master sheet — the underlying app data
is mid-migration from old to new naming in places. This directly explains
a discrepancy found live (see §5).

## 5. Known naming discrepancy: Sub-Package "New" vs "Old" name

**Confirmed not a bug, per app owner** — `RFI_DATA.subPackage` is
intentionally the shortened **"New"** name:
`"Piling (MMS, Inverter, LT Cable Hangers)"`. Live inspection showed EE's
review screen displaying the longer **"Old"** name instead:
`"Piling (MMS, Inverter, LT Cable Hangers) + IDT Civil & Structural"` — the
Activity Master sheet confirms both strings are the same Sub-Package
(A.1.1's row), just New vs Old naming. Per app owner: *"leave sub package
as of now"* — do not treat this mismatch as a data-integrity failure; some
part of the app hasn't caught up to the new shortened name yet, and that's
known/accepted for the current phase.

**Implication for data-integrity assertions**: don't do an exact-string
match on Sub-Package between what CI selects and what EE/QI's screen
shows. Either skip asserting this field for now, or match loosely (e.g.
"contains the new name as a substring") until the app's naming migration
is complete.

## 6. Activity Dependency — two separate layers

Confirmed from the master sheet, two distinct dependency concepts exist
(neither currently verified by our automation):

1. **Cross-Activity dependency** ("Activity Dependency" column) — e.g.
   Activity `B.1.1` (MMS Installation) depends on `A.1.1` (Piling)
   completing first. Some activities depend on multiple predecessors (e.g.
   `C.3.1` depends on `D.1.1, D.1.2, D.1.3, D.1.4, D.1.5, D.2.1`).
2. **Cross-Checkpoint dependency within one Activity** ("Preceding
   Inspection Checkpoint" column) — e.g. within Activity A.1.1, checkpoint
   "Pre Pour Inspection - Pile Cap" (`A.1.1.2`) has preceding checkpoint
   `A.1.1.1` ("Pre Pour Inspection - Pile"); the first checkpoint in a
   chain has `-` (no predecessor).

**Open question**: does the app actually *enforce* either dependency layer
(e.g. block RFI creation for a dependent Activity/checkpoint until its
predecessor's RFI is approved), or is this master data purely informational
for humans right now? Not yet confirmed live — needs app owner input or a
live experiment (try creating an RFI for a dependent activity before its
predecessor is done, see what happens).

## 7. UI pattern reference: hierarchical location pickers

App owner shared this DOM shape as an example of a hierarchy-node element
(from a location tree — the "Gujarat" cluster node, 4 children):

```html
<div class="d_flex ai_center gap_2 min-w_0 flex_1">
  <svg class="lucide lucide-layers" ...></svg>
  <p class="text fs_sm ov_hidden tov_ellipsis white-space_nowrap">Gujarat</p>
  <div class="d_flex ai_center gap_10px flex-d_row ml_auto pl_2">
    <div aria-label="4 children" class="badge badge--variant_subtle badge--size_sm">4</div>
  </div>
</div>
```

Pattern: `lucide-layers` icon + name `<p>` + a children-count badge
(`aria-label="N children"`). Noted for reference in case future work needs
to target hierarchical tree nodes (Cluster → Site → Work Location → Work
Area) by this shape rather than by exact text alone.

## 8. Full role hierarchy (from PULSE User Manual)

Confirms and extends what `project_wam_hierarchy_feature`/`18_wam_hierarchy.spec.js`
already validated live. Full chain, top to bottom:

```
Super Admin
 ├─ Cluster Admin → Site Admin → Plot Admin → Project Manager
 │                                                 ├─ Execution Lead → Execution Engineer
 │                                                 │                 → Contractor Manager → Contractor In-Charge
 │                                                 └─ Quality Lead  → Quality Inspector
 └─ Management User (view-only, jurisdiction set at Cluster/Site/Project
    Type/Work Location level at creation time — NOT WAM-based, sits
    outside this WAM chain entirely)
```

Each level can only assign roles *directly* below it, and only within its
own already-assigned scope — matches what we validated in
`18_wam_hierarchy.spec.js` (e.g. Cluster Admin's Role dropdown shows 9 of
10 roles unfiltered, but the *assignment* itself still enforces the
downward-only, own-scope-only rule).

**Scope granularity differs by level**: Admin tiers (Cluster/Site/Plot)
operate at their named geographic level; Project Manager operates at
"assigned plots"; **Execution Lead, Quality Lead, Execution Engineer, and
Quality Inspector all operate at Work Area level specifically** — the
same granularity WAM assigns them at. Contractor Manager and Contractor
In-Charge additionally require a **Service Order** selection during WAM
(gating them to only the Work Areas/blocks where that SO is already
mapped to at least one activity) — Execution Lead/Quality Lead/EE/QI do
not have this SO gate.

## 9. Dashboard tile definitions (Pending with Me / Others / Approved)

Per-role tile contents, confirmed from the manual (general behavior,
not RFI/NC form specifics, so trusted per the caveat above):

| Role | Pending with Me (RFI) | Pending with Others (RFI) |
|---|---|---|
| CI | Rejected RFIs + drafts | Pending with EE or QI |
| EE | Submitted by CI, awaiting EE | Rejected by EE/QI, or pending with QI |
| QI | Approved by EE, awaiting QI | Rejected by EE/QI, or pending with EE |

Same shape for NC, with CI/EE/QI substituted for "respond"/"review"
accordingly, and QI's "Pending with Me" additionally including its own
**draft NCs** (QI creates NC, unlike RFI where CI creates).

**Relevant to test design**: this confirms `openFromPendingWithMe()`'s
"Pending with me" tile is the correct one to target for every actor's own
turn — no actor ever needs to look at "Pending with Others" to find their
own work.

## 10. RFI ↔ NC linkage (QI can raise NC directly from an RFI's checklist)

Not yet reflected in our automation (`RFIReviewPage`/`RFI_DATA` have no
concept of this) — a real cross-entity relationship worth being aware of
for future data-integrity/dependency test cases:

- During QI's RFI review, marking a checklist item **Not OK** reveals a
  **"Raise NC"** checkbox for that specific item.
- If QI checks it: NC Description becomes mandatory, an NC is created
  **linked to that exact checklist question**, and the RFI is rejected
  (this is now the *only* way to reject-with-NC — marking Not OK without
  checking "Raise NC" is a normal reject, no NC).
- **The RFI cannot be resubmitted by CI while any linked NC is still
  open** — all linked NCs must complete their own full CI→EE→QI review
  cycle and close first. Multiple checklist items can each spawn their own
  independent linked NC within the same RFI.
- The NC detail page shows the parent RFI's ID as a clickable link back.

**Not yet automated**: our NC flow (`nc-flow-turns.js`) only covers
QI-creates-a-standalone-NC-directly (matches `project_nc_creation_feature`).
The *linked-from-RFI-checklist* NC creation path, and the
"RFI-blocked-until-linked-NC-closes" dependency, are both real app
behavior we haven't exercised. Deferred — not needed for the current
field-values-persist-correctly phase, but relevant if we ever build a
combined RFI+NC interaction test.
