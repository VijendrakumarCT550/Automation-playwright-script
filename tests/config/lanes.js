// PARALLEL LANES for the smoke chain.
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
// The solar chain is ~2 hours at --workers=1, and every gap closed from
// docs/automation-coverage-and-gaps.md (G-01..G-26) adds to it. Left alone it
// only grows, and a suite nobody can afford to run is a suite that stops being
// run.
//
// ---------------------------------------------------------------------------
// WHY NOT JUST --workers=N
// ---------------------------------------------------------------------------
// Because you cannot say WHICH stages run together. Playwright hands test files
// to whichever worker is free, so raising the worker count would let
// SM19 (mutates BL10) and SM22 (mutates BL10) run at the same moment, or land
// SM14 before the stages that create the pending RFIs it needs. This suite's
// safety has never come from the worker count — it comes from which stages are
// allowed to overlap, and that has to be DECLARED.
//
// So a lane is one `playwright test` process with an explicit --project list and
// --workers=1 inside it. Order within a lane is preserved exactly as today;
// lanes run concurrently with each other.
//
// ---------------------------------------------------------------------------
// THE ONE RULE THAT MAKES IT SAFE
// ---------------------------------------------------------------------------
// App owner, 2026-09-06: *"admin/any other users can hold as many session as
// much we want, there is no restriction as of now."* That removes the identity
// question entirely — two lanes may both drive Admin, or both drive the smoke
// CI.
//
// What is left is GROUND. Two stages may sit in different lanes only if they
// touch no work area in common, and neither consumes what the other produces.
// That is not a comment to be trusted: assertLanesAreDisjoint() below resolves
// every stage's ground against the live profile and throws if two lanes
// overlap, so adding a stage without thinking about it fails immediately
// instead of producing a run that is subtly wrong.
//
// ---------------------------------------------------------------------------
// AND THE ONE THAT IS NOT ABOUT GROUND
// ---------------------------------------------------------------------------
// App owner, 2026-09-06: *"Keep every user-creating stage in one lane — do this
// also as it seems important."*
//
// fixtures/user-creation-counter.json and fixtures/last-created-users.json are
// read-modify-WRITE (user-counter-utils.js). Two lanes creating users at the
// same moment would interleave read/write and lose entries — and a lost user
// entry does not fail where it happens, it fails much later in whatever stage
// tries to log in as the user that was silently dropped. USER_CREATING_STAGES
// records which stages write those files, and the validator enforces that they
// all sit in one place. SM01 is in the serial prefix and SM10 rides in a single
// lane, so today the rule costs nothing — it is enforced so that it keeps
// costing nothing.
const { requireFeatureGround, resolveFlowWorkAreas } = require('./projects');

// ---------------------------------------------------------------------------
// GROUND EACH STAGE MUTATES, declared SYMBOLICALLY
// ---------------------------------------------------------------------------
// Symbolic, not literal work-area names, so this can never drift from
// tests/config/projects.js — and that paid off immediately. When NC ground moved
// from BL03 back to BL05 on 2026-09-06, the validator recomputed every lane's
// ground on its own and NOT ONE LINE of this table needed editing. A table of
// literal area names would have had to be found and updated by hand, and the
// failure mode for missing one is a parallel run on shared ground.
//
// A stage with `ground: []` touches no work area (dashboards, menu sweeps,
// read-only role sweeps) and can therefore sit in any lane.
//
// `global` means the stage reads or asserts across EVERY mapped area — SM27
// re-asserts the whole SM01/SM03 baseline. A global stage can never share a run
// window with anything that mutates, which is why it lives in the epilogue
// rather than in a lane.
const STAGE_GROUND = {
  // --- setup prefix ---
  'users':            [],                      // creates users; no work area
  'wam':              ['global'],              // maps the flow users across every area

  // --- flow ground ---
  'draft-autosave':   [{ flow: 'rfi', viewport: 'desktop' }],
  'rfi-desktop':      [{ flow: 'rfi', viewport: 'desktop' }],
  'rfi-mobile':       [{ flow: 'rfi', viewport: 'mobile' }],
  'nc-desktop':       [{ flow: 'nc',  viewport: 'desktop' }],
  'nc-mobile':        [{ flow: 'nc',  viewport: 'mobile' }],
  'data-integrity':   [{ flow: 'rfi', viewport: 'desktop' }],
  'dependency':       ['dependencyChain'],
  'nc-create':        ['featureGround.ncCreate'],

  // --- WAM depth + the areas SM04 / SM28 use ---
  'users-batch':      [],                      // creates a throwaway batch; no work area
  'wam-basics':       ['featureGround.wamSweep'],
  'wam-ci':           ['featureGround.wamSweep'],
  'wam-all-roles':    ['featureGround.wamSweep'],
  'wam-hierarchy':    ['demapWorkArea'],
  'nc-block':         ['featureGround.ncBlock'],
  'wam-patch':        ['featureGround.wamMutate'],
  'wam-patch-hier':   ['featureGround.wamMutate'],
  'wam-demap':        ['featureGround.wamMutate'],
  'wam-demap-hier':   ['featureGround.wamMutate'],

  // --- RFI creation depth ---
  'rfi-create':       ['featureGround.rfiCreate'],
  'rfi-bulk':         ['featureGround.rfiCreate'],
  'rfi-bulk-multi':   ['featureGround.rfiBulkAreas'],

  // --- no ground at all ---
  'dashboard-admin':  [],
  'dashboard-filter': [],
  'hier-dashboard':   [],
  'online-roles':     [],

  // --- epilogue ---
  // Reassign READS whatever pending RFIs/NCs the creation stages left, across
  // several areas — it is a consumer of other stages' output, not an owner of
  // ground. Running it inside a lane would make that a cross-lane race, which
  // is exactly how it failed on 2026-09-05 ("nothing eligible to reassign").
  'reassign':         ['global'],
  'restore':          ['global'],
};

// The stages that WRITE fixtures/user-creation-counter.json and
// fixtures/last-created-users.json. See the header — all of these must end up
// in the same place, and the validator enforces it.
const USER_CREATING_STAGES = ['users', 'users-batch'];

// ---------------------------------------------------------------------------
// THE LANE LAYOUT
// ---------------------------------------------------------------------------
// prefix -> [ lanes, in parallel ] -> epilogue
//
// Balanced by RUNTIME, constrained by ground. Measured/estimated minutes are in
// the comments so the balance can be re-tuned from real numbers rather than
// from feel.
const LAYOUT = {
  // Serial, before any lane. Everything downstream needs the users to exist and
  // to be mapped, and both stages here are global or fixture-writing.
  prefix: ['users', 'wam'],

  lanes: {
    // BL03 + BL07. RFI-only now that NC has its own area again.
    // ~6 + ~17 + ~4 + ~3  =  ~30 min
    'flow-desktop': ['draft-autosave', 'rfi-desktop', 'data-integrity', 'dependency'],

    // BL04.  ~22 min
    'flow-mobile': ['rfi-mobile'],

    // BL05 — ALL the NC stages together, and that grouping is the point.
    //
    // NC deliberately shares ONE area across both viewports (it consumes no
    // work sections and duplicate NCs against identical details are legal), so
    // splitting nc-desktop and nc-mobile across two lanes would put two lanes on
    // BL05 and require a standing overlap exception. Keeping them in one lane
    // makes every lane genuinely disjoint instead, so KNOWN_GROUND_OVERLAPS
    // could be deleted outright rather than kept as a permanent caveat.
    // ~9 + ~9 + ~3  =  ~21 min
    'nc': ['nc-desktop', 'nc-mobile', 'nc-create'],

    // BL08 + BL09 (featureGround.wamSweep), deliberately NOT pre-mapped by SM03
    // — proving Admin can assign there IS this lane's coverage.
    // ~25 min
    'wam-sweep': ['users-batch', 'wam-basics', 'wam-ci', 'wam-all-roles'],

    // BL06 + BL10. Split from wam-sweep because the two touch disjoint ground
    // and together they were the bottleneck of the whole run.
    //
    // ORDER WITHIN THIS LANE IS LOAD-BEARING: wam-hierarchy (SM04) is the
    // cascade that gives the hierarchy tiers their assignments, and
    // wam-patch-hier / wam-demap-hier then log in AS those tiers. They must stay
    // in this lane, in this order — moving SM04 elsewhere would make that a
    // cross-lane race.
    // ~30 min
    'wam-mutate': [
      'wam-hierarchy', 'nc-block',
      'wam-patch', 'wam-patch-hier', 'wam-demap', 'wam-demap-hier',
    ],

    // BL11 + BL12-BL14.  ~15 min
    'creation': ['rfi-create', 'rfi-bulk', 'rfi-bulk-multi'],

    // No ground whatsoever, so this lane can never conflict with anything.
    // MEASURED 2026-09-06: 18.0 min for 43 tests.
    'readonly': ['dashboard-admin', 'dashboard-filter', 'hier-dashboard', 'online-roles'],
  },

  // Serial, after every lane has joined.
  //
  // `reassign` is here because it CONSUMES what the creation stages produce: it
  // can only reassign something still pending, and SM23/24/25/26/28 are spread
  // across three different lanes. Waiting for all of them is the only way it is
  // fed by design rather than by luck.
  //
  // `restore` is here because it re-asserts the SM01/SM03 mapping across EVERY
  // mapped area, so it must not overlap any stage that mutates WAM.
  epilogue: ['reassign', 'restore'],
};

// NO KNOWN OVERLAPS. Every lane's ground is disjoint from every other lane's,
// so no exception list is needed and assertLanesAreDisjoint() has nothing to
// excuse.
//
// This was NOT true until 2026-09-06. flowWorkAreas.nc pointed at BL03 (the RFI
// desktop flow area) because Vendor Name would not populate on BL05 during NC
// create — measured that day to be pulse-test DATA rather than app behaviour,
// and reverted to BL05 for the qa chain. Grouping every NC stage into one lane
// then removed the last overlap, since NC shares one area across both viewports
// by design.
//
// Kept as an empty list rather than deleted: the validator still consults it, and
// a future deliberate-and-safe overlap should be recorded here WITH ITS REASON
// rather than by loosening the check.
const KNOWN_GROUND_OVERLAPS = [];

// Resolves one symbolic ground token to the actual work areas it means.
function resolveGroundToken(profile, token) {
  if (token === 'global') return ['*'];

  if (typeof token === 'object' && token.flow) {
    return resolveFlowWorkAreas(profile, token);
  }

  if (token === 'dependencyChain') {
    return profile.dependencyChain ? [profile.dependencyChain.workArea] : [];
  }
  if (token === 'demapWorkArea') {
    return profile.demapWorkArea ? [profile.demapWorkArea] : [];
  }
  if (typeof token === 'string' && token.startsWith('featureGround.')) {
    const g = requireFeatureGround(profile);
    const value = g[token.slice('featureGround.'.length)];
    if (!value) return [];
    return Array.isArray(value) ? value.filter(Boolean) : [value];
  }

  throw new Error(`lanes.js: unknown ground token ${JSON.stringify(token)}`);
}

// Every work area a lane touches, de-duplicated.
function laneGround(profile, stageIds) {
  const out = new Set();
  for (const id of stageIds) {
    const tokens = STAGE_GROUND[id];
    if (!tokens) {
      throw new Error(
        `lanes.js: stage "${id}" is in the layout but has no STAGE_GROUND entry. ` +
        `Declare what work areas it touches (use [] if none) so the disjointness ` +
        `check can actually check it.`
      );
    }
    for (const token of tokens) {
      for (const area of resolveGroundToken(profile, token)) out.add(area);
    }
  }
  return out;
}

// THE VALIDATOR. Throws rather than warns: a lane layout that overlaps produces
// a run whose failures look like app bugs, and that is far more expensive than
// refusing to start.
//
// `knownProjectIds` (optional) is the set of stage ids the config actually
// produced. Passing it catches the other half of the problem — a stage that
// exists but was never assigned to a lane would otherwise just never run, and
// "nothing should be escaped" is the whole point of the chain.
function assertLanesAreDisjoint(profile, knownProjectIds = null) {
  const problems = [];
  const laneNames = Object.keys(LAYOUT.lanes);

  // 1. No two lanes may share a work area.
  const ground = {};
  for (const name of laneNames) ground[name] = laneGround(profile, LAYOUT.lanes[name]);

  for (let i = 0; i < laneNames.length; i++) {
    for (let j = i + 1; j < laneNames.length; j++) {
      const a = laneNames[i];
      const b = laneNames[j];
      const shared = [...ground[a]].filter((x) => ground[b].has(x));
      if (!shared.length) continue;

      const excused = KNOWN_GROUND_OVERLAPS.find(
        (e) => e.lanes.includes(a) && e.lanes.includes(b)
      );
      if (excused) continue;

      problems.push(
        `lanes "${a}" and "${b}" both touch ${shared.join(', ')}. Running them in ` +
        `parallel would let them mutate the same ground. Either move one stage, ` +
        `give it its own area in profile.featureGround, or — if the overlap is ` +
        `genuinely harmless — add it to KNOWN_GROUND_OVERLAPS with the reason.`
      );
    }
  }

  // 2. A lane may never contain 'global' ground — that is what the epilogue is for.
  for (const name of laneNames) {
    if (ground[name].has('*')) {
      problems.push(
        `lane "${name}" contains a stage declared as 'global' ground, which reads or ` +
        `asserts across EVERY mapped area. Global stages cannot run beside anything ` +
        `that mutates — move it to LAYOUT.epilogue.`
      );
    }
  }

  // 3. Every user-creating stage in one place (app owner, 2026-09-06).
  const homeOf = (stageId) => {
    if (LAYOUT.prefix.includes(stageId)) return 'prefix';
    if (LAYOUT.epilogue.includes(stageId)) return 'epilogue';
    return laneNames.find((n) => LAYOUT.lanes[n].includes(stageId)) || null;
  };
  const creatorHomes = [...new Set(USER_CREATING_STAGES.map(homeOf).filter(Boolean))];
  const concurrentCreatorHomes = creatorHomes.filter((h) => h !== 'prefix' && h !== 'epilogue');
  if (concurrentCreatorHomes.length > 1) {
    problems.push(
      `user-creating stages are spread across ${concurrentCreatorHomes.join(' and ')}. ` +
      `fixtures/user-creation-counter.json and last-created-users.json are ` +
      `read-modify-write, so two lanes creating users concurrently lose entries — and ` +
      `a lost entry fails later, in whatever stage tries to log in as the user that ` +
      `vanished. Put them all in one lane (or in the serial prefix).`
    );
  }

  // 4. Nothing assigned twice, and nothing left unassigned.
  const seen = new Map();
  const all = [...LAYOUT.prefix, ...laneNames.flatMap((n) => LAYOUT.lanes[n]), ...LAYOUT.epilogue];
  for (const id of all) {
    if (seen.has(id)) problems.push(`stage "${id}" is assigned twice (${seen.get(id)} and again later)`);
    seen.set(id, homeOf(id));
  }

  if (knownProjectIds) {
    const missing = [...knownProjectIds].filter((id) => !seen.has(id));
    if (missing.length) {
      problems.push(
        `these stages exist in playwright.config.js but are in no lane, so a laned run ` +
        `would SKIP them entirely: ${missing.join(', ')}. Add them to LAYOUT (and to ` +
        `STAGE_GROUND) — "in one run nothing should be escaped" is the point of the chain.`
      );
    }
    const phantom = [...seen.keys()].filter((id) => !knownProjectIds.has(id));
    if (phantom.length) {
      problems.push(`these stages are in LAYOUT but produce no project: ${phantom.join(', ')}`);
    }
  }

  if (problems.length) {
    throw new Error(
      `Smoke lane layout is not safe to run in parallel:\n  - ${problems.join('\n  - ')}\n` +
      `See tests/config/lanes.js.`
    );
  }

  return { laneNames, ground };
}

// Builds the actual run plan for one chain: the LAYOUT filtered down to the
// stages that chain really produces, then validated.
//
// The filtering matters because the feature tier is solar-only (gated on
// profile.featureGround), so the wind chain legitimately has no `wam-basics`,
// no `reassign` and so on. Without this, every wind run would trip the
// "in LAYOUT but produces no project" check for a dozen stages that were never
// meant to exist there. A lane left with nothing in it is dropped rather than
// spawned as an empty process.
//
// The check that DOES still fire for every chain is the important direction:
// a project that exists and is in no lane would be silently skipped, and
// "in one run nothing should be escaped" is the whole point.
function buildPlan(profile, knownProjectIds) {
  const known = knownProjectIds instanceof Set ? knownProjectIds : new Set(knownProjectIds);
  const keep = (ids) => ids.filter((id) => known.has(id));

  const filtered = {
    prefix: keep(LAYOUT.prefix),
    lanes: {},
    epilogue: keep(LAYOUT.epilogue),
  };
  const dropped = [];
  for (const [name, ids] of Object.entries(LAYOUT.lanes)) {
    const kept = keep(ids);
    if (kept.length) filtered.lanes[name] = kept;
    else dropped.push(name);
  }

  // Validate the FILTERED layout, so phantom stages cannot produce a spurious
  // error, while overlap / global / user-creation / unassigned all still apply.
  const saved = { prefix: LAYOUT.prefix, lanes: LAYOUT.lanes, epilogue: LAYOUT.epilogue };
  try {
    LAYOUT.prefix = filtered.prefix;
    LAYOUT.lanes = filtered.lanes;
    LAYOUT.epilogue = filtered.epilogue;
    assertLanesAreDisjoint(profile, known);
  } finally {
    LAYOUT.prefix = saved.prefix;
    LAYOUT.lanes = saved.lanes;
    LAYOUT.epilogue = saved.epilogue;
  }

  return { ...filtered, droppedLanes: dropped };
}

module.exports = {
  LAYOUT,
  STAGE_GROUND,
  USER_CREATING_STAGES,
  KNOWN_GROUND_OVERLAPS,
  laneGround,
  assertLanesAreDisjoint,
  buildPlan,
};
