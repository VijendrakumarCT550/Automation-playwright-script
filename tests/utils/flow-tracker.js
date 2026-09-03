const fs = require("fs");
const path = require("path");

// THE STATE MACHINE BEHIND BOTH FLOW TRACKERS.
//
// WHY THIS EXISTS. tracker-utils.js (RFI, 9 TCs) and nc-tracker-utils.js (NC,
// 4 TCs) were two near-identical copies of the same bookkeeping, each with its
// own hardcoded file path at module scope. That was fine while there was exactly
// one regression pass per flow, but the E2E smoke chain needs the SAME state
// machine over DIFFERENT state files — one per (flow x profile x viewport) — so
// that a smoke run can never read or write the regression's tracker.
// See docs/smoke-e2e-framework.md section 5.
//
// The alternative was a third and fourth copy for smoke. Rejected: the rules
// encoded below were each learned from a real live failure (see the individual
// comments), and a copy drifts silently the first time one of them is corrected
// in one place only.
//
// WHAT VARIES between the two flows, and therefore what is parameterised:
//
//   idField / codeField  'rfiId'/'rfiCode' vs 'ncId'/'ncCode'. The field names
//                        are baked into the on-disk JSON, which the reporting
//                        specs (21, 22) read directly, so they cannot be
//                        normalised away without changing those files' shape.
//   createActor          RFI's create turn belongs to CI; NC's belongs to QI.
//   seed                 the TC matrix itself — 9 TCs vs 4, and RFI's reject
//                        steps carry a `page` (P1/P2) that NC's do not, because
//                        NC has only ONE reject mechanism (confirmed live).
//
// Everything else — the step/status bookkeeping, the atomic write, the
// create-turn special case, the resubmit id/code reset — is identical and lives
// here once.
//
// The callers' PUBLIC API IS UNCHANGED. tracker-utils.js and nc-tracker-utils.js
// still export setRfiId/setNcId, advanceStep({newRfiId})/advanceStep({newNcId})
// and so on, mapping their flow-specific names onto the generic ones below. That
// is deliberate: specs 08/09/10, 15/16/17, 21, 22 and both reset scripts must
// keep working byte-for-byte.
function createFlowTracker({
  trackerPath,
  seed,
  idField,
  codeField,
  createActor,
  // Existing regression trackers are committed files that always exist, and a
  // missing one there means something is wrong — so load() throws, as it always
  // has. Smoke's per-chain files start absent by design (a fresh chain has no
  // state yet), so smoke opts into seeding on first read.
  seedIfMissing = false,
} = {}) {
  if (!trackerPath) throw new Error("createFlowTracker: trackerPath is required");
  if (!seed) throw new Error("createFlowTracker: seed is required");
  if (!idField) throw new Error("createFlowTracker: idField is required");
  if (!codeField) throw new Error("createFlowTracker: codeField is required");
  if (!createActor) throw new Error("createFlowTracker: createActor is required");

  const cloneSeed = () => JSON.parse(JSON.stringify(seed));

  function load() {
    if (seedIfMissing && !fs.existsSync(trackerPath)) reset();
    return JSON.parse(fs.readFileSync(trackerPath, "utf-8"));
  }

  // Atomic write: temp file + rename, so a crash mid-write never corrupts the
  // tracker. mkdir is for smoke's fixtures/smoke/ subdirectory; it is a no-op
  // for the two committed regression paths.
  function save(tracker) {
    fs.mkdirSync(path.dirname(trackerPath), { recursive: true });
    const tmpPath = trackerPath + ".tmp";
    fs.writeFileSync(tmpPath, JSON.stringify(tracker, null, 2));
    fs.renameSync(tmpPath, trackerPath);
  }

  // Restores the tracker to its seed state (all ids null, step 0, "pending").
  // Run before a full pass — otherwise every TC still shows "done" from the
  // previous run and every actor pass is a silent no-op.
  function reset() {
    save(cloneSeed());
  }

  // Every TC whose *next* step belongs to `actor`. Skips done/failed TCs.
  //
  // A TC with no id yet is always the CREATE ACTOR's turn, regardless of what
  // its first *scripted* step says — "create" is not itself an entry in
  // `steps` (every TC's steps array starts with a reviewer or a responder).
  // This check MUST run before the steps[currentStepIndex] lookup, or the
  // create turn is never reached: a naive step.actor match filters the creator
  // out before the "no id yet" case is ever considered.
  function getPendingStepsForActor(tracker, actor) {
    const pending = [];
    for (const [tcId, tc] of Object.entries(tracker)) {
      if (tc.status === "done" || tc.status === "failed") continue;

      if (!tc[idField]) {
        if (actor === createActor) {
          pending.push({ tcId, tc, step: { actor: createActor, action: "create" } });
        }
        continue;
      }

      const step = tc.steps[tc.currentStepIndex];
      if (!step) continue;
      if (step.actor !== actor) continue;
      pending.push({ tcId, tc, step });
    }
    return pending;
  }

  // Records a freshly-created record's id + UI-visible code WITHOUT advancing
  // currentStepIndex — "create" is not a steps[] entry, so counting it as
  // completing step 0 would silently skip the first real step.
  function setId(tracker, tcId, id, code) {
    tracker[tcId][idField] = id;
    if (code) tracker[tcId][codeField] = code;
    save(tracker);
  }

  // Backfills the visible code (and optionally the version badge) onto a TC
  // that already has an id — for when they could not be read immediately after
  // create/resubmit and a LATER revisit picks them up instead. Version is
  // included because it has the SAME async-lag problem as the code: right after
  // a resubmit the badge can still show the OLD version for a moment before
  // updating. Touches neither currentStepIndex nor status — this is purely
  // filling in fields, not completing a step.
  function setCode(tracker, tcId, code, version) {
    if (code) tracker[tcId][codeField] = code;
    if (version) tracker[tcId].currentVersion = version;
    save(tracker);
  }

  // Call only AFTER the UI confirms the action succeeded (toast/status check) —
  // never optimistically before. For completing a REAL entry in `steps`
  // (reject/approve/resubmit/respond), NOT for recording a new id at create
  // time — see setId above.
  //
  // `newId`/`newCode` (only passed after a resubmit) matter because resubmitting
  // creates a NEW CHILD RECORD with its OWN id — the original becomes ARCHIVED
  // and leaves the active review flow (confirmed live for BOTH flows). Every
  // step after a resubmit MUST use the new id, or it silently operates on an
  // archived record, or finds no row at all.
  //
  // Whenever newId is given the code is ALWAYS reset (to newCode if provided,
  // else null) — never left as it was. The old code belonged to the now-archived
  // record, so the next "Pending with me" search would look for a row that can
  // never exist.
  function advanceStep(tracker, tcId, { newVersion, newId, newCode } = {}) {
    const tc = tracker[tcId];
    if (newVersion) tc.currentVersion = newVersion;
    if (newId) {
      tc[idField] = newId;
      tc[codeField] = newCode || null;
    } else if (newCode) {
      tc[codeField] = newCode;
    }
    tc.currentStepIndex += 1;
    tc.status = tc.currentStepIndex >= tc.steps.length ? "done" : "pending";
    save(tracker);
  }

  // `context` carries WHERE in the flow this failure happened — `stage` (e.g.
  // "CI resubmit") and `scenario`, a machine-readable tag (e.g.
  // "RFI_NOT_VISIBLE_TO_ACTOR") set by callers that caught a specifically
  // identified negative scenario rather than a generic error. A bare reason
  // string does not say WHICH step the TC died on without cross-referencing
  // steps[]/currentStepIndex by hand.
  //
  // screenshotPath/htmlPath/url are repo-relative paths to evidence captured at
  // the moment of failure. Playwright's own screenshot-on-failure never fires
  // for these: the error is caught deliberately so the round-robin loop can keep
  // processing OTHER TCs, so the test() itself never sees it where it happened.
  //
  // All fields beyond `reason` are optional and additive. Spec 21 guards every
  // one of them with a truthiness check and spec 22 reads only failureReason, so
  // writing them for both flows changes no report.
  function markFailed(tracker, tcId, reason, { stage, scenario, screenshotPath, htmlPath, url } = {}) {
    tracker[tcId].status = "failed";
    tracker[tcId].failureReason = reason;
    tracker[tcId].failureStage = stage || null;
    tracker[tcId].failureScenario = scenario || null;
    tracker[tcId].failureScreenshot = screenshotPath || null;
    tracker[tcId].failureHtml = htmlPath || null;
    tracker[tcId].failureUrl = url || null;
    save(tracker);
  }

  // Looks backward for the most recent reject step in full (actor + page), so
  // failure reporting can say WHO rejected it, not just where from.
  function getLastRejectStep(tc) {
    for (let i = tc.currentStepIndex - 1; i >= 0; i--) {
      if (tc.steps[i].action === "reject") return tc.steps[i];
    }
    return null;
  }

  // RFI only in practice: tells the resubmitting actor whether Page 1 is
  // editable (rejected on P1) or read-only (rejected on the checklist / P2).
  // NC's steps carry no `page`, so this returns null there — harmless, and it
  // keeps one return shape for both.
  function getLastRejectPage(tc) {
    return getLastRejectStep(tc)?.page ?? null;
  }

  return {
    trackerPath, seed, idField, codeField, createActor,
    load, save, reset, getPendingStepsForActor,
    setId, setCode, advanceStep, markFailed,
    getLastRejectStep, getLastRejectPage,
  };
}

module.exports = { createFlowTracker };
