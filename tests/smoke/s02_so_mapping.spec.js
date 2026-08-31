const fs = require('fs');
const path = require('path');
const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const SOMappingPage = require('../pages/SOMappingPage');

// Stage 2 of the E2E smoke chain: map the profile's Service Order onto EVERY
// activity of every package, for the profile's work area — so the single
// contractor user created in stage 1 has access to all activities when raising
// RFIs (app owner's instruction).
//
// This stage MUTATES SHARED APP DATA. On the wind work area KH 34 the recon
// found real, pre-existing mappings that this replaces:
//   Civil       Stone Column's 2 activities  -> already 5710012136 BAUER
//               WTG Foundation + USS Civil   -> 5710014198 BHAWANI CONSTRUCTION
//               Fencing                      -> unmapped
//               Crane Pad                    -> 5710012743 S S JADEJA
//   Electrical  all 8                        -> 5710013590 AERIS ENGINEERS
//   Mechanical  all 8                        -> unmapped
// The app owner explicitly approved overwriting KH 34. Even so, this writes a
// baseline of the pre-change state to test-results/ before touching anything —
// the WAM CRUD work (docs/wam-crud-coverage.md) destroyed real shared data
// once, and a recorded baseline is the difference between "restorable" and
// "gone".
//
// Serial: every test here drives the same admin page/session.
test.describe.configure({ mode: 'serial' });

// NOT under test-results/ on purpose: Playwright wipes outputDir at the start
// of every run, which would delete the record of the pre-change state on the
// very next run — exactly when it is most needed. Same reasoning as
// rfi-tracker.json / user-creation-counter.json (see tracker-utils.js).
const BASELINE_DIR = path.join(__dirname, '..', 'fixtures', 'so-mapping-baseline');

test.describe('Smoke stage 2 - SO Mapping for a project type', () => {
  let context, page, dashboard, profile;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    ({ context, page, dashboard } = await adminFreshLogin(browser));
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  test('map the profile Service Order onto every activity in every package', async () => {
    const workLocation = profile.workLocations[0];
    const workArea = profile.primaryWorkArea;
    const serviceOrder = profile.vendor.serviceOrder;

    expect(workArea, `Profile "${profile.key}" has no primaryWorkArea set`).toBeTruthy();
    expect(serviceOrder, `Profile "${profile.key}" has no vendor.serviceOrder set`).toBeTruthy();
    // Guard against the exact mistake the recon caught: a bare vendor name
    // resolves to the wrong SO when a vendor has several.
    expect(
      serviceOrder,
      'vendor.serviceOrder must be the full "<number> - <VENDOR>" string, not just the vendor name'
    ).toMatch(/^\d{8,}\s*-\s*\S/);

    const so = new SOMappingPage(page);
    await so.goto(dashboard);

    const baseline = {
      profile: profile.key,
      baseUrl: process.env.BASE_URL,
      projectType: profile.projectType,
      workLocation, workArea,
      targetServiceOrder: serviceOrder,
      packages: {},
    };
    const summary = {};

    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    const baselineFile = path.join(
      BASELINE_DIR, `${profile.key}-${workArea.replace(/\s+/g, '')}.json`
    );
    // Flushed after EVERY package, before that package is mutated — not once
    // at the end. Learned the hard way: the first run of this spec failed on
    // the second package, after Civil had already been fully remapped, and
    // because the write was after the loop NO baseline was saved for the
    // package it had already changed. A baseline that only exists on success
    // is not a baseline.
    const flushBaseline = () =>
      fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));

    // Run the filter cascade ONCE, for the first package. Subsequent packages
    // switch only the Package dropdown (so.selectPackage) — re-running the
    // whole cascade re-clicks the already-selected Work Area in its
    // multi-select and TOGGLES IT OFF, after which the page renders zero
    // activity rows. Confirmed live; see SOMappingPage.selectWorkAreas.
    await so.selectMappingFilters({
      cluster: profile.cluster,
      site: profile.site,
      projectType: profile.projectType,
      workLocation,
      workAreas: [workArea],
      package: profile.packages[0],
    });

    for (const [i, pkg] of profile.packages.entries()) {
      if (i > 0) await so.selectPackage(pkg);

      const before = await so.listActivityRows();
      baseline.packages[pkg] = before.map(r => ({
        activity: r.name, serviceOrder: r.currentServiceOrder,
      }));
      flushBaseline();
      expect(
        before.length,
        `Package "${pkg}" rendered no activity rows for ${workLocation} / ${workArea}`
      ).toBeGreaterThan(0);

      console.log(`\n  --- ${pkg}: ${before.length} activities, current state ---`);
      for (const r of before) console.log(`    ${r.name}  ->  ${r.currentServiceOrder}`);

      const result = await so.selectServiceOrderForAllActivities(serviceOrder);
      summary[pkg] = result;

      console.log(`  --- ${pkg}: remapped ${result.changed.length}, already correct ${result.alreadySet.length} ---`);
      for (const c of result.changed) console.log(`    ${c.name}: "${c.from}" -> "${c.to}"`);

      await so.clickSave();
    }

    console.log(`\n  [baseline saved] ${path.relative(path.join(__dirname, '..', '..'), baselineFile)}`);

    // ---- Verify persistence by re-opening each package fresh ----
    // Each Service Order selection auto-saves via its own POST (see
    // SOMappingPage.selectServiceOrder's comment); Save is clicked because
    // that is the real workflow, but the persistence guarantee comes from
    // re-reading, not from the button.
    await page.goto(`${process.env.BASE_URL}/so-mapping`);
    await so.waitForLoad();

    // Same cascade-once-then-switch-package rule as above: after the reload
    // nothing is selected, so the first call is a fresh selection and every
    // later package only swaps the Package dropdown.
    await so.selectMappingFilters({
      cluster: profile.cluster,
      site: profile.site,
      projectType: profile.projectType,
      workLocation,
      workAreas: [workArea],
      package: profile.packages[0],
    });

    for (const [i, pkg] of profile.packages.entries()) {
      if (i > 0) await so.selectPackage(pkg);

      const after = await so.listActivityRows();
      const wrong = after.filter(r => r.currentServiceOrder !== serviceOrder);
      expect(
        wrong.map(r => `${r.name} -> ${r.currentServiceOrder}`),
        `Every activity in "${pkg}" should now be mapped to "${serviceOrder}"`
      ).toEqual([]);
      console.log(`  ${pkg}: all ${after.length} activities confirmed on the target SO after reload`);
    }
  });
});
