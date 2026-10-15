# DRS → Pulse integration — design

Status: **Phase 1 and Phase 2 built and green, drs-uat → pulse-uat (2026-09-26)** — one full RFI cycle and one full NC cycle on a DRS-created project · see "as built" sections below

---

## The full smoke chain on DRS ground — `npm run integration:smoke:uat`

App owner, 2026-09-26: "add other specs also in integration folder and verify
they all pass". Every smoke stage (SM01, SM03–SM29 — 28 files, 155 tests,
desktop + mobile flows) runs **unchanged** on the DRS project as the
`smoke-drs-*` projects. Reused rather than copied, so the DRS coverage can never
drift from the originals.

- `tests/integration/drs-smoke-profile.js` builds the full smoke profile (the
  SOLAR_E2E shape) from the newest ready DRS project; `getProfile()` resolves any
  `drs-*` key through it. Same key as the integration profile
  (`drs-solar-<tag>`), so IN01's CI/EE/QI are reused and SM01 only creates the
  other seven roles (CM, EL, QL, PM, PAD, SAD, CAD) — scoped to the DRS Work
  Location, the CI/CM on the DRS vendor.
- The chain is only emitted when that project's DRS env is paired with
  `PULSE_ENV`; otherwise the config is unchanged.
- Ground on a 13-block project: BL03/BL04 RFI flows, BL05 NC flows + NC create,
  BL06 NC-blocks-RFI, BL07 dependency chain, BL08/BL09 WAM sweep, BL10 WAM
  mutate, BL11 RFI create + dashboard seed, BL12/BL13/BL01 multi-area bulk.
  (BL01/BL02 also host IN03/IN04.)

## Phase 2 as built — `npm run integration:uat`

`tests/integration/`, run serially by the `integration` Playwright project
against PULSE (`PULSE_ENV`). `drs-profile.js` builds a smoke-shaped profile
from the newest DRS project that finished D8, **refuses to run if that
project's DRS env is not paired with `PULSE_ENV`**, and splits the ground: RFI
on the first BL Work Area, NC on the second (a non-approved NC blocks RFI on
the same checkpoint + section). Pulse-side results are recorded on the DRS
project record (`pulse: { users, wam, rfis, ncs }`), so one record tells the
whole DRS → Pulse story. `DRS_PROJECT_TAG` pins an older project.

| Stage | File | Reuses | Result on the first run |
|---|---|---|---|
| IN01 | `IN01_users` | `createSmokeUser` (Pulse Add User, cascade assertions) | CI `CIDRSqyxUser201` (vendor user of AUTOMATION SERVICE CONTRACTOR), EE `EEDRShekUser201`, QI `QIDRSlvlUser201`, all scoped to `AUTO-WL-26092026-QXA` — 59 s |
| IN02 | `IN02_wam` | `ensureWorkAreaMapping` (check → assign → prove after reopen) | CI (with SO 9922846092) / EE / QI on BL01 + BL02, "Assigned successfully", persisted — 42 s |
| IN03 | `IN03_rfi_cycle` | `createAndSubmitCheckpoint`, `approveAsRole` (injectable login) | `RFI-AUTO-WL-26092026-QXA-BL01-CIV-0` on work section **R01-T06** (a section our CSV created), EE ✓, QI ✓ — 1.4 min |
| IN04 | `IN04_nc_cycle` | NCCreatePage / NCResponsePage / NCReviewPage | `NC-AUTO-WL-26092026-QXA-BL02-CIV-0`, Defect Type "Aggregate (Fine and coarse) Gradation Test Failure", CI responded, EE ✓, QI ✓ — 2.1 min |

**Users are per DRS project,** created once and reused: a person appears in a
WAM row only if the row's Work Location is on their profile, and each DRS
project brings a fresh Work Location.

**What the first run proves end to end:** a project, Work Location, Work Areas,
Work Sections, vendor, Service Order and v1 SO mapping all created in DRS reach
Pulse usable — the CI's WAM Service Order filter finds the DRS SO, the RFI form
offers the v1 Piling checkpoint and our imported Work Sections, and the NC form
resolves our DRS vendor on our Work Area.

**Full suite on the matrix project `AUTO-Solar-26092026-FQQ`, pulse-uat
2026-09-26 (22.7 min):** IN01–IN04 green again (users `CIDRSxthUser202` /
`EEDRSkoxUser202` / `QIDRSfgyUser202`; RFI landed on section **R15-T01**, which
only exists in the 300-per-area import). Matrices partial:

| Matrix | Done | Failed | Failure shape |
|---|---|---|---|
| IN05 RFI 9-TC (BL03) | 4 (TC-01, 02, 04, 05) | 5 | 4 × "not in Pending with me" (TC-03/06/08 CI resubmit, TC-09 QI) + TC-07 Proceed no-op |
| IN06 NC 4-TC (BL05) | 1 (TC-01) | 3 | 3 × next actor's row lookup timed out (TC-02/04 EE, TC-03 QI) |

**✅ RFI matrix 9/9 on the DRS project (2026-09-26, 19.9 min, 3 rounds, 0
failed)** once the fixes below were in.

**✅ NC matrix 4/4 on the DRS project** (4 rounds, 7.8 min, 0 failed) after the
layout fix below.

**Baseline on the OLD ground, same day (app owner's request):** spec 21 (RFI
single-session regression, `.env` CI/EE/QI) on **A-06c / BL01, pulse-uat**, after
mapping the `.env` EE *Jay Kishan Suthar* and QI *Udit Sharma* on A-06c
BL01–BL10 with `06_wam.spec.js`: **9/9 done, 0 failed** (3 rounds, 17.3 min),
with the same occasional 9–11 s list catch-up. So the DRS-created project
behaves exactly like the long-established one — nothing about the newly synced
work region or its users' sessions is different.

### IN07–IN14 — the remaining feature specs, unchanged, on DRS ground

App owner, 2026-09-26: "add all". Every `tests/specs/` feature spec that was
never promoted to smoke now also runs on the DRS project. No logic is copied:

- The spec's tests moved into `tests/specs/NN_name.body.js`, and
  `NN_name.spec.js` is a stub that `require`s it. Playwright refuses to let
  one test file import another, and `--project=integration` hides that error
  because it loads only one folder. So `chromium` runs of the originals are
  unchanged.
- `tests/integration/spec-on-drs.js`, `specOnDrs({ roles, ground, wam })`,
  points the body at the DRS project before loading it. It sets:
  - `RECON_PROFILE` to the DRS smoke profile
  - `CI_/EE_/QI_EMAIL` and `_PASSWORD` to the DRS users (`ROLE_CREDENTIALS`
    in `helpers.js` now reads these at login, not at load)
  - `SPEC_WORK_LOCATION` / `SPEC_WORK_AREA` / `SPEC_NC_VENDOR`
  These values apply only while the body loads (inside `runSpecBody`) and
  from `beforeAll` to `afterAll`. They are restored after each, so they never
  leak into another file, not even in the runner, which loads every project's
  files in one process. It also maps WAM on that ground in `beforeAll`. `runSpecBody` evicts the body from require's cache first, so a
  bare `playwright test --list`, which loads every project in one process,
  registers the tests in both projects.

| Stage | Runs spec | Ground | First run, pulse-uat 2026-09-27 |
|---|---|---|---|
| IN07 | 33 negative authorisation | profile only | ✅ 7/7 (2.5 min) |
| IN08 | 34 RFI attachments | profile only (BL11) | ✅ 4/4 (1.5 min), `…FQQ-BL11-CIV-97` photo reached EE and QI |
| IN09 | 35 RFI↔NC linkage | profile only (BL06) | ✅ 4/4 (4.3 min) after fixes on 2026-09-27: CI opens the RFI and Proceed works, **Submit refused** while linked NC `…BL06-CIV-32` is open (app owner: "should be opened, and validation triggers on submission", same as spec 36). Two defects in spec 35's own reject step had let a reject complete with NO linked NC: the standalone NC form's locators never matched the panel (which also sat below the viewport, seen live by the app owner), and it submitted as a page-1 reject. Test 3 now uses spec 36's proven `rejectWithLinkedNcs`, and test 4 first proves the linked NC exists by its unique description |
| IN10 | 36 linked-NC lifecycle | BL08, CI/EE/QI mapped | ✅ 8/8 on BL08 (6.1 min); on BL02 ✗ at step 1 (see below) |
| IN11 | 37 linked NC, multiple | BL08 | ✅ 7/7 on BL08 (9.9 min) |
| IN12 | 38 linked NC, reject rounds | BL08 | ✅ 7/7 on BL08 (11.4 min) |
| IN13 | 32 NC draft autosave | BL05, QI, DRS vendor | 9 skipped: spec 32 is `describe.fixme` (NC draft broken in the app since 2026-09-05) |
| IN14 | 39 NC bulk create | BL05, QI, DRS vendor | ✅ 4/4 NCs at v1, 4 distinct Defect Types (2.0 min) |

**BL02 is missing from the CI's RFI create form (open question for the app
owner).** The CI (`CIDRSwzzUser203`, mapped on BL02 in WAM with the DRS SO,
persisted after reopen) is offered BL01 and BL03–BL13 in the Work Area
dropdown, but not BL02. This was the same across three runs about 45 min apart.
- BL02 is pinned to v1 like the rest, and the SO configuration maps all four
  Piling activities onto it.
- Open NCs don't explain it: BL05 and BL06 hold open NCs and are offered.

BL02 is where IN04's NC cycle ran. IN10–IN12 were moved to BL08 so they can
still run.

**Not added: reassignment, specs 40–49.** Their record pool needs ground the
DRS project does not have yet: a second Work Location and vendor, a wind Work
Location and an Electrical package. That means extending the DRS setup first.

**ROOT CAUSE of "listed but cannot be opened" (found by ROW_DIAG, 2026-09-26):**
`RFIListPage` / `NCListPage.openRowByCode` chose desktop-vs-mobile with
`hasGrid()` — a single immediate `isVisible()` (which never polls). Right after
a navigation or reload the desktop grid was not painted yet, so the lookup took
the MOBILE card branch on desktop and waited 15 s for a card that never exists
there. Every diagnostic showed the row present and visible with the grid never
scrolled. Both page objects now use `layoutFor(code)`, which races "grid
visible" against "this record's card visible" and takes whichever appears.

**Resolution (app owner, 2026-09-26):**
- **"Listed but cannot be opened" is NOT an app bug.** The app owner could not
  reproduce it by hand and traced it to our automation: the task grid has a
  horizontal slider users drag to reach the Actions column's eye icon, while
  `RFIListPage` / `NCListPage.openRowByCode` wrote `scrollLeft` in code.
  Both now scroll with real horizontal wheel input over the grid, step by step,
  with the code-level scroll kept only as a logged `[observe] SCROLL_FALLBACK`.
- **"Work Section cleared on resubmit" is ALSO ours.** The app owner could not
  reproduce it by hand, and the evidence explains it: the resubmit form's
  summary boxes load late and read "0 / 288" for a moment; the engine took that
  as "cleared" and re-selected the RFI's section — and a click on an
  already-chosen option of that multi-select REMOVES it, emptying the field so
  Proceed silently did nothing (TC-07, then TC-02 on `…CIV-32`). TC-05 proved
  it: its screenshot still showed the chip `R03-T11` after our engine had
  declared the section cleared. `smoke-rfi-turns` now decides from the FIELD's
  own count (`RFICreatePage.readWorkSectionFieldCount`, label "Work Section -
  (N)", waited up to 10 s), re-selects only a genuinely empty field on an
  editable page, and logs an empty field on a locked page as
  `[observe] WS_EMPTY_ON_LOCKED_PAGE` instead of clicking.
  Correction the same day: the label uses an **en dash** ("Work Section –
  (1)"), and the first version of the reader only matched a hyphen, so it read
  every field as 0 and re-created the very deselect trap it was written to
  stop. Fixed (any dash), and `RFICreatePage.selectWorkSection` now refuses to
  click an option that is already `data-state="checked"` (`[observe]
  WS_ALREADY_SELECTED`), so a re-select can never deselect, whatever any reader
  says.
- **Slow lists are measured, not failed:** a record can take > 30 s to become
  usable in the next actor's list on pulse-uat (ROW_DIAG caught one visible just
  after two 15 s looks). The navs now retry with reloads for up to ~90 s and log
  `found after Ns`.
- The ID column is resized by dragging its header edge when a long code is
  truncated (`ID_COLUMN_WIDENED`), and the grid is scrolled by dragging its
  horizontal scrollbar, then the wheel (`SCROLL_WHEEL`), then code
  (`SCROLL_FALLBACK`). Live so far the scrollbar drag has not moved the grid
  and the wheel has done the scrolling — the drag's target point needs a look.
- `rfi-nav` / `nc-nav` still reload once on a slow list (`[observe] ROW_LATE`)
  and dump the grid state (`ROW_DIAG`) if a row stays unusable.

**Diagnosis so far:**
- The 7 "not visible" failures are **ours, not the app's**: every saved HTML
  dump shows the RFI/NC present in that actor's grid, column 1, exact code. The
  lookup's `row.waitFor(visible, 15 s)` ran before the row was usable, and in the
  RFI matrix they alternate — the lookup right after a successful resubmit fails,
  the one after a failure (whose recovery reloads) works. To fix in the list
  lookup (reload-and-retry), then rerun both matrices with `SMOKE_RESET=1`.
- The DRS side held throughout: every created RFI/NC used DRS ground, Pulse
  offered exactly the **288 TABLE** sections for Piling - MMS (Min Unit filtering
  of our import), and no step failed for a data reason.
- **TC-07 — possible app issue, not yet reproducible on demand:** after an EE
  **page-1 reject**, the CI's resubmit form showed the Work Section **empty**
  (red, required; summary "Selected 0 / Pending 288"), re-selecting the original
  section `R01-T07` did not stick, and Proceed silently did nothing. TC-02 took
  the same page-1 reject in the same run and KEPT its section. smoke-rfi-turns
  records this as a suspected role-hopping side-effect, but this run used one
  session per role and it still happened — pointing at the app. A focused probe
  (create → EE P1 reject → CI resubmit, ×N) is needed before reporting it.

---

## Phase 1 as built — `npm run drs:setup`

`tests/drs/setup/`, run serially by the `drs` Playwright project (never by
`chromium`). Each file is idempotent: a rerun finds what exists and creates
nothing twice.

| Stage | File | What it does | Server call (measured) |
|---|---|---|---|
| D1–D3 | `D01_masters` | Vendor `AUTOMATION SERVICE CONTRACTOR` (find-or-create once), SPV `VIJESPV` (verify), Site `Rajasthan → AUTOMATION SITE` (find-or-create once) | vendor: **User Management** (create request not yet observed) · `POST /locations-configurator` 201 |
| D4–D5 | `D02_project_and_tree` | New project `AUTO-Solar-<ddmmyyyy>-<AAA>`; CSV import of `AUTO-WL-<tag>` → BL01..BLnn + Culvert/Drain/Road → Work Sections (all 5 types) | `POST /projects` 201 · `POST /locations-configurator/bulk-import` 200 `{created:60}` |
| D6 | `D03_pin_catalog_version` | Pin every imported Work Area to **v1** (imports get none, app owner) | `PATCH /locations-configurator/{id}` 200 ×5 |
| D7 | `D04_service_order` | Manual SO `99xxxxxxxx`, vendor by code, **Advanced Header Vendor Code + Name** (app owner: they label the SO in SO Configuration), one line | `POST /service-orders/soCreation` 201 · `PATCH` 200 |
| D8 | `D05_so_configuration` | v1 · Civil: the 4 **Piling** activities × BL Work Areas → our SO | `POST /service-order-blocks/bulk-assign` 200 |
| D9 | `D06_so_line_mapping` | *Optional (app owner: needed for WMC only, not for Pulse).* SO line → the 4 Piling sub-activities | `PATCH /service-orders/{id}` 200 |

**A project is ready for Pulse after D8.** D9 is kept because it is cheap and
WMC work will need it.

State: `tests/fixtures/drs/drs-setup.json` (per DRS env). Env: `DRS_ENV=uat|dev`
(`npm run drs:setup` / `drs:setup:dev`). Dumps: `drs-explore/stage-*` (gitignored).
Knobs: `DRS_WORK_AREAS` (BL count per import, default 2 — to be raised, see §5).

**First full run, drs-uat 2026-09-26:** project `AUTO-Solar-26092026-QXA`
(`ce779d73-3949-47a3-b6be-a0e58621c786`), Work Location `AUTO-WL-26092026-QXA`
with BL01, BL02, Culvert-01, Drain-01, Road-01 (all v1), SO `9922846092` —
vendor `997248 — AUTOMATION SERVICE CONTRACTOR`.

**✅ Sync confirmed in pulse-uat (app owner, 2026-09-26),** in the Pulse
admin's dashboard Filter: Cluster `Rajasthan` → Site `AUTOMATION SITE` →
Project Type `SOLAR` → Package `Civil` → **Project Name**
`AUTO-Solar-26092026-QXA` → **Select Contractor** `AUTOMATION SERVICE
CONTRACTOR` → Work Location `AUTO-WL-26092026-QXA` → Work Areas BL01, BL02,
Culvert-01, Drain-01, Road-01. So the pairing drs-uat → pulse-uat holds, and the
project, vendor and whole tree all arrive. (Pulse's filter has Project Name and
Contractor levels that the existing Pulse suites never used.)

**Changes after the first run (app owner, 2026-09-26):**
- **~300 Work Sections in EACH BL Work Area** (288 TABLE `R01..R24-T01..T12` +
  12 INVERTER), because RFI permanently consumes sections. `DRS_SECTIONS_PER_AREA`
  overrides it; 13 BL × 300 = a ~3.9k-row import, so its preview/commit waits
  are long (4 / 10 min).
- **Pinning has no multi-select** (tree Ctrl/Shift-click selects one; checked
  live, round 5). But after Save the pane stays usable, so D6 now pins every
  Work Area in ONE page load (click → version → Save → next) and reloads once
  at the end to prove the badges.
- **⚠ A catalog version, once set, cannot be changed** — the field's own
  placeholder: *"Leave empty to decide later — once set, it cannot be
  changed"*. A pin is irreversible; the picker verifies the value before Save.
- `AUTO-Solar-26092026-JKX` (13 BL × 12 sections, stopped mid-pin when the
  design changed) is marked `abandoned` in the state file and is never resumed.

**The matrix project, drs-uat 2026-09-26:** `AUTO-Solar-26092026-FQQ`
(`6edf3b67-097d-4fc4-9108-d8edb346374f`), Work Location `AUTO-WL-26092026-FQQ`,
**BL01–BL13 × 300 sections** + Culvert/Drain/Road-01 (import `{created:3947}`),
all 16 pinned to v1 in one page load (54 s), SO `9925277020`, Piling × 13 BL =
52 SO Configuration cells (`bulk-assign` 200), line → 4 Piling sub-activities.
Ground in Pulse: BL01/BL02 single cycles, BL03+BL04 RFI matrix, BL05 NC matrix,
BL06–BL13 free.
- One-page-load pinning needed a guard: after a save, clicking the next Work
  Area can merely EXPAND it (300 children) while the pane still shows the
  previous, now read-only, one. `selectWorkArea()` proves the pane's Name before
  acting, and each pinned area is collapsed (ArrowLeft, double-click fallback).

**Findings while building (all handled in code):**
- Picking the SO's Vendor\* alone stores `VENDOR_CODE: ""` — why the Service
  Orders list shows `NaN`. The Advanced Header Vendor Code/Name fix it.
- Steps 4 and 5 are disabled until an SO exists; a disabled step's URL falls
  back to another step instead of erroring.
- DRS keeps closed listboxes' options in the DOM (0×0). Any "what is already
  selected" read must exclude them — a plain text search once read four options
  as four mapped sub-activities and would have skipped the save. Also: the
  wizard's tab panel is itself an Ark `content` part, so `[data-part="content"]`
  is not a safe exclusion.
- A fully mapped SO line has no "Select Sub Activity" placeholder any more; it
  shows chips (a `<div>` with a text node + a remove button).

Until now every Pulse spec in this repo ran on work regions and projects that
already existed. This feature builds **our own** project and work region
hierarchy in DRS, lets it sync to Pulse, and then runs the **same** Pulse
RFI/NC testing on it. No new Pulse behaviour is being tested. What's new is that
the ground under the tests is created by the suite.

Reference material: the DRS team's repo at
`C:\Users\Vijendra Kumar\Downloads\OneDrive_2026-09-18\DRS Automation Playwright V2`,
especially `docs/DRS-END-TO-END.md` and `testcoverage/service_Order_doc/001-011`.
Where that repo disagrees with what the app owner said, the app owner wins.
Those disagreements are marked **(app owner)** below.

---

## 1. The two phases

| Phase | Suite | Runs against | Output |
|---|---|---|---|
| **1. DRS setup** | `tests/drs/` | DRS, as Super Admin | A project, work region tree and service order, recorded in a state file |
| — gate — | manual | — | You confirm the sync reached Pulse (automatic, **5–20 min**) |
| **2. Pulse integration** | `tests/integration/` | The Pulse env that DRS syncs to | Users + WAM on the new region, then the RFI and NC flows |

**The two phases are separate runs, not one chain.** The sync isn't triggered by
us and takes a variable time, and you check it by hand, so Phase 2 reads what
Phase 1 recorded and never waits inside a test.

**Phase 1 is the priority.** Phase 2 reuses the existing Pulse page objects and
flows almost unchanged, so it's written after the DRS side is explored and
stable.

---

## 2. Systems and URLs

| System | Host | Login | Used for |
|---|---|---|---|
| DRS | `drs-<env>.cfapps.ap11.hana.ondemand.com` | Super Admin | projects, work region, SO, packages, App Settings |
| User Management | `auth-mgmt-<env>.cfapps.ap11.hana.ondemand.com` (opened from the DRS profile menu, in a **new tab**) | **own login page** (email + password; the DRS Super Admin credentials work) | **Vendor Management** (moved here from DRS App Settings on 2026-10-01). Pulse users are still made in Pulse |
| Pulse | `pulse-<env>…` | existing `.env` / smoke users | Phase 2 |

### Environment pairing — explicit, never guessed (app owner)

DRS and Pulse are **not always paired by suffix**:

| DRS | Syncs to Pulse | Notes |
|---|---|---|
| `drs-uat` | `pulse-uat` | the usual pairing today |
| `drs-dev` | `pulse-qa` / `pulse-dev` / `pulse-test` | whichever is connected at the time |

So a run names **both** sides: `DRS_ENV` picks the DRS URL for Phase 1, and
Phase 2 uses the existing `PULSE_ENV`. Phase 2 checks that the state file it
reads was written by a DRS env declared as paired with its `PULSE_ENV`, and
fails with a named error if it wasn't. The DRS team recorded exactly this
failure: DRS was reading a different Pulse instance, every call returned 200,
and nothing synced.

`.env` additions (never in code):

```
DRS_ENV=uat                      # uat | dev
DRS_SUPER_ADMIN_EMAIL=...
DRS_SUPER_ADMIN_PASSWORD=...
# DRS_BASE_URL=...               # optional override; environments.js already reads it
```

---

## 3. Phase 1 — the DRS setup chain

Each step is one serial stage. A stage **finds before it creates**: every
permanent record is looked up by the name the state file holds, and created
only if it's missing.

| # | Stage | Screen | Rule |
|---|---|---|---|
| D1 | **Vendor** (our own service contractor) | **User Management → App Settings → Vendors** (a separate app; was DRS App Settings → Vendor Management until 2026-10-01) | **Find-or-create once**, then reuse the last one created. The new screen has an *Edit vendor* button per row (the old one had none) but still no delete, so never create one per run |
| D2 | **SPV** | App Settings → SPV Master | Same find-or-create-once rule. Any SPV from the dropdown is fine; our own keeps us independent |
| D3 | **Cluster + Site** | App Settings → Locations Configurator | Find-or-create once (see §4). The CSV import does **not** create a Cluster or Site |
| D4 | **Project** | `/projects` → Add Project | **Fresh every run.** Solar · Category and Construction By default to Merchant / EPC. No delete |
| D5 | **Work region tree** | Configuration → 2. Location Configuration → Import CSV | **Fresh every run**, from Work Location down, into the new project (§5) |
| — | ~~WBS Configuration~~ | Configuration → 3a | **Skipped (app owner, 2026-09-26).** 3a pulls SOs from SAP once the SPV and project codes are filled; our flow uses the manual SO (3b) instead |
| D6 | **Pin catalog version** | Configuration → 2 → each Work Area's pane | Imported Work Areas carry no version (app owner); pin each to **v1** |
| D7 | **Service Order** | Configuration → 3b. Create Service Order | Fresh per project. Contractor = the D1 vendor, plus Advanced Header Vendor Code/Name |
| D8 | **SO Configuration** | Configuration → 4. SO Configuration | Version v1 + Package, then map Activity × Work Area → our SO. Piling first (§6). **Ready for Pulse after this** |
| D9 | **SO Line Mapping** *(optional)* | Configuration → 5. SO Line Mapping | SO lines → sub-activities. Needed for WMC only, not Pulse (app owner). Unlocks once the SO has lines |

Every stage records to the state file (§7) as it goes; there is no separate
"record" stage.

### Two ways to build the tree (both valid, app owner)

- **Path A:** build the tree in App Settings → Locations Configurator, then
  **Map existing Work Location / Work Area** from the project's Configuration
  step 2. Nodes mapped in this way show **"Shared, no owning project"**.
- **Path B (chosen for D5):** create the project first, then **Import CSV** or
  Add nodes directly in Configuration step 2.

Path B is the default: it's one screen, one import, and the nodes belong to the
project. Path A becomes a second variant (D5-alt) once D5 is stable, because
both paths reach Pulse (§9).

---

## 4. Cluster and Site — decision

The app owner left this to us: a new cluster, a new site, or an existing site.

**Decision: find-or-create a dedicated automation Site under the existing
`Rajasthan` cluster**, for example `AUTOMATION SITE`, created once in the
Locations Configurator and reused by every run.

- *Why not reuse `Test Site`:* other people's manual tests live there (for
  example `Pulse synce vije` with WL-02..05). A dedicated site keeps our
  hierarchy from mixing with theirs in dashboards and filters.
- *Why not a new cluster:* a cluster is the top of Pulse's WAM and dashboard
  cascades. A known cluster (`Rajasthan` already exists in Pulse) keeps Phase 2's
  first run to one unknown instead of two. A new cluster is a small change later
  if needed.

Everything **from Work Location down is fresh for every project** (app owner).

---

## 5. The work region CSV

Column order is fixed:
`cluster,site,worklocation,workarea,worksection,worksection_type`.

- **Leaf-only rows.** Every row carries the full path to one Work Section; the
  importer creates the ancestors. (DRS repo: a Work Location row plus a Work Area
  row for the same Work Location returns HTTP 500.)
- **All Work Section types** (app owner): `TABLE`, `INVERTER`, `CULVERT`, `DRAIN`,
  `ROAD`. The Pulse RFI form filters Work Sections by the sub-activity's
  **Min Unit** (set in the Packages Configurator), so a region holding every type
  never hits "no work section available", whichever sub-activity a test picks.
- **Unique names per run.** The import is an **upsert by (parent, name)**, so a
  re-run with `WL-05` / `BL-01` would silently update someone's existing nodes.
  Names carry the run tag:
  `AUTO-WL01-<tag>` → `AUTO-BL01-<tag>`, `AUTO-BL02-<tag>`, `Culvert-01`, `Drain-01`,
  `Road-01` → sections as in the app owner's template (`R01-T01..06`, `I01..06`,
  `0-100 … 900-1000`).
- **No blank lines.** The app owner's template has blank lines between blocks;
  the generator never writes them.
- **Size: far bigger than the template (app owner, 2026-09-26).** One Pulse
  spec run needs **5–13 Work Areas**, and RFI permanently consumes the Work
  Sections it lands on, so the app owner's 2-block template runs out almost at
  once. The generator is parameterised on Work Location count × Work Area count
  × sections per type. The final numbers are sized later, from the Pulse
  suites' ground needs (the smoke chain's BL03–BL11 allocation is the reference).
  The first exploratory import can stay small.

---

## 6. Packages, versions and activities

The Packages Configurator (App Settings) owns **all activity management** (app
owner):

```
Package (Civil) → Sub-package (F: Piling (MMS, Inverter, LT Cable Hanger))
  → Activity (F.1 Piling - Inverter) → Sub-activity (F.1.1 Piling - Inverter)
    → Checkpoints (F.1.1.1 Pre Pour Inspection - Pile, … F.1.1.5 Routine Testing)
```

- Work happens in a **draft**; **Lock version** turns it into a numbered version
  (the screen showed `v5 — draft` for Solar).
- **SO Configuration (D7) selects a locked version** against the Work Areas.
- Each sub-activity has a **Min Unit** (e.g. `TABLE`), which decides which Work
  Section types Pulse offers, and a **UOM**.
- The **Checklists Configurator** manages the Pulse checklists that the Packages
  Configurator maps onto checkpoints.

**Phase 1 uses version `v1`** (app owner, 2026-09-26). `v1` keeps every Pulse
package, and everything below it, exactly as Pulse has it, so the existing Pulse
activity and checkpoint knowledge applies unchanged. Higher versions are later
and not a priority; `v4` is still an unlocked **draft** on drs-uat. Phase 1
never creates or locks a version: locking is global to the project type and
would change the ground under everyone. Mapping scope for the first build is the **Piling** activities
(F.1 Inverter, F.2 LT Cable Hanger System, F.3 MMS, and F.4 IDT Civil &
Structural if present), because the existing Pulse RFI specs already know them.

---

## 7. State file

`tests/fixtures/drs/drs-setup.json`, keyed per DRS env like
`last-created-users.json`:

```json
{
  "environments": {
    "uat": {
      "vendor":  { "name": "...", "code": "..." },
      "spv":     { "name": "..." },
      "cluster": "Rajasthan",
      "site":    "AUTOMATION SITE",
      "projects": [
        { "tag": "...", "name": "Solar-26/09/2026-ABC-1", "id": "<uuid>",
          "createdAt": "...", "pairedPulse": ["uat"],
          "workLocation": "AUTO-WL01-...", "workAreas": ["..."],
          "workSections": { "AUTO-BL01-...": ["R01-T01", "..."] },
          "serviceOrder": { "number": "...", "vendor": "..." },
          "packageVersion": "v4", "activities": ["Piling - Inverter", "..."],
          "stagesDone": ["D4", "D5", "D6"] }
      ]
    }
  }
}
```

- **`stagesDone` makes a run resumable.** A rerun continues the newest
  incomplete project rather than creating a second one.
- A stage records its record **the moment the server accepts it**. A create
  that isn't recorded is a permanent orphan that nothing can find again.
- Phase 2 reads the newest **complete** project for its DRS env.

---

## 8. Framework layout

Kept separate from the Pulse specs, per the standing rule.

```
tests/
  drs/                          Phase 1 specs, serial, numbered D01…
    pages/                      DRS page objects (own BasePage; DRS ≠ Pulse DOM)
    utils/                      csv builder, state store, naming, find-or-create
  integration/                  Phase 2 specs, IN01…, reuse tests/pages (Pulse)
  config/drs-environments.js    DRS env map + DRS↔Pulse pairing table
  fixtures/drs/drs-setup.json   state (§7)
```

- **Playwright projects:** `drs-setup` (one project per stage, chained by
  `dependencies` like the smoke chain) and `integration-solar`. Neither is in
  the default `chromium` project, so an ordinary run never touches DRS.
- **npm scripts:** `drs:setup` (`DRS_ENV=uat`), `drs:setup:dev`,
  `integration:uat`, …
- **DRS page objects** start from the DRS team's (`LocationsConfiguratorPage`,
  `AddProjectPage`, `ProjectConfigurationPage`, `UserManagementVendorPage`,
  `SpvMasterPage`), re-measured live before being trusted. Their repo is
  CommonJS with the same Ark UI components as Pulse, so the port is
  straightforward.

---

## 9. Phase 2 — Pulse integration (outline only)

1. **Users** in Pulse's Add User (app owner): a **CI** as a vendor user, with
   the D1 vendor and the D6 SO; an **EE** and a **QI**, all with the new Work
   Location.
2. **WAM**: CI (with the SO), EE and QI onto the new Work Areas. Watch for:
   the CI's WAM Service Order must equal the SO on the work area, otherwise RFI
   creation "succeeds" and the CI sees zero RFIs.
3. **Visibility check**: the new hierarchy appears in the admin dashboard filter
   (app owner). This is the cheapest Pulse-side proof that the sync landed.
4. **RFI flow and NC flow** on the new project/work area, driven by the existing
   flow helpers with the ground swapped for the state file's values.

---

## 10. Traps carried over

| Trap | Source |
|---|---|
| Projects, SOs, vendors and users can't be deleted: everything is permanent | DRS repo |
| Import is an upsert by (parent, name): reused names update other people's nodes | DRS repo |
| Import needs leaf-only rows, or it returns 500 | DRS repo |
| The CSV import doesn't create a Cluster or Site | DRS repo |
| Step 5's sub-activity picker is disabled until step 4 maps an activity | DRS repo |
| Configuration has two Ark UI tab lists; tell them apart by `data-orientation`, never by index | DRS repo |
| A DRS path resolved against the User Management host (or vice versa) lands on the wrong app | DRS repo |
| Sync can silently target the wrong Pulse, with every call returning 200 | DRS repo |
| The CI's WAM SO ≠ the work area's SO gives zero RFIs and no error | DRS repo |
| Work Section types are filtered by the sub-activity's Min Unit | app owner |
| Package versions are global; Phase 1 never locks one | design decision |

---

## 11. To confirm by exploring (before writing specs)

1. Live field list of Add Project (the DRS repo measured 3 sections; the Overview
   screen shows more, such as Status and Location Details).
2. The Create Service Order drawer: is the SO number free-form? Is there a
   uniqueness rule? What are the line item fields?
3. SO Configuration: where the package version is selected, and how Work Area ×
   Activity is picked.
4. Whether Configuration step 2 accepts the CSV with Cluster and Site pre-selected,
   and how it reports success.
5. Whether an SPV needs a DRS project code. (The vendor create form is now in User Management; its request URL is still unobserved.)

Exploration runs as short inspection specs (dump the screen, change nothing),
checked with you after each round.

### Round 1 findings — drs-uat, 2026-09-26 (`tests/drs/inspection/00_drs_explore_round1.spec.js`)

Read-only by force: a network guard aborts every non-GET DRS call except
`/auth/` and `/api/v1/query/`. 20 screens dumped, **0 writes attempted**.

- **Add Project** (`/onboarding/new`): Project Name, **Project Type\***,
  **Project Category\***, **Construction By\***, **SPV\*** (required); SPV
  Project Code, Service Project Code, Material Project Code, Plant Code
  (combobox); optional reporting fields (Bid/Awarded capacity, T.L. Capacity,
  Tender No., MMS Type, PSS Connected, Baseline Start/Finish dates).
  `Cancel` / `Create & Continue`. The comboboxes open from a **"Toggle
  suggestions"** button: clicking the input listed no options.
- **Package catalog versions** (Packages Configurator): `v5 — draft`, `v4`–`v1 —
  locked`. `v1` exists and is locked. Project types: BESS, Infra, PSS, Solar,
  Transmission Line, Wind.
- **⚠ Work Areas carry a catalog version.** SO Configuration's filter row is
  **Work Location · Version · Work Area · Package**, and on the example project
  it reads *"No Work Areas in this Work Location are on the selected catalog
  version. Choose a different version to see them."* So a Work Area is bound to
  a version when it's created or mapped, and SO Configuration only offers the
  Work Areas on the selected version. **Where that binding is set is the key
  open question for round 2**, because our Work Areas must land on `v1`.
- **SO Configuration** has **Single edit / Bulk edit** modes, plus Cancel / Save.
- **Create Service Order (3b)** lists SOs as `<number>` + `<code> · <status>`
  (e.g. `63870011` / `CIV1 · open`), each with **Edit**, plus **Create new
  service order**. The note says *"A valid service order unlocks SO
  Configuration."* SO numbers on the example are 8 digits.
- **Service Orders list** shows `-` for Contractor and `NaN` for Vendor Code on
  the example's manual SOs. That's a possible display defect, or those SOs were
  made without a contractor; to be checked when we create one.
- **SO Line Mapping (5)**: a service-order picker, a Search box and Save; lines
  are edited in place.
- **Location Configuration (2)**: Cluster/Site comboboxes; the toolbar stays
  disabled until they're chosen, **except `Import CSV`, which is enabled
  straight away**. Tree nodes are real ARIA `treeitem`s, and mapped nodes carry
  a `Shared, no owning project` button.
- **Vendor Onboarding Form** (*superseded 2026-10-01 — see Round 6*; was
  `/appSettings/createVendor` on the DRS host, which no longer shows a vendor
  screen): Vendor Name*, Vendor Code*, **GST Number***, Category* (defaults
  to *Service Contractor*), then optional contact/address fields; a single `Save`.
- **SPV Master**: a flat list (41 SPVs, including `VIJESPV`), `Add SPV`, Search.
- **Locations Configurator**: `Rajasthan` holds sites `Baiya`, `Bandha`,
  `Test Site`. No automation site exists yet.

### Round 2 findings — drs-uat, 2026-09-26 (`00_drs_explore_round2.spec.js`)

Explored on **AGEL Hybrid Merchant_292 (Solar)** (`765d49bf-…`, Gujarat →
Khavda → S05b, 69 Work Areas), the app owner's permanent project. 15 screens,
**0 writes attempted**.

- **✅ A Work Area's catalog version is set when the Work Area is created.**
  Location Configuration → Add Work Area has Name\*, **Catalog version
  (optional)** and Project\* (locked to the current project). An existing Work
  Area's pane shows its version read-only, and the tree badges every Work Area
  (`v1`; `v1 ∗` once Cluster and Site are picked, meaning of `∗` still unknown).
  **Open:** the CSV template has no version column, so which version an
  *imported* Work Area gets can only be learned by importing once (a write).
- **Node panes:** Work Location = Name\* + Project (optional, locked); Work Area =
  Name\* + Catalog version + Project\*; Work Section = Name\* + **Type\***
  (e.g. `CABLE`). Each has Cancel / Reset / Save.
- **Toolbar enabling:** Add/Map buttons need Cluster + Site chosen **and** a
  suitable node selected (e.g. Add Work Section is enabled only with a Work
  Area selected). `Import CSV` is always enabled.
- **Import CSV dialog:** "Import Locations from CSV". It states *"Upsert-by-
  (parent, name) semantics. Existing rows are updated; missing rows are
  created. No deletes."*, offers **Download Template**, then **Choose File →
  preview → Commit** (Commit stays disabled until a file is chosen).
- **Location Configuration cascades:** Cluster = Gujarat, Rajasthan; Site under
  Gujarat = Khavda, Ludbay, Mandvi, Mundra.
- **Add Project options:** Project Type = Solar, Wind, PSS, Infra, BESS ·
  Category = Merchant, Captive, EPC, PPA · Construction By = AGEL, EPC · SPV =
  41 values (including `VIJESPV`) · MMS Type = HSAT, Fixed-Tilt · Plant Code =
  `51A1…51P6`.
- **Create Service Order:** a page inside step 3b, not a drawer: **SO Number\***
  (free text), **Vendor\*** (options read `<code> — <Name>`, e.g.
  `270319 — M S Chouhan Infraventures Pvt Ltd`), *Advanced Header Details*
  (collapsed), **Service Order Lines (0)** + **Add Line**, and **"No lines
  added. Header submit alone is allowed."** → `Create Service Order`. Editing an
  existing SO shows the same form with `Save Changes`.
- **✅ SO Configuration is a matrix: rows = Activities of the chosen Package,
  columns = Work Areas, and every cell is an SO picker** (`<SO number> —
  <vendor>`). "Mapping" means choosing which SO covers each Activity × Work Area.
  Filters: Work Location · Version · Work Area (multi, all 69 pre-selected) ·
  Package (Electrical / Civil). Single edit / Bulk edit, Cancel / Save. On `v1`
  this project's cells hold `4810023552 — M S Ch…`.
- **Step lock icons:** on this project **3a (WBS) and 5 (SO Line Mapping) show a
  padlock**, and opening `?step=so_line_mapping` falls back to the Project
  Creation form. Its SOs have 0 lines, so step 5 very likely unlocks only once
  an SO has lines. To confirm when we create one.

---

## Change log

| Date | What |
|---|---|
| 2026-09-26 | Created from the app owner's answers and the DRS team's repo |

### Round 6 findings — drs-uat / auth-mgmt-uat, 2026-10-01 (`00_drs_explore_round6_vendor_in_user_management.spec.js`)

App owner: **Vendor Management is now in User Management, not App Settings.**
Read-only (the write guard is applied to every host, not just DRS's); 0 writes.

- **Where:** the DRS profile (avatar) menu offers *App Setting · User Management ·
  Help · Logout*. *User Management* opens **`auth-mgmt-uat`** in a **new tab**.
  The DRS `/projects` page has no sidebar, so this menu is the only way in.
- **Separate login:** the new tab lands on `/login` (Email, Password, *Log In*,
  *Login with Adani ID*). The DRS Super Admin credentials sign in there and land on
  `/appSettings/users`. DRS' session does not carry over.
- **Vendors:** `/appSettings/vendors` — tabs *Users · Roles · Vendors*, a
  *Search vendors* box, *Add Vendor*, and a Code | Name | GST | Category grid with
  an *Edit vendor* button on every row.
- **Add Vendor dialog:** Code*, Name*, GST Number*, Category (default *Service
  Contractor*), Address Line 1–3, City, State, PIN, Country, Email, Contact Tel No;
  *Cancel* / *Save*.
- **The vendor carried over:** `997248 — AUTOMATION SERVICE CONTRACTOR` is in the
  new list with the same code, so D01 found it and created nothing (3/3 green).
- **Old routes are dead:** `/appSettings/vendors` and `/appSettings/createVendor`
  on the DRS host show no vendor UI.
- **Open:** the *create* request (URL and status) has not been observed — it needs
  a real create. D01's `createVendor` matches any POST mentioning "vendor" and then
  proves the vendor by finding it in the list. **drs-dev's User Management host
  (`auth-mgmt-dev`) is assumed, not verified.** Whether a vendor created here reaches
  DRS' Service Order vendor picker immediately, or after a sync delay, is unknown.

### Round 7 findings — catalog version labels, 2026-10-01

- **The catalog version dropdowns are scoped now.** A catalog version belongs to a
  project type **plus a site scope** (full explanation in
  `tests/drs-setting/README.md` and `RUNBOOK.md`). Where D6/D8
  used to pick plain `v1`, DRS lists **`All sites v4 / v3 / v2 / v1`**, because
  `AUTOMATION SITE` has no catalog of its own and falls back to the type-wide
  *All sites* ones. App owner: **pin `All sites v1`**. `drs-data.js` now has
  `catalogOptionLabel: 'All sites v1'` beside `catalogVersion: 'v1'` (the tree badge
  still reads `v1`).
- **SO Configuration's Version box is a search field** holding the current value
  (`All sites v4`) and filtering its list by it, so D8 clears it before picking.
- **The pane snaps back after a save.** Right after one Work Area's pin, the
  right-hand pane returns to *that* Work Area, so the next pick landed on an
  already-pinned one and Save stayed disabled (CPW and TGB, 2026-10-01; the tester's
  report: "Culvert is not selected"). `pinWorkAreaVersion` now confirms the pane
  shows the target and Save is live before pressing it, retries, and settles after
  each save; `selectWorkArea` has five ways in and logs which one worked.
- **Earlier projects have lost their work trees.** LPW, RIE, FQQ and QXA now show
  *"No work locations mapped to this project yet"* in DRS. Not investigated; it
  affects any suite that expects those projects' ground (the integration suites use
  the project recorded in `drs-setup.json`).
- **Running the whole setup again creates a new project.** D02 resumes only a project
  that has not finished **D5**. `npm run drs:setup` runs every stage, so re-running
  it to retry D6+ starts another permanent project (this happened twice on
  2026-10-01 — CPW and TGB — and a file argument added to `npm run drs:setup` is
  *added to* its `tests/drs/setup` folder, not a replacement). To retry a later
  stage, call `npx playwright test --project=drs <spec files>` by name.
- **Result:** `AUTO-Solar-01102026-TGB` completed D4–D9 (SO `9961144305`). `KRT` (D4–D5,
  nothing pinned) and `CPW` (D4–D5, 4 of 5 Work Areas pinned) are unfinished and stay
  in `drs-setup.json`; `incompleteProject()` would pick one of them up at the next D03.

### Integration suite results — pulse-uat, 2026-10-01

Run against the older, already-synced projects because the fresh one never arrived in Pulse.

- **TGB (the fresh project, D4–D9 done 19:00 IST) did NOT reach pulse-uat.** Pulse's Add User form
  offered only `AUTO-WL-26092026-FQQ` under AUTOMATION SITE, at 19:02, 19:13 and 19:25 (~33 min after the
  work location was created; earlier projects synced the same day). IN01 fails before submitting, so
  no user was created; IN02–IN04 then fail on "CI not recorded". Not retried further — needs the DRS
  team / a manual look at the admin dashboard filter.
- **FQQ (`DRS_PROJECT_TAG=26092026-FQQ`):** IN01 ✓ (users reused), IN02 ✓ 4.0 min (BL01–BL05), IN03 ✓
  2.3 min, IN04 ✓ 3.7 min. IN05/IN06 **fail by design**: the RFI (9/9) and NC (4/4) matrix trackers are
  already complete from 2026-09-26 and the engine refuses a run with nothing pending — rerun with
  `SMOKE_RESET=1` to repeat them (costs Work Sections on BL03–BL05).
- **IN07–IN14 cannot run on FQQ:** the CAD/SAD/PAD smoke users (prefix `CADDRS` …) are recorded for
  profile `drs-solar-28092026-LPW`, and the guard refuses two profiles sharing a prefix. Run them with
  `DRS_PROJECT_TAG=28092026-LPW`.
- **LPW (`DRS_PROJECT_TAG=28092026-LPW`), IN07–IN12 and IN14: 38 passed, 0 failed (50.6 min):**
  IN07 7/7 (negative authorisation, six roles + tier check), IN08 4/4 (photo reaches EE and QI), IN09 4/4,
  IN10 8/8, IN11 7/7 (the plural rule), IN12 7/7 (two reject rounds), IN14 1/1. IN13 skipped by design
  (spec 32 is `describe.fixme`).
- **Default project selection:** with no tag the suite takes the newest project that finished D8 — now the
  unsynced TGB — so every run needs `DRS_PROJECT_TAG` until TGB syncs.
- **Harness note:** a long run started with `run_in_background` can have its wrapper killed at a time limit
  while the Playwright processes keep running; check the log and process list before starting anything else.

### Round 9 findings — SO Configuration filters changed, 2026-10-14 (`00_drs_explore_round9_so_config_filters.spec.js`)

- Nothing is pre-filled any more. The filters cascade **Work Location → Version → Work Area → Package**, then the matrix shows.
- **Version** lists the project's catalog versions (`All sites v5 … v1`). The catalog version is the one pinned per Work Area in D03 (Location Configuration).
- **Work Area is dependent on the Version**: its list stays empty until a Version is chosen, then holds the areas pinned to that version. It is a multi-select (a "Select all" row, one chip per pick, list stays open after a pick).
- **Package** starts empty; the matrix reads "Select at least one Package to view activities" until it is chosen.
- `DrsSoConfigPage.open(projectId, { workLocation, version, workAreas, pkg })` follows that order and throws "not offered under Version …" if a target area is not pinned to the version. D05 passes the run's BL areas. Verified live on AUTO-Solar-14102026-MTQ (8 cells saved, re-read after reload).
- Catalog versions come from the Packages Configurator (`tests/drs-setting`: copy a locked version via New draft, edit, Lock). A site-scoped version (e.g. `Khavda v1`) only shows for projects of that site; our AUTOMATION SITE falls back to `All sites vN`.

### SO Line Mapping: look-alike sub-activities are NOT duplicates (app owner, 2026-10-15)

The "Select Sub Activity" picker lists the sub-activities of **every catalog version pinned on the project**, each labelled `<name> — <type> · <scope> v<n> — <work areas>`. Scope is `All sites` for a type-wide catalog and the site name for a site catalog (`Khavda v1`). So if `All sites v1`, `All sites v2`, `<site> v1` and `<site> v2` are pinned to BL01–BL04, `EA - Piling - MMS` appears four times, each carrying its own version and work areas. They are different sub-activities. D06 therefore maps only the run's own version (`· All sites v1 —`) and compares full labels, never the bare name.
