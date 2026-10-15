const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../drs/utils/drs-ui');
const state = require('../drs/utils/drs-state');
const DATA = require('../drs/drs-data');
const ServiceConfiguratorPage = require('./ServiceConfiguratorPage');

// ===========================================================================
// SERVICE CODES FOR OUR SITE VERSIONS (app owner, 2026-10-15).
// docs/drs-so-lines-and-service-codes.md §3-4.
//
// Ticks, in App Settings → Service Configurator, the sub-activities of OUR site
// catalog versions (Automation Site 01 v1, v2) under the standard service codes
// the SO lines carry (drs-data.js SERVICE_CODE_GROUPS):
//   120021756 Piling (excl. Robot)  Piling - MMS / - Inverter / - LT Cable Hanger System
//   120036457 Robot                 Piling - Robotic Docking System, Installation of
//                                   docking & reverse stations
// so that an SO line given the code in its Activity Code auto-populates them.
//
// GLOBAL SETTING, app-owner approved: a save re-applies the code's mapping to every
// existing SO line with this code that has no billed work. So the spec only ADDS
// ticks (never unticks - not even the "Not available" rows), and a code that already
// carries every target is not saved at all.
//
// The site versions must be LOCKED (only locked versions can be mapped) -
// run catalog_site_versions.spec.js first.
// Run: npx playwright test --project=drs-setting tests/drs-setting/service_codes_site_versions.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../drs-explore/service-codes');
const TYPE_LABEL = 'Solar';

test.describe.configure({ mode: 'serial' });
let context, page, sc, dump;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  sc = new ServiceConfiguratorPage(page, ENV.baseUrl);
  dump = makeDumper(page, OUT, { screens: [] });
});

test.afterAll(async () => { if (context) await context.close(); });

// The locked site versions the catalog spec recorded.
function siteVersions() {
  const chain = (state.envRecord(ENV.key).catalogs || {})[DATA.site] || {};
  return Object.values(chain).filter((c) => c.status === 'locked').map((c) => c.label);
}

for (const group of DATA.SERVICE_CODE_GROUPS) {
  test(`${group.code} (${group.name}): our site versions' sub-activities mapped`, async () => {
    test.setTimeout(20 * 60 * 1000);
    const versions = siteVersions();
    expect(versions.length, `no locked ${DATA.site} versions recorded - run catalog_site_versions.spec.js`).toBeGreaterThan(0);

    await sc.goto();
    await sc.openCode(group.code);
    const before = await sc.selectedText();
    console.log(`  ${group.code}: ${before}; targets ${group.subActivities.length} sub-activities × [${versions.join(', ')}]`);

    let changed = 0;
    for (const version of versions) {
      for (const sub of group.subActivities) {
        const row = await sc.subActivityRow(sub, TYPE_LABEL, version, group.search || sub);
        const did = await sc.tick(row);
        console.log(`    ${sub} · ${version}: ${did ? 'ticked' : 'already ticked'}`);
        if (did) changed += 1;
      }
    }
    await sc.subSearch().fill('');
    await dump(`${group.code}-before-save`);

    if (changed) {
      const res = await sc.save();
      console.log(`  ${group.code}: save → HTTP ${res.status} ${res.url}\n    dialog: ${res.dialogText.slice(0, 300)}\n    ${res.body.slice(0, 300)}`);
      expect(res.status, `${group.code} save answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
    }

    // Proof after a reload: every target row ticked.
    await sc.goto();
    await sc.openCode(group.code);
    const after = await sc.selectedText();
    for (const version of versions) {
      for (const sub of group.subActivities) {
        const row = await sc.subActivityRow(sub, TYPE_LABEL, version, group.search || sub);
        await row.waitFor({ state: 'visible', timeout: 15000 });
        expect(await sc.isTicked(row), `${group.code}: ${sub} · ${version} not ticked after save`).toBe(true);
      }
    }
    await sc.subSearch().fill('');
    await dump(`${group.code}-after-reload`);
    console.log(`  ${group.code}: ${before} → ${after}`);
    const all = state.envRecord(ENV.key).serviceCodes || {};
    state.updateEnv(ENV.key, {
      serviceCodes: { ...all, [group.code]: { name: group.name, versions, subActivities: group.subActivities, selected: after, at: new Date().toISOString() } },
    });
  });
}
