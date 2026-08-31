const fs = require("fs");
const path = require("path");

// NOT under test-results/ on purpose: Playwright's outputDir (test-results/)
// gets wiped at the start of a run by default, which would delete the
// tracker instead of letting us control when it resets.
const TRACKER_PATH = path.join(__dirname, "..", "fixtures", "rfi-tracker.json");

// Seed state for the 9 TCs — the source of truth for resetTracker(). Keeping
// this here (not a second JSON file) means there's only one place to edit
// when a TC's step sequence changes; the seed and the live tracker can't
// drift out of sync with each other.
// rfiCode is the RFI's UI-visible human-readable code (e.g.
// "RFI-A-06c-BL01-CIV-528") — NOT the same as rfiId (the backend UUID used
// in URLs). Captured off the post-submit /view page's breadcrumb (see
// RFIChecklistPage.getVisibleCode()) so later steps can find this exact RFI
// by clicking through "Pending with me" in the UI, the same way a real user
// would, instead of jumping straight to its URL.
const SEED_TRACKER = {
  "TC-01": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-02": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "reject", page: "P1" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-03": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "reject", page: "P2" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-04": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject", page: "P1" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-05": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject", page: "P2" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-06": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "reject", page: "P1" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject", page: "P1" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-07": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "reject", page: "P1" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject", page: "P2" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-08": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "reject", page: "P2" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject", page: "P1" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-09": {
    rfiId: null, rfiCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "reject", page: "P2" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject", page: "P2" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
};

function loadTracker() {
  return JSON.parse(fs.readFileSync(TRACKER_PATH, "utf-8"));
}

// Atomic write: temp file + rename, so a crash mid-write never corrupts the tracker.
function saveTracker(tracker) {
  const tmpPath = TRACKER_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(tracker, null, 2));
  fs.renameSync(tmpPath, TRACKER_PATH);
}

// Restores rfi-tracker.json to the seed state (all rfiId: null, step 0,
// status "pending"). Run before a full regression pass — otherwise every TC
// still shows as "done" from the previous run and every step becomes a no-op.
function resetTracker() {
  saveTracker(JSON.parse(JSON.stringify(SEED_TRACKER)));
}

// Every TC whose *next* step belongs to `actor`. Skips done/failed TCs.
// A TC with no rfiId yet is always CI's turn (creating it), regardless of
// what its first *scripted* step's actor is — "create" isn't itself an
// entry in `steps`, every TC's steps array starts with EE or QI. This check
// MUST run before the steps[currentStepIndex] lookup below, or CI's create
// turn is never reached (every TC's step 0 belongs to EE/QI, not CI, so a
// naive step.actor match filters CI out before the "no rfiId yet" case is
// ever considered).
function getPendingStepsForActor(tracker, actor) {
  const pending = [];
  for (const [tcId, tc] of Object.entries(tracker)) {
    if (tc.status === "done" || tc.status === "failed") continue;

    if (!tc.rfiId) {
      if (actor === "CI") pending.push({ tcId, tc, step: { actor: "CI", action: "create" } });
      continue;
    }

    const step = tc.steps[tc.currentStepIndex];
    if (!step) continue;
    if (step.actor !== actor) continue;
    pending.push({ tcId, tc, step });
  }
  return pending;
}

// Records a freshly-created RFI's id + UI-visible code WITHOUT advancing
// currentStepIndex — "create" is not itself an entry in `steps` (every TC's
// steps array starts with EE or QI's first review action), so this must NOT
// count as completing step 0 or that first real step gets silently skipped.
function setRfiId(tracker, tcId, rfiId, rfiCode) {
  tracker[tcId].rfiId = rfiId;
  if (rfiCode) tracker[tcId].rfiCode = rfiCode;
  saveTracker(tracker);
}

// Backfills rfiCode (and optionally the version badge) onto a TC that
// already has an rfiId — for when they couldn't be read immediately after
// create/resubmit and a LATER revisit (CI's own backfillRfiCodes in
// 08_rfi_flow_ci.spec.js) picks them up instead. Version is included here
// because it has the EXACT SAME async-lag problem as the code: right after
// a resubmit, the version badge can still show the OLD version (vN) for a
// moment before updating to vN+1 — user-confirmed live via tracker
// inspection (every resubmitted TC stayed at "v1" instead of bumping to
// "v2"). Doesn't touch currentStepIndex/status — this is purely filling in
// fields, not completing a step.
function setRfiCode(tracker, tcId, rfiCode, version) {
  if (rfiCode) tracker[tcId].rfiCode = rfiCode;
  if (version) tracker[tcId].currentVersion = version;
  saveTracker(tracker);
}

// Call only AFTER the UI confirms the action succeeded (toast/status check) —
// never optimistically before. For completing a REAL entry in `steps`
// (reject/approve/resubmit) — NOT for recording a new rfiId at CREATE time,
// see setRfiId above.
//
// `newRfiId`/`newRfiCode` (only passed after a resubmit) matter because
// resubmitting a rejected RFI creates a NEW CHILD RECORD with its OWN id AND
// its OWN visible code — the original becomes ARCHIVED and is no longer
// part of the active review flow (user-confirmed live). Every step after a
// resubmit (EE/QI review, or a later resubmit) MUST use this new id/code,
// not the ones recorded at creation — continuing to reuse the stale ones
// would silently operate on an archived record instead of the live one, or
// fail to find any row at all when searching "Pending with me" by code.
//
// Whenever newRfiId is given, rfiCode is ALWAYS reset (to newRfiCode if
// provided, else null) — never left as whatever it was before. Leaving the
// OLD code in place would be actively wrong, not just stale: it belonged to
// the now-archived original record, so the next "Pending with me" row
// search would go looking for a row that can never exist, exactly like the
// bug this reset prevents (confirmed live — see resubmitRfi's rfiCode
// handling in 08_rfi_flow_ci.spec.js, which always passes newRfiCode: null
// since the app doesn't finalize a resubmitted RFI's code immediately
// either; EE's next review backfills the real one for the new id).
function advanceStep(tracker, tcId, { newVersion, newRfiId, newRfiCode } = {}) {
  const tc = tracker[tcId];
  if (newVersion) tc.currentVersion = newVersion;
  if (newRfiId) {
    tc.rfiId = newRfiId;
    tc.rfiCode = newRfiCode || null;
  } else if (newRfiCode) {
    tc.rfiCode = newRfiCode;
  }
  tc.currentStepIndex += 1;
  tc.status = tc.currentStepIndex >= tc.steps.length ? "done" : "pending";
  saveTracker(tracker);
}

// `context` (optional) carries WHERE in the flow this failure happened —
// `stage` (e.g. "CI resubmit", "EE review (reject P1)") and `scenario`, a
// machine-readable tag (e.g. "RFI_NOT_VISIBLE_TO_ACTOR") set by callers that
// caught a specifically-identified negative scenario rather than a generic
// error. Added 2026-08-27 per user request: a bare failureReason string
// (just the raw Playwright error) doesn't say WHICH step the TC died on
// without cross-referencing steps[]/currentStepIndex by hand — every
// failure site now passes this so the end-of-run report
// (21_rfi_flow_single_session.spec.js) can print it directly.
// `screenshotPath`/`htmlPath`/`url` (also optional, added same day) —
// repo-relative paths to a screenshot + full HTML dump of the page at the
// moment of failure (see rfi-flow-turns.js's captureFailureEvidence), plus
// the URL it was taken from. Playwright's own automatic screenshot-on-
// failure never fires for these — the error is caught here specifically so
// the round-robin loop can keep processing OTHER TCs, so the test() itself
// never sees it at the point it happened. Without this there was no visual
// record of a failure at all, only the text reason. All fields here are
// optional/additive — existing readers of the tracker that don't know
// about them are unaffected.
function markFailed(tracker, tcId, reason, { stage, scenario, screenshotPath, htmlPath, url } = {}) {
  tracker[tcId].status = "failed";
  tracker[tcId].failureReason = reason;
  tracker[tcId].failureStage = stage || null;
  tracker[tcId].failureScenario = scenario || null;
  tracker[tcId].failureScreenshot = screenshotPath || null;
  tracker[tcId].failureHtml = htmlPath || null;
  tracker[tcId].failureUrl = url || null;
  saveTracker(tracker);
}

// Looks backward for the most recent reject step in full (actor + page),
// not just the page — added alongside getLastRejectPage below (which now
// delegates here) so failure-reporting call sites can say WHO rejected it,
// not just which page they rejected from.
function getLastRejectStep(tc) {
  for (let i = tc.currentStepIndex - 1; i >= 0; i--) {
    if (tc.steps[i].action === "reject") return tc.steps[i];
  }
  return null;
}

// Tells CI whether Page 1 is editable (rejected on P1) or read-only
// (rejected on checklist/P2). Kept as its own function (rather than having
// every call site destructure getLastRejectStep) since this is the one
// piece resubmitRfi actually needs to decide its own behavior.
function getLastRejectPage(tc) {
  return getLastRejectStep(tc)?.page ?? null;
}

module.exports = {
  TRACKER_PATH, SEED_TRACKER,
  loadTracker, saveTracker, resetTracker, getPendingStepsForActor,
  setRfiId, setRfiCode, advanceStep, markFailed, getLastRejectPage, getLastRejectStep,
};
