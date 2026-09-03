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
// tests/specs/inspection/00_inspect_wind_master_and_mobile.spec.js); its checkpoint and
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
  // THE 21 "WTG 4xx" AREAS REPLACE THE OLD "KH ..." SET (app owner, 2026-09-03,
  // with the SO Mapping screen showing all 21 selected under WIND / WTG-Khavda /
  // Civil). The KH areas were partly exhausted — KH 34 spent, several others
  // partly used — and a clean pool is what makes the one-area-per-TC allocation
  // below legible. Every name is verbatim from the live list; note the SPACE.
  //
  // WHY SO MANY. Wind has exactly ONE Work Section per Work Area and a run
  // consumes that (checkpoint, Work Section) pair permanently, so wind buys
  // capacity by adding AREAS rather than by reusing one. Provisioning is cheap
  // now that both stages work in a single pass: SM02 selects every area at once
  // and sets each activity's Service Order once, and SM03 assigns all rows in one
  // dialog per role.
  workAreas: [
    'WTG 423', 'WTG 424', 'WTG 425', 'WTG 426', 'WTG 427', 'WTG 428',
    'WTG 429', 'WTG 430', 'WTG 431', 'WTG 432', 'WTG 433',
    'WTG 448', 'WTG 449', 'WTG 450', 'WTG 451', 'WTG 452', 'WTG 453',
    'WTG 454', 'WTG 455', 'WTG 456', 'WTG 457',
  ],
  primaryWorkArea: 'WTG 423',

  // Wind runs DESKTOP ONLY (app owner, 2026-09-03). Mobile is already covered by
  // solar, and solar can absorb the reruns that mobile-layout debugging costs
  // whereas every wind attempt spends an irreplaceable checkpoint. Wind's job is
  // to prove the flow is not solar-specific, which is a PROJECT-TYPE axis, not a
  // viewport one.
  viewports: ['desktop'],

  // PREFERENCE ORDER, not an exclusive assignment: the flow stage walks its own
  // list first and then falls through to the remaining areas, so a pool whose
  // areas are spent still finds ground instead of failing.
  //
  // ONE WORK AREA PER TC is the point, not just raw capacity. Wind enforces the
  // preceding-checkpoint rule, so within a SINGLE area checkpoint N+1 is blocked
  // until N is approved — nine TCs created up front on one area would mostly sit
  // blocked. Nine TCs on nine DIFFERENT areas all sit at checkpoint A1.18.1 and
  // run cleanly. Every TC ends in a QI approval, so a completed pass leaves each
  // area advanced by exactly one checkpoint and the next pass runs on A1.18.2.
  // With 5 Crane Pad checkpoints that is ~5 clean passes before re-provisioning.
  //
  // The RFI and NC pools are DISJOINT because a non-approved NC blocks RFI
  // create/resubmit on the same (checkpoint, work section) — and on wind the work
  // section IS the work area, so one unfinished NC would lock a whole area out of
  // the RFI stage.
  flowWorkAreas: {
    rfi: {
      desktop: [
        'WTG 423', 'WTG 424', 'WTG 425', 'WTG 426', 'WTG 427', 'WTG 428',
        'WTG 429', 'WTG 430', 'WTG 431', 'WTG 432', 'WTG 433',
        // Spare capacity. Deliberately assigned to a POOL rather than left
        // unallocated: an unclaimed area is reachable by the fallthrough of
        // BOTH flows, which would put an NC and an RFI on the same ground and
        // reintroduce exactly the block the disjoint pools prevent.
        'WTG 456',
      ],
    },
    nc: {
      desktop: [
        'WTG 448', 'WTG 449', 'WTG 450', 'WTG 451',
        'WTG 452', 'WTG 453', 'WTG 454', 'WTG 455',
      ],
    },
  },

  // Sacrificial ground for the SO demapping stage (SM08). WTG 456 is left as
  // unallocated spare.
  demapWorkArea: 'WTG 457',

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
    // DECIDED 2026-09-03: 5710008038, matching what the SO Mapping screen
    // actually shows on the mapped rows. This SUPERSEDES 5710012136, which was
    // the number recorded from the app owner earlier. The full
    // "<number> - <NAME>" string stays mandatory: BAUER appears under five
    // different SO numbers and a vendor-name-only match resolves to the wrong
    // one.
    serviceOrder: '5710008038 - BAUER ENGINEERING INDIA PVT LTD',
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
    // ORDERED creation list. Vendor roles first: their Add User cascade has the
    // most moving pieces (vendor category + vendor), so a break there surfaces
    // early. Then the AGEL flow roles, then the hierarchy tiers.
    order: ['CI', 'CM', 'EE', 'QI', 'EL', 'QL', 'PM', 'PAD', 'SAD', 'CAD'],

    // The four that actually drive the RFI/NC flows. SM03 maps EXACTLY these onto
    // the work areas; the hierarchy tiers are handled by SM04's cascade instead,
    // because they are not all work-area-scoped (PM and PAD are work-location
    // roles, SAD is site-level) and need different dialog handling.
    flowRoles: ['CI', 'CM', 'EE', 'QI'],

    // The tiers SM04 walks DOWN, top first, each one mapping the tier below it.
    // Admin is the root of that cascade and comes from .env — never created here.
    hierarchyRoles: ['CAD', 'SAD', 'PAD', 'PM', 'EL', 'QL'],

    // Every prefix is project-scoped so it can never collide with
    // 12_user_management.spec.js's bare CAD/SAD/PAD/PM/EL/QL/CIC keys in the
    // shared fixtures/last-created-users.json. 18_wam_hierarchy.spec.js resolves
    // ITS users by those bare prefixes, so overwriting them would break it.
    prefixes: {
      CI: 'CIWTG', CM: 'CMWTG', EE: 'EEWTG', QI: 'QIWTG',
      EL: 'ELWTG', QL: 'QLWTG', PM: 'PMWTG',
      PAD: 'PADWTG', SAD: 'SADWTG', CAD: 'CADWTG',
    },

    // Role labels and userTypes are verbatim from 12_user_management.spec.js,
    // which is the creation source of truth for all eleven roles.
    roles: {
      CIWTG: { role: 'Contractor Incharge', userType: 'VENDOR' },
      CMWTG: { role: 'Contractor Manager', userType: 'VENDOR' },
      EEWTG: { role: 'Execution Engineer', userType: 'AGEL' },
      QIWTG: { role: 'Quality Inspector', userType: 'AGEL' },
      ELWTG: { role: 'Execution Lead', userType: 'AGEL' },
      QLWTG: { role: 'Quality Lead', userType: 'AGEL' },
      PMWTG: { role: 'Project Manager', userType: 'AGEL' },
      PADWTG: { role: 'Plot Admin', userType: 'AGEL' },
      SADWTG: { role: 'Site Admin', userType: 'AGEL' },
      CADWTG: { role: 'Cluster Admin', userType: 'AGEL' },
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
    workArea: 'WTG 423',
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

  // S05b ONLY, and index 0 matters: SM02 (SO mapping) and SM03 (WAM) both
  // provision `workLocations[0]`. A-06c is deliberately absent — it is the app
  // owner's manual-testing ground and smoke must not touch it at all.
  workLocations: ['S05b'],

  // CONFIRMED by the app owner: every BL{nn} area supports the solar activities
  // and returns a usable Work Section list. Only Road* / Drain* areas fail to
  // show work sections, so they must never be used. Screenshot evidence for this
  // band: S05b / BL01 / Piling - MMS / Pre Pour Inspection - Pile reports
  // Total 264 / Selected 0 / Pending 264.
  //
  // WHY BL03..BL06 AND NOT BL01..BL03 as originally requested. Three separate
  // rules decide this band; see docs/smoke-e2e-framework.md section 4.1.
  //
  //   BL01 belongs to 02_rfi_ci.spec.js (S05b / BL01).
  //   BL02 belongs to the tracked 9-TC regression — rfi-flow-turns.js RFI_DATA
  //        is S05b / BL02 — i.e. specs 08/09/10, 21, 23 and 24.
  //
  // Sharing either would not merely muddle the queues. WAM's Contractor Incharge
  // and Quality Inspector rows are SINGLE-ASSIGNEE (WAMPage.js:500-504 — "one
  // pick simply replaces whoever was there"), so SM03 assigning the freshly
  // created smoke CI to BL01/BL02 would EVICT the .env CI those seven specs log
  // in as, and they would start failing with the work area invisible. Shifting
  // two areas up removes the eviction entirely and costs nothing.
  //
  // BL09/BL10 (dependency specs) and BL03 (03_rfi_bulk_create) are all on A-06c,
  // not S05b, so they do not collide with this band.
  workAreas: ['BL03', 'BL04', 'BL05', 'BL06'],
  primaryWorkArea: 'BL03',

  // Solar carries BOTH viewports: it never exhausts (see workSectionGranularity
  // below), so it can absorb the rerun cost that mobile-layout debugging incurs.
  viewports: ['desktop', 'mobile'],

  // ONE WORK AREA PER (FLOW x VIEWPORT), and the RFI/NC split is not cosmetic.
  //
  //   RFI consumes work sections. A 9-TC pass spends ~9-10 (checkpoint, work
  //   section) pairs and every rerun spends another ~10, so desktop and mobile
  //   get their own area to stay independently re-runnable. 264 sections is
  //   roughly 26 passes per area.
  //
  //   NC does not consume anything — duplicate NCs against identical details are
  //   legal — so both NC viewports SHARE BL05. What matters is that BL05 is
  //   DISJOINT from the RFI areas: an NC left in a non-approved state BLOCKS RFI
  //   create/resubmit for the same (inspection checkpoint, work section). A
  //   bug-interrupted NC cycle on BL03 would therefore lock the RFI stage out of
  //   that ground permanently.
  flowWorkAreas: {
    rfi: { desktop: ['BL03'], mobile: ['BL04'] },
    nc:  { desktop: ['BL05'], mobile: ['BL05'] },
  },

  // Sacrificial ground for the SO demapping stage (SM08), which removes mappings
  // and must never be pointed at an area a flow depends on. SM02 maps it like any
  // other area so there is something to demap.
  demapWorkArea: 'BL06',

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
    // ORDERED creation list. Vendor roles first: their Add User cascade has the
    // most moving pieces (vendor category + vendor), so a break there surfaces
    // early. Then the AGEL flow roles, then the hierarchy tiers.
    order: ['CI', 'CM', 'EE', 'QI', 'EL', 'QL', 'PM', 'PAD', 'SAD', 'CAD'],

    // The four that actually drive the RFI/NC flows. SM03 maps EXACTLY these onto
    // the work areas; the hierarchy tiers are handled by SM04's cascade instead,
    // because they are not all work-area-scoped (PM and PAD are work-location
    // roles, SAD is site-level) and need different dialog handling.
    flowRoles: ['CI', 'CM', 'EE', 'QI'],

    // The tiers SM04 walks DOWN, top first, each one mapping the tier below it.
    // Admin is the root of that cascade and comes from .env — never created here.
    hierarchyRoles: ['CAD', 'SAD', 'PAD', 'PM', 'EL', 'QL'],

    // Every prefix is project-scoped so it can never collide with
    // 12_user_management.spec.js's bare CAD/SAD/PAD/PM/EL/QL/CIC keys in the
    // shared fixtures/last-created-users.json. 18_wam_hierarchy.spec.js resolves
    // ITS users by those bare prefixes, so overwriting them would break it.
    prefixes: {
      CI: 'CISL', CM: 'CMSL', EE: 'EESL', QI: 'QISL',
      EL: 'ELSL', QL: 'QLSL', PM: 'PMSL',
      PAD: 'PADSL', SAD: 'SADSL', CAD: 'CADSL',
    },

    // Role labels and userTypes are verbatim from 12_user_management.spec.js,
    // which is the creation source of truth for all eleven roles.
    roles: {
      CISL: { role: 'Contractor Incharge', userType: 'VENDOR' },
      CMSL: { role: 'Contractor Manager', userType: 'VENDOR' },
      EESL: { role: 'Execution Engineer', userType: 'AGEL' },
      QISL: { role: 'Quality Inspector', userType: 'AGEL' },
      ELSL: { role: 'Execution Lead', userType: 'AGEL' },
      QLSL: { role: 'Quality Lead', userType: 'AGEL' },
      PMSL: { role: 'Project Manager', userType: 'AGEL' },
      PADSL: { role: 'Plot Admin', userType: 'AGEL' },
      SADSL: { role: 'Site Admin', userType: 'AGEL' },
      CADSL: { role: 'Cluster Admin', userType: 'AGEL' },
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
    workLocation: 'S05b',
    workArea: 'BL03',
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

  // NC create-form data. Every value here is the PROVEN combination from
  // nc-flow-turns.js NC_DATA, which the tracked 4-TC NC regression has always
  // used — only the Work Location and Work Area move (S05b / BL05 instead of
  // A-06c / __first__), so the activity, defect and category strings are not
  // guesswork.
  //
  // NEEDS FIRST-RUN CONFIRMATION: "Piling - Robotic Docking System" has only ever
  // been driven on A-06c. The app owner confirms every BL{nn} area supports the
  // solar activities, but that this activity is present under S05b's Civil
  // package is inferred rather than observed. It fails loudly at the activity
  // dropdown if not.
  //
  // BL05 is shared by both NC viewports and is disjoint from the RFI areas — see
  // flowWorkAreas above for why that separation is a hard requirement.
  nc: {
    workLocation: 'S05b',
    workArea: 'BL05',
    vendorName: 'CHOUHAN',
    package: 'Civil',
    activity: 'Piling - Robotic Docking System',
    subActivity: 'Piling - Robotic Docking System',
    workSectionCount: 2,
    ncQuantity: 2,
    unit: 'EA',
    defectType: 'Workmanship defect',
    category: 'Critical',
    // Mandatory per an app change; 14 days from the run date.
    targetDateClosureDays: 14,
  },
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

// Resolves the ORDERED work-area pool for one (flow, viewport), most-preferred
// first. Lives here because this file owns the flowWorkAreas shape, so the RFI
// stage, the NC stage and the recon specs cannot disagree about how to read it.
//
// FALLTHROUGH IS DELIBERATELY LIMITED to areas no flow has claimed and that are
// not the demap sacrificial area. Appending "every other work area" — which an
// earlier version did — would let the NC stage fall through onto RFI ground, and
// a non-approved NC there BLOCKS RFI create/resubmit for the same (checkpoint,
// work section). The pools are disjoint on purpose; the fallthrough must not
// undo that.
//
// Accepts the legacy FLAT shape ({ desktop, mobile }) as well as the canonical
// per-flow one ({ rfi: {...}, nc: {...} }), so a profile that has not been
// migrated keeps resolving instead of silently returning an empty pool.
function resolveFlowWorkAreas(profile, { flow, viewport }) {
  const all = (profile.workAreas || []).filter(Boolean);
  const map = profile.flowWorkAreas || {};

  const perFlow = map[flow] && !Array.isArray(map[flow]) ? map[flow] : null;
  const raw = perFlow ? perFlow[viewport] : map[viewport];
  const preferred = (Array.isArray(raw) ? raw : [raw]).filter(Boolean);

  // Everything any flow claims, plus the demap area — not valid fallthrough.
  const claimed = new Set();
  const collect = (v) => {
    if (!v) return;
    if (Array.isArray(v)) v.filter(Boolean).forEach((a) => claimed.add(a));
    else if (typeof v === 'object') Object.values(v).forEach(collect);
  };
  collect(map);
  if (profile.demapWorkArea) claimed.add(profile.demapWorkArea);

  const spare = all.filter((a) => !claimed.has(a) && !preferred.includes(a));
  const pool = [...preferred, ...spare];
  if (pool.length) return pool;

  const fallback = [profile.primaryWorkArea || (profile.rfi && profile.rfi.workArea)].filter(Boolean);
  if (!fallback.length) {
    throw new Error(
      `Profile "${profile.key}" resolves no work area for flow "${flow}" / viewport ` +
      `"${viewport}". Check flowWorkAreas and workAreas in tests/config/projects.js.`
    );
  }
  return fallback;
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
  PROFILES, getProfile, requireField, resolveFlowWorkAreas,
  SOLAR_REGRESSION, SOLAR_E2E, WIND_E2E,
  CLUSTER_CANDIDATES, SITE,
};
