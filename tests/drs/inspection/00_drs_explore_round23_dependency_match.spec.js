const { test } = require('@playwright/test');
const { drsEnv, installWriteGuard, loginSuperAdmin } = require('../utils/drs-ui');
const PackagesConfiguratorPage = require('../../drs-setting/PackagesConfiguratorPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 23. READ-ONLY, ENFORCED.
// The dependency check still "finds" PC04.1.2 Checkpoint b on PC04.1.2 Checkpoint c
// after the removal, while the panel reads "No preceding inspection points". Which
// element(s) match "(^|— )PC04.1.2 Checkpoint b$" in the edit panel?
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round23_dependency_match.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();

test('what matches the dependency name', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, []);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const pc = new PackagesConfiguratorPage(page, ENV.baseUrl);
  await pc.goto();
  await pc.selectProjectTypeAndSite('All sites');
  await pc.openDraft('All sites v8');
  for (const n of ['Civil', 'PC04 Sub Package', 'PC04.1 Activity', 'PC04.1.2 Sub Activity']) await pc.expand(n);
  await pc.select('PC04.1.2 Checkpoint c');
  const edit = pc.editPanel();
  console.log('  tabpanels:', await page.getByRole('tabpanel').count());
  const hits = await edit.evaluate((root) => [...root.querySelectorAll('*')]
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /PC04\.1\.2 Checkpoint b/.test(n.textContent)))
    .map((el) => {
      const r = el.getBoundingClientRect();
      return { tag: el.tagName, text: el.textContent.trim().slice(0, 120), visible: r.width > 0 && r.height > 0,
        inOption: !!el.closest('[role="option"],[role="listbox"]'), outer: el.outerHTML.slice(0, 200) };
    }));
  console.log('  matches:', JSON.stringify(hits, null, 1));
  console.log('  hasDependency ->', await pc.hasDependency(edit, 'PC04.1.2 Checkpoint b', 2000));
  await context.close();
});
