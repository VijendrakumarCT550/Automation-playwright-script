// Resets tests/fixtures/user-creation-counter.json back to 0.
// Run this only when you deliberately want the next created user's number
// to restart from 1 — the counter is otherwise meant to keep climbing
// across runs so every created user's number is unique (same reasoning as
// tests/utils/reset-tracker.js for the RFI tracker).
//
// Usage: node tests/utils/reset-user-counter.js
const { saveCounter, COUNTER_PATH } = require("./user-counter-utils");

saveCounter({ counter: 0 });
console.log("User creation counter reset to 0:", COUNTER_PATH);
