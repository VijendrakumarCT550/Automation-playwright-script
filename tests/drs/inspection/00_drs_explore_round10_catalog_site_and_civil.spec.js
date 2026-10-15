const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const PackagesConfiguratorPage = require('../../drs-setting/PackagesConfiguratorPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 10. READ-ONLY, ENFORCED.
// 2026-10-15, before building catalog versions for AUTOMATION SITE (app owner):
//   1. What does Catalog version offer for Solar + AUTOMATION SITE (no catalog of
//      its own yet)? Is "New draft" offered while a locked "All sites v1" is chosen?
//   2. The Civil package: is its tree editable like Electrical (Add Sub-Package
//      on the package node)? What sub-packages / activities does it hold?
//   3. The sub-package Letter field: does its edit form show a length limit or
//      pattern hint (we want 4-character codes like PC01)?
// Never saves (the write guard aborts any non-GET). Never clicks New draft.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round10_catalog_site_and_civil.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round10');
const SITE = process.env.DRS_CATALOG_SITE || 'AUTOMATION SITE';

let context, page, dump;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (context) await context.close();
});

const treeLabels = () => page.getByRole('treeitem').evaluateAll((els) => els.map((e) => ({
  name: e.getAttribute('aria-label'), level: e.getAttribute('aria-level'), expanded: e.getAttribute('aria-expanded'),
})));

test('catalog versions for AUTOMATION SITE, and the Civil tree', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const f = summary.findings;
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);
  const pc = new PackagesConfiguratorPage(page, ENV.baseUrl);

  await pc.goto();
  f.sites = await pc.optionLabels('Site');
  console.log('  Site options:', f.sites);
  await pc.selectProjectTypeAndSite(SITE);
  f.versions = await pc.optionLabels('Catalog version');
  console.log(`  ${SITE} catalog versions:`, f.versions);
  const v1 = f.versions.find((l) => /^All sites v1\b/i.test(l));
  if (v1) await pc.choose('Catalog version', new RegExp(`^${v1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
  f.chosen = v1;
  f.url = page.url();
  f.buttons = (await page.getByRole('button').allInnerTexts()).map((t) => t.trim()).filter(Boolean).slice(0, 40);
  f.newDraftVisible = await page.getByRole('button', { name: 'New draft' }).isVisible().catch(() => false);
  f.lockedBanner = await page.getByText(/is locked and cannot be edited/i).first().innerText().catch(() => '');
  console.log(`  chose "${v1}" -> New draft visible: ${f.newDraftVisible}; banner: "${f.lockedBanner}"`);
  await dump('01-site-all-sites-v1');

  f.topLevel = await treeLabels();
  console.log('  top-level tree:', f.topLevel.map((t) => `${t.level}:${t.name}`).join(' | '));

  for (const pkg of ['Civil', 'Electrical']) {
    if (!(await pc.has(pkg))) { f[pkg] = 'NOT IN TREE'; console.log(`  ${pkg}: not in tree`); continue; }
    await pc.expand(pkg);
    await page.waitForTimeout(800);
    const all = await treeLabels();
    f[pkg] = all.filter((t) => Number(t.level) === 2).map((t) => t.name);
    console.log(`  ${pkg} sub-packages (${f[pkg].length}):`, f[pkg]);
    f[`${pkg}Menu`] = await page.getByRole('button', { name: `Add or delete ${pkg}`, exact: true }).count();
    await dump(`02-${pkg.toLowerCase()}-expanded`);
    // One level deeper on the first sub-package, to see the activity shape.
    const firstSub = f[pkg][0];
    if (firstSub) {
      await pc.expand(firstSub).catch(() => {});
      const deeper = await treeLabels();
      f[`${pkg}FirstSubChildren`] = deeper.filter((t) => Number(t.level) === 3).map((t) => t.name).slice(0, 15);
      console.log(`  ${pkg} / ${firstSub} children:`, f[`${pkg}FirstSubChildren`]);
      await pc.select(firstSub);
      const panel = page.getByRole('tabpanel').first();
      f[`${pkg}SubPanel`] = (await panel.innerText().catch(() => '')).slice(0, 800);
      const letter = panel.getByLabel('Letter');
      f[`${pkg}LetterAttrs`] = await letter.evaluate((el) => ({
        maxLength: el.maxLength, pattern: el.pattern, placeholder: el.placeholder, value: el.value, disabled: el.disabled,
      })).catch(() => 'no Letter field (locked version?)');
      console.log(`  ${pkg} sub-package Letter field:`, JSON.stringify(f[`${pkg}LetterAttrs`]));
      await dump(`03-${pkg.toLowerCase()}-sub-package-pane`);
      // collapse back
      await pc.select(pkg).catch(() => {});
    }
  }
});
