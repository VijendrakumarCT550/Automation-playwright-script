const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper, chooseOption } = require('../utils/drs-ui');
const state = require('../utils/drs-state');

// ===========================================================================
// DRS EXPLORATION — ROUND 5. READ-ONLY, ENFORCED.
// App owner, 2026-09-26: "you can pin version of catalog for multiple work
// areas at a time". How? Tries, on a project with UNPINNED Work Areas:
//   1. Ctrl+click several Work Areas in the Location Configuration tree;
//   2. Shift+click a range;
//   3. any checkbox / multi-select affordance on Work Area rows or the pane.
// Dumps the pane after each, never saves (the write guard aborts any save).
// Target: DRS_EXPLORE_TAG, else the newest project that has D5 but not D6.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round5.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round5');

let context, page, dump;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (context) await context.close();
});

test('multi-select catalog version pinning', async ({ browser }) => {
  test.setTimeout(8 * 60 * 1000);
  const projects = state.envRecord(ENV.key).projects;
  const run = process.env.DRS_EXPLORE_TAG
    ? projects.find((p) => p.tag === process.env.DRS_EXPLORE_TAG)
    : [...projects].reverse().find((p) => (p.stagesDone || []).includes('D5'));
  console.log(`  project ${run.name}`);
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  await page.goto(`${ENV.baseUrl}/projects/${run.id}/configuration?step=location_config`);
  await page.getByRole('combobox', { name: 'Cluster', exact: true }).first().waitFor({ state: 'visible', timeout: 60000 });
  await chooseOption(page, page.getByRole('combobox', { name: 'Cluster', exact: true }).first(), run.cluster);
  await chooseOption(page, page.getByRole('combobox', { name: 'Site', exact: true }).first(), run.site);
  const wl = page.getByRole('treeitem', { name: run.workLocation, exact: true, level: 1 });
  await wl.click();
  await page.waitForTimeout(1500);
  await dump('tree-expanded');

  // Checkbox-like affordances anywhere in the tree or toolbar.
  summary.findings.checkboxes = await page.getByRole('checkbox').count();
  summary.findings.toolbarButtons = await page.locator('button:visible').allInnerTexts().then((t) => t.map((x) => x.trim()).filter(Boolean).slice(0, 40));
  summary.findings.treeMultiselectable = await page.getByRole('tree').first().getAttribute('aria-multiselectable');

  const wa = (n) => page.getByRole('treeitem', { name: n, exact: true, level: 2 });
  // 1. Ctrl+click BL07, BL08, BL09
  await wa('BL07').click();
  await wa('BL08').click({ modifiers: ['Control'] });
  await wa('BL09').click({ modifiers: ['Control'] });
  await page.waitForTimeout(1000);
  summary.findings.selectedAfterCtrl = await page.locator('[role="treeitem"][aria-selected="true"]').allInnerTexts()
    .then((t) => t.map((x) => x.split('\n')[0].trim()));
  await dump('after-ctrl-click');

  // 2. Shift+click range BL07..BL11
  await wa('BL07').click();
  await wa('BL11').click({ modifiers: ['Shift'] });
  await page.waitForTimeout(1000);
  summary.findings.selectedAfterShift = await page.locator('[role="treeitem"][aria-selected="true"]').allInnerTexts()
    .then((t) => t.map((x) => x.split('\n')[0].trim()));
  await dump('after-shift-click');

  // 3. The Work Location pane itself (a bulk version control could live there).
  await wl.click();
  await page.waitForTimeout(1000);
  await dump('work-location-pane');
  console.log(JSON.stringify(summary.findings, null, 2));
});
