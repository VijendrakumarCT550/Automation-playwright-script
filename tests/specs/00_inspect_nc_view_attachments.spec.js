/**
 * DOM Discovery script — NOT a real test, no assertions.
 *
 * Round 2: getAttachmentCount() still reads 0 via the REAL navigation path
 * (openFromPendingWithMe: My Tasks -> NC tab -> Pending with me -> eye
 * icon, a client-side SPA transition) even with a 5s poll added — despite
 * a direct page.goto() to the same NC/role finding the image immediately
 * (see the first round of this file). Reproduce the real path exactly and
 * dump the DOM repeatedly over time to see whether the image ever shows up
 * at all under this navigation style, or something structurally differs.
 *
 * Usage: point NC_CODE below at a real TC's ncCode from nc-tracker.json:
 *   npx playwright test tests/specs/00_inspect_nc_view_attachments.spec.js --project=chromium --headed --reporter=list --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const { loginAsRole } = require('../utils/helpers');
const { openFromPendingWithMe } = require('../utils/nc-nav');

const NC_CODE = 'NC-A-06c-BL01-CIV-29'; // TC-01

test('inspect View Attachments via real click-through navigation', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await loginAsRole(page, 'CI');

  await openFromPendingWithMe(page, NC_CODE);
  console.log('Landed on:', page.url());

  fs.mkdirSync('test-results', { recursive: true });

  // Dump at several intervals to see if/when the image appears.
  for (const delayMs of [0, 2000, 5000, 10000]) {
    if (delayMs > 0) await page.waitForTimeout(delayMs - (delayMs === 2000 ? 0 : 2000));
    const state = await page.evaluate(() => {
      const describe = (node) => ({
        tag: node.tagName,
        className: typeof node.className === 'string' ? node.className : '',
        src: node.src ? node.src.slice(0, 80) : null,
      });
      const label = Array.from(document.querySelectorAll('p, div, span'))
        .find(el => el.textContent && el.textContent.trim() === 'View Attachments');
      return {
        hasViewAttachmentsLabel: !!label,
        labelParentHTML: label && label.parentElement ? label.parentElement.outerHTML.slice(0, 1000) : null,
        allImages: Array.from(document.querySelectorAll('img')).map(describe),
      };
    });
    console.log(`STATE at +${delayMs}ms:`, JSON.stringify(state, null, 2));
  }

  await page.screenshot({ path: 'test-results/nc_attachments_realpath.png', fullPage: true });
  fs.writeFileSync('test-results/nc_attachments_realpath.html', await page.content());
});
