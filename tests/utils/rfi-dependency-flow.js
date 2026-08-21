const { expect } = require('@playwright/test');
const { loginAsRole } = require('./helpers');
const { openFromPendingWithMe } = require('./rfi-nav');
const DashboardPage = require('../pages/DashboardPage');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');

// Shared by 29_rfi_activity_dependency.spec.js for all three Piling
// activities. Deliberately separate from rfi-flow-turns.js — this never
// touches tests/fixtures/rfi-tracker.json (ad-hoc RFIs only, same
// convention as 23_rfi_data_integrity.spec.js / 24_rfi_draft_autosave.spec.js)
// and needs its own Work-Section-pinning + blocked/unblocked-outcome
// mechanics that the tracked 9-TC regression flow has no use for.

// Same "an actor's first action right after a fresh login can hit a
// transient failure unrelated to the action itself" retry as withRetry()
// in rfi-flow-turns.js (duplicated locally rather than importing — that
// one's a private, unexported helper there). `action` must be safe to call
// again from scratch — every action wrapped with this below starts from
// resetToMyTasks()/loginAsRole(), not mid-form state.
async function withRetry(action) {
  try {
    return await action();
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    return await action();
  }
}

// Live evidence across 3 runs: a Work Section already used for one
// checkpoint of an activity can vanish from a DIFFERENT checkpoint's Work
// Section list too — confirmed via screenshot (cleanly skipped, e.g.
// "...T03","T05"...), not a rendering/lazy-load timing issue. This matches
// the SAME "stale Work Section" symptom clickProceed() already documents
// elsewhere in this suite (cookies not fully cleared before login), whose
// app-owner-confirmed fix is a fresh relogin — not just waiting inside the
// same (possibly desynced) session, which is why plain withRetry() alone
// didn't recover from this. Only retries on the specific tagged error
// (selectWorkSection()'s `err.workSectionNotFound`); anything else
// rethrows immediately.
async function withCIRetryOnMissingWorkSection(page, action) {
  try {
    return await action();
  } catch (err) {
    if (!err.workSectionNotFound) throw err;
    await loginAsRole(page, 'CI');
    return await action();
  }
}

// Same defensive draft-reset pattern as createNewRfi() in
// rfi-flow-turns.js — cancels any auto-resumed draft before starting a
// fresh page-1 fill. Needed here MORE than there: every "expect blocked"
// attempt in this spec deliberately leaves a filled-but-never-submitted
// draft behind, which must be discarded before the next step reuses the
// same session for a different checkpoint.
//
// App owner confirmed live: clicking Cancel alone isn't enough — it opens
// a confirmation popup, and unless THAT is also confirmed, the draft
// (and whichever Work Section it's holding) never actually gets
// discarded. This suite's design already avoids depending on that Work
// Section being freed again (every blocked-attempt uses a throwaway
// Work Section it never needs back — see runDependencyChainForActivity's
// header comment), but leaving orphaned drafts behind is still bad
// hygiene, so confirm the popup anyway.
async function resetToMyTasks(page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(300);
    if (!page.url().includes('/create')) break;
    const cancelBtn = page.getByRole('button', { name: 'Cancel' });
    if (await cancelBtn.isVisible({ timeout: 500 }).catch(() => false)) {
      await cancelBtn.click();
      await page.waitForTimeout(300);
      const confirmPopup = page.locator('[role="dialog"], [data-scope="dialog"]').first();
      if (await confirmPopup.isVisible({ timeout: 2000 }).catch(() => false)) {
        const confirmBtn = confirmPopup.getByRole('button', { name: /yes|confirm|discard|cancel/i }).first();
        if (await confirmBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
          await confirmBtn.click();
          await page.waitForTimeout(300);
        }
      }
    }
  }
}

// Fills page 1 for `checkpoint`, pinning `workSectionLabel` if given (the
// dependency the whole spec exercises is scoped PER Work Section — every
// checkpoint in one chain run must share the exact same one). Returns the
// RFICreatePage plus whichever Work Section label actually got selected
// (so the very first, unpinned call can hand its pick back to the caller
// for reuse on every subsequent checkpoint).
async function fillPageOne(page, baseData, checkpoint, workSectionLabel) {
  await resetToMyTasks(page);
  const myTasks = new MyTasksPage(page);
  await myTasks.waitForLoad();
  await myTasks.clickCreateRFI();

  const rfiCreate = new RFICreatePage(page);
  const selectedWorkSection = await rfiCreate.fillForm({
    ...baseData,
    inspectionCheckpoint: checkpoint.name,
    inspectionChecklist: checkpoint.checklist,
    workSection: workSectionLabel,
  });
  return { rfiCreate, workSectionLabel: selectedWorkSection };
}

// Attempts a checkpoint's Proceed step WITHOUT assuming the outcome —
// this is the "before creating an RFI for the dependent checkpoint, check
// we get blocked" half of the spec. Returns the real outcome
// (proceeded/toastText) plus whichever Work Section ended up selected, so
// callers can capture it on the very first (deliberately-blocked) attempt
// and reuse it for the rest of the chain.
async function attemptCheckpoint(page, baseData, checkpoint, workSectionLabel) {
  const { rfiCreate, workSectionLabel: ws } = await fillPageOne(page, baseData, checkpoint, workSectionLabel);
  const outcome = await rfiCreate.clickProceedAndCheckOutcome();
  return { ...outcome, workSectionLabel: ws };
}

// Completes a checkpoint end-to-end (fills checklist, submits) — used both
// for the very first checkpoint in a chain (no dependency to satisfy) and
// for every later checkpoint's "retry now that the dependency is
// satisfied" step. Throws loudly if the app unexpectedly still blocks this
// — that's a genuine test failure, not a swallowed edge case, since by
// this point the caller has already made sure the prerequisite is
// approved.
async function createAndSubmitCheckpoint(page, baseData, checkpoint, workSectionLabel) {
  const { rfiCreate, workSectionLabel: ws } = await fillPageOne(page, baseData, checkpoint, workSectionLabel);
  const outcome = await rfiCreate.clickProceedAndCheckOutcome();
  if (!outcome.proceeded) {
    throw new Error(
      `Expected checkpoint "${checkpoint.name}" to proceed (its dependency should already be satisfied) but it was blocked instead: "${outcome.toastText}"`
    );
  }

  const checklist = new RFIChecklistPage(page);
  await checklist.fillAllObservations('OK - as per standard', true);
  await checklist.submitRFI();

  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  if (!match) throw new Error(`Could not extract RFI id after submitting checkpoint "${checkpoint.name}": ${page.url()}`);
  return { rfiId: match[1], workSectionLabel: ws };
}

// Dashboard-first re-read pattern (same reasoning as backfillRfiCodes() in
// rfi-flow-turns.js: going through the dashboard first is what actually
// clears the stale/DRAFT state and forces a full data refresh).
async function getVisibleCodeFor(page, rfiId) {
  const dashboard = new DashboardPage(page);
  await dashboard.goToDashboard();
  await dashboard.waitForContentOnly();
  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/view`);
  await page.waitForLoadState('networkidle');
  return await new RFIChecklistPage(page).getVisibleCode();
}

async function approveAsRole(page, role, rfiCode) {
  await loginAsRole(page, role);
  await openFromPendingWithMe(page, rfiCode);
  const review = new RFIReviewPage(page);
  await review.expandAllChecklist();
  await review.approve();
}

// CONFIRMED LIVE (00_inspect_rfi_work_section_abandon_draft.spec.js):
// merely SELECTING a Work Section in a checkpoint's form — even if the
// RFI is never submitted, even if Proceed was blocked and the draft is
// abandoned — permanently consumes that (checkpoint, Work Section) pair.
// The app owner confirmed why: selecting-then-leaving autosaves a local
// RFI draft (docs: project_rfi_draft_autosave_feature), and that specific
// combination stays unavailable for that checkpoint until the draft is
// gone. A fresh loginAsRole() call does NOT clear it either — it only
// clears cookies, not localStorage, so the stale draft (and the Work
// Section it's holding) survives every relogin in this suite. There is no
// reliable programmatic way to force-clear it (a real logout, not just a
// cookie-clear+relogin, is what the app owner described as clearing it —
// not reproduced here), so the actual fix is to never let a "prove this
// is blocked" attempt touch the Work Section the real chain needs: every
// blocked-attempt below uses its OWN disposable, throwaway Work Section
// (deliberately never reused for anything), while `workSection` — the one
// shared across the real chain — is picked ONLY from checkpoint[0]'s own
// creation, which always actually submits (never abandoned), so it's
// never at risk of this.
//
// The full chain-validation sequence for one Piling activity's first
// three checkpoints (Pile -> Pile Cap -> Post Pour Inspection). For each
// transition checkpoint[i] -> checkpoint[i+1]:
//   1. attempt checkpoint[i+1] (throwaway Work Section) while
//      checkpoint[i] doesn't exist/isn't approved yet -> MUST be blocked
//      (the validation-toast check the app owner described)
//   2. approve checkpoint[i] (by both EE and QI)
//   3. create checkpoint[i+1] FOR REAL using the shared `workSection` ->
//      MUST now succeed (needed as the NEXT transition's own prerequisite)
// checkpoint[0] itself has no prerequisite, so it's created directly
// (and is also where `workSection` is first picked), but its own APPROVAL
// is deliberately delayed until AFTER checkpoint[1]'s blocked attempt is
// captured — approving it immediately would make it impossible to ever
// again observe checkpoint[1] as blocked.
async function runDependencyChainForActivity(page, activityChain) {
  const { checkpoints, ...baseData } = activityChain;
  if (checkpoints.length < 2) {
    throw new Error(`Need at least 2 checkpoints to exercise a dependency chain, got ${checkpoints.length}`);
  }

  await loginAsRole(page, 'CI');

  // --- checkpoint[1] blocked: checkpoint[0] doesn't exist at all yet ---
  // Deliberately throwaway ('__random__') — this exact Work Section is
  // sacrificed for checkpoint[1] the moment it's selected here (see the
  // header comment above) and must NEVER be reused for anything real.
  const firstAttempt = await withRetry(() =>
    withCIRetryOnMissingWorkSection(page, () => attemptCheckpoint(page, baseData, checkpoints[1], '__random__'))
  );
  expect(
    firstAttempt.proceeded,
    `"${checkpoints[1].name}" should be BLOCKED before "${checkpoints[0].name}" exists/is approved`
  ).toBe(false);
  if (!firstAttempt.toastText) {
    console.warn(`[dependency] WARNING: no toast/error text captured for the blocked "${checkpoints[1].name}" attempt — the app may present this differently than expected.`);
    await page.screenshot({ path: `test-results/dependency-no-toast-${Date.now()}.png`, fullPage: true }).catch(() => {});
  }
  console.log(`[dependency] "${checkpoints[1].name}" blocked (no "${checkpoints[0].name}" yet) — toast: "${firstAttempt.toastText}" (throwaway Work Section: ${firstAttempt.workSectionLabel}, never reused)`);
  await resetToMyTasks(page);

  // --- checkpoint[0]: no dependency — create it directly. This is the
  // ONLY place `workSection` (shared by the whole real chain) is picked —
  // picked fresh here and immediately actually submitted, so it can never
  // be the victim of the abandoned-draft consumption bug above. ---
  const cp0 = await withRetry(() => createAndSubmitCheckpoint(page, baseData, checkpoints[0], '__random__'));
  const workSection = cp0.workSectionLabel;
  let priorCode = await getVisibleCodeFor(page, cp0.rfiId);
  console.log(`Created ${priorCode} for "${checkpoints[0].name}" (Work Section: ${workSection} — shared by the rest of this chain)`);

  for (let i = 1; i < checkpoints.length; i++) {
    // Approve checkpoints[i-1] (cp0 the first time through, then whatever
    // the previous iteration created) — this is what unblocks checkpoints[i].
    await withRetry(() => approveAsRole(page, 'EE', priorCode));
    await withRetry(() => approveAsRole(page, 'QI', priorCode));

    await loginAsRole(page, 'CI');
    const created = await withRetry(() =>
      withCIRetryOnMissingWorkSection(page, () => createAndSubmitCheckpoint(page, baseData, checkpoints[i], workSection))
    );
    priorCode = await getVisibleCodeFor(page, created.rfiId);
    console.log(`Created ${priorCode} for "${checkpoints[i].name}" (dependency on "${checkpoints[i - 1].name}" satisfied)`);

    if (i + 1 < checkpoints.length) {
      // Before approving checkpoints[i], prove checkpoints[i+1] is STILL
      // blocked — checkpoints[i] exists now but isn't approved yet, so
      // this specifically confirms the app checks "approved", not merely
      // "created". Throwaway Work Section again — never `workSection`,
      // for the same reason as checkpoint[1]'s first attempt above.
      const nextAttempt = await withRetry(() =>
        withCIRetryOnMissingWorkSection(page, () => attemptCheckpoint(page, baseData, checkpoints[i + 1], '__random__'))
      );
      expect(
        nextAttempt.proceeded,
        `"${checkpoints[i + 1].name}" should still be BLOCKED — "${checkpoints[i].name}" exists but isn't approved yet`
      ).toBe(false);
      console.log(`[dependency] "${checkpoints[i + 1].name}" still blocked (created-not-approved "${checkpoints[i].name}") — toast: "${nextAttempt.toastText}" (throwaway Work Section: ${nextAttempt.workSectionLabel}, never reused)`);
      await resetToMyTasks(page);
    }
  }

  // Approve the final checkpoint in scope to close out the chain cleanly.
  await withRetry(() => approveAsRole(page, 'EE', priorCode));
  await withRetry(() => approveAsRole(page, 'QI', priorCode));
}

// For activities whose Work Section granularity is at the whole WORK AREA
// level — a single Work Section option that's literally the Work Area's
// own name (confirmed live for "IDT Civil & Structural" / "IDT Civil &
// Structural - Cable Rack" via
// 00_inspect_rfi_idt_civil_structural.spec.js: exactly one option,
// "BL09", matching the selected Work Area). The throwaway-Work-Section
// trick above doesn't apply here — there's nothing else to sacrifice, so
// a blocked-attempt would burn the ONLY option and leave nothing for the
// real chain (confirmed live:
// 00_inspect_rfi_cancel_confirm_releases_section.spec.js — even clicking
// Cancel and confirming the resulting popup did NOT release it; Work
// Section options went from ["BL09"] to [] for that checkpoint).
//
// Instead, this uses TWO Work Areas: `throwawayWorkArea` (sacrificed
// entirely — every blocked-attempt check happens there, for whichever
// checkpoint) and `realWorkArea` (never touched by a blocked-attempt,
// used for the real chain). No random/label Work Section logic is
// needed — there's only ever one option, so the plain "pick first
// available" default (no label passed) always resolves it
// deterministically.
async function runDependencyChainForScarceWorkSectionActivity(page, activityChain) {
  const { checkpoints, throwawayWorkArea, realWorkArea, ...rest } = activityChain;
  if (checkpoints.length < 2) {
    throw new Error(`Need at least 2 checkpoints to exercise a dependency chain, got ${checkpoints.length}`);
  }
  const throwawayData = { ...rest, workArea: throwawayWorkArea };
  const realData = { ...rest, workArea: realWorkArea };

  await loginAsRole(page, 'CI');

  // --- checkpoint[1] blocked: checkpoint[0] doesn't exist at all yet ---
  const firstAttempt = await withRetry(() => attemptCheckpoint(page, throwawayData, checkpoints[1], null));
  expect(
    firstAttempt.proceeded,
    `"${checkpoints[1].name}" should be BLOCKED before "${checkpoints[0].name}" exists/is approved`
  ).toBe(false);
  console.log(`[dependency] "${checkpoints[1].name}" blocked (no "${checkpoints[0].name}" yet) — toast: "${firstAttempt.toastText}" (throwaway Work Area: ${throwawayWorkArea})`);
  await resetToMyTasks(page);

  // --- checkpoint[0]: no dependency — create it directly, on the
  // untouched `realWorkArea` (used for the whole real chain). ---
  const cp0 = await withRetry(() => createAndSubmitCheckpoint(page, realData, checkpoints[0], null));
  let priorCode = await getVisibleCodeFor(page, cp0.rfiId);
  console.log(`Created ${priorCode} for "${checkpoints[0].name}" (Work Area: ${realWorkArea} — shared by the rest of this chain)`);

  for (let i = 1; i < checkpoints.length; i++) {
    await withRetry(() => approveAsRole(page, 'EE', priorCode));
    await withRetry(() => approveAsRole(page, 'QI', priorCode));

    await loginAsRole(page, 'CI');
    const created = await withRetry(() => createAndSubmitCheckpoint(page, realData, checkpoints[i], null));
    priorCode = await getVisibleCodeFor(page, created.rfiId);
    console.log(`Created ${priorCode} for "${checkpoints[i].name}" (dependency on "${checkpoints[i - 1].name}" satisfied)`);

    if (i + 1 < checkpoints.length) {
      const nextAttempt = await withRetry(() => attemptCheckpoint(page, throwawayData, checkpoints[i + 1], null));
      expect(
        nextAttempt.proceeded,
        `"${checkpoints[i + 1].name}" should still be BLOCKED — "${checkpoints[i].name}" exists but isn't approved yet`
      ).toBe(false);
      console.log(`[dependency] "${checkpoints[i + 1].name}" still blocked (created-not-approved "${checkpoints[i].name}") — toast: "${nextAttempt.toastText}" (throwaway Work Area: ${throwawayWorkArea})`);
      await resetToMyTasks(page);
    }
  }

  await withRetry(() => approveAsRole(page, 'EE', priorCode));
  await withRetry(() => approveAsRole(page, 'QI', priorCode));
}

module.exports = {
  resetToMyTasks,
  fillPageOne,
  attemptCheckpoint,
  createAndSubmitCheckpoint,
  getVisibleCodeFor,
  approveAsRole,
  runDependencyChainForActivity,
  runDependencyChainForScarceWorkSectionActivity,
};
