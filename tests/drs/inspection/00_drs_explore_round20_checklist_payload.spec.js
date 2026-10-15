const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, loginSuperAdmin } = require('../utils/drs-ui');
const ChecklistsConfiguratorPage = require('../../drs-setting/ChecklistsConfiguratorPage');
const { siteChecklists } = require('../../drs-setting/pc-data');

// ===========================================================================
// DRS EXPLORATION — ROUND 20. NO WRITES: every non-GET API call is CAPTURED (url +
// body) and then ABORTED, so nothing reaches the server.
// 2026-10-15: creating our checklist #1 answered HTTP 500 "Internal server error",
// while the app owner's manual one (SFQP/SERIAL/FORMAT "1", one Text question)
// worked. Fill the New checklist dialog both ways, press Create, and record the
// request each sends - the difference is what the server chokes on.
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round20_checklist_payload.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round20');

test('checklist create payloads (captured, aborted)', async ({ browser }) => {
  test.setTimeout(6 * 60 * 1000);
  const context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
  const captured = [];
  await context.route('**/*', async (route) => {
    const req = route.request();
    const isApi = ['fetch', 'xhr'].includes(req.resourceType());
    const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method()) && !/\/auth\//i.test(req.url()) && !/\/api\/v1\/query\//i.test(req.url());
    if (isApi && req.url().startsWith(ENV.baseUrl) && write) {
      captured.push({ method: req.method(), url: req.url(), body: req.postData() });
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const cl = new ChecklistsConfiguratorPage(page, ENV.baseUrl);

  const cases = [
    { label: 'ours (#1)', spec: siteChecklists('PC03')[0] },
    { label: 'like the manual one', spec: { name: 'AUTO PROBE minimal', serial: '1', sfqp: '1', format: '1', questions: [{ text: 'Question no 1', type: 'Text', required: true }] } },
  ];
  for (const c of cases) {
    const before = captured.length;
    await cl.create(c.spec).catch((e) => console.log(`  ${c.label}: create() threw (expected - aborted): ${e.message.split('\n')[0]}`));
    for (const r of captured.slice(before)) {
      console.log(`\n  ${c.label}: ${r.method} ${r.url}\n  body: ${r.body}`);
    }
    if (captured.length === before) console.log(`\n  ${c.label}: no write request was sent`);
  }
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'captured.json'), JSON.stringify(captured, null, 2));
  await context.close();
});
