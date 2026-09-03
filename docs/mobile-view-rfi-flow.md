# Mobile (smartphone) view — RFI flow

PULSE serves the **same responsive app at the same URL** to phones; there is no
separate mobile build and no separate route. Everything below is the difference
in *rendering* at a phone viewport, measured live rather than inferred.

Ground truth for this document is
`tests/specs/inspection/00_inspect_mobile_rfi_full_flow.spec.js`, which drives the real
solar RFI flow (CI create → EE review → QI approve) at a **Pixel 7** viewport
(412×839) and captures, per screen, into `tests/fixtures/mobile-dom-recon/`:

| artefact | contents |
| --- | --- |
| `<nn>-<label>.json` | inventory of every visible button / combobox / radio / checkbox / input / dialog / grid, with accessible name, `data-scope`, `data-part`, `data-state`, disabled + checked state |
| `<nn>-<label>.html` | full page HTML, for anything the inventory misses |
| `<nn>-<label>.png` | full-page screenshot |
| `index.json` | one entry per screen, in order |

**Why solar and not wind.** Solar has ~490 Work Sections per Work Area, so a run
consumes nothing that matters and the recon can be repeated as often as the DOM
needs re-reading. Wind has exactly **one** per Work Area and every run
permanently spends a (checkpoint, Work Section) pair — using wind to go hunting
for DOM would burn the checkpoints the wind smoke stage needs.

## Running it

```bash
# Full flow, creates a new RFI (solar: costs nothing)
PULSE_ENV=dev npx playwright test --project=chromium \
  tests/specs/inspection/00_inspect_mobile_rfi_full_flow.spec.js --headed --workers=1

# Re-run ONLY the EE/QI half against an RFI that already exists and is
# pending with EE. Skips the ~10-minute CI half and, more importantly, does
# not leave another RFI parked in a reviewer's queue.
PULSE_ENV=dev MOBILE_RECON_RFI_CODE="RFI-A-06c-BL22-CIV-679" npx playwright test ...

# Reject + resubmit cycle (separate test, off by default so it can never fire
# during a happy-path check). P1 = reject from review page 1, P2 = from the checklist page.
PULSE_ENV=dev MOBILE_RECON_REJECT=P1 npx playwright test ...
```

Resume runs number their screens from 51 so they cannot interleave with a full
run's 01–08.

## What actually differs on mobile

1. **The review screen is split across two pages.** Page 1 is RFI details with
   `Close` / `Reject RFI` / `Proceed` and **no Submit button and no checklist
   radios at all**. The checklist and Submit live on page 2, behind `Proceed`.
   Desktop renders both panes at once. This is why both `approve()` and
   `rejectFromChecklistPage()` need `_ensureChecklistPage()` first.

2. **Lists render as CARDS, not a grid.** `[role="grid"]` does not exist on the
   mobile Pending-with-me list; `RFIListPage.waitForGrid()` returns `'cards'`.
   The card is a `data-scope="collapsible" data-part="trigger"` button whose
   accessible name is the whole record — code, version, status and every field
   concatenated. Clicking it **expands** it rather than opening the record; a
   scoped `Review` button then opens it.

3. **An empty list shows "No RFIs found"** with no "Total RFIs" header, so a
   check made right after an approval (which by definition empties that role's
   queue) must treat that as a valid loaded state, not a timeout.

4. **There is no breadcrumb**, so the RFI code is not readable from one; it is
   CSS-truncated in the header. `BasePage.getVisibleCode()` falls back to
   scanning leaf elements.

5. **Nav is an unlabelled hamburger** (`svg.lucide-menu`) instead of a sidebar.

6. **The create form is unchanged in structure** and works as-is: 10 cascading
   comboboxes, then `Cancel` / `Draft` / `Proceed` on page 1 and `Submit` on
   page 2. No mobile-specific work was needed for CI's half.

## Role differences that are not about viewport

**`MyTasksPage.waitForLoad()` waits for the "Create RFI" button, which only CI
has.** Confirmed live: an EE's My Tasks renders the RFI/NC tabs and all three
tiles but no Create RFI button — reviewers do not create RFIs — so
`waitForLoad()` can never resolve for EE or QI and burns its full 30s on a page
that had loaded perfectly well. Use `waitForTasksReady()` for anything
role-agnostic; `waitForLoad()` is kept as-is because the CI specs calling it are
legitimately asserting that CI *can* create.

The "Pending with me" tile exists only for CI, EE and QI — the roles that take
part in the RFI/NC flow.

## The dialog positioner trap

This one is **not mobile-specific** and it was silently degrading assertions
across the suite.

Ark UI mounts **three** elements per dialog — `positioner`, `content`, `title`.
The **positioner also carries `data-scope="dialog"`** but has **no `role`
attribute**, and it is a permanently-mounted full-viewport container
(`pointer-events: none`). Only the **content** element carries `role="dialog"`
and gets `hidden` + `data-state="closed"` when the dialog closes.

| | positioner | content (`role="dialog"`) |
| --- | --- | --- |
| before ever opening | present, **Playwright-visible** | absent or `hidden` |
| open | present | `data-state="open"`, `pointer-events: auto` |
| dismissed | present, **still Playwright-visible** | `data-state="closed"` + `hidden=""` |

Verified in isolation: `locator('[role="dialog"], [data-scope="dialog"]')
.filter({ hasText: /are you sure/i })` matches **2** elements — `.first()` is the
**positioner**, `isVisible = true`.

So any locator of that shape taking `.first()` resolved to the element that is
**always visible**:

- `waitFor({ state: 'visible' })` resolved instantly whether or not the popup
  ever opened — asserting nothing.
- `waitFor({ state: 'hidden' })` could never resolve.

**Mounting differs per dialog**, which is why some paths broke and others got
away with it:

- *mounted only while open* — the review page's approve/reject confirm. Detaches
  on close, so its waits behaved correctly even before the fix.
- *permanently mounted* — the review page's `Reject RFI Details` popup, and the
  create page's `Cancel RFI` and `submit RFI` confirms. Their positioners are in
  the DOM from first render (recon screen 54 shows the reject positioner present
  before anything was clicked; screen 03 shows both create-page confirms present
  on an untouched form).

**Fix:** scope to the content element —
`'[role="dialog"], [data-scope="dialog"][data-part="content"]'` — the idiom
`DashboardFilterPage.js` already documents and `WAMPage` / `UserManagementPage` /
`BasePage` already use. Applied to `RFIReviewPage` (×2), `RFIChecklistPage`,
`ReassignPage` and `rfi-dependency-flow.js`.

### This explains the Work Section contradiction

`00_inspect_rfi_cancel_confirm_releases_section.spec.js` concluded that
Cancel+confirm does **not** release a Work Section. It used a bare
`page.locator('[role="dialog"], [data-scope="dialog"]').first()` with no filter
at all — it was waiting on the positioner, so its "Yes" was never clicked and
nothing was ever released. The app owner's correction was right; see the
SUPERSEDED note in `docs/rfi-activity-dependency-chain.md`.

## Status

Full mobile CI -> EE -> QI cycle proved in ONE session on 2026-09-01:
`RFI-A-06c-BL22-CIV-679` created, EE-approved and QI-approved at 412x839.


All four combinations (RFI x {solar, WTG} x {desktop, mobile}) are GREEN as of
2026-09-01. Per-step detail for mobile:

| step | desktop | mobile |
| --- | --- | --- |
| CI create + submit | green | **green** (`RFI-A-06c-BL22-CIV-679`) |
| EE approve | green | **green** |
| QI approve | green | **green** |
| EE reject (page 1) | green | **green** (`683`) |
| EE reject (checklist) | green | **green** (`684`) |
| CI resubmit + EE/QI re-approve | green | **green** (`683`) |

### Reject + resubmit, measured on mobile (`683` = P1, `684` = P2)

Full chain green: CI create -> EE reject from page 1 -> CI resubmit -> EE
approve -> QI approve.

**A rejected RFI opens straight onto the EDITABLE resubmit form for CI.** The
URL is `/my-tasks/rfi/<id>/re-submit` immediately — there is NO read-only
`/view` carrying a separate "Resubmit" button to click first. This contradicts
the assumption in `rfi-flow-turns.js` `resubmitRfi`, that the eye icon always
lands on `/view`. `RFIListPage.openRowByCode` now accepts `(view|re-submit)`;
asserting only `/view` made it time out on a perfectly loaded page and report
the misleading "the RFI never became visible here".

**The page-1 lock rule holds, and BOTH halves are now asserted live on mobile:**

| rejected from | page 1 on resubmit | proved by |
| --- | --- | --- |
| review page 1 | **editable** (`isFirstPageLocked() === false`) | `683` |
| checklist page 2 | **locked** (`true`) | `684` |

**"Not Ok" marks do NOT carry over to the resubmitted child.** After a P2
rejection where EE explicitly marked an item Not Ok, both EE and QI saw
`16 "Ok" radio(s) present, flipped 0` on the child. The `total` matters: a bare
`flipped: 0` would have been ambiguous between "all already Ok" and "found no
radios at all" (they only exist once the accordion is expanded), so
`setAllChecklistOk()` returns `{ total, flipped }` and the caller asserts
`total > 0`.

So `approve()`s reject-guard should never fire in normal operation. It is kept
as a safety net, not a fix for a live bug: if a future build DOES carry those
marks over, it turns a silent wrong-direction rejection into a loud failure.

**Resubmit creates a new child and the code holds**: `id changed: true`,
`code changed: false` — consistent with the composition rule, since work
location, work area and package were untouched.

**The stale-Work-Section retry needs a DIFFERENT section, not a fresh login.**
Retrying with `workSection: null` failed identically 3 times, because "pick the
first available" re-picks the same option every time. If the dropdown offers an
already-consumed section at position one, only choosing another section helps.
The app-owner advice to relogin addresses the cookie variant of this message —
a different cause wearing identical wording. The recon now retries with
`__random__` and logs the section it picked.

## The "already exists for the workSections" error — CAUSE CORRECTED

> **This was originally written up here as an app-side filtering gap. That was
> wrong.** The app owner identified the real cause: session state surviving a
> login. The error was the backend correctly refusing a Work Section that our
> own leftover local state was still holding.

`context.clearCookies()` does NOT clear localStorage, and PULSE keeps an
autosaved RFI draft there. Selecting a Work Section on the Create-RFI form
autosaves that draft, and the draft keeps **holding** the section. Both
`loginAsRole` and `loginAsFlowUser` were clearing cookies — which is why the
logins LOOKED clean — so every "fresh login" still found the old draft and the
backend kept answering:

> Validation Error: An RFI already exists for the workSections: R01-S05

What made it look like an app bug (and why that reading was seductive):

* `R01-S05` had been consumed by `RFI-A-06c-BL22-CIV-683`, which was created,
  resubmitted AND fully approved — so "the dropdown is offering a completed
  section" was a plausible story.
* It was STICKY, not intermittent — the same section was offered and refused
  3 for 3, then again on the next run. Sticky local state looks exactly like a
  sticky server-side filtering bug from the outside.
* Retrying via a fresh login changed nothing, which I read as "relogin does not
  help, therefore server-side". The relogin genuinely did not help — because it
  never cleared the draft.

A second, independent mistake compounded it: `workSection: null` means "pick the
first available", so each retry re-picked the *same* held section. Retrying with
`__random__` stepped past it — but that is a WORKAROUND for a cause now fixed,
and it can mask a returning session leak. Prefer `null` once the session clear
is trusted.

**The fix, and the standing rule:** before ANY new login, clear the whole
session — `clearBrowserSession(context, page)` in `tests/utils/helpers.js`
(cookies + localStorage + sessionStorage). All three page-reusing logins route
through it. `adminFreshLogin` / `loginFreshRoleSession` build a brand-new
context, which starts clean, so they keep a plain `clearCookies()`.

**Lesson worth keeping:** when a PULSE symptom looks like stale-but-served data,
suspect surviving local state before suspecting the backend.
## Submit silently no-ops on the reviewer page — cause STILL UNKNOWN

> **RETRACTED.** This section previously claimed the reviewer's `Capture Photo`
> boxes are mandatory and that the app enforces them via a silent no-op. **That
> was wrong.** The app owner disproved it by approving the SAME checklist
> (`OGL Checklist`) manually as EE on mobile with **"No photos added" on every
> item** — `RFI-WTG-Khavda-KH 60-CIV-3045`, approved successfully. Photos are
> NOT mandatory, and this is expected app behaviour.

### What was actually observed

On `RFI-WTG-Khavda-KH 53-CIV-3043` (wind `A1.18.2` / `OGL Checklist`), EE's
review page 2 had every item set to Ok, five empty "Use Camera" boxes, and
clicking Submit did **nothing at all** — no confirm dialog, no toast, no inline
error, across 23 polls over 15s. Filling the five photos and clicking the same
Submit then worked immediately.

### Why "photos are mandatory" did not follow

That is **correlation only**. The counterfactual — submit without photos but
wait longer — was never tested, and it is exactly the case the app owner then
demonstrated works. Filling five photos takes roughly **30 seconds** of
interaction, so the delay is at least as good an explanation as the photos, and
a much better fit for "no validation message of any kind": a form that is not
ready yet produces silence, whereas a genuine required-field violation would
normally say something.

### Where it stands

Leading hypothesis: a **timing / readiness problem** — the Submit click does not
register until the review form has fully hydrated. Not yet proven.

Response in code: `approve()` now waits ~3s and **clicks Submit once more**
before failing, and only then raises `SUBMIT_DID_NOT_CONFIRM` carrying the app's
own message (or explicitly noting there was none). The photo-filling helper has
been **deleted** — it cost ~30s per approval and wrote junk photos into real
records on a false premise.

Still unexplained: why the very first WTG-mobile attempt failed while WTG
desktop and all four solar cycles passed without any of this. If it recurs, the
thing to capture is the radio/field state and elapsed time at the moment of the
click — not the photo boxes.

## Open items## Open items

- `approve()` now refuses to submit when the confirm popup says *reject* rather
  than *approve*, since the same Submit button does both and a carried-over
  "Not Ok" would otherwise reject while the caller believed it approved.
  `setAllChecklistOk()` is the remedy. Whether "Not Ok" actually carries over to
  a resubmitted child is **unconfirmed** — `23_rfi_data_integrity.spec.js`
  passing suggests it does not.
- **Desktop regression: PASSED.** `smoke-solar-rfi-desktop --no-deps` ran green
  (`RFI-A-06c-BL21-CIV-685`, CI -> EE -> QI, 3 passed / 10.3m) with every change
  live, so the shared page-object edits do not regress desktop. That run covered
  the refactored `approve()`, `_ensureChecklistPage()` (returns false immediately
  on desktop), the content-scoped dialog locators via `confirmSubmit` and
  `_waitForPopupToClose`, `discardCreateForm`, and the desktop grid row path.
- NOT covered by that probe: **reject / resubmit on DESKTOP**. Those paths are
  only proved on mobile so far. `23_rfi_data_integrity.spec.js` is the right
  probe (the one spec exercising approve, checklist-reject AND resubmit through
  these locators), but it uses the `.env` CI/EE/QI accounts and whether those
  are provisioned on pulse-dev is unconfirmed — running it there could fail for
  reasons unrelated to these changes.
- `RFIListPage.openRowByCode` now accepts `(view|re-submit)` on the MOBILE card
  path only. The desktop eye-icon path has no `waitForURL` at all, so desktop
  behaviour is untouched.
- `.env` contains **four** `BASE_URL` lines. dotenv keeps the first and ignores
  the rest, so the effective target is not obvious from reading the file. Prefer
  `PULSE_ENV` and collapse those to one line.
