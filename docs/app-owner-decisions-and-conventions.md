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

**DO NOT COLLAPSE THE SMOKE STRUCTURE TO SOLAR-ONLY.** App owner, 2026-09-04:
*"we will include different project type later in future so dont change this
smoke structure, as of now we are only going with Solar."*

Solar being the only ACTIVE project type is a matter of current focus, not a
reason to simplify. Specifically, do not:

* delete or inline the `WIND_E2E` profile, or fold the profile layer back into
  hardcoded literals;
* remove the `smoke-wind-*` projects from `playwright.config.js`;
* replace anything profile-driven with a solar constant — `workSectionGranularity`,
  `viewports`, `flowWorkAreas`, `users.prefixes`, `cluster`/`site` and the
  per-checkpoint `subPackage`/`activity` overrides all exist precisely so a new
  project type declares its own behaviour instead of inheriting solar's.

More project types are coming (the app offers SOLAR, WIND, INFRA, PSS, BESS,
TRANSMISSION_LINE and ADMIN), and DRS can host pilot projects of every kind. The
cost of keeping the seams is a little indirection; the cost of removing them is
rebuilding the whole parameterisation later.

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

**Build a new feature spec in `tests/specs/` first, then promote it.** App owner,
2026-09-06: *"if u want a feature related spec to create and run you can do it in
specs folder — once its working properly then u can add that in smoke folder as
part of chain."*

`tests/specs/` is the exploration tier, so a spec under development can be run
one at a time, iterated on and left broken without touching the chain. Only once
it passes live does it become an `SM*` replica and get a project in
`playwright.config.js`. This supersedes nothing about the smoke tier being
self-contained — the promoted copy still resolves its users through
`resolveSmokeUsers()` and its ground through `profile.featureGround`; it just
means the chain never carries an unproven stage.

*(SM28 was built the other way round — straight into `tests/smoke/` — because it
was written before this rule was stated. Everything for G-01…G-26 follows the
rule.)*

**While developing, skip the flow stages.** App owner, 2026-09-06: *"our whole
smoke project full run takes about 1.5~2 hours so you can skip RFI and NC flow
which is much time taking, and once newly added features are working properly
then run a full smoke run to test everything together."*

`SM05` (RFI 9-TC, ~17 min desktop + ~22 min mobile) and `SM06` (NC 4-TC, ~9 min
each viewport) are roughly **57 of the ~120 minutes**. Iterate without them, then
prove the whole thing together once. Concretely, that means running the specific
`--project` under development with `--no-deps`, and reserving `npm run smoke:full`
for the confirmation pass.

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

**THE LONG-STANDING .env ACCOUNTS ARE NOW A LIABILITY ON QA** (measured
2026-09-04). Freshly created users log in fast; the .env role accounts do not:

| Account | Login on pulse-qa |
|---|---|
| created smoke users (CISL/EESL/QISL...) | fast — three in parallel, a whole RFI quick pass in 4 min |
| `.env` CI | **7.9 minutes** |
| `.env` EE | **hung** — screenshot shows the PWA spinner at **100%**, never reaching the dashboard, until the 10-minute test timeout |
| `.env` QI | never got to run |

Note it does NOT fail — it reaches 100% and stalls. Likeliest cause: these
accounts carry months of accumulated offline data across many work areas, so
their PWA sync payload is far larger than a fresh user's. This also supersedes
the older note that the `.env` CI got a 401 on QA — it authenticates fine now.

**Consequence for the smoke suite.** The SM* stages are unaffected (they use
created users). But six feature stages resolve `.env` users and are therefore
slow or flaky here: `23_rfi_data_integrity`, `24_rfi_draft_autosave`,
`29_rfi_activity_dependency`, `30_..._scarce_work_section`, and anything else
going through `loginAsRole`. Options, in increasing cost: raise the global test
timeout above 10 minutes as a stopgap; re-point those specs at created users (a
real rewrite); or have the accounts' offline data trimmed.

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
that work is done for a work section, its RFI cannot be raised against it again,
because the work is not there to do twice.

**The consumption key is (SUB-ACTIVITY, CHECKPOINT, WORK SECTION)** — app owner,
2026-09-04. Their example: sub-activities A and B, A with 4 checkpoints and B with
3, and each one's FIRST checkpoint depending on nothing. Both first checkpoints
can hold an RFI **in the same work area and the same work section**, because they
are different (sub-activity, checkpoint) pairs.

So the same work section stays selectable when the SUB-ACTIVITY and its related
checkpoint change — not merely when the activity label changes.

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

### 3.6 Per-tier role restriction, measured

Which roles a tier may assign, read live off the WAM Role dropdown during SM04's
cascade (2026-09-04):

| Logged in as | May assign | Count |
|---|---|---|
| Admin | everything | 10 |
| Cluster Admin | all but Cluster Admin | 9 |
| Site Admin | all but SAD, CAD | 8 |
| Plot Admin | all but PAD, SAD, CAD | 7 |
| **Project Manager** | Execution Lead, Quality Lead | **2** |
| **Execution Lead** | Contractor Manager, Execution Engineer | **2** |
| **Quality Lead** | Quality Inspector | **1** |
| **Contractor Manager** | Contractor Incharge | **1** |

**The "assigns every role below it" rule stops at Plot Admin.** CAD/SAD/PAD each
drop exactly their own row and everything above it, so they really do assign
every subordinate role. PM and below are strictly NEXT-TIER-ONLY. An earlier note
recorded the first half of this and did not establish where it stopped.

**Row granularity also changes with the role being assigned**, which is why this
cannot share SM03's single-dialog model:

| Assigning | Filters needed | Rows are |
|---|---|---|
| Cluster Admin | none | Clusters |
| Site Admin | cluster | Sites |
| Plot Admin, Project Manager | cluster + site | Work Locations |
| EE / QI / EL / QL / CM / CI | + work location, package, and a Service Order for VENDOR roles | Work Areas |

### 3.7 WAM's CI and QI rows are single-assignee

One pick **replaces** whoever held the row (`WAMPage.js`). So assigning a
freshly-created user to a work area **evicts** the incumbent. This is why the
smoke chain must stay off the regression's work areas — otherwise it strips the
`.env` CI/QI of the areas specs 02, 08-10, 21, 23 and 24 depend on.

### 3.8 Keep NC files independent of RFI's

Standing instruction: NC work stays in its own files even where the logic looks
reusable. See the decision log for how this was resolved for the smoke chain (option C).

### 3.9 SO Mapping hands off to DRS — all landing pages are correct

**App owner, 2026-09-06. This is a NOT-A-BUG rule.** Following PULSE's
"SO Mapping" menu entry may end on **any** of these, and every one is expected
behaviour:

| # | Landing page | When |
|---|---|---|
| 1 | The PULSE SO Mapping screen | older deployments that still have it |
| 2 | PULSE's "Desktop Mode Required" migration notice | PULSE route kept, screen removed |
| 3 | The **DRS login page** (`drs-*.cfapps…/login`) | handed off, no DRS session yet |
| 4 | A **DRS application page** (e.g. `/projects`) | handed off, DRS already logged in as admin |

Verbatim: *"if after clicking SO mapping screen user either lands on SO mapping
screen or on drs login page (or on dashboard if drs platform is already logged
in with admin credential) is expected behaviour not a bug."*

SO mapping moved out of PULSE to DRS on 2026-09-04 (§4.2 / the decision log), so
the sidebar entry is a **live hand-off, not a dead link**. Do not report any of
the four as a defect, and do not "fix" the app-side navigation.

**Why this needed code, not just a doc entry.** Outcomes 3 and 4 leave the PULSE
origin. The menu sweeps (`SM17`, spec 31) assert `not.toHaveURL(/\/login/i)`
after opening each item — and DRS's own login URL ends in `/login`, so the
hand-off was going to be reported as *"SO Mapping bounced to /login"*, i.e. a
PULSE session failure. Anything driving the page afterwards is also on the wrong
origin, where no PULSE locator resolves.

Encoded as:

* `isDrsUrl(url)` / `isPulseUrl(url)` — [tests/config/environments.js](../tests/config/environments.js).
  Matched on **hostname prefix** (`drs-…`), so the DRS deployment can track the
  PULSE one without any test knowing which; `DRS_BASE_URL` in `.env` can name an
  exact host as well.
* `SOMappingPage.DESTINATIONS` + `SOMappingPage.classifyDestination(page)` —
  returns which of the four happened, and asserts nothing.
* `returnToPulse(page)` — [tests/utils/helpers.js](../tests/utils/helpers.js).
  Closes a DRS tab if the hand-off opened one, and navigates back to PULSE if it
  navigated in place.

Call sites updated: `SM17_hierarchy_dashboard_menu.spec.js`,
`31_hierarchy_roles_dashboard_menu.spec.js` (the two menu sweeps) and
`online-role-regression.js` (which now reports the hand-off as an expected
outcome instead of only recognising the migration notice).

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

### 4.2 Wind — PARKED 2026-09-04, focus is solar

**App owner: "I am going to drop the idea of testing wtg rfi flow and going to
focus on Solar itself, no need WTG as of now."** Everything below is left intact
and correct as of that date so wind can be picked up later without re-deriving
it. Nothing wind-related should be run meanwhile.

State when parked — all of it working:

| Stage | Result |
|---|---|
| SM01 users | 10 roles created, scoped `Gujarat / Mandvi / WTG-Mandvi`, 2.3 min |
| SM03 WAM | 4 flow roles across all 7 areas, 1.1 min |
| SM05 RFI `quick` | passed twice — `RFI-WTG-Mandvi-MNP29-CIV-0` on `A1.18.1`, then `CIV-1` on `A1.18.2` |

Also settled before parking: all four DRS-observed activity labels
(`1. Stone Column Installation`, `1. DT`, `2. HT Foundation`,
`3. Burnt Oil Tank`) resolve correctly in PULSE, as does a bare
`Pre-Activity Work` sub-activity.

**One thing left UNRESOLVED, recorded so it is not lost.** With only Crane Pad's
`A1.18.1` raised on `MNP29`, the create form reported
`selectedForRfi=1 pendingRfi=0` for the first checkpoint of the four OTHER
activities too — which looks like it contradicts the (sub-activity, checkpoint,
work section) key above. Two candidate readings, untested:

1. The Work Section Summary is **section-level, not per (sub-activity,
   checkpoint)** — in which case those four were viable and the walk's pre-check
   skipped them needlessly. This suite already records that the summary is not a
   reliable spent-detector on solar.
2. The app keys consumption on the sub-activity/checkpoint **NAMES**, and all five
   independent starts share both (`Pre-Activity Work` / `Pre-Activity
   Checkpoint`) — which made them the worst possible case for demonstrating that
   varying the activity frees the section.

Settling it needs one attempt with the pre-check bypassed, to see whether the
server accepts or rejects. Costs one pair on wind if accepted. Not worth doing
while wind is parked.

### 4.2a Wind reference (retained) — WTG-Mandvi and DRS

**Changed 2026-09-04.** SO mapping was **removed from PULSE**; it now lives in the
**DRS** application, and PULSE syncs project and work-location configuration from
DRS. Consequences for this suite:

* **SM02 (SO mapping) and SM08 (SO demapping) are no longer stages** — there is no
  PULSE screen for either to drive. Both spec files are kept as documentation of
  how the screen behaved, but the chain is now users -> WAM -> flows.
* The "SO Mapping app bug" recorded on 2026-09-03 was really this feature being
  taken out.
* If SO demapping coverage is still wanted, it belongs against DRS — a different
  application.

**The already-mapped WTG work location on QA is `WTG-Mandvi`, not Khavda.** From
DRS: project "Mandvi (WTG-Mandvi)", Configuration -> 4. SO Configuration, package
Civil.

| | |
|---|---|
| Work location | `WTG-Mandvi` |
| Work areas (complete set) | `MNP29`, `MP-P1`, `MP561`, `MP611`, `MP738`, `MP758`, `MP763` |
| Vendor / SO | `5710017045 - GODARA INFRATECH PVT LTD` |

**Naming breaks from Khavda.** Khavda's areas always contained a space ("KH 34",
"WTG 423"). Mandvi's do not, use mixed prefixes, and one is hyphenated. Any
lookup assuming a space or a plain numeric tail does not apply.

**Watch the dash.** DRS renders the SO with an EN DASH; PULSE's dropdowns have
used a plain hyphen. The profile stores the hyphen form, because that is what the
PULSE selectors and the `"<number> - <NAME>"` guard expect.

**Wind's one-section-per-area behaviour is CONFIRMED on Mandvi** (live,
2026-09-04): the create form reported `total=1 selectedForRfi=0 pendingRfi=1`,
and the single section is named after the area (`MNP29`). Exactly what §2d of
[work-region-hierarchy.md](work-region-hierarchy.md) predicts — depth follows the
Sub-Activity's Min. Unit of RFI (*Per WTG* -> Block -> collapses onto the Work
Area), so it is a property of the activity, not the site.

**Wind is proven end to end on Mandvi** (2026-09-04): SM01 created all ten users
scoped `Gujarat / Mandvi / WTG-Mandvi` in 2.3 min, SM03 WAM'd the four flow roles
across all seven areas in 1.1 min, and a `quick` RFI pass went create -> EE
approve -> QI approve in 3.5 min. First code: `RFI-WTG-Mandvi-MNP29-CIV-0`.

Two things that run also settled:

* `1. Crane Pad` and its `A1.18.1`..`A1.18.5` chain exist on Mandvi unchanged —
  the activity master is shared with Khavda.
* PULSE's WAM dialog DOES see the DRS-side SO mapping: the CI is a VENDOR role
  whose WAM dialog carries a Service Order field, and GODARA resolved. WAM also
  assigned `MP763` fine, so WAM is per (work area, package) and NOT
  activity-sensitive — the Crane Pad gap there only bites at RFI creation.

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
| 2026-09-03 | **Solar smoke band shifted** to `BL03`/`BL04`/`BL05`/`BL06` instead of the originally requested `BL01`-`BL03`, because of the single-assignee WAM eviction in §3.7 |
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

**None.** Both previous blockers are resolved:

* The s02 SO Mapping blocker is gone — the feature moved to DRS and the stage was
  removed (§4.2).
* Wind's Cluster/Site is resolved from
  [work-region-hierarchy.md](work-region-hierarchy.md) — see §4.2.

---

## 7. Open questions for the app owner

1. *(Answered 2026-09-04 — SM04 is written and passes 10/10 in 2.2 min. The row
   granularity per tier is recorded as §3.6, read live rather than assumed.)*

   **One caveat worth carrying:** the Contractor Manager -> Contractor Incharge
   step failed ONCE, on its first full run, with a 30s timeout waiting for the
   Role combobox inside the WAM dialog — and the screenshot showed no dialog at
   all, just CM's own read-only "My Assignment" page. It then passed in isolation
   AND on a full re-run, and the defensive reopen-the-dialog guard added
   afterwards NEVER FIRED on either. So the failure was transient and its cause is
   NOT identified; that guard is unexercised code, not a fix. If it recurs, the
   likeliest reading is order-dependence — it failed running tenth on a shared
   page after nine prior logins, and passed running first in a fresh context — in
   which case a fresh context for that step is the real answer.

2. **Wind NC form** — never opened for wind, so `WIND_E2E.nc` is deliberately
   `null`. Needs a recon pass before SM06 can run for wind.

3. *(Withdrawn — was the SO demapping `x` control. Moot now that SO mapping is in
   DRS.)*

4. *(Answered 2026-09-04 from [work-region-hierarchy.md](work-region-hierarchy.md),
   the Location Master snapshot exported from DRS. Its Cluster/Site table reads*
   *"Gujarat | Mandvi | 2 work locations | 70 work areas | wind, pss", so*
   *`WTG-Mandvi` is Cluster `Gujarat` -> Site `Mandvi`. Wind no longer shares*
   *solar's `SITE` constant.)*

   Note it is stored as a plain string, not the `CLUSTER_CANDIDATES` list. That
   list exists because the KHAVDA site's Cluster field has been seen rendering as
   either "Gujarat" or "Khavda" — a quirk with no evidence either way for Mandvi.
   Widen it the same way if a live cascade cannot find "Gujarat".

5. **Six usable areas against nine wind TCs — and it is a MAPPING limit, not a
   data limit.**

   Per [work-region-hierarchy.md](work-region-hierarchy.md) Appendix B,
   `WTG-Mandvi` actually holds **69** work areas (`MP{n}` x66, `MNP{n}` x2,
   `MP-P{n}` x1). The seven in the profile are simply the ones **SO-mapped in
   DRS**, and a CI can only raise against mapped ground. Of those seven, DRS shows
   **"1. Crane Pad" UNMAPPED on `MP763`**, leaving six for a Crane Pad RFI.
   `MP763` is parked for NC, which uses a different activity.

   Wind wants one area per TC because the preceding-checkpoint rule blocks
   checkpoint N+1 until N is approved, so six areas cannot carry a 9-TC pass.

   **The ceiling is now CONFIRMED, not predicted.** The first Mandvi run reported
   `total=1` work section for the area, so one area really does carry one RFI per
   checkpoint. Six areas therefore cannot host a nine-TC pass, which needs nine
   areas all sitting at checkpoint A1.18.1.

   **Mapping more areas is deferred** (app owner, 2026-09-04): DRS can host pilot
   projects of every kind and work sections can be created to order, but that is
   "a different big journey" — use the existing ground for now.

   So the live options are a reduced wind TC set, or a different wind activity
   mapped across all seven. **Awaiting the app owner's preference; nothing is
   blocked meanwhile, since wind setup and a `quick` pass both fit inside six
   areas.**
