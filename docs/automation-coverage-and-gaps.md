# Automation coverage and the gap register

Compiled 2026-09-06 off the repository itself (`tests/`, `tests/config/`,
`playwright.config.js`, `docs/`) rather than off a run.

**Last updated 2026-09-15: RFI↔NC LINKAGE CLOSED AND VERIFIED LIVE — G-01 (single linked NC), G-29 (two NCs, the plural rule) and G-30 (an NC rejected back to CI), specs `36`/`37`/`38` on pulse-qa. New §2b records the test-infrastructure landmines found on the way, all of which produce a silently wrong reading rather than a failure. NOTE: 37/38 were filed as G-27/G-27b during the run and are renumbered here — G-27 was already action-level authorisation, and their log lines still say G-27, as do the NC descriptions they wrote into live data.**

**Last updated 2026-09-11: G-14 upload+propagation CLOSED AND VERIFIED LIVE (new G-28 for deletion; download looks not-applicable) · G-04 CLOSED AND VERIFIED LIVE · G-18 route level CLOSED AND VERIFIED LIVE (new G-27 records what it could not reach) · G-03 WITHDRAWN (my error — it was already covered)** — `SM28_nc_blocks_rfi.spec.js` now asserts
rule R2a. See docs/smoke-e2e-framework.md's 2026-09-06 entry.

The full illustrated version — execution topology, the RFI/NC state machines,
the S05b ground map and the WAM cascade, all drawn — is published at:

> **https://claude.ai/code/artifact/ae16a923-a3c7-44ae-9fb8-25b64c0454d1**

This file carries the durable part: the numbers, and the register of what is
**not** covered. Update the register here when a gap is closed or a new one is
found; the artifact is regenerated from it.

---

## 1. Measured shape

| | |
|---|---|
| Tests collected, whole repo | **443** in 112 files |
| Solar smoke chain | **153** tests across **29** Playwright projects |
| Wind chain | 39 tests (setup-only; RFI/NC parked) |
| Regression + exploration (`chromium`) | 232 tests |
| Last full solar run recorded | **138 passed / 2 skipped / 0 failed** (2026-09-05, run 6) |
| Page objects | 19 |
| Test-suite source | 29,545 lines |
| Reference docs | 10 files, 5,304 lines |

**Tiers** — separated by *who they log in as* and *what state they own*, not by
what they test:

| Tier | Path | Files | Logs in as | Owns |
|---|---|---|---|---|
| Smoke chain | `tests/smoke/` | 28 | users it creates itself | `fixtures/smoke/*.json` |
| Regression | `tests/specs/` | 33 | `.env` CI/EE/QI | `fixtures/rfi-tracker.json`, `nc-tracker.json` |
| Online roles | `tests/online-roles/` | 7 | `.env` hierarchy users | — read-mostly |
| Recon | `tests/specs/inspection/` | 43 | varies | — captures only |

---

## 2. Gap register

Severity is about what a regression here would cost, not about effort.
`parked` items are parked by explicit app-owner instruction — **do not start
them unprompted.**

### Parked

| ID | Gap | State |
|---|---|---|
| ~~G-01~~ | ~~**RFI↔NC linkage.**~~ **CLOSED FOR THE SINGLE-NC CASE, VERIFIED LIVE 2026-09-15** — `tests/specs/36_rfi_linked_nc_lifecycle.spec.js` (8 tests, 5.7 min on pulse-qa, `.env` CI/EE/QI on A-06c/BL01). Park lifted by the user asking for the feature on 2026-09-15. Walks the whole nested workflow: QI rejects with a linked NC → **CI's resubmit is refused** → CI responds (root cause + corrective action) → EE approves → QI approves → **CI's resubmit now succeeds**. The gate is asserted in BOTH directions, since an RFI that can never be resubmitted would also satisfy the blocked half. **THE BLOCK BITES AT THE FINAL SUBMIT** — the RFI *is* in CI's queue (~5s after the rejection) and `Proceed` *is* allowed, so "reached page 2" ≠ "resubmitted"; see `rfi-business-logic.md` §10a, which also records two wrong readings of the enforcement point and what caused each. Panel locators live in `RFIReviewPage`, captured by `tests/specs/inspection/00_inspect_rfi_linked_nc_panel.spec.js`. **Closed the same day: G-29** (multi-NC) and **G-30** (NC rejected back to CI). | single-NC closed |
| ~~G-29~~ | ~~**Multiple linked NCs on one RFI.**~~ **CLOSED, VERIFIED LIVE 2026-09-15** — `tests/specs/37_rfi_linked_nc_multi.spec.js` (7 tests, 9.8 min on pulse-qa). Two Not-Ok questions produce **two distinct NC records** (`CIV-12`, `CIV-13`, each matched by its own panel's description, not by row order). **THE PLURAL RULE HOLDS:** both open → refused; **NC #1 approved and #2 still open → still refused** (`proceeded=true, submitted=false`); both approved → released. That middle step is the whole point — with a single NC, "is ANY NC approved?" and "are ALL NCs approved?" return identical answers, so G-01 could not have detected the difference. Found a real defect in our own page object that only two panels can expose: Ark UI mounts one date-picker content per panel and keeps closed ones in the DOM, so the page-level locator was a strict-mode violation (now scoped to `data-state="open"`). | closed |
| ~~G-30~~ | ~~**Linked NC rejected back to CI.**~~ **CLOSED, VERIFIED LIVE 2026-09-15** — `tests/specs/38_rfi_linked_nc_reject_rounds.spec.js` (7 tests, 9.2 min on pulse-qa). The app owner's description includes *"with rejections flowing back to the contractor in charge for resubmission"*, which G-01's happy path never exercised. Bounces one linked NC **twice** — EE rejects, then (after an EE approval) QI rejects — asserting each time that the NC **returns to CI's queue** and that **the RFI is still blocked**. Both reviewers are tested because they are not symmetric (EE reviews first, so QI's return leg is its own claim). Finally: three CI submissions and two rejections later, both approve and **the RFI is released** — which rules out the mirror-image defect of a bounce leaving state behind that gates the RFI forever. | closed |
| G-02 | **Wind RFI and NC flows.** `WIND_E2E.nc` is `null` (form never opened); only six WTG-Mandvi areas are SO-mapped in DRS against a nine-case matrix. Live options: a reduced wind TC set, or a different activity mapped across all seven areas. | parked 2026-09-04 |

### Documented app behaviour with no assertion behind it

| ID | Gap | Severity |
|---|---|---|
| ~~G-03~~ | ~~**The checkpoint-dependency block is never proven.**~~ **WITHDRAWN 2026-09-06 — this was my error, not a gap.** `runDependencyChainForActivity` and `runDependencyChainForScarceWorkSectionActivity` (`tests/utils/rfi-dependency-flow.js`) each assert the block twice: `expect(firstAttempt.proceeded).toBe(false)` before checkpoint[0] exists, and `expect(nextAttempt.proceeded).toBe(false)` when checkpoint[i] exists but is **not yet approved** — which specifically proves the app checks *approved*, not merely *created*. `createAndSubmitCheckpoint` throws if a now-unblocked checkpoint is still refused, so the positive control is there too. Run by SM07, spec 29 and spec 30. A regression removing the block would fail immediately. I reported this as uncovered after reading only the spec files and the driver's headline comment, without reading the driver body. | not a gap |
| ~~G-04~~ | ~~**The NC-blocks-RFI rule (R2a) is designed around, never tested.**~~ **CLOSED 2026-09-06** — `tests/smoke/SM28_nc_blocks_rfi.spec.js` (project `smoke-solar-nc-block`, 5 tests, ground `featureGround.ncBlock` = BL06). Asserts the block AND the control arm (a different work section, same activity and checkpoint, must still succeed); R2a's "different activity, same section" half is a reported-only probe, since neither the shared section inventory nor that activity's own dependency state is confirmed. **VERIFIED LIVE 2026-09-06 on pulse-qa: 5 passed, 3.6 min.** The app's real wording was captured for the first time (*"NC Has been raised for atleast one workSection, on the given Activity for Contractor"*) and it OVERSTATES the rule — the control arm proved a different work section on the same activity and checkpoint still succeeds. Two follow-ups recorded, not guessed: whether the checkpoint is really part of the key (the message does not mention it), and whether a different activity on the blocked section is unaffected (that probe was inconclusive). | closed |
| G-05 | **Cross-activity dependency (Table / Inverter / Block).** Min-Unit-of-RFI scoping is fully documented in `rfi-business-logic.md` §6b and entirely unautomated. Never tried live. | high |
| G-06 | **Quantity / UOM.** `rfiQuantity`, `unit`, `subContractor` are `null` in every profile, so UOM-mandatory-when-quantity-entered and the app-filtered UOM dropdown have never been exercised. | medium |
| G-07 | **Work-section changes on resubmit** — add / remove / change, and the "target section must not already carry an active RFI" constraint. | medium |
| G-08 | **Multi-section RFI.** Every RFI in the suite selects exactly one work section. | medium |
| G-09 | **Draft deletion and withdrawal.** Drafts are created and resumed at every cascade depth; deleting one, or withdrawing a submitted RFI, has no coverage — and a stuck draft holding a work section is a known way to lose ground. | medium |

### Product surfaces with no coverage at all

| ID | Gap | Severity |
|---|---|---|
| G-10 | **Notifications.** The bell appears in recon captures only as an element to avoid. Nothing opens it; nothing asserts an approval/rejection produces one. | medium |
| G-11 | **Reports beyond a total and one download.** No per-filter correctness, and no cross-check that report rows agree with the same data on the RFI/NC list. | medium |
| G-12 | **Logout and session invalidation.** `DashboardPage.logout()` exists; no test drives it as the behaviour under test, and nothing asserts a logged-out session cannot reach a protected route. | medium |
| G-13 | **Search.** User Management search is used only as a helper; its semantics (partial match, no-result state) are never asserted. | low |
| ~~G-14~~ | ~~**RFI attachments.**~~ **UPLOAD + PROPAGATION CLOSED AND VERIFIED LIVE 2026-09-11** — `tests/specs/34_rfi_attachments.spec.js` (4 tests, 2.3 min on pulse-test). CI attaches a photo to a checklist item (16 boxes, one per item) and it reaches BOTH reviewers: `images 0→1` on CI, `1` on EE's review, `1` on QI's after EE approves. RFI renders a "View Attachments" label like NC, but the thumbnail is also inline. **DOWNLOAD: no download control exists on any of the four screens** — that half looks NOT-APPLICABLE rather than uncovered; confirm with the app owner before building for it. Follow-up noted as G-28 (the thumbnail has an `×` remove control, so deletion is untested). | upload+propagation closed |
| G-28 | **RFI attachment deletion.** The thumbnail carries its own `×` remove control (seen live 2026-09-11 while closing G-14). Adding a photo is now covered; removing one is not, and a removal that does not persist would silently leave evidence attached to an RFI the CI meant to clear. | low |
| G-15 | **Profile, settings, theme toggle.** Never opened. | low |
| G-16 | **NC list depth.** The grid is driven only to find a row by code; its own sorting/filtering/pagination is untested outside the shared dashboard filter. | low |

### Structural and non-functional

| ID | Gap | Severity |
|---|---|---|
| G-17 | **No API-layer testing whatsoever.** Zero uses of Playwright's `request` fixture across 29,500 lines. Everything is UI, which is most of why a full chain is 6–8 hours and why server-side truths can only be inferred from a rendered screen. | high |
| ~~G-18~~ | ~~**No negative authorisation tests.**~~ **ROUTE LEVEL CLOSED 2026-09-06, VERIFIED LIVE** — `tests/specs/33_negative_authorisation.spec.js` (7 tests, 2.7 min on pulse-qa). Admin walks the menu and records name→URL (routes are recorded nowhere in the repo — every page object reaches them by clicking); each role is then denied every screen its own menu omits. **The app enforces by redirecting to /dashboard.** **What it also measured:** route-level permission is BINARY — Admin (8 items) vs CAD (6) vs PM/EL/QL/CM/**CI** (5, identical). Only Configuration and Admin RFI UI are ever forbidden. PULSE scopes roles INSIDE screens, not by withholding routes, so the remaining negative coverage is action-level (e.g. "PM's WAM Role dropdown must not offer Cluster Admin") — tracked as G-27. Open question for the app owner: should CI have WAM and Users in its menu at all? | route level closed |
| G-27 | **Action-level authorisation is untested.** G-18 proved route-level denial and found it is only Admin-vs-rest — PULSE scopes roles *within* screens. Nothing asserts that a tier is denied an in-screen action: PM must not be offered Cluster Admin in WAM's Role dropdown, CM must not be able to assign above Contractor Incharge, Add User must be inactive for PM/EL/QL/CM. `WAMPage.getAvailableRoleOptions` exists and spec 18 asserts the positive direction per tier, so the negative form is a small addition. | high |
| G-19 | **Mobile stops at the two flows.** SM05/SM06 run at Pixel 7; none of the 18 feature stages do — so mobile WAM, dashboard filter, Add User and reassign are unverified, on an app whose desktop nav is replaced by an unlabeled hamburger. | medium |
| G-20 | **No CI pipeline.** JUnit/JSON reporters are wired and working; there is no workflow file to consume them. Every run is hand-launched. | medium |
| G-21 | **No run history.** `smoke-reports/` is gitignored and overwritten each run, so flake frequency, stage-duration drift and pass-rate trend are invisible. | low |
| G-22 | **Chromium only.** Firefox/WebKit scripts exist in `package.json`; no project defines them. Reasonable for an internal PWA — worth recording as a decision rather than leaving as an accident. | low |
| G-23 | **No accessibility checks.** No axe integration anywhere. | low |
| G-24 | **No visual regression.** No `toHaveScreenshot` baselines, on an app with a lot of layout-conditional behaviour. | low |
| G-25 | **PWA offline behaviour untested.** CI/EE/QI are offline-capable PWA accounts — that is why they cost 3–6 min to log in — yet service-worker caching, queued submission and reconnect reconciliation have no coverage. | medium |
| G-26 | **SM16's signal is currently discounted.** The 28 dashboard-filter tests pass, but the screen sits on a known, already-reported backend issue; a future failure there is to be reported factually, not investigated. Re-validate once fixed. | watch |

---

## 2b. Test-infrastructure landmines (not app defects)

Locator and timing traps in **our own** code that produce a *silently wrong
reading* rather than a clean failure. All five below were found on 2026-09-15
while closing G-01 and G-29, each after it had already sent a run to the wrong conclusion.

| What | Why it is dangerous | Status |
|---|---|---|
| **`NCTasksPage.ncTab` is `button:has-text("NC")`.** Playwright's `:has-text()` is a CASE-INSENSITIVE SUBSTRING match, so it also matches **"Cancel"** (ca-**nc**-el) and any other label containing "nc"; `.first()` then takes whichever is first in the DOM. | The tab click reports success, the page stays on the RFI tab, and whatever reads the grid next reads **RFI rows believing they are NC rows**. Seen live: three consecutive attempts, no error, RFI grid throughout. Used by `tests/utils/nc-nav.js` and `32_nc_draft_autosave.spec.js`. | **OPEN.** Spec 36 carries a strict local version (`clickNcTabExactly`, exact `^NC$` on role=tab/button). Not changed centrally because that locator is load-bearing for the whole NC flow suite — fix it with an NC-flow run to confirm. |
| **`BasePage.capturePhoto()` returns when the camera modal CLOSES, not when a photo attaches.** Its own comments record that the Capture click can no-op on a stream that has not started rendering frames. | The next Submit/Review silently no-ops on the unfilled mandatory photo, and surfaces 15–20s later as "the dialog never appeared" / "Review button still visible" — pointing at the wrong thing entirely. The app's real complaint (*"At least one photo is required"*) renders INLINE, not as a toast, so an error handler that only reads toasts reports "no message". | **Fixed at two call sites:** `RFIReviewPage.captureLinkedNcPhoto` (thumbnail `<img>` inside the panel) and `NCReviewPage._capturePhotoVerified` (page-level image-count delta), both retrying 3× then failing loudly. Other `capturePhoto()` callers are still unverified. |
| **`RFIListPage.scrollToRowByCode` jumps to the grid's BOTTOM** (`scrollTop = scrollHeight`) on every pass, per its documented assumption that newly touched rows sort there. | A row sitting **mid-list** is never mounted, so a row that is plainly present is reported "not found in Pending with me". This flipped G-01's own headline finding between two consecutive runs. | **Worked around** in `linked-nc-flow.js` (`openRfiRow` scrolls incrementally to mount the row, then hands off — `scrollToRowByCode` short-circuits when the row already exists). Central fix not attempted. |
| **Reaching the NC queue by clicking the tab is unreliable** — three separate runs ended on the RFI grid, once even after an exact-name match found a control and clicked it. | Same dangerous outcome every time: **RFI rows read as NC rows**, silently. | **Fixed by not clicking**: `linked-nc-flow.js` navigates straight to `/my-tasks/nc/list/pending-with-me` and proves arrival by the "NC ID" column header, keeping the tab/tile clicks only as a fallback. Reaching a queue in order to READ it is setup, not the behaviour under test — the RFI/NC flow itself is still driven entirely through the UI. |
| **A second linked-NC panel mounts a second Ark UI date picker**, and closed pickers stay in the DOM (`hidden`, `data-state="closed"`). | `[data-scope="date-picker"][data-part="content"]` becomes a strict-mode violation the moment an RFI carries two linked NCs — invisible to every single-NC test. | **Fixed** in `RFIReviewPage.selectLinkedNcTargetDate` (scoped to `data-state="open"`). Same family as the positioner-vs-content trap already documented there. |

**The shared lesson:** in this app, an action that fails validation *no-ops
silently*. Any helper that reports success on "the modal closed" / "the click
happened" rather than on the state actually changing will eventually hand a test
a confident wrong answer. Verify the effect, not the gesture.

## 2c. Bulk data-generation specs (tools, not coverage)

Specs whose job is to CREATE REAL RECORDS on a live environment, so other work
has data to look at. They assert almost nothing and should not be counted as
coverage; they are listed here because their **ground cost is permanent**.

| Spec | Creates | As |
|---|---|---|
| `03_rfi_bulk_create.spec.js` | N RFIs, one work area | CI |
| `20_rfi_bulk_create_multi_location.spec.js` | N RFIs across entries (misnamed — see the smoke doc) | CI |
| **`39_nc_bulk_create_qi.spec.js`** (new 2026-09-15) | N NCs, one work area | **QI** |

**`39` is the NC counterpart of `03`, written on 2026-09-15 and verified live the
same day** — 10 NCs on `A-06c` / `BL02` (Piling - Robotic Docking System, vendor
CHOUHAN, 2 work sections each), one QI login shared by a serial loop, with
per-iteration try/catch and an end-of-run summary. Edit `TOTAL_NCS` before a run.

Three things about it are NC-specific, not stylistic:

* **The QI creates an NC**, not the CI — the reverse of RFI.
* **Its loop body is simpler than `03`'s on purpose.** NC is one scrollable form
  with Submit at the bottom (no Proceed then checklist step), and NC does **not**
  autosave on navigate-away (proven in `32_nc_draft_autosave.spec.js`), so a plain
  navigation back to NC My Tasks is already a clean reset even after a failed
  iteration. The RFI loop needs a cancel-the-resumed-draft dance; this one must
  never grow one — confirming the "cancel NC?" popup **deletes** the draft.
* **Keep `workArea` on NC-only ground.** An NC consumes nothing and duplicate NCs
  against identical details are legal, but a non-approved NC BLOCKS RFI
  create/resubmit for the same (inspection checkpoint, work section) — so pointing
  this file at RFI ground locks the RFI flow out of it.

## 2a. Confirmed not-a-bug rules

Behaviour that looks like a defect to an unprepared test, and is not. Encoded in
code so the suite cannot report it as a failure.

| Rule | Detail |
|---|---|
| **SO Mapping hands off to DRS** (app owner, 2026-09-06) | Following PULSE's "SO Mapping" entry may land on the SO Mapping screen, on PULSE's migration notice, on the **DRS login page**, or on a **DRS application page** when DRS already has an admin session. All four are correct — SO Mapping moved to DRS on 2026-09-04, so the sidebar entry is a live hand-off, not a dead link. Encoded as `isDrsUrl()` (`tests/config/environments.js`), `SOMappingPage.classifyDestination()` and `returnToPulse()` (`tests/utils/helpers.js`); applied in SM17, spec 31 and `online-role-regression.js`. Full write-up: `docs/app-owner-decisions-and-conventions.md` §3.9. |

---

## 3. Recommended order of work

1. **Assert the remaining block** (G-05 only) — G-04 is done and G-03 was never a gap. Each is a short
   spec on sacrificial ground: create the prerequisite state, attempt the blocked
   action, assert the refusal, then assert the adjacent non-blocked case still
   succeeds — that second half is what distinguishes a real rule from a broken
   form. `clickProceedAndCheckOutcome()` already returns the server's own
   rejection.
2. **Negative authorisation coverage** (G-18). One spec, a table of
   (role, forbidden route, forbidden action), each entry logging in and asserting
   the denial.
3. **Put the chain on a schedule** (G-20, G-21). Reporters and the config-derived
   runner are already in place; what is missing is a workflow file and somewhere
   to keep the JUnit output.
4. **Use the API for setup, keep the UI for behaviour** (G-17). Not a rewrite —
   user creation, WAM mapping and RFI seeding over the API collapse the setup
   prefix, and an API read confirms what the server actually stored (which is
   what SM08 is trying to establish through two rendered screens).
5. **Extend mobile past the two flows** (G-19) — dashboard filter, WAM, Add User,
   reassign.
6. **Close the cheap surface gaps** (G-06, G-10, G-11, G-12, G-14) — each is a
   small spec against page objects that already exist.
