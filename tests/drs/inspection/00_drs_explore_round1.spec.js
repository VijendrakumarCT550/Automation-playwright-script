const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, drsSuperAdmin } = require('../../config/drs-environments');

// ===========================================================================
// DRS EXPLORATION — ROUND 1. READ-ONLY, ENFORCED.
//
// Measures the DRS screens the Phase 1 setup chain will drive
// (docs/drs-pulse-integration.md §3 and §11) before any page object is
// written: Add Project, the App Settings screens (Vendor, SPV, Locations,
// Packages, Checklists, Service), and an existing project's Configuration
// wizard steps.
//
// NOTHING IS WRITTEN. Every non-GET API call to DRS is aborted and logged,
// except login (/auth/) and DRS's read shape (POST /api/v1/query/<TABLE>).
// No form is submitted; dropdowns are opened only to list their options.
//
// Output: drs-explore/round1/<nn>-<name>.png | .aria.txt, plus
// blocked-writes.txt and summary.json. Nothing here asserts app behaviour —
// the dumps are the product.
//
// Run:
//   npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round1.spec.js
//   (DRS_ENV=dev to explore drs-dev)
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round1');
// The project whose wizard steps are read — see EXPLORE_PROJECT_ID in
// ../utils/drs-ui.js. (Round 1 itself ran on "Pulse synce vije",
// 8c00a9eb-…, a sync-test project the app owner will delete.)
const { EXPLORE_PROJECT_ID: PROJECT_ID } = require('../utils/drs-ui');

test.describe.configure({ mode: 'serial' });

let context, page;
let step = 0;
const blocked = [];
const summary = { env: ENV.key, baseUrl: ENV.baseUrl, screens: [] };

const url = (p) => `${ENV.baseUrl}${p}`;

async function dump(name, extra = {}) {
  step += 1;
  const base = path.join(OUT, `${String(step).padStart(2, '0')}-${name}`);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
  const aria = await page.locator('body').ariaSnapshot({ timeout: 15000 }).catch((e) => `ariaSnapshot failed: ${e.message}`);
  fs.writeFileSync(`${base}.aria.txt`, `URL: ${page.url()}\n\n${aria}`);
  summary.screens.push({ step, name, url: page.url(), ...extra });
  console.log(`  [${step}] ${name} -> ${page.url()}`);
}

// Opens each visible combobox in `scope`, reads its options, closes it. Only
// reading — never clicks an option.
async function listComboboxOptions(scope, limit = 12) {
  const result = [];
  const combos = scope.getByRole('combobox');
  const n = Math.min(await combos.count(), limit);
  for (let i = 0; i < n; i += 1) {
    const combo = combos.nth(i);
    if (!(await combo.isVisible().catch(() => false))) continue;
    const label = (await combo.getAttribute('aria-label').catch(() => null))
      || (await combo.evaluate((el) => {
        const id = el.getAttribute('aria-labelledby');
        const byId = id && document.getElementById(id.split(' ')[0]);
        const field = el.closest('[data-scope="field"], [data-part="root"]');
        const lab = field && field.querySelector('label, [data-part="label"]');
        return (byId && byId.textContent) || (lab && lab.textContent) || el.getAttribute('placeholder') || '';
      }).catch(() => ''));
    await combo.click({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(700);
    const options = await page.locator('[role="option"]:visible').allInnerTexts().catch(() => []);
    result.push({ index: i, label: String(label).trim(), options: options.map((o) => o.trim()).slice(0, 60) });
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
  }
  return result;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });

  // THE WRITE GUARD. Any fetch/XHR to the DRS host that is not a GET, not a
  // login and not a /query/ read is aborted and recorded.
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    const isApi = ['fetch', 'xhr'].includes(req.resourceType());
    const onDrs = u.startsWith(ENV.baseUrl);
    const allowed = req.method() === 'GET' || /\/auth\//i.test(u) || /\/api\/v1\/query\//i.test(u);
    if (isApi && onDrs && !allowed) {
      blocked.push(`${req.method()} ${u}`);
      return route.abort();
    }
    return route.continue();
  });

  page = await context.newPage();
  const { email, password } = drsSuperAdmin();
  await page.goto(url('/login'));
  const emailBox = page.getByTestId('login-email');
  await emailBox.waitFor({ state: 'visible', timeout: 60000 });
  await emailBox.fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/projects/, { timeout: 120000 });
});

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nDRS exploration round 1: ${summary.screens.length} screens, ${blocked.length} blocked write(s). Output: ${OUT}`);
  if (context) await context.close();
});

test('1. projects dashboard', async () => {
  await expect(page.getByText(/List of Projects/i)).toBeVisible({ timeout: 60000 });
  await dump('projects-list');
});

test('2. Add Project form — fields and dropdown options (never submitted)', async () => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(url('/onboarding/new'));
  await dump('add-project-form');
  const combos = await listComboboxOptions(page, 20);
  summary.addProjectCombos = combos;
  console.log(JSON.stringify(combos, null, 2));
  await dump('add-project-after-listing');
});

test('3. App Settings screens', async () => {
  test.setTimeout(8 * 60 * 1000);
  const screens = [
    ['vendor-list', '/appSettings/vendors'],
    ['create-vendor-form', '/appSettings/createVendor'],
    ['spv-master', '/appSettings/spvsConfigurator'],
    ['locations-configurator', '/appSettings/locationsConfigurator'],
    ['packages-configurator', '/appSettings/packagesConfigurator'],
  ];
  for (const [name, p] of screens) {
    await page.goto(url(p));
    await dump(name);
  }

  // Locations: expand Rajasthan to see its sites (reading the tree only).
  await page.goto(url('/appSettings/locationsConfigurator'));
  const rajasthan = page.getByRole('treeitem', { name: /^Rajasthan/i }).first();
  if (await rajasthan.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    await rajasthan.click().catch(() => {});
    await page.waitForTimeout(1500);
    await dump('locations-rajasthan-expanded');
  }

  // Packages: list the version and project-type dropdowns without changing them.
  await page.goto(url('/appSettings/packagesConfigurator'));
  await page.waitForTimeout(1500);
  summary.packagesCombos = await listComboboxOptions(page, 4);
  console.log(JSON.stringify(summary.packagesCombos, null, 2));

  // Checklists and Service Configurator — routes unknown, reached by nav text.
  for (const [name, label] of [['checklists-configurator', 'Checklists Configurator'], ['service-configurator', 'Service Configurator']]) {
    const nav = page.getByText(label, { exact: true }).first();
    if (await nav.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) {
      await nav.click();
      await dump(name);
    }
  }
});

test('4. an existing project — Overview, Service Orders and every Configuration step', async () => {
  test.setTimeout(8 * 60 * 1000);
  await page.goto(url(`/projects/${PROJECT_ID}/projectDetails`));
  await dump('project-overview');
  await page.goto(url(`/projects/${PROJECT_ID}/serviceOrder`));
  await dump('project-service-orders');

  for (const s of ['summary', 'project_creation', 'location_config', 'wbs_config', 'so_manual_config', 'so_config', 'so_line_mapping']) {
    await page.goto(url(`/projects/${PROJECT_ID}/configuration?step=${s}`));
    await dump(`config-${s}`);
  }
});
