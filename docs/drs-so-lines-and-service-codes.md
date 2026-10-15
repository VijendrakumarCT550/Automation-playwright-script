# DRS SO lines and service codes

How the sub-activities of a project are grouped onto **Service Order lines**, what a **service code** is, and how the automation builds both. This is the shared reference for SO setup. The why behind the rules (the WMC) is in [`drs-wmc.md`](drs-wmc.md); catalog versions and pinning are in [`drs-catalog-versions-and-so-lines.md`](drs-catalog-versions-and-so-lines.md).

Sources:
- `Downloads/PULSE RFI to BBU service code mapping - Solar v2 1.xlsx`, sheet *Mapping_08-07-26* (the service code → sub-activity groups);
- `Downloads/Solar EPC BBU - Pulse DRS Mapping.xlsx` (the BBU line items);
- DRS App Settings → **Service Configurator** (live, drs-uat);
- the app owner's rules (2026-10-15).

---

## 1. The rules

| # | Rule | Why |
|---|---|---|
| R1 | **One SO per package.** Civil → AUTOMATION SERVICE CONTRACTOR (997248); Electrical → AUTOMATION ELECTRICAL CONTRACTOR (999080). | A WMC certifies one contractor's scope on one SO. |
| R2 | **One catalog version per SO line.** | DRS refuses a WMC over Work Areas on different versions. |
| R3 | **Standard sub-activities are grouped by their service code**, as the BBU mapping says (table §2). One line per (service code, version). | The service code is the SAP/BBU line item that gets billed. |
| R4 | **Our own new sub-activities (`PC0n`, `QC0n`, `PE0n`, `QE0n`) go at most 2 per line.** | They have no service code; small lines keep each WMC cell's scope small. |
| R5 | **A line carries its service code in the *Activity Code* field (Optional Line Fields), on All sites v1 lines only.** The codes are mapped in the Service Configurator to the **All sites v1** catalog, so auto-populate applies to Work Areas pinned to All sites v1. Lines of other versions keep the same grouping **without** a code, and their sub-activities are added by hand in step 5. | App owner, 2026-10-15. A code on more than one line of the same SO is not auto-populated either. |

---

## 2. Standard service code groups (Solar, from *Mapping_08-07-26*)

| Service code | SO line item | Sub-activities (Pulse) | WMC through DRS |
|---|---|---|---|
| **120021756** | Piling (excluding Robot Piling) | Piling - MMS, Piling - Inverter, Piling - LT Cable Hanger System | Yes |
| **120036457** | Robot, docking, reverse station, dummy structure incl Piling | Piling - Robotic Docking System, Installation of docking & reverse stations *(DRS catalog: activity **Robot Structure Installation**, sub-activity **Installation of binders/clips, bridges, docking & reverse stations**)* | Yes |
| 120021282 | IDT Civil & Structural - 1 (IDT incl. HT, LT panel civil foundation) | IDT Civil - HT / LT Platform, Transformer Platform, Aux Transformer Platform, NIFPS Foundation, BOP, Sump | Yes |
| 120036458 | IDT Civil & Structural - 2 (canopy, cable support, fencing, gravel) | IDT Civil - HT / LT Platform, IDT Civil & Structural - Cable Rack, IDT Civil - BOP, IDT Fencing, IDT Gravel Laying | Yes |
| 120036447 | MMS installation | MMS Installation | Yes |
| 120036456 | Module and Robot Structure Installation | Module Installation, Installation of binders / clips, bridges | Yes |
| 120022154 | Road work incl Pipe Culverts | OGL Layer, Soil Layer 1–6, GSB, Macadam Layer Test | Yes |
| 120021745 | Drain work | Drain Work | Yes |
| 150014478 | DC works | String Inverter, String Inverter - LT Cable Termination, String Inverter - String Formation, DC Cable Works, Earthing of tables | Yes |
| 150014585 | AC (LT) works | Transformer, HT Panel, LT Panel, Auxiliary Transformer, NIFPS, LT Cable Laying - Inverter to LT Panel, LT Cable Mgmt System Laying, Grid Earthing | Yes |
| 150027433 | HT Cable laying, jointing and termination | HT cable - Pre-Laying, HT Cable - Laying and Termination, HT Cable - Testing | Yes |
| 320043498, 240001444, 180002501, 150008924, 150014750, 120015590, 150013716, 130003344, 320040840 | Drone survey, WMS-Civil, SCADA, Site Pre-Ops 1–4, financial charges, infrastructure | none | **No**: done outside Pulse/DRS |

**Currently automated:** the Piling codes, **120021756** and **120036457**.

---

## 3. Service codes in DRS

### 3.1 Service Configurator (App Settings)
`/appSettings/serviceConfigurator`. An administrator maps each service code to sub-activities.

- **Tree shape:** each code has a tree with three levels: **sub-package → activity → sub-activity**.
- **Rows are per version:** every row is labelled with its catalog version, e.g. `Piling (MMS, Inverter, LT Cable Hangers)  Solar · All sites v1  3/10`. The same sub-activity in another version is a **separate row**, ticked separately.
- **Live state, drs-uat, 2026-10-15:**
  - **120021756** maps All sites v1's 3 Piling sub-activities. There were also 6 *Not available* rows: stale mappings to sub-activities a UAT redeploy deleted. The app owner removed them by hand.
  - **120036457** maps **nothing**.
- **The rows are virtualised:** only ~10 versions' rows exist in the page at a time, so automation must scroll the tree to reach later versions. The row (treeitem) itself is the checkbox (`aria-checked`); the drawn box is aria-hidden.
- **Save is two calls:** **Save** → `POST …/<code>/preview` counts what would change, e.g. *"changes the sub-activities on 19 existing service order lines, on 19 service orders. 12 lines with billed work keep their sub-activities"*. **Save and apply** then does the real write.
- **On Save:** a mapping is applied *"when a service order is first seen, when a line is given this code, and when you save this mapping"*. **Saving also replaces the sub-activities on existing lines that have no billed work.** A line with Completed / WMC Generated / WMC Approved / WMC Rejected work keeps its sub-activities and is listed in the conflict report. The Service Configurator is a **global** setting.
- **Code on several lines:** *"A code appearing on more than one line of the same SO is left for step 5"*. It is not auto-populated; step 5 is mapped by hand.
- **Drafts:** only **locked** versions can be mapped. Ticking a draft's sub-activity is refused.

### 3.2 On the SO line
- **Manual SO create form** (*3b. Create Service Order*): a line has Line Number, Service Item No, Quantity, Actual Qty, Price Unit and UOM. Under **Optional Line Fields** it also has WBS Element Code, Activity ID, Long Text, Account Category, Item Category, Short Text, Plant Code, Net Value (PO), Material Group, Purchase Requisition, Item Requisition, HSN Code, **Activity Code**, Activity Short Text and Net Value (Line).
- **The service code goes in *Activity Code*** (app owner, 2026-10-15). The SO Line Mapping card shows it as *Service Code*.
- **Step 5 (SO Line Mapping):** a line with a service code is auto-populated with the code's mapped sub-activities. The user can still add and remove sub-activities afterwards.

---

## 4. What the automation builds

### 4.1 The SO plan (`tests/drs/drs-data.js` `soPlan`)
Per package, per catalog version the project pins:

1. one line per **standard service-code group** the package maps (Civil: **120021756** Piling, **120036457** Robot). The code goes in *Activity Code* only on the **All sites v1** lines;
2. then our own new sub-activities, **in pairs**, with no code.

**Example for a project with All sites v1/v2 and Automation Site 01 v1/v2 (Civil):**

| Lines | Version | Content |
|---|---|---|
| 1 | All sites v1 | **code 120021756** (auto-populated): MMS + Inverter + LT Cable Hanger |
| 2 | All sites v1 | **code 120036457**: Robotic Docking + Installation of binders/clips, bridges, docking & reverse stations |
| 3–4 | All sites v2 | the same two groups, no code (step 5 by hand) |
| 5–6 | Automation Site 01 v1 | the same two groups, no code |
| 7–10 | Automation Site 01 v1 | PC01/QC01 sub-activities, 2 per line |
| 11–12 | Automation Site 01 v2 | the two groups, no code |
| 13–20 | Automation Site 01 v2 | PC01/QC01/PC02/QC02 sub-activities, 2 per line |

**Electrical** has no standard group yet: its lines are PE/QE sub-activities, 2 per line.

### 4.2 Stages
| Stage | What it does |
|---|---|
| `tests/drs-setting/service_codes_site_versions.spec.js` | **Not part of the chain.** It can tick our site versions' sub-activities under the codes and save, but the app owner decided (2026-10-15) to keep the codes on All sites v1 only. Kept for a future decision; running it changes other SOs' unbilled lines (see the preview numbers above). |
| D04 | Creates the two SOs with the planned lines; the service code goes in *Activity Code*. |
| D05 | SO Configuration: maps the activities of every group to the package's SO (Piling ×4 + Installation of docking & reverse stations + our codes' activities). |
| D06 | Step 5: per line, keeps what DRS auto-populated **of the line's own version**, removes any chip of another version, and adds what is missing. After a reload it checks every line holds exactly its planned group, all of one version. |
| `00_drs_explore_round12_so_line_versions.spec.js` | Read-only check of every line: one version only, never empty, and our own pair lines at most 2. |

---

## 5. Verified live (2026-10-15, AUTO-Solar-15102026-RHY)

| SO | Lines | Result |
|---|---|---|
| **9956077393** Civil (997248) | 20 | Standard groups on every version: Piling 3, Robot 2. Our PC/QC sub-activities 2 per line. |
| **9956099198** Electrical (999080) | 12 | PE/QE sub-activities, 2 per line. |

- **Auto-populate works on All sites v1:** line **10-10** (All sites v1, Activity Code **120021756**) arrived in step 5 already holding its 3 Piling sub-activities, so D06 added nothing there.
- **120036457 maps nothing yet:** line 20-20 arrived empty and D06 filled it.
- **All other versions** were mapped by hand by D06.
- **Line check:** the read-only checker passed on all 32 lines: exactly the planned set on each, one version per line, at most 2 for our own sub-activities.
- **Work Areas:** BL01, BL02 (All sites v1), BL03 AS-v2, BL04 S-v1, BL05 S-v2.

## 6. Open points
- **120036457:** mapping All sites v1's Robot sub-activities to this code in the Service Configurator would let its line auto-populate too. That's the app owner's call (it's a global change).
- **Other packages' codes** (IDT, MMS, Module, Road, Drain, DC, AC, HT) can be added to `SERVICE_CODE_GROUPS` the same way when the chain maps those activities.
