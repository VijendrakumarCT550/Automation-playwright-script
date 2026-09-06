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

  // The regression tier has no feature-depth ground of its own: it IS the
  // ground the SM10+ replicas were built to stop borrowing (A-06c and
  // S05b/BL01-BL02). Set explicitly rather than left undefined so
  // requireFeatureGround() names the profile in its error instead of failing on
  // a property read.
  featureGround: null,

  // Same reasoning: SM28 is a smoke stage and must never run on the regression
  // tier's ground, since it deliberately leaves a non-approved NC behind.
  ncBlock: null,
};

// ---------------------------------------------------------------------------
// WIND — smoke tier. Built first, per the app owner ("wind first").
// ---------------------------------------------------------------------------
const WIND_E2E = {
  key: 'wind-e2e',
  label: 'Wind E2E smoke (WTG-Mandvi, fresh WTG users)',
  tier: 'smoke',

  // CONFIRMED live: Project Type dropdown offers SOLAR, WIND, INFRA, PSS,
  // ADMIN, BESS, TRANSMISSION_LINE. Wind is one of seven, not one of two.
  projectType: 'WIND',

  // RESOLVED from docs/work-region-hierarchy.md, not guessed. That doc is the
  // Location Master snapshot exported from DRS, and its Cluster/Site table puts
  // Mandvi under Gujarat:
  //
  //   | Gujarat | Mandvi | 2 work locations | 70 work areas | wind, pss |
  //
  // So wind no longer shares solar's SITE. Note this is a plain string, not the
  // candidate list CLUSTER_CANDIDATES uses: that list exists because the Khavda
  // site's Cluster field has been seen rendering as either "Gujarat" or "Khavda",
  // a quirk with no evidence either way for Mandvi. If a live cascade cannot find
  // "Gujarat" here, widen this to candidates the same way.
  cluster: ['Gujarat'],
  site: 'Mandvi',

  // MOVED TO WTG-Mandvi, 2026-09-04 (app owner). SO mapping no longer happens in
  // PULSE at all: it lives in DRS now, and PULSE syncs project/work-location
  // configuration from there. The app owner located an already-SO-mapped WTG work
  // location on QA via DRS, and it is Mandvi, not Khavda.
  //
  // DRS reference: project "Mandvi (WTG-Mandvi)", Configuration ->
  // 4. SO Configuration, package Civil.
  workLocations: ['WTG-Mandvi'],

  // THE SEVEN WORK AREAS MAPPED IN DRS for WTG-Mandvi / Civil, verbatim from the
  // SO Configuration matrix (app owner screenshot, 2026-09-04). The DRS filter
  // read "MNP29 x  +6 more" and the matrix rendered exactly seven columns, so this
  // is the COMPLETE set, not a visible subset of a longer one.
  //
  // NOTE THE NAMING BREAK FROM KHAVDA. Khavda's areas always contained a space
  // ("KH 34", "WTG 423"). Mandvi's do not, use mixed prefixes, and one is
  // hyphenated: MNP29, MP-P1, MP561. Any lookup that assumed a space or a plain
  // numeric tail does not apply here.
  workAreas: [
    'MNP29', 'MP-P1', 'MP561', 'MP611', 'MP738', 'MP758', 'MP763',
  ],
  primaryWorkArea: 'MNP29',

  // Wind runs DESKTOP ONLY (app owner, 2026-09-03). Mobile is already covered by
  // solar, and solar can absorb the reruns that mobile-layout debugging costs
  // whereas every wind attempt spends an irreplaceable checkpoint. Wind's job is
  // to prove the flow is not solar-specific, which is a PROJECT-TYPE axis, not a
  // viewport one.
  viewports: ['desktop'],

  // PREFERENCE ORDER, not an exclusive assignment: the flow stage walks its own
  // list first and then falls through to any UNCLAIMED area, so a pool whose
  // areas are spent still finds ground instead of failing outright.
  //
  // ONE WORK AREA PER TC is what wind needs, because it enforces the
  // preceding-checkpoint rule: within a single area, checkpoint N+1 is blocked
  // until N is approved, so nine TCs created up front on one area would mostly
  // sit blocked. Nine on nine different areas all sit at checkpoint A1.18.1.
  //
  // *** ONLY SIX AREAS ARE USABLE FOR A CRANE PAD RFI, against nine TCs. This is
  // *** an open constraint, not a solved allocation. See
  // *** docs/app-owner-decisions-and-conventions.md.
  //
  // AND IT IS A MAPPING LIMIT, NOT A DATA LIMIT. Per
  // docs/work-region-hierarchy.md Appendix B, WTG-Mandvi actually holds 69 work
  // areas (MP{n} x66, MNP{n} x2, MP-P{n} x1). The seven below are simply the ones
  // SO-mapped in DRS, and a CI can only raise against mapped ground. Mapping more
  // is deferred (app owner: DRS can host pilot projects and work sections to
  // order, but that is "a different big journey").
  //
  // Seven areas are mapped, and DRS shows "1. Crane Pad" UNMAPPED on MP763 (its cell
  // reads "Select SO" while every other activity/area pair holds GODARA). So a
  // Crane Pad RFI has SIX usable areas, not nine, and a 9-TC pass cannot give
  // each TC its own.
  //
  // MP763 is therefore parked for NC, which uses a different activity and so does
  // not care that Crane Pad is unmapped there. That keeps the RFI and NC pools
  // disjoint, which rule R2 requires: a non-approved NC blocks RFI on the same
  // (checkpoint, work section), and on wind the section IS the area.
  flowWorkAreas: {
    rfi: {
      desktop: ['MNP29', 'MP-P1', 'MP561', 'MP611', 'MP738', 'MP758'],
    },
    nc: {
      desktop: ['MP763'],
    },
  },

  // SO DEMAPPING IS NO LONGER A PULSE CONCERN (app owner, 2026-09-04): SO mapping
  // moved to DRS, so there is no PULSE screen left to demap on. Null rather than
  // deleted, so requireField() fails loudly if anything still asks for it.
  demapWorkArea: null,

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
    // GODARA, per the app owner 2026-09-04: this is what DRS has mapped across the
    // WTG-Mandvi / Civil matrix. Replaces BAUER, which belonged to Khavda.
    // Category assumed to stay "Service Contractor" (the kind used for both the
    // WTG CI and CM); not separately re-confirmed for GODARA.
    category: 'Service Contractor',
    name: 'GODARA INFRATECH PVT LTD',

    // MUST be the full "<number> - <name>" string. CONFIRMED live: the
    // Service Order dropdown holds 137 options and BAUER ENGINEERING INDIA
    // PVT LTD appears under FIVE different SO numbers — 5710008038,
    // 5710009696, 5710012136, 5710017100, 5710018312. A vendor-name-only
    // match resolves to 5710008038, i.e. the WRONG service order. The app
    // owner specified 5710012136.
    // The exact SO the app owner confirmed for WTG-Mandvi (2026-09-04).
    //
    // WATCH THE DASH: DRS renders it with an EN DASH ("5710017045 <en dash>
    // GODARA...") while PULSE's own dropdowns have used a plain hyphen. The
    // hyphen form is used here because that is what the PULSE selectors and
    // SOMappingPage's "<number> - <NAME>" guard expect. If a live lookup misses
    // this string, check the dash character first.
    serviceOrder: '5710017045 - GODARA INFRATECH PVT LTD',
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
    workLocation: 'WTG-Mandvi',
    workArea: 'MNP29',
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

    // MULTI-ACTIVITY, and this is the fix for what looked like an area shortage.
    //
    // The chain used to be Crane Pad's five checkpoints alone, which meant every
    // TC competed for the SAME (activity, checkpoint) pair and so needed its OWN
    // work area. With one Work Section per area on wind, nine TCs then wanted nine
    // areas and only six had Crane Pad mapped — which read as "we need DRS to map
    // more areas". It was not a ground problem at all: it was this list being one
    // activity long.
    //
    // App owner: consumption is per (activity/checkpoint, work section), so
    // changing the ACTIVITY on the same work area re-exposes that area's section.
    // So capacity is areas x independent-checkpoints, not areas.
    //
    // THE FIVE INDEPENDENT STARTING CHECKPOINTS, taken from the activity master
    // (wind-activity-checklist.json) by filtering CIVIL rows to preceding === '-'.
    // Five of 96 Civil rows have no predecessor, so these five are raisable on a
    // fresh work area with nothing approved first. 6 areas x 5 = 30 pairs, which
    // covers a 9-TC pass three times over.
    //
    // LABELS: activity names carry a numeric prefix as DRS renders them
    // ("1. Stone Column Installation"). Crane Pad's prefix was live-confirmed in
    // PULSE; the other four are DRS-observed and PULSE-UNCONFIRMED. Sub-activity
    // is passed BARE ("Pre-Activity Work") because RFICreatePage.selectOption does
    // a substring match and that dropdown is already scoped by the chosen
    // activity, so the prefix is unnecessary there and one less thing to get wrong.
    //
    // CHECKLIST: the master records "-" for all five, and Crane Pad's "-" was
    // live-confirmed to render as "Documents and report information" with no
    // observation rows. The other four are assumed to follow the same mapping —
    // expectObservations: false covers the no-rows case either way.
    checkpointChain: [
      { code: 'A1.1.1',  subPackage: 'Stone Column',            activity: '1. Stone Column Installation', subActivity: 'Pre-Activity Work',     checkpoint: 'Pre-Activity Checkpoint', checklist: 'Documents and report information', expectObservations: false },
      { code: 'A1.14.1', subPackage: 'USS Civil and Structural', activity: '1. DT',                        subActivity: 'Pre-Activity Work',     checkpoint: 'Pre-Activity Checkpoint', checklist: 'Documents and report information', expectObservations: false },
      { code: 'A1.15.1', subPackage: 'USS Civil and Structural', activity: '2. HT Foundation',             subActivity: 'Pre-Activity Work',     checkpoint: 'Pre-Activity Checkpoint', checklist: 'Documents and report information', expectObservations: false },
      { code: 'A1.16.1', subPackage: 'USS Civil and Structural', activity: '3. Burnt Oil Tank',            subActivity: 'Pre-Activity Work',     checkpoint: 'Pre-Activity Checkpoint', checklist: 'Documents and report information', expectObservations: false },
      { code: 'A1.18.1', subPackage: 'Crane Pad',                activity: '1. Crane Pad',                 subActivity: '1.1 Pre-Activity Work', checkpoint: 'Pre-Activity Checkpoint', checklist: 'Documents and report information', expectObservations: false },

      // Crane Pad's deeper checkpoints, kept as fallback. Each becomes raisable
      // only once the one before it is APPROVED on that area, so they are listed
      // after every independent start rather than mixed in.
      { code: 'A1.18.2', subPackage: 'Crane Pad', activity: '1. Crane Pad', subActivity: '1.2 OGL',                checkpoint: 'Pre-Inspection',           checklist: 'OGL Checklist' },
      { code: 'A1.18.3', subPackage: 'Crane Pad', activity: '1. Crane Pad', subActivity: '1.3 Boulder laying',     checkpoint: 'Routine Inspection',       checklist: 'Boulder Laying Checklist' },
      // NOTE: the app offers "GSB Inspection Checklist" here while the master says
      // "GSB Laying Checklist" (that name belongs to A1.13.4). The app's string wins.
      { code: 'A1.18.4', subPackage: 'Crane Pad', activity: '1. Crane Pad', subActivity: '1.4 GSB laying',         checkpoint: 'Final Inspection',         checklist: 'GSB Inspection Checklist' },
      { code: 'A1.18.5', subPackage: 'Crane Pad', activity: '1. Crane Pad', subActivity: '1.5 Post-Activity Work', checkpoint: 'Post-Activity Checkpoint', checklist: 'Documents and report information', expectObservations: false },
    ],
  },

  // NOT YET CONFIRMED — the NC create form has not been opened for wind at all.
  // Deliberately null so anything that needs it fails loudly.
  nc: null,

  // DELIBERATELY NULL, same reasoning: the app owner parked WTG RFI work
  // entirely (2026-09-02, "dropping the idea of testing wtg rfi flow ... no need
  // WTG as of now") because of already-raised RFIs on the scarce
  // one-per-work-area ground, and SM07's dependency chain needs to CREATE new
  // RFIs. Fails loudly (expect(...).toBeTruthy() in SM07) rather than skipping,
  // matching how `nc: null` is handled above.
  dependencyChain: null,

  // Parked with the rest of wind's RFI/NC work. SM28 fails loudly on a null
  // here rather than skipping, the same way SM06 does on `nc: null`.
  ncBlock: null,

  // Wind is PARKED (app owner, 2026-09-02: "no need WTG as of now"), and the
  // feature-depth replicas are solar-only for the same reason SM07's dependency
  // chain is: every wind attempt spends an irreplaceable work section
  // (workSectionGranularity: 'one-per-work-area'), so a thirteen-stage feature
  // sweep would exhaust WTG ground with no way to reset it. The SM10+ stages
  // guard on this being non-null and fail loudly rather than skipping quietly —
  // the same pattern SM06 uses for `nc: null`.
  featureGround: null,
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
  //
  // BL07 was added 2026-09-04 for SM07 (the smoke replica of the activity
  // dependency chain, replacing .env CI/EE/QI — see dependencyChain below).
  //
  // CORRECTED 2026-09-04 (adversarial review of the SM07/SM08 additions): the
  // area originally reads "must be its own, not a reuse of BL06, because SM04's
  // hierarchy cascade would evict the smoke flow's CI/QI from BL06's
  // single-assignee row." That specific mechanism does NOT hold — SM04's
  // cascade re-targets BL06 with the SAME CI/QI accounts resolveSmokeUsers()
  // already resolves for SM03 (one fixed fixture entry per profile+role, reused
  // identically everywhere), so it is a self-reassignment/no-op
  // (WAMPage.assignUserIfNeeded() short-circuits when the row already holds
  // that exact name), never an eviction of a different identity. BL07 stays
  // dedicated anyway, for a real reason: resolveFlowWorkAreas()'s fallthrough
  // pool must never be able to land an RFI on the same ground SM07's dependency
  // assertions depend on (see that function's own dependencyChain.workArea
  // exclusion below) — genuine ground isolation, not eviction-avoidance.
  workAreas: ['BL03', 'BL04', 'BL05', 'BL06', 'BL07'],
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
    // REVERTED TO BL05, 2026-09-06 (app owner: "if anything is pending and will
    // be fixed if we change work Area to BL05 then do").
    //
    // These pointed at BL03 from 2026-09-05 because Vendor Name would not
    // populate on BL05 during NC create. That was measured on 2026-09-06 and it
    // is pulse-test DATA, not app behaviour: the same probe
    // (tests/specs/inspection/00_inspect_nc_vendor_by_work_area.spec.js) returns
    // a vendor on BL03-BL07 and BL10-BL12 on pulse-qa, and on BL03 only on
    // pulse-test. The chain runs on qa, so the workaround has served its purpose.
    //
    // WHY REVERTING MATTERS rather than being cosmetic: BL03 is the RFI desktop
    // flow area, and rule R2 exists precisely so NC ground is DISJOINT from RFI
    // ground — a non-approved NC blocks RFI create/resubmit on the same triple
    // (now proven live by SM28). Sharing BL03 meant relying on R2a's narrowness
    // and on flow ordering to avoid a collision. BL05 removes the possibility
    // instead of managing it.
    //
    // Both viewports still SHARE BL05, deliberately and unchanged: NC consumes
    // no work sections and duplicate NCs against identical details are legal, so
    // a second area would buy nothing. What matters is that BL05 is disjoint
    // from the RFI areas.
    //
    // NOTE FOR pulse-test: this is now qa-specific. tests/config/projects.js has
    // no environment dimension for ground, so a pulse-test run needs BL03 back
    // (or a per-environment ground layer) — see the 2026-09-06 correction entry
    // in docs/smoke-e2e-framework.md.
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
    // REVERTED TO BL05, 2026-09-06 — see the fuller note at flowWorkAreas.nc
    // above. The BL05 vendor gap was measured to be pulse-test data, not app
    // behaviour; BL05 populates its vendor correctly on pulse-qa.
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

  // SM07's ground: the checkpoint-dependency chain, replicated from the proven
  // A-06c/BL09 reference data in rfi-dependency-data.js (PILING_ACTIVITY_CHAINS'
  // "Piling - MMS" entry) onto S05b/BL07 so it can run as the smoke CI/EE/QI
  // instead of the .env accounts — see the header comment on BL07 in workAreas
  // above for why it needs its OWN area rather than reusing demapWorkArea.
  //
  // Shape matches runDependencyChainForActivity's `activityChain` param exactly
  // (top-level fields shared by every checkpoint, plus a `checkpoints` array of
  // {name, checklist}) — NOT profile.rfi's checkpointChain shape, which is a
  // different consumer (rfi-smoke-walk.js) with different field names.
  //
  // CONFIRMED vs ASSUMED, same distinction as the nc block above:
  //   * checkpoint[0] ("Pre Pour Inspection - Pile" / "Micro Pile Checklist") is
  //     CONFIRMED on S05b — it's the exact combination profile.rfi already drives
  //     through SM05, which has passed 9/9 on this band.
  //   * checkpoint[1]/[2] are carried over from the A-06c/BL09 reference data and
  //     NOT yet confirmed under S05b. Solar activities are confirmed present
  //     under every BL{nn} area (app owner), but the per-checkpoint checklist
  //     name has only been observed live on A-06c. Fails loudly at the checklist
  //     dropdown on first run if either name doesn't exist here — see
  //     fillPageOne/RFICreatePage.fillForm for that failure mode.
  //
  // Re-runnable indefinitely, same reasoning as profile.rfi: solar's ~490
  // sections per (work area, checkpoint) mean checkpoint[0]'s "pick the first
  // available" never runs dry, so this chain does not need its own tracker or
  // work-area rotation — it mirrors spec 29's fixed-Work-Area model exactly.
  dependencyChain: {
    label: 'Piling - MMS (dependency check)',
    workLocation: 'S05b',
    workArea: 'BL07',
    package: 'Civil',
    subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
    activity: 'Piling - MMS',
    subActivity: 'Piling - MMS',
    checkpoints: [
      { name: 'Pre Pour Inspection - Pile', checklist: 'Micro Pile Checklist' },
      { name: 'Pre Pour Inspection - Pile Cap', checklist: 'Micro Pile Cap Checklist' },
      { name: 'Post Pour Inspection', checklist: 'Post Pour Check' },
    ],
  },

  // SM28's ground truth: ONE (activity, sub-activity, checkpoint) combination
  // driven from BOTH sides — QI raises an NC on it, then CI tries to raise an
  // RFI on it — to prove rule R2a (a non-approved NC blocks RFI create/resubmit
  // for the same triple). See docs/smoke-e2e-framework.md R2a and
  // docs/app-owner-decisions-and-conventions.md §3.2.
  //
  // WHY ITS OWN BLOCK rather than reusing profile.rfi + profile.nc: those two
  // deliberately name DIFFERENT activities (`Piling - MMS` vs `Piling - Robotic
  // Docking System`) precisely so the flows never block each other. R2a is keyed
  // on the activity, so a test built from them would raise an NC on one activity
  // and an RFI on another — a triple that has never matched, and it would "pass"
  // by proving nothing. The whole point here is that both sides name the SAME
  // activity, so it is stated once, explicitly.
  //
  // CONFIRMED vs ASSUMED, the usual convention:
  //   * activity / subActivity / checkpoint / checklist are CONFIRMED on S05b —
  //     they are exactly what profile.rfi drives and SM05 has passed 9/9 with.
  //   * That `Piling - MMS` also appears in the NC form's Activity dropdown is
  //     ASSUMED. Every NC this suite has ever created used `Piling - Robotic
  //     Docking System`, so the MMS activity has never been selected there. Both
  //     are Civil activities for the same vendor, so it is likely — and if it is
  //     wrong this fails loudly at the Activity dropdown, which is a one-line fix
  //     here rather than a mystery.
  //   * otherSubActivity drives a REPORTED-ONLY probe of R2a's second half (the
  //     same work section under a different activity should NOT be blocked). It
  //     is not asserted, because whether the two activities even share a work
  //     section inventory is unconfirmed.
  ncBlock: {
    workLocation: 'S05b',
    workArea: 'BL06',
    package: 'Civil',
    subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
    activity: 'Piling - MMS',
    subActivity: 'Piling - MMS',
    checkpoint: 'Pre Pour Inspection - Pile',
    checklist: 'Micro Pile Checklist',

    // NC-side-only fields, same proven values as profile.nc.
    vendorName: 'CHOUHAN',
    ncQuantity: 2,
    unit: 'EA',
    defectType: 'Workmanship defect',
    category: 'Critical',
    targetDateClosureDays: 14,

    // ONE work section, not profile.nc's two: the test has to name the exact
    // section the block should apply to, and a second one only widens the
    // blast radius on shared ground for nothing.
    workSectionCount: 1,

    // For the reported-only "different activity, same section" probe.
    otherActivity: 'Piling - Robotic Docking System',
    otherSubActivity: 'Piling - Robotic Docking System',
  },

  // ---------------------------------------------------------------------------
  // FEATURE-DEPTH GROUND (SM10+) — app owner, 2026-09-04
  // ---------------------------------------------------------------------------
  // "add all, don't take reference of specs from specs folder, add all required
  // specs in smoke itself ... nothing depends outside and all dependency are
  // configured independently."
  //
  // The thirteen feature stages that used to run out of tests/specs/ are being
  // replicated into tests/smoke/, and every one of them needed ground it does
  // not own. Three collisions had to be resolved, and none of them were cosmetic:
  //
  //   1. A-06c. Hardcoded by 06, 07, 19, 25, 26, 27 and 28 — and A-06c is the app
  //      owner's MANUAL testing ground, which workLocations above says smoke must
  //      never touch. Every replica moves to S05b.
  //
  //   2. S05b/BL01-BL05. 13_wam_all_roles sweeps exactly that band, which overlaps
  //      BL01 (02_rfi_ci), BL02 (the tracked 9-TC regression) AND the smoke flow
  //      areas BL03/BL04/BL05. Because WAM's Contractor Incharge and Quality
  //      Inspector rows are SINGLE-ASSIGNEE, a sweep there EVICTS whoever held the
  //      row — so replicating it as-is would silently unmap the smoke flow users
  //      from their own flow ground.
  //
  //   3. Destructive stages. 25/26/27/28 clear and re-point BL01. Pointed at any
  //      shared row that is a timebomb for every other stage; pointed at ground
  //      nothing else uses it is harmless, which is why wamMutate is its own area
  //      rather than a reuse of demapWorkArea.
  //
  // Isolating the destructive stages onto their own area has a second payoff that
  // is the whole reason "68 did not run" happened: it removes the need to ORDER
  // the feature stages relative to each other, so they can be emitted as
  // independent sibling leaves instead of one linear chain where a single failure
  // skips everything downstream. See smokeChain() in playwright.config.js.
  //
  // BL08-BL14 ARE CONFIRMED PRESENT. App owner, 2026-09-04: "BL08–BL14 have
  // never been touched — all blocks are present dont worry ... SO is mapped
  // proerly in S05b whole work location so dont worry about SO mappping
  // prerequisite."
  //
  // Two things that removes:
  //   * the areas exist, so a stage pointed at one will find its row;
  //   * the Service Order is mapped across the WHOLE of S05b, so the vendor
  //     roles' SO gate (SM12, and the CI/CM rows in SM13/SM19/SM22) is
  //     satisfied for every area here — there is no per-area SO-mapping
  //     prerequisite to provision first. That matters because SO mapping moved
  //     to DRS and there is no PULSE screen left to do it from: if it were
  //     missing for an area, no work area would be assignable for a vendor role
  //     and nothing in this suite could fix it.
  //
  // A MISSING AREA FAILS LOUDLY, deliberately. An earlier version of this
  // comment claimed the names were "a preference, not an assumption" and
  // described a resolveFeatureWorkAreas() that would fall back to the next
  // unclaimed area — that function was never written, so the comment was simply
  // wrong. It is not being written now either, because silent substitution is
  // the wrong behaviour: the entire point of this block is that each stage owns
  // ground nothing else touches, and an area quietly swapped for "the next
  // free one" could land a mutating stage on a flow area. Failing at the Work
  // Area row names the missing area and is a one-line fix here.
  featureGround: {
    // SM11 (WAM basics), SM12 (WAM CI + Service Order gate), SM13 (all roles).
    // DELIBERATELY NOT pre-mapped by SM03: proving Admin can assign here IS the
    // coverage, and a row SM03 already filled would only ever return
    // changed=false and assert the no-change toast instead.
    wamSweep: ['BL08', 'BL09'],

    // SM19-SM22 (patch/update + demapping, both Admin and hierarchy tiers).
    // Seeded by SM03 so there is a known baseline to mutate, and so "restore the
    // SM01 user afterwards" has an unambiguous target — the app owner's explicit
    // requirement: "after checking creation mapping demapping old SM01 users
    // should be restored".
    wamMutate: 'BL10',

    // SM23 (single RFI create) and SM24 (bulk create on one area). Both consume
    // work sections, which is free here: ~264-490 sections per area, versus the
    // handful a run spends.
    rfiCreate: 'BL11',

    // SM25 (the 20_rfi_bulk_create_multi_location replica). That spec's name is
    // misleading — all seven of its entries are ONE work location (A-06c) and
    // seven different work AREAS, so no second work location is needed and
    // workLocations above stays a single entry. Scaled 7 -> 3 areas: the
    // behaviour under test is "one RFI per area in a single pass", which three
    // proves as well as seven at under half the ground cost.
    rfiBulkAreas: ['BL12', 'BL13', 'BL14'],

    // SM26 (the 14_nc_create_qi replica) SHARES the NC flow area rather than
    // taking its own. Safe for exactly one reason, and it does not generalise to
    // RFI: an NC consumes nothing (duplicate NCs against identical details are
    // legal), and BL05 is already NC-only, so a second NC there cannot strand
    // anything. Putting it on an RFI area would be the opposite — a non-approved
    // NC BLOCKS RFI create/resubmit for the same (checkpoint, work section).
    // SM28 (the NC-blocks-RFI rule, R2a) — see the ncBlock data block below.
    //
    // BL06, and it MUST be an area no RFI/NC flow uses, because this stage
    // deliberately leaves a NON-APPROVED NC behind: that is the precondition
    // the rule is about, so it cannot be cleaned up without destroying what
    // the next run needs to re-prove.
    //
    // BL06 is the right area rather than a new one, for three reasons:
    //   * It is ALREADY PROVISIONED. It sits in profile.workAreas, so SM03
    //     maps the flow users onto it every run and SM27 restores that — the
    //     CI and QI can both see it without any new setup. A brand-new area
    //     (BL15+) is not confirmed to exist; the app owner confirmed
    //     BL08-BL14 only.
    //   * It is ALREADY CLAIMED. resolveFlowWorkAreas() adds demapWorkArea to
    //     its `claimed` set, so BL06 can never leak into the RFI/NC
    //     fallthrough pool — exactly the isolation this stage needs, already
    //     in place. (That leak is a real bug that happened to BL07 on
    //     2026-09-04.)
    //   * It is FREE. BL06 was the SO-demapping sacrificial area, and SO
    //     mapping moved to DRS, so nothing raises an RFI or NC there any
    //     more. SM04's hierarchy cascade also assigns onto BL06, but that is
    //     WAM only — it creates no RFI/NC and cannot collide with this.
    //
    // NOT a collision with 20_rfi_bulk_create_multi_location.spec.js, which
    // also names BL06: that spec's BL06 is under work location A-06c, not
    // S05b, and they are different work areas that happen to share a label.
    ncBlock: 'BL06',

    // REVERTED TO BL05, 2026-09-06 — see flowWorkAreas.nc above.
    //
    // The risk here is REAL BUT NARROW — narrower than the R2 note directly
    // above implies, and narrower than an earlier version of this comment
    // claimed. See rule R2a in docs/smoke-e2e-framework.md (app owner,
    // 2026-09-05) for the precise scope, which is worth knowing before
    // treating this as scary:
    //
    //   - The block is keyed on the FULL (activity/sub-activity, checkpoint,
    //     work section) triple — NOT on the work area. An NC does not poison
    //     BL03; it locks exactly one triple.
    //   - NC creation takes the FIRST available work section, and on ground
    //     the RFI flow has already run over, that section is one RFI has
    //     already CONSUMED (R1) and could never reuse regardless. Blocking
    //     something already unavailable costs nothing.
    //   - A different work section, or a different activity, is unaffected.
    //
    // The one case that genuinely bites is an NC on a triple whose RFI has not
    // been raised yet, or still needs resubmitting. The chain's ordering
    // already avoids it: RFI flows run BEFORE NC flows, so the RFI work on
    // this ground is finished and approved before any NC exists.
    //
    // Still reverted to BL05 once the vendor bug is fixed, because "narrow
    // risk that the ordering happens to avoid" is a worse guarantee than
    // "disjoint ground that cannot collide at all".
    ncCreate: 'BL05',
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
  // Same reasoning as demapWorkArea: SM07's dependency chain needs its OWN area
  // never touched by anything else (see its workArea comment in SOLAR_E2E
  // above) — without this line BL07 was neither `preferred` nor `claimed`, so
  // it fell into `spare` and leaked into the RFI flow's fallthrough pool
  // (found live 2026-09-04: resolveFlowWorkAreas(SOLAR_E2E, {flow:'rfi',
  // viewport:'desktop'}) returned ['BL03','BL07'] instead of ['BL03']). A
  // second RFI stage falling onto BL07 would compete with SM07 for the exact
  // (checkpoint, Work Section) pairs its dependency assertions depend on.
  if (profile.dependencyChain && profile.dependencyChain.workArea) {
    claimed.add(profile.dependencyChain.workArea);
  }

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

// ---------------------------------------------------------------------------
// FEATURE-DEPTH GROUND ACCESSORS (SM10+)
// ---------------------------------------------------------------------------
// These live here, next to resolveFlowWorkAreas, for the same reason it does:
// this file owns the shape, so thirteen replica stages cannot each invent their
// own reading of it and drift apart.

// Fails loudly for a profile with no feature ground, naming what to do about it.
// The SM10+ stages call this in beforeAll rather than test.skip()ing, so a wind
// run reports a real failure instead of a quiet green — the same choice SM06
// makes for `nc: null`.
function requireFeatureGround(profile) {
  if (!profile.featureGround) {
    throw new Error(
      `Profile "${profile.key}" has no featureGround, so the feature-depth (SM10+) ` +
      `stages have nowhere to run. This is deliberate for the wind and regression ` +
      `profiles — see featureGround in tests/config/projects.js. Run these stages ` +
      `against a profile that declares one (currently: solar-e2e).`
    );
  }
  return profile.featureGround;
}

// Every work area the feature stages touch, flattened and de-duplicated.
//
// NOT added to profile.workAreas, and that is load-bearing: resolveFlowWorkAreas
// builds its fallthrough pool from workAreas minus a `claimed` set, so anything
// listed there that it does not know to claim leaks into the RFI/NC fallthrough
// pool. That is exactly the BL07 bug found live on 2026-09-04. Keeping feature
// ground in its own block means it can never leak, without needing a matching
// claim line for each new area.
function featureWorkAreas(profile) {
  const g = profile.featureGround;
  if (!g) return [];
  const out = [];
  const add = (v) => {
    if (!v) return;
    (Array.isArray(v) ? v : [v]).filter(Boolean).forEach((a) => {
      if (!out.includes(a)) out.push(a);
    });
  };
  add(g.wamSweep);
  add(g.wamMutate);
  add(g.rfiCreate);
  add(g.rfiBulkAreas);
  add(g.ncCreate);
  // BL06 for solar. Harmless here even though it is ALSO in
  // profile.workAreas — smokeMappedWorkAreas() de-duplicates against the
  // flow list, so it does not produce a second mapping pass. Listed so
  // this function keeps answering its actual question truthfully: which
  // work areas the feature tier touches.
  add(g.ncBlock);
  return out;
}

// The work areas SM03 assigns the flow users to: the flow areas plus the feature
// areas that need flow-role ACCESS to be usable.
//
// App owner, 2026-09-04: "SM03 I have knowingly kept on top because user stored
// in json of smoke (be it newly created/existing ones) will only get their
// access if they are mapped." A created user with no WAM row cannot see a work
// area at all, so any area an SM10+ stage raises an RFI on has to be mapped here
// or that stage fails at the Work Area dropdown with nothing to explain why.
//
// TWO DELIBERATE EXCLUSIONS:
//   * wamSweep — SM11/SM12/SM13 assigning there IS their coverage. Pre-filling
//     the rows would leave assignUserIfNeeded() with nothing to change, so those
//     stages would only ever assert the "No changes to save" path.
//   * ncCreate — it shares BL05, which is already a flow area, so it is covered
//     by profile.workAreas and adding it again would be a no-op.
function smokeMappedWorkAreas(profile) {
  const flow = (profile.workAreas || []).filter(Boolean).length
    ? profile.workAreas.filter(Boolean)
    : [profile.primaryWorkArea].filter(Boolean);
  const g = profile.featureGround;
  if (!g) return flow;

  const sweep = new Set((g.wamSweep || []).filter(Boolean));
  const extra = featureWorkAreas(profile)
    .filter((a) => !sweep.has(a) && !flow.includes(a));
  return [...flow, ...extra];
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
  requireFeatureGround, featureWorkAreas, smokeMappedWorkAreas,
  SOLAR_REGRESSION, SOLAR_E2E, WIND_E2E,
  CLUSTER_CANDIDATES, SITE,
};
