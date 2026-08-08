// NC spec inspection
/**
 * DOM Inspector — NOT a real test, no assertions.
 * Logs in as CI and opens an already-"Raised" NC (id read from
 * tests/fixtures/nc-tracker.json, created by a prior nc-qi-create run) to
 * discover the real Root Cause / Corrective Actions input structure —
 * NCResponsePage's placeholder-based guess didn't match.
 *
 * Usage (single run, headed so you can watch):
 *   npx playwright test tests/specs/00_inspect_nc_response.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const { loginAsRole } = require('../utils/helpers');
const { loadTracker } = require('../utils/nc-tracker-utils');

test('Inspect CI response page for an already-created NC', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  fs.mkdirSync('test-results', { recursive: true });

  const tracker = loadTracker();
  const tc = Object.values(tracker).find(t => t.ncId);
  if (!tc) throw new Error('No TC in nc-tracker.json has an ncId yet — run nc-qi-create first');

  await loginAsRole(page, 'CI');
  await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${tc.ncId}`);
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('CI response page URL:', page.url());
  await page.screenshot({ path: 'test-results/inspect_nc_response.png', fullPage: true });
  fs.writeFileSync('test-results/inspect_nc_response.html', await page.content());

  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input, textarea')).map(el => ({
      tag: el.tagName,
      type: el.type,
      placeholder: el.placeholder,
      ariaLabel: el.getAttribute('aria-label'),
      name: el.name,
      id: el.id,
      value: el.value,
    }))
  );
  console.log('Inputs/textareas on CI response page:', JSON.stringify(inputs, null, 2));

  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll('label, p, span, div'))
      .map(el => el.innerText?.trim())
      .filter(t => t && (/root cause/i.test(t) || /corrective action/i.test(t)) && t.length < 40)
  );
  console.log('Labels mentioning Root Cause / Corrective Actions:', JSON.stringify([...new Set(labels)]));

  const buttons = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.innerText?.trim(),
      ariaLabel: b.getAttribute('aria-label'),
    })).filter(b => b.text || b.ariaLabel)
  );
  console.log('Buttons on CI response page:', JSON.stringify(buttons, null, 2));
});
