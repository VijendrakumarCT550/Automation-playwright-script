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
const SEED_TRACKER = {
  "TC-01": {
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-02": {
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "reject", page: "P1" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-03": {
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "reject", page: "P2" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-04": {
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject", page: "P1" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-05": {
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject", page: "P2" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-06": {
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
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
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
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
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
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
    rfiId: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
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

// Records a freshly-created RFI's id WITHOUT advancing currentStepIndex —
// "create" is not itself an entry in `steps` (every TC's steps array starts
// with EE or QI's first review action), so this must NOT count as completing
// step 0 or that first real step gets silently skipped.
function setRfiId(tracker, tcId, rfiId) {
  tracker[tcId].rfiId = rfiId;
  saveTracker(tracker);
}

// Call only AFTER the UI confirms the action succeeded (toast/status check) —
// never optimistically before. For completing a REAL entry in `steps`
// (reject/approve/resubmit) — NOT for recording a new rfiId at CREATE time,
// see setRfiId above.
//
// `newRfiId` (only passed after a resubmit) matters because resubmitting a
// rejected RFI creates a NEW CHILD RECORD with its OWN id — the original id
// becomes ARCHIVED and is no longer part of the active review flow
// (user-confirmed live). Every step after a resubmit (EE/QI review, or a
// later resubmit) MUST use this new id, not the one recorded at creation —
// continuing to reuse the stale id would silently operate on an archived
// record instead of the live one.
function advanceStep(tracker, tcId, { newVersion, newRfiId } = {}) {
  const tc = tracker[tcId];
  if (newVersion) tc.currentVersion = newVersion;
  if (newRfiId) tc.rfiId = newRfiId;
  tc.currentStepIndex += 1;
  tc.status = tc.currentStepIndex >= tc.steps.length ? "done" : "pending";
  saveTracker(tracker);
}

function markFailed(tracker, tcId, reason) {
  tracker[tcId].status = "failed";
  tracker[tcId].failureReason = reason;
  saveTracker(tracker);
}

// Looks backward for the most recent reject step — tells CI whether Page 1
// is editable (rejected on P1) or read-only (rejected on checklist/P2).
function getLastRejectPage(tc) {
  for (let i = tc.currentStepIndex - 1; i >= 0; i--) {
    if (tc.steps[i].action === "reject") return tc.steps[i].page;
  }
  return null;
}

module.exports = {
  TRACKER_PATH, SEED_TRACKER,
  loadTracker, saveTracker, resetTracker, getPendingStepsForActor,
  setRfiId, advanceStep, markFailed, getLastRejectPage,
};
