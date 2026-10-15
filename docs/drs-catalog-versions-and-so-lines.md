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
| **Chain** | The list of versions for one project type and one scope. **All sites** is the type-wide chain; a site (e.g. *Khavda*, *AUTOMATION SITE*) can have its own chain. |
| **Catalog version** | One release of the catalog in one chain. |
| **Version label** | Chain + number, e.g. `All sites v2`, `Khavda v1`, `AUTOMATION SITE v1`. Each chain counts its own numbers, so `All sites v1` and `AUTOMATION SITE v1` are different versions. |
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
  - *Live 2026-10-15:* with **All sites v1** selected, New draft for AUTOMATION SITE produced **AUTOMATION SITE v1** as a copy of **All sites v1**, not of the newest locked version (All sites v5).
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

## 4. The AUTOMATION SITE catalog versions

Built by `tests/drs-setting/catalog_site_versions.spec.js` and recorded in `tests/fixtures/drs/drs-setup.json` under `catalogs["AUTOMATION SITE"]`.

| Step | Source selected | New version | Codes added | Contents | State |
|---|---|---|---|---|---|
| S1 | All sites v1 | **AUTOMATION SITE v1** | PC01, QC01, PE01, QE01 | All sites v1 + the four 01 codes | **locked** 2026-10-15 |
| S2 | AUTOMATION SITE v1 | **AUTOMATION SITE v2** | PC02, QC02, PE02, QE02 | AUTOMATION SITE v1 (01 codes inherited) + the four 02 codes | **locked** 2026-10-15 |

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
| **VER-ALL-V2** | **All sites v2** | 60 | a second All-sites version |
| **VER-SITE-V1** | **AUTOMATION SITE v1** | 60 | site version 1 |
| **VER-SITE-V2** | **AUTOMATION SITE v2** | 60 | site version 2 |

- The plan lives in `tests/drs/drs-data.js` (`versionAreas`, `versionFor(workArea)`). `DRS_VERSION_AREAS=0` leaves the VER-* areas out.
- **D03** pins every Work Area to its planned version and checks the tree badge by its full label (`AUTOMATION SITE v1`, not just `v1`). It never changes an existing pin.
- The AUTOMATION SITE versions must be **locked** before D03 runs, so run `catalog_site_versions.spec.js` first.

---

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
EA - Piling - MMS — Solar · AUTOMATION SITE v1 — VER-SITE-V1
EA - Piling - MMS — Solar · AUTOMATION SITE v2 — VER-SITE-V2
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
| 30-30 | AUTOMATION SITE v1 | VER-SITE-V1 |
| 40-40 | AUTOMATION SITE v2 | VER-SITE-V2 |

### 8.2 Why: how a WMC is generated
- **When a vendor can generate one:** a vendor can generate a **WMC for an SO line** once the **RFIs for every inspection point** of that line's sub-activities are **approved on every Work Section** of the Work Areas involved.
- **Rows read:** a WMC measures the catalog rows of the Work Areas selected, and the **pin** decides which rows. So the pin decides what the certificate bills.
- **One version per WMC:** the system **refuses** to generate a WMC when the selected Work Areas are on **different versions**, or mix pinned and unpinned. Its message names each Work Area and its version: *"The selected work areas are on different catalog versions: … One WMC covers one version."* (guide §12).
- **What goes wrong with a mixed line:** a line mapped across versions would cover Work Areas on several versions, and could never yield one valid WMC. One line per version keeps each line billable on its own.
- **A subset is allowed:** mapping only some of a version's sub-activities to a line is fine. The WMC for that line then waits only on those sub-activities' RFIs.

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
| 30-30 | AUTOMATION SITE v1 | VER-SITE-V1 | the same 4, site v1 copies |
| 40-40 | AUTOMATION SITE v2 | VER-SITE-V2 | the same 4, site v2 copies |

After the reload, each line held exactly its own version's 4 sub-activities and none of another version's.

## 9. Run order

```powershell
# 1. Site catalog versions (once per environment; locks are permanent)
npx playwright test --project=drs-setting tests/drs-setting/catalog_site_versions.spec.js --workers=1

# 2. A fresh DRS project: masters, project + tree (incl. VER-* areas), pins, SO with one line
#    per version, SO Configuration per version, SO Line Mapping per line
npm run drs:setup
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
| `npm run drs:setup` makes a NEW project once the newest one has its tree (D02 resumes only before D5) | A stopped run's project is marked `abandoned` in the state file (UQX, 2026-10-15) |

---

## 11. Open points

- **Which sub-activities per line.** The automation maps the four Piling sub-activities of each version to that version's line. Whether to also map the new `PC0n`/`PE0n` sub-activities, or a subset per line, is still to be decided with the app owner.
- **WMC is not automated yet.** The rule in §8.2 is the design reason for one line per version; a WMC stage would prove it: generate per line, and get a refusal for mixed versions.
- **Mandvi** no longer appears in the Site list on drs-uat, so the runbook's matrix row 3 (Mandvi, T/U) can't be verified there right now.
