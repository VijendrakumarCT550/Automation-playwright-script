const { test, expect } = require('../config/test-base');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { resolveRfiFixture } = require('../utils/smoke-rfi-fixture');
const { createAndSubmitCheckpoint, resetToMyTasks, getVisibleCodeFor } = require('../utils/rfi-dependency-flow');

// Feature stage SM25: the smoke replica of
// 20_rfi_bulk_create_multi_location.spec.js — one RFI per WORK AREA, across
// several areas, in one session.
//
// ---------------------------------------------------------------------------
// THE ORIGINAL'S NAME IS MISLEADING, AND THAT MATTERS HERE
// ---------------------------------------------------------------------------
// "multi_location" implies several work LOCATIONS, which would have been a
// genuine blocker: the smoke profile declares exactly one (S05b), and the only
// other location this suite knows is A-06c — the app owner's manual ground.
//
// But all seven entries in that spec's own RFI_LOCATIONS table are
// `workLocation: 'A-06c'`; what varies between them is the work AREA
// (BL016/BL17/BL018/BL19/BL05/BL06/BL07). So the behaviour under test is "one
// RFI per area within a location", no second work location is needed, and
// profile.workLocations stays a single entry.
//
// WHAT THIS PROVES THAT SM24 DOES NOT: SM24 creates repeatedly on ONE area, so
// it exercises the work-section picker. This moves the AREA between creates, so
// it exercises the cascade re-resolving — the Work Area change has to invalidate
// and refetch Package/Activity/Checkpoint/work sections underneath it. A
// cascade that kept stale options from the previous area would produce an RFI
// filed against the wrong ground, which is far worse than a visible error.
//
// So the assertion is per-area: each RFI's id must be distinct AND each must
// have landed on the area it was asked for.
//
// SCALE: three areas, from featureGround.rfiBulkAreas, rather than the
// original's seven. Three proves cascade re-resolution as well as seven, at
// under half the ground cost — and each RFI permanently consumes a work section.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

test.describe('Smoke stage SM25 - one RFI per work area, single session', () => {
  test('CI creates one RFI on each of several work areas, each landing on the right area', async ({ browser, profile }) => {
    test.setTimeout(30 * 60 * 1000);

    const ground = requireFeatureGround(profile);
    const areas = (ground.rfiBulkAreas || []).filter(Boolean);
    expect(
      areas.length,
      `Profile "${profile.key}" declares no featureGround.rfiBulkAreas, so there are no ` +
      `areas to sweep. See tests/config/projects.js.`
    ).toBeGreaterThan(1);
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

    const ci = resolveSmokeUsers(profile, ['CI']).CI;

    const context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    const page = await context.newPage();

    try {
      console.log(
        `\n=== SM25 one RFI per work area: "${profile.key}" ===\n` +
        `    CI    : ${ci.name} <${ci.email}>\n` +
        `    areas : ${areas.join(', ')} @ ${profile.workLocations[0]}\n`
      );
      await loginAsFlowUser(page, ci.email, PASSWORD);

      const created = [];
      for (const [i, area] of areas.entries()) {
        // A FRESH fixture per area — this is what re-points the form's Work
        // Area and so forces the cascade below it to re-resolve.
        const fixture = resolveRfiFixture(profile, { workArea: area });
        expect(
          fixture.baseData.workArea,
          `Fixture for area ${area} should target it`
        ).toBe(area);

        const result = await createAndSubmitCheckpoint(
          page, fixture.baseData, fixture.checkpoint, '__random__'
        );
        created.push({ area, ...result });
        console.log(
          `  ${i + 1}/${areas.length}: ${area} -> RFI ${result.rfiId} ` +
          `on work section "${result.workSectionLabel}"`
        );
      }

      expect(created, `One RFI per area (${areas.length})`).toHaveLength(areas.length);

      const ids = created.map((c) => c.rfiId);
      expect(
        new Set(ids).size,
        `Every area's RFI should have a DISTINCT id, got ${JSON.stringify(ids)}`
      ).toBe(areas.length);

      // NOT a work-section-label uniqueness check — CONFIRMED LIVE 2026-09-05
      // (run 5, then a targeted recon spec,
      // tests/specs/inspection/00_inspect_sm25_work_section_collision.spec.js)
      // that work section labels are per-area LOCAL coordinates (e.g. "Row
      // 3, Tower 28"), not globally unique — two DIFFERENT areas (BL13,
      // BL14) legitimately both had a section named "R03-T28" in the same
      // live run, and both RFIs were nonetheless filed against their own
      // correct area (their visible codes read RFI-S05b-BL13-... and
      // RFI-S05b-BL14-... respectively, confirmed by navigating to each
      // one's own view page). A repeated section LABEL across areas is not
      // evidence of a stale cascade — checking it that way was this test's
      // own mistake, not the app's.
      //
      // The REAL invariant (which the section-label check was only ever a
      // flawed proxy for) is checked directly here instead: each created
      // RFI's own VISIBLE CODE must show the area it was actually requested
      // for. This is what would catch a cascade that kept a stale Work Area
      // selection underneath it.
      for (const c of created) {
        const code = await getVisibleCodeFor(page, c.rfiId);
        expect(
          code,
          `RFI created for area ${c.area} should carry that area in its own visible code, got "${code}"`
        ).toContain(c.area);
      }

      console.log(`  ${areas.length} areas, ${new Set(ids).size} distinct RFIs, every code confirms its own area`);

      await resetToMyTasks(page);
    } finally {
      await context.close();
    }
  });
});
