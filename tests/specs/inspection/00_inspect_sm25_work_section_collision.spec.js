const { test } = require('@playwright/test');
const { loginAsFlowUser } = require('../../utils/helpers');
const RFIChecklistPage = require('../../pages/RFIChecklistPage');

// PURE RECON — no assertions. SM25's live run 5 created 3 RFIs across areas
// BL12/BL13/BL14 in one session and found BL13's and BL14's RFIs landed on
// the SAME-LABELED work section ("R03-T28") — the test treats a repeated
// section label across DIFFERENT areas as proof the cascade didn't
// re-resolve (filed against the wrong area). Before accepting that
// conclusion, check the actual RFI records: if their VISIBLE CODES (which
// encode work area directly, e.g. RFI-S05b-BL13-...) show the correct,
// DISTINCT areas, then the two areas simply happen to share a work-section
// LABEL naming coincidence, and the test's assumption ("work sections are
// named per area", i.e. cross-area-unique) is what's wrong — not the app.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const CI_EMAIL = 'CISLqkfUser81@adani.com';

const RFI_IDS = {
  BL12: '13cca874-5f7f-45d2-b0ec-e3d0f3874584',
  BL13: '05fba4c4-b58a-4507-87ae-2803a41e6fb1',
  BL14: 'f486fb29-e89e-405b-9dbf-d6a90bb5641c',
};

test('RECON: do BL13 and BL14 RFIs actually show different work areas despite sharing a work-section label', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();
  await loginAsFlowUser(page, CI_EMAIL, PASSWORD);

  for (const [area, rfiId] of Object.entries(RFI_IDS)) {
    await page.goto(`${process.env.BASE_URL}/my-tasks/rfi/${rfiId}/view`);
    await page.waitForLoadState('networkidle');
    const checklist = new RFIChecklistPage(page);
    const code = await checklist.getVisibleCode().catch(e => `ERROR: ${e.message}`);
    // Dump whatever visibly shows "Work Area" on this page, not just the code.
    const workAreaText = await page.locator('text=/Work Area/i').first()
      .locator('xpath=ancestor::*[self::div][1]').innerText().catch(() => 'N/A');
    console.log(`${area} (requested) -> RFI id ${rfiId}: visible code = "${code}", Work Area field context: "${workAreaText.replace(/\n/g, ' | ')}"`);
  }

  await context.close();
});
