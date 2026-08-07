// Restores tests/fixtures/rfi-tracker.json to its seed state.
// Run this before starting a full 9-TC regression pass — otherwise every TC
// still shows "done" from the previous run and every actor pass is a no-op.
//
// Usage: node tests/utils/reset-tracker.js
const { resetTracker, TRACKER_PATH } = require("./tracker-utils");

resetTracker();
console.log("RFI tracker reset to seed state:", TRACKER_PATH);
