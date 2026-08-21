# RFI Activity Dependency chain validation

Validates the checkpoint-level Activity Dependency rule already documented
in `docs/rfi-business-logic.md` §6a ("For a specific Work Section, the RFI
for checkpoint N+1 cannot be created until the RFI for checkpoint N — for
that exact same Work Section — has been approved by both EE and QI"), which
that doc explicitly flagged as **confirmed enforced but not yet automated**.
Now automated and passing for all three Piling activities, plus a fourth,
structurally different activity (scarce Work Section — see its own
section near the end of this doc).

Spec: `tests/specs/29_rfi_activity_dependency.spec.js` (Piling activities)
and `tests/specs/30_rfi_activity_dependency_scarce_work_section.spec.js`
(IDT Civil & Structural). Helpers: `tests/utils/rfi-dependency-flow.js`,
`tests/utils/rfi-dependency-data.js`.

## Scope

All THREE Piling activities: Piling - MMS, Piling - Inverter, Piling - LT
Cable Hanger System. Per
`tests/fixtures/Activity Master and Checklist Mapping_Solar (1).xlsx`
(sheet "Activity-Checklist_06.05.2026") and live confirmation
(`00_inspect_rfi_piling_activities.spec.js`), all three share an identical
5-checkpoint sequence and checklist names — only the Activity/Sub-Activity
name differs, and each has its own Work Section naming scheme (Piling -
MMS: "R0X-S0Y"; Piling - Inverter / LT Cable Hanger System: "I##").

Only the first **three** of each activity's five checkpoints are exercised:

1. Pre Pour Inspection - Pile — checklist "Micro Pile Checklist"
2. Pre Pour Inspection - Pile Cap — checklist "Micro Pile Cap Checklist"
3. Post Pour Inspection — checklist "Post Pour Check"

Deliberately **out of scope**, not silently assumed to behave the same way:

- **Epoxy Coating** (checkpoint 4) — the spreadsheet's "Preceding Inspection
  Checkpoint" column is "-" (none listed) for this row, unlike checkpoints
  1-3 which chain linearly. Whether the app enforces any dependency for it
  at all is unconfirmed.
- **Routine Testing** (checkpoint 5) — live inspection
  (`00_inspect_rfi_dependency_checkpoints.spec.js`) showed its "Inspection
  Checklist" dropdown rendering checkpoint names instead of checklist
  options — a broken/non-standard UI this suite doesn't have support for.
  The spreadsheet separately describes it as "No Checklist; only testing
  report to be uploaded."

Only the first version (V1) of every RFI is exercised — no reject/resubmit
cycles. Every RFI is approved by both EE and QI.

## Isolation from the tracked regression

This spec never imports `tracker-utils.js` and never touches
`tests/fixtures/rfi-tracker.json` / `nc-tracker.json` — same convention as
`23_rfi_data_integrity.spec.js` / `24_rfi_draft_autosave.spec.js`. Every RFI
it creates is ad-hoc and throwaway. Work Area is **BL09**, deliberately
different from the shared `RFI_DATA`'s BL02 (under constant churn from the
tracked regression) — chosen live, confirmed by the app owner to have no
pre-existing RFIs.

## The real bug this spec had to work around: selecting a Work Section — even without ever submitting — permanently consumes it

This was the main blocker during development and is worth documenting in
detail, since it isn't the checkpoint-dependency rule itself but a separate,
real app behavior any RFI-flow test (or real user) could hit.

**What happens**: opening the Create RFI form, filling it out through a
specific Inspection Checkpoint, and merely *selecting* a Work Section in the
multi-select — even if Proceed is never clicked, or is clicked and blocked
by the dependency check, and the draft is then abandoned via Cancel — makes
that exact (checkpoint, Work Section) pair unavailable for that checkpoint
again. Confirmed live and isolated step by step:

- `00_inspect_rfi_work_section_reuse.spec.js`: a Work Section stays fully
  available for the *next* checkpoint immediately after being used to
  **submit** a real RFI for the current one (same session, no relogin).
- `00_inspect_rfi_work_section_reuse_staged.spec.js`: that availability
  survives a CI relogin, EE approval, QI approval, and another relogin —
  `selectWorkSection()` itself succeeds at every one of those stages.
- `00_inspect_rfi_work_section_abandon_draft.spec.js`: the one case that
  DOES break it — selecting a Work Section, getting blocked on Proceed (or
  just never submitting), then abandoning via Cancel — dropped the Work
  Section count for that checkpoint from 492 to 491, even though no RFI was
  ever created. Confirmed by the app owner: selecting-then-leaving autosaves
  a local RFI draft (see `project_rfi_draft_autosave_feature`), and that
  specific (checkpoint, Work Section) combination stays tied up in it.
- Critically, a fresh `loginAsRole()` does **not** clear this — it only
  calls `page.context().clearCookies()`, not `localStorage`, so the stale
  draft (and the Work Section it's holding) survives every relogin this
  suite does. The app owner described the real fix as clicking Cancel *and
  then confirming the resulting "discard draft?" popup* — `resetToMyTasks()`
  now does this, defensively (`[role="dialog"]` → button matching
  `/yes|confirm|discard|cancel/i`), but the spec's design doesn't actually
  depend on it working (see below).

**The fix — never let a "prove this is blocked" attempt touch a Work
Section the real chain needs later.** Every deliberately-blocked attempt in
`runDependencyChainForActivity()` uses `selectWorkSection('__random__')` on
a **throwaway** basis — that specific Work Section is written off the
moment it's picked and is never reused for anything. The Work Section
shared across the real chain (`workSection`) is picked from checkpoint[0]'s
*own* creation instead, which always genuinely submits (never abandoned),
so it's never at risk of this bug. This is simpler and more robust than
trying to force a proper cleanup of the abandoned drafts.

## Step ordering

For each transition `checkpoints[i] -> checkpoints[i+1]`:

1. Attempt `checkpoints[i+1]` (throwaway Work Section) while `checkpoints[i]`
   doesn't exist / isn't approved yet → **must be blocked**.
2. Approve `checkpoints[i]` (EE then QI).
3. Create `checkpoints[i+1]` **for real**, using the shared `workSection` →
   **must now succeed** (it's the next transition's own prerequisite).

`checkpoints[0]` has no prerequisite, so it's created directly (and is
where `workSection` is first picked) — but its approval is deliberately
delayed until *after* `checkpoints[1]`'s blocked attempt is captured
(approving it immediately would make it impossible to ever again observe
`checkpoints[1]` as blocked).

For the 3-checkpoint scope here, this produces exactly two blocked→unblocked
demonstrations per activity: Pile → Pile Cap, and Pile Cap → Post Pour
Inspection — the second one specifically proving the app checks the
*immediate* predecessor's approval state (created but not yet approved is
still blocked), not just "something earlier in the chain is approved
somewhere."

## Toast/validation-error detection — real wording, confirmed live

No generic toast-reading helper existed anywhere in the RFI page objects
before this. `RFICreatePage.clickProceedAndCheckOutcome()` races page-2
navigation against `[data-scope="toast"], [role="alert"], [class*="error"]`
and reports back whatever text actually appeared, rather than asserting a
guessed string.

**Real, confirmed toast text** (varies slightly — sometimes includes the
Work Section list, sometimes doesn't):

> Validation Error
> Missing an RFI for Dependent Inspection Point: Pre Pour Inspection - Pile of the Activity: Piling - MMS on the workSections R09-S12.

> Validation Error
> Missing an RFI for Dependent Inspection Point: Pre Pour Inspection - Pile Cap of the Activity: Piling - MMS on the workSections R29-S12.

Confirms the message names the specific missing *checkpoint* and *Work
Section*, and is specific to the immediate predecessor, not a generic
"dependency missing" message.

## Status: all three PASSING

- **Piling - MMS**: passing (~5.3 min)
- **Piling - Inverter**: passing (~5.6 min)
- **Piling - LT Cable Hanger System**: passing (~5.3 min)
- **IDT Civil & Structural - Cable Rack** (scarce Work Section — see below):
  passing (~5.4 min, first attempt)
- **IDT Civil - HT / LT Platform** (scarce Work Section, different
  6-checkpoint activity — see below): passing (~5.6 min, first attempt)

Each run is ~9 logins (CI/EE/QI × 3 checkpoints, plus the initial CI
session) — run one activity/spec at a time, never concurrently (shared
login users, one browser session at a time).

## A second variant: activities with only ONE Work Section per Work Area

`tests/specs/30_rfi_activity_dependency_scarce_work_section.spec.js` covers
"IDT Civil & Structural" (Sub-Activity "IDT Civil & Structural - Cable
Rack") — confirmed via the spreadsheet (rows 38-40, checkpoint codes
A.2.3.1-3) to have the exact same 3-checkpoint chain and checklist names as
the Piling activities, but a different "Min. Unit of RFI" ("Block" instead
of "Per Table"/"Per Inverter"). Confirmed live
(`00_inspect_rfi_idt_civil_structural.spec.js`): its Work Section dropdown
has exactly **one** option, literally the selected Work Area's own name
(e.g. selecting Work Area "BL09" makes "BL09" the only Work Section).

This breaks the throwaway-Work-Section strategy the Piling spec uses —
there's nothing else to sacrifice within one Work Area, so a
blocked-attempt would burn the ONLY option and leave nothing for the real
chain. Tried the app owner's suggested alternative first — clicking Cancel
and then confirming the resulting "are you sure?" popup should properly
delete the draft/RFI, releasing the Work Section — but confirmed live
(`00_inspect_rfi_cancel_confirm_releases_section.spec.js`) that this did
**not** work: the option went from `["BL09"]` to `[]` for that checkpoint
even after Cancel + confirming the popup.

The fix that worked: a second orchestration function,
`runDependencyChainForScarceWorkSectionActivity()` (in
`rfi-dependency-flow.js`), using **two Work Areas** instead of two Work
Sections — `throwawayWorkArea` (sacrificed entirely; every blocked-attempt
check happens there, whichever checkpoint) and `realWorkArea` (never
touched by a blocked attempt; the whole real chain runs there). No
random/label Work Section logic is needed at all, since there's only ever
one option to pick. Passed on the first live attempt.

This pattern generalizes to any other "Block"/Work-Area-level activity —
just needs its own confirmed-fresh `realWorkArea` and reuse of the same
`throwawayWorkArea` (BL09). Confirmed with a second, structurally
different Sub-Activity: "IDT Civil - HT / LT Platform" — a longer
6-checkpoint chain per the spreadsheet (rows 21-26, codes B1.1.1-6), not
the same 3-step chain past checkpoint 2 (its own checkpoint 3 is "Pre Pour
Inspection for Column & Slab - Cast-in-Situ" / checklist "Pour Card", not
"Post Pour Inspection"). Its first two checkpoints' checklist column in
the spreadsheet reads as a conditional choice ("If Open Foundation: ... /
If Micropiling Foundation: ...") — possibly the "pick any one of several
checklist options" case flagged at the start of this work — but confirmed
live (`00_inspect_rfi_idt_ht_lt_platform.spec.js`) that only ONE checklist
option ever actually renders in the dropdown (this environment
consistently resolves to the Micropiling Foundation checklists), so no
real multi-choice UI exists to exercise here. Both Sub-Activities safely
share the same `throwawayWorkArea`/`realWorkArea` pair (BL09/BL10) with no
cross-contamination — consumption is scoped per
Activity/Sub-Activity/Checkpoint/Work Section, so one Sub-Activity's
history in a Work Area doesn't affect another's.

**The "pick any one of several checklist options" mechanic remains
unexercised** — every checkpoint checked across all 4 activities/6
Sub-Activity-chains so far (Piling MMS/Inverter/LT Cable Hanger, IDT Civil
& Structural Cable Rack, IDT Civil - HT / LT Platform) has had exactly one
selectable Inspection Checklist option live, regardless of what the
spreadsheet's checklist column implies. If a genuine multi-option
checkpoint is ever found, the fix is simple (pick any one, per the app
owner's original guidance) but hasn't been needed in practice.

## Other real findings along the way

- A real **"Select All (N)"** control exists at the top of the Work Section
  multi-select — the app owner's alternative suggested strategy (select
  all, rotate Work Area each rerun) is a genuine, working UI feature, just
  not the one this spec uses.
- The Work Section list is a plain scrollable list, not virtualized — all
  ~490 options exist in the DOM at once (confirmed via `allInnerTexts()`),
  just visually clipped by scroll. `selectWorkSection()` calls
  `scrollIntoViewIfNeeded()` before checking visibility for this reason
  (kept as defensive code, though the actual root cause turned out to be
  the draft-consumption bug above, not scroll position).
- `RFICreatePage.fillForm()` and `selectWorkSection()` were extended
  (optional `label`/`'__random__'` argument, return the selected label) —
  purely additive; every existing caller's behavior is unchanged (verified
  via `git diff` and a regression run of `23_rfi_data_integrity.spec.js`).
