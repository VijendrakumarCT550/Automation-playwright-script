const { test, expect } = require('@playwright/test');
const { drsEnv, drsSuperAdmin } = require('../../config/drs-environments');
const { loginSuperAdmin } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DATA = require('../drs-data');
const DrsAppSettingsPage = require('../pages/DrsAppSettingsPage');
const UserManagementVendorPage = require('../pages/UserManagementVendorPage');

// ===========================================================================
// D01 — MASTER DATA: vendor (D1), SPV (D2), automation Site (D3).
// docs/drs-pulse-integration.md §3–§4.
//
// D1 LIVES IN USER MANAGEMENT NOW (app owner, 2026-10-01), a separate app with
// its own host and login (tests/config/drs-environments.js userManagementUrl),
// no longer in DRS App Settings. D2 (SPV) and D3 (Site) are still DRS App
// Settings. So D1 signs in to User Management on a second page; D2/D3 never do.
//
// FIND-OR-CREATE, ONCE PER DRS ENVIRONMENT. Each record is looked up first
// (state file, then the live list), and created only when the environment
// really has none. A vendor can be neither edited nor deleted, so creating one
// per run would litter drs-uat for good.
//
// WRITES (first run only): one vendor, one Site. Recorded in
// tests/fixtures/drs/drs-setup.json the moment the server accepts each.
//
// Run:  npx playwright test --project=drs tests/drs/setup/D01_masters.spec.js
// ===========================================================================

const ENV = drsEnv();

test.describe.configure({ mode: 'serial' });

let context, page, settings, vendors;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  settings = new DrsAppSettingsPage(page, ENV.baseUrl);
  // User Management is a separate session - signed in lazily by D1, on its own page.
  vendors = null;
});

test.afterAll(async () => {
  console.log(`\nDRS masters on ${ENV.key}: ${JSON.stringify(
    (({ vendor, spv, cluster, site }) => ({ vendor, spv, cluster, site }))(state.envRecord(ENV.key))
  )}`);
  if (context) await context.close();
});

test('D1. our service-contractor vendor exists in User Management (found or created once)', async () => {
  test.setTimeout(5 * 60 * 1000);
  const umPage = await context.newPage();
  vendors = new UserManagementVendorPage(umPage, ENV.userManagementUrl);
  await vendors.login(drsSuperAdmin());
  const recorded = state.envRecord(ENV.key).vendor;

  const found = await vendors.findVendor(DATA.vendor.name);
  if (found) {
    console.log(`  vendor already exists: ${found.code} — ${found.name}${recorded ? '' : ' (recording it)'}`);
    state.updateEnv(ENV.key, { vendor: found });
    return;
  }
  if (recorded) {
    // The store says it exists but the list does not show it — never paper
    // over that by creating a second one.
    throw new Error(
      `State records vendor ${JSON.stringify(recorded)} on ${ENV.key}, but the User Management vendor list does not ` +
      `show "${DATA.vendor.name}". Check the list by hand before creating another.`
    );
  }

  // A code nobody holds: 99 + 4 random digits, re-rolled if the list has it.
  let code;
  for (let i = 0; i < 5 && !code; i += 1) {
    const candidate = `${DATA.vendor.codePrefix}${String(Math.floor(1000 + Math.random() * 9000))}`;
    if (!(await vendors.findVendor(candidate))) code = candidate;
  }
  expect(code, 'could not find a free 99xxxx vendor code in 5 tries').toBeTruthy();

  const res = await vendors.createVendor({ name: DATA.vendor.name, code, gst: DATA.vendor.gst });
  console.log(`  create vendor → HTTP ${res.status} ${res.url} ${res.body.slice(0, 200)}`);
  expect(res.status, `vendor create answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
  state.updateEnv(ENV.key, { vendor: { code, name: DATA.vendor.name, createdAt: new Date().toISOString() } });

  // Proof it is really there, not just that the POST was accepted.
  const after = await vendors.findVendor(DATA.vendor.name);
  expect(after, `vendor "${DATA.vendor.name}" not in the list after a ${res.status}`).toBeTruthy();
  state.updateEnv(ENV.key, { vendor: { ...after, createdAt: new Date().toISOString() } });
  console.log(`  vendor created: ${after.code} — ${after.name}`);
});

test('D2. the SPV exists', async () => {
  test.setTimeout(3 * 60 * 1000);
  expect(await settings.spvExists(DATA.spv), `SPV "${DATA.spv}" not found in SPV Master`).toBe(true);
  state.updateEnv(ENV.key, { spv: DATA.spv });
  console.log(`  SPV ok: ${DATA.spv}`);
});

test('D3. the automation Site exists under its cluster (found or created once)', async () => {
  test.setTimeout(5 * 60 * 1000);
  if (await settings.siteExists(DATA.cluster, DATA.site)) {
    console.log(`  site already exists: ${DATA.cluster} → ${DATA.site}`);
  } else {
    const res = await settings.createSite(DATA.cluster, DATA.site);
    console.log(`  create site → HTTP ${res.status} ${res.body.slice(0, 200)}`);
    expect(res.status, `site create answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    expect(await settings.siteExists(DATA.cluster, DATA.site), 'site not in the tree after create').toBe(true);
    console.log(`  site created: ${DATA.cluster} → ${DATA.site}`);
  }
  state.updateEnv(ENV.key, { cluster: DATA.cluster, site: DATA.site });
});
