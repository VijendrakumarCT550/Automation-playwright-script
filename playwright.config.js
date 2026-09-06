// @ts-check
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');
const { applyEnvironment } = require('./tests/config/environments');
const { getProfile } = require('./tests/config/projects');

// Resolve which PULSE deployment this run targets (PULSE_ENV=dev|test, or the
// raw .env BASE_URL when PULSE_ENV is unset) and write it back into
// process.env.BASE_URL — see tests/config/environments.js on why both that
// and `use.baseURL` below have to agree.
const TARGET_ENV = applyEnvironment();
console.log(`[pulse] target environment: ${TARGET_ENV.key} -> ${TARGET_ENV.baseUrl}`);

// RFI flow spec files — run only via the dependency-chained ci/ee/qi-pass-N
// projects below, never directly under `chromium` (see testIgnore there).
const RFI_FLOW_SPECS = [
  /08_rfi_flow_ci\.spec\.js/,
  /09_rfi_flow_ee\.spec\.js/,
  /10_rfi_flow_qi\.spec\.js/,
];

// NC flow spec files — same dependency-chain reasoning as RFI_FLOW_SPECS
// above, kept as a fully separate chain/tracker per the app owner's
// instruction to never mix NC and RFI automation together.
const NC_FLOW_SPECS = [
  /15_nc_flow_qi\.spec\.js/,
  /16_nc_flow_ci\.spec\.js/,
  /17_nc_flow_ee\.spec\.js/,
];

// Builds one ordered project per smoke stage for a given profile. Stages are
// listed in execution order; each depends on the previous one, so Playwright
// runs them strictly in sequence and skips the rest if an earlier stage fails.
//
// Only stages whose spec file exists are emitted, so the chain can be built up
// incrementally (wind first) without the config referencing files that aren't
// written yet — a missing testMatch would otherwise produce a project that
// silently passes with zero tests and lets later stages run on nothing.
const fs = require('fs');
const pathMod = require('path');

// SETUP stages are Admin-driven data preparation. They run ONCE per profile, at
// a desktop viewport, because Admin's SO Mapping / WAM / Users screens are not
// what the mobile coverage is about — the flows are.
const SMOKE_SETUP_STAGES = [
  { id: 'users', file: 'SM01_user_creation.spec.js' },
  // SM02 (SO mapping) IS DELIBERATELY NOT A STAGE, from 2026-09-04. SO mapping
  // was removed from PULSE and now lives in DRS, which PULSE syncs its project and
  // work-location configuration from — so there is no PULSE screen for it to
  // drive. (The "SO Mapping app bug" recorded a day earlier was this feature being
  // taken out.) The spec file is kept as documentation of how the screen behaved.
  { id: 'wam', file: 'SM03_wam_admin.spec.js' },
];

// FLOW stages run once per VIEWPORT. Per the app owner: the RFI and NC flows
// must both be exercised for each project type in BOTH desktop and smartphone
// views — business logic and flow are identical, only UI visibility and some
// page values differ.
const SMOKE_FLOW_STAGES = [
  { id: 'rfi', file: 'SM05_rfi_flow.spec.js' },
  { id: 'nc', file: 'SM06_nc_flow.spec.js' },
];

// PRE-FLOW stages run once per profile, desktop, AFTER setup but BEFORE the
// flows. Only draft-autosave lives here, and it is here at the app owner's
// direction (2026-09-05): "add all new changes related to RFI autosave in
// smoke spec, and keep it above RFI flow".
//
// It reads well beyond ordering preference. SM09 exercises the CREATE form at
// every depth of its cascade — which is the same form SM05's whole 9-TC flow
// depends on. Proving the form drafts, resumes and submits correctly BEFORE
// the long flow runs means a broken create surfaces in a 6-minute stage
// instead of 20 minutes into the RFI flow, where it would look like a flow
// problem rather than a form problem.
//
// It is NOT in SMOKE_SETUP_STAGES despite running at the same point, because
// setup is defined as Admin-driven data PREPARATION that later stages consume.
// SM09 prepares nothing: it is CI-driven coverage that happens to be worth
// running early. Its own list keeps that distinction honest.
const SMOKE_PRE_FLOW_STAGES = [
  // SM09: draft-autosave replica of 24_rfi_draft_autosave.spec.js — see that
  // file's header comment. Same .env-retirement reasoning as SM07/SM08.
  { id: 'draft-autosave', file: 'SM09_rfi_draft_autosave.spec.js' },
];

// TAIL stages run once per profile, desktop, after the flows.
const SMOKE_TAIL_STAGES = [
  // AFTER the flows, per the app owner: hierarchy-wise mapping is a separate
  // concern from the flows and must not be replayed by every flow run. It used to
  // sit in SMOKE_SETUP_STAGES, which meant it ran BEFORE the flows and — because
  // every flow stage depends on the setup tail — got replayed on each of them.
  { id: 'wam-hierarchy', file: 'SM04_wam_hierarchy.spec.js' },
  { id: 'dependency', file: 'SM07_rfi_activity_dependency.spec.js' },
  // SM08 was originally reserved for SO demapping, which is gone: with SO
  // mapping in DRS there is no PULSE screen left to demap on. The number was
  // reassigned 2026-09-04 to the data-integrity replica (of
  // 23_rfi_data_integrity.spec.js) instead — see that file's header comment.
  { id: 'data-integrity', file: 'SM08_rfi_data_integrity.spec.js' },
  // SM09 (draft-autosave) MOVED OUT of this list on 2026-09-05 — it now runs
  // BEFORE the flows, from SMOKE_PRE_FLOW_STAGES above. See that list's
  // comment for why.
];

// Desktop first, then mobile — deliberately in this order so the desktop path
// (the known-good one) proves the data is sound before the mobile UI is blamed
// for anything.
//
// WHICH of these a chain actually uses is now PER PROFILE (profile.viewports),
// not a global cross-product: solar runs both, wind runs desktop only. Mobile is
// covered once, on solar, because solar never exhausts its work sections and can
// absorb the reruns that mobile-layout debugging costs, whereas every wind
// attempt spends an irreplaceable checkpoint.
// FEATURE-DEPTH STAGES (SM10+): replicas, INSIDE tests/smoke/, of every critical
// spec that used to be pulled in from tests/specs/.
//
// App owner, 2026-09-04: "add all, dont take reference of specs from specs
// folder, add all required specs in smoke itself ... nothing depends outside and
// all dependency are configured independently ... suppose like all specs inside
// spec folder is just for exploration purpose for me ... so in one run I can get
// report of all specs nothing should be escaped."
//
// So tests/specs/ is now EXPLORATION ONLY and no smoke project references it.
// Each replica resolves its users through resolveSmokeUsers() (i.e. whoever SM01
// created for THIS run) and its ground through profile.featureGround, so the
// whole tier is self-contained and the regression tier is untouched.
//
// ---------------------------------------------------------------------------
// WHY THESE ARE SIBLING LEAVES AND NOT A CHAIN — this is the "68 did not run" fix
// ---------------------------------------------------------------------------
// These used to be emitted by a separate smokeFeatureChain() that wired them
// linearly, each depending on the one before. On 2026-09-04 `smoke-feature-
// reassign` failed and Playwright correctly skipped every stage downstream of
// it: dashboard-admin, dashboard-filter, hier-dashboard, online-roles,
// wam-patch, wam-patch-hier, wam-demap, wam-demap-hier — 68 tests that never
// ran because of one unrelated failure. That directly contradicts "in one run I
// can get report of all specs nothing should be escaped".
//
// The chain existed for two reasons, and BOTH are now gone:
//
//   1. "Provision before use" — 12_user_management created the 11-role batch
//      that 13/31/25/27 resolved their users from. The replicas resolve SM01's
//      users instead, and SM01 is already in the setup prefix every leaf
//      depends on. SM10 still creates its own batch, but purely as Add-User
//      coverage; nothing consumes it.
//
//   2. "Destructive last" — 25/26/27/28 mutated BL01, which earlier stages
//      depended on. The replicas mutate featureGround.wamMutate instead, an area
//      NOTHING else uses, so there is no longer an ordering constraint to encode.
//
// With both removed, every stage is genuinely independent, so one failure now
// costs exactly that one stage. Isolating the destructive ground was what made
// this possible — see featureGround in tests/config/projects.js.
//
// SOLAR ONLY: gated on profile.featureGround, which is null for wind (parked)
// and for the regression profile.
//
// A stage whose file is missing is skipped, so this list can name work that does
// not exist yet without breaking the config.
const SMOKE_FEATURE_STAGES = [
  // --- provisioning coverage (creates its own throwaway batch, nothing reads it) ---
  { id: 'users-batch',      file: 'SM10_user_management.spec.js' },

  // --- WAM feature depth, on featureGround.wamSweep ---
  { id: 'wam-basics',       file: 'SM11_wam_basics.spec.js' },
  { id: 'wam-ci',           file: 'SM12_wam_ci.spec.js' },
  { id: 'wam-all-roles',    file: 'SM13_wam_all_roles.spec.js' },

  // --- reassignment: MOVED to after SM26, see the note down there ---

  // --- dashboard ---
  { id: 'dashboard-admin',  file: 'SM15_admin_dashboard.spec.js' },
  { id: 'dashboard-filter', file: 'SM16_dashboard_filter.spec.js' },

  // --- hierarchy and online roles ---
  { id: 'hier-dashboard',   file: 'SM17_hierarchy_dashboard_menu.spec.js' },
  // The seven per-role suites (cad, sad, pad, pm, el, ql, cm) as ONE file with
  // seven tests, rather than the seven-file directory tests/online-roles/ is —
  // independent checks that never needed to be separate files, and one file is
  // one stage without needing the `dir` special case the old config carried.
  { id: 'online-roles',     file: 'SM18_online_roles.spec.js' },

  // --- mutating: patch/update then demap, all on featureGround.wamMutate ---
  // No longer "strictly last": they own their ground, so they cannot disturb
  // anything else. Each restores what it changed, and SM27 re-asserts the
  // baseline afterwards as a safety net.
  { id: 'wam-patch',        file: 'SM19_wam_patch_update.spec.js' },
  { id: 'wam-patch-hier',   file: 'SM20_wam_patch_update_hierarchy.spec.js' },
  { id: 'wam-demap',        file: 'SM21_wam_demapping.spec.js' },
  { id: 'wam-demap-hier',   file: 'SM22_wam_demapping_hierarchy.spec.js' },

  // --- RFI/NC creation depth, on featureGround.rfiCreate / rfiBulkAreas ---
  { id: 'rfi-create',       file: 'SM23_rfi_create.spec.js' },
  { id: 'rfi-bulk',         file: 'SM24_rfi_bulk_create.spec.js' },
  { id: 'rfi-bulk-multi',   file: 'SM25_rfi_bulk_multi_area.spec.js' },
  { id: 'nc-create',        file: 'SM26_nc_create.spec.js' },

  // Rule R2a — a non-approved NC blocks RFI on the same (activity, checkpoint,
  // work section) triple. Declared right after nc-create because it is the
  // other half of the same subject, and BEFORE reassign for a second reason
  // that is convenient rather than required: it leaves a non-approved NC
  // behind by design, which is exactly what SM14 wants to find.
  //
  // Its ground (featureGround.ncBlock = BL06) is touched by nothing else, so
  // it stays a sibling leaf like the rest — the ordering above is a
  // preference, not a dependency.
  { id: 'nc-block',         file: 'SM28_nc_blocks_rfi.spec.js' },

  // --- reassignment, deliberately AFTER the RFI/NC creates above ---
  //
  // Moved here from its old slot between wam-all-roles and dashboard-admin
  // (app owner, 2026-09-05): "for reassignment RFI and NC pending should be
  // there, also keep some unapproved RFI and NC before testing reassignment".
  //
  // Reassignment can only reassign something that is still PENDING — an
  // approved RFI/NC has nobody left to reassign. Running it before anything
  // had been created meant it depended on whatever residue happened to be
  // lying around, and the flow stages (SM05/SM06) drive their RFIs and NCs all
  // the way to APPROVED, so they leave nothing behind either. That is exactly
  // how it failed on 2026-09-05's full run: the RFI half found a row, and the
  // NC half SKIPPED with "nothing eligible to reassign".
  //
  // Sitting here it is fed by design rather than by luck. SM23/SM24/SM25 each
  // submit RFIs and SM26 submits an NC, and all of them stop at submission —
  // none of them approves anything — so by the time this stage runs there are
  // several genuinely unapproved RFIs AND at least one unapproved NC on the
  // isolated feature ground, which is exactly what SM14's pickOwnedRow()
  // prefers.
  { id: 'reassign',         file: 'SM14_reassign.spec.js' },

  // --- baseline restore, declared last ---
  // App owner, 2026-09-04: "after checking creation mapping demapping old SM01
  // users should be restored". Each mutating stage above already restores in
  // place; this re-asserts SM03's mapping for the whole band so a stage that
  // died mid-mutation cannot leave the chain's ground wrong for the next run.
  //
  // A LEAF, not a dependent of the mutating stages, and deliberately so: making
  // it depend on them would reintroduce exactly the cascade this restructure
  // removed (one mutating failure would skip the restore). As a leaf it always
  // runs, and it is idempotent, so running it early would merely re-assert
  // state that is already correct. Run it on demand with `npm run smoke:restore`.
  { id: 'restore',          file: 'SM27_restore_baseline.spec.js' },
];

const SMOKE_VIEWPORTS = [
  { id: 'desktop', device: devices['Desktop Chrome'] },
  // defaultBrowserType is part of the device descriptor but not a valid
  // context option; strip it the same way the recon specs do.
  { id: 'mobile', device: (({ defaultBrowserType, ...d }) => d)(devices['Pixel 7']) },
];

// Builds the projects for one profile:
//
//   users -> so -> wam [-> wam-hierarchy]        setup, strictly sequential
//                   |
//                   +-> rfi-desktop              each flow stage depends ONLY
//                   +-> nc-desktop                on the last setup stage
//                   +-> rfi-mobile
//                   +-> nc-mobile
//                   +-> dependency
//
// WHY THE FLOW STAGES DO NOT CHAIN TO EACH OTHER, even though a single linear
// chain would look tidier: Playwright re-runs a project's `dependencies` on
// EVERY invocation, and the flow stages are NOT idempotent — each RFI run
// permanently consumes one (checkpoint, Work Section) pair. If rfi-mobile
// depended on rfi-desktop, then every attempt at the mobile variant would also
// burn a desktop checkpoint, which defeats the whole point of giving each
// viewport its own Work Area. Depending only on the setup tail keeps each of the
// four combinations genuinely independently runnable — the app owner's explicit
// requirement — and the replayed prefix is cheap because the setup stages ARE
// idempotent (SM01 reuses existing users, SM02 reports "remapped 0", SM03 reports
// "No changes to save").
//
// CONSEQUENCE: run smoke projects with --workers=1. The app is
// one-session-at-a-time, and without the cross-stage chain it is the worker cap
// — not the dependency graph — that stops two flow stages overlapping. Each
// smoke spec is additionally test.describe.configure({ mode: 'serial' }), which
// only serialises WITHIN a file.
//
// Only stages whose spec file exists are emitted, so the chain can be built up
// incrementally without the config referencing files that aren't written yet — a
// missing testMatch would otherwise produce a project that silently passes with
// zero tests and lets later stages run on nothing.
function smokeChain(chainName, profileKey, extraUse = {}) {
  const projects = [];
  let previous = null;

  const matcher = (file) =>
    new RegExp(`[\\\\/]smoke[\\\\/]${file.replace(/\./g, '\\.')}$`);
  const exists = (file) => fs.existsSync(pathMod.join(__dirname, 'tests', 'smoke', file));

  // NO `dependencies` field, and this is the single most consequential line in
  // this file — found live 2026-09-05, the hard way.
  //
  // ===========================================================================
  // WHAT HAPPENED: ONE DIALOG-CLOSE HICCUP CREATING THE "PM" USER LOST 130 OF
  // THE REMAINING 139 TESTS IN THE RUN.
  // ===========================================================================
  // This USED to set `dependencies: [previous]` whenever a prior project
  // existed — the standard way to chain Playwright projects. Every project in
  // the smoke chain transitively depends on `smoke-${chainName}-users` (SM01)
  // this way, directly or through `smoke-${chainName}-wam` (SM03). Playwright's
  // own documented behaviour for project `dependencies` is: if a dependency
  // project has ANY failed test, every project that depends on it — including
  // transitively — is SKIPPED, not run.
  //
  // The earlier fix in this same file (removing `test.describe.configure({mode:
  // 'serial'})` from SM01 and ten other smoke files, see SMOKE_FEATURE_STAGES'
  // own history) solved the FILE-level version of this: one role's creation
  // failing no longer skips the OTHER nine roles IN THE SAME FILE. It does
  // nothing for the PROJECT-level version, which is coarser and was still
  // fully armed: SM01's "create the PM user" test hit a transient dialog issue,
  // 9 of its 10 users were created successfully (proving the file-level fix
  // works), and the `smoke-${chainName}-users` PROJECT was still marked
  // failed as a whole — which skipped `smoke-${chainName}-wam` and, through
  // it, transitively, all 26 remaining projects. 130 of 139 tests never ran,
  // from one non-representative hiccup in one of ten independent user
  // creations.
  //
  // ===========================================================================
  // WHY REMOVING `dependencies` DOES NOT BREAK EXECUTION ORDER
  // ===========================================================================
  // `dependencies` was never the thing actually guaranteeing order here.
  // run-smoke.js (the only way this chain is ever invoked) always passes
  // `--workers=1`, and an earlier adversarial review of this exact config
  // (2026-09-04, see project_smoke_env_login_replicas / this file's own
  // SMOKE_TAIL_STAGES history) already traced into
  // node_modules/playwright/lib/runner and confirmed that with a single
  // worker, Playwright dispatches from one shared FIFO queue built in
  // declaration order — the SMOKE_TAIL_STAGES sequence (SM04->SM07->SM08->
  // SM09) was found to be executing correctly EVEN THOUGH its `dependencies`
  // graph (before that day's fix) made all four of them siblings with no real
  // ordering constraint between them at all. Order came from `--workers=1` +
  // declaration order then; it still does now with `dependencies` removed
  // entirely.
  //
  // What `dependencies` was ACTUALLY contributing, given order was already
  // covered, was purely the failure-propagation behaviour above — all cost,
  // no benefit, for a chain whose whole point (per the app owner) is "one run,
  // nothing should be escaped."
  //
  // ===========================================================================
  // THIS DOES NOT MAKE A MISSING PRECONDITION SILENT
  // ===========================================================================
  // Every downstream stage still fails LOUDLY and SPECIFICALLY when something
  // it truly needed is missing — resolveSmokeUsers() names exactly which role
  // couldn't be resolved and why, requireFeatureGround() names the missing
  // config, smokeMappedWorkAreas()-driven WAM steps fail at a named row. A
  // stage that genuinely cannot proceed without its precondition still reports
  // that clearly; it just does so as ONE localised failure instead of erasing
  // every other stage's chance to prove itself too.
  const push = (name, file, device) => {
    projects.push({
      name,
      testMatch: matcher(file),
      use: { ...device, profileKey, ...extraUse },
    });
    previous = name;
  };

  // Which viewports this profile wants, in SMOKE_VIEWPORTS order (desktop first).
  // An unknown id is a config error worth failing the whole run for, rather than
  // silently emitting a chain with no flow stages in it.
  const wanted = getProfile(profileKey).viewports || SMOKE_VIEWPORTS.map((v) => v.id);
  const viewports = SMOKE_VIEWPORTS.filter((v) => wanted.includes(v.id));
  const unknown = wanted.filter((id) => !SMOKE_VIEWPORTS.some((v) => v.id === id));
  if (unknown.length) {
    throw new Error(
      `Profile "${profileKey}" declares unknown viewport(s): ${unknown.join(', ')}. ` +
      `Valid ids: ${SMOKE_VIEWPORTS.map((v) => v.id).join(', ')}`
    );
  }

  const desktop = SMOKE_VIEWPORTS[0].device;

  // Setup: strictly sequential, each depending on the previous.
  for (const stage of SMOKE_SETUP_STAGES) {
    if (exists(stage.file)) push(`smoke-${chainName}-${stage.id}`, stage.file, desktop);
  }

  // Everything after setup hangs off the LAST setup stage, not off each other.
  const setupTail = previous;
  const pushLeaf = (name, file, device) => {
    previous = setupTail;
    push(name, file, device);
  };

  // PRE-FLOW: after setup, before the flows (app owner, 2026-09-05 — see
  // SMOKE_PRE_FLOW_STAGES' own comment). Emitted with pushLeaf like every other
  // non-setup stage, so it is an independent leaf: if draft-autosave fails, the
  // flows still run and report on their own merits.
  for (const stage of SMOKE_PRE_FLOW_STAGES) {
    if (exists(stage.file)) pushLeaf(`smoke-${chainName}-${stage.id}`, stage.file, desktop);
  }

  // STAGE outer, VIEWPORT inner, so the emitted order is
  // rfi-desktop -> rfi-mobile -> nc-desktop -> nc-mobile: a whole flow is proven
  // across both viewports before the next flow starts. Ordering only affects a
  // full-chain run (the stages are independent leaves), but that is the run whose
  // sequence the app owner specified.
  for (const stage of SMOKE_FLOW_STAGES) {
    for (const viewport of viewports) {
      if (exists(stage.file)) {
        pushLeaf(`smoke-${chainName}-${stage.id}-${viewport.id}`, stage.file, viewport.device);
      }
    }
  }

  // TAIL stages run once per profile, desktop — but UNLIKE the flow-viewport
  // leaves above, they must run in STRICT ORDER relative to EACH OTHER, not just
  // share a dependency on setupTail: SM04's hierarchy cascade, then SM07's
  // dependency chain (needs its own BL07, untouched by anything else — see its
  // workArea comment in SOLAR_E2E), then SM08's data-integrity checks, then
  // SM09's draft-autosave check.
  //
  // FOUND AND FIXED LIVE 2026-09-04: this used to call pushLeaf() here too, which
  // gives every tail stage the SAME single dependency (setupTail) — siblings,
  // not a chain. An adversarial review of the SM07/SM08 additions traced this
  // into the installed Playwright engine (node_modules/playwright/lib/runner,
  // v1.61.0) and confirmed sibling projects sharing one dependency land in ONE
  // phase together, dispatched through one shared queue — so "SM04 runs before
  // SM07" was true only as an INCIDENTAL consequence of every smoke:* npm
  // script hardcoding --workers=1 (which forces strict FIFO dispatch off that
  // queue) plus this array's declaration order, never a real guarantee from the
  // `dependencies` field itself. Bumping workers, or a future Playwright
  // scheduler change, could have let these interleave. Fixed by resetting
  // `previous` to setupTail ONCE here and then using plain push() (the same
  // mechanism SMOKE_SETUP_STAGES uses above), so each tail stage now declares a
  // REAL dependency on the one before it — see docs/smoke-e2e-framework.md for
  // the full writeup, including why the ORIGINAL justification for giving SM07
  // its own BL07 (rather than reusing demapWorkArea/BL06) also turned out to be
  // partly wrong: SM04's BL06 reassignment targets the SAME CI/QI accounts SM03
  // already put there, so it was never a distinct-identity eviction. BL07 stays
  // dedicated regardless, now for real isolation rather than a misdiagnosed one.
  previous = setupTail;
  for (const stage of SMOKE_TAIL_STAGES) {
    if (exists(stage.file)) push(`smoke-${chainName}-${stage.id}`, stage.file, desktop);
  }

  // FEATURE-DEPTH stages (SM10+): independent sibling leaves off setupTail, so a
  // failure in one costs exactly that one stage. See SMOKE_FEATURE_STAGES above
  // for why they are no longer chained, and why isolating the mutating stages'
  // ground is what made that safe.
  //
  // Gated on featureGround: null for wind (parked) and for the regression
  // profile, so those chains emit no feature projects at all rather than
  // emitting stages that would fail in beforeAll.
  if (getProfile(profileKey).featureGround) {
    for (const stage of SMOKE_FEATURE_STAGES) {
      if (exists(stage.file)) {
        pushLeaf(`smoke-${chainName}-${stage.id}`, stage.file, desktop);
      }
    }
  }

  return projects;
}

// smokeFeatureChain() WAS HERE and is deliberately gone (2026-09-04). It emitted
// the feature stages as `smoke-feature-*` projects pointing at tests/specs/ and
// tests/online-roles/, wired into one linear chain. Both properties were the
// problem:
//
//   * pointing outside tests/smoke/ meant the smoke tier depended on the
//     regression tier's ground (A-06c) and its .env-created 11-role batch —
//     the opposite of "nothing depends outside";
//   * chaining them meant one failure skipped every stage after it (68 tests).
//
// The replicas now live in tests/smoke/ and are emitted by smokeChain() itself
// as sibling leaves, so both go away together.
const SOLAR_CHAIN = smokeChain('solar', 'solar-e2e');
const WIND_CHAIN = smokeChain('wind', 'wind-e2e');

module.exports = defineConfig({
  testDir: './tests',
  // App has a post-login loading screen (NN% spinner) that can take 3–5 min
  timeout: 600000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: TARGET_ENV.baseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    headless: false,
    // Actions without explicit timeouts fail after 30s instead of hanging for 10min.
    // Critical long waits (DashboardPage, _openDropdown, etc.) have explicit timeouts.
    actionTimeout: 30000,
    // Grant geolocation automatically so the browser permission popup
    // doesn't block the dashboard from loading after login. Camera added
    // for NC's mandatory "Capture Photo" flow (QI create, CI response, EE/QI
    // review) — granting it here avoids the OS/browser permission prompt;
    // --use-fake-device-for-media-stream (below) supplies a synthetic video
    // feed so getUserMedia() succeeds even on machines/CI runners with no
    // real webcam, and --use-fake-ui-for-media-stream skips Chrome's own
    // "Allow camera?" bubble that grantPermissions doesn't cover.
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
    launchOptions: {
      args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The RFI/NC flow specs must only run through the dependency chains
      // below — otherwise this project would also pick them up
      // unrestricted, racing the pass-N projects and corrupting their
      // shared tracker files. tests/smoke/ is excluded for the same reason:
      // it is an ORDERED chain (users -> SO mapping -> WAM -> flows) driven
      // by the smoke-* projects below, and running its stages unordered
      // under `chromium` would e.g. try to map a Service Order for users
      // that don't exist yet.
      testIgnore: [...RFI_FLOW_SPECS, ...NC_FLOW_SPECS, /[\\/]smoke[\\/]/],
    },

    // RFI flow regression: CI creates/resubmits -> EE reviews -> QI reviews,
    // repeated 3 times (deepest TC needs V1 -> V2 -> V3, i.e. 3 CI turns).
    // Run `npm run reset:rfi-tracker` before a full pass from scratch.
    { name: 'ci-pass-1', testMatch: RFI_FLOW_SPECS[0] },
    { name: 'ee-pass-1', testMatch: RFI_FLOW_SPECS[1], dependencies: ['ci-pass-1'] },
    { name: 'qi-pass-1', testMatch: RFI_FLOW_SPECS[2], dependencies: ['ee-pass-1'] },

    { name: 'ci-pass-2', testMatch: RFI_FLOW_SPECS[0], dependencies: ['qi-pass-1'] },
    { name: 'ee-pass-2', testMatch: RFI_FLOW_SPECS[1], dependencies: ['ci-pass-2'] },
    { name: 'qi-pass-2', testMatch: RFI_FLOW_SPECS[2], dependencies: ['ee-pass-2'] },

    { name: 'ci-pass-3', testMatch: RFI_FLOW_SPECS[0], dependencies: ['qi-pass-2'] },
    { name: 'ee-pass-3', testMatch: RFI_FLOW_SPECS[1], dependencies: ['ci-pass-3'] },
    { name: 'qi-pass-3', testMatch: RFI_FLOW_SPECS[2], dependencies: ['ee-pass-3'] },

    // NC flow regression: QI creates -> CI responds/resubmits -> EE reviews
    // -> QI reviews, repeated 3 times (deepest TC needs V1 -> V2 -> V3).
    // QI's create turn runs once up front (nc-qi-create) since it must
    // happen before CI's very first response turn; every later nc-qi-pass-N
    // is QI's review turn only (creation is a no-op by then — every TC
    // already has an ncId). Run `npm run reset:nc-tracker` before a full
    // pass from scratch.
    { name: 'nc-qi-create', testMatch: NC_FLOW_SPECS[0] },
    { name: 'nc-ci-pass-1', testMatch: NC_FLOW_SPECS[1], dependencies: ['nc-qi-create'] },
    { name: 'nc-ee-pass-1', testMatch: NC_FLOW_SPECS[2], dependencies: ['nc-ci-pass-1'] },
    { name: 'nc-qi-pass-1', testMatch: NC_FLOW_SPECS[0], dependencies: ['nc-ee-pass-1'] },

    { name: 'nc-ci-pass-2', testMatch: NC_FLOW_SPECS[1], dependencies: ['nc-qi-pass-1'] },
    { name: 'nc-ee-pass-2', testMatch: NC_FLOW_SPECS[2], dependencies: ['nc-ci-pass-2'] },
    { name: 'nc-qi-pass-2', testMatch: NC_FLOW_SPECS[0], dependencies: ['nc-ee-pass-2'] },

    { name: 'nc-ci-pass-3', testMatch: NC_FLOW_SPECS[1], dependencies: ['nc-qi-pass-2'] },
    { name: 'nc-ee-pass-3', testMatch: NC_FLOW_SPECS[2], dependencies: ['nc-ci-pass-3'] },
    { name: 'nc-qi-pass-3', testMatch: NC_FLOW_SPECS[0], dependencies: ['nc-ee-pass-3'] },

    // ---- E2E smoke chains (tests/smoke/), one per project type ----
    //
    // Ordered via `dependencies` for the same reason the RFI/NC pass chains
    // above are: each stage consumes what the previous one created. Stage 1
    // creates the users, stage 2 gives them activity access via SO Mapping,
    // stage 3/4 WAM them onto the work area, and only then can the flow
    // stages raise anything.
    //
    // `profileKey` selects which project type a stage runs for
    // (tests/config/projects.js), so one spec file serves both chains. Its
    // default in tests/config/test-base.js is 'solar-regression', so any spec
    // run outside these projects still sees the regression literals.
    //
    // Run ONE chain at a time, never both at once: they share the Admin account
    // and the app is one-session-at-a-time.
    //
    // Wind was built first and both its RFI viewports are green. Solar now
    // carries the MOBILE coverage per the app owner, because solar has many Work
    // Sections per Work Area and therefore never exhausts, never strands an area
    // behind an unapproved RFI, and can be re-run indefinitely — whereas
    // debugging mobile layout on wind spent irreplaceable checkpoints on issues
    // that had nothing to do with wind. Wind keeps the one-Work-Section-per-area
    // and dependency-enforcement coverage.
    ...WIND_CHAIN,
    ...SOLAR_CHAIN,
  ],
  outputDir: 'test-results/',
});
