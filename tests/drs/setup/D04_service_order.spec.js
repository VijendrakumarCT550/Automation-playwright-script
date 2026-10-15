const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DrsServiceOrderPage = require('../pages/DrsServiceOrderPage');
const DATA = require('../drs-data');

// ===========================================================================
// D04 — MANUAL SERVICE ORDER (Configuration → 3b). docs/drs-pulse-integration.md §3.
//
// ONE SO PER PACKAGE (app owner, 2026-10-15; docs/drs-catalog-versions-and-so-
// lines.md §8): Civil -> our Civil vendor (D01 `vendor`), Electrical -> the
// Electrical vendor (D01 `vendorElectrical`). Lines come from drs-data.js soPlan:
// per catalog version the run pins, that version's sub-activities in PAIRS - at
// most 2 per line, one version per line (a WMC covers one version) - so D06 can
// map each line exactly. Each line is recorded with its version + planned pair.
// An SO cannot be deleted, so each is recorded the moment the server accepts it,
// and a rerun that finds it listed reuses it.
//
// SO number: "99" + 8 digits from the clock — 10 digits like drs-uat's real
// SOs (4810023149), in a range none of them use.
//
// Run: npx playwright test --project=drs tests/drs/setup/D04_service_order.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/stage-d04');

test.describe.configure({ mode: 'serial' });

let context, page, so, dump, run;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  // The newest project that has not finished the WHOLE chain (D9), so a rerun
  // after D7 still gets the vendor-header back-fill below.
  run = state.incompleteProject(ENV.key, 'D9');
  expect(run, `no unfinished project on ${ENV.key} — run D02/D03 first`).toBeTruthy();
  expect(run.stagesDone, `${run.name}: Work Areas not pinned yet — run D03 first`).toContain('D6');
  context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  so = new DrsServiceOrderPage(page, ENV.baseUrl);
  dump = makeDumper(page, OUT, { screens: [] });
});

test.afterAll(async () => {
  if (context) await context.close();
});

test('D7. create the project\'s manual service orders - one per package', async () => {
  test.setTimeout(10 * 60 * 1000);
  const env = state.envRecord(ENV.key);
  const plan = DATA.soPlan(env, run.workAreas);
  const vendorFor = { Civil: env.vendor, Electrical: env.vendorElectrical };
  const recorded = { ...(run.serviceOrders || {}) };

  for (const [pkg, lines] of Object.entries(plan)) {
    const vendor = vendorFor[pkg];
    expect(vendor, `no ${pkg} vendor recorded on ${ENV.key} - run D01 first`).toBeTruthy();
    console.log(`  ${pkg}: ${lines.length} line(s) for ${vendor.code} — ${vendor.name}`);
    for (const l of lines) console.log(`    ${l.lineNumber}-${l.serviceItemNo}  ${l.version}  ${l.subActivities.join(' + ')}`);

    await so.gotoList(run.id);
    if (recorded[pkg] && await so.soListed(recorded[pkg].number)) {
      console.log(`  ${pkg} SO already exists: ${recorded[pkg].number}`);
      continue;
    }
    // "99" + 8 digits from the clock, + the package's index so two SOs made in the
    // same millisecond never collide.
    const number = `99${String(Date.now() + DATA.SO_PACKAGES.indexOf(pkg)).slice(-8)}`;
    const res = await so.createServiceOrder({ number, vendorCode: vendor.code, vendorName: vendor.name, lines });
    console.log(`  create ${pkg} SO ${number} (vendor "${res.vendorText}") → HTTP ${res.status} ${res.url}\n    ${res.body.slice(0, 300)}`);
    expect(res.status, `${pkg} SO create answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    recorded[pkg] = { number, package: pkg, vendorCode: vendor.code, vendorName: vendor.name, vendorText: res.vendorText, vendorHeaderSet: true, lines };
    // `serviceOrder` stays the Civil SO - what the Pulse side (BL ground) reads.
    state.upsertProject(ENV.key, run.tag, { serviceOrders: recorded, ...(pkg === 'Civil' ? { serviceOrder: recorded.Civil } : {}) });

    await so.gotoList(run.id);
    expect(await so.soListed(number), `${pkg} SO ${number} not in the list after a ${res.status}`).toBe(true);
    await dump(`so-list-after-${pkg.toLowerCase()}`);
  }
  state.markStageDone(ENV.key, run.tag, 'D7');
});
