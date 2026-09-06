# Automation coverage and the gap register

Compiled 2026-09-06 off the repository itself (`tests/`, `tests/config/`,
`playwright.config.js`, `docs/`) rather than off a run.

**Last updated 2026-09-06: G-04 CLOSED AND VERIFIED LIVE, G-03 WITHDRAWN (my error — it was already covered)** — `SM28_nc_blocks_rfi.spec.js` now asserts
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
| G-01 | **RFI↔NC linkage.** "Raise NC" on a Not-Ok checklist item rejects the RFI *with* a linked NC (8 fields, photo mandatory); CI cannot resubmit until every linked NC closes its own CI→EE→QI cycle. Zero coverage — the largest single untested behaviour in the product. | parked 2026-08-19 |
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
| G-14 | **RFI attachments.** Covered on the NC side (photo capture, count, propagation); RFI-side upload/download/propagation is not. | medium |
| G-15 | **Profile, settings, theme toggle.** Never opened. | low |
| G-16 | **NC list depth.** The grid is driven only to find a row by code; its own sorting/filtering/pagination is untested outside the shared dashboard filter. | low |

### Structural and non-functional

| ID | Gap | Severity |
|---|---|---|
| G-17 | **No API-layer testing whatsoever.** Zero uses of Playwright's `request` fixture across 29,500 lines. Everything is UI, which is most of why a full chain is 6–8 hours and why server-side truths can only be inferred from a rendered screen. | high |
| G-18 | **No negative authorisation tests.** The suite proves each role *can* reach what it should; nothing proves a role is *denied* what it should not. On an app where role scoping is the product logic, this is the largest structural blind spot. | high |
| G-19 | **Mobile stops at the two flows.** SM05/SM06 run at Pixel 7; none of the 18 feature stages do — so mobile WAM, dashboard filter, Add User and reassign are unverified, on an app whose desktop nav is replaced by an unlabeled hamburger. | medium |
| G-20 | **No CI pipeline.** JUnit/JSON reporters are wired and working; there is no workflow file to consume them. Every run is hand-launched. | medium |
| G-21 | **No run history.** `smoke-reports/` is gitignored and overwritten each run, so flake frequency, stage-duration drift and pass-rate trend are invisible. | low |
| G-22 | **Chromium only.** Firefox/WebKit scripts exist in `package.json`; no project defines them. Reasonable for an internal PWA — worth recording as a decision rather than leaving as an accident. | low |
| G-23 | **No accessibility checks.** No axe integration anywhere. | low |
| G-24 | **No visual regression.** No `toHaveScreenshot` baselines, on an app with a lot of layout-conditional behaviour. | low |
| G-25 | **PWA offline behaviour untested.** CI/EE/QI are offline-capable PWA accounts — that is why they cost 3–6 min to log in — yet service-worker caching, queued submission and reconnect reconciliation have no coverage. | medium |
| G-26 | **SM16's signal is currently discounted.** The 28 dashboard-filter tests pass, but the screen sits on a known, already-reported backend issue; a future failure there is to be reported factually, not investigated. Re-validate once fixed. | watch |

---

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
