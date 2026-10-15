# DRS Work Measurement Certificate (WMC)

What a WMC is, how DRS builds and approves one, and what it means for the way our automation sets up **Service Orders, SO lines and catalog versions**.

Sources:
- the DRS team's developer reference *WMC* (Azure DevOps wiki, Jatin Yarehalli, updated 2026-07-21; PDF copy `Downloads/wmc document.pdf`);
- the catalog guide §12 (WMC and the pin), summarised in [`drs-catalog-versions-and-so-lines.md`](drs-catalog-versions-and-so-lines.md) §8;
- the app owner's instructions (2026-10-15).

**Status:** no WMC stage is automated yet. This page is the reference for building one.

---

## 1. What a WMC is

A **Work Measurement Certificate** certifies how much of a contractor's scope on a **Service Order** has been executed, and so is billable. It brings together:

- the executed work (**Area Work Mappings**, AWMs);
- the inspection trail (**RFIs**);
- the quality gate (**NCs**);
- material reconciliation (**FIM**, free-issue material).

It produces a signed PDF/Excel certificate that feeds invoicing (SAP).

A WMC is always scoped to one or more **cells**. A cell is one **(SO line × block/work area)** pair, picked from a matrix.

### Two types

The UI says Regular / Deviation; the API, DB and enums still say `complete` / `partial`.

| | **Regular** (`complete`) | **Deviation** (`partial`) |
|---|---|---|
| Certifies | the whole selected cell | a fraction of a block's work |
| Billed qty | 1 unit per cell (discrete); Σ per-section rate for continuous cells | user-entered fraction, strictly `0 < x < 1` per cell |
| Input grid | not shown | per (block × SO line) cell: one **WMC Qty** + optional attachment |
| Approval | Project Manager (L1) | Project Manager (L1) → Site Head (L2) |
| Signatures on the PDF | Contractor Manager, Project Manager | Contractor Manager, Project Manager, Site Head |

### Continuous SO lines (KM / M)

An SO line is **continuous** when **all** its sub-activities measure in a continuous UOM (`KM`, `M`).
- **Rate:** such lines bill per **work section**, at a flat 0.1 per section whatever its type. For example, `1.2 KM` = 12 complete road sections × 0.1.
- **Discrete cells:** a discrete block cell still bills 1.
- **Mixed lines:** a line with mixed UOMs falls back to discrete.

> **For us:** our lines carry `EA` (Piling) and `PER UNIT` (our `PC0n`/`PE0n`) sub-activities. Both are discrete, so a Regular WMC bills **1 per cell**.

---

## 2. Core concepts

| Concept | Meaning |
|---|---|
| **SO line** | `SERVICEORDERLINES`. Label `<lineNum>-<servNum> - <activity>`, e.g. `220-10 - Piling Work`. |
| **Block / Work Area** | `BLOCKS`. A physical area. |
| **Sub-activity** | `PULSE_SUBACTIVITIES`. A unit of work under an SO line. |
| **Area Work Mapping (AWM)** | `AREA_WORK_MAPPINGS`. The **executed work record**: `SO_LINE_ID`, `SUB_ACTIVITY_ID`, `DESIGN_ELEMENT_ID`, `STATUS`. |
| **Cell** | `(SO_LINE_ID, BLOCK_ID)`. |
| **Eligible AWM** | `STATUS ∈ {completed, wmc_rejected}`. Only these are certified. |

**The sub-activity universe of a cell** is every distinct `SUB_ACTIVITY_ID` across **all of that SO line's AWMs**: any block, any status. It is not just the ones in this WMC, and not the SO Configuration set. So a Deviation WMC lists every sub-activity of the line under each cell, and a sub-activity with no AWM in that block shows `–`.

---

## 3. Lifecycle

`WMCS.STATUS`: `draft → submitted → in_review → approved` (or `rejected`).

| Status | Meaning | AWMs |
|---|---|---|
| draft | WMC created (preview committed) | → `wmc_generated` |
| submitted | sent for approval; approval scenario + approvals created | |
| in_review | Deviation only: PM approved (L1), waiting for Site Head (L2) | |
| approved | final approval; **report downloadable** | → `wmc_approved` |
| rejected | any approver rejected | → `wmc_rejected` (eligible again) |

- **Who sets the status:** the approval workflow, not a direct set.
- **Report download:** the PDF/Excel can be downloaded only when `STATUS = approved`. Both the UI and `downloadReport` enforce this.
- **Super Admin offline approval:** `POST /approval/offline-approve-wmc` is for a WMC signed off outside the app.
  - It works only from `submitted` or `in_review`, and needs a reason; an evidence file is optional.
  - It ends in the same state as a normal approval, and writes an audit row to `WMC_OFFLINE_APPROVALS`.

### Approvals and signatures
- **Regular (`complete-wmc`):** one level, the Project Manager (`plot_head`).
- **Deviation (`partial-wmc`):** two levels. The PM (L1) moves it to `in_review`; the Site Head (L2) moves it to `approved`.
- **Who is asked:** approvers are found per role, for the project's plot/blocks. If none is found, the lookup falls back to the HANA region views, then to any active person with the role.

---

## 4. The certificate

One input (`WMCInput`) drives the on-screen **preview**, the **PDF** and the **Excel**. Each has four sections:

1. **Certificate:**
   - header: document number, date, status, a Regular/Deviation badge;
   - project, contractor and SO details;
   - the **SO item lines**;
   - the **scope summary**: one row per (block, SO line, sub-activity), with allocated / billed / remaining;
   - the **NC status gate**;
   - **signatures**.
2. **FIM:** free-issue material consumption and reconciliation.
3. **RFI tracker:** all inspections.
4. **NC tracker:** non-conformances, pass/fail gate, penalties.

**Main tables:**

| Table | What it holds |
|---|---|
| `WMCS` | header |
| `WMC_SO_ASSOCIATIONS` | one row per (WMC, SO, SO line, block) |
| `WMCWORKSCOPES` | the scope rows |
| `WMCWORKSECTIONSCOPES` | per work section: RFI id, certified qty |
| `WMC_PARTIAL_ROW_ATTACHMENTS` | one file per Deviation cell |
| `WMCSIGNATURES` | signatures |
| `WMC_OFFLINE_APPROVALS` | offline-approval audit |
| `WMC_INVOICES` | invoice link |

**API** (`contract.wmc`):

| Op | What it does |
|---|---|
| `preview` | builds the input without writing anything |
| `create` | commits rows and the PDF/Excel. Body: `PROJECT_ID`, `CELLS[]` (SO line × block), `TYPE`, `PARTIAL_ENTRIES[]` for Deviation |
| `matrixStatus` | the cell-eligibility matrix for (SO, plot) |
| `getInput` | rebuilds the input of an existing WMC |
| `get`, `getAll` | read |
| `getAllWMCScopes` | read the scope rows |
| `downloadReport` | the report; approved only |
| `listAssociations` | read the SO associations |

---

## 5. What this means for our automation

### 5.1 One catalog version per WMC → one version per SO line
From the catalog guide §12: a WMC reads the catalog rows of the Work Areas it covers, and **the pin decides which rows**.
- **Refusal:** DRS **refuses** to generate a WMC over Work Areas on **different versions**, or a mix of pinned and unpinned. Its message: *"…not on the same catalog version… One WMC covers one version."*
- **So:** every SO line is mapped to sub-activities of **one** catalog version only (`drs-data.js` `soPlan`, D06).

### 5.2 One vendor + SO per package
A WMC certifies **a contractor's** scope on **an SO**. Civil and Electrical have different contractors, so each package gets **its own vendor and its own SO**:

| Package | Vendor | SO |
|---|---|---|
| Civil | AUTOMATION SERVICE CONTRACTOR | `serviceOrders.Civil` |
| Electrical | AUTOMATION ELECTRICAL CONTRACTOR | `serviceOrders.Electrical` |

Built by D01 and D04. In Pulse, each vendor has **its own CI** (`CI`, `CIE`); EE and QI are shared.

### 5.3 At most 2 sub-activities per SO line
A cell is (SO line × block), and its sub-activity universe is every sub-activity on the line. Few sub-activities per line keep each cell's scope small. **The app owner's rule is at most 2 per line.** A version with more gets more lines (D04 plans them in pairs, D06 maps each pair):

| SO | Version | Lines |
|---|---|---|
| Civil | All sites v1, All sites v2 | 2 each (the 4 Piling sub-activities, in pairs) |
| Civil | Automation Site 01 v1 | 6 (4 Piling + PC01/QC01 × 4) |
| Civil | Automation Site 01 v2 | 10 (4 Piling + PC01/QC01/PC02/QC02 × 4) |
| Electrical | Automation Site 01 v1 | 4 (PE01/QE01 × 4) |
| Electrical | Automation Site 01 v2 | 8 (PE01/QE01/PE02/QE02 × 4) |

### 5.4 When a Regular WMC becomes possible (app owner)
**A vendor can generate the WMC for an SO line once the RFIs of every inspection point of the line's sub-activities are approved on every work section** of the block(s) in the cell.

That sets the scale of a WMC test. One of our sub-activities has 3 checkpoints (a, b, c). A line of 2 sub-activities therefore needs **6 checkpoint RFIs per work section**, CI → EE → QI each, on every section of the block. A 60-section block would need 360 approved RFIs, so a WMC test needs a **small dedicated block** (a few sections).

### 5.5 A WMC stage, when we build it
1. **DRS ground:** a block with few work sections, pinned to one version, and one SO line with 1–2 sub-activities.
2. **Pulse:** raise and approve every checkpoint RFI on every section. This is the existing flow (IN15) in a loop.
3. **DRS:** open the WMC matrix for (SO, plot), confirm the cell is eligible, then generate a **Regular** WMC.
4. **Approve** as the Project Manager. The status should be `approved` and the AWMs `wmc_approved`, and the report should be downloadable.
5. **Negative checks:**
   - mixed versions in one WMC are refused;
   - a cell with an unapproved RFI is not eligible;
   - the report can't be downloaded before approval.
6. **Deviation variant:** WMC Qty 0.5, PM then Site Head approval, three signatures.

Open questions for the DRS team:
- Does an RFI approval in Pulse write the AWM `completed` in DRS directly, or is something else needed first?
- Which DRS screen and role generates the WMC: the vendor (Contractor Manager) or an AGEL user?
