# `tests/onboarding/`: how the onboarding suite works

This folder holds the **onboarding suite**. One run builds new DRS catalog versions, onboards a fresh DRS project mapped to them, and proves the result end to end in Pulse with WAM, RFIs and NCs.

- **Run it:** `npm run onboarding:uat`. It takes about 1.9 h for the onboarding stages. A full run including the Pulse flows has taken about 3 h 50 min.
- **Decisions and history:** [`docs/drs-onboarding-suite.md`](../../docs/drs-onboarding-suite.md) records the app owner's rulings, the exact versions and area tables, and the results of runs R1 to R4. This README covers how the code carries that plan out.
- **Depth suite:** the deeper checks (every checkpoint of every new code, an NC per sub-activity, the smoke folder on every version) live in [`tests/onboarding-smoke/`](../onboarding-smoke/). That suite runs on the **last onboarded project** (`npm run onboarding-smoke:uat`).

> Every record this suite creates in DRS is **permanent**: catalog versions, checklists, projects, SOs. That is why everything is recorded in the state file the moment it exists, and why a stopped run is **resumed** instead of restarted. The default `chromium` project ignores this folder (see `testIgnore` in `playwright.config.js`). It runs only through the runner.

---

## 1. Files in this folder

| File | Role |
|---|---|
| `OB01_catalogs.spec.js` | Stage OB01. Picks the two root versions, then builds rounds A1/S1/A2/S2 (draft, build, lock) |
| `OB02_project.spec.js` | Stage OB02. Fresh project, Work Areas + Work Sections import, version pins, Civil + Electrical SOs |
| `OB03_pulse_wam.spec.js` | Stage OB03. Pulse Work Area Mapping (CI/CIE, EE, QI) on the run's areas |
| `OB04_pulse_rfi.spec.js` | Stage OB04. RFIs on every area, plus the dependency-plan checks |
| `OB05_pulse_nc.spec.js` | Stage OB05. One full NC cycle per area |
| `onboarding-run.js` | **The run model.** Run numbering (R1, R2…), the round list, and the area plans (`areaPlan`, `smokeAreaPlan`, `coverageAreaPlan`). It also tracks onboarding-smoke runs (S1, S2…) |
| `catalog-round.js` | **One catalog round** (`buildRound`), used by OB01. Covers the foreign-draft lock, new draft, copy check, code reservation, checklists, build, dependency reconcile, verify and lock |
| `project-areas.js` | `importMissingAreas` (CSV import in batches under 10,000 rows) and `pinAreas` (pin each area to its version). Shared by OB02 and onboarding-smoke OS01 |
| `pulse-plan.js` | **The Pulse test plan.** Turns the project's `areaVersions` and the catalog records' `codePlans` into the RFI/NC item lists for OB04/OB05. Also holds the `onboardingOnly` guard |
| `inspection/probe_wam_rows.spec.js` | Read-only probe that lists the WAM rows Pulse offers per package. It is a diagnostic tool and the runner does not run it |

The runner is outside this folder: [`tests/utils/run-onboarding.js`](../utils/run-onboarding.js), built on [`tests/utils/stage-runner.js`](../utils/stage-runner.js).

---

## 2. The end-to-end flow

Each stage is a **separate Playwright invocation**. The runner runs them in order and **stops at the first failure**, because every later stage depends on the earlier ones.

```
 DRS side (DRS_ENV)                                   Pulse side (PULSE_ENV)
 ───────────────────────────────────────────────      ─────────────────────────────────
 D01  masters: vendors, SPV, site (find/create)
  │
 OB01 catalog versions ── All sites chain: root → A1 → A2   (2 workers,
  │                    └─ Site chain:      root → S1 → S2    one per chain)
  │
 OB02 fresh project → import areas → pin to versions → Civil + Electrical SOs
  │        (the project's tag is now in the run record; every later stage gets
  │         DRS_PROJECT_TAG=<tag>)
 D05  SO Configuration (every version)        ── DRS syncs to Pulse ──▶
 D06  SO Line Mapping                                                   IN01 Pulse users: CI, CIE, EE, QI, PM, EL, QL
                                                                         │
                                                                        OB03 WAM: Civil on all areas, Electrical on WA<nn>
                                                                         │
                                                                        OB04 RFIs: plain + dependency chains (3 workers)
                                                                         │
                                                                        OB05 NC cycle per area (3 workers)
                                                                         │
                                                              runner marks run R<n> done
```

D01, D05 and D06 are specs from `tests/drs/setup/`, and IN01 comes from `tests/integration/`. The onboarding runner reuses them, aimed at the run's project.

### Runner commands

```bash
npm run onboarding:uat                                   # whole suite (opens the next run or resumes the open one)
node tests/utils/run-onboarding.js --list                # print the stages
node tests/utils/run-onboarding.js --from OB02           # resume from a stage
node tests/utils/run-onboarding.js --only OB04,OB05      # only these stages
node tests/utils/run-onboarding.js --run R3 --from IN01  # aim at a given run, even a closed one
ONBOARDING_LANES=1 npm run onboarding:uat                # no parallel workers
```

The merged report from all stages goes to `playwright-report/index.html`, and `onboarding-reports/` gets `results.json`, `junit.xml` and `summary.md`, with a time-stamped copy for history.

---

## 3. The plan: what one run builds

### 3.1 Catalog versions (OB01 → `catalog-round.js`)

`onboarding-run.js` defines four rounds on two chains:

| Round | Chain | Drafted from | Extra |
|---|---|---|---|
| root | All sites | (existing) **All sites v1**, which must be locked | none |
| root | Site | (existing) **`<site>` v1**, if the site has one | none |
| **A1** | All sites | All sites v1 | first dependency plan |
| **S1** | Site | `<site>` v1, else All sites v1 | first plan + **our six checklists** |
| **A2** | All sites | A1 | inherited P-code reconciled to the second plan; its new code gets the first plan |
| **S2** | Site | S1 | same as A2, + our six checklists |

That gives **6 versions**, or **5** when the site has no v1 (the site root is skipped).

The two chains are independent, so OB01 runs them in **two parallel workers** (`mode: 'parallel'` across chains, `mode: 'serial'` inside each chain). Round 2 can only start once round 1 of its chain is locked.

**`buildRound` steps:**

1. **Resume check.** If the state already records this round as `locked`, it re-verifies the codes and returns.
2. **Foreign draft.** If the chain has an open draft this suite did not make, it tries to **lock** it. If DRS refuses, the run **stops** with DRS's validation message so a person can lock or discard the draft by hand.
3. **New draft** from the source. The label is recorded immediately.
4. **Copy check.** The draft's sub-packages must equal the source's, checked one package at a time. The source's codes and plans are recorded as `inheritedCodes` / `codePlans`.
5. **Reserve codes** for Civil `PCxx`/`QCxx` and Electrical `PExx`/`QExx`, through `pc-counter`. This happens once, before any node exists.
6. **Site rounds only:** make six checklists, `AUTO R<n> <PCxx> Checklist 1…6` (new ones and forks), and read their questions back. The question texts are stored so OB04 can compare them against Pulse later.
7. **Build** every new code.
8. **Round 2 only:** the P-code inherited from round 1 is reconciled from the `first` plan to `secondInherited`. The old dependencies are removed and `.2.1`/`.2.2` get b←a, c←b.
9. **Verify** every code, inherited and new. Dependencies are checked strictly: a checkpoint with no planned dependency must show "No preceding inspection points".
10. **Lock**, then confirm the version is listed as locked and verify again.

**Dependency plans** (Civil P-code only; `DEPENDENCY_PLANS` in `tests/drs-setting/pc-data.js`):

| Plan | Applies to | `.1.1` | `.1.2` | `.2.1` / `.2.2` |
|---|---|---|---|---|
| `first` | the new P-code of every round | b←a | b←a, c←b | none |
| `secondInherited` | round 1's P-code once inherited into round 2 | none (removed) | none (removed) | b←a, c←b |

### 3.2 The project (OB02 → `project-areas.js`)

| Test | What it does |
|---|---|
| **P1** | Creates `AUTO-Solar-<ddmmyyyy>-OB<n>`, records it with `onboardingRun` and `areaVersions` (area → version), and writes `projectTag` into the run |
| **P2** | `importMissingAreas` builds a location CSV and imports **only the areas the project lacks**, in batches of ≤ 9,000 rows (the DRS limit is 10,000). Each batch is recorded once DRS accepts it |
| **P3** | `pinAreas` pins each area to its version. An area already on that version is skipped. An area pinned to a **different** version fails the test, because pins are never changed. Every badge is re-read after a reload |
| **P4** | One SO per package (Civil, Electrical), with lines from `drs-data.soPlan` |

**Areas per version** (`SECTION_PLAN` in `onboarding-run.js`). Version *n*, in the order roots, A1, S1, A2, S2, gets four areas:

| Area | Work Sections |
|---|---|
| `WA<nn>` | 60 TABLE (`R01-T01`…), 25 INVERTER, 10 CABLE |
| `Road<nn>` | 10 ROAD |
| `Drain<nn>` | 10 DRAIN |
| `Culvert<nn>` | 10 CULVERT |

That makes 24 areas, or 20 with 5 versions. Our catalog sub-activities use Min Unit **TABLE**, so their RFIs land on the TABLE sections of `WA<nn>`.

D05 and D06 then map the SOs onto this project. D05 maps Road/Drain/Culvert activities only onto their own kind of area, and maps everything else onto `WA<nn>`.

### 3.3 The Pulse plan (`pulse-plan.js` → OB04 / OB05)

`plan(project, mode)` groups the project's areas **by catalog version** and returns `{ version, areas, items, ncItems }` for each one. The mode comes from `ONBOARDING_PLAN`:

- **`onboarding`** is the default and the one this suite uses.
- **`coverage`** is used by onboarding-smoke.

The two modes never repeat each other's items.

**RFI item kinds:**

| Kind | Where | Flow |
|---|---|---|
| `plain` | `WA<nn>` Civil (standard *Piling - MMS / Pre Pour Inspection - Pile*), `WA<nn>` Electrical (newest PE code, `.1.1` checkpoint a), and `Road`/`Drain`/`Culvert<nn>` (first item of their sub-package) | CI (or CIE) raises → EE approves → QI approves |
| `chain` | the planned Civil P-codes on `WA<nn>`, per checked sub-activity (`CHECKED_SUBS`) | see below |
| `full` | coverage mode only: a sub-activity with no dependency | checkpoints a, b, c on one Work Section, each one approved |

**How a `chain` item runs in OB04:**

- **The checkpoint waits for its predecessor (deps):**
  1. Try it first on a throwaway Work Section. It must be **blocked** with *"Missing an RFI for Dependent Inspection Point…"*.
  2. Raise and approve the predecessor.
  3. Raise the waiting checkpoint on the **same** Work Section. It now goes through.
- **No dependency (`deps: []`, the inherited code's `.1.1`/`.1.2`):** b and c must go through **with no predecessor**. This proves DRS's dependency removal reached Pulse.
- **Checkpoint bound to one of our checklists:** before submitting, Pulse must show exactly that checklist's DRS questions, with matching texts and count.

Blocked and no-predecessor attempts use a random throwaway section (`'__random__'`). Selecting a Work Section consumes it for that checkpoint even if the RFI is never submitted.

**NC items (OB05):** for each area, QI raises → CI (CIE for Electrical) responds → EE approves → QI approves. Each step checks that the QI's mandatory photo propagated (attachment count > 0).

| Area | Package | Activity |
|---|---|---|
| `WA<nn>` | Civil | Piling - Robotic Docking System |
| `WA<nn>` | Electrical | first activity |
| `Road<nn>` | Civil | Road Works - IDT Road GSB |
| `Drain<nn>` | Civil | Drain Work |
| `Culvert<nn>` | Civil | Culvert Works -PCC |

In coverage mode, OB05 also raises one NC per sub-activity of every new code. OB05 runs **after** OB04, so an open NC never blocks an OB04 RFI.

In the onboarding plan, a 6-version run comes to **45 RFIs and 30 NCs**.

**Parallel lanes in OB04/OB05:** each catalog version is one `describe`, run in order (`mode: 'default'`, so one failure does not skip the rest). Different versions run in parallel, with 3 workers. The reason is that Pulse's per-Work-Area code counter is not safe under concurrent creates: two concurrent RFIs on one WA received the same code.

**Guard:** `onboardingOnly(profile)` makes OB03–OB05 fail with a clear message unless `DRS_PROJECT_TAG` names an **onboarding** project. Without the guard, the integration profile would fall back to the newest ordinary DRS project, and these stages must never touch that project.

---

## 4. State, resume and records

All state lives in `tests/fixtures/drs/drs-setup.json` under `environments.<env>`. Every write is a locked read-modify-write (`state.mutateEnv` / `mutateProject`), because parallel workers write to it at the same time.

| Where | What |
|---|---|
| `onboarding.lastRun`, `onboarding.runs.R<n>` | The run record: `roots`, `rounds.{A1,S1,A2,S2}`, `projectTag`, `done` |
| `catalogs["All sites" \| "<site>"]["R<n>-<round>"]` | One catalog round: `label`, `source`, `status` (`drafted` → `built` → `locked`), `codes`, `inheritedCodes`, `codePlans`, `checklists` |
| `projects[]` (by tag) | The project: `areaVersions`, `workAreas`, `pinned`, `serviceOrders`, `stagesDone` |
| project `pulse.onboardingWam` / `onboardingRfi` / `onboardingNc` | Pulse results per item, with `status: passed \| failed \| raised` |

**How resume works:**

- **`currentRun()`** returns the **open** run, or starts `R<n+1>` if none is open. It is atomic, so both OB01 workers get the same run.
- **OB01** skips a locked round after re-verifying it, and reopens a drafted one. Codes and checklists are reserved or made only once.
- **OB02** skips the project if `run.projectTag` is already set, imports only missing areas, and skips pins that are already correct. An SO already listed is skipped.
- **OB03** uses `ensureWorkAreaMapping`, which only assigns what is missing.
- **OB04 / OB05** skip every item already recorded as `passed`.
- **The runner** marks the run `done` only after OB05 passes. The next `npm run onboarding:uat` then starts a new run.

---

## 5. Prerequisites and environment

- `.env`: the DRS super-admin login, and `BULK_USER_DEFAULT_PASSWORD` for the Pulse flow users created by IN01.
- `DRS_ENV` / `PULSE_ENV` pick the hosts (`tests/config/drs-environments.js`, `tests/config/environments.js`). `PULSE_ENV` defaults to the Pulse that the DRS environment syncs to.
- The runner sets these per stage:
  - `DRS_PROJECT_TAG` (from D05 on)
  - `ONBOARDING_PLAN=onboarding` (OB04/OB05)
  - `PLAYWRIGHT_OUTPUT_DIR`, so parallel invocations don't wipe each other's screenshots
- These variables let onboarding-smoke reuse the OB03–OB05 specs:
  - `ONBOARDING_WAM_AREAS` (regex): OB03 maps only the matching areas, for example the `CV<nn>-S<k>` coverage areas
  - `ONBOARDING_RECORD=<S<k>>`: OB04/OB05 record into `onboardingRfi_S<k>` / `onboardingNc_S<k>`, so every smoke run tests again from scratch

---

## 6. Running one stage by hand

Use this when debugging. The runner is still the normal way to run the suite.

```bash
DRS_PROJECT_TAG=<tag> PULSE_ENV=uat npx playwright test --project=onboarding tests/onboarding/OB04_pulse_rfi.spec.js --workers=1
```

`<tag>` is the project's tag in `drs-setup.json`, for example `19102026-OB2`. The DRS-side stages (OB01, OB02) need no tag: they work on the open run.
