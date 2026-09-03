const path = require("path");
const { createFlowTracker } = require("./flow-tracker");

// RFI FLOW TRACKER — the 9-TC regression's state, and the seed that defines it.
//
// The state machine itself lives in ./flow-tracker.js, shared with
// nc-tracker-utils.js and with the E2E smoke chain (which needs the same
// machine over its OWN state files — see docs/smoke-e2e-framework.md section 5).
// This file is now the RFI-specific half: the path, the TC matrix, and the
// flow-specific export names.
//
// THE PUBLIC API HERE IS UNCHANGED. Every export below keeps the name and
// signature it has always had, so specs 08/09/10, 21, 23, 24 and
// reset-tracker.js are untouched by the extraction.

// NOT under test-results/ on purpose: Playwright's outputDir (test-results/)
// gets wiped at the start of a run by default, which would delete the
// tracker instead of letting us control when it resets.
const TRACKER_PATH = path.join(__dirname, "..", "fixtures", "rfi-tracker.json");

// Seed state for the 9 TCs — the source of truth for resetTracker(). Keeping
// this here (not a second JSON file) means there's only one place to edit
// when a TC's step sequence changes; the seed and the live tracker can't
// drift out of sync with each other.
//
// PURE DATA, and deliberately so: nothing in this module reads the tracker file
// at module scope, so importing SEED_TRACKER has no side effects. That is what
// lets the smoke chain reuse this exact TC matrix without touching
// fixtures/rfi-tracker.json.
//
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

// RFI's create turn belongs to CI: a TC with no rfiId yet is always CI's turn
// (creating it), regardless of what its first scripted step says — every TC's
// steps array starts with EE or QI, so "create" is not itself a steps[] entry.
const rfi = createFlowTracker({
  trackerPath: TRACKER_PATH,
  seed: SEED_TRACKER,
  idField: "rfiId",
  codeField: "rfiCode",
  createActor: "CI",
});

// Flow-specific names mapped onto the shared machine. advanceStep's option
// names are remapped rather than renamed at the call sites, so nothing that
// passes { newRfiId, newRfiCode } has to change.
module.exports = {
  TRACKER_PATH,
  SEED_TRACKER,
  loadTracker: rfi.load,
  saveTracker: rfi.save,
  resetTracker: rfi.reset,
  getPendingStepsForActor: rfi.getPendingStepsForActor,
  setRfiId: rfi.setId,
  setRfiCode: rfi.setCode,
  advanceStep: (tracker, tcId, { newVersion, newRfiId, newRfiCode } = {}) =>
    rfi.advanceStep(tracker, tcId, { newVersion, newId: newRfiId, newCode: newRfiCode }),
  markFailed: rfi.markFailed,
  getLastRejectPage: rfi.getLastRejectPage,
  getLastRejectStep: rfi.getLastRejectStep,
};
