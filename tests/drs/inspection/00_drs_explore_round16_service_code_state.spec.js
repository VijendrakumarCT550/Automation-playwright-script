const { test } = require('@playwright/test');
const { drsEnv, installWriteGuard, loginSuperAdmin } = require('../utils/drs-ui');
const ServiceConfiguratorPage = require('../../drs-setting/ServiceConfiguratorPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 16. READ-ONLY, ENFORCED. The current state of the
// service codes our automation maps: "<n> of <total> selected" and, per version,
// whether each target sub-activity row is ticked. Run after a Save to see what
// actually persisted.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round16_service_code_state.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const TARGETS = {
  '120021756': ['Piling - MMS', 'Piling - Inverter', 'Piling - LT Cable Hanger System'],
  '120036457': ['Piling - Robotic Docking System', 'Installation of docking & reverse stations'],
};
const VERSIONS = ['All sites v1', 'Automation Site 01 v1', 'Automation Site 01 v2'];

test('service code state', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const blocked = [];
  const context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const sc = new ServiceConfiguratorPage(page, ENV.baseUrl);
  for (const [code, subs] of Object.entries(TARGETS)) {
    await sc.goto();
    await sc.openCode(code);
    console.log(`  ${code}: ${await sc.selectedText()}`);
    for (const v of VERSIONS) {
      for (const s of subs) {
        const row = await sc.subActivityRow(s, 'Solar', v, s);
        const found = (await row.count()) > 0;
        console.log(`    ${s} · ${v}: ${found ? (await sc.isTicked(row) ? 'TICKED' : 'not ticked') : 'row not found'}`);
      }
    }
  }
  console.log('  blocked writes:', blocked.length ? blocked : '(none)');
  await context.close();
});
