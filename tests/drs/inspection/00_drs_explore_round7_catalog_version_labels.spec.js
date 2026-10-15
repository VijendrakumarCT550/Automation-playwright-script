const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const { DrsProjectPage } = require('../pages/DrsProjectPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 7. READ-ONLY, ENFORCED.
// 2026-10-01: D6 failed with `"v1" is not an option of Catalog version` - the
// dropdown now lists "All sites v4 / v3 / v2 / v1". A pin can never be undone,
// so before D6 is taught to pick "All sites v1", check it is the SAME v1: open
// a Work Area that D6 pinned to v1 on an earlier project and read how the app
// shows that version today (tree badge + the read-only pane). Never selects a
// version, never saves (the write guard aborts any non-GET).
// Target: DRS_EXPLORE_TAG, else the newest project that completed D6.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round7_catalog_version_labels.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round7');

let context, page, dump;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (context) await context.close();
});

test('how does an already-pinned Work Area show its version now?', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const all = state.envRecord(ENV.key).projects;
  // Newest first: every project that completed D6 (or just the one asked for).
  const candidates = process.env.DRS_EXPLORE_TAG
    ? all.filter((p) => p.tag === process.env.DRS_EXPLORE_TAG)
    : [...all].reverse().filter((p) => (p.stagesDone || []).includes('D6'));

  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);
  const proj = new DrsProjectPage(page, ENV.baseUrl);

  // A project that D6 pinned may no longer HAVE a tree ("No work locations
  // mapped to this project yet" was seen on LPW), so walk until one does.
  let run = null;
  summary.findings.treeCheck = {};
  for (const c of candidates) {
    await proj.gotoLocationStep(c.id);
    const wlItem = proj.treeItem(c.workLocation, 1);
    const has = await wlItem.waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
    summary.findings.treeCheck[c.name] = has ? 'tree present' : 'NO TREE';
    console.log('  ' + c.name + ': ' + summary.findings.treeCheck[c.name]);
    if (has) { run = c; break; }
  }
  if (!run) { console.log('  no completed project still has a work tree'); return; }
  console.log('  using ' + run.name);
  const wl = proj.treeItem(run.workLocation, 1);
  if ((await wl.getAttribute('aria-expanded')) !== 'true') await wl.click();
  await page.waitForTimeout(1500);

  const wa = run.workAreas[0];
  summary.findings.workArea = wa;
  summary.findings.recordedPin = run.pinned && run.pinned[wa];
  summary.findings.treeItemText = (await proj.treeItem(wa, 2).innerText().catch(() => '')).replace(/\s+/g, ' ');
  console.log(`  tree item "${wa}" reads: "${summary.findings.treeItemText}" (recorded pin: ${summary.findings.recordedPin})`);

  await proj.selectWorkArea(wa);
  await dump('pinned-work-area-pane');
  const combo = page.getByRole('combobox', { name: /Catalog version/i });
  summary.findings.paneCatalogVersion = (await combo.inputValue().catch(() => '')) || (await combo.innerText().catch(() => ''));
  summary.findings.paneDisabled = await combo.isDisabled().catch(() => null);
  console.log(`  pane Catalog version: "${summary.findings.paneCatalogVersion}" (disabled: ${summary.findings.paneDisabled})`);
});
