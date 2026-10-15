const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DrsServiceOrderPage = require('../pages/DrsServiceOrderPage');
const DATA = require('../drs-data');

// ===========================================================================
// D04 — MANUAL SERVICE ORDER (Configuration → 3b). docs/drs-pulse-integration.md §3.
//
// One SO per project, contracted to our own vendor (D01), with ONE LINE PER
// CATALOG VERSION the run pins (drs-data.js soLinesFor; app owner 2026-10-15 -
// docs/drs-catalog-versions-and-so-lines.md §8): line 10 = All sites v1 (BL),
// 20 = All sites v2, 30 = AUTOMATION SITE v1, 40 = AUTOMATION SITE v2. A WMC
// covers one version, so D06 maps each line to its own version's sub-activities.
// An SO cannot be deleted,
// so the number is recorded the moment the server accepts it, and a rerun
// that finds it listed reuses it.
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

test('D7. create the project\'s manual service order', async () => {
  test.setTimeout(5 * 60 * 1000);
  const vendor = state.envRecord(ENV.key).vendor;
  await so.gotoList(run.id);

  if (run.serviceOrder && await so.soListed(run.serviceOrder.number)) {
    console.log(`  SO already exists: ${run.serviceOrder.number}`);
    // Back-fill the advanced vendor fields on an SO created before they were
    // set (app owner, 2026-09-26: they label the SO in SO Configuration).
    if (!run.serviceOrder.vendorHeaderSet) {
      const res = await so.editVendorDetails(run.serviceOrder.number, vendor.code, vendor.name);
      console.log(`  edit SO vendor header → ${res.method} HTTP ${res.status}\n    ${res.body.slice(0, 300)}`);
      expect(res.status, `SO edit answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
      state.upsertProject(ENV.key, run.tag, { serviceOrder: { ...run.serviceOrder, vendorHeaderSet: true } });
    }
    state.markStageDone(ENV.key, run.tag, 'D7');
    return;
  }

  const number = `99${String(Date.now()).slice(-8)}`;
  const lines = DATA.soLinesFor(run.workAreas);
  console.log(`  lines: ${lines.map((l) => `${l.lineNumber}-${l.serviceItemNo} -> ${l.version}`).join(' | ')}`);
  const res = await so.createServiceOrder({ number, vendorCode: vendor.code, vendorName: vendor.name, lines });
  console.log(`  create SO ${number} (vendor "${res.vendorText}") → HTTP ${res.status} ${res.url}\n    ${res.body.slice(0, 300)}`);
  expect(res.status, `SO create answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
  state.upsertProject(ENV.key, run.tag, {
    serviceOrder: { number, vendorCode: vendor.code, vendorText: res.vendorText, vendorHeaderSet: true, lines },
  });

  await so.gotoList(run.id);
  await dump('so-list-after-create');
  expect(await so.soListed(number), `SO ${number} not in the list after a ${res.status}`).toBe(true);
  state.markStageDone(ENV.key, run.tag, 'D7');
});
