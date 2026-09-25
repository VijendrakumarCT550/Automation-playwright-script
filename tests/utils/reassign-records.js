// THE RECORD POOL for the reassignment work — bookkeeping only.
//
// WHY A POOL, CREATED UP FRONT. App owner, 2026-09-20: *"create RFI by login
// users, don't wait someone else will feed; specs design should be such kind:
// all RFI are being created first, then reassignment test starts"*, and the
// same for NC. So record creation is a SETUP STAGE of its own
// (42_reassign_rfi_records_setup / 43_reassign_nc_records_setup) and the
// behaviour specs never create anything — they claim a record from this store
// by PURPOSE and act on it.
//
// That split is what makes the behaviour specs honest. A spec that creates its
// own subject mixes two failure modes: "reassignment is broken" and "we could
// not build a record today" arrive as the same red. Here the second one fails
// in setup, by itself, with the RFI/NC form's own error.
//
// ONE RECORD PER PURPOSE, NEVER SHARED. Families C, H, S and I each MUTATE the
// record they touch — a reassignment is not undoable from the UI, and Family S
// additionally rewrites WAM. Two specs sharing a record would make the second
// one's starting state depend on whether the first ran, which is exactly the
// dependency the smoke chain's ground map exists to prevent.
//
// KEYED PER DEPLOYMENT, like fixtures/reassign-fleet.json and
// last-created-users.json: pointing the work at another environment must
// neither reuse nor destroy this one's records.
//
// GROUND COST, stated plainly: every entry here is a real record on a real
// deployment, and an RFI permanently consumes a Work Section. They live on the
// A-06c / BL07+ band the app owner freed for this work
// (app-owner-decisions-and-conventions.md section 4.1).
const fs = require('fs');
const path = require('path');
const { environmentKey } = require('../config/environments');
const { WL_A, PKG_MAIN, WORK_AREA_MAIN } = require('./reassign-fleet');

const STORE = path.join(__dirname, '..', 'fixtures', 'reassign-records.json');

// WHO CREATES THEM. An RFI is raised by the CI and an NC by the QI, and in both
// cases the record's assignees are snapshotted from the WAM of its work area —
// so the creator must be the fleet member mapped THERE, and the resulting
// record carries the fleet's control arms as its CI/EE/QI. That is deliberate:
// Family C then asks whether a DIFFERENT candidate can take it over and work it.
const RFI_CREATOR = 'CI_C';   // the CI mapped to WL_A / PKG_MAIN / WORK_AREA_MAIN
const NC_CREATOR = 'QI_D';    // the QI mapped to the same cell

// The RFI pool. `purpose` is documentation and appears in the setup summary;
// `mutated` records whether the claiming spec changes the record, which is the
// reason it cannot be shared.
const RFI_POOL = [
  { key: 'R_READ', purpose: 'Family R — reassigners open the modal and read it', mutated: false },
  { key: 'H_HANDOFF', purpose: 'Family H — reassign the CI and watch both queues', mutated: true },
  { key: 'C_CI_UNMAPPED', purpose: 'Family C — hand to CI_A (no WAM at all), can it be worked?', mutated: true },
  { key: 'C_CI_FOREIGN', purpose: 'Family C — hand to CI_B (mapped only in the other location)', mutated: true },
  { key: 'C_EE_UNMAPPED', purpose: 'Family C — hand the EE leg to EE_A (init-only)', mutated: true },
  { key: 'S_SNAPSHOT', purpose: 'Family S — rewrite WAM afterwards, record must keep its users', mutated: true },
  { key: 'I_INTEGRITY', purpose: 'Family I — version and fields unchanged across a swap', mutated: true },
];

// The NC pool. Deliberately its own list with its own keys, per the standing
// rule that NC files never share code or data with RFI ones.
//
// ORDERING MATTERS, and it is the reason the NC setup runs AFTER the RFI setup:
// a non-approved NC BLOCKS RFI create for the same (inspection checkpoint, work
// section) — rule R2a, asserted by SM28. Creating every RFI first means the NCs
// cannot get in their way. A later re-run that needs to ADD an RFI on this
// ground may be blocked by these NCs; if that happens it is the rule working,
// not a defect.
const NC_POOL = [
  { key: 'R_READ_NC', purpose: 'Family R — the NC half of the modal-reading pass', mutated: false },
  { key: 'H_HANDOFF_NC', purpose: 'Family H — reassign an NC and watch both queues', mutated: true },
  { key: 'C_QI_UNMAPPED_NC', purpose: 'Family C — hand to QI_A (init-only), can it be worked?', mutated: true },
];

const GROUND = { workLocation: WL_A, package: PKG_MAIN, workArea: WORK_AREA_MAIN };

function loadStore() {
  if (!fs.existsSync(STORE)) return { version: 1, environments: {} };
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch {
    return { version: 1, environments: {} };
  }
}

// Every record recorded for this deployment, as { rfi: {...}, nc: {...} }.
function recordsFor(env = environmentKey()) {
  const store = loadStore();
  const forEnv = (store.environments || {})[env] || {};
  return { rfi: forEnv.rfi || {}, nc: forEnv.nc || {} };
}

// Records one created record. `kind` is 'rfi' or 'nc' — they are kept in
// separate sub-objects so neither can ever be read as the other, which is the
// same mistake NCTasksPage's tab locator already made once for real.
function recordRecord(kind, key, payload, env = environmentKey()) {
  if (kind !== 'rfi' && kind !== 'nc') throw new Error(`kind must be 'rfi' or 'nc', got "${kind}"`);
  const store = loadStore();
  store.version = store.version || 1;
  store.environments = store.environments || {};
  store.environments[env] = store.environments[env] || {};
  store.environments[env][kind] = store.environments[env][kind] || {};
  store.environments[env][kind][key] = { key, ...payload, recordedAt: new Date().toISOString() };
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
  return store.environments[env][kind][key];
}

// Claims a record by purpose for a behaviour spec. Throws with the setup
// command to run rather than returning undefined, because "undefined record"
// surfaces much later as an unrelated locator failure.
function claimRecord(kind, key, env = environmentKey()) {
  const rec = recordsFor(env)[kind][key];
  if (!rec || !rec.code) {
    throw new Error(
      `No "${key}" ${kind.toUpperCase()} recorded for deployment "${env}". ` +
      `Run the setup stage first: $env:PULSE_ENV="${env}"; npx playwright test ` +
      `tests/specs/4${kind === 'rfi' ? '2_reassign_rfi' : '3_reassign_nc'}_records_setup.spec.js ` +
      `--project=chromium --workers=1`
    );
  }
  return rec;
}

module.exports = {
  STORE, GROUND, RFI_POOL, NC_POOL, RFI_CREATOR, NC_CREATOR,
  loadStore, recordsFor, recordRecord, claimRecord,
};
