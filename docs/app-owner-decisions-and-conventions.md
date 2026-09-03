# App-owner decisions, conventions and confirmed rules

**Purpose: so nothing here has to be explained twice.** Everything below came
from the app owner directly, or was confirmed live against a deployment. Each
entry says which.

This is the index of *durable* knowledge. Deep detail stays in the topic docs and
is linked, not duplicated:

| Topic | Doc |
|---|---|
| Smoke E2E chain design, ground allocation, findings | [smoke-e2e-framework.md](smoke-e2e-framework.md) |
| RFI business logic | [rfi-business-logic.md](rfi-business-logic.md) |
| WAM hierarchy | [wam-hierarchy-business-logic.md](wam-hierarchy-business-logic.md) |
| WAM CRUD coverage | [wam-crud-coverage.md](wam-crud-coverage.md) |
| RFI activity-dependency chains | [rfi-activity-dependency-chain.md](rfi-activity-dependency-chain.md) |
| RFI data-integrity scenarios | [rfi-data-integrity-scenarios.md](rfi-data-integrity-scenarios.md) |
| Work Region hierarchy | [work-region-hierarchy.md](work-region-hierarchy.md) |
| Wind activity/checklist reference | [wind-activity-checklist-reference.md](wind-activity-checklist-reference.md) |
| Mobile-view RFI flow | [mobile-view-rfi-flow.md](mobile-view-rfi-flow.md) |

---

## 1. Working conventions

These are instructions about *how to work*, not about the app.

**One run at a time.** Never overlap flow-test invocations. Confirm the previous
one has fully exited before launching the next.

> Sharp edge found 2026-09-03: killing a backgrounded `npx playwright test` at
> the shell level does **not** kill the run. The
> `npx -> @playwright/test/cli.js -> workerProcess` tree survives, browsers and
> all. Two full runs then executed concurrently against the same tracker file for
> ~11 minutes and produced an incoherent failure pattern. Stop a run by killing
> the matched process tree — `node.exe` whose command line contains
> `playwright*test`, plus any `chrome.exe` under `ms-playwright` (never by image
> name alone) — and verify clean *before* launching.

**No automatic commits.** Do not `git add`/`commit` unprompted. The app owner
stages and commits, or says explicitly when to.

**Validate one project at a time.** Prefer `--no-deps` and a single
`--project=...` over full dependency chains, and inspect the real tracker
afterwards rather than trusting a green exit code.

**Never break the existing specs.** `tests/specs/` 1-31 must keep working
unchanged — they are used alongside manual testing. Confirm edits do not break
them; be careful that a `Write` does not overwrite a shared page object or util
instead of creating a new file.

**Credentials live in `.env`, never in a spec.** Literal values get backticks in
prose. `.env` is gitignored and must stay so — the remote is public-facing.

**Scope wait-time changes to the specific action** that needs them, rather than
raising every timeout uniformly.

**Ask before multi-round DOM exploration.** Do not spend several runs
self-exploring structure without checking first.

**Dev-facing bug reports stay scoped to the RFI flow.** Do not fold in NC-flow
issues or raise them proactively.

**The app owner watches runs live** and gives precise root-cause corrections from
what they see. Treat those as authoritative over inference.

---

## 2. Environments

| Key | URL | Use |
|---|---|---|
| `dev` | `pulse-dev.cfapps.ap11.hana.ondemand.com` | WTG/wind inclusion + mobile-view development |
| `qa` | `pulse-qa.cfapps.ap11.hana.ondemand.com` | the E2E smoke chain |
| `test` | `pulse-test.cfapps.ap11.hana.ondemand.com` | where the solar regression suite has run |

Select with `PULSE_ENV=dev|qa|test`. With it unset, the raw `.env` `BASE_URL`
wins, and the config prints the resolved target on every run — read that line
before trusting where a run went.

**Login timing differs by role class, and it matters for runtime estimates:**

- **Online roles** (Admin, Cluster/Site/Plot Admin, PM, EL, QL) log in in
  **seconds**.
- **Offline/PWA roles** (CI, CM, EE, QI) pay a **3-6 minute** first-load, and can
  show a "data didn't finish downloading" banner afterwards.

Measured on pulse-qa: creating 10 users took 1.4 min; WAM for 4 roles across 4
work areas took 59 s. Earlier estimates that assumed every login was a PWA load
were wrong by more than an order of magnitude.

**Before any new login, clear the whole browser session** — cookies *and*
localStorage *and* sessionStorage. A cookie-only clear leaves PULSE's autosaved
RFI draft alive in localStorage, and that draft keeps holding its Work Section.

**User auth is automatic now** (app owner, 2026-09-03). Newly created users can
log in immediately; no manual DB step. This supersedes the note in
`18_wam_hierarchy.spec.js`'s header, which still says the app owner adds them
manually — that comment is stale. Verified live: all six freshly created
hierarchy-tier users logged in, 44.8 s for six logins.

---

## 3. Business rules confirmed by the app owner

These drive test design; getting them wrong produces failures that look like app
bugs.

### 3.1 The visible code is composed of FIVE inputs

```
<RFI|NC> + Work Location + Work Area + Package + <counter>
```

...but what *determines* it is **Work Location + Work Area + Package + Work
Section + Inspection Checklist** (app owner, 2026-09-03 — corrected an earlier
note that listed only the first three).

- **RFI:** the code changes on resubmission only if one of those five changed.
  Consequence that bites: a page-1 rejection can arrive with the **Work Section
  cleared**, so re-selecting must restore *the same* section. Picking "first
  available" changes an input and can legitimately change the code.
- **NC:** fixed at creation, never changes. QI raises it; CI only fills Root
  Cause and Corrective Action.

**Counters are per-flow, and RFI's is shared across work areas.** Observed on
pulse-qa: NC began at `CIV-0` on BL05 while RFI was at `CIV-19`; RFI ran
`CIV-0`..`CIV-9` on BL03 then continued at `CIV-10` on BL04. Never build a row
lookup that assumes the counter restarts per combination — match the whole code
cell (`exact: true`), or `-CIV-5` also matches `-CIV-50`.

**The unfinalized-code placeholder differs by flow** (live, 2026-09-03):

| Flow | Placeholder |
|---|---|
| RFI | the literal word `DRAFT` |
| NC | **the last 4 characters of the record's UUID** |

NC's is the dangerous one — it looks like a valid code, so a "not DRAFT" check
passes it straight through. Validate the **shape** instead: a finalized code ends
in its numeric counter.

### 3.2 A non-approved NC blocks RFI on the same details

If an NC exists in a non-approved state for a given (inspection checkpoint, work
section), the CI **cannot create or resubmit an RFI** for those same details. So
a bug-interrupted NC cycle permanently blocks RFI creation on that ground — which
is why NC needs work areas **disjoint** from the RFI areas. This is not about
consumption.

### 3.3 A work section is consumed FOREVER — only a DB delete releases it

App owner, 2026-09-04, and it corrects an earlier guess of mine that approval
released the section. **It does not. Nothing releases it except deleting the RFI
from the database.**

The reason is what an RFI *is*: a record that a piece of work was completed. Once
an activity is done for a work section, that activity's RFI cannot be raised
against it again, because the work is not there to do twice.

**Two ways to keep going when a work area runs dry**, and the second is the one
worth remembering:

1. **Change the work area** — the obvious lever.
2. **Keep the work area and change the ACTIVITY** (with its related checkpoint).
   Consumption is per activity/checkpoint, not per area, so a different activity
   shows the full set of work sections still needing an RFI in that same area.

### 3.4 What a resubmit may change, and what that costs

App owner, 2026-09-04. This answers the wind capacity question: **a resubmit
REUSES the same work section and checklist** — it does not consume a second
(checkpoint, work section) pair.

But CI's freedom on a resubmit is wider than that, and it has a consequence:

* **After a PAGE-1 rejection, CI may change ANY first-page detail** — work
  section, inspection checkpoint, the rest — and resubmit. Doing so RELEASES the
  previously selected details and effectively creates a new RFI against the new
  ones. (This is the one path by which a selection can be given back without a DB
  delete: it was never completed work, it was reassigned.)
* **Resubmitting WITHOUT touching page 1** keeps the same work section and
  checkpoint, and costs nothing extra.
* **The checkpoint dependency is still enforced when CI changes it.** Changing a
  rejected RFI's inspection checkpoint is only permitted if that checkpoint's
  dependency is satisfied. So CI cannot use a rejection to jump the dependency
  chain.

**Consequences for the suite:**

* Wind capacity is ~9 pairs per 9-TC pass, not ~21 — roughly 6 clean passes per
  provisioning of the 12-area RFI pool.
* The smoke resubmit path deliberately re-selects **this RFI's own** recorded work
  section rather than "first available", which keeps it in the
  nothing-extra-consumed case AND keeps the visible code stable (work section is
  one of the five code inputs, §3.1).

### 3.5 RFI consumes work sections; NC does not

- A 9-TC RFI pass spends ~9-10 (checkpoint, work section) pairs, and every rerun
  spends another ~10.
- **Multiple NCs against identical details are legal**, so NC ground is reusable
  indefinitely and both viewports can share one work area.

**The app does not filter spent work sections, and availability lags a create.**
With an RFI already raised against `R01-T01`, the form still offered it *and*
still counted it pending. A run starting seconds after a create read
`Selected 0 | Pending 264`; a run seven minutes later correctly read
`Selected 1 | Pending 263`. So "first option" is not "first available" — track
what the run has consumed, and treat the server's rejection toast as the
authority.

### 3.6 WAM's CI and QI rows are single-assignee

One pick **replaces** whoever held the row (`WAMPage.js`). So assigning a
freshly-created user to a work area **evicts** the incumbent. This is why the
smoke chain must stay off the regression's work areas — otherwise it strips the
`.env` CI/QI of the areas specs 02, 08-10, 21, 23 and 24 depend on.

### 3.7 Keep NC files independent of RFI's

Standing instruction: NC work stays in its own files even where the logic looks
reusable. See the decision log for how this was resolved for the smoke chain (option C).

---

## 4. Ground: what data to use, and what not to

### 4.1 Solar

- **Every `BL{nn}` work area supports the solar activities** and returns a usable
  Work Section list. **Only `Road*` and `Drain*` areas fail** to show work
  sections — never use those. The activity dropdown is misleading here: it offers
  Piling activities on a Culvert/Drain/Road area and nothing fails until the Work
  Section list comes back empty.
- `S05b / BL01 / Piling - MMS / Pre Pour Inspection - Pile` reports **264** work
  sections, named `R0x-T0x`.
- `A-06c` is the app owner's **manual-testing ground** — the smoke chain must not
  touch it.
- Smoke solar sits on `S05b`, areas `BL03`-`BL06`. Detail and reasoning in
  [smoke-e2e-framework.md](smoke-e2e-framework.md) §4.2.

### 4.2 Wind (WTG-Khavda)

- Exactly **one Work Section per Work Area**, named after the area. Selecting it
  consumes that (checkpoint, work section) pair permanently — submitting is not
  required, though a proper Cancel+confirm releases it. So wind buys capacity by
  adding **areas**, not by reusing one.
- The app owner provisioned **21 areas**: `WTG 423`-`WTG 433` and
  `WTG 448`-`WTG 457`. SO-map all of them and WAM the WTG CI/CM/EE/QI onto all of
  them, then vary the work area per RFI.
- Service Order: **`5710008038 - BAUER ENGINEERING INDIA PVT LTD`** (decided
  2026-09-03, superseding an earlier `5710012136`). Always the full
  `"<number> - <NAME>"` string — BAUER appears under five different SO numbers and
  a name-only match resolves to the wrong one.
- Wind is scoped to the **Civil** package: the per-activity Service Order dropdown
  is scoped per package, and BAUER has **zero** Electrical or Mechanical service
  orders on this work location. Covering those would need a different vendor per
  package, hence a separate CI/CM pair per package.
- **Wind runs desktop only.** Mobile is covered once, on solar, because solar
  never exhausts and can absorb reruns whereas every wind attempt spends an
  irreplaceable checkpoint. Wind's job is the second *project type*, which is a
  different axis from viewport.
- **Run order:** all 9 RFI TCs on wind desktop *after* solar desktop and solar
  mobile, so a wind failure is known to be project-type-specific.

---

## 4a. A recording bug of mine, not an app bug — 2026-09-04

**Do not trust `workSection` in the smoke RFI tracker.** It records the label
that `RFICreatePage.selectWorkSection` returned at CLICK time, and that value has
been proven wrong against the app.

Proof, from one TC:

| | |
|---|---|
| Log at create | `selected work section "R01-T01"` — accepted, id `55217178-cf9d-4744-ba21-3fa6dec9393f`, `RFI-S05b-BL04-CIV-15` v1 |
| After QI's P2 reject + resubmit | new id `d4f8738a-b969-4016-b97e-bd60f83aa86a`, same code, v2 |
| **App shows for that record** | Work Section **`R01-T06`** |
| Separately | `RFI-S05b-BL04-CIV-10` (id `a580eda0-...`) holds `R01-T01` |

So one section per record, nothing reused, and §3.3 holds exactly as the app owner
stated it. The log even shows the server REJECTING `R01-T01` with "already used"
on every other TC that tried it — the rule working, visibly.

**What went wrong in the analysis, worth remembering:** the tracker's recorded
value was treated as ground truth and used to allege an application defect. It is
the least trustworthy artefact in the picture, because it is the part this suite
writes. A missing `R01-T06` in the consumed list was noticed and explained away
rather than followed. **Verify against the app or the DB before attributing
anything to the application.**

**Fix required (not yet made):** after submit, read the Work Section back from the
saved record and store that, rather than the click-time label. The value is
load-bearing — the resubmit path re-selects `tc.workSection` when a page-1
rejection clears the field, so a wrong value would attach a resubmit to the wrong
section.

## 5. Decision log

| Date | Decision |
|---|---|
| 2026-09-03 | **Solar smoke band shifted** to `BL03`/`BL04`/`BL05`/`BL06` instead of the originally requested `BL01`-`BL03`, because of the single-assignee WAM eviction in §3.6 |
| 2026-09-03 | **NC shares one work area** across both viewports — NC consumes nothing |
| 2026-09-03 | **Wind Service Order** = `5710008038` |
| 2026-09-03 | **Wind pool** = the 21 `WTG 4xx` areas, replacing the older `KH ...` set |
| 2026-09-03 | **Wind NC**: recon the form first, then desktop-only |
| 2026-09-03 | **Viewports**: solar desktop + mobile; wind desktop only |
| 2026-09-03 | **Session model**: reuse `21_rfi_flow_single_session.spec.js`'s shape — one login per role, in parallel, kept alive, round-robin turns. Worth ~9 logins a pass |
| 2026-09-03 | **Quick TC set kept** alongside full — it is TC-01 of the same matrix over a filtered seed, so it costs no runtime and no extra implementation |
| 2026-09-03 | **NC separation: option C.** `nc-tracker-utils.js` stays completely untouched, so specs 15/16/17 and 22 keep their exact behaviour. Only the new smoke code uses the shared `flow-tracker`. The 4-TC matrix is *imported* from the regression's seed rather than copied |
| 2026-09-03 | **Wind is setup-only for now** — do not run wind RFI/NC flows, because RFIs already exist on the WTG work areas |
| 2026-09-04 | **Smoke specs renamed** `s0*` -> `SM0*`; the 31 `00_inspect_*` recon specs moved into `tests/specs/inspection/` |
| 2026-09-04 | **Commit shape**: split the mechanical rename/move from the framework work. Recon captures and smoke tracker state **are** tracked in git |

---

## 6. Known blockers

**s02 (SO mapping) — app-side bug on the SO Mapping screen.** Reported by the app
owner 2026-09-03; a dev fix was expected the next day. Consequences:

- **Solar** does not need s02 right now — the mapping for its band was done
  manually. Run the solar stages with `--no-deps` so the chain cannot try to
  re-run it.
- **Wind cannot be provisioned at all** until this is fixed — mapping the 21 areas
  *is* the broken screen.

Do not treat an s02 failure as a suite defect until the fix lands.

---

## 7. Open questions for the app owner

1. **`s04` (WAM hierarchy)** must cover the angles of both
   `13_wam_all_roles.spec.js` (Admin assigns every role) and
   `18_wam_hierarchy.spec.js` (each tier assigns the tier below). The plan: s03
   keeps mapping the four work-area-scoped flow roles, and s04 walks the cascade
   Admin -> CAD -> SAD -> PAD -> PM -> EL/QL -> CM -> CI. Prerequisites are done —
   all ten roles are created and all six hierarchy tiers log in with WAM in their
   menu. **Still to confirm:** the WAM row granularity per tier (work-area roles
   EE/QI/EL/QL/CIC/CM, work-location roles PM/PAD, site-level SAD).
2. **`s08` (SO demapping)** — `SOMappingPage` has no remove method. The `x` beside
   each Service Order field is *assumed* to clear the mapping; needs one live
   confirmation, including what an emptied row reads back as.
3. **Wind NC form** — never opened for wind, so `WIND_E2E.nc` is deliberately
   `null`. Needs a recon pass.
4. *(Withdrawn 2026-09-04 — there was no contradiction and no app bug. See
   "A recording bug of mine, not an app bug" below.)*

5. *(Answered 2026-09-04 — a resubmit reuses the same work section and
   checklist. Recorded as §3.4.)*
