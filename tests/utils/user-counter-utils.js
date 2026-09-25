const fs = require("fs");
const path = require("path");
const { environmentKey, environmentKeyFor } = require("../config/environments");

// NOT under test-results/ on purpose: Playwright's outputDir (test-results/)
// gets wiped at the start of a run by default, which would reset the
// counter instead of letting it persist across runs (same reasoning as
// rfi-tracker.json, see tests/utils/tracker-utils.js).
const COUNTER_PATH = path.join(__dirname, "..", "fixtures", "user-creation-counter.json");

function loadCounter() {
  return JSON.parse(fs.readFileSync(COUNTER_PATH, "utf-8"));
}

// A temp path NOBODY ELSE WILL PICK. The atomic-write pattern below is
// temp-file + rename, and a FIXED temp name makes two concurrent writers
// collide: the second writeFileSync lands on the first one's temp file and one
// of the renames throws ENOENT. Laned runs (tests/utils/run-smoke-lanes.js)
// spawn several Playwright processes at once, so "only one worker" is not the
// same as "only one writer".
function tempPathFor(target) {
  return `${target}.tmp.${process.pid}.${Math.random().toString(36).slice(2, 8)}`;
}

// Atomic write: temp file + rename, so a crash mid-write never corrupts the counter.
function saveCounter(state) {
  const tmpPath = tempPathFor(COUNTER_PATH);
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

// ---------------------------------------------------------------------------
// THE CREATED-USER RECORD, PARTITIONED BY ENVIRONMENT
// ---------------------------------------------------------------------------
// Tracks the most recently created user PER ROLE PREFIX (overwritten each time
// that prefix is created again), so a later spec (e.g. WAM assignment) can
// always operate on "whichever user was created last for role X" without
// hardcoding transient generated names.
//
// WHY THE FILE IS NESTED BY ENVIRONMENT (2026-09-09). It used to be one flat
// map — `{ "CISL": {...}, "EESL": {...} }` — and a PULSE user exists on exactly
// ONE deployment, so the file had no way to describe two. Two distinct failures
// came out of that, and only the first had ever been fixed:
//
//   1. PHANTOM USERS. Users created on pulse-test stayed recorded when the
//      suite was pointed at pulse-qa, where they do not exist. Found live
//      2026-09-03: SM01 on qa found four recorded solar users from an earlier
//      test run, decided they already existed, SKIPPED all four tests and
//      exited 0 — a clean-looking run that had created nothing. That was
//      patched by stamping `baseUrl` on each entry and REJECTING any entry
//      whose baseUrl was not the current one.
//
//   2. THE REJECTION ITSELF, which is what the app owner hit on 2026-09-09
//      while switching between deployments. Because one prefix held one entry,
//      recording a user on qa OVERWROTE the pulse-test one, and pointing back
//      at pulse-test then rejected the qa entry — so every switch invalidated
//      the other environment's whole batch, and any stage run with --no-deps
//      died on "no user recorded at all" for a user that genuinely existed on
//      the deployment it was created against.
//
// So the fix here is the one smoke-tracker.js already made for tracker FILES on
// 2026-09-06 — key the STORE by deployment instead of guarding its contents:
//
//   {
//     "version": 2,
//     "environments": { "test": { "CISL": {...} }, "qa": { "CISL": {...} } },
//     "shared":       { "EE": {...}, "CI": {...} }
//   }
//
// Both deployments' users now coexist, so switching environments and switching
// back destroys neither, and there is no reset step to remember.
//
// `shared` holds entries recorded WITHOUT a baseUrl — which is exactly what
// tests/specs/12_user_management.spec.js writes for its bare CI/EE/QI/... 11-role
// batch. Those stay visible from every environment, which preserves the
// regression tier's behaviour bit-for-bit: those specs have always read them
// regardless of the target host (see 33_negative_authorisation.spec.js's note
// about the bare entries carrying no baseUrl). Only the SMOKE tier, which does
// stamp baseUrl, gets partitioned — and only the smoke tier ever had the bug.
const LAST_CREATED_PATH = path.join(__dirname, "..", "fixtures", "last-created-users.json");

const emptyStore = () => ({ version: 2, environments: {}, shared: {} });

// A pre-2026-09-09 file is a bare prefix->entry map: no `version`, and its
// values are user objects rather than per-environment buckets.
function isLegacyStore(raw) {
  return !!raw && typeof raw === "object" && !raw.version && !raw.environments;
}

// Legacy entries are distributed by the baseUrl they RECORDED, not by the
// environment the current run targets — the entry itself is the only evidence
// of where that user exists. Entries without one go to `shared`, which is where
// 12_user_management's bare prefixes belong anyway.
function migrateLegacyStore(raw) {
  const store = emptyStore();
  for (const [prefix, entry] of Object.entries(raw)) {
    if (entry && entry.baseUrl) {
      const key = environmentKeyFor(entry.baseUrl);
      store.environments[key] = store.environments[key] || {};
      store.environments[key][prefix] = entry;
    } else {
      store.shared[prefix] = entry;
    }
  }
  return store;
}

// Atomic write: temp file + rename, so a crash mid-write never corrupts the
// record (same reasoning as saveCounter above).
function writeUserStore(store) {
  const tmpPath = tempPathFor(LAST_CREATED_PATH);
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2));
  fs.renameSync(tmpPath, LAST_CREATED_PATH);
}

// The whole file, in v2 shape, migrating a legacy one on the way through.
// Callers wanting "the users usable on this deployment" want
// loadLastCreatedUsers() instead.
//
// A MISSING file is empty state; ANY OTHER read failure THROWS. That
// distinction is the difference between "no users yet" and "every user you have
// is about to be erased": a blanket catch would return an empty store for a
// truncated or hand-mangled file, and the very next recordLastCreatedUser()
// would write that empty store back plus one entry — silently deleting every
// other deployment's record. There are 40 real users in here; losing them to a
// swallowed parse error is far worse than a loud failure.
function loadUserStore() {
  let text;
  try {
    text = fs.readFileSync(LAST_CREATED_PATH, "utf-8");
  } catch (e) {
    if (e.code === "ENOENT") return emptyStore();
    throw new Error(
      `Could not read ${LAST_CREATED_PATH}: ${e.message}. Refusing to continue with an ` +
      `empty record — writing to it now would erase every user already recorded.`
    );
  }

  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `${LAST_CREATED_PATH} is not valid JSON (${e.message}). Fix or restore it — ` +
      `git has the last committed copy. Continuing would overwrite it with an empty record.`
    );
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `${LAST_CREATED_PATH} holds ${Array.isArray(raw) ? "an array" : JSON.stringify(raw)}, ` +
      `not an object. Restore it from git rather than letting a run overwrite it.`
    );
  }

  if (!isLegacyStore(raw)) {
    return {
      version: raw.version || 2,
      environments: raw.environments || {},
      shared: raw.shared || {},
    };
  }

  const migrated = migrateLegacyStore(raw);
  // Persisted immediately rather than only on the next write, so `git diff` and
  // anyone reading the fixture see one shape rather than a half-converted one.
  // A failure here is not worth failing a run over: the in-memory migration is
  // what the run actually uses, and the next recordLastCreatedUser() persists it.
  try {
    writeUserStore(migrated);
    const envs = Object.keys(migrated.environments);
    const unkeyed = Object.keys(migrated.shared).length;
    console.log(
      `    (migrated tests/fixtures/last-created-users.json to the per-environment shape: ` +
      `${envs.length ? envs.join(", ") : "no environments"}` +
      `${unkeyed ? ` + ${unkeyed} unkeyed` : ""})`
    );
  } catch (e) {
    console.log(`    (could not persist the last-created-users migration: ${e.message})`);
  }
  return migrated;
}

// THE USERS USABLE ON THIS DEPLOYMENT, as a flat prefix->entry map — the same
// shape (and, for the regression tier, the same contents) this function has
// always returned, so every existing caller is unaffected.
//
// Environment-specific entries win over `shared` ones: if a prefix has been
// created against this deployment, that record is strictly better evidence than
// an unkeyed one of unknown origin.
function loadLastCreatedUsers({ env = environmentKey() } = {}) {
  const store = loadUserStore();
  return { ...store.shared, ...(store.environments[env] || {}) };
}

// Records `prefix` under the environment its own `details.baseUrl` names, so two
// deployments' users coexist instead of overwriting each other. An entry with no
// baseUrl (12_user_management's bare 11-role batch) goes to `shared`.
//
// A PROFILE-SCOPED entry with no baseUrl is refused outright. `shared` is
// visible from every environment, so filing a smoke user there would recreate
// the phantom-user bug this whole shape exists to prevent — and it can only
// happen when BASE_URL is unset, which is a broken run, not a user to record.
function recordLastCreatedUser(prefix, details) {
  if (details && details.profileKey && !details.baseUrl) {
    throw new Error(
      `Refusing to record smoke user "${details.name || prefix}" (profile ` +
      `"${details.profileKey}") with no baseUrl — it would be filed as valid on EVERY ` +
      `deployment. BASE_URL was empty when this user was created, which means the run ` +
      `itself is misconfigured.`
    );
  }
  const store = loadUserStore();
  if (details && details.baseUrl) {
    const key = environmentKeyFor(details.baseUrl);
    store.environments[key] = store.environments[key] || {};
    store.environments[key][prefix] = details;
  } else {
    store.shared[prefix] = details;
  }
  writeUserStore(store);
}

module.exports = {
  COUNTER_PATH, loadCounter, saveCounter, nextBatchNumber, generateUserIdentity,
  LAST_CREATED_PATH, loadLastCreatedUsers, recordLastCreatedUser,
  loadUserStore, writeUserStore,
};
