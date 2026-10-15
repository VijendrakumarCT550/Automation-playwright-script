const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DATA = require('../drs-data');
const { DrsProjectPage } = require('../pages/DrsProjectPage');

// ===========================================================================
// D03 — PIN EVERY WORK AREA TO ITS CATALOG VERSION.
// docs/drs-pulse-integration.md §6.
//
// App owner, 2026-09-26: an IMPORTED Work Area carries no package catalog
// version. SO Configuration then lists it under every version, while a pinned
// one appears under its own version only — and v1 is the version that keeps
// every Pulse package as Pulse has it. So each Work Area the import created is
// pinned to v1 before SO Configuration.
//
// 2026-10-15: the version is PER WORK AREA (drs-data.js versionFor): BL and
// Culvert/Drain/Road areas -> "All sites v1"; each catalog-version area (VER-ALL-V2,
// VER-SITE-V1, VER-SITE-V2) -> its own version. The badge is compared by its full
// LABEL ("AUTOMATION SITE v1"), since "v1" alone exists in two chains.
// The pin dropdown lists LOCKED versions only (catalog guide 11.2), so the
// AUTOMATION SITE versions must be locked first (tests/drs-setting/
// catalog_site_versions.spec.js). A pin can be changed later only while no work
// depends on the area (guide 11.3); this stage never changes a pin, it only sets one.
//
// Idempotent: a Work Area whose tree badge already reads its label is left
// alone. Works on the project D02 recorded as the newest without D6.
//
// Run:  npx playwright test --project=drs tests/drs/setup/D03_pin_catalog_version.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/stage-d03');

test.describe.configure({ mode: 'serial' });

let context, page, projects, dump, run;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  run = state.incompleteProject(ENV.key, 'D6');
  expect(run, `no project on ${ENV.key} waiting for D6 — run D02 first`).toBeTruthy();
  expect(run.stagesDone, `project ${run.name} has no work region yet — run D02 first`).toContain('D5');
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  projects = new DrsProjectPage(page, ENV.baseUrl);
  dump = makeDumper(page, OUT, { screens: [] });
  console.log(`  project ${run.name}: ${run.workAreas.map((wa) => `${wa} -> ${DATA.versionFor(wa)}`).join(', ')}`);
});

test.afterAll(async () => {
  if (context) await context.close();
});

// ONE PAGE LOAD FOR ALL WORK AREAS (app owner, 2026-09-26): there is no
// multi-select pin, but after Save the pane stays usable — click the next Work
// Area, pick the version, Save, and so on. No reload and no Cluster/Site pick
// per area (both were pure cost). One reload at the END proves every badge.
//
// ONCE SET, A CATALOG VERSION CANNOT BE CHANGED — the field's own placeholder
// says so ("Leave empty to decide later — once set, it cannot be changed").
// So a pin is irreversible, which is why pick() verifies the chosen value
// before Save is pressed.
test('D6. pin every Work Area of the run to its catalog version', async () => {
  test.setTimeout(20 * 60 * 1000);
  await projects.gotoLocationStep(run.id);
  const wl = projects.treeItem(run.workLocation, 1);
  await wl.waitFor({ state: 'visible', timeout: 30000 });
  if ((await wl.getAttribute('aria-expanded')) !== 'true') {
    await wl.click();
    await page.waitForTimeout(1000);
  }

  let changed = 0;
  for (const wa of run.workAreas) {
    const label = DATA.versionFor(wa);
    const current = await projects.workAreaVersionBadge(wa, { label: true });
    if (current === label) {
      console.log(`  ${wa}: already ${label}`);
      continue;
    }
    expect(current, `${wa} is already pinned to "${current}", planned "${label}" - not changing a pin`).toBe('');
    const res = await projects.pinWorkAreaVersion(run.workLocation, wa, label.match(/v\d+$/)[0], label);
    console.log(`  ${wa}: ${res.method} → HTTP ${res.status}`);
    expect(res.status, `${wa}: pin answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    changed += 1;
    await projects.collapseWorkArea(wa);
  }
  console.log(`  pinned ${changed} Work Area(s) this run`);

  // Proof after ONE reload: every badge reads the version.
  await projects.gotoLocationStep(run.id);
  const wlAfter = projects.treeItem(run.workLocation, 1);
  await wlAfter.waitFor({ state: 'visible', timeout: 30000 });
  if ((await wlAfter.getAttribute('aria-expanded')) !== 'true') await wlAfter.click();
  await page.waitForTimeout(1500);
  const pinned = {};
  for (const wa of run.workAreas) {
    const badge = await projects.workAreaVersionBadge(wa, { label: true });
    expect(badge, `${wa}: tree shows "${badge}" after pinning ${DATA.versionFor(wa)}`).toBe(DATA.versionFor(wa));
    pinned[wa] = badge;
  }
  await dump('tree-after-pinning');
  // `catalogVersion` stays the BL ground's version (what Pulse-side specs read).
  state.upsertProject(ENV.key, run.tag, { catalogVersion: DATA.catalogVersion, catalogLabel: DATA.catalogOptionLabel, pinned });
  state.markStageDone(ENV.key, run.tag, 'D6');
});
