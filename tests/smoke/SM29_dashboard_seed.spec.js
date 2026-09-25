const { test, expect } = require('../config/test-base');
const { ensureSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const {
  ensureWorkAreaMapping, readDashboardTotals, createSeedRfi, createSeedNc,
} = require('../utils/smoke-prereqs');

// Setup stage SM29: DASHBOARD DATA PREREQUISITE — every work-area-scoped
// oversight role the dashboard stages look at must have at least one RFI and one
// NC inside its own WAM scope.
//
// App owner, 2026-09-25, with a screenshot of the Execution Lead's dashboard
// reading RFI TOTAL 0 / NC TOTAL 0 / "No records found": "if u will not create
// RFI for work area related to a mapped user what the hell you will get to see
// on dashboard while testing ... same issue of RFI and NC with Quality lead."
//
// That was structural, not bad luck. SM04 maps EL/QL onto BL06 and SM13 onto
// BL08/BL09, and nothing raises an RFI or NC on any of those before SM15-SM18
// look at dashboards. So SM17/SM18 were checking that an EMPTY dashboard
// renders, and passing.
//
// WHAT THIS DOES, in order, each step skipped when already true:
//   1. WAM: CI, EE, QI, CM, EL and QL onto featureGround.dashboardSeed (Admin).
//   2. Read EL's and QL's own dashboards.
//   3. If either shows RFI TOTAL 0, the CI raises one RFI there; if either
//      shows NC TOTAL 0, the QI raises one NC there.
//   4. Re-read both dashboards and HARD-ASSERT RFI > 0 and NC > 0 for each —
//      that is this stage's postcondition, and SM17 asserts it again.
//
// WHY ITS OWN AREA (BL11), NOT BL08/BL09 WHERE SM13 PUTS THE EL. In a laned run
// (tests/config/lanes.js) the dashboards run in the `readonly` lane concurrently
// with the `wam-sweep` lane, which is busy re-assigning BL08/BL09. Data seeded
// there could be looked at mid-reassignment. BL11 is featureGround.rfiCreate:
// SM23/SM24 only ADD RFIs to it (counts only go up), nothing re-points its WAM
// rows, and it is already a proven RFI and NC ground on qa. The NC uses
// profile.nc's activity, not profile.rfi's, so it cannot block SM23/SM24's RFIs
// (the NC-blocks-RFI rule is per activity/checkpoint/work-section triple).
//
// WHY A SETUP STAGE. It runs straight after SM03 in the serial prefix of BOTH run
// modes, so every later stage — in any lane — starts with the data in place.
//
// WHY NOT MAP THE ADMIN TIERS (CAD/SAD/PAD/PM) HERE TOO. Their rows sit at
// cluster / site / work-location level and SM04 exists to prove each tier can
// assign the tier below. Pre-filling those rows as Admin would turn every SM04
// step into a "No changes to save" no-op. They are scoped over the whole of
// S05b, which holds every RFI and NC this chain raises, so once SM04 has mapped
// them they have data too.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// The work-area-scoped roles whose dashboards must not be empty, and the flow
// roles that create/receive the seed records.
const VIEWERS = ['EL', 'QL'];
const ROLES = ['CI', 'EE', 'QI', 'CM', ...VIEWERS];

test.describe('Smoke setup SM29 - dashboard data prerequisite', () => {
  let profile, users, area;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    const ground = requireFeatureGround(profile);
    area = ground.dashboardSeed;
    expect(area, `Profile "${profile.key}" declares no featureGround.dashboardSeed area`).toBeTruthy();
    expect(profile.nc, `Profile "${profile.key}" has no nc data, so no seed NC can be raised`).toBeTruthy();
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

    users = await ensureSmokeUsers(browser, profile, ROLES);
    console.log(`\n=== SM29 dashboard seed: "${profile.key}" on ${profile.workLocations[0]} / ${area} ===`);
    for (const r of ROLES) console.log(`    ${r.padEnd(3)} ${users[r].role.padEnd(20)} ${users[r].name}`);
  });

  test('EL, QL and the flow roles are mapped on the dashboard seed area', async ({ browser }) => {
    test.setTimeout(15 * 60 * 1000);
    await ensureWorkAreaMapping(browser, profile, users, {
      roles: ROLES, areas: [area], label: 'SM29 seed WAM',
    });
  });

  test('EL and QL each see at least one RFI and one NC on their dashboard', async ({ browser }) => {
    // Two PWA logins (CI, QI) at worst, on top of four online ones.
    test.setTimeout(30 * 60 * 1000);

    const readAll = async (opts) => {
      const out = {};
      for (const k of VIEWERS) {
        out[k] = await readDashboardTotals(browser, users[k], PASSWORD, opts);
        console.log(`  ${k} "${users[k].name}" dashboard: RFI TOTAL ${out[k].rfi}, NC TOTAL ${out[k].nc}`);
      }
      return out;
    };

    // A short window for the first read: "0" here only decides whether to
    // create, and creating one extra record is cheap.
    const before = await readAll({ timeout: 15000 });
    const needRfi = VIEWERS.some((k) => !before[k].rfi);
    const needNc = VIEWERS.some((k) => !before[k].nc);

    if (needRfi) {
      const rfi = await createSeedRfi(browser, profile, users.CI, PASSWORD, area);
      console.log(`  seeded RFI ${rfi.rfiId} on ${area} (work section "${rfi.workSectionLabel}")`);
    } else {
      console.log('  RFI already visible to every viewer — none created');
    }
    if (needNc) {
      const nc = await createSeedNc(
        browser, profile, users.QI, PASSWORD, area, 'Smoke SM29 - dashboard data prerequisite'
      );
      console.log(`  seeded NC ${nc.ncId} on ${area}`);
    } else {
      console.log('  NC already visible to every viewer — none created');
    }

    // The postcondition, with a long window: a record created seconds ago may
    // take a moment to reach the aggregates.
    const after = (needRfi || needNc) ? await readAll({ timeout: 90000 }) : before;
    for (const k of VIEWERS) {
      expect(
        after[k].rfi,
        `${k} "${users[k].name}" is mapped on ${area}${needRfi ? ', where an RFI was just raised,' : ''} ` +
        `but the dashboard's RFI Distribution still reads ${after[k].rfi}. null means the TOTAL ` +
        `figure could not be read at all (a locator problem, not data).`
      ).toBeGreaterThan(0);
      expect(
        after[k].nc,
        `${k} "${users[k].name}" is mapped on ${area}${needNc ? ', where an NC was just raised,' : ''} ` +
        `but the dashboard's NC Distribution still reads ${after[k].nc}.`
      ).toBeGreaterThan(0);
    }
  });
});
