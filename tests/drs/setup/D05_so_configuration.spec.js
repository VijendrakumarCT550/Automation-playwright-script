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
// Onboarding projects (2026-10-19): Road<nn> areas take only the Road Works
// activities and Drain<nn> only Drain Work (Civil); a cell holding one of the
// project's SOs that the plan does not give it is cleared. Legacy Culvert-01 /
// Drain-01 / Road-01 areas are left unmapped.
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

// ONE TEST PER CATALOG VERSION (2026-10-21), so the onboarding runner can give
// D05 several workers (each version is its own matrix and its own Save; npm run
// drs:setup still runs them one after another with --workers=1). The project is
// resolved at load time; each test records ITS version's mapping atomically
// (state.mutateProject) and the stage is marked done once every version is in.
test.describe.configure({ mode: 'parallel' });

const RUN = state.targetProject(ENV.key, 'D8');
DATA.bindProject(RUN); // WA01-style areas: versions from the project's areaVersions

let context, page, soc, dump;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  expect(RUN, `no project on ${ENV.key} waiting for D8`).toBeTruthy();
  expect(RUN.stagesDone, `${RUN.name}: no service order yet — run D04 first`).toContain('D7');
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

// ONBOARDING PROJECTS (app owner, 2026-10-19) map EVERY activity of the matrix,
// Civil and Electrical, standard or added by our catalogs, by the Work Area's kind:
//   Road<nn>   only the Road Works activities  (BBU 120022154: OGL, Soil Layer 1-6, GSB, Macadam)
//   Drain<nn>  only Drain Work                 (BBU 120021745)
//   Culvert<nn> only the Culvert Works activities (-PCC, -RCC) - a Work Area type
//              of its own, never on WA<nn> (app owner); unmapped while the
//              project has no Culvert area
//   WA<nn>     every other activity
// Other projects keep the Piling + our-own list (`activities`) on every area.
const AREA_KINDS = { road: /^Road\d+$/, drain: /^Drain\d+$/, culvert: /^Culvert\d+$/ };
const areaKind = (wa) => Object.keys(AREA_KINDS).find((k) => AREA_KINDS[k].test(wa)) || 'main';
const KIND_ACTIVITY = { road: /^Road Works( |$)/, drain: /^Drain Work( |$)/, culvert: /^Culvert Works( |$)/ };
const kindOf = (activity) => Object.keys(KIND_ACTIVITY).find((k) => KIND_ACTIVITY[k].test(activity)) || 'main';
function plannedFor(wa, activities, captions, mapAll) {
  const kind = areaKind(wa);
  if (mapAll) return captions.filter((c) => kindOf(c) === kind);
  return kind === 'main' ? activities : [];
}


const GROUPS = RUN ? versionGroups(RUN) : [];
if (!RUN) test('D8. SO Configuration', () => { throw new Error(`no project on ${ENV.key} waiting for D8`); });

// One version's matrices (one per package), mapped in BULK EDIT (inspection round
// 26, app owner): the whole matrix is read in one pass, the cells that need the
// package's SO are ticked and the SO applied to them at once, the cells to clear
// (onboarding: one of the project's SOs on a cell the plan does not give it) are
// ticked and "Remove SO from selected"; then SAVE - Apply / Remove only change the
// screen, nothing reaches DRS until Save (app owner). Proof: reload, re-read.
for (const { version, areas } of GROUPS) {
  test(`D8. SO Configuration: ${version} [${areas.join(', ')}]`, async () => {
    test.setTimeout(20 * 60 * 1000);
    const run = RUN;
    // Each package's cells go to THAT package's SO (D04: one SO per package);
    // a project from before 2026-10-15 15:00 has one SO for everything.
    const soFor = (pkg) => ((run.serviceOrders && run.serviceOrders[pkg]) || run.serviceOrder).number;
    const mapAll = Boolean(run.onboardingRun);
    const ourSOs = Object.values(run.serviceOrders || {}).map((o) => o.number).concat(run.serviceOrder ? [run.serviceOrder.number] : []);
    const mapping = {};
    let opened = false; // the matrix is open (filters chosen) - later packages switch only Package
    for (const pkg of PACKAGES) {
      const activities = activitiesFor(version, pkg);
      if (!activities.length && !mapAll) continue;
      const so = soFor(pkg);
      const tag = `${version} / ${pkg}`;
      // Work Area options only exist under a Version, so an area not pinned to it
      // makes open() throw "not offered" - that is the check D03 did its job.
      const filters = { workLocation: run.workLocation, version, workAreas: areas, pkg };
      if (opened) await soc.choosePackage(pkg);
      else await soc.open(run.id, filters);
      opened = true;
      await soc.bulkMode();
      const before = await soc.readMatrix(run.workAreas);
      console.log(`  ${tag}: columns [${before.columns.join(', ')}], ${before.rows.length} activities`);
      for (const wa of areas) expect(before.columns, `Work Area ${wa} is not a column on ${version}`).toContain(wa);
      const captions = before.rows.map((r) => r.activity);
      expect(captions.length, `${tag}: no activity rows read from the matrix`).toBeGreaterThan(0);
      for (const a of activities) expect(captions, `${tag}: activity "${a}" is not in the matrix`).toContain(a);
      const planFor = Object.fromEntries(areas.map((wa) => [wa, plannedFor(wa, activities, captions, mapAll)]));
      for (const wa of areas) console.log(`  ${tag} / ${wa}: ${planFor[wa].length} activit${planFor[wa].length === 1 ? 'y' : 'ies'}`);

      const toSet = [];
      const toClear = [];
      for (const row of before.rows) {
        for (const wa of areas) {
          const cell = row.cells[before.columns.indexOf(wa)];
          if (planFor[wa].includes(row.activity)) {
            if (!cell.value.startsWith(so)) toSet.push(cell.box);
          } else if (mapAll && ourSOs.some((n) => cell.value.startsWith(n))) {
            console.log(`  ${tag}: clearing ${row.activity} × ${wa} (was "${cell.value}")`);
            toClear.push(cell.box);
          }
        }
      }
      if (toSet.length) { await soc.selectCells(toSet); await soc.assignSelected(so); await soc.deselectAll(); }
      if (toClear.length) { await soc.selectCells(toClear); await soc.removeSelected(); await soc.deselectAll(); }
      await dump(`matrix-before-save-${tag.replace(/\W+/g, '-')}`);
      console.log(`  ${tag}: cells set ${toSet.length}, cleared ${toClear.length}`);

      const saved = Boolean(toSet.length || toClear.length);
      if (saved) {
        const res = await soc.save();
        console.log(`  ${tag}: save → ${res.method} HTTP ${res.status} ${res.url}
    ${res.body.slice(0, 300)}`);
        expect(res.status, `SO Configuration save (${tag}) answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
      }

      // Proof: every planned cell holds the SO; on an onboarding project no other
      // cell holds one of ours. After a SAVE that is re-read from DRS (a reload, the
      // one place D05 reloads: this app has saved nothing while saying OK before);
      // with nothing to change, the matrix just read IS the proof - no reload.
      if (saved) { await soc.open(run.id, filters); await soc.bulkMode(); }
      const after = saved ? await soc.readMatrix(run.workAreas) : before;
      for (const row of after.rows) {
        for (const wa of areas) {
          const v = row.cells[after.columns.indexOf(wa)].value;
          if (planFor[wa].includes(row.activity)) {
            expect(v, `${tag}: ${row.activity} × ${wa} reads "${v}" after save`).toContain(so);
            mapping[row.activity] = { ...(mapping[row.activity] || {}), [wa]: so };
          } else if (mapAll) {
            expect(ourSOs.some((n) => v.startsWith(n)), `${tag}: ${row.activity} × ${wa} still reads "${v}" - not planned there`).toBe(false);
          }
        }
      }
      await dump(`matrix-after-reload-${tag.replace(/\W+/g, '-')}`);
    }

    // Recorded atomically (parallel workers); D8 is done once every version is in.
    state.mutateProject(ENV.key, run.tag, (p) => {
      const sc = p.soConfiguration = p.soConfiguration || {};
      sc.byVersion = { ...(sc.byVersion || {}), [version]: mapping };
      sc.version = DATA.catalogVersion;
      sc.package = PACKAGE;
      // `version` / `mapping` stay the BL ground's (what the Pulse side reads).
      sc.mapping = sc.byVersion[DATA.catalogOptionLabel] || {};
      sc.versionsDone = [...new Set([...(sc.versionsDone || []), version])];
      if (GROUPS.every((g) => sc.versionsDone.includes(g.version))) {
        p.stagesDone = [...new Set([...(p.stagesDone || []), 'D8'])];
      }
    });
  });
}
