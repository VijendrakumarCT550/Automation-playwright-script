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

  // Maps profile.workAreas — SIX areas for wind, all approved for overwriting by
  // the app owner, because wind has exactly one Work Section per Work Area and a
  // run consumes that (checkpoint, Work Section) pair permanently. One area
  // therefore supports only about as many RFI runs as the activity has
  // checkpoints, so several are provisioned and the flow stage walks them.
  //
  // Two phases: a READ-ONLY, write-once baseline capture per area, then a single
  // bulk mapping pass with every area selected at once.
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
    // Per area, because that is the only way to know what EACH area held before
    // it was overwritten: with several areas selected the activity row shows the
    // UNION of their values (the app even has a "Multiple SOs" option for that
    // state), not the individual ones. Nothing is mutated here — one cascade and
    // one row read per area, no dropdown selections.
    //
    // WRITE-ONCE, and this is a bug fix rather than a nicety. The baseline used
    // to be rewritten on every run, so the first run captured KH 35's genuine
    // original (14x ODHAV ENTERPRISE, 1x SHREEJI, 1x G P PROJECT, 2 already
    // BAUER) and the NEXT provisioning run replaced it with the post-change
    // all-BAUER state — destroying the only restore source. (That original had
    // to be recovered from commit be83f9b.) A baseline that records the state
    // AFTER the overwrite is worse than useless: it looks authoritative and
    // restores nothing.
    //
    // Skipping already-captured areas also makes this phase free on re-runs,
    // which is the whole reason it can afford to be per-area at all.
    for (const workArea of workAreas) {
      const existing = baselinePathFor(workArea);
      if (fs.existsSync(existing)) {
        console.log(
          `\n########## baseline: ${workArea} — already captured, skipping ` +
          `(${path.basename(existing)}) ##########`
        );
        continue;
      }
      console.log(`\n########## baseline: ${workLocation} / ${workArea} (first capture) ##########`);
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

  // One canonical place for the per-area baseline filename, so the write-once
  // check in phase 1 and the writer below can never disagree.
  function baselinePathFor(workArea) {
    return path.join(BASELINE_DIR, `${profile.key}-${workArea.replace(/\s+/g, '')}.json`);
  }

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
    const baselineFile = baselinePathFor(workArea);
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

    // ---- Verify persistence by re-opening fresh, ONCE, on the union ----
    // Each Service Order selection auto-saves via its own POST (see
    // SOMappingPage.selectServiceOrder's comment); Save is clicked because that
    // is the real workflow, but the persistence guarantee comes from re-reading.
    //
    // This USED to re-cascade once per work area, on the reasoning that "a union
    // read cannot distinguish both-correct from one-correct". That reasoning was
    // wrong in the direction that matters. With every area selected, a row can
    // only display the target Service Order when EVERY selected area holds it —
    // any disagreement renders as something else (the app has a "Multiple SOs"
    // option for exactly that state). So asserting every row equals the target
    // across the union DOES prove all areas took the change. Knowing WHICH area
    // failed is not needed for a pass/fail, and the per-area detail is still
    // available from the baseline files.
    //
    // Dropping it from N cascades to one is not just tidier: the 6th consecutive
    // cascade is where the Ark UI Cluster listbox flaked, opening but staying
    // positioned off-screen so a resolved "Gujarat" option was never clickable
    // (the same transform race RFICreatePage._openDropdown documents). Fewer
    // cascades is less exposure to it.
    await page.goto(`${process.env.BASE_URL}/so-mapping`);
    await so.waitForLoad();
    await so.selectMappingFilters({
      cluster: profile.cluster,
      site: profile.site,
      projectType: profile.projectType,
      workLocation,
      workAreas,
      package: profile.packages[0],
    });
    await verifyWorkAreas({ so, workLocation, workAreas, serviceOrder });
  }

  async function verifyWorkAreas({ so, workLocation, workAreas, serviceOrder }) {
    for (const [i, pkg] of profile.packages.entries()) {
      if (i > 0) await so.selectPackage(pkg);

      const after = await so.listActivityRows();
      const wrong = after.filter(r => r.currentServiceOrder !== serviceOrder);
      expect(
        wrong.map(r => `${r.name} -> ${r.currentServiceOrder}`),
        `Every activity in "${pkg}" should read "${serviceOrder}" with all ` +
        `${workAreas.length} work area(s) selected. A row showing anything else ` +
        `(including "Multiple SOs") means at least one area did not take the change.`
      ).toEqual([]);
      console.log(
        `  ${pkg}: all ${after.length} activities confirmed on the target SO ` +
        `across all ${workAreas.length} work area(s) after reload`
      );
    }
  }
});
