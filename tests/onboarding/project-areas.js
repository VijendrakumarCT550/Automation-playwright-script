const path = require('path');
const { expect } = require('@playwright/test');
const state = require('../drs/utils/drs-state');
const { DrsProjectPage, buildLocationCsv, writeCsv } = require('../drs/pages/DrsProjectPage');
const { SECTION_PLAN } = require('./onboarding-run');

// WORK AREAS INTO A PROJECT - shared by onboarding OB02 (the run's areas) and
// onboarding-smoke OS01 (the smoke ground imported into the last onboarded project).

// Imports the areas the project does not have yet, into its Work Location.
// BATCHES (2026-10-21): the location import takes at most 10,000 rows per file (DRS:
// "too_big", maximum 10000), so the areas go in files of <= 9,000 rows, every area
// whole in one file. Each batch is recorded the moment DRS accepts it, so a stop
// part-way resumes with the areas still missing. Returns the updated project.
async function importMissingAreas({ page, ENV, project, areas, outDir }) {
  const have = project.workAreas || [];
  const toImport = areas.filter((a) => !have.includes(a.name));
  if (!toImport.length) { console.log(`  all ${areas.length} areas already imported`); return project; }
  if (have.length) console.log(`  adding ${toImport.map((a) => a.name).join(', ')} to ${project.workLocation}`);
  const workLocation = project.workLocation || `AUTO-WL-${project.tag}`;
  const MAX_ROWS = 9000;
  const rowsOf = (a) => Object.values(a.plan || {}).reduce((n, x) => n + x, 0);
  const batches = [];
  for (const a of toImport) {
    const last = batches[batches.length - 1];
    if (last && last.rows + rowsOf(a) <= MAX_ROWS) { last.areas.push(a); last.rows += rowsOf(a); } else batches.push({ areas: [a], rows: rowsOf(a) });
  }
  const projects = new DrsProjectPage(page, ENV.baseUrl);
  const stamp = Date.now();
  let p = project;
  for (const [b, batch] of batches.entries()) {
    const csvPath = writeCsv(path.join(outDir, `locations-${project.tag}-${stamp}-${b + 1}.csv`), buildLocationCsv({
      cluster: project.cluster, site: project.site, workLocation, workAreas: 0, linearAreas: false,
      extraAreas: batch.areas.map((a) => ({ name: a.name, plan: a.plan })),
    }));
    await projects.gotoLocationStep(project.id);
    await projects.chooseClusterSite(project.cluster, project.site);
    const res = await projects.importCsv(csvPath);
    console.log(`  import ${b + 1}/${batches.length} (${batch.areas.length} areas, ${batch.rows} sections) → HTTP ${res.status}: ${res.body.slice(0, 200)}`);
    expect(res.status, `import ${b + 1} answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    const names = batch.areas.map((a) => a.name);
    p = state.mutateProject(ENV.key, project.tag, (rec) => {
      rec.workLocation = workLocation;
      rec.workAreas = [...new Set([...(rec.workAreas || []), ...names])];
      rec.areaVersions = { ...(rec.areaVersions || {}), ...Object.fromEntries(batch.areas.map((a) => [a.name, a.version])) };
      rec.sectionPlan = SECTION_PLAN;
      rec.csv = path.basename(csvPath);
    });
  }
  await projects.gotoLocationStep(project.id);
  await expect(projects.treeItem(workLocation, 1), `${workLocation} not in the tree`).toBeVisible({ timeout: 30000 });
  return p;
}

// Pins every area of `names` (default: all of project.areaVersions) to its version;
// an area already on it is left alone, one on ANOTHER version is never changed.
// Re-reads every badge after a reload. Returns { area: version } as read.
async function pinAreas({ page, ENV, project, names = Object.keys(project.areaVersions || {}) }) {
  const projects = new DrsProjectPage(page, ENV.baseUrl);
  const openWl = async () => {
    await projects.gotoLocationStep(project.id);
    const wl = projects.treeItem(project.workLocation, 1);
    await wl.waitFor({ state: 'visible', timeout: 30000 });
    if ((await wl.getAttribute('aria-expanded')) !== 'true') { await wl.click(); await page.waitForTimeout(1500); }
  };
  await openWl();
  for (const wa of names) {
    const version = project.areaVersions[wa];
    const current = await projects.workAreaVersionBadge(wa, { label: true });
    if (current === version) { console.log(`  ${wa}: already ${version}`); continue; }
    expect(current, `${wa} is pinned to "${current}", planned "${version}" - not changing a pin`).toBe('');
    const res = await projects.pinWorkAreaVersion(project.workLocation, wa, version.match(/v\d+$/)[0], version);
    console.log(`  ${wa} -> ${version}: ${res.method} HTTP ${res.status}`);
    expect(res.status, `${wa}: pin answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    await projects.collapseWorkArea(wa);
  }
  await openWl();
  const pinned = {};
  for (const wa of names) {
    pinned[wa] = await projects.workAreaVersionBadge(wa, { label: true });
    expect(pinned[wa], `${wa}: badge "${pinned[wa]}" after pinning ${project.areaVersions[wa]}`).toBe(project.areaVersions[wa]);
  }
  return pinned;
}

module.exports = { importMissingAreas, pinAreas };
