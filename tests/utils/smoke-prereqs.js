const { expect } = require('@playwright/test');
const { adminFreshLogin, loginAsUser, loginAsFlowUser } = require('./helpers');
const { openAssignmentDialog, assignAndProve } = require('./smoke-wam');

// ADMIN SCREENS ARE DESKTOP (2026-09-26). Playwright applies the PROJECT's
// device settings even to a context a test creates itself, so from a mobile
// flow stage (Pixel 7) this Admin session opened WAM in the phone layout and
// the desktop dialog clicks timed out: 'WAM dialog not usable — locator.click:
// Timeout 30000ms' x3, failing smoke-*-rfi-mobile and -nc-mobile before any
// flow work. Admin's WAM / Users screens are always driven at desktop size.
const { devices: __devices } = require('@playwright/test');
const ADMIN_DESKTOP_CONTEXT = {
  viewport: { width: 1600, height: 1000 },
  isMobile: false,
  hasTouch: false,
  deviceScaleFactor: 1,
  userAgent: __devices['Desktop Chrome'].userAgent,
};

// STAGE PREREQUISITES — each stage provisions what it needs instead of hoping an
// earlier stage left it behind.
//
// App owner, 2026-09-25, after a full run: "if spec will not fulfill its
// prerequisite who the hell will do for you???" Two concrete failures prompted
// it:
//
//   * SM24 (bulk RFI): the CI could not create an RFI because its OWN WAM did
//     not cover the area it was creating on. ensureSmokeUsers() only WAMs a user
//     it has just CREATED; a user that already existed in the record was trusted
//     to be mapped, which is only true if SM03 ran, passed, and nothing later
//     moved the row. Running one stage with --no-deps (the normal way to iterate
//     here) skips SM03 entirely.
//
//   * EL / QL dashboards were EMPTY. SM04 maps them onto BL06 and SM13 onto
//     BL08/BL09, and no stage ever raises an RFI or NC on any of those before the
//     dashboards are looked at — so the dashboard checks were looking at nothing
//     and passing anyway.
//
// So this module has two jobs.

// ---------------------------------------------------------------------------
// 1. ensureWorkAreaMapping — "is my own actor mapped on my own ground?"
// ---------------------------------------------------------------------------
// Admin reads each role's work-area rows and assigns only what is missing, then
// proves it with the usual close-reopen-reverify (assignAndProve). A row that
// already holds the user is left alone, so on a healthy chain this is a READ:
// one Admin login plus one dialog per role, ~15 s each on qa.
//
// Work-area rows are SINGLE-assignee for every role that has them (SM03 and SM13
// both assign them that way), so an assign replaces the incumbent. Only ever
// point this at the stage's own declared ground — the same ground lanes.js
// already records it as owning — so what gets replaced is this chain's own row.
//
// SMOKE_GROUND_GUARD=0 turns it off, for a run that must not touch WAM at all.
function wamFiltersFor(profile, user) {
  return {
    role: user.role,
    cluster: profile.cluster,
    site: profile.site,
    workLocation: profile.workLocations[0],
    package: profile.packages[0],
    // Precise SO string first, vendor name as fallback — a vendor can hold
    // several SOs, exactly as SM03 does it.
    serviceOrder: user.userType === 'VENDOR'
      ? [profile.vendor.serviceOrder, profile.vendor.name]
      : null,
  };
}

async function ensureWorkAreaMapping(browser, profile, users, { roles, areas, label = 'prereq' }) {
  const wanted = (areas || []).filter(Boolean);
  if (!wanted.length) throw new Error(`${label}: ensureWorkAreaMapping was given no work areas`);
  const missingUsers = roles.filter((r) => !users[r]);
  if (missingUsers.length) {
    throw new Error(`${label}: no resolved user for ${missingUsers.join(', ')} — pass them to ensureSmokeUsers first`);
  }
  if (process.env.SMOKE_GROUND_GUARD === '0') {
    console.log(`    ${label}: SMOKE_GROUND_GUARD=0 — trusting ${roles.join('/')} are mapped on ${wanted.join(', ')}`);
    return { assigned: [] };
  }

  console.log(`\n--- ${label}: checking WAM for ${roles.join(', ')} on ${wanted.join(', ')} ---`);
  const assigned = [];
  const { context, page, dashboard } = await adminFreshLogin(browser, ADMIN_DESKTOP_CONTEXT);
  try {
    for (const roleKey of roles) {
      const user = users[roleKey];
      const filters = wamFiltersFor(profile, user);
      const wam = await openAssignmentDialog(page, dashboard, filters);

      // Project Manager's WAM rows are WORK LOCATIONS, not work areas (SM04 /
      // docs §3.6), so mapping a PM "onto a work area" means mapping it onto the
      // work location that contains the area. Single-select, like CI/QI/EE, so
      // the same assign path applies. Needed since NC creation opened up to the
      // PM (2026-10-08).
      const rowsForRole = roleKey === 'PM' ? [profile.workLocations[0]] : wanted;
      const rowKind = roleKey === 'PM' ? 'work location' : 'work area';

      const missing = [];
      for (const row of rowsForRole) {
        const current = await wam.getWorkAreaUserValue(row).catch((err) => {
          throw new Error(
            `${label}: ${rowKind} "${row}" is not a row in Admin's WAM dialog for ${user.role} ` +
            `(${JSON.stringify(filters)}). ${err.message.split('\n')[0]}`
          );
        });
        if (!current.includes(user.name)) missing.push({ row, current });
      }

      if (!missing.length) {
        console.log(`    ${roleKey} "${user.name}": already on ${rowsForRole.join(', ')}`);
        await wam.closeDialog();
        continue;
      }

      for (const m of missing) {
        console.log(`    ${roleKey} "${user.name}": NOT on ${m.row} (row holds "${m.current || 'nobody'}") — assigning`);
      }
      await assignAndProve(wam, {
        filters,
        entries: missing.map((m) => ({ row: m.row, userName: user.name })),
        multi: false,
        label: `${label} ${roleKey}`,
      });
      assigned.push(...missing.map((m) => `${roleKey}@${m.row}`));
    }
  } finally {
    await context.close();
  }
  console.log(`--- ${label}: WAM ok${assigned.length ? ` (assigned ${assigned.join(', ')})` : ' (nothing to change)'} ---\n`);
  return { assigned };
}

// ---------------------------------------------------------------------------
// 2. Dashboard data — "does this role's dashboard have something to show?"
// ---------------------------------------------------------------------------
// Reads a role's own RFI / NC Distribution totals. Online roles (EL, QL, PM and
// the admin tiers) log in in seconds, so this is cheap.
async function readDashboardTotals(browser, user, password, { wantNonZero = true, timeout = 30000 } = {}) {
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();
  try {
    const dashboard = await loginAsUser(page, user.email, password);
    await dashboard.goToDashboard();
    // Let the first data fetch land before the cards are read (see
    // DashboardPage.getDistributionTotal's settle window).
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(2000);
    const rfi = await dashboard.getDistributionTotal('RFI Distribution', { wantNonZero, timeout });
    const nc = await dashboard.getDistributionTotal('NC Distribution', { wantNonZero, timeout });
    return { rfi, nc };
  } finally {
    await context.close();
  }
}

// Creates ONE submitted RFI as the CI on `workArea`, using profile.rfi's proven
// combination with a fresh ('__random__') work section. Solar has ~264-490
// sections per area, so one per run is nothing.
async function createSeedRfi(browser, profile, ci, password, workArea) {
  const { resolveRfiFixture } = require('./smoke-rfi-fixture');
  const { createAndSubmitCheckpoint, resetToMyTasks } = require('./rfi-dependency-flow');
  const fixture = resolveRfiFixture(profile, { workArea });

  const context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();
  try {
    await loginAsFlowUser(page, ci.email, password);
    const result = await createAndSubmitCheckpoint(page, fixture.baseData, fixture.checkpoint, '__random__');
    await resetToMyTasks(page);
    return result;
  } finally {
    await context.close();
  }
}

// Creates ONE NC as the QI on `workArea` from profile.nc — the same proven data
// SM26 uses, with only the area and description changed. Uses profile.nc's
// activity, which is deliberately NOT profile.rfi's, so this NC can never block
// an RFI on the same ground (a non-approved NC blocks RFI only on the same
// activity/checkpoint/work-section triple).
async function createSeedNc(browser, profile, qi, password, workArea, description) {
  const NCCreatePage = require('../pages/NCCreatePage');
  const nc = profile.nc;
  const context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();
  try {
    await loginAsFlowUser(page, qi.email, password);
    const ncCreate = new NCCreatePage(page);
    await ncCreate.goto();
    await ncCreate.clickCreateNC();
    await ncCreate.fillForm({
      workLocation: nc.workLocation,
      workArea,
      vendorName: nc.vendorName,
      package: nc.package,
      activity: nc.activity,
      subActivity: nc.subActivity,
      workSectionCount: nc.workSectionCount,
      ncQuantity: nc.ncQuantity,
      unit: nc.unit,
      ncDescription: description,
      defectType: nc.defectType,
      category: nc.category,
      targetDateClosureDays: nc.targetDateClosureDays,
    });
    await ncCreate.submitNC();
    const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
    expect(match, `Seed NC: no NC id in the post-submit URL "${page.url()}"`).toBeTruthy();
    return { ncId: match[1] };
  } finally {
    await context.close();
  }
}

module.exports = {
  wamFiltersFor,
  ensureWorkAreaMapping,
  readDashboardTotals,
  createSeedRfi,
  createSeedNc,
};
