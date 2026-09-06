const { test, expect } = require('../config/test-base');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { resolveRfiFixture } = require('../utils/smoke-rfi-fixture');
const { createAndSubmitCheckpoint, resetToMyTasks } = require('../utils/rfi-dependency-flow');

// Feature stage SM24: the smoke replica of 03_rfi_bulk_create.spec.js — several
// RFIs created back-to-back in ONE session on ONE work area.
//
// WHAT THIS PROVES THAT SM23 DOES NOT. SM23 creates one RFI per behaviour it
// checks, each after a fresh reset. This creates them consecutively without
// re-logging-in, which is where a different class of bug lives: state left over
// from the previous create leaking into the next one. Specifically it proves the
// work-section picker keeps handing out DISTINCT sections rather than
// re-offering a consumed one — which, if it broke, would show up as a duplicate
// rejection on RFI 2 rather than as anything obviously wrong.
//
// The assertion that matters is therefore not "N RFIs were created" but "N
// DISTINCT ids on N DISTINCT work sections".
//
// COUNT: three, not the original's larger batch. The behaviour under test is
// "consecutive creates in one session stay independent", which three
// demonstrates; the original's volume was about giving the app owner bulk data
// to look at manually, which is not what a smoke leaf is for. Each RFI
// permanently consumes a work section, so the count is a real cost.
//
// GROUND: featureGround.rfiCreate — shared with SM23, which is fine and
// deliberate: solar has ~264-490 sections per area, so both stages' handful
// together is nothing, and they are serialised by --workers=1.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const TOTAL_RFIS = 3;

test.describe('Smoke stage SM24 - bulk RFI creation in one session', () => {
  test(`CI creates ${TOTAL_RFIS} RFIs consecutively in a single session, all distinct`, async ({ browser, profile }) => {
    // Generous: three full create cycles plus one login, each cycle including a
    // work-section fetch and a checklist fill.
    test.setTimeout(30 * 60 * 1000);

    const ground = requireFeatureGround(profile);
    const area = ground.rfiCreate;
    expect(area, `Profile "${profile.key}" declares no featureGround.rfiCreate area`).toBeTruthy();
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

    const ci = resolveSmokeUsers(profile, ['CI']).CI;
    const fixture = resolveRfiFixture(profile, { workArea: area });

    const context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    const page = await context.newPage();

    try {
      console.log(
        `\n=== SM24 bulk RFI create: "${profile.key}" ===\n` +
        `    CI     : ${ci.name} <${ci.email}>\n` +
        `    ground : ${fixture.baseData.workLocation} / ${area}\n` +
        `    creating ${TOTAL_RFIS} RFIs in ONE session\n`
      );
      await loginAsFlowUser(page, ci.email, PASSWORD);

      const created = [];
      for (let i = 1; i <= TOTAL_RFIS; i++) {
        // '__random__' asks the picker for any free section. Passing the same
        // token every time is the point: if the picker ever re-offers a
        // consumed section, createAndSubmitCheckpoint throws on the duplicate
        // rejection and names the checkpoint.
        const result = await createAndSubmitCheckpoint(
          page, fixture.baseData, fixture.checkpoint, '__random__'
        );
        created.push(result);
        console.log(
          `  ${i}/${TOTAL_RFIS}: RFI ${result.rfiId} on work section "${result.workSectionLabel}"`
        );
      }

      // ---- the assertions that actually matter ----
      expect(created, `All ${TOTAL_RFIS} creates should have completed`).toHaveLength(TOTAL_RFIS);

      const ids = created.map((c) => c.rfiId);
      expect(
        new Set(ids).size,
        `All ${TOTAL_RFIS} RFIs should have DISTINCT ids, got ${JSON.stringify(ids)}. A repeat ` +
        `means a create returned the previous RFI's id rather than making a new one.`
      ).toBe(TOTAL_RFIS);

      const sections = created.map((c) => c.workSectionLabel);
      expect(
        new Set(sections).size,
        `All ${TOTAL_RFIS} RFIs should sit on DISTINCT work sections, got ` +
        `${JSON.stringify(sections)}. A repeat means the work-section picker re-offered a ` +
        `section already consumed in this session — the specific bug consecutive creates ` +
        `exist to catch.`
      ).toBe(TOTAL_RFIS);

      console.log(`  all ${TOTAL_RFIS} distinct: ${ids.join(', ')}`);

      // Leave no half-open create form behind for the next stage.
      await resetToMyTasks(page);
    } finally {
      await context.close();
    }
  });
});
