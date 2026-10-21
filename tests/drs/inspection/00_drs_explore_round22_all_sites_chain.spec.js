const { test } = require('@playwright/test');
const { drsEnv, installWriteGuard, loginSuperAdmin } = require('../utils/drs-ui');
const PackagesConfiguratorPage = require('../../drs-setting/PackagesConfiguratorPage');
const DATA = require('../drs-data');

// ===========================================================================
// DRS EXPLORATION — ROUND 22. READ-ONLY, ENFORCED.
// Before the onboarding suite drafts the ALL SITES chain (one open draft per chain):
// what does the Solar catalog list for "All sites" and for our site today, and is
// an All-sites draft already open (one was seen on 2026-10-15: "All sites v6 —
// draft", not ours)? For an open draft: its sub-packages, to see what it is.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round22_all_sites_chain.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();

test('All sites + site chains: versions and open drafts', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, []);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const pc = new PackagesConfiguratorPage(page, ENV.baseUrl);
  for (const site of ['All sites', DATA.site]) {
    await pc.goto();
    await pc.selectProjectTypeAndSite(site);
    const labels = await pc.optionLabels('Catalog version');
    console.log(`  ${site}: ${JSON.stringify(labels)}`);
    const draft = labels.find((l) => /—\s*draft$/i.test(l));
    if (draft && site === 'All sites') {
      await pc.choose('Catalog version', new RegExp(`^${draft.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
      console.log(`    open draft "${draft}": Civil ${JSON.stringify(await pc.subPackageNames('Civil'))}`);
      console.log(`    Electrical ${JSON.stringify(await pc.subPackageNames('Electrical'))}`);
    }
  }
  await context.close();
});
