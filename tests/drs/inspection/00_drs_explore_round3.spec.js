const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  drsEnv, installWriteGuard, loginSuperAdmin, makeDumper, listOptions, chooseOption,
} = require('../utils/drs-ui');
const state = require('../utils/drs-state');

// ===========================================================================
// DRS EXPLORATION — ROUND 3. READ-ONLY, ENFORCED (write guard installed).
//
// Before the first service order is created (docs/drs-pulse-integration.md §3):
//   1. the Create Service Order page's "Advanced Header Details" and "Add Line"
//      fields (opened, never submitted);
//   2. OUR project's SO Configuration on v1 with the Civil package — which
//      activities (Piling …) appear as rows, and what an SO cell offers before
//      any SO exists for the project.
//
// Reads the newest project from tests/fixtures/drs/drs-setup.json.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round3.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round3');
const url = (p) => `${ENV.baseUrl}${p}`;

test.describe.configure({ mode: 'serial' });

let context, page, dump, run;
const blocked = [];
const summary = { env: ENV.key, screens: [], findings: {} };
const note = (k, v) => { summary.findings[k] = v; console.log(`  ${k}: ${JSON.stringify(v)}`); };

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  run = state.latestProject(ENV.key);
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);
});

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`\nround 3: ${summary.screens.length} screens, ${blocked.length} blocked write(s)`);
  if (context) await context.close();
});

test('1. Create Service Order — Advanced Header Details and Add Line fields', async () => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(url(`/projects/${run.id}/configuration?step=so_manual_config`));
  await page.getByRole('button', { name: /Create new service order/i }).click();
  await page.getByRole('textbox', { name: 'SO Number*' }).waitFor({ state: 'visible', timeout: 30000 });
  await page.getByRole('button', { name: 'Advanced Header Details' }).click();
  await page.waitForTimeout(800);
  await dump('so-advanced-header');
  await page.getByRole('button', { name: 'Add Line' }).click();
  await page.waitForTimeout(1000);
  await dump('so-add-line');
  // Options of every combobox now on the page except Vendor (already known).
  const combos = page.getByRole('combobox');
  const n = await combos.count();
  const out = [];
  for (let i = 0; i < n; i += 1) {
    const c = combos.nth(i);
    if (!(await c.isVisible().catch(() => false))) continue;
    const name = await c.evaluate((el) => {
      const g = el.closest('[role="group"]');
      return (el.getAttribute('aria-label') || (g && g.textContent) || '').trim().slice(0, 60);
    }).catch(() => '');
    if (/^Vendor/i.test(name)) continue;
    out.push({ name, options: (await listOptions(page, c)).slice(0, 40) });
  }
  note('soFormCombos', out);
});

test('2. our project — SO Configuration on v1, Civil', async () => {
  test.setTimeout(5 * 60 * 1000);
  await page.goto(url(`/projects/${run.id}/configuration?step=so_config`));
  await page.getByRole('combobox', { name: 'Version' }).first().waitFor({ state: 'visible', timeout: 60000 });
  await dump('so-config-our-project');
  note('ourVersionOptions', await listOptions(page, page.getByRole('combobox', { name: 'Version' }).first()));
  note('chooseV1', await chooseOption(page, page.getByRole('combobox', { name: 'Version' }).first(), 'v1'));
  note('choseCivil', await chooseOption(page, page.getByRole('combobox', { name: 'Package' }).first(), 'Civil'));
  await dump('so-config-our-project-v1-civil');
});
