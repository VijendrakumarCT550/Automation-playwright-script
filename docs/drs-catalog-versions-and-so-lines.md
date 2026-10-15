# DRS catalog versions, naming, and SO lines

How the DRS **package catalog** and its **versions** work, how our automation builds and uses them, the **naming convention** for what it creates, and how **SO Configuration**, **SO Line Mapping** and the **WMC** depend on the version a Work Area is pinned to.

Sources:
- the app owner's instructions (2026-10-14 / 15);
- the DRS team's guide, *Catalog Versions* (Azure DevOps wiki, `digital-routing-system.wiki/1133/Catalog-Versions`, updated 2026-10-09; a PDF copy is `Downloads/catalog pdf.pdf`);
- live runs on drs-uat. Where the guide and a live run disagree, this page says so and follows the live run.

Related: [`tests/drs-setting/README.md`](../tests/drs-setting/README.md), [`tests/drs-setting/RUNBOOK.md`](../tests/drs-setting/RUNBOOK.md), [`docs/drs-pulse-integration.md`](drs-pulse-integration.md).

---

## 1. Terms

| Term | Meaning |
|---|---|
| **Catalog** | The hierarchy **Package → Sub-Package → Activity → Sub-Activity → Inspection Point (checkpoint)** for one project type. Packages (Civil, Electrical, Mechanical) are managed upstream and read-only. |
| **Chain** | The list of versions for one project type and one scope. **All sites** is the type-wide chain; a site (e.g. *Khavda*, *Automation Site 01*) can have its own chain. |
| **Catalog version** | One release of the catalog in one chain. |
| **Version label** | Chain + number, e.g. `All sites v2`, `Khavda v1`, `Automation Site 01 v1`. Each chain counts its own numbers, so `All sites v1` and `Automation Site 01 v1` are different versions. |
| **Draft** | A version that can still be edited. |
| **Locked** | A version that can never be edited again. |
| **Pin** | The catalog version chosen for one **Work Area**. |
| **Serial** | The position of an item in the tree, e.g. `AH.1.1.2`. The app calculates it from the sub-package **Letter** and the item's position. |
| **SO / SO line** | Service Order, and one item line of it (shown as `<line no>-<service item no>`, e.g. `10-10`). |
| **WMC** | **Work Measurement Certificate** — the vendor's billing certificate for the work done under an SO line. |

---

## 2. How catalog versions work

### 2.1 Chains and scope
- Every project type has an **All sites** chain. A site may also have its **own chain** for that type.
- A site without its own versions uses the **All sites** versions.
- In the Packages Configurator, choose **Project Type → Site → Catalog version**. For a site, the list shows that site's versions first, then the locked *All sites* versions.

### 2.2 Making a draft
- **New draft copies the version that is selected when you click it.** Any version can be the source.
  - *Live 2026-10-15:* with **All sites v1** selected, New draft for AUTOMATION SITE produced **Automation Site 01 v1** as a copy of **All sites v1**, not of the newest locked version (All sites v5).
  - The guide (§4.6) says a draft always copies the *newest* locked version. **That is out of date — follow the app.**
- A new draft **recomputes positions**, so its tree can list the same sub-packages in a different order. Compare a copy by the *set* of names, not the order.
- **One open draft per chain.** A second New draft is refused: *"A draft already exists for this project type and site, and only one may be open at a time…"*.
- A draft made on a site creates that **site's chain** (`<Site> v1`, `v2`, …).

### 2.3 Locking
- **Lock is permanent.** No unlock, no withdraw, no delete. The only correction is to lock a newer version.
- Flow: **Lock version** → dialog *"Lock <label> permanently?"* → **Lock permanently**.
- The server checks the draft first and **refuses** the lock when:
  - the draft has no rows;
  - a dependency points outside the version, or the dependencies form a loop;
  - a sub-package has no project type;
  - a sub-activity has no **Min Unit**.
- A sub-activity with **no inspection points** is only an *advisory*: a second button, *Lock anyway, accepting the advisory*. **Our automation never accepts an advisory.**
- **Only locked versions** can be pinned to a Work Area or chosen in SO Configuration. A draft never appears in those lists.

### 2.4 Sub-package letters and names
- The **Letter** of a sub-package is **one or two letters A–Z**. Digits, spaces or three letters are refused (guide §6.4). The app assigns the next free letter itself.
- Two sub-packages in the same package **may have the same name**. That is why our names carry a counter (§3).

### 2.5 Pins
- A Work Area with no badge has **no pin**. That is normal.
- The pin dropdown lists the locked versions of the Work Area's **site**, then the locked **All sites** versions.
- **Which versions a Work Area can take** (app owner, 2026-10-15). Visibility has only two filters:
  - **Project type**, for **every** version (All sites and site alike), because a catalog is built per project type;
  - **Site**, for a **site** version only: the Work Area must belong to that catalog's site.

  An **All sites** version is available to every site's Work Areas of that project type.
- **No new project is needed for a new catalog version.** Any Work Area that has **no records yet** can take it: a new Work Area added to an existing project, or an existing one with no RFI/NC, SO Configuration or WMC.
- A pin **can be changed** while no work depends on the Work Area (no RFI/NC, no SO Configuration, no WMC). It can **never be cleared**.
- Do not pin a **site** version through the Locations CSV import's *Catalog version* column (bug 16944). Use the form.

---

## 3. Naming convention for what the automation creates

Each build adds **two sub-packages per package**. A sub-package code is:

```
<P | Q>  +  <package letter>  +  <2-digit counter>
              C = Civil
              E = Electrical
```

| Build | Civil | Electrical |
|---|---|---|
| 1st | `PC01`, `QC01` | `PE01`, `QE01` |
| 2nd | `PC02`, `QC02` | `PE02`, `QE02` |
| … | … | … |

Every node below the sub-package carries the same code (agreed format, 2026-10-15):

```
PC01 Sub Package
├─ PC01.1 Activity
│  ├─ PC01.1.1 Sub Activity
│  │  ├─ PC01.1.1 Checkpoint a   → Micro Pile Checklist
│  │  ├─ PC01.1.1 Checkpoint b   → Micro Pile Cap Checklist
│  │  └─ PC01.1.1 Checkpoint c   → Post Pour Check
│  └─ PC01.1.2 Sub Activity      (checkpoints a, b, c)
└─ PC01.2 Activity
   ├─ PC01.2.1 Sub Activity      (checkpoints a, b, c)
   └─ PC01.2.2 Sub Activity      (checkpoints a, b, c)
```

Per code: 1 sub-package, 2 activities, 4 sub-activities, 12 inspection points (**19 nodes**), each inspection point bound to its checklist.

**Field values per node:**
- **Sub-activity:** Min Unit `TABLE`, UOM `PER UNIT`.
- **Inspection point:** Type `question`, *Checklist Required* ON, Description `PC01.1.1 checkpoint a`.

**Rules:**
- **Code vs Letter:** the code goes in the sub-package **Name** (and **Code** where the form has one). The Letter cannot hold a digit, so the app keeps its own letter, and the serials read e.g. `AH.1.1.1`, not `PC01.1.1.1`. The names are what identify our nodes.
- **The counter:** stored per DRS environment and per package in `tests/fixtures/drs/catalog-counter.json`. A build **reserves** its number before it creates anything. The next number is one past the higher of the file and the codes already in the live tree. So a draft copied from a version that already holds `PC01` gets `PC02`, and a name never repeats.
- **Historic letters:** the runbook's single letters (P…U in All sites / Khavda / Mandvi) are still accepted for **verify** only.

---

## 4. The Automation Site 01 catalog versions

> **Site renamed, 2026-10-15:** `AUTOMATION SITE` → **`Automation Site 01`** (same DRS uuid `e97c5ffe-149b-417d-97d0-45b03fcff3a1`).
> - **Why:** a UAT redeploy had deleted the first AUTOMATION SITE in DRS, but Pulse kept it, because the delete never synced. D01 then recreated the name, so Pulse listed two "AUTOMATION SITE"s.
> - **How:** renaming our site in place keeps its catalog chain and projects. Its version labels follow the name: the versions built as "AUTOMATION SITE v1/v2" now read **Automation Site 01 v1/v2**, verified live.
> - **In code:** D01 renames any site still carrying a former name (`tests/drs/drs-data.js` `siteFormerNames`), and rewrites the state file to match.

Built by `tests/drs-setting/catalog_site_versions.spec.js` and recorded in `tests/fixtures/drs/drs-setup.json` under `catalogs["Automation Site 01"]`.

| Step | Source selected | New version | Codes added | Contents | State |
|---|---|---|---|---|---|
| S1 | All sites v1 | **Automation Site 01 v1** | PC01, QC01, PE01, QE01 | All sites v1 + the four 01 codes | **locked** 2026-10-15 |
| S2 | Automation Site 01 v1 | **Automation Site 01 v2** | PC02, QC02, PE02, QE02 | Automation Site 01 v1 (01 codes inherited) + the four 02 codes | **locked** 2026-10-15 |

Each step:
1. Checks the site has no version the spec did not record.
2. Selects the source, clicks **New draft**, and records the draft at once.
3. Proves the draft is a copy of the **selected** source, by comparing its sub-package names with the source's and with the newest locked version's.
4. In S2 only, proves S1's codes came along.
5. Reserves the next codes, then builds them under **Civil and Electrical**.
6. Verifies every node and checklist.
7. **Locks** the version, reloads, and verifies the locked version again.

A rerun resumes the same draft with the same codes; a step that is already locked is only re-verified.

---

## 5. Work Areas per catalog version

The DRS project chain (`npm run drs:setup`, `tests/drs/setup/D01–D06`) creates one project whose Work Areas carry **four different versions**:

| Work Area | Pinned to | Work Sections | Why |
|---|---|---|---|
| BL01, BL02 (… BLnn) | All sites v1 | 300 each | Pulse integration ground — `tests/integration/drs-profile.js` uses `/^BL\d+$/` only, so it is unchanged |
| Culvert-01, Drain-01, Road-01 | All sites v1 | 10 each | as before |
| **BL03 AS-v2** | **All sites v2** | 60 | a second All-sites version |
| **BL04 S-v1** | **Automation Site 01 v1** | 60 | site version 1 |
| **BL05 S-v2** | **Automation Site 01 v2** | 60 | site version 2 |

**Naming (app owner, 2026-10-15): `BL<nn> AS-v<n>` / `BL<nn> S-v<n>`.**
- **AS** = All sites, **S** = the site's own version, and `v<n>` is the version number.
- `<nn>` continues after the run's plain BL areas: with `DRS_WORK_AREAS=2` they are BL03, BL04 and BL05; with 13, BL14 onward.
- The name carries the version, and `versionFor(workArea)` reads it back from the name.
- **Older projects:** AUTO-Solar-15102026-SNP still has its first names, `VER-ALL-V2`, `VER-SITE-V1` and `VER-SITE-V2`. They are still understood (same versions), but new projects use the new names.
- **Code:** `tests/drs/drs-data.js` (`versionAreas`, `versionAreaNames`, `versionFor`, `isVersionArea`, `isSiteVersionArea`). `DRS_VERSION_AREAS=0` leaves these areas out.

- **D03** pins every Work Area to its planned version and checks the tree badge by its full label (`Automation Site 01 v1`, not just `v1`). It never changes an existing pin.
- The Automation Site 01 versions must be **locked** before D03 runs, so run `catalog_site_versions.spec.js` first.

---

### 5.1 A new version on an EXISTING project (E01)

`tests/drs/extend/E01_add_version_area.spec.js` brings a catalog version onto a project that already exists. Set it with `DRS_PROJECT_TAG`; the version is the newest locked site version, or `CATALOG_VERSION_LABEL`.

**The stage:**
1. **Import** one new Work Area `BL<nn> <AS|S>-v<n>` (60 Work Sections) under the project's existing Work Location. The import upserts by name, so nothing else changes.
2. **Pin** it to the version.
3. **Add that version's SO lines** to the project's **existing** SOs (Edit → *Add Line* → *Save Changes*), numbered after the existing lines, with the same plan rules as D04.

**Then re-run D05 and D06** on the same project. They are idempotent, so only the new area's cells and the new lines are mapped.

**Verified 2026-10-15** on AUTO-Solar-15102026-RHY:
- **Area and pin:** `BL06 S-v3` imported (61 nodes) and pinned to Automation Site 01 v3.
- **Civil SO 9956077393:** lines 210–340 added.
- **Electrical SO 9956099198:** lines 130–240 added.
- **D05:** set 17 + 12 new cells and 0 elsewhere.
- **D06:** mapped the new lines.
- **Line check:** 58/58 lines exactly as planned.
- **Pulse:** IN01 (users, batch 225) and IN16 with `DRS_PROJECT_TAG=15102026-RHY` passed 4/4 on `BL06 S-v3`. b/c were blocked until the previous checkpoint was approved, every checklist loaded all its questions (6/17/16/7/18/17, equal to DRS), and RFIs CIV-0…CIV-5 were approved.

## 6. SO Configuration (step 4)

- **Filters:** Work Location → Version → Work Area → Package, chosen in that order. Nothing is pre-filled.
- The **Version** list shows locked versions only.
- **Work Area depends on Version:** it lists only the areas pinned to the chosen version. It is a multi-select with a *Select all* row.
- The matrix shows that version's activities as rows and the chosen Work Areas as columns.
- Because Version is single-choice, **D05 maps once per version**: All sites v1 with the BL areas, then each VER-* area with its own version. It saves each pass before switching, because changing version drops unsaved cells.

---

## 7. SO Line Mapping (step 5): look-alike sub-activities

The *Sub Activity* picker on an SO line lists the sub-activities of **every catalog version pinned on the project**. Each option is labelled:

```
<sub-activity name> — <project type> · <version label> — <work areas on that version>
```

So the same name shows **once per version**, for example:

```
EA - Piling - MMS — Solar · All sites v1 — BL01, BL02
EA - Piling - MMS — Solar · All sites v2 — VER-ALL-V2
EA - Piling - MMS — Solar · Automation Site 01 v1 — VER-SITE-V1
EA - Piling - MMS — Solar · Automation Site 01 v2 — VER-SITE-V2
```

**These are not duplicates.** Each belongs to a different version and a different set of Work Areas. Automation must always match the **full label**, never the bare name.

**A sub-activity sits on one SO line only.** Once a sub-activity is mapped to a line, the other lines' pickers stop offering it. Live 2026-10-15, mapping lines 10 → 40 in order, the pickers offered 16, then 12, then 8, then 4 options: each line took its 4 and they vanished from the rest.

---

## 8. One SO line per catalog version, and the WMC rule

### 8.1 The rule (app owner, 2026-10-15)

When a project carries several catalog versions, **create one SO line per version** in *3b. Create Service Order*. Each line is mapped (step 5) to the sub-activities of **one version only** — all of them, or a chosen subset — never a mix of versions.

| SO line | Mapped to sub-activities of | Work Areas it covers |
|---|---|---|
| 10-10 | All sites v1 | BL01, BL02 |
| 20-20 | All sites v2 | VER-ALL-V2 |
| 30-30 | Automation Site 01 v1 | VER-SITE-V1 |
| 40-40 | Automation Site 01 v2 | VER-SITE-V2 |

### 8.2 Why: how a WMC is generated
- **When a vendor can generate one:** a vendor can generate a **WMC for an SO line** once the **RFIs for every inspection point** of that line's sub-activities are **approved on every Work Section** of the Work Areas involved.
- **Rows read:** a WMC measures the catalog rows of the Work Areas selected, and the **pin** decides which rows. So the pin decides what the certificate bills.
- **One version per WMC:** the system **refuses** to generate a WMC when the selected Work Areas are on **different versions**, or mix pinned and unpinned. Its message names each Work Area and its version: *"The selected work areas are on different catalog versions: … One WMC covers one version."* (guide §12).
- **What goes wrong with a mixed line:** a line mapped across versions would cover Work Areas on several versions, and could never yield one valid WMC. One line per version keeps each line billable on its own.
- **A subset is allowed:** mapping only some of a version's sub-activities to a line is fine. The WMC for that line then waits only on those sub-activities' RFIs.

> **Updated 2026-10-15 (app owner):**
> - **Two SOs:** one per package, Civil (our service contractor) and Electrical (AUTOMATION ELECTRICAL CONTRACTOR, its own vendor and its own Pulse CI).
> - **At most 2 sub-activities per SO line:** a version with more gets more lines.
>
> The tables in §8.1 and §8.4 show the earlier single-SO layout (project SNP). The current plan is `drs-data.js` `soPlan`, and the full WMC background is in [`drs-wmc.md`](drs-wmc.md).

### 8.2b Verified live: two SOs, 2 sub-activities per line (2026-10-15, AUTO-Solar-15102026-ZTV)

| SO | Vendor | Lines | Mapped |
|---|---|---|---|
| **9952376933** Civil | 997248 AUTOMATION SERVICE CONTRACTOR | 20 | 40 sub-activities, 2 per line |
| **9952398464** Electrical | 999080 AUTOMATION ELECTRICAL CONTRACTOR | 12 | 24 sub-activities, 2 per line |

- **Line check:** the read-only checker (`00_drs_explore_round12_so_line_versions.spec.js`) passed on all 32 lines: one version each, at most 2, none empty.
- **Work Areas:** BL01/BL02 on All sites v1, plus `BL03 AS-v2`, `BL04 S-v1`, `BL05 S-v2`.

**Pulse:**
- **Users (IN01, batch 223):** CI `CIDRSbgbUser223` (Civil vendor), **CIE `CIEDRSwzaUser223` (Electrical vendor)**, and EE `EEDRSsbyUser223` / QI `QIDRSedmUser223`, shared by both packages.
- **WAM:** per package, on BL04 S-v1 and BL05 S-v2.
- **RFIs (IN15), each CI → EE → QI approved:**

| Package | Area | RFI |
|---|---|---|
| Civil | BL04 S-v1 | RFI-AUTO-WL-15102026-ZTV-BL04 S-v1-CIV-0 (PC01.1.1 Checkpoint a) |
| Civil | BL05 S-v2 | RFI-…-BL05 S-v2-CIV-1 (PC02.1.1 Checkpoint a) |
| Electrical | BL04 S-v1 | RFI-…-BL04 S-v1-ELE-2 (PE01.1.1 Checkpoint a) |
| Electrical | BL05 S-v2 | RFI-…-BL05 S-v2-ELE-3 (PE02.1.1 Checkpoint a) |

### 8.3 How the automation follows it
- **D04** creates the project's SO with **one line per version** the run pins (line numbers 10, 20, 30, 40 …). Each line is recorded with its version.
- **D06** maps each line to the Piling sub-activities of **its own version**, matched on the `· <version label> —` part of the option, and checks no other version's sub-activity is on the line.

---

### 8.4 Verified live (2026-10-15)

Project **AUTO-Solar-15102026-SNP**, SO **9946699160**, whole chain D01–D06 green:

| SO line | Version | Work Areas | Sub-activities mapped |
|---|---|---|---|
| 10-10 | All sites v1 | BL01, BL02 | 4 Piling (Inverter, LT Cable Hanger System, MMS, Robotic Docking System) |
| 20-20 | All sites v2 | VER-ALL-V2 | the same 4, v2 copies |
| 30-30 | Automation Site 01 v1 | VER-SITE-V1 | the same 4, site v1 copies |
| 40-40 | Automation Site 01 v2 | VER-SITE-V2 | the same 4, site v2 copies |

After the reload, each line held exactly its own version's 4 sub-activities and none of another version's.

### 8.5 Our catalog's sub-activities on the site lines (2026-10-15)

D05 now also maps the **new Civil activities** of each site version (`<code>.1 Activity`, `<code>.2 Activity` for every code the version carries; `tests/drs/drs-data.js` `catalogCodes`). D06 then puts their sub-activities on that version's line:

| SO line | Version | Sub-activities |
|---|---|---|
| 30-30 | Automation Site 01 v1 | 4 Piling + PC01.1.1 … QC01.2.2 (8) = **12** |
| 40-40 | Automation Site 01 v2 | 4 Piling + PC01/QC01 (8) + PC02/QC02 (8) = **20** |

- **The PC01/QC01 chips on line 40-40 are v2's own copies.** A new draft copies the nodes it inherits, so every one of them is labelled `· Automation Site 01 v2 —`. One line still holds one version.
- **Verify any time:** `tests/drs/inspection/00_drs_explore_round12_so_line_versions.spec.js` (read-only) fails if any line holds another version's sub-activity.
- **Naming in DRS:** DRS prefixes our sub-activities with their UOM (`PER UNIT - PC01.1.1 Sub Activity`). Pulse shows the bare name.

### 8.6 RFI on our catalog in Pulse (IN15, verified 2026-10-15)

`tests/integration/IN15_rfi_site_catalog.spec.js` runs the existing RFI flow on the new catalog chain and the new work region.

**WAM:** CI (with our SO), EE and QI are mapped on VER-SITE-V1 and VER-SITE-V2.

**RFI cycle (CI raises → EE approves → QI approves)**, on each area's own newest Civil code:

| Work Area | Version | Chain | RFI | Result |
|---|---|---|---|---|
| VER-SITE-V1 | Automation Site 01 v1 | PC01 Sub Package → PC01.1 Activity → PC01.1.1 Sub Activity → PC01.1.1 Checkpoint a (Micro Pile Checklist) | RFI-AUTO-WL-15102026-SNP-VER-SITE-V1-CIV-0 | approved |
| VER-SITE-V2 | Automation Site 01 v2 | PC02 … PC02.1.1 Checkpoint a | RFI-AUTO-WL-15102026-SNP-VER-SITE-V2-CIV-1 | approved |
| VER-SITE-V1 | Automation Site 01 v1 | **Electrical**: PE01 Sub Package → PE01.1 Activity → PE01.1.1 Sub Activity → PE01.1.1 Checkpoint a | RFI-AUTO-WL-15102026-SNP-VER-SITE-V1-ELE-2 | approved |
| VER-SITE-V2 | Automation Site 01 v2 | **Electrical**: PE02 … PE02.1.1 Checkpoint a | RFI-AUTO-WL-15102026-SNP-VER-SITE-V2-ELE-3 | approved |

**WAM is per package:** the Package filter is part of the assignment, so IN15 maps CI (with our SO), EE and QI on the site areas once for Civil and once for Electrical. `IN15_PACKAGES=Electrical` runs one package only; `D05_PACKAGES` does the same for SO Configuration.

For Electrical, D05 maps `PE0n.1/.2` and `QE0n.1/.2` (no Piling), and D06 adds their sub-activities to the same version lines. Line 30-30 then holds **20** sub-activities and line 40-40 holds **36**, still one version per line.

Users: IN01 batch 222 (CIDRSjrnUser222, EEDRSvgpUser222, QIDRSahkUser222, plus PM/EL/QL) on AUTO-WL-15102026-SNP.

## 9. Run order

```powershell
# 1. Site catalog versions (once per environment; locks are permanent)
npx playwright test --project=drs-setting tests/drs-setting/catalog_site_versions.spec.js --workers=1

# 2. A fresh DRS project: masters, project + tree (incl. VER-* areas), pins, SO with one line
#    per version, SO Configuration per version, SO Line Mapping per line
npm run drs:setup
#    (re-run one stage on an existing project:  $env:DRS_PROJECT_TAG="15102026-SNP")

# 3. Pulse: users of the project, then WAM + RFI on our catalog
$env:PULSE_ENV="uat"; $env:DRS_ENV="uat"
npx playwright test --project=integration tests/integration/IN01_users.spec.js --workers=1
npx playwright test --project=integration tests/integration/IN15_rfi_site_catalog.spec.js --workers=1
```

Other switches:
- `CATALOG_STEPS=S1` runs one catalog step.
- `PC_PACKAGES=Civil,Electrical PC_LETTERS=next PC_MODE=build` adds the next codes to any open draft through `package_configurator_electrical_hierarchy.spec.js`.

---

## 10. What the live runs showed (2026-10-15)

| Finding | Effect on the automation |
|---|---|
| New draft copies the **selected** version (guide §4.6 says newest locked) | Spec checks and records which version the draft copied |
| Draft lists sub-packages in a new order | Copies compared by sorted names |
| Required fields are labelled with `*` (`Name*`, `Base UOM*`) | Fields matched with or without `*` |
| Activity create form has **no Code** field (runbook still lists `Code*`) | Code filled only where the form has it |
| A create toast can be hidden by the previous one | Create also counts as done when the new node and its edit form appear |
| Checklists load after the inspection-point form | Checklist check waits up to 8 s |
| Site list has look-alikes (`AUTOMATION SITE`, `AUTOMATION SITE 2-PTG`, `AUTOMATION SITE 3-CRV`) | Site matched exactly |
| SO Configuration filters cascade, nothing pre-filled | `DrsSoConfigPage.open()` picks all four in order |
| Sub Activity picker is a multi-select that stays open; its name changes once a chip is in | D06 opens it once and clicks every option |
| A sub-activity mapped to one SO line is no longer offered on the others (16 → 12 → 8 → 4) | D06 maps each line from its own card, in line order |
| Pulse kept a site that a UAT redeploy deleted in DRS, so two sites shared one name after it was recreated | Our site renamed to `Automation Site 01` (D01 renames in place) |
| `npm run drs:setup` makes a NEW project once the newest one has its tree (D02 resumes only before D5) | A stopped run's project is marked `abandoned` in the state file (UQX, 2026-10-15) |

---

## 11. Open points

- **Which sub-activities per line.** The automation maps the four Piling sub-activities of each version to that version's line. Whether to also map the new `PC0n`/`PE0n` sub-activities, or a subset per line, is still to be decided with the app owner.
- **WMC is not automated yet.** The rule in §8.2 is the design reason for one line per version; a WMC stage would prove it: generate per line, and get a refusal for mixed versions.
- **Mandvi** no longer appears in the Site list on drs-uat, so the runbook's matrix row 3 (Mandvi, T/U) can't be verified there right now.
