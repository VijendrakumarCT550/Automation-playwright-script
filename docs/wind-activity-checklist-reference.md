# Wind Activity Master & Checklist Mapping — extracted reference

Reference extraction of `tests/fixtures/Activity Master and Checklist Mapping_Wind.xlsx`,
the wind-project counterpart of the solar sheet already mined for
`docs/rfi-activity-dependency-chain.md` and `tests/utils/rfi-dependency-data.js`.

**Status: spreadsheet extraction only. Nothing here is live-confirmed.**
The solar equivalent was cross-checked against the real Inspection Checkpoint
/ Inspection Checklist dropdowns before being trusted, and several
spreadsheet-implied behaviours turned out not to match the app (see the
"multi-option checklist" and "Routine Testing" notes in
`docs/rfi-activity-dependency-chain.md`). No wind project has been opened in
the app yet, so every statement below is *what the sheet says*, not what
PULSE does. The "Open questions" section at the end lists what must be
confirmed live before writing any wind RFI spec.

Machine-readable form of the same data: `tests/fixtures/wind-activity-checklist.json`
(146 objects, one per sheet row, keys `sheetRow, srNo, package, subPackage,
activity, subActivity, unitOfRfi, uom, code, checkpoint, description,
checklist, checklistDoc, optional, preceding, remarks`). The full
`Inspection Checkpoint Description` text — long, and only useful for eyeballing
what an inspector actually checks — is kept in the JSON only, not reproduced in
the tables below.

## Which sheet is authoritative

The workbook has 6 sheets, 2 of which hold data, separated by the same
`Current >>` / `Draft >>` / `Archive >>` divider tabs the solar workbook uses:

| Sheet | Section | Data rows | Used here |
| --- | --- | --- | --- |
| `Current >>` | divider | 0 | — |
| `Activity-Checklist_07.02.26` | Current | 144 | delta only |
| `Draft >>` | divider | 0 | — |
| `Activity-Checklist_23.04.26` | Draft | **146** | **yes — primary** |
| `Sheet1` | scratch | 11 | no (see below) |
| `Archive >>` | divider | 0 | — |

The **Draft** sheet (`23.04.26`) is taken as primary, matching how the solar
extraction was done: there, `Activity-Checklist_06.05.2026` sat under `Draft`
and `Activity-Checklist_25.02.26` under `Current`, and the *Draft* (later-dated)
sheet was the one that matched the live dropdowns. Same shape here — Draft is
dated 23 Apr 2026, Current 7 Feb 2026. The wind workbook has no archived
sheets at all, so there is no longer history to compare against.

`Sheet1` is a scratch two-column list of activity names (Civil column:
Excavation, Blanket Layer/GSB Layer, Plum Concrete, PCC, Bottom Anchor Flange,
Reinforcement Binding, WTG Foundation, Top Flange Grouting, Backfilling
(Before Mesh), Earthing Mesh, Backfilling (After Mesh); Mechanical column:
Tower Erection, Nacelle, Hub DT and Blades, Generator, Nacelle Top Cover,
Torquing, MCC Audit, Re-Verification Audit). It carries no checkpoint,
checklist or dependency data — it looks like working notes behind the WTG
Foundation and WTG Erection activity lists. Ignored.

### Draft vs Current — the entire delta

Only three changes, all in the Draft's favour:

1. **`A1.9` was split into `A1.9a` + `A1.9b`.** Current had one 5-checkpoint
   activity "WTG Foundation" (`A1.9.1`–`A1.9.5`) that included Bitumen Painting
   as its 4th checkpoint. Draft splits it into `A1.9a` "WTG Foundation"
   (4 checkpoints) and `A1.9b` "WTG Foundation - Bitumen Painting"
   (3 checkpoints) — hence 146 rows vs 144.
2. **`B1.1.1`'s preceding changed** `A1.14.8` → `A1.14.6` (Oil Filled
   Transformer now waits on DT *Erection* rather than DT *Gravel Laying above
   FGL*).
3. **`B1.2.1`'s preceding changed** `A1.15.8` → `A1.15.4` (HT Switchboard now
   waits on HT Foundation *Erection* rather than *Handrail Installation*).

The Current sheet also carries a `Remarks` value of "Remove" on `B1.1.1` and
`B1.2.1` — the two rows whose preceding the Draft then changed. Draft has no
remarks on any row.

## Column layout, and how it differs from the solar sheet

Header row is **row 4** (solar's is row 5), data runs rows 5–150, columns B–P:

| Col | Header |
| --- | --- |
| B | Sr. No. |
| C | Package |
| D | Sub-Package |
| E | Activity |
| F | Sub-Activity |
| G | Unit of RFI  (Per WTG) |
| H | Unit of Measure for Optional Qty. Input by Contractor |
| I | Inspection Checkpoint Code |
| J | Inspection Checkpoint Name |
| K | Inspection Checkpoint Description |
| L | Inspection Checklist Name |
| M | Inspection Checklist Document |
| N | Is the Inspection Checkpoint Optional? |
| O | Preceding Inspection Checkpoint to be completed before raising RFI |
| P | Remarks |

Differences from solar's `Activity-Checklist_06.05.2026` that matter:

- **No `(New)` / `(Old)` paired columns.** Solar carried both old and new names
  for Sub-Package / Activity / Sub-Activity / Checkpoint Name because it was
  mid-rename; wind has a single name per field. Nothing to reconcile.
- **No `EPC Service code` and no `Change Task` column.**
- **New column N, "Is the Inspection Checkpoint Optional?"** — absent from
  solar. See the uniform-columns section: it is `Y` on all 146 rows.
- **New column M, "Inspection Checklist Document"** — the underlying document
  name, distinct from the checklist name. Solar had no such column. It diverges
  from column L on 66 of 146 rows (see Data quality).
- **Solar's `Activity Dependency` column (T) has no wind equivalent.** In solar
  that column was blank on all 81 real rows anyway, so nothing is lost — in
  both workbooks the dependency is carried solely by the "Preceding Inspection
  Checkpoint" column.
- **Solar's `Min. Unit of RFI` was per-row-variable** (`Block` / `Per Block` /
  `Per Inverter` / `Per Table`), and that variation is exactly what forced the
  two different test strategies in `rfi-dependency-flow.js`
  (throwaway-Work-Section vs two-Work-Areas). Wind's equivalent column G is
  `Per WTG` on every row.

## Uniform columns — three columns carry no information

Across all 146 Draft rows:

- **`Unit of RFI` = `Per WTG`** — every row, no exceptions.
- **`Unit of Measure` = `EA`** — every row.
- **`Is the Inspection Checkpoint Optional?` = `Y`** — every row, and on the
  Current sheet too (144/144).

The last one is the odd one. Read literally, *every* wind checkpoint is
optional, which would mean the preceding-checkpoint dependency is advisory
rather than enforced — the opposite of the solar behaviour that
`29_rfi_activity_dependency.spec.js` proves is hard-blocked with a
"Missing an RFI for Dependent Inspection Point" validation error. A column that
is constant across 290 rows in two independently-dated sheets is more likely an
unfilled default than a real business rule, but it cannot be assumed either
way. Flagged as an open question, not resolved.

## The shape every wind activity shares

Unlike solar — where checkpoint counts and names varied per activity — every
one of the 35 wind activities has the same skeleton:

```
Pre-Activity Checkpoint          (Sub-Activity "Pre-Activity Work",  no checklist)
  -> 1..10 real inspection checkpoints  (each with exactly one checklist)
  -> Post-Activity Checkpoint    (Sub-Activity "Post-Activity Work", no checklist)
```

35 activities x 2 bookend rows = **70 of the 146 rows (48%) have no checklist
at all** (columns L and M both `-`). Their Description column is boilerplate:
"Pre-Activity Inspection Checks, Documents and Reports" /
"Post-Activity Inspection Checks, Documents and Reports".

This is a bigger deal than it looks. In solar, the one checkpoint with no
checklist ("Routine Testing" — sheet note "No Checklist; only testing report to
be uploaded") had a visibly broken Inspection Checklist dropdown live and was
deliberately left out of scope. In wind that pattern is not an edge case, it is
half the sheet, and it sits at the *start and end of every chain* — so any wind
RFI automation has to handle a checklist-less RFI on its very first step, or
establish that these bookend checkpoints aren't RFI-raisable at all.

### Checkpoint names repeat within an activity

Seven activities reuse the generic checkpoint name **"Routine Inspection"** for
multiple consecutive rows, distinguished only by Sub-Activity:

| Activity | "Routine Inspection" rows | Distinguished by Sub-Activity |
| --- | --- | --- |
| A1.4 Blanket Layer/GSB Layer | 5 | Blanket/GSB Layer 1 … 5 |
| A1.5 Plum Concrete | 2 | Plum Concrete Layer 1, Layer 2 |
| A1.8 Reinforcement Binding | 2 | Reinforcement Bottom Layer, Top Layer |
| A1.14 DT | 5 | Backfilling, Gravel Laying below DT, PCC, Erection, Bitumen Painting |
| A1.15 HT Foundation | 5 | PCC, Erection, Bitumen Painting, Backfilling, Stair Case Erection |
| A1.16 Burnt Oil Tank | 3 | PCC, Erection, Backfilling |
| A1.17 Fencing | 4 | Fencing Post Casting, Barbed Wire Installation, White Wash, Gate Installation |

Solar's checkpoint names were unique within an activity, so the checkpoint
dropdown helpers select checkpoints by visible name. That will be ambiguous for
these seven activities. Whether the live dropdown is keyed on Sub-Activity
first (making each name unique in context) or renders duplicate options is
unknown — another open question.

Also note **`A1.11` "Backfilling (Before Mesh)"** uses positional checkpoint
names `Backfiling Layer 1` … `Backfiling Layer 8` (sic — one `l`), and `A1.13`
"Backfilling (After Mesh)" continues the same numbering at `Backfiling Layer 9`
/ `Layer 10`. So the layer numbers are globally sequential across two different
activities, not per-activity.

## The dependency graph

The preceding-checkpoint column forms one DAG spanning the whole workbook, not
per-activity chains. Three structural properties:

**1. Nine independent roots** (preceding = `-`), each starting its own chain:

| Code | Activity | Sub-Package |
| --- | --- | --- |
| `A1.1.1` | Stone Column Installation | Stone Column |
| `A1.14.1` | DT | USS Civil and Structural |
| `A1.15.1` | HT Foundation | USS Civil and Structural |
| `A1.16.1` | Burnt Oil Tank | USS Civil and Structural |
| `A1.18.1` | Crane Pad | Crane Pad |
| `B1.3.1` | Earthing | USS Electrical |
| `B1.4.1` | Cable Tray | USS Electrical |
| `B1.5.1` | Illumination | USS Electrical |
| `B1.6.1` | LT Switchboard | USS Electrical |

Every root is a Pre-Activity Checkpoint. The Civil roots plus Crane Pad are the
natural "start of site work" entry points; the four Electrical roots are
activities with no civil prerequisite recorded.

**2. Dependencies cross activity boundaries — 28 of them.** An activity's
Pre-Activity Checkpoint almost always depends on the *previous* activity's last
**real** checkpoint, deliberately skipping that activity's Post-Activity
Checkpoint. E.g. `A1.4.1` (Blanket Layer Pre-Activity) → `A1.3.2` (Excavation's
Preliminary Inspection), not → `A1.3.3` (Excavation's Post-Activity
Checkpoint).

The long Civil spine runs:

```
A1.1.2 -> A1.2.1..A1.2.4 -> A1.3.1/.2 -> A1.4.1..A1.4.6 -> A1.5.1..A1.5.3
      -> A1.6.1/.2 -> A1.7.1/.2 -> A1.8.1..A1.8.3 -> A1.9a.1..A1.9a.3
      -> [A1.9a.4] -> A1.9b.1..A1.9b.2 -> A1.10.1/.2 -> A1.11.1..A1.11.9
      -> A1.12.1/.2 -> A1.13.1..A1.13.4 -> C 1.1.1  (into WTG Erection)
```

and the Mechanical chain then runs strictly linearly
`C1.1 -> C1.2 -> C1.3 -> C1.4 -> C1.5 -> C1.6 -> C1.7 -> C1.8`, each activity's
Pre-Activity Checkpoint hanging off the previous activity's real inspection
checkpoint.

Cross-package links: `B1.1.1` (Oil Filled Transformer) → `A1.14.6` (DT
Erection); `B1.2.1` (HT Switchboard) → `A1.15.4` (HT Foundation Erection);
`B1.8.1` (HT Cabling) → `B1.2.2`; `B1.7.1` (LT Cabling) → `B1.4.2`;
`C 1.1.1` (Tower Erection) → `A1.13.4` (GSB Layer).

**3. Post-Activity Checkpoints are dead ends — with exactly one exception.**
34 of the 35 Post-Activity Checkpoints are never named as anyone's preceding
checkpoint, and no non-Post-Activity row is ever a dead end. The single
exception is **`A1.9a.4`**, which `A1.9b.1` depends on — a by-product of the
Draft's `A1.9` split, where the new `A1.9b` was chained onto the tail of
`A1.9a` rather than onto its last real checkpoint (`A1.9a.3`) the way every
other transition in the sheet is wired.

**One row has a multi-valued dependency**: `A1.17.1` (Fencing Pre-Activity) →
`A1.16.6, A1.15.8, A1.14.8` — Fencing waits on Burnt Oil Tank, HT Foundation
*and* DT all completing. Present in both Current and Draft, so not a Draft
artefact. Nothing in the solar sheet had more than one preceding checkpoint, so
how the app enforces an AND-dependency (and what its validation toast says) is
entirely unknown.

## Data quality flags

Real defects in the source sheet, worth raising with whoever owns it:

1. **Dangling reference: `A1.10.1`'s preceding is `A1.9.4`, which does not
   exist in the Draft sheet.** The `A1.9` → `A1.9a`/`A1.9b` split renamed every
   `A1.9.x` code but left `A1.10.1`'s pointer on the old code. Read literally,
   Top Flange Grouting depends on a checkpoint that isn't in the master. The
   intent is presumably `A1.9b.2` (Bitumen Painting, the new tail of that
   stretch) or `A1.9a.3`; the sheet does not say which. This is the only
   dangling reference in either sheet — the Current sheet has none.
2. **`C1.1`'s three checkpoint codes are written `C 1.1.1`, `C 1.1.2`,
   `C 1.1.3` — with a space** — while its Sr. No. is `C1.1` and every other
   code in the workbook is space-free. `C1.2.1`'s preceding is correspondingly
   written `C 1.1.2`, so the chain still resolves, but any code-based lookup has
   to tolerate the space.
3. **Checklist name ≠ checklist document on 66 of 146 rows.** Mostly harmless
   casing drift (`Excavation Checklist` vs `Excavation checklist`), but some are
   substantive: `WTG Top Flange Grouting Checklist` vs
   `Top Flange Grouting - WTG`; `Backfilling Checklist` vs
   `Backfiiling Checklist`; the eight Electrical rows map to Adani document
   numbers (`Adani/QA/PRT/E/029 (Erection Section)` etc.); and the Mechanical
   rows map to lists of per-step `.docx` files (`C 1.1.2` alone lists seven,
   from `Prepratation of Foundation.docx` through
   `Installation of lower tower segment (1st tower section).docx`). Which of
   the two columns the app's Inspection Checklist dropdown actually shows is
   unknown — for solar it was the checklist *name*, minus its `C_14_1` code
   prefix.
4. **Three checkpoints have a checklist name but no real checklist**, with the
   document column instead holding a question: `C1.6.2` Torquing, `C1.7.2` MCC
   Audit, `C1.8.2` Re-Verification Audit all read "No Checklist  Q: Duly-Filled
   &lt;X&gt; Submitted to Concerned AGEL Team for Review?". This is the same
   pattern as solar's out-of-scope "Routine Testing" checkpoint, which rendered
   a broken dropdown live. Treat these three as suspect.
5. **Spelling errors carried into names the app may display verbatim**:
   `Backfiiling Checklist` (4 rows), `Backfiling Layer N` (10 rows, one `l`),
   `Generator Installatio Checklist`, `Checklist for Preacst Elements`,
   `Barbed Wire checklist` / `White Wash Checklist` inconsistent casing,
   `Depth calibration censer` in a description (fixed to `sensor` in the
   Draft). If these strings are what the dropdown renders, specs must match
   them exactly as-is, typos included — same as solar, where
   `C_14_1 Micro Pile Checklist` had to be matched with its code prefix
   stripped.

## Full extraction — Draft sheet (`Activity-Checklist_23.04.26`)

35 activities across 3 packages and 7 sub-packages: CIVIL (Stone Column, WTG
Foundation, USS Civil and Structural, Crane Pad — 98 rows), ELECTRICAL (USS
Electrical, UG Cable — 24 rows), MECHANICAL (WTG Erection — 24 rows).
`Unit of RFI` is `Per WTG` and `Optional?` is `Y` on every row below, so neither
column is repeated in the tables.

### CIVIL / Stone Column


**A1.1 — Stone Column Installation** (sheet rows 5–7)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.1.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `A1.1.2` | Stone Column Work | Inspection of Stone Column | Stone Column Inspection Protocol for Vibro-Non Vibro Method | `A1.1.1` |
| `A1.1.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.1.2` |

**A1.2 — Plate Load Test** (sheet rows 8–12)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.2.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.1.2` |
| `A1.2.2` | Plate Load Test | Excavation and Sand Blanket for PLT | Excavation and Sand Blanketing Work for PLT | `A1.2.1` |
| `A1.2.3` | Plate Load Test | PLT Test Preparation/Inspection | Plate Load Test Pre Inspection for WTG Stone Column | `A1.2.2` |
| `A1.2.4` | Plate Load Test | Plate Load Test | Plate Load Test of WTG Stone Column | `A1.2.3` |
| `A1.2.5` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.2.4` |

### CIVIL / WTG Foundation


**A1.3 — Excavation** (sheet rows 13–15)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.3.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.2.4` |
| `A1.3.2` | Excavation | Preliminary Inspection | Excavation Checklist | `A1.3.1` |
| `A1.3.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.3.2` |

**A1.4 — Blanket Layer/GSB Layer** (sheet rows 16–22)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.4.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.3.2` |
| `A1.4.2` | Blanket/GSB Layer 1 | Routine Inspection | Stone Blanket Layer Checklist | `A1.4.1` |
| `A1.4.3` | Blanket/GSB Layer 2 | Routine Inspection | Stone Blanket Layer Checklist | `A1.4.2` |
| `A1.4.4` | Blanket/GSB Layer 3 | Routine Inspection | Stone Blanket Layer Checklist | `A1.4.3` |
| `A1.4.5` | Blanket/GSB Layer 4 | Routine Inspection | Stone Blanket Layer Checklist | `A1.4.4` |
| `A1.4.6` | Blanket/GSB Layer 5 | Routine Inspection | Stone Blanket Layer Checklist | `A1.4.5` |
| `A1.4.7` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.4.6` |

**A1.5 — Plum Concrete** (sheet rows 23–26)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.5.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.4.6` |
| `A1.5.2` | Plum Concrete Layer 1 | Routine Inspection | Plum Concrete Checklist | `A1.5.1` |
| `A1.5.3` | Plum Concrete Layer 2 | Routine Inspection | Plum Concrete Checklist | `A1.5.2` |
| `A1.5.4` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.5.3` |

**A1.6 — PCC** (sheet rows 27–29)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.6.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.5.3` |
| `A1.6.2` | PCC | PCC | PCC Checklist | `A1.6.1` |
| `A1.6.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.6.2` |

**A1.7 — Bottom Anchor Flange** (sheet rows 30–32)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.7.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.6.2` |
| `A1.7.2` | Bottom Anchor Flange and Stud Erection | Routine Inspection | Bottom Flange Level Checklist | `A1.7.1` |
| `A1.7.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.7.2` |

**A1.8 — Reinforcement Binding** (sheet rows 33–36)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.8.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.7.2` |
| `A1.8.2` | Reinforcement Bottom Layer | Routine Inspection | Reinforcement Checklist | `A1.8.1` |
| `A1.8.3` | Reinforcement Top Layer | Routine Inspection | Reinforcement Checklist | `A1.8.2` |
| `A1.8.4` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.8.3` |

**A1.9a — WTG Foundation** (sheet rows 37–40)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.9a.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.8.3` |
| `A1.9a.2` | WTG Foundation | Pre Pour Inspection - WTG Foundation | Pre-Pour Checklist | `A1.9a.1` |
| `A1.9a.3` | WTG Foundation | Post Pour Inspection - WTG Foundation | Post-Pour Checklist | `A1.9a.2` |
| `A1.9a.4` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.9a.3` |

**A1.9b — WTG Foundation - Bitumen Painting** (sheet rows 41–43)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.9b.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.9a.4` |
| `A1.9b.2` | Bitumen Painting of WTG Foundation | Routine Inspection | Bitumen Coating Painting Checklist | `A1.9b.1` |
| `A1.9b.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.9b.2` |

**A1.10 — Top Flange Grouting** (sheet rows 44–46)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.10.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.9.4` |
| `A1.10.2` | Top Flange Grouting | Grouting | WTG Top Flange Grouting Checklist | `A1.10.1` |
| `A1.10.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.10.2` |

**A1.11 — Backfilling (Before Mesh)** (sheet rows 47–56)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.11.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.10.2` |
| `A1.11.2` | Backfilling Before Mesh Placement | Backfiling Layer 1 | Backfilling Checklist | `A1.11.1` |
| `A1.11.3` | Backfilling Before Mesh Placement | Backfiling Layer 2 | Backfilling Checklist | `A1.11.2` |
| `A1.11.4` | Backfilling Before Mesh Placement | Backfiling Layer 3 | Backfilling Checklist | `A1.11.3` |
| `A1.11.5` | Backfilling Before Mesh Placement | Backfiling Layer 4 | Backfilling Checklist | `A1.11.4` |
| `A1.11.6` | Backfilling Before Mesh Placement | Backfiling Layer 5 | Backfilling Checklist | `A1.11.5` |
| `A1.11.7` | Backfilling Before Mesh Placement | Backfiling Layer 6 | Backfilling Checklist | `A1.11.6` |
| `A1.11.8` | Backfilling Before Mesh Placement | Backfiling Layer 7 | Backfilling Checklist | `A1.11.7` |
| `A1.11.9` | Backfilling Before Mesh Placement | Backfiling Layer 8 | Backfilling Checklist | `A1.11.8` |
| `A1.11.10` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.11.9` |

**A1.12 — Earthing Mesh** (sheet rows 57–59)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.12.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.11.9` |
| `A1.12.2` | Earthing Mesh | Routine Inspection | Earthing Mesh Checklist | `A1.12.1` |
| `A1.12.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.12.2` |

**A1.13 — Backfilling (After Mesh)** (sheet rows 60–64)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.13.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.12.2` |
| `A1.13.2` | Backfilling After Mesh Placement | Backfiling Layer 9 | Backfilling Checklist | `A1.13.1` |
| `A1.13.3` | Backfilling After Mesh Placement | Backfiling Layer 10 | Backfilling Checklist | `A1.13.2` |
| `A1.13.4` | GSB Layer | GSB Layer | GSB Inspection Checklist | `A1.13.3` |
| `A1.13.5` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.13.4` |

### CIVIL / USS Civil and Structural


**A1.14 — DT** (sheet rows 65–73)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.14.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `A1.14.2` | Excavation | Pre-Inspection | Excavation Checklist - General Works | `A1.14.1` |
| `A1.14.3` | Backfilling | Routine Inspection | Backfiiling Checklist | `A1.14.2` |
| `A1.14.4` | Gravel Laying below DT | Routine Inspection | Stone Blanket Layer Checklist | `A1.14.3` |
| `A1.14.5` | PCC | Routine Inspection | PCC Checklist | `A1.14.4` |
| `A1.14.6` | Erection | Routine Inspection | Precast Elements Erection, Positioning & Grouting Checklist | `A1.14.5` |
| `A1.14.7` | Bitumen Painting | Routine Inspection | Bitumen Coating Painting Checklist | `A1.14.6` |
| `A1.14.8` | Gravel Laying above FGL/Inside DT FDG | Final Inspection | Stone Blanket Layer Checklist | `A1.14.7` |
| `A1.14.9` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.14.8` |

**A1.15 — HT Foundation** (sheet rows 74–82)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.15.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `A1.15.2` | Excavation | Pre-Inspection | Excavation Checklist - General Works | `A1.15.1` |
| `A1.15.3` | PCC | Routine Inspection | PCC Checklist | `A1.15.2` |
| `A1.15.4` | Erection | Routine Inspection | Precast Elements Erection, Positioning & Grouting Checklist | `A1.15.3` |
| `A1.15.5` | Bitumen Painting | Routine Inspection | Bitumen Coating Painting Checklist | `A1.15.4` |
| `A1.15.6` | Backfilling | Routine Inspection | Backfiiling Checklist | `A1.15.5` |
| `A1.15.7` | Stair Case Erection | Routine Inspection | Precast Elements Erection, Positioning & Grouting Checklist | `A1.15.6` |
| `A1.15.8` | Handrail Installation | Final Inspection | Checklist for Preacst Elements | `A1.15.7` |
| `A1.15.9` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.15.8` |

**A1.16 — Burnt Oil Tank** (sheet rows 83–89)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.16.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `A1.16.2` | Excavation | Pre-Inspection | Excavation Checklist - General Works | `A1.16.1` |
| `A1.16.3` | PCC | Routine Inspection | PCC Checklist | `A1.16.2` |
| `A1.16.4` | Erection | Routine Inspection | Precast Elements Erection, Positioning & Grouting Checklist | `A1.16.3` |
| `A1.16.5` | Backfilling | Routine Inspection | Backfiiling Checklist | `A1.16.4` |
| `A1.16.6` | Drain Pipe Connectivity | Final Inspection | BOT Level and Pipe Connectivity Checklist | `A1.16.5` |
| `A1.16.7` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.16.6` |

**A1.17 — Fencing** (sheet rows 90–97)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.17.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.16.6, A1.15.8, A1.14.8` |
| `A1.17.2` | Backfilling | Pre-Inspection | Backfiiling Checklist | `A1.17.1` |
| `A1.17.3` | Fencing Post Casting | Routine Inspection | Fencing Post Checklist | `A1.17.2` |
| `A1.17.4` | Barbed Wire Installation | Routine Inspection | Barbed Wire checklist | `A1.17.3` |
| `A1.17.5` | White Wash | Routine Inspection | White Wash Checklist | `A1.17.4` |
| `A1.17.6` | Gate Installation | Routine Inspection | Fencing Gate Installation Checklist | `A1.17.5` |
| `A1.17.7` | Gravel Laying | Final Inspection | Gravel Laying Checklist | `A1.17.6` |
| `A1.17.8` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.17.7` |

### CIVIL / Crane Pad


**A1.18 — Crane Pad** (sheet rows 98–102)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.18.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `A1.18.2` | OGL | Pre-Inspection | OGL Checklist | `A1.18.1` |
| `A1.18.3` | Boulder Laying | Routine Inspection | Boulder Laying Checklist | `A1.18.2` |
| `A1.18.4` | GSB Laying | Final Inspection | GSB Laying Checklist | `A1.18.3` |
| `A1.18.5` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.18.4` |

### ELECTRICAL / USS Electrical


**B1.1 — Oil Filled Transformer** (sheet rows 103–105)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.1.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.14.6` |
| `B1.1.2` | Transformer and Accessories Installation | Transformer and Accessories Installation Inspection | IDT Oil Filled Transformer Field Quality Protocol | `B1.1.1` |
| `B1.1.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.1.2` |

**B1.2 — HT Switchboard** (sheet rows 106–108)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.2.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.15.4` |
| `B1.2.2` | HT Panel and Accessories Installation | HT Panel and Accessories Installation Inspection | HT Switchboard Field Quality Protocol | `B1.2.1` |
| `B1.2.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.2.2` |

**B1.3 — Earthing** (sheet rows 109–111)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.3.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `B1.3.2` | Earthing Flat Work | Earthing Flat Work Inspection | Earthing Field Quality Protocol | `B1.3.1` |
| `B1.3.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.3.2` |

**B1.4 — Cable Tray** (sheet rows 112–114)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.4.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `B1.4.2` | LT Cable Tray Work | LT Cable Tray Work Inspection | Cable Tray Field Quality Protocol | `B1.4.1` |
| `B1.4.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.4.2` |

**B1.5 — Illumination** (sheet rows 115–117)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.5.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `B1.5.2` | Light Pole Work | Light Pole Work Inspection | Illumination Field Quality Protocol | `B1.5.1` |
| `B1.5.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.5.2` |

**B1.6 — LT Switchboard** (sheet rows 118–120)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.6.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `B1.6.2` | ACDB Work | ACDB Work Inspection | LT Switchboards Field Quality Protocol | `B1.6.1` |
| `B1.6.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.6.2` |

**B1.7 — LT Cabling** (sheet rows 121–123)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.7.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `B1.4.2` |
| `B1.7.2` | LT Cable Laying | LT Cable Laying Inspection | LT Cabling Field Quality Protocol | `B1.7.1` |
| `B1.7.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.7.2` |

### ELECTRICAL / UG Cable


**B1.8 — HT Cabling** (sheet rows 124–126)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.8.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `B1.2.2` |
| `B1.8.2` | HT Cable Laying | HT Cable Laying Inspection | HT Cable Field Quality Protocol | `B1.8.1` |
| `B1.8.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.8.2` |

### MECHANICAL / WTG Erection


**C1.1 — Tower Erection** (sheet rows 127–129)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C 1.1.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.13.4` |
| `C 1.1.2` | Tower Erection | Tower Erection Inspection | Tower Erection Checklist | `C 1.1.1` |
| `C 1.1.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C 1.1.2` |

**C1.2 — Nacelle** (sheet rows 130–132)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.2.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C 1.1.2` |
| `C1.2.2` | Nacelle Installation | Nacelle Installation Inspection | Nacelle Installation Checklist | `C1.2.1` |
| `C1.2.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.2.2` |

**C1.3 — Hub, DT and Blades** (sheet rows 133–135)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.3.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.2.2` |
| `C1.3.2` | Hub, DT and Blades Installation | Hub, DT and Blades Installation Inspection | Rotor Hub, Drive Train and Blades Installation Checklist | `C1.3.1` |
| `C1.3.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.3.2` |

**C1.4 — Generator** (sheet rows 136–138)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.4.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.3.2` |
| `C1.4.2` | Generator Installation | Generator Installation Inspection | Generator Installatio Checklist | `C1.4.1` |
| `C1.4.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.4.2` |

**C1.5 — Nacelle Top Cover** (sheet rows 139–141)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.5.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.4.2` |
| `C1.5.2` | Nacelle Top Cover Installation | Nacelle Top Cover Installation Inspection | Nacelle Top Cover Installation Checklist | `C1.5.1` |
| `C1.5.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.5.2` |

**C1.6 — Torquing** (sheet rows 142–144)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.6.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.5.2` |
| `C1.6.2` | Torquing | Torquing Inspection | Torquing Checklist | `C1.6.1` |
| `C1.6.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.6.2` |

**C1.7 — MCC Audit** (sheet rows 145–147)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.7.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.6.2` |
| `C1.7.2` | MCC Audit | MCC Audit | MCC Audit Report | `C1.7.1` |
| `C1.7.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.7.2` |

**C1.8 — Re-Verification Audit** (sheet rows 148–150)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.8.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.7.2` |
| `C1.8.2` | Re-Verification Audit | Re-Verification Audit | Re-Verification Audit Report | `C1.8.1` |
| `C1.8.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.8.2` |

## Open questions — must be confirmed live before writing any wind RFI spec

None of these can be answered from the spreadsheet. Listed roughly in the order
they would block work:

1. **Is there a wind project in the QA/docker environment at all, and what is
   its Work Region tree?** `docs/work-region-hierarchy.md` documents the
   Cluster → Site → Work Location → Work Area shape for solar; wind's `Per WTG`
   unit of RFI suggests Work Sections are individual WTGs, but the mapping of
   WTG → Work Section / Work Area is unverified.
2. **Are the checklist-less Pre-Activity / Post-Activity checkpoints
   RFI-raisable?** Half the sheet, and the entry point of every chain. If they
   are, does the Inspection Checklist dropdown render empty, absent, or broken
   (as solar's checklist-less "Routine Testing" did)?
3. **How does the checkpoint dropdown disambiguate the repeated "Routine
   Inspection" name** in the seven activities listed above — is selection scoped
   by Sub-Activity, or are there literal duplicate options?
4. **Is the `Optional? = Y` column real?** If every wind checkpoint is genuinely
   optional, the preceding-checkpoint dependency isn't blocking and there is no
   wind equivalent of `29_rfi_activity_dependency.spec.js` to write. This one
   determines whether the whole dependency-chain test concept transfers.
5. **Does the "selecting a Work Section permanently consumes it" bug apply to
   wind?** It is the single biggest constraint on the solar dependency specs
   (see `docs/rfi-activity-dependency-chain.md`) and dictated both test
   strategies there. With `Per WTG` granularity uniform across all 146 rows,
   whichever strategy applies would apply to every wind activity identically —
   the throwaway-Work-Section approach if a Work Area holds many WTGs, the
   two-Work-Areas approach if it holds one.
6. **How is the multi-valued `A1.17.1` AND-dependency enforced and reported?**
   No solar precedent.
7. **Which column feeds the Inspection Checklist dropdown** — `Inspection
   Checklist Name` (L) or `Inspection Checklist Document` (M) — and is any code
   prefix stripped, as `C_14_1` was for solar?
8. **What does `A1.10.1` actually depend on**, given `A1.9.4` no longer exists?
   Needs an answer from the sheet owner, or observation of what the app
   enforces.

## Related

- `docs/rfi-activity-dependency-chain.md` — the solar equivalent, and the
  validated test strategies the wind work would mirror.
- `tests/utils/rfi-dependency-data.js` — the solar reference data in the shape a
  spec consumes. No wind counterpart is written yet, deliberately: that file
  only holds live-confirmed values, and nothing wind is confirmed.
- `docs/work-region-hierarchy.md` — Work Region tree the RFI form cascades
  through, and how it combines with the Activity chain.
- `docs/rfi-business-logic.md` §6a — the checkpoint-dependency rule itself.
- `tests/fixtures/wind-activity-checklist.json` — this extraction,
  machine-readable.
- `tests/fixtures/Activity Master and Checklist Mapping_Wind.xlsx` — source.
