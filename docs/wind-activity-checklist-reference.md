# Wind Activity Master & Checklist Mapping — extracted reference

Reference extraction of `tests/fixtures/Activity Master and Checklist Mapping_Wind.xlsx`,
the wind-project counterpart of the solar sheet already mined for
`docs/rfi-activity-dependency-chain.md` and `tests/utils/rfi-dependency-data.js`.

**Status: the Activity/Sub-Package/Package layer is live-confirmed on pulse-dev
(2026-08-31). The checkpoint/checklist layer is still spreadsheet-only.**
The confirmed part is everything SO Mapping exposes — packages, sub-packages,
activity names and their ordering (see "Live confirmation" below). The
Inspection Checkpoint and Inspection Checklist columns cannot be confirmed
until a WIND CI exists who is SO-mapped and WAM'd, because only the RFI create
form renders them; that is a second recon pass, not done yet.

Machine-readable form: **`tests/fixtures/wind-activity-checklist.json`** — the
Current sheet, the one the app actually serves (144 objects, one per sheet row,
keys `sheetRow, srNo, package, subPackage, activity, subActivity, unitOfRfi,
uom, code, checkpoint, description, checklist, checklistDoc, optional,
preceding, remarks`). `tests/fixtures/wind-activity-checklist-draft.json` holds
the not-yet-deployed Draft sheet in the same shape. The full
`Inspection Checkpoint Description` text — long, and only useful for eyeballing
what an inspector actually checks — is kept in the JSON only, not reproduced in
the tables below.

## Which sheet is authoritative — the Current sheet, confirmed against the app

The workbook has 6 sheets, 2 of which hold data, separated by the same
`Current >>` / `Draft >>` / `Archive >>` divider tabs the solar workbook uses:

| Sheet | Section | Data rows | Activities | Used here |
| --- | --- | --- | --- | --- |
| `Current >>` | divider | 0 | — | — |
| `Activity-Checklist_07.02.26` | Current | **144** | **34** | **yes — matches the app** |
| `Draft >>` | divider | 0 | — | — |
| `Activity-Checklist_23.04.26` | Draft | 146 | 35 | not deployed |
| `Sheet1` | scratch | 11 | — | no (see below) |
| `Archive >>` | divider | 0 | — | — |

I initially picked the **Draft** sheet, reasoning by analogy with solar (where
`Activity-Checklist_06.05.2026` sat under `Draft` and was the sheet that
matched the live dropdowns). **Live recon disproved that for wind.** The
deployed master matches the **Current** sheet (`07.02.26`) exactly — 34
activities, zero difference in either direction, and the same per-sub-package
grouping and ordering. The Draft's one structural change (splitting `A1.9`
"WTG Foundation" into `A1.9a` + `A1.9b` "WTG Foundation - Bitumen Painting") is
**not** in the app: SO Mapping shows a single `7. WTG Foundation` activity under
the WTG Foundation sub-package. So the "later-dated Draft is what's deployed"
rule does not generalise from solar to wind — it has to be checked per
workbook, which is exactly why the checkpoint/checklist layer below is still
labelled unconfirmed.

Picking Current over Draft also removes the one data defect in the extraction:
the Draft's dangling `A1.10.1 -> A1.9.4` reference (the `A1.9` split renamed
every `A1.9.x` code but left `A1.10.1` pointing at the old one). The Current
sheet has **no dangling references at all**.

`Sheet1` is a scratch two-column list of activity names (Civil column:
Excavation, Blanket Layer/GSB Layer, Plum Concrete, PCC, Bottom Anchor Flange,
Reinforcement Binding, WTG Foundation, Top Flange Grouting, Backfilling
(Before Mesh), Earthing Mesh, Backfilling (After Mesh); Mechanical column:
Tower Erection, Nacelle, Hub DT and Blades, Generator, Nacelle Top Cover,
Torquing, MCC Audit, Re-Verification Audit). It carries no checkpoint,
checklist or dependency data — working notes behind the WTG Foundation and WTG
Erection activity lists. Ignored.

### What the Draft will change when it is adopted

Three changes, so this is what to expect when the app moves to `23.04.26`:

1. **`A1.9` splits into `A1.9a` + `A1.9b`.** Current has one 5-checkpoint
   activity "WTG Foundation" (`A1.9.1`–`A1.9.5`) with Bitumen Painting as its
   4th checkpoint. The Draft makes that its own activity — `A1.9a`
   "WTG Foundation" (4 checkpoints) + `A1.9b` "WTG Foundation - Bitumen
   Painting" (3 checkpoints) — taking the workbook from 34 activities to 35
   and 144 rows to 146. It also introduces the dangling `A1.9.4` pointer and
   the one Post-Activity-Checkpoint-as-dependency exception (`A1.9b.1` →
   `A1.9a.4`) noted below, so the split as drafted is not clean.
2. **`B1.1.1`'s preceding moves** `A1.14.8` → `A1.14.6` (Oil Filled
   Transformer waits on DT *Erection* rather than DT *Gravel Laying above FGL*).
3. **`B1.2.1`'s preceding moves** `A1.15.8` → `A1.15.4` (HT Switchboard waits
   on HT Foundation *Erection* rather than *Handrail Installation*).

The Current sheet carries `Remarks = "Remove"` on exactly the three rows the
Draft then rewrites or renumbers: `B1.1.1`, `B1.2.1`, and `C 1.1.1`.

## Live confirmation (pulse-dev, 2026-08-31)

Captured read-only by `tests/specs/00_inspect_wind_master_and_mobile.spec.js`;
raw output in `test-results/wind-recon/wind-master-data.json`.

- **Project Type options (7)**: `SOLAR`, `WIND`, `INFRA`, `PSS`, `ADMIN`,
  `BESS`, `TRANSMISSION_LINE`. Wind is one of seven, not one of two — the
  profile config is built to take more project types later for this reason.
- **Work Location under WIND — exactly one**: `WTG-Khavda`. Note the spelling:
  it is **Khavda**, not "Khavada". Site options are `Khavda`, `Mandvi`,
  `Mundra`.
- **Work Areas under `WTG-Khavda` — 244**, in two naming families with a
  **space** in the name: `KH 34`, `KH 35`, `KH 47`… `KH 622` and `WTG 002`,
  `WTG 121`… `WTG 557`. One outlier has no space: `WTG219`. Any exact-match
  work-area lookup must expect the space (`'KH 34'`, not `'KH34'`).
- **Packages under WIND (3)**: `Civil`, `Electrical`, `Mechanical` — title
  case in the app, upper case (`CIVIL`) in the sheet.
- **Activity rows per package**: Civil 18, Electrical 8, Mechanical 8 = 34,
  matching the Current sheet's per-sub-package counts exactly (Stone Column 2,
  WTG Foundation 11, USS Civil and Structural 4, Crane Pad 1 / USS Electrical
  7, UG Cable 1 / WTG Erection 8). Activity numbering restarts at 1 within each
  sub-package, so the Civil list reads `1.`,`2.` then `1.`…`11.` then `1.`…`4.`
  then `1.`.
- **`Re-Verification Audit` renders first and unnumbered** in the Mechanical
  package, ahead of `1. Tower Erection`, despite being `C1.8` — last — in the
  sheet. Every other activity in every package is numbered and in sheet order.
  Looks like an ordering/data defect worth reporting.
- **Existing Service Order state on `KH 34`** (the work area in the brief's
  screenshot): Stone Column's two activities on `5710012136 - BAUER
  ENGINEERING INDIA PVT LTD`; the whole WTG Foundation + USS Civil and
  Structural block on `5710014198 - BHAWANI CONSTRUCTION COMPANY`; `Fencing`
  unmapped; `Crane Pad` on `5710012743 - S S JADEJA`; all 8 Electrical
  activities on `5710013590 - AERIS ENGINEERS PVT LTD`; **all 8 Mechanical
  activities unmapped** ("Select Service Order").
- **The Service Order dropdown has 137 options, and `BAUER ENGINEERING INDIA
  PVT LTD` appears under FIVE different SO numbers**: `5710008038`,
  `5710009696`, `5710012136`, `5710017100`, `5710018312`. A vendor-name-only
  match picks the wrong one (it resolves to `5710008038`). SO selection must
  match on the **full** `"5710012136 - BAUER ENGINEERING INDIA PVT LTD"`
  string. The list also ends with a special `Multiple SOs` option.
- The **Cluster** dropdown reported zero options when read immediately on page
  load, while already displaying a selection — it needs a settle wait before
  its options can be enumerated. Cosmetic for now (selection still worked),
  but noted so it isn't mistaken for a missing-data bug later.

## Column layout, and how it differs from the solar sheet

Header row is **row 4** (solar's is row 5), data runs rows 5–148, columns B–P:

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
  solar. It is `Y` on all 144 rows.
- **New column M, "Inspection Checklist Document"** — the underlying document
  name, distinct from the checklist name. Solar had no such column. It diverges
  from column L on 59 of 144 rows (see Data quality).
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

Across all 144 Current rows (and all 146 Draft rows):

- **`Unit of RFI` = `Per WTG`** — every row, no exceptions.
- **`Unit of Measure` = `EA`** — every row.
- **`Is the Inspection Checkpoint Optional?` = `Y`** — every row.

The last one is the odd one. Read literally, *every* wind checkpoint is
optional, which would mean the preceding-checkpoint dependency is advisory
rather than enforced — the opposite of the solar behaviour that
`29_rfi_activity_dependency.spec.js` proves is hard-blocked with a
"Missing an RFI for Dependent Inspection Point" validation error. A column that
is constant across 290 rows in two independently-dated sheets is more likely an
unfilled default than a real business rule, but it cannot be assumed either
way. Still open — see Open questions.

## The shape every wind activity shares

Unlike solar — where checkpoint counts and names varied per activity — every
one of the 34 wind activities has the same skeleton:

```
Pre-Activity Checkpoint          (Sub-Activity "Pre-Activity Work",  no checklist)
  -> 1..10 real inspection checkpoints  (each with exactly one checklist)
  -> Post-Activity Checkpoint    (Sub-Activity "Post-Activity Work", no checklist)
```

34 activities x 2 bookend rows = **68 of the 144 rows (47%) have no checklist
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
unknown — one of the questions for the RFI-side recon pass.

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

**2. Dependencies cross activity boundaries — 27 of them.** An activity's
Pre-Activity Checkpoint almost always depends on the *previous* activity's last
**real** checkpoint, deliberately skipping that activity's Post-Activity
Checkpoint. E.g. `A1.4.1` (Blanket Layer Pre-Activity) → `A1.3.2` (Excavation's
Preliminary Inspection), not → `A1.3.3` (Excavation's Post-Activity
Checkpoint).

The long Civil spine runs:

```
A1.1.2 -> A1.2.1..A1.2.4 -> A1.3.1/.2 -> A1.4.1..A1.4.6 -> A1.5.1..A1.5.3
      -> A1.6.1/.2 -> A1.7.1/.2 -> A1.8.1..A1.8.3 -> A1.9.1..A1.9.4
      -> A1.10.1/.2 -> A1.11.1..A1.11.9 -> A1.12.1/.2 -> A1.13.1..A1.13.4
      -> C 1.1.1  (into WTG Erection)
```

and the Mechanical chain then runs strictly linearly
`C1.1 -> C1.2 -> C1.3 -> C1.4 -> C1.5 -> C1.6 -> C1.7 -> C1.8`, each activity's
Pre-Activity Checkpoint hanging off the previous activity's real inspection
checkpoint.

Cross-package links: `B1.1.1` (Oil Filled Transformer) → `A1.14.8` (DT Gravel
Laying above FGL); `B1.2.1` (HT Switchboard) → `A1.15.8` (HT Foundation
Handrail Installation); `B1.8.1` (HT Cabling) → `B1.2.2`; `B1.7.1` (LT Cabling)
→ `B1.4.2`; `C 1.1.1` (Tower Erection) → `A1.13.4` (GSB Layer).

**3. Every Post-Activity Checkpoint is a dead end.** All 34 are never named as
anyone's preceding checkpoint, and no non-Post-Activity row is ever a dead end.
(The Draft breaks this: its `A1.9b.1` depends on `A1.9a.4`, a Post-Activity
Checkpoint — a by-product of chaining the new `A1.9b` onto the tail of `A1.9a`
rather than onto its last real checkpoint the way every other transition is
wired.)

**One row has a multi-valued dependency**: `A1.17.1` (Fencing Pre-Activity) →
`A1.16.6, A1.15.8, A1.14.8` — Fencing waits on Burnt Oil Tank, HT Foundation
*and* DT all completing. Present in both sheets. Nothing in the solar sheet had
more than one preceding checkpoint, so how the app enforces an AND-dependency
(and what its validation toast says) is entirely unknown.

## Data quality flags

Real defects in the source sheet, worth raising with whoever owns it:

1. **`C1.1`'s three checkpoint codes are written `C 1.1.1`, `C 1.1.2`,
   `C 1.1.3` — with a space** — while its Sr. No. is `C1.1` and every other
   code in the workbook is space-free. `C1.2.1`'s preceding is correspondingly
   written `C 1.1.2`, so the chain still resolves, but any code-based lookup has
   to tolerate the space. Present in both sheets.
2. **Checklist name ≠ checklist document on 59 of 144 rows.** Mostly harmless
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
3. **Three checkpoints have a checklist name but no real checklist**, with the
   document column instead holding a question: `C1.6.2` Torquing, `C1.7.2` MCC
   Audit, `C1.8.2` Re-Verification Audit all read "No Checklist  Q: Duly-Filled
   [Torquing Sheet / MCC Audit Report / Re-Verification Audit Report]
   Submitted to Concerned AGEL Team for Review?". This is the same pattern as
   solar's out-of-scope "Routine Testing" checkpoint, which rendered a broken
   dropdown live. Treat these three as suspect.
4. **Spelling errors carried into names the app may display verbatim**:
   `Backfiiling Checklist` (4 rows), `Backfiling Layer N` (10 rows, one `l`),
   `Generator Installatio Checklist`, `Checklist for Preacst Elements`,
   `Barbed Wire checklist` / `White Wash Checklist` inconsistent casing,
   `Depth calibration censer` in a description. If these strings are what the
   dropdown renders, specs must match them exactly as-is, typos included — same
   as solar, where `C_14_1 Micro Pile Checklist` had to be matched with its code
   prefix stripped.
5. **`Re-Verification Audit` renders first and unnumbered in the app's
   Mechanical package** despite being last (`C1.8`) in the sheet — see Live
   confirmation. An app-side ordering defect rather than a sheet defect.

## Full extraction — Current sheet (`Activity-Checklist_07.02.26`)

34 activities across 3 packages and 7 sub-packages: CIVIL (Stone Column, WTG
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

**A1.9 — WTG Foundation** (sheet rows 37–41)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.9.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.8.3` |
| `A1.9.2` | WTG Foundation | Pre Pour Inspection - WTG Foundation | Pre-Pour Checklist | `A1.9.1` |
| `A1.9.3` | WTG Foundation | Post Pour Inspection - WTG Foundation | Post-Pour Checklist | `A1.9.2` |
| `A1.9.4` | Bitumen Painting of WTG Foundation | Routine Inspection | Bitumen Coating Painting Checklist | `A1.9.3` |
| `A1.9.5` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.9.4` |

**A1.10 — Top Flange Grouting** (sheet rows 42–44)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.10.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.9.4` |
| `A1.10.2` | Top Flange Grouting | Grouting | WTG Top Flange Grouting Checklist | `A1.10.1` |
| `A1.10.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.10.2` |

**A1.11 — Backfilling (Before Mesh)** (sheet rows 45–54)

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

**A1.12 — Earthing Mesh** (sheet rows 55–57)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.12.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.11.9` |
| `A1.12.2` | Earthing Mesh | Routine Inspection | Earthing Mesh Checklist | `A1.12.1` |
| `A1.12.3` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.12.2` |

**A1.13 — Backfilling (After Mesh)** (sheet rows 58–62)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.13.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.12.2` |
| `A1.13.2` | Backfilling After Mesh Placement | Backfiling Layer 9 | Backfilling Checklist | `A1.13.1` |
| `A1.13.3` | Backfilling After Mesh Placement | Backfiling Layer 10 | Backfilling Checklist | `A1.13.2` |
| `A1.13.4` | GSB Layer | GSB Layer | GSB Inspection Checklist | `A1.13.3` |
| `A1.13.5` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.13.4` |

### CIVIL / USS Civil and Structural


**A1.14 — DT** (sheet rows 63–71)

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

**A1.15 — HT Foundation** (sheet rows 72–80)

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

**A1.16 — Burnt Oil Tank** (sheet rows 81–87)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.16.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `A1.16.2` | Excavation | Pre-Inspection | Excavation Checklist - General Works | `A1.16.1` |
| `A1.16.3` | PCC | Routine Inspection | PCC Checklist | `A1.16.2` |
| `A1.16.4` | Erection | Routine Inspection | Precast Elements Erection, Positioning & Grouting Checklist | `A1.16.3` |
| `A1.16.5` | Backfilling | Routine Inspection | Backfiiling Checklist | `A1.16.4` |
| `A1.16.6` | Drain Pipe Connectivity | Final Inspection | BOT Level and Pipe Connectivity Checklist | `A1.16.5` |
| `A1.16.7` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.16.6` |

**A1.17 — Fencing** (sheet rows 88–95)

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


**A1.18 — Crane Pad** (sheet rows 96–100)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `A1.18.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `A1.18.2` | OGL | Pre-Inspection | OGL Checklist | `A1.18.1` |
| `A1.18.3` | Boulder Laying | Routine Inspection | Boulder Laying Checklist | `A1.18.2` |
| `A1.18.4` | GSB Laying | Final Inspection | GSB Laying Checklist | `A1.18.3` |
| `A1.18.5` | Post-Activity Work | Post-Activity Checkpoint | - | `A1.18.4` |

### ELECTRICAL / USS Electrical


**B1.1 — Oil Filled Transformer** (sheet rows 101–103)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.1.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.14.8` |
| `B1.1.2` | Transformer and Accessories Installation | Transformer and Accessories Installation Inspection | IDT Oil Filled Transformer Field Quality Protocol | `B1.1.1` |
| `B1.1.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.1.2` |

**B1.2 — HT Switchboard** (sheet rows 104–106)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.2.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.15.8` |
| `B1.2.2` | HT Panel and Accessories Installation | HT Panel and Accessories Installation Inspection | HT Switchboard Field Quality Protocol | `B1.2.1` |
| `B1.2.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.2.2` |

**B1.3 — Earthing** (sheet rows 107–109)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.3.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `B1.3.2` | Earthing Flat Work | Earthing Flat Work Inspection | Earthing Field Quality Protocol | `B1.3.1` |
| `B1.3.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.3.2` |

**B1.4 — Cable Tray** (sheet rows 110–112)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.4.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `B1.4.2` | LT Cable Tray Work | LT Cable Tray Work Inspection | Cable Tray Field Quality Protocol | `B1.4.1` |
| `B1.4.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.4.2` |

**B1.5 — Illumination** (sheet rows 113–115)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.5.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `B1.5.2` | Light Pole Work | Light Pole Work Inspection | Illumination Field Quality Protocol | `B1.5.1` |
| `B1.5.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.5.2` |

**B1.6 — LT Switchboard** (sheet rows 116–118)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.6.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `-` |
| `B1.6.2` | ACDB Work | ACDB Work Inspection | LT Switchboards Field Quality Protocol | `B1.6.1` |
| `B1.6.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.6.2` |

**B1.7 — LT Cabling** (sheet rows 119–121)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.7.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `B1.4.2` |
| `B1.7.2` | LT Cable Laying | LT Cable Laying Inspection | LT Cabling Field Quality Protocol | `B1.7.1` |
| `B1.7.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.7.2` |

### ELECTRICAL / UG Cable


**B1.8 — HT Cabling** (sheet rows 122–124)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `B1.8.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `B1.2.2` |
| `B1.8.2` | HT Cable Laying | HT Cable Laying Inspection | HT Cable Field Quality Protocol | `B1.8.1` |
| `B1.8.3` | Post-Activity Work | Post-Activity Checkpoint | - | `B1.8.2` |

### MECHANICAL / WTG Erection


**C1.1 — Tower Erection** (sheet rows 125–127)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C 1.1.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `A1.13.4` |
| `C 1.1.2` | Tower Erection | Tower Erection Inspection | Tower Erection Checklist | `C 1.1.1` |
| `C 1.1.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C 1.1.2` |

**C1.2 — Nacelle** (sheet rows 128–130)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.2.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C 1.1.2` |
| `C1.2.2` | Nacelle Installation | Nacelle Installation Inspection | Nacelle Installation Checklist | `C1.2.1` |
| `C1.2.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.2.2` |

**C1.3 — Hub, DT and Blades** (sheet rows 131–133)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.3.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.2.2` |
| `C1.3.2` | Hub, DT and Blades Installation | Hub, DT and Blades Installation Inspection | Rotor Hub, Drive Train and Blades Installation Checklist | `C1.3.1` |
| `C1.3.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.3.2` |

**C1.4 — Generator** (sheet rows 134–136)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.4.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.3.2` |
| `C1.4.2` | Generator Installation | Generator Installation Inspection | Generator Installatio Checklist | `C1.4.1` |
| `C1.4.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.4.2` |

**C1.5 — Nacelle Top Cover** (sheet rows 137–139)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.5.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.4.2` |
| `C1.5.2` | Nacelle Top Cover Installation | Nacelle Top Cover Installation Inspection | Nacelle Top Cover Installation Checklist | `C1.5.1` |
| `C1.5.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.5.2` |

**C1.6 — Torquing** (sheet rows 140–142)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.6.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.5.2` |
| `C1.6.2` | Torquing | Torquing Inspection | Torquing Checklist | `C1.6.1` |
| `C1.6.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.6.2` |

**C1.7 — MCC Audit** (sheet rows 143–145)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.7.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.6.2` |
| `C1.7.2` | MCC Audit | MCC Audit | MCC Audit Report | `C1.7.1` |
| `C1.7.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.7.2` |

**C1.8 — Re-Verification Audit** (sheet rows 146–148)

| Code | Sub-Activity | Inspection Checkpoint | Inspection Checklist | Preceding |
| --- | --- | --- | --- | --- |
| `C1.8.1` | Pre-Activity Work | Pre-Activity Checkpoint | - | `C1.7.2` |
| `C1.8.2` | Re-Verification Audit | Re-Verification Audit | Re-Verification Audit Report | `C1.8.1` |
| `C1.8.3` | Post-Activity Work | Post-Activity Checkpoint | - | `C1.8.2` |

## Live confirmation round 2 — the RFI create form (pulse-dev, 2026-08-31)

Captured by `tests/specs/00_inspect_wind_rfi_form.spec.js`, logged in as the
WTG Contractor Incharge created by the smoke chain, on WIND / WTG-Khavda /
KH 34 / Civil / Crane Pad. Raw output in
`tests/fixtures/so-mapping-baseline/wind-rfi-form-recon.json`. Nothing was
submitted and **no Work Section was ever selected** — only counted — because
selecting one permanently consumes it.

**The form narrows Activity -> Sub-Activity -> Checkpoint -> Checklist, and each
step lands on exactly one thing.** Every Sub-Activity offers exactly ONE
Inspection Checkpoint, and every Checkpoint offers exactly ONE Inspection
Checklist. The sheet's rows are therefore 1:1 with (Sub-Activity, Checkpoint)
pairs, which is what the Crane Pad probe showed against the sheet's five
`A1.18.x` rows.

- **The checklist-less bookend checkpoints ARE raisable, and they DO have a
  checklist.** `Pre-Activity Checkpoint` and `Post-Activity Checkpoint` both
  appear in the dropdown and both offer a real option:
  **"Documents and report information"**. So column L's `-` does not mean "no
  checklist in the app" — there is a generic one. This is much better than
  solar's checklist-less "Routine Testing", which rendered a broken dropdown
  and had to be left out of scope. 68 of the 144 rows are these bookends, so
  this unblocks roughly half the sheet.
- **There is exactly ONE Work Section per Work Area, and it is the Work Area's
  own name** (selecting Work Area `KH 34` makes `KH 34` the only Work Section).
  This is solar's `Block`-granularity case, so the wind dependency spec needs
  the **two-Work-Areas** strategy
  (`runDependencyChainForScarceWorkSectionActivity`), not the
  throwaway-Work-Section one. Consistent with `Unit of RFI = Per WTG` on every
  row: a wind Work Area *is* one WTG.
- **The Inspection Checklist dropdown shows the checklist NAME with no code
  prefix** — `OGL Checklist`, `Boulder Laying Checklist`. So column L feeds it,
  and unlike solar there is no `C_14_1`-style prefix to strip.
- **Activity and Sub-Activity are rendered with numeric prefixes; Checkpoint
  and Checklist are not.** Live: Activity `1. Crane Pad`; Sub-Activities
  `1.1 Pre-Activity Work`, `1.2 OGL`, `1.3 Boulder laying`, `1.4 GSB laying`,
  `1.5 Post-Activity Work`. Any matching against the activity master must strip
  a leading `<n>.` / `<n>.<n>` and compare case-insensitively — note live
  `Boulder laying` / `GSB laying` vs the sheet's `Boulder Laying` / `GSB
  Laying`.
- **Sub-Package list matches the sheet exactly**: `Crane Pad`, `Stone Column`,
  `USS Civil and Structural`, `WTG Foundation`.
- **The CI sees only what it was WAM'd**: one Work Location (`WTG-Khavda`), one
  Work Area (`KH 34`), one Package (`Civil`) — confirming stages 1-3 of the
  smoke chain wired up correctly end to end. It also means a spec needing TWO
  Work Areas requires both to be SO-mapped AND WAM'd first.
- **One checklist discrepancy against the sheet**, across the 12
  (Sub-Activity, Checkpoint) pairs checked so far: Crane Pad's
  `Final Inspection` (`A1.18.4`, Sub-Activity `GSB Laying`) — the sheet says
  `GSB Laying Checklist` but the app offers **`GSB Inspection Checklist`**,
  which is the sheet's checklist for a *different* row (`A1.13.4`, GSB Layer
  under Backfilling (After Mesh)). Worth raising with the sheet owner.
  `A1.4 Blanket Layer/GSB Layer` had no discrepancy at all. The recon spec now
  reports this comparison automatically (per (Sub-Activity, Checkpoint) pair)
  rather than leaving it to be spotted by eye — the two "diffs" it prints for
  the Pre-/Post-Activity bookends are expected, being the sheet's `-` against
  the app's real `Documents and report information`.
- **Still exactly one checklist option everywhere**, so the "pick any one of
  several checklist options" mechanic remains unexercised in wind, exactly as
  it stayed unexercised across all six solar activity chains.

## Open questions

Struck through where recon answered them.

1. ~~Is there a wind project in the environment at all, and what is its Work
   Region tree?~~ **Answered**: `WIND`, one Work Location `WTG-Khavda` under
   Site `Khavda`, 244 Work Areas (`KH nn` / `WTG nnn`, with a space), 3
   packages.
2. ~~Do the sheet's activity names match the deployed master?~~ **Answered**:
   the Current sheet matches exactly, 34/34, both directions.
3. ~~Are the checklist-less Pre-Activity / Post-Activity checkpoints
   RFI-raisable?~~ **Answered**: yes, and they offer a real checklist,
   "Documents and report information".
4. ~~How does the checkpoint dropdown disambiguate the repeated "Routine
   Inspection" name?~~ **Answered, and confirmed on the worst case**: the
   Checkpoint dropdown is scoped to the selected Sub-Activity and offers
   exactly one checkpoint, so the repeated name can never be ambiguous in the
   UI. Verified directly against `A1.4 Blanket Layer/GSB Layer` — the activity
   whose five rows are ALL named "Routine Inspection". Live it has 7
   sub-activities (`2.1 Pre-Activity Work`, `2.2`–`2.6 Blanket/GSB Layer 1..5`,
   `2.7 Post-Activity Work`), each offering exactly ONE checkpoint, and the
   five layer sub-activities each offer one "Routine Inspection" with checklist
   `Stone Blanket Layer Checklist`. Sub-activity sets match the sheet exactly,
   7 vs 7, no difference in either direction. **Selection must therefore always
   be by (Sub-Activity, Checkpoint), never by checkpoint name alone.**
5. **Is the `Optional? = Y` column real?** Still open — needs actually
   submitting RFIs and observing whether a missing predecessor blocks. If every
   wind checkpoint is genuinely optional there is no wind equivalent of
   `29_rfi_activity_dependency.spec.js` to write.
6. ~~What is a wind Work Section, given `Per WTG` granularity?~~ **Answered**:
   exactly one per Work Area, named after the Work Area. Wind therefore needs
   the two-Work-Areas dependency strategy.
7. **Does the "selecting a Work Section permanently consumes it" bug apply to
   wind?** Still open — deliberately not probed, since probing it costs the
   only Work Section a Work Area has.
8. **How is the multi-valued `A1.17.1` AND-dependency enforced and reported?**
   Still open. No solar precedent.
9. ~~Which column feeds the Inspection Checklist dropdown, and is a code prefix
   stripped?~~ **Answered**: column L (Checklist Name), no prefix.

## Related

- `docs/rfi-activity-dependency-chain.md` — the solar equivalent, and the
  validated test strategies the wind work would mirror.
- `tests/utils/rfi-dependency-data.js` — the solar reference data in the shape a
  spec consumes. No wind counterpart is written yet, deliberately: that file
  only holds live-confirmed values, and the wind checkpoint/checklist layer is
  not confirmed yet.
- `tests/specs/00_inspect_wind_master_and_mobile.spec.js` — the read-only recon
  that produced the Live confirmation section; re-runnable with
  `PULSE_ENV=dev npx playwright test tests/specs/00_inspect_wind_master_and_mobile.spec.js --project=chromium --workers=1`.
- `docs/work-region-hierarchy.md` — Work Region tree the RFI form cascades
  through, and how it combines with the Activity chain.
- `docs/rfi-business-logic.md` §6a — the checkpoint-dependency rule itself.
- `tests/fixtures/wind-activity-checklist.json` — the Current (deployed) sheet,
  machine-readable. `-draft.json` — the not-yet-deployed Draft sheet.
- `tests/fixtures/Activity Master and Checklist Mapping_Wind.xlsx` — source.
