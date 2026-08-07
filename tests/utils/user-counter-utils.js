const fs = require("fs");
const path = require("path");

// NOT under test-results/ on purpose: Playwright's outputDir (test-results/)
// gets wiped at the start of a run by default, which would reset the
// counter instead of letting it persist across runs (same reasoning as
// rfi-tracker.json, see tests/utils/tracker-utils.js).
const COUNTER_PATH = path.join(__dirname, "..", "fixtures", "user-creation-counter.json");

function loadCounter() {
  return JSON.parse(fs.readFileSync(COUNTER_PATH, "utf-8"));
}

// Atomic write: temp file + rename, so a crash mid-write never corrupts the counter.
function saveCounter(state) {
  const tmpPath = COUNTER_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, COUNTER_PATH);
}

// One global counter shared across every role/prefix (not per-prefix), and
// shared across every user created in the SAME batch run (not incremented
// per-user) — user-specified: every user created in one run of the 11-role
// batch gets the SAME numeric suffix, so a group of users can be
// recognized as "created together" by that shared number. It only advances
// when a NEW batch run starts, before that run creates anything (regardless
// of whether the whole batch goes on to fully succeed) — call this ONCE per
// run (e.g. in test.beforeAll) and pass the result to every
// generateUserIdentity() call in that run.
function nextBatchNumber() {
  const state = loadCounter();
  state.counter += 1;
  saveCounter(state);
  return state.counter;
}

function randomLetters(count) {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let out = "";
  for (let i = 0; i < count; i++) {
    out += letters[Math.floor(Math.random() * letters.length)];
  }
  return out;
}

// Indian mobile numbers conventionally start with 6-9 — matches common
// phone-field validation patterns seen elsewhere in this app's forms.
function randomPhoneNumber() {
  const firstDigit = String(Math.floor(Math.random() * 4) + 6);
  let rest = "";
  for (let i = 0; i < 9; i++) {
    rest += String(Math.floor(Math.random() * 10));
  }
  return firstDigit + rest;
}

// Builds one new user's Name/Email/Phone. Format confirmed with the user:
// <prefix><3 random letters>User<batch number> — e.g. "EExqbUser7". Takes
// `number` rather than generating it itself — every user created in the
// same batch run must share the SAME number (see nextBatchNumber above), so
// the caller computes it once per run and passes it to every call.
function generateUserIdentity(prefix, number) {
  const name = `${prefix}${randomLetters(3)}User${number}`;
  const email = `${name}@adani.com`;
  const phone = randomPhoneNumber();
  return { name, email, phone, number };
}

// Tracks the most recently created user PER ROLE PREFIX (overwritten each
// time that prefix is created again), so a later spec (e.g. WAM assignment)
// can always operate on "whichever user was created last for role X"
// without hardcoding transient generated names.
const LAST_CREATED_PATH = path.join(__dirname, "..", "fixtures", "last-created-users.json");

function loadLastCreatedUsers() {
  try {
    return JSON.parse(fs.readFileSync(LAST_CREATED_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function recordLastCreatedUser(prefix, details) {
  const state = loadLastCreatedUsers();
  state[prefix] = details;
  const tmpPath = LAST_CREATED_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, LAST_CREATED_PATH);
}

module.exports = {
  COUNTER_PATH, loadCounter, saveCounter, nextBatchNumber, generateUserIdentity,
  LAST_CREATED_PATH, loadLastCreatedUsers, recordLastCreatedUser,
};
