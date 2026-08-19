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
| Work Section | ⚠️ **not a fixed value to assert against** | `RFICreatePage` picks "first available" (`R01-T71` this run), not a value from `RFI_DATA` — see open question below |
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
3. **Still open**: Work Section has no fixed expected value in our
   automation. Do we (a) skip verifying it, (b) capture whatever CI's
   session actually picked at creation time and assert EE/QI see that same
   value (tests "it's consistent," not "it's correct"), or (c) something
   else?
4. ~~Is Project Name meaningful to verify?~~ **Resolved**: skip, it's fixed/global.
5. **Still open**: does the app enforce Activity Dependency / Checkpoint
   Dependency (see `rfi-business-logic.md` §6), or is that master data
   purely informational? Not yet tested live.
6. **Still open**: WAM ↔ SO Mapping ↔ RFI linkage itself isn't verified by
   any current automation — we only see the *result* (Contractor
   Name/Service Order on the RFI), never cross-check it against the SO
   Mapping config that should have produced it. App owner flagged this as
   a separate future deep-dive, not immediate scope.
7. **Still open**: this was tested with ONE TC, ONE set of `RFI_DATA`
   values, no reject/resubmit cycle. Need to confirm data integrity holds
   across: (a) multiple different field-value combinations (not just the
   one Activity/Sub-Activity we've always used), (b) a resubmit (does
   CI's *edited* data after a reject correctly reach EE/QI, including any
   fields left unchanged from the original submission?), (c) QI's screen
   specifically (only EE was inspected so far).

## Next steps

- [ ] Get app owner's explanation on remaining open questions above
- [ ] Decide read-back method design (likely: parse the review page's full
      text dump the way the inspector did — label immediately followed by
      value — rather than a generic DOM query, since `label`/`dt+dd`
      queries mostly matched irrelevant radio-button pairs in practice)
- [ ] Build read-back methods on `RFIReviewPage` (or a shared mixin) for
      each in-scope field
- [ ] Decide spec structure: new dedicated spec vs. assertions folded into
      existing flow specs (leaning dedicated, so a data-integrity failure
      is distinguishable from a flow-mechanics failure)
- [ ] Extend coverage to QI's screen, and to a resubmit scenario
- [ ] Re-run against a second, different Activity/Sub-Activity combination
      to make sure findings aren't specific to "Piling - MMS"

## Status

**Phase: business-logic understanding + inspection.** No read-back methods
or assertions written yet — intentionally paused here pending app owner's
explanation of the remaining open questions before writing any code.
