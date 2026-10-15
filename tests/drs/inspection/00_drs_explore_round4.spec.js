const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const {
  drsEnv, installWriteGuard, loginSuperAdmin, makeDumper, openCombobox, visibleOptions,
} = require('../utils/drs-ui');
const state = require('../utils/drs-state');

// ===========================================================================
// DRS EXPLORATION — ROUND 4. READ-ONLY, ENFORCED.
// Our project's step 5 (SO Line Mapping) now that its SO has a line and step
// 4 has Piling mapped: is it unlocked, and what does a line offer?
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round4.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round4');

let context, page, dump;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (context) await context.close();
});

test('SO Line Mapping on our project', async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const run = state.latestProject(ENV.key);
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  await page.goto(`${ENV.baseUrl}/projects/${run.id}/configuration?step=so_line_mapping`);
  await page.waitForTimeout(3000);
  await dump('line-mapping-initial');
  const so = page.getByRole('combobox', { name: /service order/i }).first();
  if (await so.isVisible().catch(() => false)) {
    await openCombobox(page, so);
    summary.findings.soOptions = await visibleOptions(page);
    const opt = page.locator('[role="option"]:visible').filter({ hasText: run.serviceOrder.number }).first();
    if (await opt.isVisible().catch(() => false)) await opt.click();
    else await page.keyboard.press('Escape');
    await page.waitForTimeout(2000);
    await dump('line-mapping-so-picked');
    // Open whatever the first line's sub-activity picker offers (read only).
    const combos = page.getByRole('combobox');
    const n = await combos.count();
    summary.findings.combos = [];
    for (let i = 0; i < n; i += 1) {
      const c = combos.nth(i);
      const name = await c.getAttribute('aria-label').catch(() => null);
      if (/service order/i.test(name || '')) continue;
      if (!(await c.isVisible().catch(() => false))) continue;
      await openCombobox(page, c);
      summary.findings.combos.push({ name, disabled: await c.isDisabled().catch(() => null), options: (await visibleOptions(page)).slice(0, 40) });
      await page.keyboard.press('Escape').catch(() => {});
    }
    await dump('line-mapping-picker-listed');
  }
  console.log(JSON.stringify(summary.findings, null, 2));
});
