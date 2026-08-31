# Work Region Hierarchy (Location Master)

Companion to the Activity Sequence document. That one defines **what work is done**
(Package → Sub-Package → Activity → Sub-Activity → Inspection Checkpoint).
This one defines **where the work is done**.

An RFI is raised at the intersection of the two: one Sub-Activity × one Work Area.
Work Location and Work Area are both always picked directly on `RFICreatePage`
(cascading dropdowns) — Min. Unit of RFI never substitutes one for the other.

What Min. Unit of RFI (`Table` / `Inverter` / `Block`, fixed per Sub-Activity)
actually controls is the granularity of the separate **Work Section** field
*within* that Work Area: Table/Inverter-type Sub-Activities scope the Work
Section to one specific table or inverter inside the Work Area; Block-type
Sub-Activities scope the Work Section to the whole Work Area itself (no further
subdivision) — still Work Area level, not a jump up to Work Location. See
`docs/rfi-business-logic.md` §3–§4, §6b for the confirmed mechanics.

### Analogy: building a house

Building a house needs two independent plans: **where** (site survey → country →
state → district → exact plot) and **what** (site prep → foundation → walls → roof
→ windows → finishing, each step gated on the one before it). Pulse's RFI
creation mirrors both:

- **Where — Work Region hierarchy:** Cluster → Site → Work Location → Work Area
  → Work Section (e.g. Gujarat → Khavda → a project-specific Work Location such
  as `A-05b` for solar or `WTG-Khavda` for wind → the exact Work Area/Work
  Section being inspected). See §1 and §3–§8 below for the confirmed structure
  and counts.
- **What — Activity hierarchy:** Package → Sub-Package → Activity → Sub-Activity
  → Inspection Checkpoint, with the same "can't build the roof before the
  foundation" rule — some Sub-Activities have no dependency and must be
  inspected first; only once those checkpoints are approved can dependent
  Sub-Activities be raised. Confirmed mechanics in `docs/rfi-business-logic.md`
  §4, §6a–§6b.

Both hierarchies must resolve before an RFI can be created (§2c), and WAM (§2b)
decides which slice of each a given user can even see or act on — that's the
"connection logic" between the two: WAM is the gate, not a third hierarchy.

One terminology note on the example above, resolved (§2d has the full
detail): `WTG-Khavda` is a **Work Location** (confirmed — this doc's §1 and
Appendix A); the level below it that Pulse's UI calls **Work Area** (e.g.
`WTG 45`, `BL01`) is the actual RFI leaf. **Work Section** is a distinct
4th-level field only for Table/Inverter (and Cable/Culvert) Min. Unit
Sub-Activities (e.g. `R01-T71`) — for Block Min. Unit Sub-Activities it
collapses onto the Work Area itself (same node, live-confirmed example in
§2d), so "Work Location → Work Area → Work Section" is sometimes a 3-step
walk and sometimes 4, depending on the Sub-Activity, not a fixed depth.

Source: `CCTECH_DRS_ENTITIES_DESIGNELEMENTS` export, 2026-08-28 14:11, filtered to
production records only. Test and automation data — `A-TEST*`, `MAHENDRA-*`,
`TEST-*`, `Int Test`, `yogesh`, `TPP-*`, `TP-*`, `WL-2`, `Pulse DRS Integration`,
the `E2E-WL-A-*` series under Mundra, and the whole `Pulste-Integration` site — is
excluded. Counts below match the Locations Configurator tree.

---

## 1. Structure

```
Cluster (e.g. "Gujarat")
└── Site (e.g. "Khavda")
    └── Work Location (e.g. "A-16d", "BESS PSS-09", "WTG-Khavda")
        ├── Project Type: solar / wind / bess / infra / pss / transmission_line
        │                 (attribute on the row — NOT a tree node)
        └── Work Area (e.g. "BL01", "Road12", "Culvert 3", "WTG 45", "SWYD")
                        └── leaf; the unit an RFI is raised against
```

Depth is fixed at 4 levels. Every node has exactly one parent; no level is skippable
and no work location is empty.

---

## 2. Cascading filters, WAM visibility & the two dependency chains

Two separate filtering layers sit on top of the raw hierarchy in §1, and RFI
creation is gated by two independent master-data chains, not just this one.

### 2a. Structural (parent-scoped) filtering

Every dropdown on `RFICreatePage` is scoped to the parent selected above it —
picking Cluster "Gujarat" leaves only Gujarat's sites (Khavda, Mandvi, Mundra)
in the Site dropdown; Rajasthan's (Baiya, Bandha) never appear. Same rule
applies Site → Work Location → Work Area. This is plain cascading-dropdown
filtering, independent of any user/role logic.

### 2b. WAM (user-mapping) visibility filtering — stacked on top

On top of 2a, **WAM restricts the tree to only what the logged-in user is
mapped to.** If a Project Manager is WAM-mapped to a Work Location in Khavda
only, Mandvi/Mundra/Baiya/Bandha never show up for them at all — not because
those sites don't exist, but because WAM never granted visibility into them.
Two users with identical roles can see completely different slices of the
same Location Master tree depending on their individual WAM mapping.

WAM's role here is broader than location visibility alone — it also decides
**who participates in the RFI flow** (creation, approval, visibility of an
existing RFI, reassignment eligibility, etc.) for a given work region /
Service Order combination. See `docs/rfi-business-logic.md` §2 for the WAM ↔
Service Order ↔ RFI mechanics; this doc only covers the location side of
that mapping.

### 2c. RFI creation depends on two independent chains

RFI creation form fields walk down **two separate master-data hierarchies**,
both of which must be fully resolved before an RFI can be submitted:

1. **Work Region** (this doc): Cluster → Site → Work Location → Work Area →
   Work Section (only where the Sub-Activity's Min. Unit of RFI makes Work
   Section applicable — see §6/§7 below and `rfi-business-logic.md` §3).
2. **Activity Master** (`docs/rfi-business-logic.md` §4): Package →
   Sub-Package → Activity → Sub-Activity → Inspection Checkpoint/Checklist.

The two chains are picked independently on the form (neither filters the
other), and WAM (2b) gates which combinations of the two a given user can
act on.

### 2d. Work Section types — confirmed: 4 (`TABLE` / `INVERTER` / `CABLE` / `CULVERT`)

Per screenshots of the Work Section create/edit panel (`Name` + `Type`
fields), the `Type` field has (at least) four confirmed values:

| Type | Example `Name` | Seen under (Work Area family) |
|------|----------------|--------------------------------|
| `TABLE` | `R01-T01` | Table-based Sub-Activities |
| `INVERTER` | `I47` | Inverter-based Sub-Activities |
| `CABLE` | `0m-100m`, `100m-200m`, `1000m-1100m` | `BL{nn}` (Block) Work Areas — cable-route segments, distance-range naming |
| `CULVERT` | `0-100m`, `100-200m`, `1000-1100m` | `Culvert {n}` Work Areas — same distance-range style, no `m` suffix seen |

Naming convention is per-project and can change over time (per app owner) —
`TABLE`/`INVERTER` use row-table/inverter-number style names, `CABLE`/
`CULVERT` use distance-range names. Assert on `Type` + the fixed-inventory
rule (`rfi-business-logic.md` §3a), never on the `Name` pattern.

Left-panel tree view for a Work Area shows its Work Sections as a
multi-select checkbox list with a count badge (e.g. `BL01 (411)`, `Culvert 1
(20)`) — consistent with `rfi-business-logic.md` §3a's "fixed inventory,
multi-select-capable" description.

**Reconciliation with `rfi-business-logic.md` §3–§4 — resolved (confirmed by
user, 2026-08-28):** the fourth level (Work Section) is only ever a
*distinct* pick for some Sub-Activities, not all:

- **Table / Inverter Min. Unit** — Work Section is a genuinely separate
  node from the Work Area (`TABLE`/`INVERTER` types above). Full depth is 4:
  Work Location → Work Area → Work Section (a distinct value).
- **Block Min. Unit** — Work Section and Work Area **point to the same
  thing**; there is no separate Work Section value to pick, it collapses to
  the Work Area itself. Effective depth is 3: Work Location → Work Area
  (= Work Section). This matches `rfi-business-logic.md` §6b's "Block-type
  (work-area-level)" wording exactly — it's now just stated more precisely
  as "same node," not merely "no further subdivision."
**Correction (user, 2026-08-28) — don't conflate Work Section `Type` with
Min. Unit of RFI; they're two separate axes:**

- `CABLE` / `CULVERT` are not a 4th/5th Min. Unit of RFI value competing
  with `Table`/`Inverter`/`Block`. Only three Min. Unit values are
  confirmed, and they alone decide depth-4-vs-3 (above). `CABLE`/`CULVERT`
  are Work Section `Type` labels that track the **Work Area's own family**
  instead — `Culvert {n}` Work Areas are a distinct family parallel to
  `BL{nn}` (Block) and `Drain{n}` (confirmed live: a Work Area list screen
  showed `BL17`…`BL24`, `Culvert 1`…`Culvert 5`, `Drain1`…`Drain17` as
  sibling Work Areas under one `+ Add Work Area` list — matches §6's
  families table, nothing new there).
- **Live-confirmed example of the Block collapse (2026-08-28):** on the RFI
  creation form, Work Location `A-06c` → Work Area `BL01` → Package `Civil`
  → Sub-Activity `IDT Civil & Structural - Cable Rack` → the Work Section
  field showed **Total Work Sections: 1**, with the single available value
  already selected as chip `BL01` — i.e. Work Section literally *is* `BL01`,
  the Work Area itself. So a Sub-Activity whose name contains "Cable" can
  still be Block Min. Unit (depth 3, collapsed) — it is not automatically a
  `CABLE`-type, distance-subdivided Work Section (depth 4). The two
  "cable" things (a Cable Rack *Sub-Activity* vs. a `CABLE`-*Type* Work
  Section) are unrelated concepts that happen to share a name.

### 2e. Location Master is configured in a separate app (DRS)

The Cluster/Site/Work Location/Work Area tree itself (adding, removing,
renaming, or restructuring nodes) is authored in **DRS**, a separate
application — not in the app under test here. Treat the hierarchy in this
doc as a snapshot, not a static contract — it can change, and this test
suite should never assume the tree is fixed or attempt to validate DRS's own
config UI. What's fixed for testing purposes is the *shape* (4 levels,
`PROJECT_TYPE`/`PROJECT_ID` on levels 3–4 only), not the specific nodes.

---

## 3. Level reference

| # | Level | `TYPE` | Parent | Count | Notes |
|---|-------|--------|--------|------:|-------|
| 1 | Cluster | `CLUSTER` | — (root) | 2 | Gujarat, Rajasthan |
| 2 | Site | `SITE` | Cluster | 5 | Khavda, Mandvi, Mundra, Baiya, Bandha |
| 3 | Work Location | `WORKLOCATION` | Site | 79 | Carries `PROJECT_TYPE` and a `PROJECT_ID` |
| 4 | Work Area | `WORKAREA` | Work Location | 3,945 | Leaf; carries its own `PROJECT_ID` |

`PROJECT_TYPE` is a column on levels 3–4, not a row. Clusters and Sites never carry it.
The reference diagram draws Project Type between Site and Work Location — that is a
filter/grouping dimension in the UI, not a parent node.

**Project and Work Location are many-to-many.** `PROJECT_ID` sits on the Work Area, and
a Work Location's own `PROJECT_ID` is only one of the projects it may hold:

- One location, many projects: `WTG-Khavda` spans 6 project IDs across its 244 work areas; `PSS-Khavda` spans 2.
- One project, many locations: the three `Khavda-Site-Infra-*` locations share one project ID; likewise the `-Wind-Infra-*` and `-PSS-Infra-*` sets, and `S-05a` / `A-14a` / `A-15a`.

79 work locations resolve to 76 distinct project IDs. Filter work areas by their own
`PROJECT_ID`, never by the parent's.

---

## 4. Snapshot by Cluster / Site

| Cluster | Site | Work Locations | Work Areas | Project types present |
|---------|------|---------------:|-----------:|-----------------------|
| Gujarat | Khavda | 73 | 3,506 | solar, bess, infra, wind, pss, transmission_line |
| Gujarat | Mandvi | 2 | 70 | wind, pss |
| Gujarat | Mundra | 1 | 98 | wind |
| Rajasthan | Baiya | 1 | 96 | solar |
| Rajasthan | Bandha | 2 | 175 | solar |

Khavda is the only site with breadth. Mandvi, Mundra, Baiya and Bandha are single-purpose
and hold 1–2 locations each — but between them they cover wind, pss and solar, so they
are cheap to include in a regression pass.

---

## 5. Project Type values

| Value | Work Locations | Work Areas | Examples |
|-------|---------------:|-----------:|----------|
| `solar` | 55 | 3,336 | A-01, S-06b, Bandha-534 MW |
| `bess` | 9 | 167 | BESS PSS-05A … BESS PSS-12 |
| `infra` | 9 | 27 | Khavda-Site-Infra-Roads / -Drains / -Culverts |
| `wind` | 3 | 411 | WTG-Khavda, WTG-Mandvi, WTG-Mundra |
| `pss` | 2 | 3 | PSS-Khavda, PSS-Mandvi |
| `transmission_line` | 1 | 1 | TL-Khavda-400KV |

Stored lowercase snake_case (`transmission_line`), not the UI display label. Assert on the
raw value. No production record has a blank project type.

---

## 6. Work Area families

The leaf level mixes block, linear-infra and asset units:

| Family | Count | Appears under | Meaning |
|--------|------:|---------------|---------|
| `Road{n}` / `Road {n}` | 1,111 | solar, bess, infra | Road stretch |
| `Drain{n}` / `Drain {n}` | 1,111 | solar, bess, infra | Drain stretch |
| `BL{nn}` | 1,009 | solar, bess | Block |
| `Culvert {n}` | 280 | solar, infra | Culvert |
| `WTG {n}` | 134 | wind | Turbine — Khavda only (`WTG-Khavda`); Mandvi's turbines use `MP{n}`/`MNP{n}`, not this family |
| `KH {n}` | 109 | wind | Khavda turbine series |
| `MNP{n}` | 91 | wind | Turbine — 89 at Mundra (`WTG-Mundra`), 2 at Mandvi (`WTG-Mandvi`) |
| `MP{n}` | 66 | wind | Mandvi turbine series |
| `SWYD` | 9 | bess | Switchyard (single, unnumbered) |
| `O&M Store` | 9 | bess | O&M store (single, unnumbered) |
| `PSS-{n}` | 2 | pss | Pooling substation unit (Khavda only — `PSS-Khavda`) |

Composition is predictable per project type:

- **solar** — `20 Road + 20 Drain + 5 Culvert + n BL` (n varies, 6–56)
- **bess** — `5 Road + 5 Drain + n BL + SWYD + O&M Store`
- **infra** — a single family only: 2 roads, 2 drains, or 5 culverts
- **wind** — turbine IDs only, no roads or drains

The fixed 20/20/5 and 5/5 infra counts are a useful completeness check on a solar or bess
location.

### 6a. This table isn't exhaustive — 14 Work Areas sit outside these 11 families

The 11 rows above sum to 3,931, not the full 3,945 (verified by re-summing every
row in Appendix A/B against §5's project-type totals — everything else ties out
exactly). The 14-unit gap is one-off naming patterns, none large enough to be
worth their own family row but real, counted Work Areas nonetheless:

| Pattern | Count | Work Location | Notes |
|---|---:|---|---|
| `BL-01` (hyphenated) | 1 | `S-07a` | Already noted in §7 as a separator outlier — same family as `BL{nn}`, excluded from the 1,009 count above |
| `WTG 233A` | 1 | `WTG-Khavda` | Already noted in §7 as a numbering outlier — same family as `WTG {n}`, excluded from the 134 count above |
| `NHPCPSStoKPS-{n}` | 1 | `TL-Khavda-400KV` | The transmission line's only Work Area — its own one-off naming, not part of any family above |
| `MandviPSS{n}MW` | 1 | `PSS-Mandvi` | Distinct naming from the `PSS-{n}` family (which is Khavda-only) — don't assume `pss` project type always names areas `PSS-{n}` |
| `MP-P{n}` | 1 | `WTG-Mandvi` | One-off alongside that location's `MP{n}`/`MNP{n}` |
| `MUNN{n}` | 8 | `WTG-Mundra` | A second turbine sub-series at Mundra, alongside `MNP{n}` |
| `MNP{n}S` | 1 | `WTG-Mundra` | One-off variant of `MNP{n}` at the same location |

Don't assume the 11-row family table is a closed enum when writing dropdown/
filter assertions — the naming variety above is minor in count but real in
production data, and per §2e it's DRS-managed so more one-offs can appear.

---

## 7. Data notes

1. **Separators are inconsistent across families.** `Road12` (no space) under solar,
   `Road 12` under bess and infra; `BL01` everywhere except one `BL-01` in `S-07a`.
   Match Work Areas by `ID`, not by name pattern.
2. **Two numbering outliers:** `WTG 233A` in WTG-Khavda breaks the numeric series, and
   `MNP23 ` in WTG-Mundra has a trailing space. Trim before comparing.
3. **`TL-Khavda-400KV` has no `PROJECT_ID`** on the Work Location row, though its single
   work area does. Confirm whether that is expected for transmission line records.
4. **Work Location names are unique within a Site in production data** — the duplicate
   `S-01-100MW` / `S-01-200MW` pairs were the dummy records, now excluded. Worth a
   uniqueness check in the create flow so it stays that way.

---

## 8. Implications for testing

- Key on `ID`. Names carry inconsistent separators, casing and one trailing space.
- Filter work areas by their own `PROJECT_ID` — a location's project ID is not authoritative for its children.
- Coverage set: one location per project type rather than several solar ones. Four of the
  six types have fewer than ten locations each and are the thin paths —
  `BESS PSS-09` (bess, has SWYD and O&M Store), `Khavda-Site-Infra-Roads` (infra, 2 areas),
  `PSS-Mandvi` (pss, 1 area), `TL-Khavda-400KV` (transmission_line, 1 area).
- Largest fan-outs for pagination and tree rendering: `WTG-Khavda` (244 work areas),
  `A-12 - 350MW` (101), `WTG-Mundra` (98), `Baiya-600 MW` (96), and `Khavda` as a site
  (73 work locations).
- Smallest: `TL-Khavda-400KV` and `PSS-Mandvi` at one work area each — good for empty-ish
  state and single-row rendering.
- Before asserting a Cluster/Site/Work Location/Work Area is *absent* from a dropdown,
  confirm whether that's structural (§2a — wrong parent selected) or WAM (§2b — the test
  user just isn't mapped to it) before treating it as a data or app bug.
- Don't hardcode the tree as immutable in fixtures/assertions — it's DRS-managed (§2e)
  and can gain/lose nodes between runs.

---

## Appendix A — Khavda (73 Work Locations)

| Work Location | Project Type | Work Areas | Composition |
|---|---|---:|---|
| A-01 | solar | 55 | Road# ×20, Drain# ×20, BL# ×10, Culvert# ×5 |
| A-01a - 150MW | solar | 53 | Road# ×20, Drain# ×20, BL# ×8, Culvert# ×5 |
| A-01a - 50MW | solar | 49 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×4 |
| A-01c - 25MW | solar | 47 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×2 |
| A-01d - 25MW | solar | 47 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×2 |
| A-01e - 25MW | solar | 47 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×2 |
| A-02a-125MW | solar | 55 | Road# ×20, Drain# ×20, BL# ×10, Culvert# ×5 |
| A-02a-150MW | solar | 57 | Road# ×20, Drain# ×20, BL# ×12, Culvert# ×5 |
| A-04 125MW | solar | 55 | Road# ×20, Drain# ×20, BL# ×10, Culvert# ×5 |
| A-04 500MW | solar | 85 | BL# ×40, Road# ×20, Drain# ×20, Culvert# ×5 |
| A-05 | solar | 64 | Road# ×20, Drain# ×20, BL# ×19, Culvert# ×5 |
| A-06a | solar | 48 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×3 |
| A-06b | solar | 47 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×2 |
| A-06c | solar | 85 | BL# ×40, Road# ×20, Drain# ×20, Culvert# ×5 |
| A-07 42MW | solar | 49 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×4 |
| A-07 500MW | solar | 60 | Road# ×20, Drain# ×20, BL# ×15, Culvert# ×5 |
| A-07 83MW | solar | 47 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×2 |
| A-08 | solar | 49 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×4 |
| A-10a | solar | 49 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×4 |
| A-10b | solar | 58 | Road# ×20, Drain# ×20, BL# ×13, Culvert# ×5 |
| A-10b 175MW | solar | 53 | Road# ×20, Drain# ×20, BL# ×8, Culvert# ×5 |
| A-10b 400MW | solar | 46 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×1 |
| A-11 | solar | 62 | Road# ×20, Drain# ×20, BL# ×17, Culvert# ×5 |
| A-12 - 350MW | solar | 101 | BL# ×56, Road# ×20, Drain# ×20, Culvert# ×5 |
| A-13 | solar | 91 | BL# ×46, Road# ×20, Drain# ×20, Culvert# ×5 |
| A-14 | solar | 65 | BL# ×20, Road# ×20, Drain# ×20, Culvert# ×5 |
| A-14a | solar | 57 | Road# ×20, Drain# ×20, BL# ×12, Culvert# ×5 |
| A-15a | solar | 49 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×4 |
| A-15b - 50MW | solar | 49 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×4 |
| A-16a | solar | 49 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×4 |
| A-16b | solar | 61 | Road# ×20, Drain# ×20, BL# ×16, Culvert# ×5 |
| A-16c | solar | 59 | Road# ×20, Drain# ×20, BL# ×14, Culvert# ×5 |
| A-16d | solar | 72 | BL# ×27, Road# ×20, Drain# ×20, Culvert# ×5 |
| A-18 | solar | 93 | BL# ×48, Road# ×20, Drain# ×20, Culvert# ×5 |
| BESS PSS-05A | bess | 18 | BL# ×6, Road# ×5, Drain# ×5, SWYD ×1, O&M Store ×1 |
| BESS PSS-05B | bess | 22 | BL# ×10, Road# ×5, Drain# ×5, SWYD ×1, O&M Store ×1 |
| BESS PSS-08A | bess | 16 | Road# ×5, Drain# ×5, BL# ×4, SWYD ×1, O&M Store ×1 |
| BESS PSS-08B | bess | 16 | Road# ×5, Drain# ×5, BL# ×4, SWYD ×1, O&M Store ×1 |
| BESS PSS-09 | bess | 21 | BL# ×9, Road# ×5, Drain# ×5, SWYD ×1, O&M Store ×1 |
| BESS PSS-10A | bess | 16 | Road# ×5, Drain# ×5, BL# ×4, SWYD ×1, O&M Store ×1 |
| BESS PSS-10B | bess | 17 | BL# ×5, Road# ×5, Drain# ×5, SWYD ×1, O&M Store ×1 |
| BESS PSS-11 | bess | 21 | BL# ×9, Road# ×5, Drain# ×5, SWYD ×1, O&M Store ×1 |
| BESS PSS-12 | bess | 20 | BL# ×8, Road# ×5, Drain# ×5, SWYD ×1, O&M Store ×1 |
| Khavda-PSS-Infra-Culverts | infra | 5 | Culvert# ×5 |
| Khavda-PSS-Infra-Drains | infra | 2 | Drain# ×2 |
| Khavda-PSS-Infra-Roads | infra | 2 | Road# ×2 |
| Khavda-Site-Infra-Culverts | infra | 5 | Culvert# ×5 |
| Khavda-Site-Infra-Drains | infra | 2 | Drain# ×2 |
| Khavda-Site-Infra-Roads | infra | 2 | Road# ×2 |
| Khavda-Wind-Infra-Culverts | infra | 5 | Culvert# ×5 |
| Khavda-Wind-Infra-Drains | infra | 2 | Drain# ×2 |
| Khavda-Wind-Infra-Roads | infra | 2 | Road# ×2 |
| PSS-Khavda | pss | 2 | PSS-# ×2 |
| S-01 - 75MW | solar | 51 | Road# ×20, Drain# ×20, BL# ×6, Culvert# ×5 |
| S-01-100MW | solar | 8 | BL# ×8 |
| S-01-200MW | solar | 16 | BL# ×16 |
| S-02a - 175MW | solar | 59 | Road# ×20, Drain# ×20, BL# ×14, Culvert# ×5 |
| S-02a-50MW | solar | 49 | Road# ×20, Drain# ×20, Culvert# ×5, BL# ×4 |
| S-02b | solar | 54 | Road# ×20, Drain# ×20, BL# ×9, Culvert# ×5 |
| S-03 | solar | 57 | Road# ×20, Drain# ×20, BL# ×12, Culvert# ×5 |
| S-04 | solar | 69 | BL# ×24, Road# ×20, Drain# ×20, Culvert# ×5 |
| S-05a | solar | 57 | Road# ×20, Drain# ×20, BL# ×12, Culvert# ×5 |
| S-06a - 234MW | solar | 64 | Road# ×20, Drain# ×20, BL# ×19, Culvert# ×5 |
| S-06b | solar | 85 | BL# ×40, Road# ×20, Drain# ×20, Culvert# ×5 |
| S-07a | solar | 70 | BL# ×24, Road# ×20, Drain# ×20, Culvert# ×5, BL-# ×1 |
| S-07b - 300MW | solar | 69 | BL# ×24, Road# ×20, Drain# ×20, Culvert# ×5 |
| S-09 | solar | 77 | BL# ×32, Road# ×20, Drain# ×20, Culvert# ×5 |
| S-10-287.5MW | solar | 68 | BL# ×23, Road# ×20, Drain# ×20, Culvert# ×5 |
| S05b | solar | 69 | BL# ×24, Road# ×20, Drain# ×20, Culvert# ×5 |
| S08-100MW | solar | 53 | Road# ×20, Drain# ×20, BL# ×8, Culvert# ×5 |
| S08-400MW | solar | 77 | BL# ×32, Road# ×20, Drain# ×20, Culvert# ×5 |
| TL-Khavda-400KV | transmission_line | 1 | NHPCPSStoKPS-# ×1 |
| WTG-Khavda | wind | 244 | WTG# ×134, KH# ×109, WTG#A ×1 |

## Appendix B — Mandvi, Mundra, Baiya, Bandha (6 Work Locations)

| Work Location | Project Type | Work Areas | Composition |
|---|---|---:|---|
| PSS-Mandvi | pss | 1 | MandviPSS#MW ×1 |
| WTG-Mandvi | wind | 69 | MP# ×66, MNP# ×2, MP-P# ×1 |
| WTG-Mundra | wind | 98 | MNP# ×89, MUNN# ×8, MNP#S ×1 |
| Baiya-600 MW | solar | 96 | BL# ×51, Road# ×20, Drain# ×20, Culvert# ×5 |
| Bandha-500 MW | solar | 85 | BL# ×40, Road# ×20, Drain# ×20, Culvert# ×5 |
| Bandha-534 MW | solar | 90 | BL# ×45, Road# ×20, Drain# ×20, Culvert# ×5 |
