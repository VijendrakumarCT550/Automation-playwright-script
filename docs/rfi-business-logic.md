# RFI Business Logic Reference

Durable reference notes on how RFI creation/review data is structured and
where it comes from — as opposed to `rfi-data-integrity-scenarios.md`,
which tracks the specific checks we're building and open questions.

Sources: live EE-review-page inspection (`00_inspect_rfi_data_integrity.spec.js`,
2026-08-19, RFI `RFI-A-06c-BL02-CIV-685`), the app owner's direct explanation
(chat, 2026-08-19), and `tests/fixtures/Activity Master and Checklist
Mapping_Solar (1).xlsx` (sheets `Inter-process linkage for RFIs` and
`Activity-Checklist_06.05.2026`, the latter being the most recently dated
of several historical snapshots in that workbook).

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

**Open question for `rfi-data-integrity-scenarios.md`**: is picking "first
available" acceptable for data-integrity purposes, or does a real
data-integrity check need to capture the *specific* Work Section value at
creation time and assert EE/QI see that same specific value (rather than
asserting against a fixed expected string, since our automation doesn't
target one)?

Per app owner, the exact Work Section format is project-type-dependent —
Solar is what we're covering; other project types would have different
work-section vocabularies. Not in scope beyond Solar right now.

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
