# Smoke E2E Suite — Framework and Structure

Design document and running record: what the smoke chain is, why each choice was
made, and what is still open.

**Status (2026-09-03): THE SOLAR FLOW MATRIX IS COMPLETE AND GREEN ON pulse-qa.**

| Flow | Desktop | Mobile |
|---|---|---|
| RFI 9-TC | **9/9** (17 min) | **9/9** (22.5 min) |
| NC 4-TC | **4/4** (9.2 min) | **4/4** (9.2 min) | Branch context: `wtg-inclusion-and-mobile-view`.

Measured on pulse-qa, not estimated:

| Stage | Result | Time |
|---|---|---|
| SM01 user creation | passed, batch 62, 4 users @ S05b | 1.1 min |
| SM02 SO mapping | BLOCKED (app bug; solar mapped manually) | - |
| SM03 WAM | passed, CI/CM/EE/QI on BL03-BL06 | 59 s |
| SM05 RFI quick (TC-01) | passed first attempt | 4.0 min |
| SM05 RFI full (9 TC) | **9/9 done** | ~17 min + 7 min to finish the tail |

Wind remains blocked on the SM02 SO Mapping bug, and per the app owner is
setup-only for now (no RFI/NC flow runs) because RFIs already exist on the WTG
work areas.

What the 9-TC pass actually proved, beyond "it ran":

* **The page-1 lock rule, 10/10.** Every P1 rejection left page 1 EDITABLE;
  every P2 rejection left it LOCKED. This is the real behavioural difference
  between TC-02 and TC-03 and the most valuable assertion in the matrix.
* **Resubmit creates a new child id** with the visible code UNCHANGED -
  confirmed by direct read (`code confirmed unchanged`), not by the fallback.
* **Nine distinct work sections** (R01-T02 .. R01-T10) with zero duplicate
  rejections, i.e. the exclusion seeding works.

Built so far — see section 6 for detail:

| Piece | State |
|---|---|
| `flow-tracker.js` + `tracker-utils.js` refactor | done, proven behaviour-neutral against the pre-refactor module (identical API returns, byte-identical JSON) |
| `qa` environment entry | done |
| `SOLAR_E2E` / `WIND_E2E` reprofiled | done |
| `resolveFlowWorkAreas` | done |
| `playwright.config.js` restructure | done |
| `loginFreshUserSession` | done |
| `smoke-tracker.js`, `smoke-rfi-turns.js`, `SM05` 9-TC rewrite | done |
| `SM06` NC, `SM04` hierarchy, `SM08` demap | not started |

---

## 1. What this suite is for

One ordered chain per project type that proves the whole product works end to
end, driven by **users created by the chain itself**:

```
user creation -> SO mapping -> WAM -> RFI 9-TC -> NC 4-TC -> WAM hierarchy -> SO demapping
```

This is deliberately NOT the same thing as `tests/specs/` (the regression tier).
The regression tier is where features get verified and bugs reproduced alongside
manual testing, using the long-standing `.env` CI/EE/QI accounts. It stays
exactly as it is.

## 2. The hard constraint

> Specs 1-31 must keep working, unchanged, and must stay runnable one at a time
> for manual-testing support.

Everything in section 5 (state isolation) and section 4 (ground allocation)
exists to satisfy that one sentence. Any smoke change that makes an existing
spec fail is a design bug, not an acceptable trade.

---

## 3. Stage map

| # | Stage | File | Runs | State |
|---|-------|------|------|-------|
| 1 | User creation | `SM01_user_creation.spec.js` | once per profile, desktop | **exists** |
| 2 | SO mapping | `SM02_so_mapping.spec.js` | once per profile, desktop | **exists** |
| 3 | WAM the new users | `SM03_wam_admin.spec.js` | once per profile, desktop | **exists** |
| 4 | RFI full flow, 9 TC | `SM05_rfi_flow.spec.js` | per viewport | **done** — 9-TC engine, one session per role |
| 5 | NC full flow, 4 TC | `SM06_nc_flow.spec.js` | per viewport | **to write** |
| 6 | WAM hierarchy | `SM04_wam_hierarchy.spec.js` | once per profile, desktop | **to write** (regression twin: spec 18) |
| 7 | SO demapping (update + remove) | `SM08_so_demapping.spec.js` | once per profile, desktop | **to write**, no page-object support yet |

**One prerequisite before stage 5 can be written for wind:** `WIND_E2E.nc` is
`null` because the wind NC create form has never been opened. A cheap recon spec
(`00_inspect_wind_nc_form.spec.js`) captures its real field values first —
decided 2026-09-03, mirroring how wind RFI was built. Wind NC is then
desktop-only, like wind RFI. Solar NC needs no recon: `NC_DATA` holds proven
values, though its activity (`Piling - Robotic Docking System`) has only ever
been driven on `A-06c` and moves to `S05b` here.

Two structural corrections to `playwright.config.js`, both now **applied**:

- **`SM04` is in the wrong bucket.** It sits in `SMOKE_SETUP_STAGES`, so it would
  run *before* the flows, and because every flow stage depends on the setup
  tail, each flow run would replay it. Hierarchy mapping belongs **after** the
  flows — move it to `SMOKE_TAIL_STAGES`.
- **`SM08` must be strictly last, and must not touch flow ground.** Demapping
  removes the access the flows need. It runs on a dedicated sacrificial work
  area (section 4) and restores what it removed, so it can never strand the
  chain.

---

## 4. Ground allocation

### 4.1 The three rules that drive it

These are the reasons the allocation looks the way it does. All three are
confirmed app behaviour, not preferences.

**R1 — RFI consumes work sections; NC does not.**
A completed 9-TC RFI pass consumes roughly 9-10 (checkpoint, work section)
pairs. Reruns after flakiness or after a new deployment consume another 10 each
time. NC has no such cost: multiple NCs can be created against identical
details, so NC ground is effectively reusable forever.

**R2 — a non-approved NC blocks RFI on the same details.**
If an NC exists in a non-approved state for a given (inspection checkpoint,
work section), the CI user **cannot create or resubmit an RFI** for those same
details. So a half-finished NC cycle — exactly what a bug leaves behind —
permanently blocks RFI creation on that ground. **This is why NC must have its
own work areas, disjoint from the RFI areas.** It is not about consumption.

**R3 — WAM's CI and QI rows are single-assignee.**
`WAMPage.js:500-504`: *"which are single-assignee — one pick simply replaces
whoever was there"* (Quality Inspector / Contractor Incharge). So WAMing a
freshly-created smoke CI onto a work area **evicts whoever held that row**. If
smoke WAMs its CI onto a work area the regression uses, the regression's CI
loses access and those specs fail with "work area not visible" until re-WAMed.

R3 is the one that decides the solar band, and it is a different mechanism from
R1/R2 — worth flagging because it is easy to miss.

### 4.2 Solar — Work Location `S05b`

Confirmed by the app owner: every `BL{nn}` area supports the solar activities
and returns a usable Work Section list. Only `Road*` and `Drain*` areas fail to
show work sections. So no recon is needed on area suitability. Screenshot
evidence: `S05b / BL01 / Piling - MMS / Pre Pour Inspection - Pile` reports
**Total 264 / Selected 0 / Pending 264**.

**What is already claimed inside S05b:**

| Area | Claimed by |
|------|-----------|
| `BL01` | [02_rfi_ci.spec.js:16](../tests/specs/02_rfi_ci.spec.js#L16) |
| `BL02` | [rfi-flow-turns.js:105-106](../tests/utils/rfi-flow-turns.js#L105-L106) — the tracked 9-TC regression, i.e. specs 08/09/10, 21, 23, 24 |
| `BL03`+ | free |

`BL09`/`BL10` (the dependency specs) and `BL03` (`03_rfi_bulk_create`) are all
on **`A-06c`**, not S05b, so they do not collide.

**Allocation — DECIDED 2026-09-03.** The originally requested layout was
`BL01`/`BL02`/`BL03`; it was shifted two areas up for the reason below.

| Stage | Work area | Why |
|---|---|---|
| RFI desktop, 9 TC | `BL03` | own area; ~264 sections ≈ 26 passes |
| RFI mobile, 9 TC | `BL04` | own area, so a rerun of one viewport never eats the other's sections (R1) |
| NC desktop, 4 TC | `BL05` | disjoint from all RFI ground (R2) |
| NC mobile, 4 TC | `BL05` | shared with NC desktop — NC does not consume, and duplicate NCs are legal |
| SO demap sacrificial | `BL06` | mapped by SM02 so there is something to demap; never used by a flow |

**Why shifted, and not `BL01`-`BL03`:** by R3, WAMing the smoke CI/QI onto
`BL01` and `BL02` evicts the `.env` CI/QI from exactly the two areas that specs
02, 08, 09, 10, 21, 23 and 24 depend on. That silently breaks seven specs —
arriving by a route that work-section arithmetic does not cover. Shifting two
places up keeps the intended structure (own area per flow per viewport, all
inside S05b) and removes the eviction entirely. The rejected alternative was to
stay on `BL01`/`BL02` and re-WAM the `.env` users after every smoke run.

NC desktop and NC mobile deliberately **share** `BL05`: NC consumes no work
sections and duplicate NCs against identical details are legal, so a second area
would buy nothing. `BL05` being disjoint from `BL03`/`BL04` is what matters (R2).

### 4.3 Wind — Work Location `WTG-Khavda`

Wind's constraint is the inverse of solar's: **exactly one Work Section per Work
Area, named after the area**, consumed permanently per checkpoint. So wind buys
capacity by adding *areas*, which is what the 21-area SO mapping in the attached
screenshot does.

**Service Order — DECIDED 2026-09-03: `5710008038 - BAUER ENGINEERING INDIA PVT
LTD`**, matching what the SO Mapping screen currently shows on the mapped rows.
This supersedes the `5710012136` recorded in `WIND_E2E.vendor.serviceOrder`,
which must be updated. The full `"<number> - <NAME>"` string is still mandatory:
BAUER appears under five different SO numbers, and a vendor-name-only match
resolves to the wrong one.

**Pool — DECIDED 2026-09-03: the 21 `WTG 4xx` areas REPLACE the current
`KH 34 … KH 61` set.** The KH areas are partly exhausted (KH 34 spent, several
partly used), and a clean pool is what makes the one-area-per-TC allocation
legible. Verbatim from the screenshot — note the space in every name:

```
WTG 423 424 425 426 427 428 429 430 431 432 433
WTG 448 449 450 451 452 453 454 455 456 457
```

| Purpose | Areas | Count |
|---|---|---|
| RFI desktop, 9 TC — **one area per TC** | `WTG 423` … `WTG 433` | 11 (9 + 2 spare) |
| NC desktop, 4 TC | `WTG 448` … `WTG 455` | 8 |
| Spare | `WTG 456` | 1 |
| SO demap sacrificial | `WTG 457` | 1 |

**One area per TC is the point, not just capacity.** Wind enforces the
preceding-checkpoint dependency, so within a single area checkpoint N+1 is
blocked until N is approved. Nine TCs created up front on one area would mostly
sit blocked. Nine TCs on nine *different* areas all sit at checkpoint `A1.18.1`
and run cleanly. Every TC ends in a QI approval, so a completed pass leaves all
nine areas advanced by exactly one checkpoint — the next pass runs on
`A1.18.2`, and so on. With 5 Crane Pad checkpoints that is ~5 clean passes
before re-provisioning, and re-provisioning is one line plus a rerun of SM02/SM03.

A resubmit re-selects the *same* work section, so reject-and-resubmit TCs cost
no extra pairs. (Worth confirming on the first live pass rather than assuming.)

The RFI and NC pools are disjoint for R2: on wind, work section == work area, so
one unfinished NC would otherwise block RFI on that whole area.

### 4.4 Viewport coverage

| Project type | RFI | NC |
|---|---|---|
| Solar | desktop **and** mobile | desktop **and** mobile |
| Wind | **desktop only** | **desktop only** |

Mobile is covered once, on solar, because solar can absorb unlimited reruns —
debugging mobile layout on wind spends irreplaceable checkpoints on problems
that have nothing to do with wind. Wind's job is the second *project type* in
desktop, which is what proves the flow is not solar-specific.

This makes the viewport list **per-profile** rather than a global cross-product,
which is a change to `SMOKE_VIEWPORTS` handling in the config.

---

## 5. State isolation — how smoke and regression stop colliding

### 5.1 The four pieces of shared state

| State | Risk | Resolution |
|---|---|---|
| `fixtures/rfi-tracker.json` | **high** — one hardcoded path ([tracker-utils.js:7](../tests/utils/tracker-utils.js#L7)), owned by 08/09/10/21 + `reset:rfi-tracker` | per-chain files, section 5.2 |
| `fixtures/nc-tracker.json` | **high** — same shape ([nc-tracker-utils.js:8](../tests/utils/nc-tracker-utils.js#L8)), owned by 15/16/17/22 | per-chain files, section 5.2 |
| `.env` `CI_EMAIL`/`EE_EMAIL`/`QI_EMAIL` | **high** — `loginAsRole` silently logs in the *regression* user | smoke never calls `loginAsRole`; only `loginAsFlowUser` with recorded users |
| `fixtures/last-created-users.json` | low — keyed by prefix, and prefixes differ (`CISL`/`CIWTG` vs `CIC`) | leave as is; the existing `profileKey` guard stays |
| `fixtures/user-creation-counter.json` | none — monotonic counter, harmless to share | leave as is |

### 5.2 Tracker isolation: one implementation, N state files

`tracker-utils.js` and `nc-tracker-utils.js` gain a factory:

```
createTracker({ path, seed })  ->  { load, save, reset, getPendingStepsForActor,
                                     setId, setCode, advanceStep, markFailed, ... }
```

The existing module-level exports are then **rebuilt from that factory** with
today's path and seed. Same export names, same signatures, identical behaviour
for specs 08/09/10, 15/16/17, 21, 22 and both reset scripts. Additive only.

Smoke calls the same factory with its own path, keyed by
**(flow × profile × viewport)**:

```
tests/fixtures/smoke/rfi-tracker.solar-e2e.desktop.json
tests/fixtures/smoke/rfi-tracker.solar-e2e.mobile.json
tests/fixtures/smoke/rfi-tracker.wind-e2e.desktop.json
tests/fixtures/smoke/nc-tracker.solar-e2e.desktop.json
tests/fixtures/smoke/nc-tracker.solar-e2e.mobile.json
tests/fixtures/smoke/nc-tracker.wind-e2e.desktop.json
```

Six files, each independently resettable. Per-viewport matters: desktop and
mobile are separate Playwright projects on separate work areas, so a shared file
would make the mobile run resume the desktop run's half-finished TCs against the
wrong area.

**Rejected alternatives.** A full replica of `tracker-utils.js` would duplicate
the hard-won semantics (`setRfiId` deliberately not advancing the step,
resubmit-creates-a-new-child-id, the rfiCode-reset rule) and let them drift — every
one of those comments encodes a bug already paid for. An `RFI_TRACKER_PATH` env
override is one line but ambient: forget to set it once and smoke overwrites the
regression tracker, which is the precise failure this section exists to prevent.

### 5.3 The 9-TC and 4-TC definitions are shared, the state is not

`SEED_TRACKER` in both tracker modules is **pure data evaluated at module
scope** — the only module-level side effect is a `path.join`, and nothing reads
the file until `load()` is called. So smoke can **import the seeds** and get one
source of truth for the 9 RFI TCs and the 4 NC TCs while writing to its own
state files. The TC matrices do not get copied.

For reference, the matrices as they stand:

- **RFI, 9 TC** — happy path; EE-reject from P1 and from P2; QI-reject from P1
  and from P2; and the four double-reject combinations. The P1/P2 distinction is
  the real behavioural rule: rejected from page 1 → page 1 editable on resubmit;
  rejected from the checklist → page 1 locked.
- **NC, 4 TC** — single reject mechanism (no P1/P2 split), so: happy path,
  EE-reject, QI-reject, and EE-then-QI reject. Every TC starts with a CI
  `respond` step; QI's creation happens before the step list.

---

## 6. Code architecture

### 6.1 Untouched

- Every spec in `tests/specs/` and `tests/online-roles/` (1-31).
- `rfi-flow-turns.js`, `nc-flow-turns.js` — the regression's turn drivers. They
  are welded to `loginAsRole` (.env users) and to hardcoded `RFI_DATA`/`NC_DATA`.
  Making those injectable is a *behavioural* refactor of a file spec 21 leans
  on, and the risk is not worth it while smoke is unproven.
- `rfi-dependency-flow.js`'s own drivers, for the same reason.

### 6.2 Changed, additively

- `tracker-utils.js`, `nc-tracker-utils.js` — gain the factory (5.2). Mechanical
  and provable; verified by re-running specs 21 and 22 and inspecting their
  trackers before anything is built on top.
- `tests/config/projects.js` — `SOLAR_E2E` moves to S05b with the new bands and
  its `rfi.workLocation` changes from `A-06c` to `S05b`; `WIND_E2E` gets the
  21-area pool and its `vendor.serviceOrder` changes to `5710008038 - BAUER
  ENGINEERING INDIA PVT LTD`; `flowWorkAreas` nests per flow
  (`{ rfi: {desktop, mobile}, nc: {desktop, mobile} }`, with a fallback so the
  existing shape still resolves); each profile declares its own `viewports`.
- `playwright.config.js` — per-profile viewports, `SM04` moved to the tail, `SM08`
  appended.
- `SOMappingPage.js` — gains demap methods (6.4).

### 6.3 New

| File | Role |
|---|---|
| `tests/utils/flow-tracker.js` | **DONE** — the shared state machine; `createFlowTracker({ path, seed, idField, codeField, createActor })` |
| `tests/utils/smoke-tracker.js` | **DONE** — smoke's tracker paths, the quick/full seed filter, the no-op guard, the run summary |
| `tests/utils/smoke-rfi-turns.js` | **DONE** — the 9-TC actor turns over the page objects, `loginFreshUserSession` and an injected tracker |
| `tests/utils/smoke-nc-turns.js` | same for the 4 NC TCs |
| `tests/smoke/SM06_nc_flow.spec.js` | stage 5 |
| `tests/smoke/SM04_wam_hierarchy.spec.js` | stage 6 |
| `tests/smoke/SM08_so_demapping.spec.js` | stage 7 |

The page objects are already profile-agnostic and are reused wholesale — that is
the layer that carries the real UI knowledge, and none of it gets duplicated.

### 6.4 SO demapping — what needs confirming

`SOMappingPage.js` has **no** remove/unmap capability today. From the attached
screenshot, each activity's Service Order field carries an **`×`** next to its
chevron, which is presumably "clear this mapping". So:

- **update** = select a different Service Order on the row, Save, re-read.
- **remove** = click `×`, Save, re-read, expect empty.

Both need one live confirmation before being specced — in particular whether `×`
clears immediately (each SO selection already auto-saves via its own POST) and
what an emptied row reads back as.

The stage runs entirely on the sacrificial area and finishes by **restoring** the
original mapping, so it is self-healing and cannot strand the flows.

---

## 6.5 Session model — one login per role, kept alive

**Adopted from [21_rfi_flow_single_session.spec.js](../tests/specs/21_rfi_flow_single_session.spec.js) on the app owner's instruction (2026-09-03), and it is the single biggest saving available.**

The stage logs in as CI, EE and QI exactly once each, **in parallel**, then
round-robins turns between the three live sessions until every TC reaches done or
failed. Versus a login per actor turn — 3-6 minutes of PWA load each, roughly
nine of them per 9-TC pass, serially — wall-clock login cost falls from ~45
minutes to about one login.

This corrects a belief encoded in the previous version of SM05, which drove ONE
page and hopped roles sequentially because "the app is one-session-at-a-time".
Spec 21 has been running three concurrent contexts against this app for a while,
so that was wrong.

It also removes the role hopping the app owner suspects is behind the
partial-RFI-data cookie issue. If the Work Section re-selection branch in
`smoke-rfi-turns.js` stops firing under this model, role hopping was the cause
and that block can be deleted.

**One gotcha this forces:** a context created off `browser` does NOT inherit the
Playwright project's `use` block, so the mobile variants would silently run at
desktop size. The device-shaping fields (`viewport`, `userAgent`,
`deviceScaleFactor`, `isMobile`, `hasTouch`) are carried across explicitly from
`test.info().project.use`.

## 6.6 TC sets — quick and full

`SMOKE_TC_SET=quick` runs **TC-01 only**, which *is* the happy path (create → EE
approve → QI approve). It is not a second code path: the same engine over a
filtered seed. So it adds no runtime to a full pass and nothing to maintain,
while giving a fast "is the app up" check that spends 1 checkpoint instead of 9
on wind.

The TC set is part of the tracker filename, so a quick run cannot leave a 1-TC
tracker that a later full run mistakes for finished.

Runs **resume** by default; `SMOKE_RESET=1` starts a set over. A tracker with
nothing pending is **refused** rather than run as a no-op — `getPendingStepsForActor`
skips done and failed TCs identically, so "nothing pending" would otherwise read
as a pass either way. That exact gap once let a 0/9-passed run report as cleanly
as a 9/9-passed one.

## 7. Playwright project topology

Naming: `smoke-<chain>-<stage>[-<viewport>]`.

```
smoke-solar-users -> smoke-solar-so -> smoke-solar-wam
                                          |
              +---------------------------+---------------------------+
              |            |              |            |             |
        rfi-desktop   rfi-mobile     nc-desktop   nc-mobile    wam-hierarchy -> so-demap
```

**Flow stages depend only on the setup tail, never on each other.** This is
existing, deliberate design ([config:84-95](../playwright.config.js#L84-L95)) and
it is what makes each combination independently re-runnable — the "run as per my
convenience" requirement. If `rfi-mobile` depended on `rfi-desktop`, every
attempt at mobile would replay desktop and burn its ground.

Consequences, both already true today:

- Run smoke with `--workers=1`. The app is one-session-at-a-time, and without
  cross-stage chaining it is the worker cap, not the dependency graph, that stops
  two flow stages overlapping.
- Use `--no-deps` for a single stage once setup has run, to skip the (idempotent
  but slow) setup replay.
- Run one chain at a time. Solar and wind share the Admin account.

The wind chain is identical minus the mobile projects.

---

## 8. Run order

The requested order — wind RFI desktop **after** both solar viewports — is a
run-order requirement, not a dependency. Expressing it as a Playwright
dependency would make every wind run replay the whole solar chain. So it is a
documented sequence (and, if useful, an npm script):

```
1. smoke-solar-users, -so, -wam
2. smoke-solar-rfi-desktop      (9 TC)
3. smoke-solar-rfi-mobile       (9 TC)
4. smoke-solar-nc-desktop       (4 TC)
5. smoke-solar-nc-mobile        (4 TC)
6. smoke-wind-users, -so, -wam
7. smoke-wind-rfi-desktop       (9 TC)
8. smoke-wind-nc-desktop        (4 TC)
9. smoke-solar-wam-hierarchy, smoke-wind-wam-hierarchy
10. smoke-solar-so-demap, smoke-wind-so-demap
```

---

## 9. Runtime budget — rough, and it matters

Logins dominate: the PWA takes 3-6 minutes each, and a tracker-driven 9-TC pass
needs one login per actor turn.

REVISED TWICE on 2026-09-03. First for the one-login-per-role session model
(6.5), then against MEASURED times from the first real QA run.

**The setup stages were overestimated by more than an order of magnitude.** The
original table assumed every login paid the 3-6 minute PWA load. It does not:
Admin is an ONLINE role and logs in in seconds. Only CI/EE/QI are
offline/PWA accounts. Measured on pulse-qa:

| Stage | Estimated | **Measured** |
|---|---|---|
| SM01 users (4 users) | ~1 h for SM01+SM02+SM03 | **1.1 min** |
| SM03 WAM (4 roles x 4 areas) | (same ~1 h) | **59 s** |

So solar provisioning is about **3-4 minutes**, not an hour. Wind will be
slower but only because SM02 does one read-only cascade per area, and it has 21
of them — that is per-area work, not per-login.

The flow-stage estimates below are still UNMEASURED and remain the load-bearing
unknown: they are the stages that pay the real PWA cost, three times in
parallel.


| Stage | Estimate | Note |
|---|---|---|
| SM01 / SM02 / SM03, solar | ~1 h | SM02 does one read-only cascade per area |
| SM01 / SM02 / SM03, wind | ~2-3 h | 21 areas × baseline cascade |
| RFI 9 TC, one viewport | **~45-60 min** | was ~2 h; 3 parallel logins instead of ~9 serial |
| RFI 1 TC (`quick`) | ~20 min | |
| NC 4 TC, one viewport | **~40-50 min** | same saving |
| **Full chain, both project types** | **~6-8 h** | was ~12-16 h |

Two design consequences:

- **The tracker earns its place twice over.** Beyond 9-TC bookkeeping it makes a
  run *resumable*: a stage that dies at hour two picks up where it stopped
  instead of restarting. At these runtimes that is not a nicety.
- Full-chain runs are an overnight/weekend activity. Day-to-day use is
  per-combination with `--no-deps`, which the topology already supports.

One known hazard: SM02's per-area baseline does one full cascade per area, and
its own comment records that the **6th consecutive cascade** is where the Ark UI
Cluster listbox flaked (opening but positioned off-screen). Wind will now do
**21**. The write-once baseline check makes this free on reruns, but the first
wind provisioning run needs either a retry around the cascade or a tolerance for
resuming.

---

## 10. Accepted risks, recorded

- **SM02 overwrites real SO mappings** on every area it touches, including the
  solar smoke band and all 21 wind areas. Mitigated by the existing write-once
  per-area baseline capture in `fixtures/so-mapping-baseline/`, which is the
  difference between restorable and gone. Solar smoke uses the **same CHOUHAN
  Service Order** the regression uses, so remapping Piling rows there is
  effectively idempotent; other activities on those areas do get rewritten.
- **SM03 evicts single-assignee WAM rows** (R3). Contained by keeping the smoke
  band disjoint from regression ground — which is exactly why section 4.2 shifts
  the solar areas.
- **Wind is not indefinitely repeatable.** ~5 clean 9-TC passes before the Crane
  Pad chain is spent across the RFI pool; re-provisioning is a one-line pool
  extension plus a rerun of SM02/SM03.

---

## 11. Decisions and remaining questions

### Settled 2026-09-03

| # | Decision |
|---|---|
| 1 | **Solar band shifted** to `BL03` (RFI desktop) / `BL04` (RFI mobile) / `BL05` (NC, both viewports) / `BL06` (demap), avoiding the R3 WAM eviction on `BL01`/`BL02` |
| 2 | **NC shares one area** across both viewports — deliberate, NC consumes nothing |
| 3 | **Wind Service Order** is `5710008038 - BAUER ENGINEERING INDIA PVT LTD` |
| 4 | **Wind pool** = the 21 `WTG 4xx` areas, **replacing** the `KH ...` set |
| 5 | **Wind NC**: recon the form first, then desktop-only |
| 6 | **Viewports**: solar desktop + mobile; wind desktop only |
| 7 | **Tracker**: injectable path via a factory, seeds imported, six state files |

### Still open

1. **SM02's work location for solar.** `profile.workLocations[0]` currently
   resolves to `A-06c`, so SM02 would SO-map there. The assumption in this doc is
   that smoke maps **S05b only** and leaves `A-06c` — the manual-testing
   ground — completely untouched. Flagging rather than asking, since it follows
   from the S05b decision, but it does mean `workLocations` order or an explicit
   `soMappingWorkLocation` field has to change.
2. **Sacrificial demap areas.** `S05b / BL06` and `WTG 457` are assumed. Only
   matters once SM08 is written.
3. **Wind resubmit cost.** Assumed: a resubmit re-selects the same work section
   and so costs no extra (checkpoint, area) pair. If that is wrong the wind
   arithmetic in 4.3 roughly doubles. Confirm on the first live pass rather than
   by inspection.
4. **The  in SO Mapping** is assumed to be "clear this mapping" (6.4). Needs
   one live confirmation before SM08 is specced.
5. *(none — see "Found and fixed live" below.)*

### Three engine bugs the first live run found, 2026-09-03

All three were mine, not the app's. Recorded because each is the kind of
mistake that looks like an app defect until you look closely.

**1. "First available" work section was never available.**
`selectWorkSection(null)` picks the FIRST option, not the first FREE one. All
nine TCs therefore chose the same section, and since solar's chain has one
checkpoint the walk had nowhere to fall through to and failed every TC
identically.

I initially misread this as an app bug - that the dropdown was offering a
consumed section and the summary was miscounting. **It was not.** The app filters
correctly; what actually happened is that availability does not propagate
instantly after a create. A run starting seconds after an RFI was raised read
`Selected 0 | Pending 264` and was offered the just-used section; a run seven
minutes later read `Selected 1 | Pending 263` with it filtered out.

Fixed two ways, deliberately: the walk now excludes sections the RUN already
used (seeded from the tracker, so consecutive creates never depend on the UI
catching up), AND it parses the server's own rejection to learn about sections
consumed by anything else - other runs, manual testing.

**2. The resubmit code assertion raced the app.** 5 of 9 TCs read back
`...-CIV-DRAFT` because `getVisibleCodeFor` reads once with no retry. Now polls
3x and, if still unfinalized, keeps the original code - valid only because all
five code inputs are unchanged, which is now explicitly guarded rather than
assumed.

**3. THE IMPORTANT ONE: a failed verification desynced the tracker from the app.**
TC-02's resubmit SUCCEEDED and the app moved the RFI to EE, but the code
assertion running afterwards threw - so markFailed fired and the step was never
advanced. The tracker then claimed CI still owed a resubmit while the app had
moved on, and reviving the TC hunted for a row that had correctly left CI's
queue (surfacing as RFI_NOT_VISIBLE_TO_ACTOR, which read exactly like an app
bug).

The rule now encoded everywhere: **advance the step as soon as the ACTION is
confirmed, and report anything discovered afterwards as a soft problem instead
of throwing.** Soft problems still fail the run; they just cannot corrupt the
record of what the app did.

| Turn | Confirmation point | Secondary check |
|---|---|---|
| CI resubmit | new id in the post-submit `/view` URL | code comparison |
| EE/QI approve | `approve()` returning (waits for the confirm popup to close) | queue re-check |
| EE/QI reject | the reject call returning | - |

**Also added:** `SMOKE_RETRY_FAILED=1`, which revives failed TCs in place
(keeping id, code, work section and step index) so a transient failure does not
force a full reset that would re-create all nine RFIs.

### Process rule: TaskStop does not kill a Playwright run

Backgrounding `npx playwright test` and later stopping the task kills only the
SHELL WRAPPER. The `npx -> @playwright/test/cli.js -> workerProcess` tree keeps
running, browsers and all. This caused two full runs to execute concurrently for
~11 minutes against the same tracker file, producing an incoherent
non-contiguous failure pattern that made no sense until the process list was
checked.

Stop a run by killing the matched process tree (`node.exe` whose CommandLine
contains `playwright*test`, then any `chrome.exe` under `ms-playwright` - never
by image name alone), and verify CLEAN before launching. Every launch here now
carries that guard inline.

### SM06 NC: built and green, plus one app behaviour worth knowing

Option C was taken on the NC-separation question (app owner, 2026-09-03):
`nc-tracker-utils.js` is left COMPLETELY UNTOUCHED, so specs 15/16/17, 22 and
`reset:nc-tracker` keep the exact behaviour they have. Only the new smoke code
uses the shared `flow-tracker`. The 4-TC matrix is IMPORTED from
`nc-tracker-utils` rather than copied — `SEED_TRACKER` is pure data and that
module does nothing at load time but a `path.join`, so importing it cannot read
or write the regression tracker.

Results: **NC 4/4 done on solar desktop, 9.2 min, first attempt after the fix
below.** Codes `NC-S05b-BL05-CIV-1` .. `CIV-4`.

**THE UNFINALIZED-CODE PLACEHOLDER IS NOT THE SAME AS RFI'S.** This cost the
first NC run and is the single most useful thing learned here:

| Flow | Placeholder while the code is unfinalized |
|---|---|
| RFI | the literal word `DRAFT` — `RFI-S05b-BL03-CIV-DRAFT` |
| NC | **the last 4 characters of the record's UUID** |

Observed live: id `0c446302-79c5-447e-bf91-cba212ef`**`cb95`** produced code
`NC-S05b-BL05-CIV-`**`cb95`**, whose real value turned out to be
`NC-S05b-BL05-CIV-0`. NC's form is the more dangerous of the two because it
LOOKS like a valid code — a `/draft/i` guard passes it straight through, which is
what happened. The failure then surfaced two steps later as "row not found",
pointing at CI's lookup rather than at the creation that recorded a dead code.

Fixed by validating the code's SHAPE instead: a finalized code ends in its
numeric counter (`/-d+$/`), which catches both placeholder forms and any future
one. The turns also SELF-HEAL — a recorded placeholder is re-read from the id
before the lookup. Without that a TC which recorded the placeholder once could
never recover, since every retry would look up the same dead code; the id is the
one identifier that is immediately reliable, because it comes from the URL.

**Attachment propagation, measured.** Photos are mandatory at creation, response
and review, and the count is EXACTLY 1 at every hop — all 4 TCs, both reject
cycles, and TC-04's two full resubmit rounds. Attachments do NOT accumulate:
each actor sees the previous actor's latest photo only. So `> 0` is the correct
assertion and anything like `>= roundNumber` would be wrong.

**Counters are per-flow.** NC started at `CIV-0` on BL05 while RFI was already at
`CIV-19`. RFI's own counter is shared ACROSS work areas though — BL03 ran
`CIV-0`..`CIV-9` and BL04 continued at `CIV-10`, so it is not per-area either.
See [[reference_rfi_nc_code_composition]] for what actually determines the code.

### Mobile NC: three real bugs, and two wrong diagnoses on the way

Mobile NC had never been exercised before. `NCListPage` was written grid-only,
with a header noting its logic was "applied here preemptively ... not yet
separately re-confirmed live for NC". `RFIListPage` was later made layout-aware;
NC never was. Three genuine fixes came out of it:

1. **The card must be EXPANDED before its Review button is clickable.** The
   button is in the markup of a collapsed card — grepping finds all four — but
   inside a `display:none` ancestor with a 0x0 rect. Measured on the captured
   DOM: `button:has-text("Review")` -> 4, `getByRole(button, Review)` -> 0,
   because hidden elements are not in the accessibility tree. **Presence in the
   DOM is not visibility.** getByRole is therefore the right locator for the
   wait: it cannot resolve to the hidden copy, so the wait genuinely gates on
   the expand.

2. **The card list is VIRTUALIZED.** `div[data-index="N"]` is a virtualizer row
   wrapper; only cards near the viewport exist in the DOM. The desktop grid has
   `scrollToRowByCode` for exactly this and the mobile path had no scrolling, so
   a card outside the initial window read as "this NC is not in my queue".

3. **`waitForLoadState(networkidle)` must be BOUNDED.** A `.catch()` swallows
   the rejection only AFTER the wait runs its course, which on a two-hour test
   timeout means up to two hours. This suite had already been bitten by an
   unbounded networkidle once (the CI-login hang).

Also fixed: `waitForGrid` used `Promise.all` over three 20s races, so the two
losing races always ran to completion — a guaranteed ~20s per call after the
winner was known. `Promise.any` returns on the first success. Nav went 22.5s ->
17.8s.

**Two diagnoses that were wrong, recorded because the reasoning errors are the
reusable part:**

* *"NC needs no expand step"* — inferred from finding the button in the HTML
  without checking whether it was visible.
* *"Pathologically slow, ~24 min/step"* — a 2-hour wall-clock divided by the 5
  logged steps. It is ~30s/step; the run had STALLED, not crawled. Phase timing
  killed this in one 25-minute run, and also cleared the prime suspect:
  `fillResponse` INCLUDING the mandatory photo capture takes 4.6s. `nav`
  dominates at ~18-23s, which is reasonable given it walks My Tasks -> NC tab ->
  Pending with me -> scroll -> expand -> Review every time.

What moved this forward every time was MEASURING, not reasoning: probing the
captured DOM offline with real locators (seconds per iteration, no login) found
the `display:none`; phase timing killed the slowness theory; and reading the
failure dumps' queue contents found the drift below.

### A hard-killed run can desync the tracker from the app

Two TCs could not find their NC after the 2-hour run was killed. The dumps said
why: QI's queue was empty while EE's held the NC the tracker believed was with
QI. `advance-on-confirmed-action` prevents a desync caused by a failing
VERIFICATION, but it cannot prevent one caused by a hard teardown between the
app committing and the tracker writing.

So `SMOKE_RETRY_FAILED` assumes the tracker is merely BEHIND ON A STEP — true
for a clean failure, not for a mid-action kill. Recovery differs by flow, and the
cheap option is not the same one:

| Flow | Recovery after a mid-action kill | Why |
|---|---|---|
| NC | **reset** | creation is free — no work sections consumed, duplicate NCs legal |
| RFI | **repair** | every create spends a (checkpoint, work section) pair |

A stranded NC is harmless on NC-only ground: BL05 is disjoint from the RFI areas,
so rule R2 blocks nothing.

### BLOCKED: SM02 (SO mapping) — app-side bug, 2026-09-03

**SM02 is blocked on an app bug on the SO Mapping screen. Do not treat its
failure as a suite defect, and do not re-run it until the devs ship a fix
(expected 2026-09-04).**

What the first QA run produced:

```
TimeoutError: locator.waitFor: Timeout 3000ms exceeded.
  waiting for locator('text=Select a package and Work Area to see activities.')
  at pages/SOMappingPage.js:37  (SOMappingPage.waitForLoad)
```

Per the app owner: the SO Mapping screen has a bug, and **solar SO mapping for
this band has already been done manually**, so the solar chain does not need
SM02 at all right now. Run the solar stages with `--no-deps` so the chain cannot
try to re-run it.

**Consequence for wind:** the wind chain CANNOT be provisioned until this is
fixed — its whole point is mapping the 21 `WTG 4xx` areas, which is exactly the
screen that is broken. Wind stays blocked; solar proceeds.

**Consequence for the baseline:** because SM02 never completed, no
`solar-e2e-BL03`..`BL06` baseline was captured — but nothing was overwritten
either, so there is no restore source to be missing. The hazard above is
unchanged, not worsened.

**Also worth noting for whoever picks this up:** `waitForLoad()` allows only
3000ms for the empty-state hint. Even once the app bug is fixed, that is a short
budget for this screen on a cold QA deployment, and it is the first thing SM02
does. Whether the timeout is a contributing cause or merely how the app bug
surfaced is not yet established.

### Open hazard: the SO-mapping baseline has the same env-keying gap

**Not yet fixed, and the obvious fix is dangerous — read before touching it.**

`SM02_so_mapping.spec.js` writes a per-area baseline of the pre-change Service
Order state to `fixtures/so-mapping-baseline/`, named
`${profile.key}-${workArea}.json`, and the capture is **write-once**: an area
that already has a baseline is skipped. That guard exists because an earlier
version rewrote the baseline every run, so the second provisioning run replaced
KH 35's genuine original with the post-overwrite all-BAUER state and destroyed
the only restore source (it had to be recovered from commit be83f9b).

The filename has **no environment dimension**, exactly like
`last-created-users.json` did. So a baseline captured on pulse-dev would cause
SM02 to skip capture when pointed at pulse-qa, leaving a file that looks
authoritative and would restore the wrong values.

**No risk today:** no `solar-e2e-BL03`..`BL06` files exist, so the first QA run
captures genuine originals, and the baseline JSON already records `baseUrl`
inside it.

**Why not just add the env to the filename:** the existing
`wind-e2e-KH34.json` … `KH53.json` baselines would stop being found. The next
wind SM02 run would then treat those areas as uncaptured and write a fresh
baseline — *after* the mappings were already overwritten. That is precisely the
destroy-the-restore-source bug the write-once guard was added to prevent, so a
naive rename reintroduces it.

**Safer shape:** keep the filename, and have the write-once check compare the
existing file's recorded `baseUrl` against the current one. On a match, skip as
today. On a mismatch, capture to an env-suffixed filename instead — preserving
the old file and still recording the new environment's true original.

### Found and fixed live, 2026-09-03

**`last-created-users.json` had no environment dimension.** It recorded users by
role PREFIX only, with no note of which deployment they existed on.

Caught the hard way on the very first QA run: SM01 was pointed at pulse-qa, found
four solar users recorded from an earlier pulse-dev/pulse-test batch, decided
they already existed, **skipped all four tests and exited 0**. A completely
clean-looking run that created nothing and left the chain pointing at users the
target deployment had never heard of. Had SM02/SM03 followed, they would have
failed at a dropdown search with nothing readable to explain why.

Fixed in three places:

- SM01 now records `baseUrl` alongside each created user.
- SM01's reuse guard requires the recorded `baseUrl` to match the current one, so
  it re-creates rather than trusting a phantom.
- New `tests/utils/smoke-users.js` `resolveSmokeUsers()` centralises the lookup
  and checks profile AND deployment, with a message naming the failed check and
  the exact command to fix it. SM03 and SM05 both use it, so they cannot drift in
  how strict they are.

Entries recorded before this carry no `baseUrl` and so force one re-creation —
the safe direction: re-creating costs minutes, trusting a phantom user fails much
later and much less legibly.
