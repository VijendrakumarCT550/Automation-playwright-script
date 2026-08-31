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
  // MULTIPLE work areas, all SO-mapped (stage 2) and all WAM'd to the same WTG
  // CI (stage 3) — the app owner's solution to a real problem: wind has exactly
  // ONE Work Section per Work Area, and a run consumes the (checkpoint, Work
  // Section) pair permanently, so a single work area is exhausted after about
  // five runs and cannot support two viewport variants at once.
  //
  // With the same CI mapped across several areas, the SAME activity and
  // checkpoint chain can be run repeatedly by changing only the Work Area. That
  // is what gives the desktop and mobile flow runs independent ground:
  // flowWorkAreas below assigns one to each, so neither can consume the other's
  // checkpoints and either can be re-run without disturbing the other.
  // All SO-mapped (stage 2) and all WAM'd to the same WTG CI (stage 3). Every
  // name is verbatim from the live 244-option list — note the SPACE.
  //
  // Six rather than two because a work area really does get exhausted: one Work
  // Section per area, consumed permanently per checkpoint, so an area supports
  // about as many runs as the activity has checkpoints (5 for Crane Pad). With
  // six areas that is ~30 runs before anything needs re-provisioning, and
  // extending the list further is a one-line change plus one re-run of stages
  // 2 and 3.
  //
  // Provisioning six costs almost nothing now that both stages work in a single
  // pass: SO mapping selects all six work areas at once and sets each activity's
  // Service Order once, and WAM assigns all six rows in one dialog per role.
  workAreas: ['KH 34', 'KH 35', 'KH 47', 'KH 51', 'KH 52', 'KH 53'],
  primaryWorkArea: 'KH 34',

  // Per-viewport PREFERENCE ORDER, not an exclusive assignment. The flow stage
  // walks its own list first — so desktop and mobile normally stay out of each
  // other's way and either can be re-run independently — and then falls through
  // to the remaining areas rather than failing once its own are spent.
  flowWorkAreas: {
    desktop: ['KH 34', 'KH 47', 'KH 51'],
    mobile: ['KH 35', 'KH 52', 'KH 53'],
  },

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

  // RFI create-form data. Every string here is EXACTLY as the live form renders
  // it (captured by 00_inspect_wind_rfi_form.spec.js; raw data in
  // tests/fixtures/so-mapping-baseline/wind-rfi-form-recon.json).
  //
  // Note the numeric prefixes on activity/subActivity — the form renders
  // "1. Crane Pad" and "1.1 Pre-Activity Work", NOT the bare names the activity
  // master uses, and the casing differs too (live "Boulder laying" vs sheet
  // "Boulder Laying"). RFICreatePage.selectOption does a SUBSTRING match, so
  // passing the full live label including its prefix is both correct and the
  // least ambiguous option.
  rfi: {
    workLocation: 'WTG-Khavda',
    workArea: 'KH 34',
    package: 'Civil',

    // "Crane Pad" chosen as the smoke path: it is the smallest Civil activity
    // (one activity, 5 checkpoints), every one of its checkpoint names is
    // unique, and it sits on its own sub-package so nothing else competes for
    // it. The long A1.1->A1.13 dependency spine is deliberately NOT used here —
    // that belongs to the dependency stage, not a smoke test.
    subPackage: 'Crane Pad',
    activity: '1. Crane Pad',

    // Exactly ONE Work Section per Work Area, and it is NAMED AFTER the Work
    // Area — so the Work Section to select always equals whichever Work Area
    // the run is using. Left null deliberately: the spec derives it from the
    // resolved work area rather than hardcoding "KH 34", which would silently
    // select the wrong section once the mobile variant runs on KH 35.
    workSection: null,

    // UNKNOWN for wind, and deliberately left null rather than guessed: solar's
    // RFI_DATA sets these three to null, which only proves they are optional ON
    // SOLAR. The recon cancelled out of the form before reaching them, so
    // whether wind requires RFI Quantity / Unit / Sub-Contractor Name is
    // unconfirmed. RFICreatePage.fillForm supports filling them with no code
    // change if the first live run says they are mandatory.
    //
    // Also note RFICreatePage's unitDropdown is getByRole('combobox', {name:
    // /Unit/i}), which would ALSO match a "Unit of Measurement" label — if wind
    // needs a unit, verify which combobox that regex resolves to first.
    rfiQuantity: null,
    unit: null,
    subContractor: null,

    observationValue: 'OK - as per standard (wind smoke)',

    // The A1.18 Crane Pad chain in sheet order. The smoke stage walks this to
    // find the next checkpoint still raisable against Work Section "KH 34",
    // because each successful run permanently CONSUMES one (checkpoint,
    // "KH 34") pair — merely selecting a Work Section consumes it, and there is
    // no spare within a Work Area. That gives roughly 5 runs before this
    // activity is exhausted and the stage needs a fresh Work Area.
    //
    // `expectObservations: false` marks the two bookend checkpoints, whose only
    // checklist is the generic "Documents and report information" and which may
    // legitimately render zero Observation/Measured Value inputs — see
    // RFIChecklistPage.fillAllObservations' requireObservations option.
    checkpointChain: [
      { code: 'A1.18.1', subActivity: '1.1 Pre-Activity Work',  checkpoint: 'Pre-Activity Checkpoint',  checklist: 'Documents and report information', expectObservations: false },
      { code: 'A1.18.2', subActivity: '1.2 OGL',                checkpoint: 'Pre-Inspection',           checklist: 'OGL Checklist' },
      { code: 'A1.18.3', subActivity: '1.3 Boulder laying',     checkpoint: 'Routine Inspection',       checklist: 'Boulder Laying Checklist' },
      // NOTE: the app offers "GSB Inspection Checklist" here, while the activity
      // master says "GSB Laying Checklist" (that name belongs to A1.13.4 in the
      // sheet). The app's string is what the dropdown needs.
      { code: 'A1.18.4', subActivity: '1.4 GSB laying',         checkpoint: 'Final Inspection',         checklist: 'GSB Inspection Checklist' },
      { code: 'A1.18.5', subActivity: '1.5 Post-Activity Work', checkpoint: 'Post-Activity Checkpoint', checklist: 'Documents and report information', expectObservations: false },
    ],
  },

  // NOT YET CONFIRMED — the NC create form has not been opened for wind at all.
  // Deliberately null so anything that needs it fails loudly.
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

  // CONFIRMED live (00_inspect_solar_e2e_ground.spec.js): A-06c has 85 work
  // areas — BL01..BL40 plus 45 non-BL ones (Culvert 1-5, Drain1-20, Road1-20).
  //
  // MUST be BL{nn} format — never Culvert / Drain / Road.
  //
  // App owner, and it is a hard functional constraint rather than a preference:
  // those areas do not contain the Piling activities, so a Piling RFI there finds
  // NO WORK SECTION at all. The activity dropdown is misleading on this point —
  // the recon confirmed "Culvert 1" happily offers all 23 Civil activities
  // including Piling - MMS, so nothing fails until the Work Section list comes
  // back empty. Only the Work Section list tells the truth about whether an area
  // really supports an activity.
  //
  // BL21+ specifically, because the existing suite only ever touches BL01..BL10
  // (05_so_mapping maps those ten, 07_wam_ci assigns them, and the specs use
  // BL02 for the tracked 9-TC regression and BL09/BL10 for the dependency
  // specs). A-06c has BL01..BL40, so BL11..BL40 are both untouched AND the right
  // kind of area.
  workAreas: ['BL21', 'BL22'],
  primaryWorkArea: 'BL21',

  // Desktop and mobile get their own area, as for wind — not because solar can
  // exhaust (it cannot; see workSectionGranularity below) but so the two
  // viewports stay independently re-runnable.
  flowWorkAreas: {
    desktop: ['BL21'],
    mobile: ['BL22'],
  },

  // SOLAR HAS MANY WORK SECTIONS PER WORK AREA — BL02 alone has ~490 for
  // Piling - MMS. That is the fundamental difference from wind, and it is why
  // the app owner wants solar to carry the MOBILE coverage: a run picks a fresh
  // Work Section every time, so nothing is ever exhausted, no area gets stuck
  // behind an unapproved RFI, and the same checkpoint can be re-run
  // indefinitely. Wind keeps the one-Work-Section-per-area and
  // dependency-enforcement coverage.
  workSectionGranularity: 'many-per-work-area',
  throwawayWorkArea: null,

  packages: ['Civil'],

  vendor: {
    category: 'Service Contractor',
    name: 'M S CHOUHAN INFRAVENTURES',
    // CONFIRMED live: at SOLAR / A-06c / Civil the Service Order dropdown holds
    // 32 options, exactly ONE of which is CHOUHAN — and ADVAIT (the vendor
    // originally named for the since-dropped A16b location) has ZERO. Service
    // Order options are scoped to the work location and package, and solar SOs
    // carry a 481... prefix versus wind's 571...
    //
    // The number matches what 07_wam_ci.spec.js already recorded for CHOUHAN.
    serviceOrder: '4810024058 - M S CHOUHAN INFRAVENTURES PVT LTD',
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

  // The proven solar RFI combination — the same activity/checkpoint/checklist the
  // tracked 9-TC regression and the dependency specs have always used, so none
  // of it is guesswork. Only the Work Area differs (BL21/BL22 instead of BL02).
  //
  // Note the CONTRAST with wind, and it is the whole reason solar carries the
  // mobile coverage:
  //   * workSection is null and STAYS null — solar has ~490 sections per area, so
  //     "pick the first available" gives a fresh one every run. Nothing is
  //     consumed in a way that matters. (For wind, workSection has to track the
  //     Work Area because there is exactly one and it is named after the area.)
  //   * checkpointChain has ONE entry. Solar never needs to walk to a later
  //     checkpoint looking for a free section, because checkpoint 1 always has
  //     one. The dependency rule still applies, but is never hit: a brand-new
  //     Work Section has no predecessor requirement.
  //   * Solar activity/checkpoint names carry NO numeric prefix (that is a wind
  //     rendering trait), so these are the bare names.
  rfi: {
    workLocation: 'A-06c',
    workArea: 'BL21',
    package: 'Civil',
    subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
    activity: 'Piling - MMS',

    workSection: null,

    // Solar's RFI_DATA has always left these null, i.e. they are optional here.
    rfiQuantity: null,
    unit: null,
    subContractor: null,

    observationValue: 'OK - as per standard (solar smoke)',

    checkpointChain: [
      {
        code: 'A.1.1.1',
        subActivity: 'Piling - MMS',
        checkpoint: 'Pre Pour Inspection - Pile',
        checklist: 'Micro Pile Checklist',
      },
    ],
  },

  // The solar NC form has not been driven by this chain yet. NC_DATA in
  // nc-flow-turns.js has the proven values (A-06c, Piling - Robotic Docking
  // System, CHOUHAN) if/when stage 6 is written.
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
