const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');

// ===========================================================================
// DRS EXPLORATION — ROUND 18. READ-ONLY, ENFORCED.
// 2026-10-15, app owner: the catalog build will use checklists we create in App
// Settings → Checklists Configurator, and checkpoint dependencies come next. Before
// writing anything: what does the Checklists Configurator show (list, search,
// create form and its fields), what does one existing checklist look like inside
// (e.g. "Micro Pile Checklist", which our checkpoints bind today), and is there any
// versioning / status on a checklist?
// Opens the create form to read its fields; never saves (write guard).
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round18_checklists_configurator.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round18');
const blocked = [];
const summary = { screens: [], findings: {} };
let context;

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  if (context) await context.close();
});

const bodyText = (page) => page.locator('body').innerText().catch(() => '');
const controls = async (page) => ({
  buttons: (await page.getByRole('button').allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 50),
  textboxes: await page.getByRole('textbox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.getAttribute('name'))),
  comboboxes: await page.getByRole('combobox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.innerText.slice(0, 40))),
  tabs: (await page.getByRole('tab').allInnerTexts()).map((t) => t.trim()),
});

test('Checklists Configurator: list, one checklist, create form', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const f = summary.findings;
  context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  const dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  await page.goto(`${ENV.baseUrl}/appSettings/packagesConfigurator?projectType=solar`);
  await page.getByText('Checklists Configurator', { exact: true }).first().click();
  await page.waitForTimeout(5000);
  f.url = page.url();
  await dump('01-list');
  f.listControls = await controls(page);
  f.listText = (await bodyText(page)).slice(0, 4000);
  console.log('  URL:', f.url);
  console.log('  list controls:', JSON.stringify(f.listControls));
  console.log('  list text (first 2500):\n', f.listText.slice(0, 2500));

  // One existing checklist our checkpoints bind today.
  const search = page.getByRole('textbox').first();
  if (await search.isVisible().catch(() => false)) {
    await search.fill('Micro Pile Checklist');
    await page.waitForTimeout(2500);
  }
  const hit = page.getByText(/Micro Pile Checklist/).first();
  if (await hit.isVisible().catch(() => false)) {
    await hit.click();
    await page.waitForTimeout(4000);
    await dump('02-micro-pile-checklist');
    f.checklistControls = await controls(page);
    f.checklistText = (await bodyText(page)).slice(0, 6000);
    console.log('\n  checklist controls:', JSON.stringify(f.checklistControls));
    console.log('  checklist text (first 3500):\n', f.checklistText.slice(0, 3500));
  }

  // The create form, read only.
  await page.goto(f.url);
  await page.waitForTimeout(4000);
  const create = page.getByRole('button', { name: /Add|New|Create/i }).first();
  if (await create.isVisible().catch(() => false)) {
    f.createButton = (await create.innerText()).trim();
    await create.click();
    await page.waitForTimeout(3000);
    await dump('03-create-form');
    f.createControls = await controls(page);
    f.createText = (await bodyText(page)).slice(0, 4000);
    console.log(`\n  create ("${f.createButton}") controls:`, JSON.stringify(f.createControls));
    console.log('  create text (first 2500):\n', f.createText.slice(0, 2500));
  }
});
