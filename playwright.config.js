// @ts-check
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');
const { applyEnvironment } = require('./tests/config/environments');

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

const SMOKE_STAGES = [
  { id: 'users', file: 's01_user_creation.spec.js' },
  { id: 'so', file: 's02_so_mapping.spec.js' },
  { id: 'wam', file: 's03_wam_admin.spec.js' },
  { id: 'wam-hierarchy', file: 's04_wam_hierarchy.spec.js' },
  { id: 'rfi', file: 's05_rfi_flow.spec.js' },
  { id: 'nc', file: 's06_nc_flow.spec.js' },
  { id: 'dependency', file: 's07_rfi_activity_dependency.spec.js' },
];

function smokeChain(chainName, profileKey, extraUse = {}) {
  const projects = [];
  let previous = null;

  for (const stage of SMOKE_STAGES) {
    const abs = pathMod.join(__dirname, 'tests', 'smoke', stage.file);
    if (!fs.existsSync(abs)) continue;

    const name = `smoke-${chainName}-${stage.id}`;
    projects.push({
      name,
      testMatch: new RegExp(`[\\\\/]smoke[\\\\/]${stage.file.replace(/\./g, '\\.')}$`),
      use: { ...devices['Desktop Chrome'], profileKey, ...extraUse },
      ...(previous ? { dependencies: [previous] } : {}),
    });
    previous = name;
  }

  return projects;
}

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
    // WIND FIRST, per the app owner — the solar chain's stages are added once
    // the wind chain is green. Run one chain at a time, never both at once:
    // they share the Admin account and the app's one-session-at-a-time
    // behaviour.
    ...smokeChain('wind', 'wind-e2e'),
  ],
  outputDir: 'test-results/',
});
