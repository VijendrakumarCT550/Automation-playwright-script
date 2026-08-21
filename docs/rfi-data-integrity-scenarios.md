# RFI Data Integrity — Scenario Tracker

Living document tracking the specific checks we're building for "does
CI's entered data actually reach EE/QI unchanged," decisions made, and
open questions. See `rfi-business-logic.md` for the durable reference
material this tracker relies on (Activity Master structure, WAM/SO
Mapping relationship, etc.).

Branch: `rfi-data-integrity-check` (off `main`, post single-session-login work).

## Goal

Confirm that field values CI enters at RFI creation persist correctly
through to EE's and QI's review screens — distinct from the existing
flow-mechanics coverage (specs 08-10, 21), which only verifies the
approve/reject/version lifecycle completes, not that the *data itself* is
intact.

## Scope decided

- **Priority**: field values persisting correctly (not validation-rule
  enforcement — that's a separate, later phase if we get to it).
- **Fields in scope**: all of `RFI_DATA` (Work Location, Work Area,
  Package, Sub-Package, Activity, Sub-Activity, Quantity, Unit,
  Sub-Contractor, Inspection Checkpoint, Inspection Checklist) **plus**
  every checklist observation value.

## Findings so far (from live inspection, `00_inspect_rfi_data_integrity.spec.js`)

Ran once against a fresh RFI (`RFI-A-06c-BL02-CIV-685`), dumped EE's full
review-page text. Results:

| Field | Matched CI's input? | Notes |
|---|---|---|
| Work Location | ✅ exact | `A-06c` |
| Work Area | ✅ exact | `BL02` |
| Package | ✅ exact | `Civil` |
| Sub-Package | ⚠️ **displays "Old" name, longer than CI's input** | Known, not a bug — see `rfi-business-logic.md` §5. Don't exact-match this field. |
| Activity | ✅ exact | `Piling - MMS` |
| Sub-Activity | ✅ exact | `Piling - MMS` |
| Quantity / Unit / Sub-Contractor | ✅ `null` → renders as `-` | Confirmed this is the correct empty-state rendering, not data loss |
| Inspection Checkpoint | ✅ exact | `Pre Pour Inspection - Pile` |
| Inspection Checklist | ✅ exact | `Micro Pile Checklist` |
| Work Section | ⚠️ picked "first available" (`R01-T71`), not from `RFI_DATA` | **Resolved as legitimate, not arbitrary** — see `rfi-business-logic.md` §3a. It's real fixed inventory; "first available" just means "first still-unused unit." Assertion strategy: capture the actual value at creation time, assert EE/QI see that same value — never a hardcoded expected string. |
| Checklist observations (×16) | ✅ exact, all 16 | `"OK - as per standard 1"` through `"...16"`, matching `fillAllObservations()`'s suffix |
| Contractor Name / Service Order | N/A — not CI input | Derived from SO Mapping, see `rfi-business-logic.md` §2. Not part of "CI's data reaching EE" — would need a different check (against SO Mapping config) if ever verified |
| Project Name | N/A — skip | Fixed/global, not RFI-instance data |

**Bottom line so far**: the fields CI directly controls came through
correctly in this one run. The interesting work is less "is there a data
bug" and more "which fields are even meaningful to assert on, and how" —
see open questions.

## Open questions

1. ~~Is the Sub-Package "New" vs "Old" name difference a real bug?~~
   **Resolved**: not a bug, don't exact-match this field (app owner,
   2026-08-19).
2. ~~Are Contractor Name / Service Order supposed to match CI's input?~~
   **Resolved**: they're derived from SO Mapping, not CI input at all —
   out of scope for this check (app owner, 2026-08-19).
3. ~~Work Section has no fixed expected value in our automation — is
   "first available" acceptable?~~ **Resolved**: yes — Work Section is
   real fixed inventory (per Work Area + Activity), not arbitrary; "first
   available" is a legitimate pick of any still-unused unit. Capture the
   actual value at creation time and assert consistency against it, don't
   hardcode an expected string (app owner, 2026-08-19; see
   `rfi-business-logic.md` §3a).
4. ~~Is Project Name meaningful to verify?~~ **Resolved**: skip, it's fixed/global.
5. ~~Does the app enforce Activity Dependency / Checkpoint Dependency, or
   is that master data purely informational?~~ **Resolved**: both layers
   are real, app-enforced blocks (app owner, 2026-08-19) — checkpoint
   dependency scoped per Work Section, cross-Activity dependency scoped by
   Min-Unit-of-RFI type (Table-to-Table, Inverter-to-Inverter, Block
   depends on all Table/Inverter units across the whole Work Area). See
   `rfi-business-logic.md` §6a/§6b for full mechanics. **Still not
   automated/verified live** — moved to Deferred below as a concrete test
   case now that the mechanics are understood, not just an open question.
6. **Partially resolved**: WAM ↔ SO Mapping ↔ RFI linkage mechanics are
   now understood conceptually in detail (see `rfi-business-logic.md`
   §2 — seeded SOs, SO-to-Activity mapping, SO-scoped CI WAM assignment,
   SO-unaware EE/QI). **Still not cross-checked by automation**: we still
   only observe the *result* (Contractor Name/Service Order on the RFI),
   never the SO Mapping config that produced it. Remains a future
   deep-dive, not immediate scope.
7. **Still open**: this was tested with ONE TC, ONE set of `RFI_DATA`
   values, no reject/resubmit cycle. Need to confirm data integrity holds
   across: (a) multiple different field-value combinations (not just the
   one Activity/Sub-Activity we've always used), (b) a resubmit (does
   CI's *edited* data after a reject correctly reach EE/QI, including any
   fields left unchanged from the original submission?), (c) QI's screen
   specifically (only EE was inspected so far).

## Deferred (validation-rule / cross-entity phase, not current scope)

Surfaced via the PULSE User Manual (2026-08-19) and app owner's Work
Section clarification — real app behaviors worth testing eventually, but
out of scope for the current "do values persist correctly" phase per the
scope decision above:

- Work Section uniqueness enforcement: does the app actually remove an
  already-used Work Section from the dropdown for the same
  Activity/Sub-Activity/Checkpoint combination? (see `rfi-business-logic.md` §3a)
- Resubmit-time Work Section add/remove/change behavior, and its
  "target Work Section must not already have an active RFI elsewhere"
  constraint
- RFI↔NC linkage: QI raising a linked NC from a checklist item during
  review, and the "RFI cannot be resubmitted while a linked NC is open"
  block (see `rfi-business-logic.md` §10). **Explicitly parked by app
  owner** (2026-08-19): "wait for RFI linked NC we will do later along
  with different scenario" — don't start on this until it's brought back up.
- Checkpoint-level dependency enforcement (§6a): creating an RFI for
  checkpoint N+1 on a Work Section before checkpoint N is EE+QI-approved
  on that same Work Section should be blocked — not yet tried live.
- Cross-Activity dependency enforcement (§6b): Table/Inverter/Block-scoped
  blocking — not yet tried live.
- Quantity/UOM validation (§11): UOM-mandatory-when-Quantity-entered, and
  UOM dropdown filtering — not yet tried live with a non-null Quantity.

## Sources

- Live inspection: `00_inspect_rfi_data_integrity.spec.js`
- App owner direct explanation (chat, 2026-08-19) — WAM/SO Mapping/RFI
  relationship, Work Section semantics
- `tests/fixtures/Activity Master and Checklist Mapping_Solar (1).xlsx`
- **PULSE User Manual** (shared 2026-08-19, not stored in this repo) — used
  for role hierarchy/WAM/SO Mapping/reassignment/dashboard-tile overview
  only. Per explicit app owner instruction, its RFI/NC creation-form
  sections are outdated (post-manual change requests) and are NOT used as
  reference for RFI/NC form behavior specifically.

## Next steps

- [x] Get app owner's explanation on remaining open questions above
- [x] Decide read-back method design — line-by-line label parsing on the
      page's visible text (`RFIReviewPage.readAllFields()` and friends),
      confirmed live against the real app
- [x] Build read-back methods on `RFIReviewPage` for each in-scope field,
      including the Quantity/Unit-vs-Sub-Contractor empty-field-rendering
      distinction (`-` placeholder vs. truly absent)
- [x] Decide spec structure — new dedicated spec
      (`tests/specs/23_rfi_data_integrity.spec.js`), doesn't touch
      `rfi-tracker.json`, mirrors the throwaway inspector's ad-hoc-TC
      convention
- [x] Extend coverage to QI's screen — done, same spec covers CI
      create-echo → EE review → QI review in one pass
- [x] Add a resubmit scenario (does CI's *edited* data after a reject
      correctly reach EE/QI, including fields left unchanged from the
      original submission?) — written (test 2 in the spec); hit and fixed
      an infrastructure hang along the way (see Infra note below),
      re-confirming now
- [ ] Re-run against a second, different Activity/Sub-Activity combination
      to make sure findings aren't specific to "Piling - MMS" — open
      question 7, still not covered

## New scenario: Draft/autosave (2026-08-19)

Separate feature from the create/resubmit data-integrity checks above —
tracked in full in `rfi-business-logic.md` §12, spec at
`tests/specs/24_rfi_draft_autosave.spec.js`. Summary:

- CI navigating away from the Create RFI form (browser Back OR an in-app
  nav click, both tested) with only Work Location filled — no other
  field, not even a required one — persists a local draft, surfaced as
  an "In-Draft" row in Pending with me.
- Key point (app owner): validation is NOT enforced for the draft-save,
  unlike Proceed (which `02_rfi_ci.spec.js` test 3 already showed is
  silently blocked when required fields are missing). The new spec
  asserts both halves of that asymmetry directly.
- The draft is local-browser-only, not server-side — lost on a fresh
  login/context. Create, verify, resume, and complete must all happen in
  one continuous session.
- **Resolved**: app owner confirmed (live screenshot, 2026-08-19) a
  draft's Actions-column eye icon works exactly like a submitted row's —
  an earlier automated probe wrongly concluded it didn't exist because
  it gave up scrolling right too early. `RFIListPage.openDraftRow()` now
  reuses the proven scroll-and-poll technique from `openRowByCode()`,
  located by "In-Draft" status text instead of a code. Re-clicking
  "Create RFI" also works as a fallback (both confirmed live).
- Uses the Sub-Contractor Name field as a scenario marker (app owner's
  suggestion) to confirm the completed draft's data reaches EE/QI
  unchanged, same principle as `23_rfi_data_integrity.spec.js`.
- **Also fixed along the way** (both real test-infra bugs, not app
  bugs): `MyTasksPage.clickPendingWithMe()` could be unresponsive to its
  first click right after this exact kind of navigation sequence
  (user-observed live) — same "looks loaded, isn't interactive yet"
  quirk `DashboardPage.goToMyTasks()` already had a retry loop for, now
  added here too. The "Pending with me" tile's COUNT badge, by
  contrast, was deliberately **not** fixed and **not** asserted on — 7
  reproducible failures across every fix tried (longer wait, 45s poll,
  Dashboard round trip, genuine `page.reload()`) all showed the same
  thing: the tile's digit never rendered within this flow, even though
  `networkidle` had already resolved. The spec asserts only on the
  "In-Draft" row in the grid, which has been reliable every run.

**Status: both scenarios pass** (`RFI-A-06c-BL02-CIV-694` browser-back,
2.1m; `-695` nav-click, 2.3m; 2 passed, 4.3m total, 2026-08-19) —
Proceed-blocked-then-draft-saved-anyway, "In-Draft" row, eye-icon resume,
full completion, and the Sub-Contractor marker surviving to both EE and
QI review all confirmed live.

## Infra note: CI-login hang during the resubmit scenario (2026-08-19)

Not a data-integrity bug — a test-infrastructure bug that blocked the
resubmit scenario from completing at all. Root-caused and fixed; recorded
here since it lived in this scenario's path.

- **Symptom**: the resubmit test's *second* CI login (create → EE reject →
  CI resubmit) stalled for the full 20-minute test timeout instead of
  ~1 minute. First observed live (17+ min idle on CI login, user watching);
  reproduced for real on a background rerun with a full stack trace.
- **Root cause**: `DashboardPage.resolveIncompleteDownloadBanner()` calls
  `page.reload()` then a bare `page.waitForLoadState('networkidle')` with
  no timeout. `playwright.config.js`'s `actionTimeout: 30000` does **not**
  cover `waitForLoadState` (that needs `navigationTimeout`, which isn't
  set), so it had no ceiling at all. On a page already through a prior
  role login in the same test (service worker/PWA background sync already
  active from that earlier session), the reload can leave network activity
  in flight indefinitely — `networkidle` never resolves, and the wait
  silently rode all the way up to the test's own timeout instead of
  failing fast. A single fresh login (new context, no prior session) does
  **not** reproduce it — confirmed via an isolated instrumented rerun
  (`00_inspect_ci_login_hang.spec.js`) that finished the same step in ~2s.
- **Fix**: bounded both `networkidle` waits in that function to 60s with
  `.catch(() => {})`, falling through to the content-visibility wait
  (which already had its own 300s timeout) as the real gate. See
  `tests/pages/DashboardPage.js`'s `resolveIncompleteDownloadBanner()`
  comments for the full explanation.
- **Not yet done**: this same bare-`networkidle`-with-no-timeout pattern
  exists elsewhere in the codebase (`goToDashboard()`, `logout()`, etc.) —
  those haven't shown this failure mode live, so left as-is per "don't fix
  what isn't confirmed broken." Worth keeping an eye on if a similar stall
  shows up somewhere else.

## Status

**Basic create → EE → QI scenario (test 1): passed cleanly, multiple runs**
(2.1 min each, `RFI-A-06c-BL02-CIV-686` then `-687`, 2026-08-19) — every
field matched at CI create-echo, EE review, and QI review on the first
try: exact matches for Work Location/Area/Package/Activity/Sub-Activity/
Inspection Checkpoint/Checklist, the Sub-Package loose-substring match,
correct `-`-vs-truly-empty rendering for Quantity/Unit/Sub-Contractor,
Work Section consistency (captured at creation, matched at both reviews),
and all 16 checklist observations.

**Resubmit scenario (test 2): passed** (3.0 min, `RFI-A-06c-BL02-CIV-688`
→ v2, 2026-08-19) once the CI-login hang below was fixed — all fields
matched at CI resubmit-echo, EE review, and QI review, including the
deliberately-different `"Resubmitted - verified OK N"` observation text
(ruling out a stale-old-text false pass).

No data-integrity bugs found in either scenario — every gap hit so far has
been test-infrastructure (the hang below, and the stale-Work-Section
anomaly below), not mangled field values.

### Open anomaly: stale Work Section offered by the dropdown (2026-08-19, not yet root-caused)

Surfaced on a full combined run of both tests back-to-back, immediately
after the hang fix above — test 1's very first RFI creation (a scenario
that had passed cleanly twice before) failed with:

> Validation Error: An RFI already exists for the workSections: R01-T74.

`RFICreatePage.selectWorkSection()` picks the *first* option the dropdown
currently offers — here the app's own backend rejected that same option as
already consumed. Per `rfi-business-logic.md` §3a, already-used Work
Sections are supposed to be removed from the dropdown entirely, so this
reads as the dropdown showing **stale** data rather than the uniqueness
rule itself failing.

**Resolved (app owner, 2026-08-19)**: this is a known symptom of cookies
not being fully cleared before login — the fix is simply to retry via a
fresh login, not to change which Work Section gets picked.

**Fix implemented**: `RFICreatePage.clickProceed()` now races the normal
success signal ("Answer all the questions" appearing) against the
validation-error toast text ("already exists for the workSections") —
same `Promise.race` idiom `DashboardPage.waitForLoad()` already uses. On
the error winning, it throws a tagged error (`err.staleWorkSection =
true`) instead of silently burning the full 30s timeout. A new shared
helper, `withLoginRetryOnStaleWorkSection(page, role, action)` in
`rfi-flow-turns.js`, catches only that tagged error, does a fresh
`loginAsRole(page, role)`, and retries `action` once from scratch. Wired
into `runCITurn` (covers specs 08 and 21 automatically, since both share
it) and directly into both of `23_rfi_data_integrity.spec.js`'s
create/resubmit call sites.

**Confirmed fixed**: full spec re-run, both tests passed cleanly with no
stale-Work-Section rejection (`RFI-A-06c-BL02-CIV-689`, 2.1m;
`RFI-A-06c-BL02-CIV-690` → v2, 3.0m; 2 passed, 5.1m total, 2026-08-19).
