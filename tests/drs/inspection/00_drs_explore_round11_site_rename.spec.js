const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const DrsAppSettingsPage = require('../pages/DrsAppSettingsPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 11. READ-ONLY, ENFORCED.
// 2026-10-15: Pulse shows TWO "AUTOMATION SITE"s - the one DRS lost in a UAT
// redeploy kept its uuid in Pulse, and D01 then created a new one with the same
// name. App owner: rename OUR site to "Automation Site 01" so it is distinct.
// Before renaming: does App Settings -> Locations Configurator let a Site's Name be
// edited (enabled Name field + Save), and is there exactly one "AUTOMATION SITE"
// under Rajasthan? Types the new name to see Save enable, never clicks Save
// (the write guard aborts any non-GET anyway).
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round11_site_rename.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round11');
const CLUSTER = 'Rajasthan';
const SITE = 'AUTOMATION SITE';

let context, page, dump;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (context) await context.close();
});

test('can a Site be renamed in the Locations Configurator?', async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const f = summary.findings;
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);
  const app = new DrsAppSettingsPage(page, ENV.baseUrl);

  await app.gotoLocations();
  const cluster = app.treeItem(CLUSTER, 1);
  await cluster.waitFor({ state: 'visible', timeout: 30000 });
  if ((await cluster.getAttribute('aria-expanded')) !== 'true') { await cluster.click(); await page.waitForTimeout(1500); }
  f.sitesUnderCluster = await page.getByRole('treeitem', { level: 2 }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
  f.sameNameCount = f.sitesUnderCluster.filter((n) => n === SITE).length;
  console.log(`  sites under ${CLUSTER}: ${JSON.stringify(f.sitesUnderCluster)} ("${SITE}" x${f.sameNameCount})`);

  const site = app.treeItem(SITE, 2);
  await site.click();
  await page.waitForTimeout(1500);
  await dump('01-site-selected');
  const nameBox = page.getByRole('textbox', { name: 'Name*' });
  f.nameValue = await nameBox.inputValue().catch(() => null);
  f.nameEditable = await nameBox.isEditable().catch(() => false);
  f.paneButtons = (await page.getByRole('button').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  f.paneText = (await page.locator('main').innerText().catch(() => '')).slice(0, 1200);
  console.log(`  pane Name="${f.nameValue}" editable=${f.nameEditable}; buttons: ${JSON.stringify(f.paneButtons)}`);

  if (f.nameEditable) {
    await nameBox.fill('Automation Site 01');
    await page.waitForTimeout(800);
    const save = page.getByRole('button', { name: 'Save', exact: true });
    f.saveEnabledAfterTyping = await save.isEnabled().catch(() => false);
    console.log(`  after typing the new name: Save enabled=${f.saveEnabledAfterTyping}`);
    await dump('02-new-name-typed-not-saved');
    const reset = page.getByRole('button', { name: 'Reset', exact: true });
    if (await reset.isVisible().catch(() => false)) await reset.click();
  }
});
