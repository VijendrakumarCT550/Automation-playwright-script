const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { openFromPendingWithMe } = require('../utils/nc-nav');
const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
const { resolveNcCreators } = require('../utils/smoke-tracker');
const DashboardPage = require('../pages/DashboardPage');
const NCCreatePage = require('../pages/NCCreatePage');
const NCResponsePage = require('../pages/NCResponsePage');
const NCReviewPage = require('../pages/NCReviewPage');
const { profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers } = require('./drs-profile');

// ===========================================================================
// IN04 — ONE FULL NC CYCLE PER CREATOR ON THE DRS PROJECT: <creator> raises →
// CI responds → EE approves → QI approves. docs/drs-pulse-integration.md §9.
//
// NC CREATORS (app change, 2026-10-08): NC can be raised by the QI, EE, PM, EL
// and QL — five roles, so five cycles here. PM / EL / QL only create (no draft,
// no review); the Create NC button is where it always was for QI. Everything
// after creation is identical whoever raised it. SMOKE_NC_CREATORS=QI,PM narrows
// it. Each creator's WAM on the NC area is a prerequisite and is ensured below.
//
// NC-only file (the standing rule: NC never shares code with RFI). Same page
// objects and the same proven NC data as nc-flow-turns.js / SM26, only the
// ground is ours: the project's NC Work Area (disjoint from IN03's RFI area,
// because a non-approved NC blocks RFI on the same checkpoint + section) and
// our DRS vendor.
//
// Needs IN01 + IN02. Run: PULSE_ENV=uat npx playwright test --project=integration tests/integration/IN04_nc_cycle.spec.js
// ===========================================================================

const profile = profileForSpec();
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const CREATORS = resolveNcCreators();
const ROLES = [...new Set([...CREATORS, 'CI', 'EE', 'QI'])];

test.describe.configure({ mode: 'serial' });

test.describe(`IN04. NC on ${profile.nc.workArea}: creator → CI → EE → QI`, () => {
  let users;

  test.beforeAll(async ({ browser }) => {
    requireAvailable(profile);
    test.setTimeout(30 * 60 * 1000);
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    users = drsUsers(profile, ROLES);
    for (const r of ROLES) expect(users[r], `${r} not recorded — run IN01 first`).toBeTruthy();
    // Prerequisite: every creator plus CI/EE/QI must hold the NC area in WAM.
    await ensureWorkAreaMapping(browser, profile, users, {
      roles: ROLES, areas: [profile.nc.workArea], label: 'IN04 prereq',
    });
  });

  for (const creator of CREATORS) {
    test(`IN04. NC raised by ${creator}: ${creator} → CI → EE → QI`, async ({ browser }) => {
      requireAvailable(profile);
      test.setTimeout(60 * 60 * 1000);
      const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);
      const nc = profile.nc;

      const context = await browser.newContext({
        permissions: ['geolocation', 'camera'],
        geolocation: { latitude: 23.0225, longitude: 72.5714 },
      });
      const page = await context.newPage();
      try {
        // 1. The creator raises.
        console.log(`  ${creator} ${users[creator].name}: raising an NC on ${nc.workLocation}/${nc.workArea}`);
        await loginAs(page, creator);
        const ncCreate = new NCCreatePage(page);
        await ncCreate.goto();
        await ncCreate.clickCreateNC();
        await ncCreate.fillForm({ ...nc, ncDescription: `DRS integration NC (${creator}) - ${profile.drs.project.name}` });
        await ncCreate.submitNC();
        const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
        expect(match, `no NC id in the post-submit URL "${page.url()}"`).toBeTruthy();
        const ncId = match[1];

        // Code via the dashboard first — the same DRAFT-placeholder refresh the
        // tracked NC flow uses (backfillNcCodesForQI). Only QI/EE have a PWA
        // dashboard guaranteed; PM/EL/QL read the NC page directly after it.
        const dashboard = new DashboardPage(page);
        await dashboard.goToDashboard().catch(() => {});
        await dashboard.waitForContentOnly().catch(() => {});
        await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${ncId}`);
        await page.waitForLoadState('networkidle');
        const code = await new NCReviewPage(page).getVisibleCode();
        expect(code, 'no visible NC code after create').toBeTruthy();
        console.log(`  ✓ NC ${code} (${ncId}) raised by ${creator}, Defect Type "${ncCreate.lastDefectType}"`);
        recordPulse(profile, { ncs: [...(recordedPulse(profile).ncs || []), { id: ncId, code, creator, workArea: nc.workArea, status: 'raised' }] });

        // 2. CI responds.
        console.log(`  CI ${users.CI.name}: responding to ${code}`);
        await loginAs(page, 'CI');
        await openFromPendingWithMe(page, code);
        const response = new NCResponsePage(page);
        expect(await response.getAttachmentCount(), `CI sees 0 attachments — ${creator}'s mandatory photo did not propagate`).toBeGreaterThan(0);
        await response.fillResponse({
          rootCause: 'DRS integration — automated root cause',
          correctiveActions: 'DRS integration — automated corrective actions',
        });
        await response.submitResponse();
        console.log('  ✓ CI responded');

        // 3. EE approves, 4. QI approves.
        for (const role of ['EE', 'QI']) {
          console.log(`  ${role} ${users[role].name}: approving ${code}`);
          await loginAs(page, role);
          await openFromPendingWithMe(page, code);
          const review = new NCReviewPage(page);
          expect(await review.getAttachmentCount(), `${role} sees 0 attachments on ${code}`).toBeGreaterThan(0);
          await review.approve();
          console.log(`  ✓ ${role} approved`);
        }

        const ncs = (recordedPulse(profile).ncs || []).map((x) => (x.id === ncId ? { ...x, status: 'approved' } : x));
        recordPulse(profile, { ncs });
      } finally {
        await context.close();
      }
    });
  }
});
