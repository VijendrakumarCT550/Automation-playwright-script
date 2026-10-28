# DRS onboarding suite

`npm run onboarding:uat` (folder `tests/onboarding/`).

Every run builds **new catalog versions in both chains** and **onboards a fresh project** whose Work Areas are mapped to them, in about **1.9 h**. The depth (every checkpoint of every new code, an NC per sub-activity, the smoke folder on every catalog version) is a **separate suite on the last onboarded project**, `npm run onboarding-smoke:uat` (§6), so it can be re-run after every deployment without onboarding again (app owner, 2026-10-21).

Related: [`drs-catalog-versions-and-so-lines.md`](drs-catalog-versions-and-so-lines.md), [`drs-checklists.md`](drs-checklists.md), [`drs-so-lines-and-service-codes.md`](drs-so-lines-and-service-codes.md).

Decisions are the app owner's (2026-10-19) unless marked otherwise.

---

## 1. What one run does

| Stage | What | Project |
|---|---|---|
| D01 | DRS masters: Civil + Electrical vendors, SPV, site (find or create once) | `drs` |
| OB01 | The run's catalog versions: roots + A1 / S1 / A2 / S2 (§2) | `onboarding` |
| OB02 | Fresh project, `WA01`…`WA06`, pins, the Civil and Electrical SOs (§3) | `onboarding` |
| D05 | SO Configuration on that project, every version | `drs` |
| D06 | SO Line Mapping on that project | `drs` |
| IN01 | Pulse users of the project: CI, CIE (Electrical vendor), EE, QI, PM, EL, QL | `integration` |
| OB03 | Pulse WAM: Civil CI/EE/QI on every area; Electrical CIE/EE/QI on `WA<nn>` (§4) | `onboarding` |
| OB04 | Pulse RFIs on every area, and the dependency plans (§4) | `onboarding` |
| OB05 | Pulse NC cycle on every area (§4) | `onboarding` |

- **The runner:** `tests/utils/run-onboarding.js` runs the stages in order and stops at the first failure. Resume with `--from <stage>`; `--list` prints the stages; `--run R<n>` aims the stages at a given run, even a closed one.
- **Parallel workers (2026-10-21):** stages whose tests are independent run in parallel workers. `ONBOARDING_LANES=1` turns it off.

  | Stage | Workers | Split by |
  |---|---|---|
  | OB01 | 2 | catalog chain: All sites (A1 → A2) and the site (S1 → S2); order kept inside each chain |
  | D05 | 3 | catalog version |
  | D06 | 2 | SO (Civil, Electrical) |
  | OB04 / OB05 | 3 | RFI / NC item (disjoint Work Areas; Pulse allows several sessions of one user) |

  Every write to the state files (`drs-setup.json`, `catalog-counter.json`) is a read-modify-write under a file lock (`tests/utils/file-lock.js`); callers that merge into what is there use `state.mutateEnv` / `mutateProject`.
- **The report, in the same places as smoke / integration:** each stage is its own Playwright invocation (they would overwrite each other's report), so each writes a blob, and at the end, also when a stage fails, they are merged into one report:
  - `playwright-report/index.html`: every stage's tests (`npx playwright show-report`)
  - `onboarding-reports/results.json`, `onboarding-reports/junit.xml` (as smoke writes `smoke-reports/`)
  - `onboarding-reports/summary.md`: each stage's result, workers and time, plus test totals
  - a copy of all four per invocation in `onboarding-reports/<start time>/`, as history
- **SO Configuration uses Bulk edit (D05, app owner):** the matrix is read in one pass, the cells needing the package's SO are ticked and the SO applied at once, cells to clear are removed the same way, then **Save** (Apply / Remove only change the screen). The page is reloaded only to verify after a Save; switching package changes only the Package filter.
- **Environments:** URLs come from `DRS_ENV` / `PULSE_ENV` (`tests/config/drs-environments.js`, `tests/config/environments.js`), so the same suite runs on another environment by changing those. `PULSE_ENV` defaults to the Pulse the DRS environment syncs to (`pairedPulse`).

---

## 2. The catalog versions of a run (OB01)

Example: the app holds All sites v5 and Automation Site 01 v3 when the run starts.

| Round | Chain | Drafted from | Locks as | Work Areas |
|---|---|---|---|---|
| root | All sites | — | All sites **v1** | WA01, Road01, Drain01, Culvert01 |
| root | Site | — | Automation Site 01 **v1** (only if the site has one) | WA02, Road02, Drain02, Culvert02 |
| A1 | All sites | All sites v1 | All sites **v6** | WA03, Road03, Drain03, Culvert03 |
| S1 | Site | Site v1 (else All sites v1) | Site **v4** | WA04, Road04, Drain04, Culvert04 |
| A2 | All sites | A1 (just locked) | All sites **v7** | WA05, Road05, Drain05, Culvert05 |
| S2 | Site | S1 (just locked) | Site **v5** | WA06, Road06, Drain06, Culvert06 |

That is six versions and 24 Work Areas; **five** versions (20 areas) when the site has no v1.

**Every round:**
1. If the chain has an **open draft the suite did not make**, it is **locked** first. If DRS refuses, the run **stops** with DRS's validation message, so a person can lock or discard it by hand.
2. **New draft** from the source, then a copy check (same sub-packages as the source).
3. **Reserve** the next codes, the full tree: Civil `PCxx` / `QCxx`, Electrical `PExx` / `QExx` (4 × 19 nodes).
4. **Site rounds only:** six fresh checklists, `AUTO R<run> <PCxx> Checklist 1…6`.
   - #1 is new; #2 / #3 are forks of Micro Pile Cap / Post Pour Check; #4 / #5 / #6 are forks of #1 / #2 / #3.
   - They are bound to `PCxx.2.1` / `PCxx.2.2` a/b/c. All-sites builds use standard checklists only.
5. **Build** the new codes.
6. **Round 2 only:** **reconcile** the inherited round-1 P-code to the second dependency plan.
7. **Verify** every code and **lock**, then verify the locked version again.

### Dependencies (Civil P-code only, both chains)

| Draft | Code | Checkpoints |
|---|---|---|
| **first** (A1, S1) | new PCxx | `PCxx.1.1`: **b ← a**; `PCxx.1.2`: **b ← a, c ← b**; `.2.x`: none |
| **second** (A2, S2) | the **inherited** PCxx from round 1 | all first-draft dependencies **removed**; `PCxx.2.1` / `.2.2`: **b ← a, c ← b** added |
| | its own new PCyy | the first-draft plan |

QCxx and Electrical get none. A plan is verified **strictly**: a checkpoint the plan gives no dependency must show *"No preceding inspection points"*, which proves a removal synced.

---

## 3. The project (OB02)

- **Project:** a fresh Solar project, `AUTO-Solar-<ddmmyyyy>-OB<run>`.
- **Work Areas:** one Work Location `AUTO-WL-<tag>`. Each version gets **four** areas, all pinned to it: **`WA<nn>`**, **`Road<nn>`**, **`Drain<nn>`** and **`Culvert<nn>`** (24 areas; 20 when the site has no v1). The names are plain, with no version in them. The project record carries `areaVersions` (`WA03 / Road03 / Drain03 / Culvert03 → All sites v7` …), which `drs-data.bindProject` gives D05 / D06.
- **Work Sections:**

| Area | Type | Count | Names |
|---|---|---|---|
| `WA<nn>` | TABLE | 60 | `R01-T01` … `R05-T12` |
| `WA<nn>` | INVERTER | 25 | `I01` … `I25` |
| `WA<nn>` | CABLE | 10 | `0-100m` … `900-1000m` |
| `Road<nn>` | ROAD | 10 | `0-100m` … `900-1000m` |
| `Drain<nn>` | DRAIN | 10 | `0-100m` … `900-1000m` |
| `Culvert<nn>` | CULVERT | 10 | `0-100m` … `900-1000m` |

> **ROAD, DRAIN and CULVERT have their own Work Areas because that is how the production app lays out a project** (app owner, 2026-10-19): linear works are Work Areas of their own, not sections inside a block. No client requirement so far asks for these continuous sections to be imported into one Work Area together.
>
> *Observed, possible DRS bug:* the location import rejects the whole file with `DUPLICATE_IN_PAYLOAD` when one Work Area holds two Work Sections of the same name but different types (e.g. ROAD `0-100m` and DRAIN `0-100m`). The app owner will review it; it is not why the areas are separate.
>
> An area added to the plan later is imported on its own into the same Work Location (OB02 P2 imports only the missing areas).
>
> **Work Section eligibility follows the catalog's Min Unit** (app owner): an RFI checkpoint is offered only the sections whose type matches the **Min Unit of its sub-activity**. Every sub-activity our catalogs build (`PCxx`, `QCxx`, `PExx`, `QExx`) uses Min Unit **TABLE** (`pc-data.js` `buildTree`), so their RFIs are raised on the TABLE sections of `WA<nn>`.

- **Pins:** `WA<n>`, `Road<n>`, `Drain<n>` and `Culvert<n>` are pinned to the run's n-th version (§2).
- **SO Configuration (D05):** **every** activity of the matrix, Civil and Electrical, standard or added by our catalogs, is mapped to its package's SO, by the kind of Work Area (app owner, 2026-10-19):

| Area | Activities |
|---|---|
| `Road<nn>` | the 9 `Road Works - IDT Road …` (BBU 120022154: OGL Layer, Soil Layer 1–6, GSB, Macadam) |
| `Drain<nn>` | `Drain Work` (BBU 120021745) |
| `Culvert<nn>` | `Culvert Works -PCC`, `Culvert Works -RCC` |
| `WA<nn>` | every other activity (Civil: 12 standard + our PCxx/QCxx; Electrical: 7 standard + our PExx/QExx) |

  Road / Drain / Culvert get no Electrical activity. A cell holding one of the project's SOs that the plan does not give it is **cleared** (the cell list's `× Clear`). D05 verifies both after a reload. Non-onboarding projects keep the Piling + our-codes list.
- **SOs:** one per package (Civil → 997248, Electrical → 999080). The lines follow `drs-data.soPlan`: Piling service-code groups, plus our own sub-activities 2 per line, one version per line. *SO line mapping corrections are pending from the app owner.*
  - **Road / Drain / Culvert get no SO lines** (app owner, 2026-10-19). Those areas are for **RFI / NC flow checks only**, which need just the SO Configuration mapping. SO lines matter for **WMC**, which is out of scope for them until the app owner says otherwise.

---

## 4. Pulse (IN01, OB03–OB05)

The items come from `tests/onboarding/pulse-plan.js`, built from the project's `areaVersions` and the catalog records' `codePlans`.

**RFIs (OB04), CI raises → EE approves → QI approves:**

| Area | Package | RFI |
|---|---|---|
| `WA<nn>` | Civil | Piling - MMS / Pre Pour Inspection - Pile / Micro Pile Checklist |
| `WA<nn>` | Electrical (CIE) | the version's newest PE code, `.1.1 Checkpoint a` |
| `Road<nn>` / `Drain<nn>` / `Culvert<nn>` | Civil | first sub-activity / checkpoint / checklist of `Road Works - IDT Road` / `Drain Work - Plot Area` / `Culvert Works - Plot Area` |

**Dependency checks (OB04), Civil P-codes of the round versions:**

| Code | Sub-activities | Proves |
|---|---|---|
| first-draft code | `.1.1` (b←a), `.1.2` (b←a, c←b) | a waiting checkpoint is **blocked** ("Missing an RFI for Dependent Inspection Point …") until its predecessor is approved, then released on the same Work Section |
| the code inherited into round 2 | `.1.1`, `.1.2` | b and c go through **with no predecessor**: DRS's removal reached Pulse |
| | `.2.1`, `.2.2` | the added b←a, c←b, as above (site versions: with our six checklists) |

Blocked and no-predecessor attempts use a throwaway Work Section, because selecting one consumes it for that checkpoint.

**NC (OB05), QI raises → CI (CIE) responds → EE approves → QI approves**, standard activities only: `WA<nn>` Civil *Piling - Robotic Docking System*, `WA<nn>` Electrical *first activity*, `Road<nn>` *Road Works - IDT Road GSB*, `Drain<nn>` *Drain Work*, `Culvert<nn>` *Culvert Works -PCC*. NC on our own PC/PE codes comes later. OB05 runs after OB04, so an open NC never blocks an OB04 RFI.

**Resume:** each RFI / NC item is recorded on the project (`pulse.onboardingRfi`, `pulse.onboardingNc`) once it passes; a re-run skips it.

**Two plans (`ONBOARDING_PLAN`, `pulse-plan.js`):** the onboarding run uses `onboarding` (the items above, 45 RFIs / 30 NCs); onboarding-smoke uses `coverage` (§6). The two never repeat each other's items. OB04 runs one lane per catalog version, because Pulse's RFI counter per Work Area + package gave two concurrent creates the **same code** (`…WA03-CIV-73`, reported to the app owner).

**R1 (2026-10-19, `AUTO-Solar-19102026-OB1`):** OB04 45/45, OB05 30/30 (built up stage by stage).

**R2 (2026-10-19/20, `AUTO-Solar-19102026-OB2`), the first end-to-end run of the whole suite:** All sites v9 / v10, Automation Site 01 v6 / v7; every stage green. OB01 5/5 (≈ 60 + 36 min, one resume after a verify read flake, fixed), OB02 4/4 (4 min, 775 records), D05 (11.6 min), D06 (6.5 min), IN01 (2 min), OB03 (2.2 min), OB04 45/45 (1.7 h), OB05 30/30 (51 min). **About 4 h 15 min end to end.**

**R3 / R4 (2026-10-20, `AUTO-Solar-20102026-OB3` / `-OB4`), two fresh end-to-end regression runs, both all green:** R3 All sites v11 / v12, Automation Site 01 v8 / v9 (one resume: a DRS "Save failed" on a checkpoint create had passed as success on a stale toast - `submitCreate` now proves a create by the node in the tree and retries "Save failed"); R4 All sites v13 / v14, Automation Site 01 v10 / v11, **no stop at all**: OB01 1.0 h, OB02 4 min, D05 11.6 min, D06 6.6 min, IN01 2 min, OB03 2.2 min, OB04 45/45 1.7 h, OB05 30/30 52 min - **about 3 h 50 min**.

---

## 5. State

- **The run record:** `tests/fixtures/drs/drs-setup.json` → `environments.<env>.onboarding`:
  - `lastRun`;
  - `runs.R<n>`: `roots`, `rounds.{A1,S1,A2,S2}`, `projectTag`, `done`.
- **Catalog versions:** recorded under `catalogs["All sites" | "<site>"]["R<n>-<round>"]`, with `label`, `source`, `codes`, `inheritedCodes`, `codePlans` (per code: dependency plan and checklists) and `status`.
- **The project:** under `projects[]`, with `areaVersions`, `serviceOrders`, `stagesDone`.
- **Resume:** a run that stops part-way is resumed by the next one; the runner closes a run when OB05 has passed.
- **Onboarding-smoke runs:** `environments.<env>.onboardingSmoke.runs.S<n>` (`projectTag`, `done`); their RFI / NC results are on the project under `pulse.onboardingRfi_S<n>` / `pulse.onboardingNc_S<n>`, their WAM under `pulse.onboardingWam.<pkg>_S<n>`.

---

## 6. Onboarding smoke (`tests/onboarding-smoke/`)

`npm run onboarding-smoke:uat` (`tests/utils/run-onboarding-smoke.js`) runs on the project of the **last completed onboarding run**; `--project <tag>` picks another one. The same `--from` / `--only` / `--list` options, and the same report (`playwright-report/`, `onboarding-smoke-reports/`).

| Stage | What | Project |
|---|---|---|
| OS01 | Import + pin the smoke and coverage areas (below) | `onboarding-smoke` |
| D05 | SO Configuration, so the new areas carry the project's SOs (idempotent: old areas are read, not re-saved) | `drs` |
| OB03 | Pulse WAM: CI / CIE / EE / QI on this run's `CV<nn>-S<k>` only | `onboarding` |
| OB04 | `coverage` plan: every checkpoint a/b/c of every sub-activity of every new code (PC / QC / PE / QE), our checklists' questions checked against DRS (texts + count) | `onboarding` |
| OB05 | `coverage` plan: one NC per sub-activity of every new code | `onboarding` |
| SMOKE | The smoke folder (SM01–SM29) unchanged, on `SM01`…`SM13` (All sites v1) | `smoke-drs-*` |
| SMOKEV | The smoke RFI / NC stages on **every other version**, the site root and A1 / S1 / A2 / S2 included: its own users + their WAM, RFI flow (9 TCs, reject + resubmit, desktop + mobile), NC flow (reject + resubmit), NC blocks RFI, dependency chain, RFI data integrity, RFI / NC create, bulk, draft autosave | `smoke-drsv<nn>-*` |

**Areas** (TABLE + INVERTER; no SO lines needed: the lines are per version, and the project's existing ones cover it):

| Area | Version | When |
|---|---|---|
| `SM01`…`SM13` | All sites v1 | once per project |
| `SM<nn>-01`…`09` | the version of `WA<nn>`, every other version | once per project |
| `CV<nn>-S<k>` | each version the onboarding run **built** (A1, S1, A2, S2) | **every run**: R6's coverage used 16–22 of `WA<nn>`'s 60 TABLEs plus throwaway sections, so re-runs get areas of their own |

**Parallel:** each version chain has its own CI / EE / QI (`<role>DRSV<nn>`), so up to three chains run at once (`ONBOARDING_LANES`); the draft-autosave chains run one at a time (one draft per user). The **PM is shared** (Pulse takes one PM per Work Location), so the version chains leave the PM out of their NC creators (`SMOKE_NC_CREATORS=QI,EE,EL,QL`). The WAM **feature** specs (all roles, hierarchy, demap / update) and the role sweeps run only in the All sites v1 chain: WAM maps users to areas and does not depend on the catalog version.

**Fresh vs resumed:** a run with no `--from` / `--only` starts `S<n+1>` and resets the smoke trackers (`SMOKE_RESET=1`); `--from` / `--only` continue the open run and its trackers (`SMOKE_RETRY_FAILED=1` revives failed TCs in place).
