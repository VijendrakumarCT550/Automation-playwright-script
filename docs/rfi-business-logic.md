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

Per app owner's detailed walkthrough (2026-08-19) — concrete mechanics,
superseding the earlier higher-level version of this section. Still not
covered by our automation as its own cross-check (see the still-open item
at the end).

- **Service Orders (SOs) are seeded in the backend**, per Work Location /
  project, each tied to a specific vendor. CI/CM/EE/QI don't create SOs —
  they're already there before any mapping happens.
- **SO Mapping** (admin screen) is where an SO gets attached to a specific
  Activity for a Work Location + Work Area + Package. The SO dropdown on
  that screen only offers SOs already seeded for that project — you're
  picking from what's available, not entering arbitrary values.
- **Worked example, exactly as given**: vendor A's SO is mapped (via SO
  Mapping) to Activity "Piling - MMS"; vendor B's SO is mapped to Activity
  "Piling - Inverter" — two different vendors, two different Activities,
  same Work Area.
- **In WAM, assigning a CI (or CM) requires picking a Service Order** — the
  vendor name auto-populates from that SO. This SO choice is what scopes
  *which Activity* that CI can create RFIs for: continuing the example,
  CI-A (mapped via vendor A's SO) can only create RFIs for "Piling - MMS"
  (and its own Sub-Activity/Checkpoint/Work-Section combinations per §3a);
  CI-B (vendor B's SO) can only create RFIs for "Piling - Inverter."
- **This is exactly how two different CIs can be WAM-mapped to the SAME
  Work Area at once without conflict** — each is scoped to a disjoint
  Activity via their own SO, so there's no overlap in what either can
  create RFIs for.
- **EE and QI are NOT SO-scoped** (matches the User Manual's "Service
  Order does not control EE/QI visibility," §9) — any EE/QI mapped to that
  Work Location + Package sees and reviews every RFI from every CI/vendor
  within their scope, regardless of which SO created it. This is why our
  existing flow (one CI creates, EE/QI mapped to the same
  location/package review, unaware of and unaffected by vendor) already
  works correctly without any SO-awareness on the review side.
- **Contractor Manager's actual role right now, per app owner**: WAM-maps
  CI users within CM's own assigned Work Locations — that's it. No other
  active involvement in the RFI flow itself currently.
- **Scope note**: all of the above operates at Work Area granularity,
  which sits under Work Location, which sits under Site, which sits under
  Cluster — the same hierarchy WAM already uses elsewhere.

**Still open / not yet automated**: cross-checking that the SO Mapping
config the app actually *used* to derive an RFI's Contractor Name/Service
Order matches what `05_so_mapping.spec.js` configured. We now understand
the mechanics conceptually but still only observe the *result* on the RFI
in our automation, not the source SO Mapping config it came from.

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

## 6. Activity Dependency — two layers, both **confirmed enforced** by the app

Per app owner's direct explanation (2026-08-19) — this resolves the
earlier open question: both layers are real, app-enforced blocks, not
just informational master data.

### 6a. Checkpoint-level dependency (within one Activity, same Work Section)

Using Activity A.1.1 (Piling - MMS)'s checkpoint chain as the concrete
example given:

```
1. Pre Pour Inspection - Pile      → checklist: C_14_1 Micro Pile Checklist
2. Pre Pour Inspection - Pile Cap  → checklist: C_14_2 Micro Pile Cap Checklist
3. Post Pour Inspection            → checklist: C_8 Post Pour Check
4. Epoxy Coating                   → checklist: 87 Bitumen & Epoxy Paint Checklists
5. Routine Testing                 → no checklist, testing report upload only
```

For a **specific Work Section**, the RFI for checkpoint N+1 cannot be
created until the RFI for checkpoint N (**for that exact same Work
Section**) has been approved by **both** EE and QI. This is scoped per
Work Section, not per Activity as a whole — e.g. Table 71's checkpoint 2
can proceed the moment Table 71's checkpoint 1 is fully approved, entirely
independent of whether Table 72's checkpoint 1 has even started.

### 6b. Cross-Activity dependency — scoped by Min-Unit-of-RFI type, matched at the same specific unit

- **Table-type activities only depend on other Table-type activities**,
  matched at the **same specific table** (Work Section). An Inverter-type
  activity's RFI is never blocked by, or dependent on, a Table-type
  activity's RFI, and vice versa — Table and Inverter dependency chains
  never cross each other directly.
- **Inverter-type activities only depend on other Inverter-type
  activities**, matched at the same specific inverter, by the same logic.
- **Block-type (work-area-level) activities can depend on Table-type
  and/or Inverter-type activities.** In that case, *every* individual
  Table and/or Inverter Work Section's RFI for the dependency
  Activity — across the **entire Work Area** — must be approved before an
  RFI can be created for the Block-level Activity. (Confirmed this is one
  concept referred to consistently as "work area / Block level," not a
  separate higher tier above Block.)
- **Reference for which type an Activity is**: the Activity Master's "Min.
  Unit of RFI" column (see §4) — check this before assuming which
  dependency rule applies to a given Activity.

**Not yet automated**: none of this dependency enforcement is exercised
by our current specs (`RFI_DATA`'s single Activity/Sub-Activity combo has
no dependency chain to trigger). Live-experiment validation (attempt to
create an RFI for a dependent checkpoint/Activity before its
prerequisite is approved, confirm the app blocks it) is still open —
tracked in `rfi-data-integrity-scenarios.md`'s Deferred section.

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

**Explicitly parked per app owner (2026-08-19)**: "wait for RFI linked NC
we will do later along with different scenario" — do not start
investigating or building this until the app owner brings it back up as
its own scenario.

## 11. Quantity / Unit of Measurement rules

Per app owner (2026-08-19):

- If **RFI Quantity** is entered, **Unit of Measurement becomes
  mandatory** (matches the User Manual's general validation note, §32).
- The **Unit dropdown is filtered by the app itself** — not a generic,
  full unit list. Presumably filtered to the specific UOM already defined
  for that Sub-Activity in the Activity Master (e.g. "EA" for
  Piling-MMS, per §4's `Unit of Measure for Optional Qty. Input by
  Contractor` column) — not yet confirmed live which exact value(s)
  appear for a different Sub-Activity.
- **RFI Quantity's meaning ties to the Work Section(s) selected** for that
  RFI submission — exact semantics when *multiple* Work Sections are
  selected in one submission (one aggregate quantity vs. implicitly
  per-section) not yet clarified further. Not urgent: our automation's
  `RFI_DATA` currently leaves Quantity `null` and only ever selects a
  single Work Section, so this ambiguity doesn't block current work.

## 12. Draft / autosave behavior

Per app owner (2026-08-19) and confirmed live via direct investigation.
Validated spec: `tests/specs/24_rfi_draft_autosave.spec.js`.

- **Autosave, not a manual save**: navigating away from the Create RFI
  form persists whatever's filled as a draft — no need to click the
  explicit "Draft" button (`RFICreatePage.clickSaveDraft()` still exists
  and works, but is a separate, deliberate action from this autosave).
- **Minimal trigger confirmed**: even filling in ONLY Work Location (no
  other field, not even a required one) and then navigating away is
  enough to persist a draft.
- **Two distinct "goes back" triggers both work identically**: the
  browser Back button, and an in-app nav link click away (e.g. "My
  Tasks" in the sidebar) without ever using Back. Confirmed live — no
  observed behavioral difference between the two.
- **Validation is NOT enforced for the draft-save** — this is the key
  point, per app owner: `02_rfi_ci.spec.js`'s test 3 already established
  that clicking **Proceed** with required fields missing is silently
  blocked (stays on Page 1, no error toast — "the app validates by
  preventing navigation rather than showing an error div"). Going back
  from that exact same incomplete state, by contrast, saves a draft
  without complaint. `24_rfi_draft_autosave.spec.js` asserts both halves
  of this asymmetry directly, in one place.
- **The draft is stored LOCALLY in the browser, not server-side.**
  Logging out (or, equivalently, starting a brand-new browser
  context/session — confirmed by two Playwright runs in a row: one that
  created two drafts, and an immediately-following fresh-login run that
  found zero) deletes it. Consequence for automation: create, verify,
  resume, and complete a draft must all happen within ONE continuous
  session — never split across separate logins/tests.
- **Surfaced in "Pending with me" as an "In-Draft" status row** (exact
  label text, confirmed live) — RFI ID column stays blank (no code is
  assigned until a real submission happens).
- **How resuming actually works**: the app owner confirmed (live
  screenshot, 2026-08-19) opening a draft works the same as opening an
  RFI for review/resubmission — an Actions-column eye icon, reached by
  scrolling the grid right (this row has more columns than a first
  glance suggests: Activity, Sub Activity, Created AT, Updated AT, Last
  Reviewed By, then Actions). An earlier automated probe wrongly
  concluded no such icon existed at all — it gave up scrolling right too
  early and only ever inspected a truncated dump of the row's HTML.
  `RFIListPage.openDraftRow()` reuses `openRowByCode()`'s proven
  scroll-and-poll technique, just locating the row by its "In-Draft"
  status text instead of a code. Clicking "Create RFI" again ALSO
  resumes the same local draft (the app detects it and reloads it,
  Work Location intact) — kept as an automatic fallback in
  `24_rfi_draft_autosave.spec.js` in case the eye icon ever lands
  somewhere not directly editable, but the eye icon is the primary,
  confirmed-correct path.
- **Sub-Contractor Name as a scenario marker** (app owner's suggestion):
  since the draft is completed with the rest of `RFI_DATA` after
  resuming, the free-text Sub-Contractor Name field is used to tag which
  trigger produced this particular draft (e.g.
  `"Draft-Autosave-Test (browser-back)"`), then verified unchanged at
  EE's and QI's review screens — same "does CI's data reach EE/QI
  unchanged" principle as `23_rfi_data_integrity.spec.js`, applied here
  to a drafted-then-completed RFI.
- **RFI code format** (app owner, 2026-08-19): `RFI-<Work Location>-<Work
  Area>-<Package abbreviation, e.g. CIV for Civil>-<incremental
  numerical suffix>`. The suffix increments per unique
  Work-Location/Work-Area/Package combination; a different combination
  starts its own suffix fresh from 1 (or wherever that combination's
  history left off) rather than continuing a single shared counter.
  Matches every code this suite has observed against the shared
  `RFI_DATA` combo (`RFI-A-06c-BL02-CIV-685` through `-690` and
  climbing). Not itself asserted on in any spec (the exact next number
  isn't predictable) — recorded here as confirmed reference only.
- **Two more test-infrastructure quirks found writing this spec:**
  1. **Fixed** — the "Pending with me" tile can be unresponsive to
     clicks right after certain SPA transitions — e.g. landing back on
     `/my-tasks` fresh off a draft-save + un-bounce sequence — same
     "looks fully loaded, isn't actually interactive yet" quirk
     `DashboardPage.goToMyTasks()` already had to retry-click past for
     the sidebar nav link (user-observed live, 2026-08-19). Fixed in
     `MyTasksPage.clickPendingWithMe()` with the same click-and-verify
     retry pattern (up to 60s, checking for the real URL change).
  2. **Not fixed — deliberately dropped instead**, after 7 reproducible
     failures: the "Pending with me" tile's COUNT badge never populated
     a digit within this flow, no matter what was tried — a longer
     wait, a 45-second poll, a Dashboard-then-My-Tasks round trip (an
     in-app nav click, still just client-side routing once the PWA
     shell is loaded), and a genuine `page.reload()` (the same "reload
     wipes the SPA's in-memory render state" mechanism
     `resolveIncompleteDownloadBanner()` relies on elsewhere). Direct
     evidence: `pendingWithMeTile.textContent()` came back as literally
     `"Pending with me"` with no digit anywhere, even after `networkidle`
     had already resolved (so whatever count API call exists had
     already finished — the DOM just never rendered the number
     afterward in this exact rapid-navigation sequence). Rather than
     keep guessing at fixes for a badge that isn't essential to what
     this spec is proving, `24_rfi_draft_autosave.spec.js` asserts only
     on the "In-Draft" row in the grid — which has been reliable on
     every single run — and doesn't check the tile's count at all.
