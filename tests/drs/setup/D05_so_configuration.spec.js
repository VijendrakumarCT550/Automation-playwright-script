const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DATA = require('../drs-data');
const DrsSoConfigPage = require('../pages/DrsSoConfigPage');

// ===========================================================================
// D05 — SO CONFIGURATION (Configuration → 4): map Activity × Work Area → our SO.
// docs/drs-pulse-integration.md §6.
//
// Scope (app owner: "mainly Piling related all we will map first"): the four
// Civil Piling activities, onto the run's BLxx Work Areas (the table/inverter
// blocks Pulse's Piling RFIs use) on All sites v1, and onto each catalog-version
// Work Area (VER-*) on its own version - every version copies the Piling tree.
// Culvert/Drain/Road Work Areas are left unmapped for now.
//
// Idempotent: a cell already holding our SO is left alone; if every cell does,
// nothing is saved. Proof is a reload and a re-read of every mapped cell.
//
// Run: npx playwright test --project=drs tests/drs/setup/D05_so_configuration.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/stage-d05');
// Civil then Electrical (app owner, 2026-10-15: Civil first, then Electrical).
// D05_PACKAGES=Civil limits a run to one.
const PACKAGES = String(process.env.D05_PACKAGES || 'Civil,Electrical').split(',').map((x) => x.trim()).filter(Boolean);
const PACKAGE = 'Civil'; // the BL ground's package, recorded for the Pulse side
// The standard activities = every activity of the Civil service-code groups the SO
// lines carry (drs-data.js SERVICE_CODE_GROUPS: 120021756 Piling MMS / Inverter /
// LT Cable Hanger, 120036457 Robotic Docking + Installation of docking & reverse
// stations), so a line's whole group is mappable in step 5.
const ACTIVITIES = [...new Set(DATA.SERVICE_CODE_GROUPS.filter((g) => g.package === 'Civil').flatMap((g) => g.activities))];

// The activities to map for one version + package:
//   Civil       - the four Piling activities, plus our catalog's own;
//   Electrical  - our catalog's own only (no Piling there).
// "Our own" = "<code>.1 Activity" and "<code>.2 Activity" per code the version
// carries (drs-data.js catalogCodes): Automation Site 01 v1 / Civil -> PC01.1,
// PC01.2, QC01.1, QC01.2; / Electrical -> PE01.1 ... QE01.2. All-sites versions
// carry no codes of ours, so they get Civil Piling only.
function activitiesFor(version, pkg) {
  const codes = DATA.catalogCodes(state.envRecord(ENV.key), version, pkg);
  const own = codes.flatMap((c) => [`${c}.1 Activity`, `${c}.2 Activity`]);
  return pkg === 'Civil' ? [...ACTIVITIES, ...own] : own;
}

test.describe.configure({ mode: 'serial' });

let context, page, soc, dump, run;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  run = state.targetProject(ENV.key, 'D8');
  expect(run, `no project on ${ENV.key} waiting for D8`).toBeTruthy();
  expect(run.stagesDone, `${run.name}: no service order yet — run D04 first`).toContain('D7');
  context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  soc = new DrsSoConfigPage(page, ENV.baseUrl);
  dump = makeDumper(page, OUT, { screens: [] });
});

test.afterAll(async () => {
  if (context) await context.close();
});

// ONE PASS PER CATALOG VERSION (2026-10-15). The Version filter is single-choice
// and lists only the Work Areas pinned to it (catalog guide 9.2), so the run's
// mapped areas are grouped by their version (drs-data.js versionFor): the BL areas
// on "All sites v1", each catalog-version area (VER-*) on its own. Each group is
// saved before the next version is chosen - switching versions drops unsaved cells.
function versionGroups(run) {
  const mapped = run.workAreas.filter((wa) => /^BL\d+$/i.test(wa) || DATA.isVersionArea(wa));
  const groups = new Map();
  for (const wa of mapped) {
    const v = DATA.versionFor(wa);
    groups.set(v, [...(groups.get(v) || []), wa]);
  }
  return [...groups].map(([version, areas]) => ({ version, areas }));
}

test('D8. map the Piling activities × Work Areas to the run\'s SO, per catalog version', async () => {
  test.setTimeout(20 * 60 * 1000);
  // Each package's cells go to THAT package's SO (D04: one SO per package);
  // a project from before 2026-10-15 15:00 has one SO for everything.
  const soFor = (pkg) => ((run.serviceOrders && run.serviceOrders[pkg]) || run.serviceOrder).number;
  const groups = versionGroups(run);
  console.log(`  versions: ${groups.map((g) => `${g.version} [${g.areas.join(', ')}]`).join(' | ')}`);

  // Merged onto what an earlier run recorded, so a one-package re-run
  // (D05_PACKAGES=Electrical) keeps the other package's mapping in the record.
  const byVersion = JSON.parse(JSON.stringify((run.soConfiguration && run.soConfiguration.byVersion) || {}));
  for (const { version, areas } of groups) {
    byVersion[version] = byVersion[version] || {};
    for (const pkg of PACKAGES) {
      const activities = activitiesFor(version, pkg);
      if (!activities.length) continue;
      const so = soFor(pkg);
      const tag = `${version} / ${pkg}`;
      // Work Area options only exist under a Version, so an area not pinned to it
      // makes open() throw "not offered" - that is the check D03 did its job.
      const filters = { workLocation: run.workLocation, version, workAreas: areas, pkg };
      await soc.open(run.id, filters);
      const columns = await soc.columns(run.workAreas);
      console.log(`  ${tag}: columns [${columns.join(', ')}]`);
      for (const wa of areas) expect(columns, `Work Area ${wa} is not a column on ${version}`).toContain(wa);

      console.log(`  ${tag}: activities [${activities.join(', ')}]`);
      let changed = 0;
      for (const activity of activities) {
        for (const wa of areas) {
          const idx = columns.indexOf(wa);
          if ((await soc.cellValue(activity, idx)).startsWith(so)) continue;
          await soc.setCell(activity, idx, so);
          changed += 1;
        }
      }
      await dump(`matrix-before-save-${tag.replace(/\W+/g, '-')}`);
      console.log(`  ${tag}: cells set ${changed}`);

      if (changed) {
        const res = await soc.save();
        console.log(`  ${tag}: save → ${res.method} HTTP ${res.status} ${res.url}
    ${res.body.slice(0, 300)}`);
        expect(res.status, `SO Configuration save (${tag}) answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
      }

      // Proof after a reload.
      await soc.open(run.id, filters);
      const cols = await soc.columns(run.workAreas);
      for (const activity of activities) {
        byVersion[version][activity] = {};
        for (const wa of areas) {
          const v = await soc.cellValue(activity, cols.indexOf(wa));
          expect(v, `${tag}: ${activity} × ${wa} reads "${v}" after save`).toContain(so);
          byVersion[version][activity][wa] = so;
        }
      }
      await dump(`matrix-after-reload-${tag.replace(/\W+/g, '-')}`);
    }
  }

  // `version` / `mapping` stay the BL ground's (what the Pulse side reads).
  state.upsertProject(ENV.key, run.tag, {
    soConfiguration: {
      version: DATA.catalogVersion, package: PACKAGE, mapping: byVersion[DATA.catalogOptionLabel] || {}, byVersion,
    },
  });
  state.markStageDone(ENV.key, run.tag, 'D8');
});
