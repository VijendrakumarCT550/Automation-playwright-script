const fs = require('fs');
const path = require('path');
const { environmentKey } = require('../config/environments');

// ===========================================================================
// THE REASSIGNMENT FLEET — declarative definition, and the record of what exists
// ===========================================================================
// docs/reassignment-scenarios.md needs users in PRECISE provisioning states:
// created in particular work locations, with WAM in a particular location /
// package / work area, or with no WAM at all. The whole point of the feature's
// hardest scenarios is that provisioning (Add User) and WAM DISAGREE, so a
// fleet where "roughly the right users exist" proves nothing — each member has
// to be built to spec and known to be in that state.
//
// WHY A SEPARATE STORE FROM last-created-users.json. That file is the SMOKE
// chain's own record, and `ensureSmokeUsers` self-heals against it by NAME
// PREFIX. Putting fleet members in there would make the smoke chain adopt them
// as flow users — silently changing what SM03 maps and what SM05/SM06 log in
// as. This store is keyed per deployment the same way, and nothing else reads
// it.
//
// CONFIRMED LIVE 2026-09-16 (00_inspect_created_user_can_login.spec.js): a user
// created through Add User CAN log in with BULK_USER_DEFAULT_PASSWORD — created
// via Admin, auth/login -> 200, landed on /dashboard. The older `…User151`
// smoke accounts that fail with 401 were therefore disabled or created under a
// different password; creation itself grants a usable credential.
// ===========================================================================

const STORE = path.join(__dirname, '..', 'fixtures', 'reassign-fleet.json');

// Ground. Deliberately the two locations the rest of the suite already uses, so
// the fleet sits on provisioned ground rather than needing new SO/DRS setup.
// WL_A is where the record under test lives; WL_B is the "other work location"
// arm that must NOT be eligible.
const WL_A = 'A-06c';
const WL_B = 'S05b';

// WORK AREAS: BL07 ONWARDS, in BOTH work locations. App owner, 2026-09-16:
// "you can use BL07 onwards for these activities as we are not using these work
// regions in both A-06c and S05b".
//
// THIS IS AN ISOLATION RULE, NOT A PREFERENCE, and it was learned the hard way.
// The first build of this fleet mapped RA_CM/RA_EL/RA_QL onto A-06c/**BL01** —
// shared ground — and WAM's single-select rows REPLACE whoever held them, so it
// silently evicted the previous Execution Lead, Quality Lead and Contractor
// Manager there. Only the EL/QL/CM rows were touched (CI/EE/QI, which the RFI
// and NC flows depend on, were not), and 18_wam_hierarchy.spec.js re-assigns its
// own users each run, so nothing stayed broken — but the previous occupants
// could not be restored, because a single-select assign does not report what it
// overwrote.
//
// Everything this feature touches — the fleet's mappings AND the record under
// test — therefore lives at BL07+.
const WORK_AREA_MAIN = 'BL07';   // where the record under test lives
const WORK_AREA_ALT = 'BL08';    // the "right package, wrong work area" arm

// PACKAGES: Civil and Electrical ONLY (app owner, 2026-09-16). Mechanical
// exists for the wind project type and must never appear in this fleet.
const PKG_MAIN = 'Civil';
const PKG_OTHER = 'Electrical';

// THE VENDOR-SIDE ROLES NEED A SERVICE ORDER IN THEIR WAM FILTERS.
//
// Confirmed from 18_wam_hierarchy.spec.js (validated 2026-08-21), whose
// per-role filter table is the authority here:
//
//   work-AREA rows : Execution Engineer, Quality Inspector, Execution Lead,
//                    Quality Lead, and — WITH a serviceOrder — Contractor
//                    Incharge and Contractor Manager
//   work-LOCATION  : Project Manager, Plot Admin
//   site rows      : Site Admin
//
// Measured live 2026-09-16 and it matches: EL/QL were offered BL01..BL08, PM was
// offered 81 work locations, and Contractor Manager was offered NOTHING — because
// the filters omitted the Service Order. The two VENDOR roles are the ones gated
// behind it, which is the whole CI candidate group as well as the CM reassigner,
// so getting this wrong would have blocked the fleet rather than one member.
const SERVICE_ORDER = 'M S CHOUHAN INFRAVENTURES';

// A DIFFERENT vendor, for the "CI from another vendor must not be offered" arm.
// Any of the 389 offered under "Service Contractor" would do; this one is
// pinned so the fleet is reproducible rather than dependent on list order.
const OTHER_VENDOR = 'SATYASARA ENERGY PVT LTD';

// A WIND work location in the SAME site (Khavda), so the multi-project-type
// member needs no second site. See docs/work-region-hierarchy.md.
const WIND_WL = 'WTG-Khavda';

// Roles whose WAM rows only appear once a Service Order is chosen.
const VENDOR_SIDE_ROLES = ['Contractor Incharge', 'Contractor Manager'];

function serviceOrderFor(role) {
  return VENDOR_SIDE_ROLES.includes(role) ? SERVICE_ORDER : undefined;
}

// ---------------------------------------------------------------------------
// GROUP 1 — the reassigners (Family R)
// ---------------------------------------------------------------------------
// One per row of the app owner's "Reassignment Rules by Role" screen. They are
// WAM-mapped on WL_A because a reassigner has to be able to SEE the records it
// would reassign — whether that is actually required is itself a finding the
// recon reports, but mapping them is the realistic configuration.
const REASSIGNERS = [
  // workArea pinned to the free band — see WORK_AREA_MAIN. Project Manager is
  // mapped at WORK-LOCATION granularity, so it takes no work area at all.
  { key: 'RA_CM', role: 'Contractor Manager', userType: 'VENDOR', workLocations: [WL_A, WL_B], wam: { workLocation: WL_A, package: PKG_MAIN, workArea: WORK_AREA_MAIN } },
  { key: 'RA_EL', role: 'Execution Lead', userType: 'AGEL', workLocations: [WL_A, WL_B], wam: { workLocation: WL_A, package: PKG_MAIN, workArea: WORK_AREA_MAIN } },
  { key: 'RA_QL', role: 'Quality Lead', userType: 'AGEL', workLocations: [WL_A, WL_B], wam: { workLocation: WL_A, package: PKG_MAIN, workArea: WORK_AREA_MAIN } },
  { key: 'RA_PM', role: 'Project Manager', userType: 'AGEL', workLocations: [WL_A, WL_B], wam: { workLocation: WL_A, package: PKG_MAIN } },
];

// ---------------------------------------------------------------------------
// GROUP 2 — the candidates (Families E and C)
// ---------------------------------------------------------------------------
// Each row is one cell of docs/reassignment-scenarios.md §2. `wam: null` means
// "created, never mapped" — the init-only state the app owner confirmed is
// enough to be assignable.
const CANDIDATES = [
  // --- CI (VENDOR; same vendor as the record unless marked otherwise) -------
  { key: 'CI_A', role: 'Contractor Incharge', userType: 'VENDOR', workLocations: [WL_A], wam: null,
    probes: 'init-only, same work location' },
  { key: 'CI_B', role: 'Contractor Incharge', userType: 'VENDOR', workLocations: [WL_A, WL_B],
    wam: { workLocation: WL_B, package: PKG_OTHER },
    probes: 'THE HEADLINE CASE — eligible via WL_A, but every mapping is in WL_B/Electrical' },
  { key: 'CI_C', role: 'Contractor Incharge', userType: 'VENDOR', workLocations: [WL_A, WL_B],
    wam: { workLocation: WL_A, package: PKG_MAIN, workArea: WORK_AREA_MAIN },
    probes: 'control arm — fully mapped where the record lives' },
  { key: 'CI_D', role: 'Contractor Incharge', userType: 'VENDOR', workLocations: [WL_A],
    wam: { workLocation: WL_A, package: PKG_OTHER },
    probes: 'right location, wrong package' },
  { key: 'CI_E', role: 'Contractor Incharge', userType: 'VENDOR', workLocations: [WL_A],
    wam: { workLocation: WL_A, package: PKG_MAIN, workArea: WORK_AREA_ALT },
    probes: 'right location and package, WRONG work area (record is on ' + WORK_AREA_MAIN + ')' },
  { key: 'CI_F', role: 'Contractor Incharge', userType: 'VENDOR', workLocations: [WL_B], wam: null,
    probes: 'NEGATIVE — other work location only, must not be eligible' },
  { key: 'CI_G', role: 'Contractor Incharge', userType: 'VENDOR', workLocations: [WL_A], wam: null,
    vendor: OTHER_VENDOR,
    probes: 'NEGATIVE — right work location, DIFFERENT vendor, must not be eligible' },

  // --- EE / QI (AGEL, no vendor) -------------------------------------------
  { key: 'EE_A', role: 'Execution Engineer', userType: 'AGEL', workLocations: [WL_A], wam: null,
    probes: 'init-only baseline' },
  { key: 'EE_B', role: 'Execution Engineer', userType: 'AGEL', workLocations: [WL_A, WIND_WL],
    projectTypes: ['SOLAR', 'WIND'], wam: null,
    probes: 'multi-project-type — solar AND wind provisioning, no WAM' },
  { key: 'EE_C', role: 'Execution Engineer', userType: 'AGEL', workLocations: [WL_A, WL_B],
    wam: { workLocation: WL_B, package: PKG_OTHER },
    probes: 'mapped in WL_B/Electrical, init-only in WL_A' },
  { key: 'EE_D', role: 'Execution Engineer', userType: 'AGEL', workLocations: [WL_A],
    wam: { workLocation: WL_A, package: PKG_MAIN, workArea: WORK_AREA_MAIN }, probes: 'control arm' },

  { key: 'QI_A', role: 'Quality Inspector', userType: 'AGEL', workLocations: [WL_A], wam: null,
    probes: 'init-only baseline' },
  { key: 'QI_C', role: 'Quality Inspector', userType: 'AGEL', workLocations: [WL_A, WL_B],
    wam: { workLocation: WL_B, package: PKG_OTHER },
    probes: 'mapped in WL_B/Electrical, init-only in WL_A' },
  { key: 'QI_D', role: 'Quality Inspector', userType: 'AGEL', workLocations: [WL_A],
    wam: { workLocation: WL_A, package: PKG_MAIN, workArea: WORK_AREA_MAIN }, probes: 'control arm' },
];

// ALL MEMBERS ARE NOW CONSTRUCTIBLE. The last two were unblocked on 2026-09-16
// by 00_inspect_add_user_fields.spec.js, which read the dialog instead of
// guessing at it:
//   CI-G — the Vendor dropdown offers 389 vendors under "Service Contractor",
//          so a CI under a different vendor is easy to build.
//   EE-B — Project type IS rendered (for AGEL *and* VENDOR roles) and offers
//          SOLAR/WIND/PSS/INFRA/BESS/TRANSMISSION_LINE, so a user can be scoped
//          to two project types at once.
const DEFERRED = [];

function groupFor(name) {
  if (name === 'reassigners') return REASSIGNERS;
  if (name === 'candidates') return CANDIDATES;
  return [...REASSIGNERS, ...CANDIDATES];
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
function loadFleet() {
  try {
    return JSON.parse(fs.readFileSync(STORE, 'utf8'));
  } catch (e) {
    return { version: 1, environments: {} };
  }
}

function fleetFor(env = environmentKey()) {
  return loadFleet().environments[env] || {};
}

function recordMember(member, env = environmentKey()) {
  const store = loadFleet();
  store.environments = store.environments || {};
  store.environments[env] = store.environments[env] || {};
  store.environments[env][member.key] = member;
  fs.mkdirSync(path.dirname(STORE), { recursive: true });
  fs.writeFileSync(STORE, JSON.stringify(store, null, 2));
  return member;
}

// THE NAMING FORMAT — `RA<KEY><stamp>`, e.g. RACIA78150031, RARACM20090635.
//
//   RA      fixed prefix: "reassignment". Never reused by any other fleet.
//   <KEY>   the member key with separators stripped — CI_A -> CIA, RA_CM -> RACM.
//           So the member's ROLE IN THE MATRIX is readable straight off the name
//           in the app's user list, which matters when inspecting by hand.
//   <stamp> the last 6 digits of Date.now() plus 2 random digits — uniqueness
//           only; it carries no meaning and is not expected to be read.
//
// Email is the lowercased name @adani.com; phone is 10 digits from the same
// stamp. Kept as-is by the app owner's decision (2026-09-16), documented here
// rather than changed.
//
// WHY IT DELIBERATELY DIFFERS FROM THE REPO'S OWN SCHEME. Everything else in
// this suite uses `user-counter-utils.generateUserIdentity`:
// `<PREFIX><3 letters>User<n>` (CISLcliUser151), numbered from the shared
// counter in fixtures/user-creation-counter.json. This fleet must NOT use that
// shape, because `ensureSmokeUsers` self-heals the smoke fleet by matching on
// NAME PREFIX — a reassignment user called CISL…User<n> would be adopted as a
// smoke flow user, silently changing what SM03 maps and what SM05/SM06 log in
// as. The `RA` prefix is what keeps the two fleets disjoint, and it must stay
// disjoint when these specs move into tests/smoke/ (see docs section 6).
function mintIdentity(key) {
  const stamp = String(Date.now()).slice(-6) + Math.floor(Math.random() * 90 + 10);
  const slug = key.replace(/[^A-Za-z0-9]/g, '');
  return {
    name: `RA${slug}${stamp}`,
    email: `ra${slug.toLowerCase()}${stamp}@adani.com`,
    phone: `9${stamp}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 10),
  };
}

module.exports = {
  STORE, WL_A, WL_B, WIND_WL, OTHER_VENDOR, WORK_AREA_MAIN, WORK_AREA_ALT,
  PKG_MAIN, PKG_OTHER, SERVICE_ORDER, VENDOR_SIDE_ROLES, serviceOrderFor,
  REASSIGNERS, CANDIDATES, DEFERRED,
  groupFor, loadFleet, fleetFor, recordMember, mintIdentity,
};
