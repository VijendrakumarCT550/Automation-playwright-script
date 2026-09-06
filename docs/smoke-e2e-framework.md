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

> **Durable rules, conventions and the decision log live in**
> **[app-owner-decisions-and-conventions.md](app-owner-decisions-and-conventions.md).**
> Read that first: it holds the business rules (code composition, the
> NC-blocks-RFI rule, single-assignee WAM), the environment facts, the working
> conventions, and every dated decision. This doc is the smoke chain's own
> design and running record.

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
blocks RFI creation for that combination. **This is why NC is given work areas
disjoint from the RFI areas.** It is not about consumption.

**R2a — the exact scope of that block (app owner, 2026-09-05).** The wording
above is correct but too coarse, and reading it as "an NC poisons the work
area" overstates the risk badly enough that it produced a wrong warning once.
The block is keyed on the FULL triple:

> **(activity / sub-activity, inspection checkpoint, work section)**

Concretely, in the app owner's own example: an NC raised on work section
`R01-T01` for checkpoint "Pile" of activity "Piling - MMS" means CI cannot
create an RFI for *that* checkpoint + work section. But:
  - CI **can** create an RFI on a DIFFERENT work section for the same
    checkpoint and activity — no issue at all.
  - CI **can** create an RFI on `R01-T01` itself if the ACTIVITY or
    SUB-ACTIVITY differs — a different activity is a different triple.

**Why this makes NC-on-an-RFI-area much less dangerous than R2 alone suggests**
(the app owner's reasoning, and it turns on R1): RFI creation already CONSUMES
its work section, and NC creation picks the FIRST available section — which,
on ground the RFI flow has already run over, is a section RFI has already used
and can never use again anyway. Blocking something already unavailable costs
nothing.

**So the genuinely dangerous case is narrow**, and worth stating exactly
because it is the only one to design around: an NC raised for a (activity,
checkpoint, work section) triple whose RFI has **not been raised yet**, or one
whose RFI **still needs to be resubmitted**. Then, and only then, is CI
actually locked out of work it still had to do.

This is also why the chain orders the RFI flows BEFORE the NC flows: by the
time any NC exists, the RFI work on that ground is already done and approved.

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

**SUPERSEDED by 2026-09-04's work** — SM02 (so) and SM08-as-so-demap are gone
(SO mapping moved to DRS), wind RFI/NC are parked, and SM07/SM08/SM09 were
added to the tail. See §11's dated entries and the run commands below for the
current, actual order.

### 8a. Running everything and getting a result — commands as of 2026-09-04

Four `smoke:*` npm scripts, all solar-only (wind stays out of every one on
purpose — see §11's "wind-first order SUPERSEDED" entry):

| Script | What it runs |
|---|---|
| `npm run smoke:solar` | The SM* chain only: `users → wam → rfi(desktop,mobile) → nc(desktop,mobile) → wam-hierarchy → dependency → data-integrity → draft-autosave` (10 projects). |
| `npm run smoke:full` | `smoke:solar`'s whole chain **plus** all 13 `smoke-feature-*` stages (the `tests/specs/` depth stages — user management, WAM all-roles, reassign, dashboard, hierarchy roles, online-roles/, WAM patch/demap). This is "the whole smoke folder at once." |
| `npm run smoke:solar:artifacts` / `npm run smoke:full:artifacts` | Same two runs, but write JSON + JUnit result files in addition to the HTML report (see below) — use these when you want a file to archive or hand off, not just to watch it run. |

SM02 (SO mapping) is not in any of these — deliberately, not an oversight.
It has no project at all in `playwright.config.js` since SO mapping moved to
DRS (see the dated comment at `SMOKE_SETUP_STAGES` there) — there is no PULSE
screen left for it to drive. The spec file (`SM02_so_mapping.spec.js`) still
exists on disk purely as a record of how the screen used to behave.

**Generating a result at the end:**

- Every run (including plain `smoke:solar`/`smoke:full`, and every existing
  spec 1-31) already writes an **HTML report** to `playwright-report/` — this
  is the config's own default (`playwright.config.js`'s `reporter:` array),
  unrelated to the `:artifacts` scripts. Open it any time after a run with
  `npm run report` (opens `playwright-report/index.html` in the browser) —
  filterable pass/fail list, screenshots and traces per failure, the same
  report format used everywhere else in this repo.
- The `:artifacts` scripts additionally write **`smoke-reports/results.json`**
  and **`smoke-reports/junit.xml`** — machine-readable summaries, for
  archiving a run's numbers or feeding into other tooling. **Fixed
  2026-09-04**: before this, `--reporter=list,html,json,junit` had no output
  path configured, so the json/junit reporters dumped their content to
  stdout instead of a file (verified empirically) — genuinely useless as "a
  result to generate." Now set via `cross-env PLAYWRIGHT_JSON_OUTPUT_NAME=...
  PLAYWRIGHT_JUNIT_OUTPUT_NAME=...` prefixed onto both `:artifacts` scripts
  (added the `cross-env` devDependency for this — Windows' default npm
  script shell doesn't support inline `VAR=value` the POSIX way). Both
  output paths are **not** under `test-results/`, deliberately — Playwright
  clears its own `outputDir` (`test-results/`) at the start of every run,
  which would delete a result file written there by an earlier stage before
  the run even finished (found the hard way live-verifying SM07/08/09 this
  same day — see §11). `smoke-reports/` and `playwright-report/` are both
  gitignored, same as `test-results/`.
- `npm run smoke:status` (or `smoke:status:json`) is a separate, lighter
  thing: a per-TC pass/fail table read straight from the RFI/NC trackers
  (`tests/fixtures/smoke/*.json`), not from a Playwright run's own report —
  useful for "what's the state of the last run" without opening the HTML
  report.

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

### 2026-09-04: `.env` CI/EE/QI retired from the feature chain, replaced by SM* replicas

App owner: *"most of the new feature stages use the .env CI/EE/QI accounts, and
EE hangs at 100% on QA past the 10-minute timeout — dont use cic, EE and QI from
env, use last created users; if required make replica of all specs in smoke and
keep separate."*

**Measured, not assumed:** on pulse-qa, `.env` CI takes 7.9 minutes to log in;
`.env` EE hangs at a 100% PWA spinner past the 10-minute test timeout. Both carry
months of accumulated offline data; freshly created users log in in very less time.

**Why re-crediting the existing specs wasn't enough.** The eight affected specs
(`02`, `03`, `20`, `29`, `30`, `23`, `24`, `14`) don't just use slow accounts —
several sit on ground the smoke users are not WAM'd onto (`29`/`30` on
`A-06c/BL09/BL10`, `23`/`24` on `S05b/BL02`, the regression's own areas). WAM-ing
the smoke users onto that ground would evict the `.env` CI/QI from it — rule R3,
single-assignee rows. So each becomes its own SM\* file with its own ground,
never a credential swap on the original.

**What was removed from `SMOKE_FEATURE_STAGES`:** all eight — see the block
comment in `playwright.config.js` at that list for the full reasoning. The
feature chain (`smoke:features`) is now 13 stages, every one Admin- or
created-user-driven, all viable on QA.

**Replicas built so far, in the app owner's stated priority order** (dependency
work-section, dependency work-area, data integrity, draft autosave named
explicitly; the plain-creation specs `02`/`03`/`20`/`14` were my own addition to
the chain, not the app owner's, and are lower priority):

- **`SM07_rfi_activity_dependency.spec.js`** — replica of
  `29_rfi_activity_dependency.spec.js`. Solar only (`profile.dependencyChain` is
  `null` for wind — WTG RFI work stays parked). Needed by construction change,
  not just a login swap: `rfi-dependency-flow.js`'s three driver functions
  (`withCIRetryOnMissingWorkSection`, `approveAsRole`,
  `runDependencyChainForActivity`, `runDependencyChainForScarceWorkSectionActivity`)
  now take an optional `{ loginAs = loginAsRole }`, threaded through every
  internal call site. Spec 29/30 call with no opts, so they resolve to
  `loginAsRole` exactly as before — diffed line-for-line to confirm zero
  behavioural change. Ground: a NEW work area, `S05b/BL07`, added to
  `SOLAR_E2E.workAreas` — deliberately not a reuse of `demapWorkArea` (`BL06`),
  because SM04 now WAMs hierarchy-tier users onto `BL06` and would evict the
  smoke CI/QI's single-assignee row there. `dependencyChain` reuses the proven
  `PILING_ACTIVITY_CHAINS` "Piling - MMS" shape from `rfi-dependency-data.js`
  (checkpoint[0] confirmed live on `S05b` via SM05's 9/9 pass; checkpoints
  [1]/[2] carried over from the `A-06c/BL09` reference data, not yet confirmed
  under `S05b` — fails loudly at the checklist dropdown if the names don't
  match). Single-page session model, matching spec 29's own shape, not SM05's
  three-parallel-session model — the chain is inherently serial.

- **`SM08_rfi_data_integrity.spec.js`** — replica of
  `23_rfi_data_integrity.spec.js` (both TCs: create-echo, and reject/resubmit
  echo with deliberately different observation text). Ground: **reuses**
  `profile.rfi` (`S05b/BL03`, the same area SM05's flow already uses) rather
  than getting a dedicated area — mirrors the regression's own precedent (spec
  23 shares `BL02` with specs 08-10/21/24) since solar's ~490 sections per area
  make a couple of extra ad-hoc creates free. Reuses
  `createAndSubmitCheckpoint`/`getVisibleCodeFor` from `rfi-dependency-flow.js`
  (already generic) instead of `rfi-flow-turns.js`'s `RFI_DATA`/`createNewRfi` —
  importing that module would pull the regression's own tracker into this
  file's module graph. `assertFieldsMatch` and the resubmit helper are inlined
  copies of spec 23's, adapted to compare against `profile.rfi` instead of
  `RFI_DATA`.

Both wired into `SMOKE_TAIL_STAGES` (after `wam-hierarchy`, in the app owner's
named order: dependency, then data integrity) and into all four `smoke:*`
solar npm scripts. Full collection verified clean after each addition (383
tests, 88 files as of SM08); specs 29/30/23 re-verified to collect identically
to before.

- **`SM09_rfi_draft_autosave.spec.js`** — replica of `24_rfi_draft_autosave.spec.js`
  (both trigger methods: browser Back, in-app nav click). Ground: reuses
  `profile.rfi`/`BL03`, same reasoning as SM08. Unlike SM07/SM08 there is no
  shared `.env`-flavoured driver module to inject a login into — this spec's
  mechanics (the "In-Draft" row, the eye-icon resume, the
  Proceed-blocked-but-draft-saved asymmetry) are pure page-object/navigation
  logic, so the file mirrors spec 24's own body directly, swapping
  `loginAsRole`/`RFI_DATA` for `loginAsFlowUser`/a flat object built from
  `profile.rfi` (the same construction as SM08's `resolveRfiFixture`, extended
  with the `workSection`/`inspectionCheckpoint`/`inspectionChecklist` fields
  `RFICreatePage.fillForm()` reads directly).

Wired into `SMOKE_TAIL_STAGES` (order: wam-hierarchy → dependency →
data-integrity → draft-autosave) and all four `smoke:*` solar npm scripts. 387
tests / 89 files after SM09; spec 24 reverified to collect identically to
before.

### 2026-09-04: adversarial review of SM07/SM08 found and fixed 3 real bugs

Per the app owner's instruction ("check from your side and continue"), ran a
5-dimension adversarial review (login-injection, ground-collision,
SM07-correctness, SM08-correctness, config-wiring) over the additions above,
each finding independently re-verified against the actual files before being
reported. login-injection, SM07-correctness, SM08-correctness and
config-wiring came back clean. ground-collision surfaced three real,
confirmed defects — all now fixed:

1. **`resolveFlowWorkAreas()` never excluded `dependencyChain.workArea`, so
   BL07 leaked into SM05's own RFI fallthrough pool.** The function's
   `claimed` set explicitly protects `demapWorkArea` (`if
   (profile.demapWorkArea) claimed.add(...)`) but had no equivalent line for
   the newer `dependencyChain` field — added 2026-09-04, BL07 didn't exist
   when this function was last touched. Confirmed live:
   `resolveFlowWorkAreas(SOLAR_E2E, {flow:'rfi', viewport:'desktop'})`
   returned `['BL03','BL07']` instead of `['BL03']`. Since SM05's RFI walk
   (`rfi-smoke-walk.js`) iterates its *entire* pool once an area is
   exhausted/blocked, a long enough SM05 run would eventually have started
   creating RFIs on BL07 — directly contradicting the "BL07 is SM07's own,
   untouched by anything else" design intent, and the exact kind of
   cross-stage ground collision this whole framework exists to prevent (SM06
   and the one inspection spec that also call this function only ever read
   `pool[0]`, so they were never exposed). **Fixed:** added the missing
   `claimed.add(profile.dependencyChain.workArea)` line, mirroring
   `demapWorkArea`'s. Reverified: the pool is back to `['BL03']` /
   `['BL04']` / `['BL05']` for solar's three (flow, viewport) combinations.

2. **`SMOKE_TAIL_STAGES`' declared order (SM04 → SM07 → SM08 → SM09) was never
   a real Playwright dependency — only an incidental consequence of
   `--workers=1`.** `smokeChain()`'s `pushLeaf()` resets `previous =
   setupTail` before every call, used for both the flow-viewport leaves AND
   the tail stages — so all of them (8 projects) declared the identical
   single dependency `['smoke-solar-wam']`, making them Playwright *siblings*,
   not a chain. Traced into the installed engine
   (`node_modules/playwright/lib/runner/index.js`, v1.61.0) to confirm:
   `createPhasesTask()` batches every project whose dependencies are already
   satisfied into ONE phase, dispatched through one shared `Dispatcher`
   (`createRunTestsTask()`); `Dispatcher._findFirstJobToRun()` returns queue
   index 0 whenever no project sets a per-project `workers` cap (true here),
   so strict FIFO order — which happens to match array declaration order —
   is what produced today's apparent SM04-before-SM07 sequence. This is real
   *today* (every `smoke:*` script hardcodes `--workers=1`) but not a
   documented contract: raising `workers`, or a future scheduler change,
   could let these interleave. Since two tail stages (SM04's hierarchy
   cascade and SM07's dependency chain) have genuine ground-sensitivity
   reasoning attached to their relative order, this fragility mattered.
   **Fixed:** `smokeChain()` now resets `previous = setupTail` ONCE
   immediately before the tail loop and uses plain `push()` (the same
   mechanism `SMOKE_SETUP_STAGES` already uses) instead of `pushLeaf()`, so
   each tail stage declares a REAL dependency on the one before it.
   Reverified: `smoke-solar-dependency <- ["smoke-solar-wam-hierarchy"]`,
   `smoke-solar-data-integrity <- ["smoke-solar-dependency"]`,
   `smoke-solar-draft-autosave <- ["smoke-solar-data-integrity"]`. The
   flow-viewport leaves were deliberately left as siblings-of-setupTail —
   their relative order carries no correctness requirement (RFI/NC and
   desktop/mobile all use disjoint ground already), so chaining them would
   only add unneeded serialization.

3. **The stated reason BL07 had to be separate from `demapWorkArea`/BL06 was
   itself wrong.** The original comment claimed reusing BL06 would let SM04's
   hierarchy cascade "evict the smoke flow's own CI/QI" from BL06's
   single-assignee row. But `resolveSmokeUsers()` resolves ONE fixed fixture
   entry per (profile, role prefix), reused identically by every caller — so
   SM04's cascade re-targets BL06 with the *same* CI/QI accounts SM03's own
   blanket per-area loop already put there. `WAMPage.assignUserIfNeeded()`
   short-circuits as a no-op when the row already holds that exact name —
   there is no second identity anywhere in the chain for a single-assignee
   row to be evicted BY. **Fixed:** corrected the comment. BL07 stays
   dedicated regardless — bug #1 above is the real reason it needs to be
   isolated (protecting SM07's ground from the RFI flow's own fallthrough
   pool), not eviction-avoidance.

All three read as a straightforward category: a NEW field
(`dependencyChain`) added to a profile whose surrounding infrastructure
(`resolveFlowWorkAreas`, the tail-stage chain, the isolation reasoning in
comments) predates it and was not fully threaded through. Re-verified after
all three fixes: full collection still 387 tests / 89 files, regression specs
08-10/21/23/24/29/30 all reverified to collect identically to before.

### 2026-09-04: live verification — 19/19 passed, one real bug found and fixed

Ran the full new chain live against pulse-qa (`--project=smoke-solar-draft-autosave`,
which pulls in its entire dependency chain: SM01 → SM03 → SM04 → SM07 → SM08 →
SM09 — 29 tests, 6 projects). Three attempts, in order:

1. **First attempt** — SM01 (all 10 users reused, correctly) and SM03 (WAM
   across all 5 areas including BL07) both passed cleanly. SM04's hierarchy
   cascade got through 9 of 10 steps, then "Contractor Manager assigns
   Contractor Incharge" timed out waiting for a dialog that never appears to
   have opened. SM04/WAMPage.js are code this session never touched, and this
   exact test previously passed 10/10 — read as a live-app flake, not a BL07
   regression. Because SM04 failed, SM07/SM08/SM09 — the actual new work —
   never got to run at all.
2. **Retry** — confirmed the flake theory: SM04 passed all 10 steps cleanly
   this time (13.1s for the previously-failing step). **SM07 and SM08 both
   passed live, end to end, for the first time**: the dependency chain
   correctly blocked on both transitions (missing-predecessor toast, then
   created-not-approved toast) and created RFI-S05b-BL07-CIV-30/31/33 in
   sequence; SM08's create-echo and reject/resubmit-echo both passed on BL03.
   **SM09's first test then failed for real**: "RFI RFI-S05b-BL03-CIV-DRAFT
   not found in Pending with me" — EE's lookup missed because the code had
   moved on from the placeholder by the time EE looked.

   Root cause: SM09 copied spec 24's own body almost verbatim, including its
   single unguarded `RFIChecklistPage.getVisibleCode()` read right after
   submit — the exact same code-not-finalized race already documented and
   fixed for the RESUBMIT case in `smoke-rfi-turns.js` ("5 of 9 TCs read back
   DRAFT... it is a race, not a rule"). Spec 24 never surfaces it because
   `.env`'s much slower PWA timing happens to outlast the race; smoke's fast
   created-user logins expose it instead — the same "fast login timing
   surfaces a latent race" pattern as the DRAFT-autosave feature's own history.
   **Fixed:** SM09 now polls `rfi-dependency-flow.js`'s `getVisibleCodeFor`
   (already a plain, generic export SM07/SM08 both use) up to 5 times with a
   5s wait between attempts, and fails loudly with a clear diagnostic if it
   never resolves past the placeholder — unlike the resubmit case there is no
   "keep the original code" fallback available on a first-time submit.
3. **Second retry, after the fix** — **19/19 passed, exit code 0, 18.6
   minutes wall-clock.** Both SM09 trigger methods (browser Back, in-app nav
   click) completed with real codes on the first poll attempt
   (`RFI-S05b-BL03-CIV-43`/`-44`). SM04/SM07/SM08 all passed again too,
   confirming the earlier pass wasn't a fluke.

This is the first genuine live proof that SM07/SM08/SM09 work end to end, not
just that they collect. Full chain now verified: SM01 → SM03 (with BL07) →
SM04 → SM07 → SM08 → SM09, all green.

**Still pending:** lower priority, replicas of the plain-creation specs
`02`/`03`/`20`/`14` if still wanted (these were my own addition to the
feature chain, not the app owner's). `smoke-wind-dependency`/
`smoke-wind-data-integrity`/`smoke-wind-draft-autosave` exist in the config
(the tail stages aren't profile-gated) but are not in any npm script — same
operational-safety pattern SM05/SM06 already relied on for wind before this
work: nothing invokes the wind projects, so their live-on-scarce-ground
exposure never fires in practice.

### 2026-09-04: user's own `smoke:full` runs — reporting infra fixed, SM04's dialog-close flake generalised, reset made self-service

App owner ran `smoke:full:artifacts` live twice, ~70 minutes apart. Three
separate things came out of reading both HTML reports:

1. **JSON/JUnit reporters were writing to stdout, not files.** `--reporter=
   list,html,json,junit` on the CLI has no configured output path for the
   json/junit reporters without `PLAYWRIGHT_JSON_OUTPUT_NAME`/
   `PLAYWRIGHT_JUNIT_OUTPUT_NAME`. Fixed: added `cross-env` as a
   devDependency and prefixed both `:artifacts` scripts with those two env
   vars pointed at `smoke-reports/results.json` / `smoke-reports/junit.xml`.
   `smoke-reports/` added to `.gitignore`.
2. **Run 1** (12:18pm) hit the "Nothing is pending" tracker guard on all 4
   RFI/NC projects — those 4 trackers had been sitting `"status": "done"`
   since a previous session, untouched before this run. Also hit the
   already-diagnosed `specs/11_reassign_rfi_nc.spec.js` race (Admin's global
   "Pending with others" queue picking up a row another live process — app
   owner confirmed rows matching `E2E-WL`/`E2E-WA` belong to DRS's own
   automation on the same shared QA env, not this suite's ground). SM04 and
   everything after it (SM07/SM08/SM09, all feature stages) passed clean.
   Fixed the tracker guard by deleting the 4 `"done"` tracker files
   (`seedIfMissing: true` regenerates them fresh).
3. **Run 2** (1:28pm, after the tracker deletion) — SM05/SM06 ran for real
   this time and passed with genuine multi-minute durations (RFI desktop
   23.7m, RFI mobile 20.4m, NC desktop 12.0m, NC mobile 18.0m), confirming
   the tracker fix. But SM04's hierarchy cascade failed at a **third**
   different step in a **third** different way: "Plot Admin assigns Project
   Manager" timed out 30s waiting for `WAMPage.js`'s Submit button to become
   visible. The saved `error-context.md` page snapshot showed the "Add
   Details" dialog completely gone from the DOM — back on the bare "My
   Assignment" filter screen — even though the assertion immediately before
   `clickSubmit()` (row's combobox contains the target user's name) had just
   passed. Same family of bug as the Contractor Manager flake from the first
   live-verification run above (the whole dialog closing itself, not just a
   row popover), just triggered this time by the single-select row pick
   (`assignUserIfNeeded`) instead of the role-options Escape probe. SM04/
   WAMPage.js's actual interaction code is untouched by any of this
   session's work, so this reads as the same pre-existing live-app timing
   quirk recurring at a different point, not a regression.

   **Fixed:** generalised the existing "reopen if the dialog closed on us"
   guard in `SM04_wam_hierarchy.spec.js`'s `cascadeStep` — added a second
   check right before `clickSubmit()`, after the pre-Submit assertion. If
   the dialog is gone at that point, reopen it, re-run
   `fillAssignmentFilters`, redo the row pick (`assignUserIfNeeded`/
   `addAssigneeToRow`, whichever this step uses), and re-assert before
   proceeding to Submit. Every step redone is idempotent, so this only costs
   time on the (so far ~1-in-3-runs) occasions the app closes the dialog on
   its own. Scoped entirely to SM04's own spec file — `WAMPage.js` itself
   (shared by specs 1-31) is untouched.
4. **Tracker guard, again:** run 2's real SM05/SM06 pass re-marked all 4
   RFI/NC trackers `"done"`, which would trip the same guard on the very
   next run. Deleted them again, and this time added a durable fix instead
   of relying on manual deletion: `smoke:solar:reset` / `smoke:full:reset`
   npm scripts that prefix `cross-env SMOKE_RESET=1` — `smoke-tracker.js`'s
   `prepareRun()` already supported this env var (resets whichever tracker
   the run touches), it just had no npm script wired to it yet.

**Not yet re-verified live** — the dialog-close guard fix is written and the
suite still collects cleanly (24 tests in `smoke-solar-wam-hierarchy`, 387
total), but hasn't been proven against a real recurrence yet. If it trips at
a **fourth** distinct cascade step in some future run, that stops looking
like "probe every close site individually" and starts looking like it
belongs one level up — e.g. wrapping the whole row-select-then-Submit
sequence in a single retry, rather than two separate guards.

### 2026-09-04: tests/specs/ cut loose — 18 replicas moved into smoke/, and the "68 did not run" fix

App owner: *"add all, dont take reference of specs from specs folder, add all
required specs in smoke itself ... nothing depends outside and all dependency are
configured independently ... so in one run I can get report of all specs nothing
should be escaped."*

**tests/specs/ is now EXPLORATION ONLY.** No smoke project references it.

#### Why 68 tests did not run

Not flakiness — the dependency graph. `smokeFeatureChain()` wired the thirteen
feature stages LINEARLY, each depending on the previous. `smoke-feature-reassign`
failed, so Playwright correctly skipped everything downstream:
dashboard-admin, dashboard-filter, hier-dashboard, online-roles, wam-patch,
wam-patch-hier, wam-demap, wam-demap-hier = 68 tests.

The chain existed for two reasons and both are now gone:

1. *Provision before use* — `12_user_management` created the batch that
   13/31/25/27 resolved users from. The replicas resolve SM01's users, and SM01
   is already in the setup prefix every leaf depends on.
2. *Destructive last* — 25/26/27/28 mutated BL01, shared ground. The replicas
   mutate `featureGround.wamMutate`, which nothing else uses.

Isolating the mutating ground is what made independence possible. Every feature
stage is now a **sibling leaf off the setup tail**, so one failure costs exactly
one stage. `smokeFeatureChain()` is deleted.

#### The reassign spec was genuinely broken, twice over

Both bugs, not env flake:

* **Hardcoded column indices.** `Expected "CICeenUser67", Received "BL05"` at
  `aria-colindex="5"` — column 5 was Work Area. The index came from a one-off DOM
  dump and no longer meant the same thing. Because the mismatch surfaces as a
  wrong VALUE, it reads like the reassignment failed. Fixed with
  `ReassignPage.resolveColumnIndexByHeader()` — resolve by header text at run
  time.
* **Reassigning a row we do not own.** It took the first row of Admin's GLOBAL
  "Pending with others" queue and landed on `RFI-S05b-BL05-CIV-52` — smoke's own
  NC ground, created minutes earlier by SM06. Fixed with `pickOwnedRow()`, which
  prefers isolated feature ground, never picks a live flow area, and never picks
  DRS rows (`RFI-E2E-WL-...`) or regression ground.

#### Ground: three collisions resolved

| Collision | Resolution |
|---|---|
| A-06c hardcoded in 06/07/19/25/26/27/28 — the app owner's manual ground | all replicas moved to S05b |
| `13_wam_all_roles` swept S05b/BL01-BL05, overlapping BL01, BL02 and the flow areas BL03-BL05 — and CI/QI rows are SINGLE-assignee, so it would have EVICTED the flow users from their own ground | `featureGround.wamSweep` (BL08-BL09) |
| 25/26/27/28 cleared and re-pointed BL01 | `featureGround.wamMutate` (BL10) |

New `featureGround` block in `tests/config/projects.js`: `wamSweep` (BL08-09),
`wamMutate` (BL10), `rfiCreate` (BL11), `rfiBulkAreas` (BL12-14), `ncCreate`
(shares BL05 — an NC consumes nothing, so a second one there is free; an RFI area
would be the opposite, since a non-approved NC BLOCKS RFI create/resubmit for the
same checkpoint+section).

`smokeMappedWorkAreas()` is what SM03 now maps: flow areas **plus** the feature
areas needing flow-role access, deliberately EXCLUDING `wamSweep` (assigning
there is SM11-13's coverage, so pre-filling would leave nothing to change) and
`ncCreate` (already a flow area). Feature ground is kept OUT of
`profile.workAreas` so it cannot leak into resolveFlowWorkAreas' fallthrough
pool — the BL07 bug found earlier the same day.

#### Users: fresh every run, with a switch

App owner: *"SM01 created users should be permanent in one full run, 12 user
management can also create all roles but after checking creation mapping
demapping old SM01 users should be restored and every run of smoke creates new
users ... can you give any way we can control whether new users should be
created/reused."*

* `SMOKE_USERS=new` (**default**) — SM01 creates a fresh batch every run.
* `SMOKE_USERS=reuse` — reuse recorded users, create only what is missing.
  For iteration: re-running one stage otherwise re-creates and re-maps ten users
  first. `npm run smoke:full:reuse`.
* `SMOKE_RECREATE_USERS=1` still works as an alias for `new`.

**Three prefix namespaces** now coexist in `last-created-users.json`:
`CISL/EESL/...` (SM01's chain identity), bare `EE/QI/CIC/...` (the regression
tier's — clobbering these would repoint 13/25/27/28/31/online-roles at smoke
users), and `EESM/QISM/...` (SM10's throwaway Add-User coverage batch, including
the eleventh role "Admin" that SM01 has no use for). Nothing reads SM10's batch,
which is what makes creating it safe mid-run.

**SM27 restores the baseline.** Each mutating stage restores what it changed with
the restore asserted, but a stage that DIES mid-mutation never reaches its own
restore — and the consequence surfaces on the next run, in a different stage, as
"work area not visible". SM27 re-asserts the whole mapped band. It is a LEAF, not
a dependent of the mutating stages: depending on them would mean a mutating
failure skips the restore, which is the exact case it exists for.
`npm run smoke:restore` runs it alone.

#### The 18 replicas

SM10 user-management (all 11 roles) · SM11 WAM basics · SM12 WAM vendor roles +
Service Order gate · SM13 WAM all roles (four row granularities) · SM14 reassign ·
SM15 Admin login/dashboard · SM16 dashboard filter (28 tests) · SM17 hierarchy
menu sweep · SM18 online-role sweep (7 roles, one file) · SM19 WAM patch ·
SM20 WAM patch by hierarchy tier · SM21 WAM demap · SM22 WAM demap by tier ·
SM23 CI RFI-create depth · SM24 bulk create one area · SM25 one RFI per area ·
SM26 QI NC create · SM27 restore baseline.

Two notes on faithfulness:

* **`20_rfi_bulk_create_multi_location` is misnamed** — all seven of its entries
  are ONE work location (A-06c) and seven different work AREAS. So no second work
  location was needed and `workLocations` stays a single entry. SM25 scales 7 to 3
  areas: the behaviour is "one RFI per area, cascade re-resolves between them",
  which three proves, and each RFI permanently consumes a work section.
* **SM16 was transformed mechanically, not retyped.** 446 lines whose value is in
  details established live (Sub-Activity shows an "Activity first" hint while its
  options are *not* gated; filtering can legitimately EMPTY the table). Only the
  13 hardcoded `A-06c` references and the test-base import changed.

#### Shared code: additive only

`ReassignPage` +94/-0 (`resolveColumnIndexByHeader`, `listRowIds`).
`online-role-regression.js` gained ONE optional parameter, `resolveUser`,
defaulting to its original bare-prefix lookup — so the seven specs in
`tests/online-roles/` are byte-for-byte unaffected and still collect 1 test each.
Same injection pattern already proven for `loginAs` on `rfi-dependency-flow.js`.

New shared utils: `smoke-wam.js` (the assign/submit/reopen/verify cycle plus the
dialog-closes-itself guard, previously copy-pasted per spec — including the
"empty toast is not a failure" rule, since a large payload can 502 with no toast
while the write persists), `smoke-rfi-fixture.js`, `run-smoke.js`.

#### Running it

`run-smoke.js` derives the project list from the config rather than hardcoding it
in package.json — the CLI has no project wildcard, the chain is 28 projects, and
the old hardcoded list had already gone stale when the feature projects were
renamed.

| Script | What |
|---|---|
| `npm run smoke:full` | every solar project — 28 stages, 143 tests |
| `npm run smoke:full:artifacts` | + html/json/junit into `smoke-reports/` |
| `npm run smoke:full:reuse` | reuse SM01's users (iteration) |
| `npm run smoke:full:reset` | `SMOKE_RESET=1` — restart the RFI/NC TC sets |
| `npm run smoke:full:retry` | `SMOKE_RETRY_FAILED=1` — revive failed TCs only |
| `npm run smoke:restore` | SM27 alone |
| `npm run smoke:list` | print what a full run would execute |

**Verified statically, NOT yet live:** full collection 401 tests / 107 files;
smoke chain 28 stages / 143 tests; regression tier unchanged at 211 tests with
`tests/specs/` and `tests/online-roles/` git-clean; no smoke spec requires from
`specs/`; no hardcoded A-06c/BL01/BL02 in smoke code; every page-object member
and every destructured import checked to exist; no feature stage depends on
anything but the setup prefix.

**Ground confirmed by the app owner, 2026-09-04** (after the above was written):
*"BL08–BL14 have never been touched — all blocks are present dont worry ... SO is
mapped proerly in S05b whole work location so dont worry about SO mappping
prerequisite."* So the last open risk on this restructure is closed: the areas
exist, and the vendor roles’ Service Order gate is satisfied across the whole of
S05b, meaning SM12 and the CI/CM rows in SM13/SM19/SM22 have no per-area SO
provisioning to do first. That mattered because SO mapping moved to DRS — there
is no PULSE screen left to fix it from if it had been missing.

**Two stale comments that confirmation exposed, both now fixed:**

* `projects.js` claimed BL08+ were "a preference, not an assumption" and
  described a `resolveFeatureWorkAreas()` that checked each name against the
  dialog and fell back to the next unclaimed area. **That function was never
  written** — the comment described behaviour that did not exist, so a missing
  area would have hard-failed rather than degrading. Not implementing it now
  either: silent substitution is the wrong behaviour here, because the whole
  point of `featureGround` is that each stage owns ground nothing else touches,
  and an area quietly swapped for "the next free one" could land a mutating
  stage on a flow area. Failing at the Work Area row names the missing area and
  is a one-line config fix.
* `SM03` said vendor-role assignment "depends on stage 2 having run". SM02 is not
  a stage at all any more, so that would have sent someone debugging a vendor
  assignment hunting for a prerequisite that never runs. Corrected to say what a
  failure there actually means: the wrong Service Order was picked, or a real app
  problem.

### 2026-09-04 (live run 3): the SM04 dialog-close fix, done properly this time

`Site Admin assigns Plot Admin` failed with:

```
TimeoutError: locator.waitFor: Timeout 30000ms exceeded
  waiting for ...[data-part="content"] ... row S05b ... [role="combobox"] to be visible
  59 × locator resolved to hidden <button role="combobox" data-state="closed" ...>
```

Submit was never reached. **Read the `59 × resolved to hidden`** — the row was
found every time and was hidden every time. Ark UI hides `[data-part="content"]`
and leaves the whole subtree in the DOM, so a row scoped inside a CLOSED dialog
still resolves. `openDropdown()`'s first line is
`trigger.waitFor({ state: 'visible' })`, so it sat for the full 30s waiting for
something that could never become visible.

The log shows the sequence exactly: `(dialog closed after reading Site Admin's
role options — reopening)` fired and worked — then the dialog closed **again**
during `fillAssignmentFilters`, and the next step walked straight into it.

**This dialog has now closed itself at four different points across three runs:**
after `getAvailableRoleOptions()`; after the pre-Submit assertion; after a
single-select row pick; and after `fillAssignmentFilters`. Each earlier fix added
a guard at whichever point had just failed, and the dialog closed somewhere else
next time. **A fixed set of checkpoints cannot work here.**

Replaced with `openDialogWithInteractiveRow()` in `smoke-wam.js`: the whole
open-filter-resolve sequence is retried AS A UNIT (3 attempts, full
re-navigation each time) and verified by its own POSTCONDITION.
`dialogNotReady()` checks that the dialog is visible AND that the target row's
combobox is actually visible, distinguishing three states — "dialog is not
visible", "row exists but its combobox is HIDDEN (the dialog closed with its DOM
left behind)", and "row is not present at all" — so the log says which one
happened rather than leaving it to be inferred from a 30s timeout.

`resolveRow` is a callback rather than a label so the Cluster/Site rows (whose
rendered label varies — KHAVDA vs Khavda vs Gujarat for the same place) are
resolved INSIDE the retry, where failing to resolve is just another reason to try
again. Exhausting all attempts throws with the last problem named, because at
that point it is a real app problem rather than the usual flake.

Also fixed: `assignAndProve`'s opening `ensureDialogOpen` reopened the dialog
without re-applying the filters, which would have left a blank dialog and made
the row lookups fail as "not present" — a data-shaped symptom for a UI cause.

SM04's pre-Submit guard now routes through the same bounded retry instead of
reopening by hand. The hand-rolled version was fine until the dialog closed
during its own redo, at which point it had no attempts left and produced exactly
the original failure again.

Unit-verified without a browser: the classifier distinguishes all four states;
the retry loop retries, succeeds mid-sequence, exhausts cleanly with a named
reason, and treats a `resolveRow` throw as retryable rather than fatal.

### 2026-09-05 (live run 2): 17 failures, 7 lost to cascading skip — six distinct fixes

**Result: 114 passed, 17 failed, 2 skipped, 7 did not run (1.9h).** Both of the
prior session's live fixes held — zero dialog-close failures anywhere in SM01,
SM04, or any WAM stage. All 17 failures were new, distinct issues:

1. **SM16 (10 failures), all one root cause.** `DashboardFilterPage`'s
   `datePickerCalendar` locator had no `[data-state="open"]` filter. Ark UI
   leaves a CLOSED date-picker's content node in the DOM (same trait as every
   other Ark UI popover in this suite), and the From/To fields each render their
   OWN content node — so the moment a SECOND date field opens in the same
   session, the locator matches both and Playwright's strict mode throws.
   Confirmed by the error itself: `resolved to 2 elements: 1) data-state="open"
   ... 2) hidden data-state="closed"`. Fixed by scoping to `[data-state="open"]`
   — safe, since that locator has exactly one consumer (`selectDateField`).

2. **SM18 (2 of 5 failures): a real bug in MY OWN precondition assumption for
   Cluster Admin/Site Admin, and a genuine race for Execution Lead/Quality
   Lead — same underlying mechanism.** `waitForStableChartFingerprint` (shared,
   `DashboardPage.js`) accepts a fingerprint as "settled" once two 250ms-apart
   reads match. `"202x136::"` is the chart's background rect with ZERO path
   elements — i.e. "hasn't painted data yet," not "genuinely empty." Two
   consecutive reads of that pre-paint state look identical and settle
   prematurely. CAD/SAD's baseline RFI read got caught in exactly that race
   (empty), then the later "switch back to RFI" read got the REAL data,
   correctly differing from the false baseline. EL/QL's charts plausibly hit the
   same race on both sides. Fixed: an empty settle now gets ONE more, LONGER
   (10s) chance before being trusted — can only ever convert a premature empty
   into the real result; a chart that's genuinely empty after that, or settles
   non-empty immediately, is unaffected.

3. **SM18 (1 failure): Plot Admin's SO Mapping page timed out waiting for its
   empty-state hint.** This exact code path is PROVEN to work for a
   Plot-Admin-scoped account (`tests/online-roles/pad.spec.js` has passed
   through it live before) — not a per-role behaviour difference, a timeout too
   tight for ~1.9h into a long run. Widened `SOMappingPage.waitForLoad()`
   3000ms -> 8000ms; backward-compatible (already-fast loads unaffected).

4. **SM19 (1 failure, cost 7 more to the cascading-skip bug below): a real bug
   in my own SM19.** Its precondition assumed "SM03 seeds every work-area row
   this stage touches" — true for EE/QI/CI/CM (SM03's own FLOW_ROLES), FALSE for
   EL/QL, which nobody ever puts on `wamMutate` specifically (SM13 only touches
   them on `wamSweep`, a different area, as its own separate coverage). Fixed:
   self-seed the row if empty, mirroring the pattern SM21's demap test already
   uses, for every role in the loop — removes the dependency on guessing
   correctly which other stage populated a row.

5. **STRUCTURAL, found from the cascade: `test.describe.configure({mode:
   'serial'})` means "skip every remaining test in this file after the first
   failure" (documented Playwright behaviour) — and given run-smoke.js already
   hardcodes `--workers=1` for the ENTIRE run, serial's ONLY remaining effect
   for a shared-session-but-independent-tests file is that abort, with zero
   compensating benefit (order and single-worker safety both already come from
   the global `--workers=1`).** This is exactly what turned one EE-creation
   dialog-close bug into "137 did not run" earlier, and just turned SM19's one
   EL precondition miss into 7 more lost tests. Removed `serial` from every file
   where tests are genuinely independent — SM01, SM10, SM11, SM12, SM13, SM14,
   SM19, SM20 (per-tier), SM21, SM22 (per-tier), SM27 — replacing with a comment
   pointing at the `--workers=1` convention. KEPT serial where a real causal
   chain exists: SM23 (cancel-test's server-side effect is what the duplicate
   test depends on) and the pre-existing SM02/04-09 (genuine cascades, not part
   of this restructure).

6. **SM23's duplicate-RFI test was based on a wrong assumption about the app,
   found from its own failure.** It tried to re-select, BY NAME, the exact work
   section a prior test had already fully submitted — but a section that's had
   a real RFI submitted against it DISAPPEARS FROM THE PICKER ENTIRELY
   (confirmed live: `WORK_SECTION_NOT_FOUND: option matching "R02-T43"` — this
   is also the premise SM24/SM25 depend on, that repeated creates always land on
   distinct sections). The ORIGINAL `02_rfi_ci.spec.js` never re-selects by
   name at all — its `RFI_DATA` has no `workSection` key, so every call
   (submit/cancel/duplicate tests alike) takes the picker's own "first
   available" default, and its duplicate test runs immediately after its OWN
   cancel-confirmation test, not after the submit test. Rewritten to mirror that
   exactly: the cancel test now uses no explicit section (capturing what it
   landed on as `cancelledWorkSection`, purely for logging), and the duplicate
   test also takes no explicit section, checking for a duplicate error on
   either page 1 (`clickProceedAndCheckOutcome`'s blocked path) or, if that lets
   it through, at the checklist Submit — exactly the original's own two-stage
   detection. **Flagged as inference, not confirmed**: the theory that a
   cancelled-at-the-confirmation-step submission still registers server-side
   (this app's own documented draft-autosave behaviour) is what makes reusing
   the cancelled test's section reproduce a genuine duplicate — plausible and
   consistent with everything else known about this app, but not something
   directly observed. If it still doesn't reproduce a duplicate on the next
   live run, the real mechanism needs another look rather than a third guess.

**Also found and reverted, unrelated to these fixes:** `tests/specs/
13_wam_all_roles.spec.js` (a REGRESSION-tier file, off-limits) had been
accidentally modified at some earlier point (`WORK_LOCATION_ROW: 'A-06c'` ->
`'S05b'`) — caught via the git-status regression check that runs after every
edit round, reverted with `git checkout --`. Regression tier confirmed
git-clean again after.

Not yet re-verified live — this is a second live attempt with these six fixes
applied.

### 2026-09-05 (live run 3): 22 failures — mostly a forgotten tracker reset, plus real fixes exposed by fixing run 2's issues

**Result: 107 passed, 22 failed, 1 skipped, 10 did not run (59.5m — much shorter,**
**because SM05/SM06 failed FAST on the tracker guard instead of running their real ~20min flows).**

1. **4 failures were MY OWN operational miss, not a code bug.** SM05/SM06's
   RFI/NC trackers were left `9/9`/`4/4` "done" from run 1 (which genuinely
   completed them), and I relaunched run 2 without resetting them —
   `smoke-tracker.js`'s deliberate "Nothing is pending" guard fired instantly.
   Reset by deleting the 4 tracker files before this run (regenerated fresh via
   `seedIfMissing`).

2. **SM16's date-picker fix from run 2 WORKED — it exposed a second, real bug
   underneath.** No more strict-mode violations; instead, the single resolved
   calendar's FIRST day cell turned out to be a disabled, out-of-current-month
   placeholder (`data-disabled`, `data-outside-range` — trailing days of the
   previous month shown greyed-out to fill the grid). Fixed:
   `:not([data-disabled])` on the no-explicit-value path.

3. **The app owner independently confirmed the same finding by hand** (drove
   the same live headed calendar): it only renders one month at a time — no
   direct jump to an arbitrary day — and separately, the "From" field is
   restricted to today-or-earlier (a future From date is disabled regardless of
   navigation). This also exposed that 3 of SM16's hardcoded dates carried over
   from the original spec (2001-01-01, 2020-01-01, 2026-12-31) were never
   reachable by point-and-click at all, and one of them (2026-12-31 as a FROM
   value) could never be valid regardless. Fixed:
   - Added `navigateCalendarToMonth()` using the picker's confirmed "Switch to
     year view" control plus the same [data-view="..."] cell shape already
     relied on for day cells (Zag.js/Ark UI's standard year→month→day
     drill-down). **Not fully live-verified** — the day-view button and its
     cells are observed directly; the year/month cell shape one level in is
     inferred from the library's well-established pattern, not watched. Built
     to throw a specific, named error per step if that inference is wrong,
     rather than a generic timeout.
   - Two of the three "no To"/"no From" tests never actually needed a specific
     far-away date at all — switched to the picker's own default (first
     enabled day in the current month), removing the risk entirely for those.
   - The invalid-range test now pairs a default current-month FROM (always
     valid) with an explicit 2020-01-01 TO (needs the new navigation) — a
     construction that respects the real FROM restriction while still being a
     genuine inverted range.
   - The no-match-case test (2001-01-01/2001-01-02) was untouched — its own
     comment already said "any sufficiently old date works," and it's the
     other real exerciser of the new navigation code.

4. **SM18's chart-fingerprint fix (empty-result gets a second, longer chance)
   and SO-Mapping timeout widening (3s→8s) did NOT get exercised this run** —
   SM18 never got its 5 failures reproduced or fixed-and-confirmed, because
   this run's SHORTER 59.5m duration suggests it may not have reached SM18 at
   all before the run's other failures (need to confirm on the actual run;
   possible the whole chain simply takes ~1.9h normally and this 59.5m run
   didn't get that far). Status of these two fixes: still unverified live.

5. **SM17's CAD "WAM showed an error banner" — new finding, ambiguous.** The
   failure screenshot showed a fully-settled, ORDINARY Dashboard (not WAM, no
   visible error content) — consistent with a momentary render flash rather
   than a broken screen, though not conclusively diagnosed. Made the check
   retry once (re-navigate, re-check) before failing, rather than guessing at
   a root cause with a single data point.

6. **SM23's duplicate-RFI test: SECOND theory also failed to reproduce a
   duplicate live** (reusing the cancelled test's section, expecting
   draft-autosave to have registered something server-side on Submit click —
   it hadn't; Proceed and checklist Submit both went through cleanly with no
   duplicate banner at any point). Converted this specific check from a hard
   assertion to informational (logs what happened, does not fail the run).
   Leading theory now: the .env account this replicates has MONTHS of
   accumulated history and may be colliding with genuine LEFTOVER pending RFIs
   from past runs, not anything the test itself sets up in one execution — a
   fresh smoke user has no such residue, and a truly-submitted section
   disappears from the picker entirely (confirmed), so there may be no way to
   reproduce this specific duplicate with a fresh single-session user through
   the normal UI at all. Needs the app owner's description of the actual rule
   before this becomes a hard assertion again.

Trackers reset before this run. Not yet re-verified live — this is a third live
attempt.

### 2026-09-04 (post-run-3): the project-`dependencies` cascade — the real reason "130 did not run"

Run 3's own headline number didn't add up: SM01's "create the PM user" test was
the only genuine failure (9 of its 10 role-creation tests passed — direct
proof the `serial`-removal fix from run 1 works correctly at the file level),
yet the run reported 130 of the remaining 139 tests as "did not run." The file-
level fix only ever promised to contain damage to ONE file; something coarser
was still armed.

Root cause: `playwright.config.js`'s `smokeChain()` helper (`push()`/
`pushLeaf()`) was setting Playwright's PROJECT-level `dependencies: [previous]`
on every project after the first. Playwright's documented behavior for that
field is to skip a project entirely if anything in its dependency chain has a
failing test — and because every one of the 28 solar smoke projects
transitively depends on `smoke-solar-users` (SM01) through `smoke-solar-wam`
(SM03), one failing test in SM01 skipped SM03, which skipped everything after
it: 26 of 28 projects, 130 of 139 remaining tests.

Fix: removed `dependencies` from `push()` entirely. This is safe because
ordering was never actually coming from `dependencies` here — run-smoke.js
always invokes with `--workers=1`, and an earlier, separate investigation
(2026-09-04, referenced in `project_smoke_env_login_replicas`) had already
traced into `node_modules/playwright/lib/runner` and confirmed that a single
worker dispatches from one shared FIFO queue in declaration order regardless
of the `dependencies` graph — proven then by the fact that SMOKE_TAIL_STAGES
(SM04→SM07→SM08→SM09) were already executing in the right order despite being
siblings with no real dependency edge between them. `dependencies` was
contributing pure downside (cascade-skip) with no ordering benefit to give up.
run-smoke.js also always names every project explicitly via repeated
`--project` flags, so no project relies on `dependencies` to be "pulled in" —
every project was always unconditionally listed on the command line.

This does not make a genuinely missing precondition silent: every downstream
stage still fails loudly and specifically (named role, named row, named
config) when something it truly needed is absent. It only stops one isolated
failure from erasing every other stage's chance to prove itself — exactly the
app owner's original framing, "in one run I can get report of all specs,
nothing should be escaped."

Verified post-fix: `node -e "require('./playwright.config.js')"` loads clean;
`npx playwright test --list` still reports "401 tests in 107 files" (unchanged
from before the edit); `git status --porcelain -- tests/specs tests/online-roles`
is empty (regression tier untouched). The 4 RFI/NC tracker files were found
already absent (run 3 failed at SM01, before SM05/SM06 ever ran, so they were
never regenerated since the run-2 reset) — `seedIfMissing` will create them
fresh on the next run, no manual reset needed this time.

PM's actual "create the PM user" failure itself was inspected but not
independently reproduced: `selectUserRole` routes through the same
`selectDropdownOption` that was fixed for EE's identical symptom, and that fix
(skip Escape unless the listbox is still open) is confirmed present and
correctly guards the exact failure class described. Cluster/Sites for PM are
already known to render as multi-select (see UserManagementPage's
`fillLocationCascade` comment) and go through the already-safe
`selectMultiAware`, not the branch that was fixed. No structural gap was found
for PM specifically — left as a one-off to watch for recurrence in run 4, now
that a repeat would cost one file's worth of tests instead of 130.

Live run 4 launched next with this fix in place.

### 2026-09-05: SM16 + SM18 fully green after several wrong turns — the full account

This picks up right after the project-`dependencies` cascade fix (previous
section). Four isolated verification rounds of just SM16 (dashboard filter)
and SM18 (online-role sweep) followed, each catching a real mistake in the
PREVIOUS round's own fix rather than a fresh app issue — recorded here in
full because the wrong turns are as instructive as the final fix.

**Round 1 → 2: `confirmWorkLocationSelected` read the wrong DOM property,
twice.** First version used `.textContent()` on the Work Location field —
always "" for the full timeout, because that locator resolves to a bare
`<input>` and inputs never carry their value as text content (a DOM fact).
Switched to `.inputValue()` — STILL always "", because a DOM dump
(`tests/specs/inspection/00_inspect_work_location_chip.spec.js`) proved this
field is an Ark UI "tags input" combobox: the input is a pure search box
that never holds the selection at all; each pick renders as a separate
sibling CHIP inside the same `[data-part="trigger"]` button. Fixed for real
by adding `DashboardFilterPage.selectedChipsContainer()` (walks up to that
trigger ancestor) and reading ITS text instead — this also fixed the ORIGINAL
`toContainText(workLocation())` assertion in the "Reset" test, which had the
identical wrong-element problem from the original (pre-smoke) spec.

**`navigateCalendarToMonth`'s year-view model was wrong.** Originally
assumed a two-step drill-down (a grid of bare year numbers, then a grid of
months). A live failure's page snapshot showed the truth: "Switch to year
view" lands DIRECTLY on a 12-month grid for one year (cells named e.g.
"January 2026"), paged via "Switch to previous/next year" buttons — there is
no separate year-number grid at all. Rewritten around the confirmed shape;
both the 2001 and 2020 date-range tests now pass.

**SO Mapping: two wrong theories before the real one.** (1) Widened
`waitForLoad`'s timeout 3s→8s — never worked, because the page was never
navigating to /so-mapping in the first place. (2) Recon
(`00_inspect_so_mapping_admin_nav.spec.js`) showed clicking the sidebar link
never changes the URL, but a direct `page.goto` does, landing on "Desktop
Mode Required — SO Mapping is managed in DRS..." — read as a responsive
breakpoint, so viewport was widened to 1920×1080. Also didn't work: CAD/SAD/
PAD still showed the identical notice even at that width — a SECOND recon run
proved it's not a breakpoint at all, it's an unconditional migration notice
(matching playwright.config.js's own existing record that SO Mapping was
removed from PULSE and now lives in DRS). Final fix:
`SOMappingPage.goto()` now navigates directly (the click is simply dead, at
any viewport) and `isDesktopGateShown()` lets the caller treat the notice as
an expected, informational finding rather than a failure.

**Cross-tab "independence" was asserting the wrong thing — confirmed with
the app owner.** A recon test showed Work Location and Work Area's selection
survives switching the RFI/NC toggle intact (not reset at all), which
contradicted the original tests' names/assumption ("does not carry over").
Asked the app owner directly rather than guessing which was the bug — they
confirmed the shared-filter behavior is INTENDED (one drawer for both tabs).
Renamed the describe block to "cross-tab state sharing" and rewrote both
tests to assert the carryover.

**Reports' Total Count had the same pre-paint race as the dashboard charts.**
`ReportsPage.waitForLoad()`'s own regex matches a "Total Count: 0" PLACEHOLDER
just as readily as the real number — confirmed live when CAD's and SAD's
"unfiltered" baseline read exactly 0 moments before the real (tens-of-
thousands) total rendered. Added `waitForRealTotalCount()` (same settle-and-
retry shape as the chart fingerprint fix) and used it for both the
before/after reads.

**EL/QL's chart-difference check: confirmed with the app owner, then
broadened.** After 3 separate live runs where EL's/QL's NC-side TAT Summary
chart stayed provably empty even with retries, asked the app owner rather
than guessing a root cause — confirmed: these two roles' WAM mapping may not
cover the work region NC was created in, or WAM may not be configured for
them there, so a chart that doesn't change between RFI and NC is expected,
not a bug. First softened check only matched the bar chart's empty-path shape
(fingerprint ending `::`); a re-run showed Trend Analysis (a LINE chart)
produces a flat, degenerate zero-value line instead — same underlying cause,
different chart type's way of drawing "nothing" — so the check was broadened
to plain fingerprint equality, which covers both shapes and any other chart
type this might affect.

**Standing instruction from the app owner, 2026-09-05:** Dashboard Filter
(SM16) is currently affected by a real, already-reported backend/API issue —
any SM16 failures going forward are reported factually, not investigated
further, until the app owner says otherwise.

Verified after every round: syntax, full collection count, and
`git status --porcelain -- 'tests/specs/*.spec.js' tests/online-roles` (only
the new, expected `tests/specs/inspection/*.spec.js` recon files ever
appeared — zero diff on any tracked regression file throughout). Final
isolated state: SM16 28/28, SM18 7/7. Trackers found fully "done" (9/9 RFI,
4/4 NC) from the earlier full run — deleted so SM05/SM06 regenerate fresh.
Live run 5 of the full 28-stage chain launched next.

### 2026-09-05: Live run 5 — 137/140, one real find (SM25's own test bug)

Run 5 (the first run after the project-`dependencies` cascade fix AND the full
SM16/SM18 saga above): **137 passed, 1 failed, 2 skipped.** SM16 and SM18 both
fully green. The 2 skips are both pre-existing, deliberate edge-case handling
(SM14's "nothing eligible to reassign" and SM20's "every candidate already
assigned" — not new, not concerning).

**The 1 failure was the test's own mistake, not the app's.** SM25 (bulk RFI
creation across 3 work areas in one session) asserts each area's RFI lands on
a distinct work SECTION, treating a repeated section label across different
areas as proof the Work Area cascade didn't re-resolve. BL13 and BL14 both
got a section labeled "R03-T28" in this run. A targeted recon
(`00_inspect_sm25_work_section_collision.spec.js`) navigated to both RFIs'
own view pages and read their VISIBLE CODES directly: `RFI-S05b-BL13-CIV-204`
and `RFI-S05b-BL14-CIV-205` — each correctly on its own requested area. Work
section labels are per-area LOCAL coordinates (e.g. "Row 3, Tower 28"), not
globally unique — two different areas legitimately sharing one is normal, not
a sign of anything stale. Fixed by replacing the section-label-uniqueness
check with the real invariant it was only ever a proxy for: each created
RFI's own visible code must contain the area it was requested for, checked
directly via `getVisibleCodeFor` (already existed, exported from
rfi-dependency-flow.js, previously unused by this file).

**Reporting side-note, not yet resolved:** `smoke-reports/results.json` and
`junit.xml` (the JSON/JUnit outputs `npm run smoke:full:artifacts` is
supposed to produce) were NOT freshly written by run 5, even though the HTML
report and the console's own list output were — both files' timestamps were
still from an earlier run. Traced the env-var mechanism itself
(`PLAYWRIGHT_JSON_OUTPUT_NAME`/`PLAYWRIGHT_JUNIT_OUTPUT_NAME`, read via
`resolveOutputFile` in `node_modules/playwright/lib/runner/index.js`) and
confirmed it DOES work correctly in isolation — reproduced the exact
cross-env + spawn chain run-smoke.js uses on a small subset and got fresh
files both times. Cause not yet identified for why the FULL chain's own run
didn't write them; watching whether run 6 does the same before investigating
further (may be worth checking with `--reporter=list,html,json,junit`
directly against the full chain rather than through the isolated
reproductions tried so far).

Trackers reset (found fully "done" again — SM05/SM06 genuinely completed
them). Live run 6 launched next with the SM25 fix in place.

### 2026-09-05: Live run 6 — FULLY GREEN (138/140, 0 failed) + the reporter fix

Run 6 (same chain, with SM25's fix applied): **138 passed, 2 skipped, 0
failed.** The 2 skips are the same pre-existing, deliberate edge-case
handling as run 5 (SM14/SM20 — nothing new). This is the first fully clean
run of the entire 28-stage, 140-test solar smoke chain since this framework
was built.

**Found and fixed why `smoke-reports/results.json`/`junit.xml` never
refreshed, across every run this session.** `run-smoke.js`'s own printed
command line showed it: `npx playwright test --workers=1 --project ... --
--reporter=list,html,json,junit` — a literal, unintended `--` sitting right
before the reporter flag. Traced to package.json's script string itself
(`"...node tests/utils/run-smoke.js solar -- --reporter=list,html,json,junit"`)
— that `--` was meant as the conventional "extra args start here" marker for
a HUMAN running `npm run smoke:full:artifacts -- --extra-flag`, but baked
directly into the script string like this, it's ALWAYS present in
run-smoke.js's own argv and was being forwarded straight through into the
final command. Playwright's CLI treats a `--` as an end-of-options marker,
so everything after it (the reporter flag) was being silently ignored in
favor of playwright.config.js's own default reporter array (`html` + `list`
only) — explaining exactly why HTML and the console's list output always
worked while JSON/JUnit output silently never did, on every single run.
Fixed by filtering a literal `'--'` token out of `passthrough` in
`run-smoke.js` (alongside the existing `'--list'` filter). Verified two ways:
(1) direct unit-level check of the filter logic on the exact real argv
shape; (2) a live `run-smoke.js` invocation (grep-narrowed to run fast)
confirmed `smoke-reports/results.json` and `junit.xml` both wrote fresh,
correctly-timestamped output for the first time.

Verified after both fixes: syntax clean, full collection still 405 tests
(401 smoke/regression-adjacent + 4 recon files under
`tests/specs/inspection/`), `git status --porcelain -- 'tests/specs/*.spec.js'
tests/online-roles` shows zero diff on any tracked file.

**Session milestone reached: the entire 28-stage solar smoke chain is fully
green, with a working HTML/JSON/JUnit report pipeline**, per the app owner's
original ask ("in one run I can get report of all specs, nothing should be
escaped... make sure all smoke are passing and I am getting extensive result
sheet at the end"). Dashboard Filter (SM16) remains flagged per the app
owner's 2026-09-05 note that it's currently affected by a real,
already-reported backend/API issue — SM16 passed cleanly in both run 5, run
6, and the reporter-fix verification run, but any future SM16 failure should
be reported factually, not investigated, until the app owner says otherwise.

### 2026-09-06: SM28 added — rule R2a finally has a test, plus the SO-Mapping/DRS not-a-bug rule

Two changes, both from the app owner's direction after the coverage review
(`docs/automation-coverage-and-gaps.md`).

#### 1. SO Mapping handing off to DRS is EXPECTED — encoded, not just documented

Full rule and reasoning: **app-owner-decisions-and-conventions.md §3.9.** Short
version: following PULSE's "SO Mapping" entry may land on the SO Mapping screen,
on PULSE's migration notice, on the **DRS login page**, or on a **DRS
application page** when DRS already has an admin session. All four are correct.

This needed code because two of the four leave the PULSE origin, and the menu
sweeps assert `not.toHaveURL(/\/login/i)` after opening each item — **DRS's own
login URL ends in `/login`**, so the hand-off was going to be reported as
"SO Mapping bounced to /login", i.e. a PULSE session failure. Worse, everything
after that assertion (the error-banner probe, `goToDashboard()`) would have been
running against a page where no PULSE locator resolves.

| Piece | Where |
|---|---|
| `isDrsUrl(url)` / `isPulseUrl(url)` — hostname-prefix match, `DRS_BASE_URL` optional | `tests/config/environments.js` |
| `SOMappingPage.DESTINATIONS` + `classifyDestination(page)` — returns which of the four, asserts nothing | `tests/pages/SOMappingPage.js` |
| `returnToPulse(page)` — closes a DRS tab if one opened, navigates back if it navigated in place | `tests/utils/helpers.js` |

Applied at all three call sites: `SM17`, spec 31 (the two menu sweeps, which now
log the hand-off and continue) and `online-role-regression.js` (which previously
only recognised the migration notice).

Matched on hostname prefix (`drs-…`) rather than a literal URL so the DRS
deployment can track the PULSE one without any test knowing which. Verified
against the real host `drs-uat.cfapps.ap11.hana.ondemand.com` for both the login
and the `/projects` landing.

#### 2. SM28 — a non-approved NC blocks RFI on the same triple (rule R2a)

**This is the gap the coverage review found (G-04).** R2a shapes the entire
ground allocation — the NC areas are disjoint from the RFI ones *because* of it,
and the chain runs RFI flows before NC flows for the same reason — and nothing
asserted it. A regression that removed the block would have passed every test in
the repo.

`tests/smoke/SM28_nc_blocks_rfi.spec.js`, project `smoke-solar-nc-block`, 5 tests,
declared after `nc-create` and before `reassign`. Solar chain is now **29
projects / 153 tests** (was 28 / 148). Wind is unchanged — the stage is gated on
`featureGround`, which wind does not declare.

The structure, and why each step is there:

| # | Step | Why it is not optional |
|---|---|---|
| 1 | CI finds a work section that is RFI-available **now**, then releases it and re-opens the form to prove it came back | An RFI permanently consumes its section (R1), so "not offered" in step 3 would otherwise be indistinguishable from "already spent by an earlier run" |
| 2 | QI raises an NC **pinned to that exact section**, left non-approved | NC create otherwise takes the first available section, which need not be the same one — the two halves would then be unrelated operations proving nothing |
| 3 | CI attempts an RFI on that exact triple → **must be refused** | The rule |
| 4 | CI attempts one on a **different** section, same activity and checkpoint → **must succeed** | The control. Without it, a broken form, a missing WAM row and a real rule all look identical |
| 5 | Probe: the blocked section under a **different activity** | R2a's second half. **Reported, never asserted** — see below |

Two shapes of "blocked" are both accepted and recorded, not asserted on: the
section vanishing from the picker (`WORK_SECTION_NOT_FOUND`) and Proceed being
refused with a validation message (`clickProceedAndCheckOutcome`). The rule is
about CI being unable to raise the RFI, not about how the app says so; pinning
the presentation would make this fail on a cosmetic change.

Step 5 stays a probe on purpose. Two things about it are genuinely unconfirmed —
whether `Piling - Robotic Docking System` shares this work section's inventory at
all, and what its own first checkpoint's dependency state is — so a negative
result could mean either of those rather than a broken rule. Same
CONFIRMED-vs-ASSUMED convention the rest of the config uses.

**Ground: `featureGround.ncBlock` = `BL06`.** The stage deliberately leaves a
non-approved NC in place — that *is* the precondition, so cleaning it up would
destroy what the next run needs. BL06 is right rather than a new area because it
is already provisioned (in `profile.workAreas`, so SM03 maps the flow users onto
it and SM27 restores that), already claimed against `resolveFlowWorkAreas`'s
fallthrough pool, and free since SO demapping moved to DRS. A brand-new BL15+ is
not confirmed to exist — the app owner confirmed BL08–BL14 only. Verified that
adding it changes no existing pool: `rfi/desktop` and `nc/desktop` resolve
exactly as before.

Re-runnable indefinitely: one work section spent per run (the control arm's
RFI), against ~264–490 per area. The NC arm spends nothing.

One supporting change, additive: `NCCreatePage.fillForm` now **returns** the work
sections it picked and accepts `preferredWorkSections` to pin them. Every
pre-existing caller ignores the return value and passes no preference, so
behaviour is unchanged.

**NOT YET RUN LIVE.** Syntax, collection and config resolution are verified;
the assertions themselves have not been exercised against the app. One value is
ASSUMED and will fail loudly at the Activity dropdown if wrong: that
`Piling - MMS` appears in the **NC** form's Activity list. Every NC this suite
has created used `Piling - Robotic Docking System`, so the MMS activity has
never been selected there — both are Civil activities for the same vendor, so it
is likely, and it is a one-line fix in `profile.ncBlock` if not.

### 2026-09-06: parallel lanes — cutting the ~2 h chain without losing one report

Branch `parallel-lanes-and-gaps`. Rollback point is `smoke-suite-next` @ `3536b81`
on GitHub.

The chain is ~2 h at `--workers=1`, and every gap closed from
`docs/automation-coverage-and-gaps.md` adds to it. The app owner's question was
the right one: parallelism is easy, **consolidating the report is the worry.**

#### The consolidation worry turns out to be unfounded — but only for one topology

`--workers=N` is the wrong lever, and this is the crux. Playwright hands test
files to whichever worker is free, so you cannot say WHICH stages run together.
That would let `SM19` and `SM22` (both mutating `BL10`) overlap, or run `SM14`
before the stages that create the pending items it needs. This suite's safety has
never come from the worker count — it comes from which stages may overlap, and
that has to be **declared**.

So a lane is **one `playwright test` process with an explicit `--project` list
and `--workers=1` inside it**. Lanes run concurrently; order within a lane is
exactly what it is today. Each writes a `blob` report, and at the end they merge
into the same `html` + `json` + `junit` artifacts the serial `:artifacts` scripts
produce. That is Playwright's own sharded-report mechanism — nothing invented.

**Verified live 2026-09-06**, two lanes (one passing, one deliberately failing)
merged into a single report reading `tests="4" failures="1"` with both spec files
present, plus `merged.json`, `merged.xml` and an HTML report.

Three mechanics were established empirically, and each would have been a silent
bug:

| Mechanic | What was found |
|---|---|
| `PLAYWRIGHT_BLOB_OUTPUT_DIR` | Does control blob location. Set per lane, so two lanes cannot race on one filename. |
| `merge-reports` **does not recurse** | Pointed at a parent of per-lane subdirectories it reports "No report files found". The zips must be collected into one flat directory first. |
| **Every lane needs its own `--output`** | Playwright CLEARS `outputDir` (`test-results/`) at the start of every run. Five concurrent lanes on the default would wipe each other's in-flight screenshots and traces, last-starter wins, silently. |

#### The rule that makes lanes safe, and why it is enforced rather than documented

App owner, 2026-09-06: *"admin/any other users can hold as many session as much
we want, there is no restriction as of now."* That removes identity from the
problem entirely — two lanes may both drive Admin, or both drive the smoke CI.

What remains is **ground**. Two stages may sit in different lanes only if they
touch no work area in common and neither consumes the other's output. That is not
left to a comment: `tests/config/lanes.js` declares each stage's ground
**symbolically** (`featureGround.wamMutate`, `{flow:'rfi',viewport:'desktop'}`,
`dependencyChain`, `global`), resolves it against the live profile, and
`assertLanesAreDisjoint()` **throws** rather than warns. A lane run with
overlapping ground produces failures that look like app bugs, which costs far
more than refusing to start.

Symbolic rather than literal matters: `ncCreate` resolves to `BL03` today only
because of the TEMPORARY-BL03 vendor bug. When it reverts to `BL05` the validator
recomputes on its own and the lanes become **more** separable with no edit.

Four checks, all confirmed to fire (each was deliberately broken and caught):

1. two lanes touching the same work area;
2. a `global` stage (one that asserts across every mapped area) inside a lane
   instead of the epilogue;
3. **user-creating stages split across lanes** — app owner: *"Keep every
   user-creating stage in one lane, this seems important."*
   `user-creation-counter.json` and `last-created-users.json` are
   read-modify-**write**, so two lanes creating users concurrently lose entries —
   and a lost entry does not fail where it happens, it fails later in whatever
   stage tries to log in as the user that vanished;
4. a stage that exists but was assigned to no lane, which would be silently
   skipped — against the whole "in one run nothing should be escaped" premise.

#### The layout

```
prefix (serial)   users -> wam
   |
   +-- flow-desktop  draft-autosave, rfi-desktop, nc-desktop,        BL03 BL05 BL07  ~42m
   |                 data-integrity, dependency, nc-create
   +-- flow-mobile   rfi-mobile, nc-mobile                           BL03 BL04 BL05  ~31m
   +-- wam           users-batch, wam-basics/ci/all-roles,           BL06 BL08-BL10  ~40m
   |                 wam-hierarchy, nc-block, wam-patch(+hier),
   |                 wam-demap(+hier)
   +-- creation      rfi-create, rfi-bulk, rfi-bulk-multi            BL11-BL14       ~15m
   +-- readonly      dashboard-admin/filter, hier-dashboard,         (no ground)     ~30m
   |                 online-roles
   |
epilogue (serial) reassign -> restore
```

`reassign` is in the epilogue because it **consumes** what the creation stages
produce — it can only reassign something still pending, and those stages are now
spread across three lanes. Waiting for all of them is the only way it is fed by
design rather than by luck (it failed exactly that way on 2026-09-05).
`restore` is there because it re-asserts the mapping across every area, so it
must not overlap anything that mutates. It runs **even if a lane failed** — the
run where a lane died mid-mutation is the one that needs it most.

Expected wall clock **~50 min against ~120**, bounded by `flow-desktop`.

**The one thing blocking ~45 min or better:** `flow-desktop` and `flow-mobile`
both touch `BL03`, because `nc-mobile` resolves there under TEMPORARY-BL03. NC
consumes nothing and duplicate NCs are legal, so the overlap is benign — but
"benign in principle" is not something to build a parallel run on, so it is
recorded as a **named exception** in `KNOWN_GROUND_OVERLAPS` rather than passing
silently. Reverting NC to `BL05` deletes the exception and frees the split.

#### Commands

| Script | What |
|---|---|
| `npm run smoke:lanes:plan` | Print the lane plan and the ground each lane touches. Runs nothing. |
| `npm run smoke:lanes` | The full laned run + merged report. |
| `npm run smoke:lanes:qa` / `:test` | Same, pinned to an environment. |
| `node tests/utils/run-smoke-lanes.js solar --lane wam` | One lane on its own. |

**`npm run smoke:full` is untouched** and remains the known-good serial path.
Lanes are additive until a full laned run has been proven live.

Wind degrades correctly without special-casing: it has 8 stages and no feature
tier, so three lanes come back empty and are dropped rather than spawned.

#### Still to do

Nothing here has run against the app yet — a full solar chain run of the app
owner's was in flight throughout (started 13:53, still going at 17:10, ~3h20m),
and the one-run-at-a-time rule holds. First laned run should be
`npm run smoke:lanes:plan`, then a single lane (`--lane readonly` is the safest —
no ground at all), then the whole thing.

### 2026-09-06 (later): first laned run — 18 min, and four things it settled

`npm run smoke:lanes -- --lane readonly` on pulse-test (SM15/16/17/18, 43 tests).
**40 passed, 3 failed, 18.0 min** — against 30 estimated, and against 7 SM18
failures in that morning's serial run.

#### 1. The lane mechanism works, after one real bug

The very first attempt died instantly:

```
EPERM: operation not permitted, mkdir 'C:\Users\Vijendra'
```

`spawn` needs `shell: true` for `npx` on Windows (without it: ENOENT — the same
reason `run-smoke.js` sets it). But **with a shell, Node concatenates the argv
array instead of passing it through, so nothing is escaped** — Node even warns
about this (DEP0190). This repo lives at
`C:\Users\Vijendra Kumar\Downloads\Automation playwright script`, so the
absolute `--output` path split at the first space.

Fixed two ways, because either alone is a single point of failure: paths passed
as argv are now **repo-relative** (cwd is ROOT, so there is no space to split
on), **and** anything still containing a space is quoted. Env vars were never
affected — `spawn` passes `env` as an object, which the shell never re-parses,
which is why `PLAYWRIGHT_BLOB_OUTPUT_DIR` worked from the start.

**Second lesson, cheaper but just as real:** the first launch was piped through
`tail`, so the reported exit code was `tail`'s (0) and hid a failing run. Do not
pipe a run whose exit code matters.

#### 2. The TAT chart fix is confirmed — 5 failures became 0

CAD, SAD, PM and CM now pass; the log shows the intended path taken:

```
[CM] Dashboard: TAT Summary: INCONCLUSIVE — the chart drew NO data on either
     RFI or NC (fingerprint "202x136::") ...
```

**One defect in that change, found by reading its own output:** the
"confirmed the chart's rendered content actually changes" line printed
*unconditionally* after the if/else, so CM's log carried both that and
INCONCLUSIVE for the same chart, two lines apart. A log that contradicts itself
is worse than no log — it is exactly what someone reads when deciding whether a
result can be trusted. The summary line now reflects which branch actually ran.

#### 3. The Reports download: hypothesis CONFIRMED, so it is now a real fix

The morning's diagnostic-only change did its job in one run. Both failures came
back with:

```
[downloadAndParse context] label="EL_rfi_status" totalCountOnScreen=0 toast=none
```

So the app raises **no download event and no message** when there is nothing to
export. That is a data/scope condition for a role whose WAM scope covers no
RFIs — not a defect, and not worth a 30-second timeout.

`downloadAndParse` now returns `{ rowCount: 0, rows: [], headers: [],
emptyReport: true }` when Total Count reads 0, instead of waiting. Note it
returns an explicit empty result rather than skipping: the caller asserts
`rowCount === totalCount`, and `0 === 0` keeps that assertion **real** for this
case rather than bypassing it. The caller also suppresses its
"could not find a status-like column" warning for an empty report, which would
otherwise read as a broken report rather than an empty one.

This is the payoff for not "fixing" it on the hypothesis that morning: the fix
is now backed by an observation instead of a guess.

#### 4. Plot Admin: a previously-MASKED failure, not a new one

```
[PAD] SO Mapping: 0/0 activity rows
Error: PAD: SO Mapping should render at least one activity row for BL01/Civil
```

PAD used to fail earlier in the same test, on the TAT chart, and **never reached
this line**. Once that stopped being a false failure the test got further and
exposed this. Worth stating plainly: fixing a false failure will surface
whatever it was hiding, and that looks like a regression when it is the opposite.

The assertion itself is wrong now, for two independent reasons:

* **SO Mapping is not a PULSE feature any more.** It moved to DRS on 2026-09-04;
  `/so-mapping` is vestigial and the menu entry hands off (§3.9). Asserting that
  a removed screen renders activity rows is asserting on a vestige. The app is
  not even consistent about it — some roles get the "moved to DRS" notice, Plot
  Admin gets a real-but-empty screen.
* **The cascade is hardcoded to `A-06c`/`BL01`**, the regression tier's ground
  and the app owner's manual-testing location. A hierarchy role whose
  jurisdiction excludes `A-06c` correctly sees nothing there — Plot Admin's
  scoping to its own work locations is confirmed live — so 0 rows is the RIGHT
  answer for such a role.

Replaced with the check that still means something: the screen must not render
an error page. The row count is reported.

#### Timing, measured

| | |
|---|---|
| `readonly` lane, 43 tests | **18.0 min** |
| of which SM16 dashboard-filter alone | 8.9 min |

That is the lane the estimate put at ~30 min, so the ~50 min projection for the
full laned run is if anything conservative.

### 2026-09-06: BL03 is the ONLY NC-capable work area on S05b — measured

SM28's first live run failed at the NC create form:

```
locator.waitFor: Timeout 5000ms exceeded
waiting for [role=option] filter({ hasText: 'CHOUHAN' })
```

The config records this as a **BL05-specific** bug (app owner, 2026-09-05:
"vendor name is not populating for BL05 while creating NC ... for BL03 vendor is
populating"). It is not BL05-specific. A read-only probe
(`tests/specs/inspection/00_inspect_nc_vendor_by_work_area.spec.js`, QI, nine
areas, 20s polled per area to separate EMPTY from SLOW) measured:

| Work area | Vendor options |
|---|---|
| **BL03** | **1 — `M S CHOUHAN INFRAVENTURES PVT LTD`** |
| BL04, BL05, BL06, BL07, BL08, BL10, BL11, BL12 | **0** |

BL03 was included as a control and did show the vendor, so the probe is sound.

**This is an app-side constraint, and probably an app bug.** The app owner's own
statement is that the Service Order is mapped across the WHOLE of S05b — which
is what the vendor dropdown is gated on — so eight of nine areas returning an
empty vendor list contradicts the mapping. Worth raising: it is not a
test-harness problem and nothing in this suite can work around it.

**What it costs the design.** Rule R2's whole point is that NC ground must be
DISJOINT from RFI ground, because a non-approved NC blocks RFI on the same
triple. With BL03 the only NC-capable area, that separation is currently
impossible on S05b:

* `flowWorkAreas.nc` (both viewports), `featureGround.ncCreate` and any NC stage
  must all sit on BL03;
* BL03 is also the RFI desktop flow area.

So the three TEMPORARY-BL03 markers in `tests/config/projects.js` are not a
one-day workaround that can be moved to a spare area — **BL03 is the only option
until the vendor bug is fixed**, and reverting to BL05 is not currently possible.

**And it blocks SM28's ground choice specifically.** SM28 deliberately leaves a
non-approved NC behind, so it needs ground no flow stage uses. BL06 was chosen
for exactly that reason and cannot host an NC at all. The remaining options all
have real costs and the choice is the app owner's, since it trades against flow
ground — see the open question below.

### 2026-09-06: trackers are now keyed by ENVIRONMENT too — found by switching to qa

Moving this work from pulse-test to pulse-qa (app owner, 2026-09-06) exposed a
latent bug that had been sitting in the tracker layer since it was built.

Tracker filenames were keyed by **flow × profile × viewport × TC set** — and not
by deployment:

```
rfi-tracker.solar-e2e.desktop.full.json
```

But a tracker stores **live server state**: real `rfiId`/`ncId` UUIDs and visible
codes, which exist on exactly one deployment. The file on disk at the moment of
the switch held `rfiId 4c788644-…` / `RFI-S05b-BL03-CIV-149`, created on
pulse-test.

**Neither failure mode would have looked like stale state.** Run SM05 on qa
against that file and either:

* every TC reads `done`, the run is refused, and it looks like a clean pass; or
* a TC resumes and hunts for an RFI that is not there, surfacing as
  `RFI_NOT_VISIBLE_TO_ACTOR` — which §11 of this document already records as
  reading exactly like an app bug (it cost real time once already).

This is the same failure `smoke-users.js`'s `baseUrl` guard was written for
("THE FILE HAS NO ENVIRONMENT DIMENSION… a completely clean-looking run that had
created nothing"), one layer down. It was fixed for users and missed for
trackers.

**Fixed by keying the FILENAME, not by guarding the contents:**

```
rfi-tracker.solar-e2e.qa.desktop.full.json
```

Both deployments' state can then coexist, so switching environments and
switching back destroys neither, and there is no reset step to remember — which
matters because the reset step is exactly what gets forgotten (a forgotten
tracker reset was most of run 3's 22 failures on 2026-09-05).

The four pre-env-keying files are **detected and reported**, never deleted:

```
[tracker] starting FRESH state at rfi-tracker.solar-e2e.qa.desktop.full.json.
[tracker] tracker filenames now include the environment (added 2026-09-06) because a
[tracker] tracker holds live rfiId/ncId values that exist on ONE deployment only.
[tracker] these pre-existing files predate that and are being IGNORED, not lost:
[tracker]   rfi-tracker.solar-e2e.desktop.full.json
[tracker]   ...
```

They are the record of a real run against *some* deployment, and which one is no
longer knowable from the name, so deleting them is not the code's call.

**qa prefix, measured 2026-09-06:** `SM01` + `SM03` = **14 passed, 3.8 min**
(10 users at ~14 s each, 4 WAM assignments at ~19 s each).

### 2026-09-06 (correction): the vendor gap is pulse-test DATA, not an app bug

The entry above concluded "an app-side constraint, and probably an app bug". **That
was wrong**, and the app owner's instinct to switch environments is what settled
it. The identical probe on **pulse-qa**:

| Work area | pulse-test | pulse-qa |
|---|---|---|
| BL03 | 1 vendor | 1 vendor |
| BL04, BL05, BL06, BL07, BL10, BL11, BL12 | **0** | **1 vendor each** |
| BL08 | 0 | 0 — *and explained, see below* |

So the vendor dropdown works correctly on qa across the whole band. The gap is
**pulse-test's own SO/vendor data**, not app behaviour, and there is nothing to
report to the developers. Do not raise it as a defect.

**BL08 on qa is not a failure either.** The probe error there is
`locator.waitFor: Timeout 5000ms` on the **Work Area** dropdown, not the vendor
one — BL08 never appears in the QI's list at all. That is correct and
deliberate: `featureGround.wamSweep` (BL08/BL09) is **not** pre-mapped by SM03,
because proving Admin can assign there IS SM11/12/13's coverage. A user with no
WAM row on an area cannot see it. The probe found the right answer for the wrong
field, which is worth stating so it is not re-investigated.

**Consequences.**

* **SM28 keeps `BL06`.** Its ground choice was right; only the deployment was
  wrong. No config change needed.
* **Rule R2's disjoint-ground premise holds on qa** — NC does not have to share
  BL03 with the RFI flow.
* **TEMPORARY-BL03 is now environment-specific**, and this is the one thing left
  open. `flowWorkAreas.nc` and `featureGround.ncCreate` point at BL03 solely
  because of the pulse-test data gap. On qa they could revert to BL05, which
  would make `flow-desktop` and `flow-mobile` fully disjoint and let
  `KNOWN_GROUND_OVERLAPS` be deleted — worth ~10 minutes off a laned run.
  **Not changed here**: `tests/config/projects.js` has no environment dimension
  for ground, so reverting would fix qa and break pulse-test. Needs either a
  decision to run only on qa, or per-environment ground in the profile.

**Method note worth keeping.** The probe was written to separate EMPTY from SLOW
(20 s polled per area) and to carry a control (BL03). Both earned their place:
the control is what made the pulse-test result trustworthy, and the empty/slow
split is what stopped "no vendor in 5 s" being read as "no vendor".

### 2026-09-06: SM28 GREEN on qa — rule R2a proven live, and the app's own message overstates it

`smoke-solar-nc-block` on pulse-qa: **5 passed, 3.6 min.** Gap **G-04 is closed**,
verified rather than claimed.

The run, in order:

```
work section summary: total=264 selected=0 pending=264
candidate work section: "R01-T01"            <- proved RFI-available, then released
NC 9966d1e0-... created on "R01-T01" and left non-approved
CONFIRMED blocked (proceed-refused)
CONFIRMED scoped: "R01-T01" is blocked, "R01-T02" is not
```

#### The app's real wording, captured for the first time

> **Validation Error**
> **"NC Has been raised for atleast one workSection, on the given Activity for Contractor."**

This repo had never recorded it — `clickProceedAndCheckOutcome`'s comment says
the wording "isn't hardcoded anywhere in this repo yet", which is why the stage
records the text instead of asserting on it.

#### The message is MISLEADING, and the control arm is what proves it

Read literally, *"NC has been raised for **at least one** workSection, on the
given **Activity**"* says: one NC anywhere on an activity blocks that activity.
Anyone hitting this in the app would reasonably conclude their whole activity is
locked.

**It is not.** The control arm raised an RFI on `R01-T02` — same activity, same
checkpoint, different work section — and it **succeeded**. So the enforcement is
per work section; only the message is activity-wide. That gap between wording and
behaviour is exactly what the control arm existed to expose, and it is worth
knowing before someone debugs a "blocked activity" that is not blocked.

#### What is now PROVEN, and what is still ASSUMED

**Proven live:**

* an unapproved NC on (activity A, work section S) **blocks** RFI create for
  (activity A, checkpoint C, section S);
* the same activity and checkpoint on a **different** section is **not** blocked
  — so the block is keyed on the section, not the work area and not the activity.

**Still assumed — and the message now casts doubt on one of them.** R2a is
documented as keyed on the triple *(activity/sub-activity, inspection
checkpoint, work section)*, but the app's message mentions **Activity**,
**workSection** and **Contractor** — and **no checkpoint at all**:

1. **Is the checkpoint really part of the key?** SM28 uses one checkpoint
   throughout, so a *different* checkpoint on the blocked section was never
   attempted. If the checkpoint is not in the key, R2a's own wording is wrong.
2. **Is a different ACTIVITY on the blocked section unaffected?** SM28's probe
   for this returned INCONCLUSIVE (`locator.waitFor: Timeout 500ms`) — it never
   reached the comparison. Left as a probe on purpose; it asserts nothing.
3. **"for Contractor"** suggests the block is also scoped per contractor, which
   nothing here tests.

Both are cheap follow-ups on the same stage and neither blocks anything today.
They are recorded rather than guessed.

#### Ground

BL06 was the right choice all along — only pulse-test's vendor data was wrong.
Each run spends exactly one work section (the control arm's RFI) out of 264, and
the NC arm spends nothing, so this is re-runnable indefinitely.
