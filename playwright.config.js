// @ts-check
require('dotenv').config();
const { defineConfig, devices } = require('@playwright/test');

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
    baseURL: process.env.BASE_URL || 'https://example.com',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'on-first-retry',
    headless: false,
    // Actions without explicit timeouts fail after 30s instead of hanging for 10min.
    // Critical long waits (DashboardPage, _openDropdown, etc.) have explicit timeouts.
    actionTimeout: 30000,
    // Grant geolocation automatically so the browser permission popup
    // doesn't block the dashboard from loading after login
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      // The RFI/NC flow specs must only run through the dependency chains
      // below — otherwise this project would also pick them up
      // unrestricted, racing the pass-N projects and corrupting their
      // shared tracker files.
      testIgnore: [...RFI_FLOW_SPECS, ...NC_FLOW_SPECS],
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
  ],
  outputDir: 'test-results/',
});
