// Restores tests/fixtures/nc-tracker.json to its seed state.
// Run this before starting a full 4-TC regression pass — otherwise every TC
// still shows "done" from the previous run and every actor pass is a no-op.
//
// Usage: node tests/utils/reset-nc-tracker.js
const { resetTracker, TRACKER_PATH } = require("./nc-tracker-utils");

resetTracker();
console.log("NC tracker reset to seed state:", TRACKER_PATH);
