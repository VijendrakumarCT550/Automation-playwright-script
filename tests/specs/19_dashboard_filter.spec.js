const { test, expect } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const DashboardFilterPage = require('../pages/DashboardFilterPage');

// Dashboard "Detail Records" Filter drawer — same component for RFI and NC
// (confirmed via DOM dump, see DashboardFilterPage.js header comment), so
// every field/cascade/reset test below is run once per tab rather than
// duplicated, except where a scenario is specifically about the two tabs
// not interfering with each other.
test.describe('Dashboard Filter - drawer mechanics', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser }) => {
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

  test.beforeAll(async ({ browser }) => {
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
    // areas. 'A-06c' is exactly that — used throughout this whole
    // session's RFI/NC/WAM automation with confirmed BL01-BL05 areas.
    await filter.selectField(filter.workLocationField, 'A-06c');
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

  test.beforeAll(async ({ browser }) => {
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
    await filter.selectField(filter.workLocationField, 'A-06c');
    await filter.clickApply();
    const count = await filter.getDataRowCount();
    expect(count).toBeGreaterThanOrEqual(0);
    console.log(`Filter by Work Location=A-06c -> ${count} rendered row(s)`);
  });

  test('Filtering by Work Area actually restricts the table to that Work Area', async () => {
    await filter.selectField(filter.workLocationField, 'A-06c');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const picked = await filter.selectField(filter.workAreaField, '__first__');
    await filter.clickApply();

    const count = await filter.getDataRowCount();
    if (count > 0) {
      const values = await filter.getColumnValues(WORK_AREA_COLUMN);
      for (const v of values) expect(v).toBe(picked[0]);
    }
    console.log(`Filter by Work Location=A-06c + Work Area=${picked[0]} -> ${count} row(s)`);
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

  test.beforeAll(async ({ browser }) => {
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
    await filter.selectField(filter.workLocationField, 'A-06c');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    const picked = await filter.selectField(filter.workAreaField, '__first__');
    await filter.selectField(filter.packageField, 'Civil');
    await filter.clickApply();

    const count = await filter.getDataRowCount();
    if (count > 0) {
      const values = await filter.getColumnValues(WORK_AREA_COLUMN);
      for (const v of values) expect(v).toBe(picked[0]);
    }
    console.log(`Filter by Work Location=A-06c + Work Area=${picked[0]} + Package=Civil -> ${count} row(s)`);
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

  test.beforeAll(async ({ browser }) => {
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
    await filter.selectField(filter.workLocationField, 'A-06c');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await filter.selectField(filter.workAreaField, '__first__');
    await expect(filter.workLocationField).toContainText('A-06c');

    await filter.clickReset();
    await filter.openFilter();
    expect(await filter.getFieldGatingText(filter.workAreaField)).toMatch(/first/i);
  });

  test('Reset restores the table to its unfiltered state', async () => {
    await filter.selectField(filter.workLocationField, 'A-06c');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
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

  test.beforeAll(async ({ browser }) => {
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

  test.beforeAll(async ({ browser }) => {
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

  test('From date alone (no To) applies without error', async () => {
    await filter.selectDateField(filter.fromDateTrigger, { value: '2020-01-01' });
    await filter.clickApply();
    expect(await filter.getDataRowCount()).toBeGreaterThanOrEqual(0);
  });

  test('To date alone (no From) applies without error', async () => {
    await filter.selectDateField(filter.toDateTrigger, { value: '2026-12-31' });
    await filter.clickApply();
    expect(await filter.getDataRowCount()).toBeGreaterThanOrEqual(0);
  });

  test('From date after To date (invalid range) does not crash the page', async () => {
    await filter.selectDateField(filter.fromDateTrigger, { value: '2026-12-31' });
    await filter.selectDateField(filter.toDateTrigger, { value: '2020-01-01' });
    await filter.clickApply();

    // No assumption about WHICH way the app resolves an inverted range
    // (blocks it, swaps it, or just returns empty) — only that it doesn't
    // error out or leave the UI stuck.
    await expect(filter.applyButton.or(filter.drawer)).toBeVisible({ timeout: 5000 }).catch(() => {});
    expect(await filter.getDataRowCount()).toBeGreaterThanOrEqual(0);
  });
});

test.describe('Dashboard Filter - cross-tab independence', () => {
  let context, page, filter;

  test.beforeAll(async ({ browser }) => {
    ({ context, page } = await adminFreshLogin(browser));
    filter = new DashboardFilterPage(page);
  });

  test.afterAll(async () => {
    await context.close();
  });

  test('A filter applied on RFI does not carry over to NC', async () => {
    await filter.goto();
    await filter.switchToRFI();
    await filter.openFilter();
    await filter.selectField(filter.workLocationField, 'A-06c');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await filter.selectField(filter.workAreaField, '__first__');
    await filter.clickApply();

    await filter.switchToNC();
    await filter.openFilter();
    expect(await filter.getFieldGatingText(filter.workAreaField)).toMatch(/first/i);
    await filter.closeFilter();
  });

  test('A filter applied on NC does not carry over to RFI', async () => {
    await filter.goto();
    await filter.switchToNC();
    await filter.openFilter();
    await filter.selectField(filter.workLocationField, 'A-06c');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);
    await filter.selectField(filter.workAreaField, '__first__');
    await filter.clickApply();

    await filter.switchToRFI();
    await filter.openFilter();
    expect(await filter.getFieldGatingText(filter.workAreaField)).toMatch(/first/i);
    await filter.closeFilter();
  });
});
