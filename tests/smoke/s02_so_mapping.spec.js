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

  // Iterates profile.workAreas rather than assuming a single primaryWorkArea.
  //
  // For wind that list currently holds exactly ONE entry — KH 34, the only area
  // the app owner approved for overwriting — so this is behaviourally identical
  // to before. The loop exists because the checkpoint-dependency stage will
  // need TWO work areas: wind has exactly ONE Work Section per Work Area
  // (confirmed live), which is solar's "Block" granularity case, and that
  // forces the two-Work-Areas strategy — a throwaway area for the
  // deliberately-blocked attempts and a clean one for the real chain (see
  // runDependencyChainForScarceWorkSectionActivity in rfi-dependency-flow.js).
  //
  // Adding that second area is a one-line profile change, but it also means
  // overwriting a second area's existing Service Order mappings, so it needs
  // the app owner's explicit go-ahead first — hence the capability is here but
  // the list is not yet extended.
  test('map the profile Service Order onto every activity in every package', async () => {
    const workLocation = profile.workLocations[0];
    const workAreas = (profile.workAreas && profile.workAreas.filter(Boolean).length)
      ? profile.workAreas.filter(Boolean)
      : [profile.primaryWorkArea].filter(Boolean);
    const serviceOrder = profile.vendor.serviceOrder;

    expect(workAreas.length, `Profile "${profile.key}" has no work areas set`).toBeGreaterThan(0);
    expect(serviceOrder, `Profile "${profile.key}" has no vendor.serviceOrder set`).toBeTruthy();
    // Guard against the exact mistake the recon caught: a bare vendor name
    // resolves to the wrong SO when a vendor has several (BAUER has five).
    expect(
      serviceOrder,
      'vendor.serviceOrder must be the full "<number> - <VENDOR>" string, not just the vendor name'
    ).toMatch(/^\d{8,}\s*-\s*\S/);

    const so = new SOMappingPage(page);
    await so.goto(dashboard);

    // ---- Phase 1: capture each work area's pre-change state, READ-ONLY ----
    //
    // Done per area because that is the only way to know what EACH area held
    // before it was overwritten — with several areas selected at once the
    // activity row shows the union, not the individual values. This phase never
    // mutates anything, so it is cheap: one cascade and one row read per area,
    // no dropdown selections.
    for (const workArea of workAreas) {
      console.log(`\n########## baseline: ${workLocation} / ${workArea} ##########`);
      await captureBaseline({ so, workLocation, workArea, serviceOrder });
    }

    // ---- Phase 2: map ALL work areas in ONE pass ----
    //
    // Work Area is a multi-select, so every named area can be selected together
    // and the Service Order set once per activity for all of them — which is how
    // 05_so_mapping.spec.js has always done solar (ten BL0x areas in a single
    // pass). Mapping per area instead would repeat the expensive part (one
    // dropdown open + select per activity, ~16 per package) once per area for no
    // benefit.
    console.log(`\n########## mapping ${workAreas.length} work area(s) in one pass: ${workAreas.join(', ')} ##########`);
    await mapAllWorkAreas({ so, workLocation, workAreas, serviceOrder });
  });

  // READ-ONLY. Records what one work area currently holds, per package.
  async function captureBaseline({ so, workLocation, workArea, serviceOrder }) {
    // Reload first: Work Area is a MULTI-select and selectWorkAreas correctly
    // skips already-checked options, so without a reset the next area would be
    // ADDED to the previous one and this baseline would describe the union
    // instead of the area it names.
    await page.goto(`${process.env.BASE_URL}/so-mapping`);
    await page.waitForLoadState('networkidle');
    await so.waitForLoad();

    const baseline = {
      profile: profile.key,
      baseUrl: process.env.BASE_URL,
      projectType: profile.projectType,
      workLocation, workArea,
      targetServiceOrder: serviceOrder,
      packages: {},
    };

    fs.mkdirSync(BASELINE_DIR, { recursive: true });
    const baselineFile = path.join(
      BASELINE_DIR, `${profile.key}-${workArea.replace(/\s+/g, '')}.json`
    );
    // Flushed after EVERY package rather than once at the end. Learned the hard
    // way: an early run of this spec died on the second package after the first
    // had already been remapped, and because the write came after the loop NO
    // baseline existed for the package it had already changed. A baseline that
    // only exists on success is not a baseline. (Now that capture is a separate
    // read-only phase this is less critical, but a per-package flush still costs
    // nothing and keeps the guarantee.)
    const flushBaseline = () =>
      fs.writeFileSync(baselineFile, JSON.stringify(baseline, null, 2));

    // Cascade ONCE, for the first package. Later packages switch only the
    // Package dropdown (so.selectPackage) — re-running the whole cascade
    // re-clicks the already-selected Work Area in its multi-select and TOGGLES
    // IT OFF, after which the page renders zero activity rows. Confirmed live;
    // see SOMappingPage.selectWorkAreas.
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

      console.log(`  ${pkg}: ${before.length} activities`);
      for (const r of before) console.log(`    ${r.name}  ->  ${r.currentServiceOrder}`);
    }

    console.log(`  [baseline saved] ${path.relative(path.join(__dirname, '..', '..'), baselineFile)}`);
  }

  // MUTATES. Selects EVERY named work area at once and sets the Service Order
  // once per activity, for all of them together.
  async function mapAllWorkAreas({ so, workLocation, workAreas, serviceOrder }) {
    await page.goto(`${process.env.BASE_URL}/so-mapping`);
    await page.waitForLoadState('networkidle');
    await so.waitForLoad();

    // All areas in one multi-select, exactly as 05_so_mapping.spec.js does for
    // solar's ten BL0x areas.
    await so.selectMappingFilters({
      cluster: profile.cluster,
      site: profile.site,
      projectType: profile.projectType,
      workLocation,
      workAreas,
      package: profile.packages[0],
    });

    for (const [i, pkg] of profile.packages.entries()) {
      if (i > 0) await so.selectPackage(pkg);

      const before = await so.listActivityRows();
      expect(
        before.length,
        `Package "${pkg}" rendered no activity rows for ${workLocation} / ${workAreas.join(' + ')}`
      ).toBeGreaterThan(0);

      // With several areas selected, an activity's combobox reflects the UNION
      // of their values — the app even has a "Multiple SOs" option for that
      // state — so a row only reads as already-correct when EVERY selected area
      // already holds the target. That makes the existing skip logic behave
      // correctly here without special-casing: mixed rows don't match the target
      // string and get mapped, uniform-and-correct rows are skipped.
      const result = await so.selectServiceOrderForAllActivities(serviceOrder);
      console.log(
        `  ${pkg}: remapped ${result.changed.length}, already correct ${result.alreadySet.length} ` +
        `(across ${workAreas.length} work area(s))`
      );
      for (const c of result.changed) console.log(`    ${c.name}: "${c.from}" -> "${c.to}"`);

      await so.clickSave();
    }

    // ---- Verify persistence by re-opening fresh ----
    // Each Service Order selection auto-saves via its own POST (see
    // SOMappingPage.selectServiceOrder's comment); Save is clicked because that
    // is the real workflow, but the persistence guarantee comes from re-reading.
    //
    // Verified PER AREA, not on the union: a union read cannot distinguish "both
    // areas correct" from "one correct, one not" for any row the app chooses to
    // render optimistically, and this is the assertion that the overwrite
    // actually took.
    for (const workArea of workAreas) {
      await page.goto(`${process.env.BASE_URL}/so-mapping`);
      await so.waitForLoad();
      await so.selectMappingFilters({
        cluster: profile.cluster,
        site: profile.site,
        projectType: profile.projectType,
        workLocation,
        workAreas: [workArea],
        package: profile.packages[0],
      });
      await verifyOneWorkArea({ so, workLocation, workArea, serviceOrder });
    }
  }

  async function verifyOneWorkArea({ so, workLocation, workArea, serviceOrder }) {
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
  }
});
