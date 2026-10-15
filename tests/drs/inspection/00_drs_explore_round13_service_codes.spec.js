const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper, openCombobox } = require('../utils/drs-ui');
const state = require('../utils/drs-state');

// ===========================================================================
// DRS EXPLORATION — ROUND 13. READ-ONLY, ENFORCED.
// 2026-10-15, app owner: standard sub-activities are grouped on an SO line by its
// SERVICE CODE (Downloads/"PULSE RFI to BBU service code mapping - Solar v2 1.xlsx":
// 120021756 Piling (excl. Robot) = MMS + Inverter + LT Cable Hanger; 120036457 Robot
// = Robotic Docking + docking/reverse stations). A service code's sub-activities
// are configured in App Settings (Service Configurator) and AUTO-POPULATE on SO
// Line Mapping when the line carries the code. Questions:
//   1. App Settings: where is the Service Configurator, which codes exist, and what
//      do 120021756 / 120036457 map to - with which catalog-version labels?
//   2. 3b. Create Service Order: what does a line block offer (Service Code field?)
//   3. 5. SO Line Mapping on our newest project: what does a line card show for
//      Service Code (read-only here)?
// Never saves (the write guard aborts any non-GET).
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round13_service_codes.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round13');
const CODES = ['120021756', '120036457'];
let context;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  if (context) await context.close();
});

test('service codes: configurator, SO line form, line mapping', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const f = summary.findings;
  context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  const dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  // ---- 1. App Settings menu + Service Configurator ----
  await page.goto(`${ENV.baseUrl}/appSettings/packagesConfigurator?projectType=solar`);
  await page.waitForTimeout(4000);
  // The App Settings sidebar items are not plain links (round 13a found none), so
  // click the one whose text mentions "Service" and read where it lands.
  f.sidebarItems = (await page.getByText(/Configurator|Management|Master|Mapping/).allInnerTexts()).map((t) => t.trim()).filter((t) => t.length < 40);
  console.log('  App Settings sidebar:', f.sidebarItems);
  const svcItem = page.getByText(/Service Configurator|Service Code|Services Configurator/i).first();
  let svc = null;
  if (await svcItem.isVisible().catch(() => false)) {
    await svcItem.click();
    await page.waitForTimeout(4000);
    svc = new URL(page.url()).pathname + new URL(page.url()).search;
  }
  f.serviceConfiguratorHref = svc;
  console.log('  Service Configurator ->', svc);
  if (svc) {
    await dump('01-service-configurator');
    f.serviceConfiguratorText = (await page.locator('main').innerText().catch(() => '')).slice(0, 3000);
    console.log('  Service Configurator (first 1500 chars):\n', f.serviceConfiguratorText.slice(0, 1500));
    f.serviceConfiguratorControls = {
      comboboxes: await page.getByRole('combobox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.getAttribute('placeholder') || e.innerText)),
      buttons: (await page.getByRole('button').allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 40),
      textboxes: await page.getByRole('textbox').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') || e.getAttribute('placeholder'))),
    };
    console.log('  controls:', JSON.stringify(f.serviceConfiguratorControls));
    for (const code of CODES) {
      const search = page.getByRole('textbox').first();
      if (await search.isVisible().catch(() => false)) {
        await search.fill(code).catch(() => {});
        await page.waitForTimeout(2000);
      }
      const hit = page.getByText(code).first();
      if (await hit.isVisible().catch(() => false)) {
        await hit.click().catch(() => {});
        await page.waitForTimeout(3000);
      }
      await dump(`02-code-${code}`);
      f[`code_${code}`] = (await page.locator('main').innerText().catch(() => '')).slice(0, 4000);
      console.log(`\n  ---- ${code} ----\n${f[`code_${code}`].slice(0, 2500)}`);
    }
  }

  // ---- 2. Create Service Order: the line block ----
  const run = [...state.envRecord(ENV.key).projects].reverse().find((p) => (p.stagesDone || []).includes('D9'));
  f.project = run && run.name;
  await page.goto(`${ENV.baseUrl}/projects/${run.id}/configuration?step=so_manual_config`);
  await page.getByRole('button', { name: /Create new service order/i }).waitFor({ state: 'visible', timeout: 60000 });
  await page.getByRole('button', { name: /Create new service order/i }).click();
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Add Line' }).click();
  await page.waitForTimeout(1500);
  // The line block's collapsed "Optional Line Fields" (seen in round 13a's screenshot).
  const optional = page.getByText('Optional Line Fields').last();
  if (await optional.isVisible().catch(() => false)) {
    await optional.click();
    await page.waitForTimeout(1200);
  }
  await dump('03-so-create-line-block');
  const lineBlock = page.getByText(/^Line \d+$/).last().locator('xpath=ancestor::div[.//input][1]');
  f.lineBlockText = (await lineBlock.innerText().catch(() => '')).slice(0, 1500);
  console.log('\n  line block (Optional Line Fields open):\n', f.lineBlockText);
  f.lineBlockCaptions = [];
  f.lineBlockInputs = await page.locator('input').evaluateAll((els) => els.map((e) => ({
    name: e.getAttribute('name'), placeholder: e.getAttribute('placeholder'), aria: e.getAttribute('aria-label'), role: e.getAttribute('role'),
  })));
  console.log('\n  SO create - captions:', JSON.stringify(f.lineBlockCaptions));
  console.log('  SO create - inputs:', JSON.stringify(f.lineBlockInputs));
  // Is Service Code a combobox with options?
  const sc = page.getByRole('combobox', { name: /Service Code/i }).first();
  if (await sc.isVisible().catch(() => false)) {
    await openCombobox(page, sc);
    f.serviceCodeOptions = (await page.locator('[role="option"]:visible').allInnerTexts()).map((t) => t.trim()).slice(0, 40);
    console.log('  Service Code options:', f.serviceCodeOptions);
    await page.keyboard.press('Escape');
  }

  // ---- 3. SO Line Mapping card on the newest project (read-only) ----
  await page.goto(`${ENV.baseUrl}/projects/${run.id}/configuration?step=so_line_mapping`);
  await page.getByText(/S\.O\. Activity/).first().waitFor({ state: 'visible', timeout: 60000 });
  await page.waitForTimeout(1500);
  await dump('04-line-mapping');
  f.lineCardText = (await page.getByText(/S\.O\. Activity/).first().locator('xpath=ancestor::div[.//*[@role="combobox"]][1]').innerText().catch(() => '')).slice(0, 800);
  console.log('\n  line card:\n', f.lineCardText);
});
