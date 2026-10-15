const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');

// ===========================================================================
// DRS EXPLORATION — ROUND 14. READ-ONLY, ENFORCED.
// Before the automation ticks our site versions' sub-activities under service
// codes 120021756 / 120036457 (app owner, 2026-10-15): how is a code's tree built?
//   * rows are sub-packages per catalog version ("Piling (MMS, Inverter, LT Cable
//     Hangers)  Solar · Automation Site 01 v1  0/4"), with a chevron + checkbox;
//   * what is under a row (activities? sub-activities?), and what does each checkbox
//     carry (role, name)?
//   * which rows are ticked today, and does "Search sub-activities" filter the tree?
// Ticks NOTHING (the write guard would abort a save anyway).
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round14_service_code_tree.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round14');
let context;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  if (context) await context.close();
});

test('service code tree shape', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const f = summary.findings;
  context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  const dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  await page.goto(`${ENV.baseUrl}/appSettings/serviceConfigurator`);
  const codeSearch = page.getByRole('textbox', { name: /Search service codes/i }).or(page.getByPlaceholder(/Search service codes/i)).first();
  await codeSearch.waitFor({ state: 'visible', timeout: 60000 });

  for (const code of ['120021756', '120036457']) {
    await codeSearch.fill(code);
    await page.waitForTimeout(2000);
    await page.getByText(code, { exact: true }).first().click();
    await page.waitForTimeout(3000);
    f[code] = {};
    f[code].selectedText = await page.getByText(/of \d+ selected/).first().innerText().catch(() => '');

    // Rows whose label mentions Piling / Robot, per version, with their counter.
    const subSearch = page.getByPlaceholder(/Search sub-activities/i).first();
    await subSearch.fill(code === '120021756' ? 'Piling - MMS' : 'Robotic');
    await page.waitForTimeout(2500);
    await dump(`${code}-search`);
    f[code].afterSearch = (await page.locator('main').innerText().catch(() => '')).split('\n').filter((l) => /Piling|Robot|Solar ·|\d+\/\d+/.test(l)).slice(0, 80);
    console.log(`\n  ---- ${code} (${f[code].selectedText}) rows after search ----`);
    for (const l of f[code].afterSearch) console.log(`    ${l}`);

    // Expand the first row that is labelled Automation Site 01 v1 (or the first row) and read its children.
    const rowLabel = page.getByText(/Automation Site 01 v1/).first();
    if (await rowLabel.isVisible().catch(() => false)) {
      const row = rowLabel.locator('xpath=ancestor::*[.//input[@type="checkbox"] or .//*[@role="checkbox"]][1]');
      f[code].rowHtml = (await row.evaluate((el) => el.outerHTML).catch(() => '')).slice(0, 2500);
      await row.locator('svg, button').first().click().catch(() => {});
      await page.waitForTimeout(1500);
      await dump(`${code}-site-v1-expanded`);
      f[code].expandedText = (await page.locator('main').innerText().catch(() => '')).split('\n').filter((l) => l.trim()).slice(0, 120);
    }
    f[code].checkboxes = await page.locator('input[type="checkbox"], [role="checkbox"]').evaluateAll((els) => els.slice(0, 60).map((e) => ({
      aria: e.getAttribute('aria-label'), checked: e.checked ?? e.getAttribute('aria-checked'),
      label: (e.closest('label') || e.parentElement || {}).innerText ? (e.closest('label') || e.parentElement).innerText.slice(0, 120) : '',
    })));
    await subSearch.fill('');
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'aria.txt'), await page.locator('body').ariaSnapshot().catch(() => ''));
});
