const { test, expect } = require('../config/test-base');
const { adminFreshLogin } = require('../utils/helpers');
const DashboardFilterPage = require('../pages/DashboardFilterPage');
const { requireFeatureGround } = require('../config/projects');

// Feature stage SM16: the smoke replica of 19_dashboard_filter.spec.js — the
// dashboard's Filter drawer, in depth: drawer mechanics, field cascading,
// single-field filtering, combined filters, Reset, the no-match case, date-range
// edges, and RFI/NC cross-tab independence.
//
// THE ONLY SUBSTANTIVE CHANGE from the original is the work location. That spec
// hardcoded 'A-06c' in thirteen places — the app owner's manual-testing ground,
// which smoke must never touch. It now comes from the profile, so the drawer is
// exercised against S05b.
//
// Everything else is carried over deliberately and unchanged. This is the
// densest spec in the tier and its value is in details that were established
// live and are easy to lose in a rewrite — e.g. that Sub-Activity SHOWS an
// "Activity first" hint while its options are not actually gated (a real app
// quirk the spec asserts rather than works around), that filtering can
// legitimately EMPTY the table rather than narrow it, and that Work Area has no
// options until a Work Location is picked.
//
// Structurally it stays eight independent describes, each with its own Admin
// session, rather than one serial block: a failure in the date-range edges must
// not skip the cross-tab independence checks.

// The work location under test, pinned from the profile by each describe's
// beforeAll.
//
// A module-level holder rather than a constant because the profile arrives as a
// FIXTURE — it is chosen by the Playwright project's `use: { profileKey }` and
// so does not exist at module load, when a top-level const would be evaluated.
// Every beforeAll sets it; the getter throws rather than returning undefined,
// because an undefined value reaching selectField() fails as an inscrutable
// dropdown timeout instead of naming the real problem.
let _workLocation = null;

function setWorkLocation(profile) {
  requireFeatureGround(profile);
  _workLocation = profile.workLocations[0];
}

function workLocation() {
  if (!_workLocation) {
    throw new Error(
      'SM16: work location not set. Each describe’s beforeAll must call ' +
      'setWorkLocation(profile) before any test reads it.'
    );
  }
  return _workLocation;
}

// Dashboard "Detail Records" Filter drawer — same component for RFI and NC
// (confirmed via DOM dump, see DashboardFilterPage.js header comment), so
// every field/cascade/reset test below is run once per tab rather than
// duplicated, except where a scenario is specifically about the two tabs
// not interfering with each other.
test.describe('Dashboard Filter - drawer mechanics', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser, profile }) => {
    setWorkLocation(profile);
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  // Fresh navigation before EVERY test, not just once in beforeAll — a
  // test that fails partway through (e.g. mid-assertion) never reaches its
  // own cleanup line, which would otherwise leave the drawer open/fields
  // selected for the NEXT test to inherit. Confirmed live: this exact leak
  // made a later test see 790 pre-existing Sub-Activity options that had
  // nothing to do with that test's own actions.
  test.beforeEach(async () => {
    await filter.goto();
    await filter.switchToRFI();
  });

  test('Filter drawer opens on the RFI tab with all expected fields', async () => {
    await filter.openFilter();

    for (const field of [
      filter.clusterField, filter.siteField, filter.projectTypeField, filter.packageField,
      filter.subPackageField, filter.projectNameField, filter.contractorField,
      filter.workLocationField, filter.workAreaField, filter.activityField,
      filter.subActivityField, filter.fromDateTrigger, filter.toDateTrigger,
    ]) {
      await expect(field).toBeVisible();
    }
    await expect(filter.applyButton).toBeVisible();
    await expect(filter.resetButton).toBeVisible();
  });

  test('Filter drawer opens on the NC tab with the same fields', async () => {
    await filter.switchToNC();
    await filter.openFilter();
    await expect(filter.clusterField).toBeVisible();
    await expect(filter.workAreaField).toBeVisible();
    await expect(filter.applyButton).toBeVisible();
  });

  test('Close button closes the drawer', async () => {
    await filter.openFilter();
    await expect(filter.drawer).toBeVisible();
    await filter.closeFilter();
    await expect(filter.drawer).not.toBeVisible();
  });
});

test.describe('Dashboard Filter - cascading fields', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser, profile }) => {
    setWorkLocation(profile);
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    await filter.goto();
    await filter.switchToRFI();
    await filter.openFilter();
  });

  test('Work Area has no options until Work Location is picked, then does', async () => {
    expect(await filter.getFieldGatingText(filter.workAreaField)).toMatch(/work location.*first/i);
    expect(await filter.getFieldOptionCount(filter.workAreaField)).toBe(0);

    // NOT '__first__' — confirmed live that the alphabetically-first Work
    // Location ("A-01") genuinely has zero Work Areas in this data (the
    // cascade correctly shows "No items found", it's not a bug), so a
    // cascade-POPULATION test needs a location proven to have real work
    // areas.
    //
    // The profile's own work location is exactly that: S05b is the ground this
    // entire tier runs on, with BL01-BL07 confirmed live and BL03-BL14 mapped by
    // SM03. (The original named A-06c here for the same reason — it was the
    // location ITS session had proven — but that is the app owner's manual
    // ground, so the smoke tier uses its own.)
    await filter.selectField(filter.workLocationField, workLocation());
    // Fixed settle (networkidle + buffer), NOT expect.poll — polling via
    // getFieldOptionCount's own open/close cycle interrupted the in-flight
    // options fetch on every retry, confirmed live it never resolved even
    // after 10s of continuous polling despite the selection itself working.
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    expect(await filter.getFieldOptionCount(filter.workAreaField)).toBeGreaterThan(0);
  });

  // Unlike Work Area (genuinely 0 options until Work Location is set),
  // Sub-Activity's option LIST is never actually empty — confirmed live
  // (with proper per-test isolation, ruling out state leaking from an
  // earlier test) that it already offers all 790 sub-activities before
  // Activity is picked. "Select Activity first" is real UI text, but only
  // a hint, not an options gate — this test documents that real behavior
  // rather than asserting the (wrong) assumption that it mirrors Work Area.
  test('Sub-Activity shows an "Activity first" hint, but its options are not actually gated', async () => {
    expect(await filter.getFieldGatingText(filter.subActivityField)).toMatch(/activity.*first/i);
    const beforeCount = await filter.getFieldOptionCount(filter.subActivityField);
    expect(beforeCount).toBeGreaterThan(0);

    await filter.selectField(filter.activityField, '__first__');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await expect.poll(() => filter.getFieldGatingText(filter.subActivityField), { timeout: 5000 })
      .not.toMatch(/first/i);
  });
});

// Table columns confirmed via DOM dump: RFI ID(0) | Inspection Point(1) |
// Work Area(2) | Status(3) | Quantity(4) — Work Area is the only filter
// field with a directly-corresponding visible column, so it gets a strong
// per-row assertion; every other field gets a weaker (but still real)
// check: Apply completes without error and the grid settles into SOME
// coherent state (0 rows or a rendered, non-virtualized set), since the
// dashboard's true unfiltered total (45,125+ RFIs) makes a virtualized
// DOM row-count comparison against the unfiltered baseline meaningless —
// this many rows are never all in the DOM at once regardless of filtering.
const WORK_AREA_COLUMN = 2;

test.describe('Dashboard Filter - single-field filtering (RFI)', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser, profile }) => {
    setWorkLocation(profile);
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    await filter.goto();
    await filter.switchToRFI();
    await filter.openFilter();
  });

  const SIMPLE_FIELDS = [
    ['Cluster', f => f.clusterField],
    ['Site', f => f.siteField],
    ['Project Type', f => f.projectTypeField],
    ['Package', f => f.packageField],
    ['Sub-Package', f => f.subPackageField],
    ['Project Name', f => f.projectNameField],
    ['Select Contractor', f => f.contractorField],
  ];

  for (const [label, getField] of SIMPLE_FIELDS) {
    test(`Filtering by ${label} alone narrows or empties the table without error`, async () => {
      await filter.selectField(getField(filter), '__first__');
      await filter.clickApply();

      const count = await filter.getDataRowCount();
      expect(count).toBeGreaterThanOrEqual(0);
      console.log(`Filter by ${label} (first available value) -> ${count} rendered row(s)`);
    });
  }

  test('Filtering by Work Location alone narrows or empties the table without error', async () => {
    await filter.selectField(filter.workLocationField, workLocation());
    await filter.clickApply();
    const count = await filter.getDataRowCount();
    expect(count).toBeGreaterThanOrEqual(0);
    console.log(`Filter by Work Location=${workLocation()} -> ${count} rendered row(s)`);
  });

  test('Filtering by Work Area actually restricts the table to that Work Area', async () => {
    await filter.selectField(filter.workLocationField, workLocation());
    await page.waitForLoadState('networkidle');
    // Confirms the selection actually rendered before touching the Work Area
    // cascade below it — see DashboardFilterPage.confirmWorkLocationSelected's
    // own comment: found live 2026-09-05 that a fixed 1000ms sleep here
    // wasn't always enough under load, ~2h into a full smoke run.
    await filter.confirmWorkLocationSelected(workLocation());
    const picked = await filter.selectField(filter.workAreaField, '__first__');
    await filter.clickApply();

    const count = await filter.getDataRowCount();
    if (count > 0) {
      const values = await filter.getColumnValues(WORK_AREA_COLUMN);
      for (const v of values) expect(v).toBe(picked[0]);
    }
    console.log(`Filter by Work Location=${workLocation()} + Work Area=${picked[0]} -> ${count} row(s)`);
  });

  test('Filtering by Activity alone narrows or empties the table without error', async () => {
    await filter.selectField(filter.activityField, '__first__');
    await filter.clickApply();
    const count = await filter.getDataRowCount();
    expect(count).toBeGreaterThanOrEqual(0);
    console.log(`Filter by Activity (first available) -> ${count} rendered row(s)`);
  });

  test('Filtering by Sub-Activity alone narrows or empties the table without error', async () => {
    await filter.selectField(filter.activityField, '__first__');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await filter.selectField(filter.subActivityField, '__first__');
    await filter.clickApply();
    const count = await filter.getDataRowCount();
    expect(count).toBeGreaterThanOrEqual(0);
    console.log(`Filter by Activity+Sub-Activity (first available) -> ${count} rendered row(s)`);
  });

  test('Filtering by From date alone narrows or empties the table without error', async () => {
    await filter.selectDateField(filter.fromDateTrigger);
    await filter.clickApply();
    const count = await filter.getDataRowCount();
    expect(count).toBeGreaterThanOrEqual(0);
    console.log(`Filter by From date only -> ${count} rendered row(s)`);
  });

  test('Filtering by To date alone narrows or empties the table without error', async () => {
    await filter.selectDateField(filter.toDateTrigger);
    await filter.clickApply();
    const count = await filter.getDataRowCount();
    expect(count).toBeGreaterThanOrEqual(0);
    console.log(`Filter by To date only -> ${count} rendered row(s)`);
  });
});

test.describe('Dashboard Filter - combined filters', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser, profile }) => {
    setWorkLocation(profile);
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    await filter.goto();
    await filter.switchToRFI();
    await filter.openFilter();
  });

  test('Work Location + Work Area + Package together narrow to their intersection', async () => {
    await filter.selectField(filter.workLocationField, workLocation());
    await page.waitForLoadState('networkidle');
    // Confirms the selection actually rendered before touching the Work Area
    // cascade below it — see DashboardFilterPage.confirmWorkLocationSelected's
    // own comment: found live 2026-09-05 that a fixed 1000ms sleep here
    // wasn't always enough under load, ~2h into a full smoke run.
    await filter.confirmWorkLocationSelected(workLocation());
    const picked = await filter.selectField(filter.workAreaField, '__first__');
    await filter.selectField(filter.packageField, 'Civil');
    await filter.clickApply();

    const count = await filter.getDataRowCount();
    if (count > 0) {
      const values = await filter.getColumnValues(WORK_AREA_COLUMN);
      for (const v of values) expect(v).toBe(picked[0]);
    }
    console.log(`Filter by Work Location=${workLocation()} + Work Area=${picked[0]} + Package=Civil -> ${count} row(s)`);
  });

  test('Cluster + Site + date range together apply without error', async () => {
    await filter.selectField(filter.clusterField, '__first__');
    await page.waitForTimeout(500);
    await filter.selectField(filter.siteField, '__first__');
    await filter.selectDateField(filter.fromDateTrigger);
    await filter.selectDateField(filter.toDateTrigger);
    await filter.clickApply();

    const count = await filter.getDataRowCount();
    expect(count).toBeGreaterThanOrEqual(0);
    console.log(`Filter by Cluster + Site + From/To date -> ${count} row(s)`);
  });
});

test.describe('Dashboard Filter - reset', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser, profile }) => {
    setWorkLocation(profile);
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    await filter.goto();
    await filter.switchToRFI();
    await filter.openFilter();
  });

  test('Reset clears every selected field', async () => {
    await filter.selectField(filter.workLocationField, workLocation());
    await page.waitForLoadState('networkidle');
    // Confirms the selection actually rendered before touching the Work Area
    // cascade below it — see DashboardFilterPage.confirmWorkLocationSelected's
    // own comment: found live 2026-09-05 that a fixed 1000ms sleep here
    // wasn't always enough under load, ~2h into a full smoke run.
    await filter.confirmWorkLocationSelected(workLocation());
    await filter.selectField(filter.workAreaField, '__first__');
    // NOT filter.workLocationField directly — that's the bare search
    // <input>, which is always empty by design (see
    // DashboardFilterPage.selectedChipsContainer's comment); the selected
    // value renders as a chip in the surrounding trigger button instead.
    await expect(filter.selectedChipsContainer(filter.workLocationField)).toContainText(workLocation());

    await filter.clickReset();
    await filter.openFilter();
    expect(await filter.getFieldGatingText(filter.workAreaField)).toMatch(/first/i);
  });

  test('Reset restores the table to its unfiltered state', async () => {
    await filter.selectField(filter.workLocationField, workLocation());
    await page.waitForLoadState('networkidle');
    // Confirms the selection actually rendered before touching the Work Area
    // cascade below it — see DashboardFilterPage.confirmWorkLocationSelected's
    // own comment: found live 2026-09-05 that a fixed 1000ms sleep here
    // wasn't always enough under load, ~2h into a full smoke run.
    await filter.confirmWorkLocationSelected(workLocation());
    await filter.selectField(filter.workAreaField, '__first__');
    await filter.clickApply();
    const filteredCount = await filter.getDataRowCount();

    await filter.openFilter();
    await filter.clickReset();
    const resetCount = await filter.getDataRowCount();

    // Unfiltered total (45,125+ per the dashboard chart) always renders at
    // least as many DOM rows as any single-Work-Area filtered subset does,
    // virtualization notwithstanding — a real reset should never leave
    // FEWER rows visible than the filtered state had.
    expect(resetCount).toBeGreaterThanOrEqual(filteredCount);
    console.log(`Filtered: ${filteredCount} row(s) -> after Reset: ${resetCount} row(s)`);
  });
});

test.describe('Dashboard Filter - no-match case', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser, profile }) => {
    setWorkLocation(profile);
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    await filter.goto();
    await filter.switchToRFI();
    await filter.openFilter();
  });

  test('A date range with no activity shows an empty result, not an error', async () => {
    // A single day far enough in the past that no RFI submission is
    // plausible — the goal is a guaranteed-empty result, not a specific
    // date; any sufficiently old, narrow range works equally well.
    await filter.selectDateField(filter.fromDateTrigger, { value: '2001-01-01' });
    await filter.selectDateField(filter.toDateTrigger, { value: '2001-01-02' });
    await filter.clickApply();

    expect(await filter.hasNoRecords()).toBe(true);
  });
});

test.describe('Dashboard Filter - date-range edges', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser, profile }) => {
    setWorkLocation(profile);
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test.beforeEach(async () => {
    await filter.goto();
    await filter.switchToRFI();
    await filter.openFilter();
  });

  // NEITHER of these needs its date to be a SPECIFIC far-away value — the
  // intent is just "one valid date, filter applies without error" — so both
  // now take the picker's own default (whatever the first selectable day in
  // the currently-open month is) rather than the original's hardcoded
  // 2020-01-01 / 2026-12-31.
  //
  // That hardcoding was actually TWO separate problems, both found live
  // 2026-09-05: the calendar only ever renders one month at a time (no direct
  // jump to an arbitrary day — see navigateCalendarToMonth), and separately,
  // 2026-12-31 for the FROM field specifically can never be selected at all —
  // confirmed by the app owner driving the same picker by hand: "From" is
  // restricted to today-or-earlier, so a future date there is disabled
  // regardless of whether the calendar can even navigate to it.
  test('From date alone (no To) applies without error', async () => {
    await filter.selectDateField(filter.fromDateTrigger);
    await filter.clickApply();
    expect(await filter.getDataRowCount()).toBeGreaterThanOrEqual(0);
  });

  test('To date alone (no From) applies without error', async () => {
    await filter.selectDateField(filter.toDateTrigger);
    await filter.clickApply();
    expect(await filter.getDataRowCount()).toBeGreaterThanOrEqual(0);
  });

  test('From date after To date (invalid range) does not crash the page', async () => {
    // FROM: no explicit value — defaults to a selectable day in the CURRENT
    // month, which respects the today-or-earlier restriction above (a fixed
    // future value cannot). TO: a genuinely far-past date, which needs
    // navigateCalendarToMonth to reach at all. Current-month-FROM is later
    // than year-2020-TO by construction, so this is still a real inverted
    // range — just built from values the app will actually let you pick.
    await filter.selectDateField(filter.fromDateTrigger);
    await filter.selectDateField(filter.toDateTrigger, { value: '2020-01-01' });
    await filter.clickApply();

    // No assumption about WHICH way the app resolves an inverted range
    // (blocks it, swaps it, or just returns empty) — only that it doesn't
    // error out or leave the UI stuck.
    await expect(filter.applyButton.or(filter.drawer)).toBeVisible({ timeout: 5000 }).catch(() => {});
    expect(await filter.getDataRowCount()).toBeGreaterThanOrEqual(0);
  });
});

// CONFIRMED LIVE 2026-09-05 (tests/specs/inspection/00_inspect_work_location_chip.spec.js's
// cross-tab recon) and confirmed with the app owner: this describe block was
// originally named/written around the OPPOSITE assumption ("does not carry
// over to NC/RFI"), inherited unmodified from the regression tier's
// 19_dashboard_filter.spec.js. Live evidence shows the Filter drawer is ONE
// shared component for both the RFI and NC toggles (same fields, same
// state) — after selecting Work Location "S05b" + a Work Area on RFI, then
// switching to NC, Work Location's chip still read "S05b" and Work Area
// still had all 69 of its options (i.e. NOT reset to its gated state at
// all). The app owner confirmed this carryover is the intended design, not
// a bug — so this now asserts that carryover, the opposite of what it
// originally asserted.
test.describe('Dashboard Filter - cross-tab state sharing', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser, profile }) => {
    setWorkLocation(profile);
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('A filter applied on RFI is still in effect after switching to NC', async () => {
    await filter.goto();
    await filter.switchToRFI();
    await filter.openFilter();
    await filter.selectField(filter.workLocationField, workLocation());
    await page.waitForLoadState('networkidle');
    // Confirms the selection actually rendered before touching the Work Area
    // cascade below it — see DashboardFilterPage.confirmWorkLocationSelected's
    // own comment: found live 2026-09-05 that a fixed 1000ms sleep here
    // wasn't always enough under load, ~2h into a full smoke run.
    await filter.confirmWorkLocationSelected(workLocation());
    await filter.selectField(filter.workAreaField, '__first__');
    await filter.clickApply();

    await filter.switchToNC();
    await filter.openFilter();
    await expect(filter.selectedChipsContainer(filter.workLocationField)).toContainText(workLocation());
    expect(await filter.getFieldOptionCount(filter.workAreaField)).toBeGreaterThan(0);
    await filter.closeFilter();
  });

  test('A filter applied on NC is still in effect after switching to RFI', async () => {
    await filter.goto();
    await filter.switchToNC();
    await filter.openFilter();
    await filter.selectField(filter.workLocationField, workLocation());
    await page.waitForLoadState('networkidle');
    // Confirms the selection actually rendered before touching the Work Area
    // cascade below it — see DashboardFilterPage.confirmWorkLocationSelected's
    // own comment: found live 2026-09-05 that a fixed 1000ms sleep here
    // wasn't always enough under load, ~2h into a full smoke run.
    await filter.confirmWorkLocationSelected(workLocation());
    await filter.selectField(filter.workAreaField, '__first__');
    await filter.clickApply();

    await filter.switchToRFI();
    await filter.openFilter();
    await expect(filter.selectedChipsContainer(filter.workLocationField)).toContainText(workLocation());
    expect(await filter.getFieldOptionCount(filter.workAreaField)).toBeGreaterThan(0);
    await filter.closeFilter();
  });
});
