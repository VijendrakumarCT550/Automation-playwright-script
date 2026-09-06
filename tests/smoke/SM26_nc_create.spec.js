const { test, expect } = require('../config/test-base');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const NCCreatePage = require('../pages/NCCreatePage');

// Feature stage SM26: the smoke replica of 14_nc_create_qi.spec.js — the QI
// creating an NC, as a standalone act.
//
// NC creation is the QI's job — the REVERSE of RFI, which the CI creates. That
// inversion is the single most confusable thing about the NC side, which is why
// it is worth having asserted on its own rather than only inside SM06's four-TC
// flow.
//
// WHAT THIS ADDS OVER SM06: SM06 walks a tracked four-TC sequence
// (QI creates -> CI responds -> EE reviews -> QI reviews) and its assertions are
// about the sequence. This asserts the CREATE itself: that the post-submit URL
// yields an NC id, and that the new NC is at version V1. The version badge is
// the useful half — an NC that comes into existence already past V1 means the
// version counter is picking up state from a previous NC, and nothing in the
// flow stages would notice.
//
// ---------------------------------------------------------------------------
// GROUND: SHARES THE NC FLOW AREA, DELIBERATELY
// ---------------------------------------------------------------------------
// featureGround.ncCreate is BL05 — the same area SM06 uses for both viewports.
// Safe for one specific reason that does NOT generalise to RFI: an NC consumes
// nothing (duplicate NCs against identical details are legal), and BL05 is
// already NC-only ground, so an extra NC there cannot strand anything.
//
// Putting it on an RFI area would be the exact opposite: a non-approved NC
// BLOCKS RFI create/resubmit for the same (inspection checkpoint, work section),
// so an NC left mid-cycle on BL03 would lock the RFI flow out of that ground
// permanently. That asymmetry is why featureGround names ncCreate explicitly
// instead of letting it fall through to a spare area.
//
// WORK LOCATION MUST BE SET EXPLICITLY. Confirmed live on the original: Work
// Location is no longer pre-populated for the QI, and if it is left empty every
// downstream dropdown (Work Area, Vendor, Package, Activity, ...) stays empty
// with nothing to pick and no error explaining why.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

test.describe('Smoke stage SM26 - QI creates an NC', () => {
  test('QI can create a new NC and it starts at V1', async ({ browser, profile }) => {
    test.setTimeout(15 * 60 * 1000);

    const ground = requireFeatureGround(profile);
    expect(
      profile.nc,
      `Profile "${profile.key}" has no nc data — NC work is parked for wind ` +
      `(see tests/config/projects.js). This stage fails loudly rather than skipping, ` +
      `the same way SM06 does.`
    ).toBeTruthy();
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

    const area = ground.ncCreate || profile.nc.workArea;
    const qi = resolveSmokeUsers(profile, ['QI']).QI;

    // Built from profile.nc — the PROVEN combination the tracked four-TC NC
    // regression has always used — with only the work area re-pointed. The
    // defect type, category and activity strings are therefore not guesswork.
    //
    // ncDescription carries the stage name so an NC found later in the app is
    // traceable to what created it.
    const ncData = {
      workLocation: profile.nc.workLocation,
      workArea: area,
      vendorName: profile.nc.vendorName,
      package: profile.nc.package,
      activity: profile.nc.activity,
      subActivity: profile.nc.subActivity,
      workSectionCount: profile.nc.workSectionCount,
      ncQuantity: profile.nc.ncQuantity,
      unit: profile.nc.unit,
      ncDescription: 'Smoke SM26 - standalone NC creation check',
      defectType: profile.nc.defectType,
      category: profile.nc.category,
      // Mandatory per an app change. Capture Photo is also mandatory everywhere
      // now, and NCCreatePage.fillForm defaults capturePhoto to true, which is
      // why it is not repeated here.
      targetDateClosureDays: profile.nc.targetDateClosureDays,
    };

    const context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    const page = await context.newPage();

    try {
      console.log(
        `\n=== SM26 QI NC creation: "${profile.key}" ===\n` +
        `    QI     : ${qi.name} <${qi.email}>\n` +
        `    ground : ${ncData.workLocation} / ${area} (shared with the NC flow — NC consumes nothing)\n` +
        `    activity: ${ncData.activity}\n`
      );
      await loginAsFlowUser(page, qi.email, PASSWORD);

      const ncCreate = new NCCreatePage(page);
      await ncCreate.goto();
      await ncCreate.clickCreateNC();
      await ncCreate.fillForm(ncData);
      await ncCreate.submitNC();
      console.log(`  post-submit URL: ${page.url()}`);

      // The NC id comes from the URL, which for NC has NO /view suffix (unlike
      // RFI) — a difference confirmed live and easy to get wrong.
      const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
      expect(
        match,
        `Could not extract an NC id from the post-submit URL "${page.url()}". NC's ` +
        `post-submit URL has no /view suffix, unlike RFI's — if the URL looks right but ` +
        `this failed, check that difference first.`
      ).toBeTruthy();
      console.log(`  created NC ${match[1]}`);

      const version = await ncCreate.getVersionBadge();
      expect(
        version.toLowerCase(),
        `A newly created NC must start at V1, but this one reports "${version}". A higher ` +
        `version on a brand-new NC means the version counter is carrying state from a ` +
        `previous NC.`
      ).toBe('v1');
      console.log(`  version badge: ${version}`);
    } finally {
      await context.close();
    }
  });
});
