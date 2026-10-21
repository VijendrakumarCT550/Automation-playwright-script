const fs = require('fs');
const path = require('path');
const { codesFor, highestCounter } = require('./pc-data');
const { withLock, renameRetry, readJson } = require('../utils/file-lock');

// THE SUB-PACKAGE CODE COUNTER (app owner, 2026-10-15), one per DRS environment
// and package:  { "uat": { "Civil": 1, "Electrical": 1 } }  = PC01/QC01 and
// PE01/QE01 are taken, the next Civil build gets PC02/QC02.
//
// A build RESERVES its number before it creates anything, so a build that fails
// halfway keeps its codes (its spec records them and resumes with the same ones)
// and no later build can reuse them. The next number is one past the higher of the
// file and the codes already in the live tree, so a draft copied from a version that
// carries earlier codes, or a counter file reset by hand, never repeats a name.

const COUNTER_PATH = path.resolve(__dirname, '../fixtures/drs/catalog-counter.json');

// Missing file -> {}; busy -> retried; unreadable -> throws (an empty counter
// saved back would hand out codes that are already taken).
function load() {
  return readJson(COUNTER_PATH, {});
}

function save(store) {
  fs.mkdirSync(path.dirname(COUNTER_PATH), { recursive: true });
  const tmp = `${COUNTER_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  renameRetry(tmp, COUNTER_PATH);
}

function last(envKey, pkg) {
  return Number((load()[envKey] || {})[pkg] || 0);
}

// Reserves the next counter for `pkg`. `liveCodes` = the codes now under the
// package in the open draft (PackagesConfiguratorPage.usedLetters).
// Returns { n, codes: ['PC02', 'QC02'] }.
// Under a lock: the onboarding suite reserves codes from two chains at once.
function reserve(envKey, pkg, liveCodes = []) {
  return withLock(`${COUNTER_PATH}.lock`, () => {
  const store = load();
  const env = store[envKey] || {};
  const n = Math.max(Number(env[pkg] || 0), highestCounter(pkg, liveCodes)) + 1;
  if (n > 99) throw new Error(`${pkg} code counter is past 99 on ${envKey}`);
  store[envKey] = { ...env, [pkg]: n };
  save(store);
  return { n, codes: codesFor(pkg, n) };
  });
}

module.exports = { COUNTER_PATH, last, reserve };
