const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const { RFI_DATA, createNewRfi, backfillRfiCodes } = require('../utils/rfi-flow-turns');
const { loadTracker, setRfiId, setRfiCode } = require('../utils/tracker-utils');
const RFIReviewPage = require('../pages/RFIReviewPage');

// THROWAWAY inspector — creates ONE fresh RFI as CI with known RFI_DATA,
// then opens it as EE and dumps the review page's DOM so we can see exactly
// how Page-1 field values and checklist observations render in read-only/
// review mode. Purpose: find the real locators/text structure needed to
// build read-back methods for a data-integrity spec (CI's entered values
// must reach EE/QI's review screen unchanged) — nothing here should be
// treated as a real regression test. Delete once that spec exists and its
// findings are captured in code comments, matching this repo's established
// 00_inspect_*.spec.js convention.
test('INSPECT: dump EE review page structure for a freshly-created RFI', async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);

  await loginAsRole(page, 'CI');
  const tcId = 'INSPECT-01';
  const rfiId = await createNewRfi(page);
  const tracker = { [tcId]: { rfiId, rfiCode: null, currentVersion: 'V1' } };
  // Reuse backfillRfiCodes's dashboard-first re-read to get the real code —
  // but it reads/writes the REAL tracker file via tracker-utils, which we
  // don't want to touch for a throwaway TC. Read the code directly instead.
  const DashboardPage = require('../pages/DashboardPage');
  const RFIChecklistPage = require('../pages/RFIChecklistPage');
  const dashboard = new DashboardPage(page);
  await dashboard.goToDashboard();
  await dashboard.waitForContentOnly();
  await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/view`);
  await page.waitForLoadState('networkidle');
  const rfiCode = await new RFIChecklistPage(page).getVisibleCode();
  console.log('=== CREATED RFI ===');
  console.log('rfiId:', rfiId);
  console.log('rfiCode:', rfiCode);
  console.log('RFI_DATA used:', JSON.stringify(RFI_DATA, null, 2));

  await loginAsRole(page, 'EE');
  await openFromPendingWithMe(page, rfiCode);
  const review = new RFIReviewPage(page);
  await review.expandAllChecklist();

  console.log('=== EE REVIEW PAGE — FULL TEXT DUMP ===');
  console.log(await page.locator('body').innerText());

  console.log('=== EE REVIEW PAGE — ALL LABEL/VALUE-LOOKING PAIRS (dt/dd, label+sibling) ===');
  const pairs = await page.evaluate(() => {
    const out = [];
    // Common "read-only field" shapes: dt/dd, label followed by a value node,
    // or a div with two child text nodes (label then value).
    document.querySelectorAll('dt').forEach(dt => {
      const dd = dt.nextElementSibling;
      if (dd) out.push({ shape: 'dt/dd', label: dt.textContent.trim(), value: dd.textContent.trim() });
    });
    document.querySelectorAll('label').forEach(label => {
      const sib = label.nextElementSibling;
      if (sib) out.push({ shape: 'label+sibling', label: label.textContent.trim(), value: sib.textContent.trim() });
    });
    return out;
  });
  console.log(JSON.stringify(pairs, null, 2));

  console.log('=== EE REVIEW PAGE — SCREENSHOT SAVED ===');
  await page.screenshot({ path: 'test-results/inspect-ee-review-page.png', fullPage: true });
});
