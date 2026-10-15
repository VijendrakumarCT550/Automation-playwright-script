const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  EXPLORE_PROJECT_ID, drsEnv, installWriteGuard, loginSuperAdmin, makeDumper,
  openCombobox, visibleOptions, listOptions, chooseOption,
} = require('../utils/drs-ui');

// ===========================================================================
// DRS EXPLORATION — ROUND 2. READ-ONLY, ENFORCED (same guard as round 1).
//
// Follows up round 1 (docs/drs-pulse-integration.md §11):
//   1. WHERE A WORK AREA GETS ITS CATALOG VERSION — the Location Configuration
//      detail panes, the Add Work Area form and the Import CSV dialog.
//   2. Add Project's dropdown options, via the "Toggle suggestions" buttons.
//   3. The Create-new-service-order drawer and an existing SO's Edit view.
//   4. SO Configuration with Version switched to v1 (a filter, never saved).
//   5. SO Line Mapping with a service order picked.
//
// Forms are opened and abandoned (reload), never submitted; filter changes are
// UI state only, and the write guard aborts anything that would reach the
// server anyway.
//
// Run:
//   npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round2.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round2');
const P = EXPLORE_PROJECT_ID;
const url = (p) => `${ENV.baseUrl}${p}`;

test.describe.configure({ mode: 'serial' });

let context, page, dump;
const blocked = [];
const summary = { env: ENV.key, project: P, screens: [], findings: {} };
const note = (key, value) => { summary.findings[key] = value; console.log(`  ${key}: ${JSON.stringify(value)}`); };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);
});

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nDRS exploration round 2: ${summary.screens.length} screens, ${blocked.length} blocked write(s). Output: ${OUT}`);
  if (context) await context.close();
});

test('1. Location Configuration — node panes, Add Work Area form, Import CSV dialog', async () => {
  test.setTimeout(8 * 60 * 1000);
  await page.goto(url(`/projects/${P}/configuration?step=location_config`));
  await dump('loc-initial');

  // Work Location node, then its first Work Area child.
  const wl = page.getByRole('treeitem', { level: 1 }).first();
  await wl.waitFor({ state: 'visible', timeout: 30000 });
  note('locFirstWorkLocation', (await wl.getAttribute('aria-label')) || (await wl.innerText()));
  await wl.click();
  await dump('loc-work-location-pane');

  const expander = wl.locator('button, [data-part="branch-indicator"], svg').first();
  if ((await wl.getAttribute('aria-expanded')) !== 'true') {
    await expander.click().catch(() => {});
    await page.waitForTimeout(1200);
  }
  const wa = page.getByRole('treeitem', { level: 2 }).first();
  if (await wa.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    note('locFirstWorkArea', (await wa.getAttribute('aria-label')) || (await wa.innerText()));
    await wa.click();
    await dump('loc-work-area-pane');
    const ws = page.getByRole('treeitem', { level: 3 }).first();
    if ((await wa.getAttribute('aria-expanded')) !== 'true') {
      await wa.locator('button, svg').first().click().catch(() => {});
      await page.waitForTimeout(1200);
    }
    if (await ws.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false)) {
      await ws.click();
      await dump('loc-work-section-pane');
    }
  }

  // Cluster + Site (UI selection only — not persisted on its own, per the
  // DRS team) to enable the toolbar, then open Add Work Area and abandon it.
  await page.goto(url(`/projects/${P}/configuration?step=location_config`));
  const cluster = page.getByRole('combobox', { name: 'Cluster' }).first();
  const site = page.getByRole('combobox', { name: 'Site' }).first();
  note('locClusterOptions', await listOptions(page, cluster));
  note('locClusterChosen', await chooseOption(page, cluster, 'Gujarat'));
  note('locSiteOptions', await listOptions(page, site));
  note('locSiteChosen', await chooseOption(page, site, 'Khavda'));
  await dump('loc-cluster-site-chosen');

  const firstWl = page.getByRole('treeitem', { level: 1 }).first();
  await firstWl.click().catch(() => {});
  await page.waitForTimeout(800);
  const addWa = page.getByRole('button', { name: 'Add Work Area' });
  note('addWorkAreaEnabled', await addWa.isEnabled().catch(() => false));
  if (await addWa.isEnabled().catch(() => false)) {
    await addWa.click();
    await dump('loc-add-work-area-form');
    // List any combobox in the form (a Version / Project picker would show here).
    const combos = page.getByRole('combobox');
    const n = await combos.count();
    const forms = [];
    for (let i = 0; i < n; i += 1) {
      const c = combos.nth(i);
      const name = await c.getAttribute('aria-label').catch(() => null);
      if (!name || /^(Cluster|Site)$/i.test(name)) continue;
      forms.push({ name, options: await listOptions(page, c) });
    }
    note('addWorkAreaFormCombos', forms);
  }

  const mapWa = page.getByRole('button', { name: 'Map existing Work Area' });
  if (await mapWa.isEnabled().catch(() => false)) {
    await page.goto(url(`/projects/${P}/configuration?step=location_config`));
    await chooseOption(page, page.getByRole('combobox', { name: 'Cluster' }).first(), 'Gujarat');
    await chooseOption(page, page.getByRole('combobox', { name: 'Site' }).first(), 'Khavda');
    await page.getByRole('treeitem', { level: 1 }).first().click().catch(() => {});
    await page.getByRole('button', { name: 'Map existing Work Area' }).click().catch(() => {});
    await dump('loc-map-existing-work-area');
  }

  // Import CSV dialog — opened, never given a file.
  await page.goto(url(`/projects/${P}/configuration?step=location_config`));
  await page.getByRole('button', { name: 'Import CSV' }).click();
  await dump('loc-import-csv-dialog');
});

test('2. Add Project dropdown options (never submitted)', async () => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(url('/onboarding/new'));
  await page.getByRole('combobox', { name: 'Project Type*' }).waitFor({ state: 'visible', timeout: 30000 });
  const out = {};
  for (const name of ['Project Type*', 'Project Category*', 'Construction By*', 'SPV*', 'Plant Code', 'MMS Type']) {
    out[name] = await listOptions(page, page.getByRole('combobox', { name }).first());
  }
  note('addProjectOptions', out);
  await openCombobox(page, page.getByRole('combobox', { name: 'Project Type*' }).first());
  await dump('add-project-type-open');
});

test('3. Create new service order drawer, and an existing SO in Edit', async () => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(url(`/projects/${P}/configuration?step=so_manual_config`));
  await dump('so-manual-list');

  const create = page.getByRole('button', { name: /Create new service order/i });
  if (await create.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    await create.click();
    await dump('so-create-drawer');
    const combos = page.getByRole('combobox');
    const n = await combos.count();
    const lists = [];
    for (let i = 0; i < n; i += 1) {
      const c = combos.nth(i);
      if (!(await c.isVisible().catch(() => false))) continue;
      lists.push({ name: await c.getAttribute('aria-label').catch(() => null), options: await listOptions(page, c) });
    }
    note('soCreateCombos', lists);
  }

  await page.goto(url(`/projects/${P}/configuration?step=so_manual_config`));
  const edit = page.getByRole('button', { name: 'Edit' }).first();
  if (await edit.waitFor({ state: 'visible', timeout: 15000 }).then(() => true).catch(() => false)) {
    await edit.click();
    await dump('so-edit-existing');
  }
});

test('4. SO Configuration — every filter\'s options, then Version = v1', async () => {
  test.setTimeout(6 * 60 * 1000);
  await page.goto(url(`/projects/${P}/configuration?step=so_config`));
  await dump('so-config-initial');
  const filters = {};
  for (const name of ['Work Location', 'Version', 'Work Area', 'Package']) {
    filters[name] = await listOptions(page, page.getByRole('combobox', { name }).first());
  }
  note('soConfigFilterOptions', filters);

  note('soConfigVersionV1Chosen', await chooseOption(page, page.getByRole('combobox', { name: 'Version' }).first(), 'v1'));
  await dump('so-config-v1');
  note('soConfigWorkAreaOptionsOnV1', await listOptions(page, page.getByRole('combobox', { name: 'Work Area' }).first()));
  note('soConfigPackageOptionsOnV1', await listOptions(page, page.getByRole('combobox', { name: 'Package' }).first()));
});

test('5. SO Line Mapping with a service order picked', async () => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(url(`/projects/${P}/configuration?step=so_line_mapping`));
  const so = page.getByRole('combobox', { name: /service order/i }).first();
  await so.waitFor({ state: 'visible', timeout: 30000 }).catch(() => {});
  await openCombobox(page, so);
  const options = await visibleOptions(page);
  note('soLineMappingSoOptions', options);
  if (options.length) {
    await page.getByRole('option').first().click().catch(() => {});
    await page.waitForTimeout(1500);
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await dump('so-line-mapping-picked');
});
