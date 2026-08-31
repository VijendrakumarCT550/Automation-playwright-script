const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOMappingPage = require('../pages/SOMappingPage');
const { adminFreshLogin } = require('../utils/helpers');

// Read-only recon for the SOLAR E2E smoke chain, which the app owner wants to
// carry the MOBILE coverage: mobile's differences are layout (cards vs grid,
// two-screen review, drawer nav, CSS-truncated code) and are identical whatever
// the project type — while solar has MANY Work Sections per Work Area, so it
// never exhausts and never gets stuck on an orphaned RFI the way wind does. WTG
// keeps the dependency / one-Work-Section-per-area coverage.
//
// Establishes the two things SOLAR_E2E cannot be filled in without:
//
//   1. WHICH WORK AREAS ARE SAFE. The existing suite only ever uses BL0x areas
//      under A-06c: BL02 is under constant churn from the tracked 9-TC RFI
//      regression, BL09/BL10 belong to the dependency specs (29/30), and
//      BL01/BL03-BL08 appear across the bulk-create and NC specs. A-06c has far
//      more areas than that (WAMPage records 85 total rows including Road/Drain/
//      Culvert entries), so this lists them all and flags the NON-BL0x ones as
//      candidates — almost certainly untouched by anything in the repo.
//
//   2. THE VENDOR AND ITS EXACT SERVICE ORDER STRING. The app owner has
//      corrected this: for A-06c it must be M S CHOUHAN, not the ADVAIT vendor
//      originally named for the (since-dropped) A16b location — ADVAIT simply
//      has no service order here. Service Order options are scoped to the work
//      location and package (proved for wind: BAUER appears under Civil but not
//      under Electrical or Mechanical), and solar SOs carry a 481... prefix
//      versus wind's 571... — 07_wam_ci.spec.js records CHOUHAN's solar SO as
//      4810024058.
//
//      This reports EVERY CHOUHAN and EVERY ADVAIT option, so the choice is made
//      from what the app actually offers rather than assumed. The BAUER lesson
//      applies: one vendor can hold several service orders (BAUER has five) and
//      a name-only match silently picks the wrong one.
//
//      It matters beyond SO mapping: a contractor user created under a vendor
//      with no SO at this location would have no activity access, so whichever
//      vendor wins here is also the vendor SOLAR_E2E must create its CI/CM
//      under.
//
// Never selects a Service Order and never saves.
const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'so-mapping-baseline');

const FILTERS = {
  cluster: ['Gujarat', 'Khavda'],
  site: 'Khavda',
  projectType: 'SOLAR',
  workLocation: 'A-06c',
  package: 'Civil',
};

// Work areas the existing suite is known to touch — see the header comment.
const KNOWN_IN_USE = /^BL0?\d+$/i;
// Both candidates, so the run produces evidence either way rather than only
// confirming what we expect.
const VENDOR_PATTERNS = {
  chouhan: /chouhan/i,
  advait: /advait/i,
};
// From 07_wam_ci.spec.js's note on the solar CHOUHAN service order.
const EXPECTED_CHOUHAN_SO_NUMBER = '4810024058';

async function listOptions(so, dropdown, label) {
  const listbox = await so.openDropdown(dropdown);
  const texts = (await listbox.locator('[role="option"]').allInnerTexts())
    .map((t) => t.replace(/\s*✓\s*$/, '').trim())
    .filter(Boolean);
  await so.closeAnyOpenListbox();
  console.log(`  ${label}: ${texts.length} option(s)`);
  return texts;
}

test('SOLAR E2E ground: A-06c work areas and the CHOUHAN service order', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);

  const { context, page, dashboard } = await adminFreshLogin(browser);
  const report = { baseUrl: process.env.BASE_URL, ...FILTERS };

  try {
    const so = new SOMappingPage(page);
    await so.goto(dashboard);

    await so.waitForDropdownOptions(so.clusterDropdown);
    await so.selectDropdownOptionAny(so.clusterDropdown, FILTERS.cluster);
    await so.selectDropdownOption(so.siteDropdown, FILTERS.site);
    await so.selectDropdownOption(so.projectTypeDropdown, FILTERS.projectType);
    await so.selectDropdownOption(so.workLocationDropdown, FILTERS.workLocation);

    // ---- 1. Work areas ----
    const areas = await listOptions(so, so.workAreaDropdown, 'Work Area (SOLAR / A-06c)');
    report.workAreas = areas;
    const inUse = areas.filter((a) => KNOWN_IN_USE.test(a.trim()));
    const candidates = areas.filter((a) => !KNOWN_IN_USE.test(a.trim()));
    report.knownInUse = inUse;
    report.candidates = candidates;

    console.log(`\n  BL0x areas the existing suite uses (${inUse.length}): ${JSON.stringify(inUse)}`);
    console.log(`  NON-BL candidates for the solar smoke chain (${candidates.length}):`);
    console.log(`    ${JSON.stringify(candidates)}`);

    // ---- 2. The vendor's service order, on a real activity row ----
    const firstArea = candidates[0] || areas[0];
    report.workAreaProbed = firstArea;
    await so.selectWorkAreas([firstArea]);
    await so.selectDropdownOption(so.packageDropdown, FILTERS.package);
    await page.waitForTimeout(1500);

    const rows = await so.listActivityRows();
    report.activities = rows.map((r) => ({ activity: r.name, serviceOrder: r.currentServiceOrder }));
    expect(rows.length, `No activity rows for ${FILTERS.workLocation} / ${firstArea} / ${FILTERS.package}`)
      .toBeGreaterThan(0);
    console.log(`\n  ${FILTERS.package} activities at ${firstArea} (${rows.length}):`);
    for (const r of rows) console.log(`    ${r.name}  ->  ${r.currentServiceOrder}`);

    const combo = so.activityRows().nth(rows[0].index).locator('[role="combobox"]').first();
    const soOptions = await listOptions(so, combo, 'Service Order options');
    report.serviceOrderOptionCount = soOptions.length;
    report.chouhanOptions = soOptions.filter((o) => VENDOR_PATTERNS.chouhan.test(o));
    report.advaitOptions = soOptions.filter((o) => VENDOR_PATTERNS.advait.test(o));
    report.expectedChouhanSo =
      report.chouhanOptions.find((o) => o.includes(EXPECTED_CHOUHAN_SO_NUMBER)) || null;

    console.log(`\n  CHOUHAN options (${report.chouhanOptions.length}): ${JSON.stringify(report.chouhanOptions)}`);
    console.log(`  ADVAIT options  (${report.advaitOptions.length}): ${JSON.stringify(report.advaitOptions)}`);
    console.log(
      `  SO containing ${EXPECTED_CHOUHAN_SO_NUMBER} (per 07_wam_ci.spec.js): ` +
      `${JSON.stringify(report.expectedChouhanSo)}`
    );
    if (report.advaitOptions.length === 0) {
      console.log('  >>> ADVAIT has no service order here, exactly as the app owner said — so');
      console.log('      SOLAR_E2E must use CHOUHAN for BOTH the SO mapping and the CI/CM vendor.');
    }
    expect(
      report.chouhanOptions.length,
      'Expected at least one M S CHOUHAN service order at this solar location/package'
    ).toBeGreaterThan(0);

    console.log('\n  ================ FOR SOLAR_E2E ================');
    console.log(`  workAreas candidates : ${JSON.stringify(candidates.slice(0, 8))}`);
    console.log('  vendor.name          : "M S CHOUHAN INFRAVENTURES"');
    console.log(
      `  vendor.serviceOrder  : ` +
      `${JSON.stringify(report.expectedChouhanSo || report.chouhanOptions[0] || null)}`
    );
  } finally {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dst = path.join(OUT_DIR, 'solar-e2e-ground.json');
    fs.writeFileSync(dst, JSON.stringify(report, null, 2));
    console.log(`\n  [saved] ${path.relative(path.join(__dirname, '..', '..'), dst)}`);
    await context.close();
  }
});
