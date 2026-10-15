const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper, openCombobox } = require('../utils/drs-ui');
const state = require('../utils/drs-state');

// ===========================================================================
// DRS EXPLORATION — ROUND 12. READ-ONLY, ENFORCED.
// 2026-10-15, app owner: "only same catalog version sub-activity should be against
// one SO line - please check". Lists every sub-activity chip on every SO line of a
// project's SO, with the version in its label, and FAILS if a line holds a chip of
// any version but its own (serviceOrder.lines[].version in the state file).
// Target: DRS_PROJECT_TAG, else the newest project with D9 done.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round12_so_line_versions.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round12');
let context;
const blocked = [];
const summary = { screens: [], lines: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  if (context) await context.close();
});

test('every SO line holds only its own catalog version\'s sub-activities', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const all = state.envRecord(ENV.key).projects;
  const run = process.env.DRS_PROJECT_TAG
    ? all.find((p) => p.tag === process.env.DRS_PROJECT_TAG)
    : [...all].reverse().find((p) => (p.stagesDone || []).includes('D9'));
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  const dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  // One SO per package since 2026-10-15 (serviceOrders); older projects have one.
  const sos = run.serviceOrders ? Object.values(run.serviceOrders) : [{ ...run.serviceOrder, package: 'Civil' }];
  const wrong = [];
  for (const soRec of sos) {
  await page.goto(`${ENV.baseUrl}/projects/${run.id}/configuration?step=so_line_mapping`);
  const so = page.getByRole('combobox', { name: 'Select a service order' });
  await so.waitFor({ state: 'visible', timeout: 60000 });
  if (!(await so.inputValue().catch(() => '')).startsWith(soRec.number)) {
    await openCombobox(page, so);
    await page.locator('[role="option"]:visible').filter({ hasText: soRec.number }).first().click();
  }
  await page.getByText(/S\.O\. Activity/).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1500);
  await dump(`so-lines-${soRec.package}`);
  console.log(`  SO ${soRec.number} (${soRec.package}): ${soRec.lines.length} line(s)`);

  for (const line of soRec.lines) {
    const key = `${soRec.package} ${line.lineNumber}-${line.serviceItemNo}`;
    const caption = new RegExp(`^\\s*${line.lineNumber}-${line.serviceItemNo}\\s+S\\.O\\. Activity`);
    const card = page.getByText(caption).first().locator('xpath=ancestor::div[.//*[@role="combobox"]][1]');
    // Every chip on the card: own text naming a version ("— Solar · <label> —").
    const chips = await card.evaluate((root) => [...root.querySelectorAll('p, span, div')]
      .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /—\s*\w+\s*·/.test(n.textContent || '')))
      .filter((el) => !el.closest('[role="listbox"], [role="option"]'))
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
      .map((el) => el.textContent.trim()));
    const unique = [...new Set(chips)];
    const versionOf = (t) => ((t.match(/·\s*(.+?\s+v\d+)\s+—/) || [])[1] || '?');
    const byVersion = {};
    for (const c of unique) (byVersion[versionOf(c)] = byVersion[versionOf(c)] || []).push(c);
    summary.lines[key] = { expected: line.version, byVersion };
    console.log(`  ${key} (expected ${line.version}): ${unique.length} chip(s) -> ${Object.entries(byVersion).map(([v, l]) => `${v}: ${l.length}`).join(', ')}`);
    for (const c of unique) console.log(`      ${c}`);
    for (const v of Object.keys(byVersion)) if (v !== line.version) wrong.push(`${key}: ${byVersion[v].length} chip(s) of ${v}`);
    // Planned lines hold exactly their plan: a service-code line its whole group,
    // one of our own lines its pair - at most 2 (app owner, 2026-10-15).
    if (line.subActivities && unique.length !== line.subActivities.length) {
      wrong.push(`${key}: ${unique.length} sub-activities, planned ${line.subActivities.length}`);
    }
    if (line.subActivities && !line.group && unique.length > 2) wrong.push(`${key}: ${unique.length} sub-activities (max 2 for our own)`);
    if (!unique.length) wrong.push(`${key}: no sub-activity mapped`);
  }
  }
  expect(wrong, 'SO lines breaking the rules (one version, exactly the plan, max 2 for our own, not empty)').toEqual([]);
});
