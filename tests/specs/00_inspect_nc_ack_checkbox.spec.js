/**
 * DOM Discovery script — NOT a real test, no assertions.
 *
 * Round 2: round 1 confirmed getByRole('checkbox', {name}) resolves to a
 * single native <input type=checkbox> (visually clipped to 1x1px via CSS,
 * same "real input hidden behind a styled sibling" pattern as the OK/Not-Ok
 * radios) — but force-clicking it did NOT actually toggle it (user caught
 * this live: checkbox stayed unchecked, Review submission blocked). Ark
 * UI/Zag.js checkbox anatomy is root > (label, control, hiddenInput) as
 * SIBLINGS, not nested — dump the full [data-scope="checkbox"] structure
 * to find the actual "control" part (the visible styled box) and test
 * clicking THAT instead, verifying via the real signal this time: the
 * input's `.checked` DOM property and the root/label's `data-state`
 * attribute (NOT aria-checked/data-state on the input itself — round 1
 * confirmed those don't exist on the native input).
 *
 * Usage: point NC_ID below at a real NC still pending EE review:
 *   npx playwright test tests/specs/00_inspect_nc_ack_checkbox.spec.js --project=chromium --headed --reporter=list --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const { loginAsRole } = require('../utils/helpers');

const NC_ID = '135bc127-0fd6-425c-b10d-86f58327e626'; // TC-01, still pending EE for real

test('inspect and test the real ack checkbox click target', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await loginAsRole(page, 'EE');

  await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${NC_ID}`);
  await page.waitForLoadState('networkidle');

  // Dump every [data-scope="checkbox"] element (root/label/control/input
  // are siblings per Zag.js anatomy) so we can see the full structure.
  const checkboxParts = await page.evaluate(() => {
    const describe = (node) => ({
      tag: node.tagName,
      dataPart: node.getAttribute('data-part'),
      dataState: node.getAttribute('data-state'),
      id: node.id,
      className: typeof node.className === 'string' ? node.className : '',
      outerHTML: node.outerHTML.slice(0, 400),
    });
    return Array.from(document.querySelectorAll('[data-scope="checkbox"]')).map(describe);
  });
  console.log('ALL data-scope=checkbox PARTS:', JSON.stringify(checkboxParts, null, 2));

  // Try clicking the ROOT part (the whole clickable row, per Zag.js —
  // clicking anywhere in root toggles it) and verify via the real signal.
  const root = page.locator('[data-scope="checkbox"][data-part="root"]').first();
  const rootExists = await root.count();
  console.log('root part count:', rootExists);

  if (rootExists > 0) {
    const before = await page.locator('#checkbox\\:\\:ri\\:\\:input, input[type="checkbox"]').first()
      .evaluate(el => el.checked).catch(() => 'N/A');
    console.log('input.checked BEFORE root click:', before);

    await root.click();
    await page.waitForTimeout(500);

    const afterChecked = await page.locator('input[type="checkbox"]').first()
      .evaluate(el => el.checked).catch(() => 'N/A');
    const afterDataState = await root.getAttribute('data-state').catch(() => 'N/A');
    console.log('input.checked AFTER root click:', afterChecked, '| root data-state:', afterDataState);
  }

  await page.screenshot({ path: 'test-results/nc_ack_02_after_root_click.png', fullPage: true });
});
