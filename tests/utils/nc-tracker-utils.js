const fs = require("fs");
const path = require("path");

// Separate from tests/utils/tracker-utils.js (RFI's tracker) on purpose —
// user explicitly asked to keep NC work fully independent of RFI's files,
// even where the logic looks reusable. NOT under test-results/ (gets wiped
// at the start of a run) for the same reason as rfi-tracker.json.
const TRACKER_PATH = path.join(__dirname, "..", "fixtures", "nc-tracker.json");

// NC's flow has only ONE reject mechanism (a single OK/Not-Ok toggle on the
// review page — confirmed live, unlike RFI's two distinct Page-1-button vs
// per-item-checklist paths), so there's no "page" field to branch on here.
// The 4 TCs below are the user's own scenarios: no reject, EE-only reject,
// QI-only reject, and both (mirroring RFI's TC-06-style deepest case).
//
// QI creates the NC (the reverse of RFI, which CI creates) — "create" is
// NOT itself a steps[] entry (same reasoning as RFI's tracker: every TC's
// steps[] starts with CI's first real action, "respond"), so a TC with no
// ncId yet is always QI's turn regardless of steps[0]'s actor.
//
// ncCode mirrors RFI's rfiCode (see tracker-utils.js) — the NC's UI-visible
// human-readable code (e.g. "NC-S-07b-300MW-BL02-CIV-22"), NOT the same as
// ncId (the backend UUID used in URLs). Captured off the /my-tasks/nc/<id>
// page's breadcrumb (BasePage.getVisibleCode()) so later steps can find
// this exact NC by clicking through "Pending with me" in the UI, the same
// way a real user would, instead of a direct URL.
const SEED_TRACKER = {
  "TC-01": {
    ncId: null, ncCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "CI", action: "respond" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-02": {
    ncId: null, ncCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "CI", action: "respond" },
      { actor: "EE", action: "reject" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-03": {
    ncId: null, ncCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "CI", action: "respond" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "approve" },
    ],
  },
  "TC-04": {
    ncId: null, ncCode: null, currentStepIndex: 0, currentVersion: "V1", status: "pending",
    steps: [
      { actor: "CI", action: "respond" },
      { actor: "EE", action: "reject" },
      { actor: "CI", action: "resubmit" },
      { actor: "EE", action: "approve" },
      { actor: "QI", action: "reject" },
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

function resetTracker() {
  saveTracker(JSON.parse(JSON.stringify(SEED_TRACKER)));
}

// Every TC whose *next* step belongs to `actor`. Skips done/failed TCs. A TC
// with no ncId yet is always QI's turn (creating it) — must be checked
// before the steps[currentStepIndex] lookup, exactly like RFI's tracker.
function getPendingStepsForActor(tracker, actor) {
  const pending = [];
  for (const [tcId, tc] of Object.entries(tracker)) {
    if (tc.status === "done" || tc.status === "failed") continue;

    if (!tc.ncId) {
      if (actor === "QI") pending.push({ tcId, tc, step: { actor: "QI", action: "create" } });
      continue;
    }

    const step = tc.steps[tc.currentStepIndex];
    if (!step) continue;
    if (step.actor !== actor) continue;
    pending.push({ tcId, tc, step });
  }
  return pending;
}

// Records a freshly-created NC's id + UI-visible code WITHOUT advancing
// currentStepIndex — "create" is not itself a steps[] entry (see
// getPendingStepsForActor above).
function setNcId(tracker, tcId, ncId, ncCode) {
  tracker[tcId].ncId = ncId;
  if (ncCode) tracker[tcId].ncCode = ncCode;
  saveTracker(tracker);
}

// Backfills ncCode (and optionally the version badge) onto a TC that
// already has an ncId — mirrors RFI's setRfiCode (see tracker-utils.js).
// Doesn't touch currentStepIndex/status — purely filling in fields, not
// completing a step.
function setNcCode(tracker, tcId, ncCode, version) {
  if (ncCode) tracker[tcId].ncCode = ncCode;
  if (version) tracker[tcId].currentVersion = version;
  saveTracker(tracker);
}

// Call only AFTER the UI confirms the action succeeded — never
// optimistically before. `newNcId` matters because CI's resubmit creates a
// NEW CHILD RECORD with its OWN id, confirmed live — same behavior as RFI's
// resubmit (see project_nc_flow_feature memory: "TC-02/03/04 all received a
// brand-new ncId immediately after their respective CI resubmit steps").
// Whenever newNcId is given, ncCode is ALWAYS reset (to newNcCode if
// provided, else null) — never left as whatever it was before. Leaving the
// OLD code in place would be actively wrong: it belonged to the
// now-archived original record, so the next "Pending with me" row search
// would go looking for a row that can never exist (same reasoning as RFI's
// advanceStep fix, see tracker-utils.js).
function advanceStep(tracker, tcId, { newVersion, newNcId, newNcCode } = {}) {
  const tc = tracker[tcId];
  if (newVersion) tc.currentVersion = newVersion;
  if (newNcId) {
    tc.ncId = newNcId;
    tc.ncCode = newNcCode || null;
  } else if (newNcCode) {
    tc.ncCode = newNcCode;
  }
  tc.currentStepIndex += 1;
  tc.status = tc.currentStepIndex >= tc.steps.length ? "done" : "pending";
  saveTracker(tracker);
}

function markFailed(tracker, tcId, reason) {
  tracker[tcId].status = "failed";
  tracker[tcId].failureReason = reason;
  saveTracker(tracker);
}

module.exports = {
  TRACKER_PATH, SEED_TRACKER,
  loadTracker, saveTracker, resetTracker, getPendingStepsForActor,
  setNcId, setNcCode, advanceStep, markFailed,
};
