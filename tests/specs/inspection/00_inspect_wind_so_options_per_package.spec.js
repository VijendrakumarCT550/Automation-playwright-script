const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOMappingPage = require('../../pages/SOMappingPage');
const { adminFreshLogin } = require('../../utils/helpers');

// Read-only. Answers the blocker hit by tests/smoke/SM02_so_mapping.spec.js:
// mapping "5710012136 - BAUER ENGINEERING INDIA PVT LTD" onto every activity
// succeeded for all 18 CIVIL activities but TIMED OUT on the first ELECTRICAL
// activity — that option was not in its Service Order dropdown at all.
//
// Hypothesis: the per-activity Service Order list is scoped to the package /
// discipline, so a civil piling contractor's SO simply isn't offered against
// an electrical activity. If true, "one vendor mapped to ALL activities so one
// WTG CI can raise any RFI" is not achievable as stated, and the wind smoke
// chain has to either scope itself to Civil or use a different vendor per
// package.
//
// This dumps, per package, the full Service Order option list for the first
// activity row plus every BAUER entry in it, so the answer is data rather than
// inference. Never selects anything, never saves.
//
// Output is written under tests/fixtures/ NOT test-results/ — Playwright wipes
// outputDir at the start of every run, and this exact class of evidence was
// already lost once that way.
const OUT_DIR = path.join(__dirname, '..', '..', 'fixtures', 'so-mapping-baseline');

const FILTERS = {
  cluster: ['Gujarat', 'Khavda'],
  site: 'Khavda',
  projectType: 'WIND',
  workLocation: 'WTG-Khavda',
  workArea: 'KH 34',
};
const PACKAGES = ['Civil', 'Electrical', 'Mechanical'];
const TARGET_SO = '5710012136 - BAUER ENGINEERING INDIA PVT LTD';

test('Which Service Orders does each WIND package actually offer?', async ({ browser }) => {
  const { context, page, dashboard } = await adminFreshLogin(browser);
  const report = { baseUrl: process.env.BASE_URL, ...FILTERS, targetServiceOrder: TARGET_SO, packages: {} };

  try {
    const so = new SOMappingPage(page);
    await so.goto(dashboard);

    // Cascade once, then switch only the Package dropdown — re-running the
    // cascade would toggle the Work Area multi-select back off (see
    // SOMappingPage.selectWorkAreas).
    await so.selectMappingFilters({
      cluster: FILTERS.cluster,
      site: FILTERS.site,
      projectType: FILTERS.projectType,
      workLocation: FILTERS.workLocation,
      workAreas: [FILTERS.workArea],
      package: PACKAGES[0],
    });

    for (const [i, pkg] of PACKAGES.entries()) {
      if (i > 0) await so.selectPackage(pkg);

      const rows = await so.listActivityRows();
      expect(rows.length, `Package "${pkg}" rendered no activity rows`).toBeGreaterThan(0);

      // First row's SO dropdown is representative of the package's scope;
      // also probe the LAST row, in case the list varies per activity rather
      // than per package (which would be a different, worse situation).
      const probeIndexes = rows.length > 1 ? [0, rows.length - 1] : [0];
      const probes = {};

      for (const idx of probeIndexes) {
        const row = so.activityRows().nth(rows[idx].index);
        const combo = row.locator('[role="combobox"]').first();
        const listbox = await so.openDropdown(combo);
        const options = (await listbox.locator('[role="option"]').allInnerTexts())
          .map(t => t.replace(/\s*✓\s*$/, '').trim()).filter(Boolean);
        await so.closeAnyOpenListbox();

        probes[rows[idx].name] = {
          optionCount: options.length,
          hasTargetSo: options.includes(TARGET_SO),
          bauerOptions: options.filter(o => /bauer/i.test(o)),
          firstTen: options.slice(0, 10),
        };
      }

      report.packages[pkg] = {
        activityCount: rows.length,
        currentMappings: rows.map(r => ({ activity: r.name, serviceOrder: r.currentServiceOrder })),
        probes,
      };

      console.log(`\n=== ${pkg} (${rows.length} activities) ===`);
      for (const [activity, p] of Object.entries(probes)) {
        console.log(`  probe "${activity}": ${p.optionCount} SO options`);
        console.log(`    contains target ${TARGET_SO}? ${p.hasTargetSo ? 'YES' : 'NO'}`);
        console.log(`    BAUER options here (${p.bauerOptions.length}): ${JSON.stringify(p.bauerOptions)}`);
        console.log(`    first 10: ${JSON.stringify(p.firstTen)}`);
      }
    }

    console.log('\n=== VERDICT ===');
    for (const [pkg, data] of Object.entries(report.packages)) {
      const anyHasTarget = Object.values(data.probes).some(p => p.hasTargetSo);
      const anyBauer = Object.values(data.probes).some(p => p.bauerOptions.length > 0);
      console.log(`  ${pkg}: target SO available = ${anyHasTarget}; any BAUER SO available = ${anyBauer}`);
    }
  } finally {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dst = path.join(OUT_DIR, 'wind-so-options-per-package.json');
    fs.writeFileSync(dst, JSON.stringify(report, null, 2));
    console.log(`\n  [saved] ${path.relative(path.join(__dirname, '..', '..', '..'), dst)}`);
    await context.close();
  }
});
