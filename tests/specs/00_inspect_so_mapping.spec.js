/**
 * DOM Inspector — NOT a real test, no assertions.
 * Forces a real change on one SO Mapping row (not a no-op reselect) and logs
 * ALL non-GET network traffic with timestamps around Save, to measure how
 * long persistence actually takes.
 *
 * Usage (single run, headed so you can watch):
 *   npx playwright test tests/specs/00_inspect_so_mapping.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const SOMappingPage = require('../pages/SOMappingPage');
const { adminFreshLogin } = require('../utils/helpers');

const MAPPING_FILTERS = {
  cluster:      'KHAVDA',
  site:         'KHAVDA',
  projectType:  'SOLAR',
  workLocation: 'A-06c',
  workAreas:    ['BL01', 'BL02', 'BL03', 'BL04', 'BL05'],
  package:      'Civil',
};

test('Trace network timing for a real SO Mapping change + Save', async ({ browser }) => {
  const { context, page, dashboard } = await adminFreshLogin(browser);
  fs.mkdirSync('test-results', { recursive: true });
  const calls = [];
  const t0 = { time: null };

  page.on('request', req => {
    if (req.method() !== 'GET') {
      calls.push({ t: t0.time ? Date.now() - t0.time : null, phase: 'request', method: req.method(), url: req.url(), postData: req.postData()?.slice(0, 500) });
    }
  });
  page.on('response', async res => {
    if (res.request().method() !== 'GET') {
      let body = null;
      try { body = await res.text(); } catch { /* ignore */ }
      calls.push({ t: t0.time ? Date.now() - t0.time : null, phase: 'response', status: res.status(), url: res.url(), body: body?.slice(0, 300) });
    }
  });

  try {
    const soMapping = new SOMappingPage(page);
    await soMapping.goto(dashboard);
    await soMapping.selectMappingFilters(MAPPING_FILTERS);

    console.log('Piling - MMS before change:', await soMapping.getServiceOrderValue('Piling - MMS'));

    // Force an actual change: switch to a different vendor first
    t0.time = Date.now();
    await soMapping.selectServiceOrder('Piling - MMS', 'RUDRA INFRAPROJECTS');
    console.log('Piling - MMS after change:', await soMapping.getServiceOrderValue('Piling - MMS'));

    await soMapping.saveButton.click();
    console.log('Save clicked at t=', Date.now() - t0.time);
    await page.waitForTimeout(8000);

    fs.writeFileSync('test-results/so_mapping_change_network.json', JSON.stringify(calls, null, 2));
    console.log('--- Network calls (t=ms since change) ---');
    console.log(JSON.stringify(calls, null, 2));

    // Restore to CHOUHAN so we don't leave bad test data behind
    await soMapping.selectServiceOrder('Piling - MMS', 'M S CHOUHAN INFRAVENTURES PVT LTD');
    await soMapping.saveButton.click();
    await page.waitForTimeout(8000);
    console.log('Piling - MMS restored to:', await soMapping.getServiceOrderValue('Piling - MMS'));
  } finally {
    await context.close();
  }
});
