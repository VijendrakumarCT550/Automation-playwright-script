const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround, smokeMappedWorkAreas } = require('../config/projects');
const { openAssignmentDialog, assignAndProve } = require('../utils/smoke-wam');

// Feature stage SM27: puts SM01's users back on every work area the chain maps,
// and asserts it.
//
// App owner, 2026-09-04: "after checking creation mapping demapping old SM01
// users should be restored."
//
// ---------------------------------------------------------------------------
// WHY A WHOLE STAGE, WHEN EVERY MUTATING STAGE ALREADY RESTORES ITSELF
// ---------------------------------------------------------------------------
// SM19, SM20, SM21 and SM22 each restore what they changed, with the restore
// asserted rather than best-effort. But a stage that DIES mid-mutation never
// reaches its own restore — and because Playwright reports the failure at the
// point of death, nothing in the report says the ground is now dirty. The
// consequence surfaces on the NEXT run, in a different stage, as "work area not
// visible" during RFI creation, with nothing linking it back.
//
// This stage closes that gap: it re-asserts the whole mapped band from scratch,
// so the chain always ends with its ground in a known state regardless of what
// failed earlier.
//
// ---------------------------------------------------------------------------
// IT IS A LEAF, NOT A DEPENDENT OF THE MUTATING STAGES
// ---------------------------------------------------------------------------
// Deliberate. Depending on SM19-SM22 would mean that a mutating FAILURE — the
// exact case this exists for — would skip the restore, since Playwright skips
// dependents of a failed project. That is the cascade this whole restructure
// removed and it must not come back for the one stage whose job is cleanup.
//
// As a leaf it always runs. It is declared last in SMOKE_FEATURE_STAGES so a
// full run reaches it last, and it is fully idempotent (assignUserIfNeeded
// no-ops when the row is already right), so running it early or twice is
// harmless — it would simply re-assert state that is already correct.
//
// Run it on its own at any time with `npm run smoke:restore`.
//
// NOT serial mode, and this is the one file in the tier where getting this
// wrong would matter most: `serial` means one role's restore failing would
// skip restoring the OTHER THREE roles too — the exact opposite of what a
// last-line-of-defence baseline restore is for. Each role's restore is
// independent (its own filters, its own dialog), so a failure in one costs
// only that one. See SM01's comment for the fuller reasoning.

// Only the FLOW roles. The hierarchy tiers are mapped by SM04's cascade at
// varying row granularities (cluster / site / work location), which is a
// different dialog shape entirely — and unlike the flow roles they sit on
// MULTI-assignee rows, so nothing can have evicted them. What actually needs
// restoring is the single-assignee work-area rows.
const FLOW_ROLES = ['CI', 'CM', 'EE', 'QI'];

test.describe('Smoke stage SM27 - restore the SM01 baseline mapping', () => {
  let context, page, dashboard, profile, users, areas;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    requireFeatureGround(profile);

    users = resolveSmokeUsers(profile, FLOW_ROLES);
    areas = smokeMappedWorkAreas(profile);
    expect(areas.length, `Profile "${profile.key}" maps no work areas`).toBeGreaterThan(0);

    ({ context, page, dashboard } = await adminFreshLogin(browser));
    console.log(
      `\n=== SM27 restore baseline: "${profile.key}" ===\n` +
      `    re-asserting ${FLOW_ROLES.length} flow role(s) across ${areas.length} area(s)\n` +
      `    ${areas.join(', ')} @ ${profile.workLocations[0]}`
    );
    for (const r of FLOW_ROLES) console.log(`    ${r} (${users[r].role}): ${users[r].name}`);
    console.log('');
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  for (const roleKey of FLOW_ROLES) {
    test(`${roleKey} is assigned to every mapped work area (restored if not)`, async () => {
      test.setTimeout(15 * 60 * 1000);
      const user = users[roleKey];

      const filters = {
        role: user.role,
        cluster: profile.cluster,
        site: profile.site,
        workLocation: profile.workLocations[0],
        package: profile.packages[0],
        serviceOrder: user.userType === 'VENDOR'
          ? [profile.vendor.serviceOrder, profile.vendor.name]
          : null,
      };

      const wam = await openAssignmentDialog(page, dashboard, filters);

      // Report what was ACTUALLY wrong before fixing it. Without this the stage
      // would silently pass whether the ground was already fine or had been left
      // badly broken, and "did anything get damaged this run?" is exactly the
      // question it exists to answer.
      const drift = [];
      for (const area of areas) {
        const current = await wam.getWorkAreaUserValue(area).catch(() => '');
        if (!current.includes(user.name)) {
          drift.push({ area, found: current || '(empty)' });
        }
      }
      if (drift.length) {
        console.log(
          `  ${roleKey}: ${drift.length} area(s) had drifted and are being restored:\n` +
          drift.map((d) => `      ${d.area}: found "${d.found}", expected "${user.name}"`).join('\n')
        );
      } else {
        console.log(`  ${roleKey}: all ${areas.length} area(s) already correct — nothing to restore`);
      }

      // assignAndProve is idempotent (assignUserIfNeeded no-ops on a row that
      // already holds this user) and ends with a close-reopen verification read
      // back from the server, so this both repairs and proves in one pass.
      await assignAndProve(wam, {
        filters,
        entries: areas.map((row) => ({ row, userName: user.name })),
        multi: false,
        label: `${roleKey} restore`,
      });
    });
  }
});
