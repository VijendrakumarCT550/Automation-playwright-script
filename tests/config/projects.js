// Test-target profiles: one object per (project type + work location + user
// set) combination the suite runs against.
//
// WHY THIS EXISTS. Before this file, work locations, work areas, vendors,
// activities and checkpoints were literals inside ~35 spec files, and there was
// exactly one CI/EE/QI credential triple in .env. Adding WIND multiplies four
// dimensions at once (projectType x workLocation x userSet x viewport), so
// copying literals per project type would have doubled the hardcoding instead
// of removing it. Specs now take a profile.
//
// TWO TIERS, deliberately separated (app owner's instruction):
//
//   REGRESSION (tests/specs/, unchanged): A-06c / S05b with the long-standing
//     .env CI/EE/QI accounts. This is where new features get verified and
//     bugs reproduced alongside manual testing. SOLAR_REGRESSION below
//     resolves to the EXACT literals those specs already contain, so pointing
//     them at the profile is provably behaviour-neutral.
//
//   SMOKE (tests/smoke/): a full chain — user creation -> SO mapping -> WAM ->
//     RFI flow -> NC flow -> checkpoint dependency — run with FRESHLY CREATED
//     users, per project type. SOLAR_E2E and WIND_E2E below.
//
// CONFIRMED vs ASSUMED is called out per field. Wind's Work Region/activity
// layer is live-confirmed (2026-08-31 recon,
// tests/specs/00_inspect_wind_master_and_mobile.spec.js); its checkpoint and
// checklist layer is NOT — see docs/wind-activity-checklist-reference.md's
// open questions. Anything unconfirmed is marked and left null rather than
// guessed, so a spec fails loudly on a missing value instead of silently
// running against wrong data.

// Cluster options have been observed to vary between "Gujarat" and
// "Khavda"/"KHAVDA" for what is meant to be the same location depending on
// deployment/DB state — every profile passes candidates, not one string, and
// the page objects use selectDropdownOptionAny for it.
const CLUSTER_CANDIDATES = ['Gujarat', 'Khavda'];
const SITE = 'Khavda';

// ---------------------------------------------------------------------------
// SOLAR — regression tier. Mirrors what tests/specs/ already hardcodes.
// ---------------------------------------------------------------------------
const SOLAR_REGRESSION = {
  key: 'solar-regression',
  label: 'Solar regression (A-06c / S05b, .env users)',
  tier: 'regression',
  projectType: 'SOLAR',
  cluster: CLUSTER_CANDIDATES,
  site: SITE,

  // Both locations the existing users are mapped to. A-06c is the
  // inspect/dependency/NC ground; S05b is where the tracked RFI flow runs.
  workLocations: ['A-06c', 'S05b'],

  vendor: {
    category: 'Service Contractor',
    name: 'M S CHOUHAN INFRAVENTURES',
    // Full SO string as SO Mapping renders it. Matching on vendor name alone
    // is unsafe — see WIND_E2E.serviceOrder's comment on the five BAUER SOs.
    serviceOrder: null, // not needed: mapping already exists for this tier
  },

  // Existing .env accounts. Confirmed by the app owner to work on pulse-dev.
  users: { source: 'env' },

  // The tracked 9-TC RFI regression's data (rfi-flow-turns.js RFI_DATA).
  rfi: {
    workLocation: 'S05b',
    workArea: 'BL02',
    package: 'Civil',
    subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
    activity: 'Piling - MMS',
    subActivity: 'Piling - MMS',
    inspectionCheckpoint: 'Pre Pour Inspection - Pile',
    inspectionChecklist: 'Micro Pile Checklist',
  },

  // The tracked 4-TC NC regression's data (nc-flow-turns.js NC_DATA).
  nc: {
    workLocation: 'A-06c',
    workArea: '__first__',
    vendorName: 'CHOUHAN',
    package: 'Civil',
    activity: 'Piling - Robotic Docking System',
    subActivity: 'Piling - Robotic Docking System',
  },
};

// ---------------------------------------------------------------------------
// WIND — smoke tier. Built first, per the app owner ("wind first").
// ---------------------------------------------------------------------------
const WIND_E2E = {
  key: 'wind-e2e',
  label: 'Wind E2E smoke (WTG-Khavda, fresh WTG users)',
  tier: 'smoke',

  // CONFIRMED live: Project Type dropdown offers SOLAR, WIND, INFRA, PSS,
  // ADMIN, BESS, TRANSMISSION_LINE. Wind is one of seven, not one of two.
  projectType: 'WIND',
  cluster: CLUSTER_CANDIDATES,
  site: SITE,

  // CONFIRMED live: exactly ONE Work Location exists under WIND, spelled
  // "WTG-Khavda" — NOT "WTG-Khavada" as the brief had it.
  workLocations: ['WTG-Khavda'],

  // CONFIRMED live: 244 Work Areas under WTG-Khavda, in two naming families
  // and every name contains a SPACE — "KH 34", "KH 35", ... "KH 622" and
  // "WTG 002" ... "WTG 557" (single outlier with no space: "WTG219"). An
  // exact-match lookup for 'KH34' silently finds nothing.
  //
  // KH 34 is the app owner's chosen area and is explicitly approved for
  // overwriting its existing Service Order mappings.
  workAreas: ['KH 34'],
  primaryWorkArea: 'KH 34',

  // CONFIRMED live (00_inspect_wind_rfi_form.spec.js): wind has exactly ONE
  // Work Section per Work Area, and it is the Work Area's own name — selecting
  // Work Area "KH 34" makes "KH 34" the only Work Section option. Consistent
  // with Unit of RFI = "Per WTG" on every row: a wind Work Area IS one WTG.
  //
  // That is solar's "Block"-granularity case, so the wind dependency spec must
  // use the TWO-WORK-AREAS strategy
  // (runDependencyChainForScarceWorkSectionActivity in
  // rfi-dependency-flow.js), NOT the throwaway-Work-Section one — there is
  // nothing else to sacrifice inside a single Work Area.
  //
  // Still null because a second Work Area is not usable until it has been BOTH
  // SO-mapped (stage 2) AND WAM'd (stage 3): confirmed live that the CI's Work
  // Area dropdown offers ONLY what it was WAM'd (one option, KH 34). Setting
  // this therefore also requires stages 2 and 3 to iterate over every entry in
  // `workAreas`, not just primaryWorkArea.
  workSectionGranularity: 'one-per-work-area',
  throwawayWorkArea: null,

  // CONFIRMED live: three packages exist under WIND, title case in the app
  // (upper case in the source spreadsheet) — Civil (18 activities),
  // Electrical (8), Mechanical (8).
  //
  // BUT the smoke chain is scoped to CIVIL ONLY, because "map one vendor to
  // every activity so one WTG CI can raise any RFI" turns out to be
  // impossible with BAUER. CONFIRMED live
  // (00_inspect_wind_so_options_per_package.spec.js): the per-activity
  // Service Order dropdown is scoped PER PACKAGE, and BAUER has no
  // Electrical or Mechanical service order on this work location at all:
  //
  //   Civil       137 SO options — all 5 BAUER SOs present, incl. 5710012136
  //   Electrical   41 SO options — ZERO BAUER options
  //   Mechanical   61 SO options — ZERO BAUER options
  //
  // (Probed at both the first and last activity of each package with
  // identical results, so the scoping is per-package, not per-activity.)
  //
  // Covering Electrical/Mechanical would need a DIFFERENT vendor per package,
  // and since a Contractor Incharge is tied to a vendor, that means a separate
  // CI/CM pair per package — tripling stages 1 and 3. Civil is also where the
  // work actually is: 27 of the 34 wind activities are Civil, including the
  // entire long dependency spine A1.1 -> A1.13 that the checkpoint-dependency
  // spec needs. Mechanical was entirely unmapped before this work, so nothing
  // was exercising it anyway.
  packages: ['Civil'],

  // For reference / a future decision — not used by the chain.
  allPackages: ['Civil', 'Electrical', 'Mechanical'],

  vendor: {
    // CONFIRMED by the app owner: BAUER is a "Service Contractor" kind
    // vendor, used for both the WTG CI and the WTG CM.
    category: 'Service Contractor',
    name: 'BAUER ENGINEERING INDIA PVT LTD',

    // MUST be the full "<number> - <name>" string. CONFIRMED live: the
    // Service Order dropdown holds 137 options and BAUER ENGINEERING INDIA
    // PVT LTD appears under FIVE different SO numbers — 5710008038,
    // 5710009696, 5710012136, 5710017100, 5710018312. A vendor-name-only
    // match resolves to 5710008038, i.e. the WRONG service order. The app
    // owner specified 5710012136.
    serviceOrder: '5710012136 - BAUER ENGINEERING INDIA PVT LTD',
  },

  // Mapped to EVERY activity, so one WTG CI has access to all of them when
  // creating RFIs (app owner's instruction). Note the recon finding that all
  // 8 Mechanical activities are currently UNMAPPED on KH 34, and Civil is
  // mostly on BHAWANI CONSTRUCTION COMPANY — so this is a substantial
  // remapping, not a top-up.
  mapServiceOrderToAllActivities: true,

  users: {
    source: 'created',
    // Prefix encodes project type so a solar and a wind user of the same role
    // can never be confused (app owner: "cisl for solar, ciwtg for wind").
    // NOTE: the existing 11-role batch spec (12_user_management.spec.js) calls
    // Contractor Incharge "CIC"; these are separate, project-scoped users and
    // do not touch that spec or its recorded prefixes.
    prefixes: {
      CI: 'CIWTG', // Contractor Incharge — raises RFIs
      CM: 'CMWTG', // Contractor Manager
      EE: 'EEWTG', // Execution Engineer — first reviewer
      QI: 'QIWTG', // Quality Inspector — second reviewer, raises NCs
    },
    roles: {
      CIWTG: { role: 'Contractor Incharge', userType: 'VENDOR' },
      CMWTG: { role: 'Contractor Manager', userType: 'VENDOR' },
      EEWTG: { role: 'Execution Engineer', userType: 'AGEL' },
      QIWTG: { role: 'Quality Inspector', userType: 'AGEL' },
    },
  },

  // Activity/checkpoint reference for wind lives in the extracted fixture
  // rather than being duplicated here — 34 activities / 144 checkpoints is
  // too much to inline, and it is generated from the source workbook.
  // CONFIRMED live: the fixture's activity names match SO Mapping exactly
  // (34/34, both directions).
  activityMasterFixture: 'wind-activity-checklist.json',

  // NOT YET CONFIRMED — needs the RFI create form, which needs a WIND CI who
  // is SO-mapped and WAM'd (i.e. after s01/s02/s03 below have run once).
  // Deliberately null so anything that needs them fails loudly.
  rfi: null,
  nc: null,
};

// ---------------------------------------------------------------------------
// SOLAR — smoke tier. Phase 2, after wind is green.
// ---------------------------------------------------------------------------
const SOLAR_E2E = {
  key: 'solar-e2e',
  label: 'Solar E2E smoke (A-06c, fresh SL users)',
  tier: 'smoke',
  projectType: 'SOLAR',
  cluster: CLUSTER_CANDIDATES,
  site: SITE,

  // App owner revised this: A16b/A16d are dropped, solar stays on the existing
  // locations. Both are listed at user-creation scope.
  workLocations: ['A-06c', 'S05b'],

  // App owner's instruction: pick any UNUSED work area under A-06c and extend
  // SO Mapping + WAM to it, which is what makes RFI creation possible there.
  // Left null until A-06c's work areas are enumerated and a clean one chosen —
  // it must avoid BL02 (tracked 9-TC regression) and BL09/BL10 (dependency
  // specs 29/30), all under constant churn.
  workAreas: null,
  primaryWorkArea: null,

  packages: ['Civil'],

  vendor: {
    category: 'Service Contractor',
    name: 'ADVAIT ENERGY TRANSITIONS LTD',
    // App-owner-specified. Still to be verified against the live Service
    // Order dropdown the same way BAUER's was — the five-BAUER-SOs finding
    // means a name-only assumption is not safe here either.
    serviceOrder: '4810023936 - ADVAIT ENERGY TRANSITIONS LTD',
  },

  mapServiceOrderToAllActivities: true,

  users: {
    source: 'created',
    prefixes: { CI: 'CISL', CM: 'CMSL', EE: 'EESL', QI: 'QISL' },
    roles: {
      CISL: { role: 'Contractor Incharge', userType: 'VENDOR' },
      CMSL: { role: 'Contractor Manager', userType: 'VENDOR' },
      EESL: { role: 'Execution Engineer', userType: 'AGEL' },
      QISL: { role: 'Quality Inspector', userType: 'AGEL' },
    },
  },

  activityMasterFixture: null, // solar's reference lives in rfi-dependency-data.js
  rfi: null,
  nc: null,
};

const PROFILES = {
  [SOLAR_REGRESSION.key]: SOLAR_REGRESSION,
  [SOLAR_E2E.key]: SOLAR_E2E,
  [WIND_E2E.key]: WIND_E2E,
};

function getProfile(key) {
  const profile = PROFILES[key];
  if (!profile) {
    throw new Error(
      `Unknown test profile "${key}". Valid keys: ${Object.keys(PROFILES).join(', ')}`
    );
  }
  return profile;
}

// Throws with a useful message rather than letting a null flow into a
// dropdown selection and fail as an inscrutable timeout 40 lines deeper.
function requireField(profile, fieldPath) {
  const value = fieldPath.split('.').reduce((o, k) => (o == null ? o : o[k]), profile);
  if (value === null || value === undefined) {
    throw new Error(
      `Profile "${profile.key}" has no value for "${fieldPath}" yet. ` +
      `It is deliberately unset — see tests/config/projects.js for what has to be ` +
      `confirmed live before it can be filled in.`
    );
  }
  return value;
}

module.exports = {
  PROFILES, getProfile, requireField,
  SOLAR_REGRESSION, SOLAR_E2E, WIND_E2E,
  CLUSTER_CANDIDATES, SITE,
};
