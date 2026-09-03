const { test, expect } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const { loadLastCreatedUsers } = require('../../utils/user-counter-utils');

// PURE RECON — confirms DashboardPage.getChartDataFingerprint() actually
// distinguishes RFI-mode from NC-mode content (added per user's direct
// observation that the previous check only verified the toggle BUTTON's own
// active/inactive class, never whether the chart underneath re-rendered).
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const lastCreated = loadLastCreatedUsers();

test('RECON: chart fingerprint actually differs between RFI and NC', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  const cad = lastCreated.CAD;
  const dashboard = await loginAsUser(page, cad.email, PASSWORD);
  await dashboard.goToDashboard();

  for (const [label, toggle] of [['TAT Summary', dashboard.tatSummaryToggle], ['Trend Analysis', dashboard.trendAnalysisToggle]]) {
    const rfiFp = await dashboard.waitForStableChartFingerprint(label);
    console.log(`${label} RFI fingerprint (first 200 chars): ${rfiFp.slice(0, 200)}`);
    console.log(`${label} RFI fingerprint length: ${rfiFp.length}`);

    await dashboard.clickChartToggle(toggle.nc);
    const ncFp = await dashboard.waitForStableChartFingerprint(label);
    console.log(`${label} NC fingerprint (first 200 chars): ${ncFp.slice(0, 200)}`);
    console.log(`${label} NC fingerprint length: ${ncFp.length}`);
    console.log(`${label}: RFI === NC fingerprint? ${rfiFp === ncFp}`);

    await dashboard.clickChartToggle(toggle.rfi);
    const rfiFp2 = await dashboard.waitForStableChartFingerprint(label);
    console.log(`${label}: RFI fingerprint stable after round-trip? ${rfiFp === rfiFp2}`);
  }

  await context.close();
});
