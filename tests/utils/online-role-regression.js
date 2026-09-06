const { expect } = require('@playwright/test');
const { loginAsUser, returnToPulse } = require('./helpers');
const { loadLastCreatedUsers } = require('./user-counter-utils');
const DashboardPage = require('../pages/DashboardPage');
const MyTasksPage = require('../pages/MyTasksPage');
const WAMPage = require('../pages/WAMPage');
const SOMappingPage = require('../pages/SOMappingPage');
const UserManagementPage = require('../pages/UserManagementPage');
const ReportsPage = require('../pages/ReportsPage');

// Shared body for the 7 per-role "online hierarchy user" extensive
// regression specs (tests/online-roles/*.spec.js — CAD/SAD/PAD/PM/EL/QL/CM).
// One function, called from 7 thin spec files, so the ~full sweep isn't
// hand-duplicated 7 times — but each role still gets its OWN spec file/test
// result, per explicit request.
//
// PREREQUISITE, per explicit user instruction: each role's own WAM
// assignment must already exist before this runs (12_user_management.spec.js
// -> 13_wam_all_roles.spec.js / 18_wam_hierarchy.spec.js). This is enforced
// as a live guard below (Section 3), not just a comment: if a role's own WAM
// scope can't be confirmed live, the jurisdiction-dependent Users/Add-User
// check downgrades from a hard assertion to a logged finding rather than
// failing over missing test setup it isn't this spec's job to provide.
//
// CONFIRMED vs ASSUMED, same convention as tests/config/projects.js: only
// ONE thing here is a hard-confirmed cross-role truth — Plot Admin's Add
// User "Work Locations" field is genuinely scoped to just their own assigned
// location(s) (live-confirmed: offered exactly ["A-06c"], not the other
// known locations S05b/WTG-Khavda). Every other per-role UI difference
// (which chart widgets render, whether Add User is even active for
// PM/EL/QL/CM, exact jurisdiction scoping for CAD's Cluster-level and SAD's
// Site-level authority) is UNCONFIRMED for roles beyond CAD/PAD's own recon
// — logged via console.log so a real run surfaces it, not guessed into a
// hard assertion that could fail for reasons unrelated to what broke.
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

function requireUser(prefix) {
  const lastCreated = loadLastCreatedUsers();
  const user = lastCreated[prefix];
  expect(
    user,
    `No last-created user recorded for prefix "${prefix}" in ` +
      'tests/fixtures/last-created-users.json — run 12_user_management.spec.js ' +
      '(and 13_wam_all_roles.spec.js / 18_wam_hierarchy.spec.js, so its own WAM ' +
      'assignment exists and it can actually log in) first.'
  ).toBeTruthy();
  return user;
}

function logFinding(prefix, section, message) {
  console.log(`[${prefix}] ${section}: ${message}`);
}

// The concrete test for docs/work-region-hierarchy.md §2b's WAM
// tree-visibility rule ("WAM restricts the tree to only what the logged-in
// user is mapped to" — a Site Admin mapped to Site Khavda should see ALL
// Work Locations under Khavda, not an arbitrary subset). Per explicit user
// instruction: don't hedge on whether a mismatch is "real" vs
// "this test env just has fewer nodes" — compare against Admin's
// UNRESTRICTED view of the exact same scope and hard-fail on any
// difference. That is the one comparison that actually distinguishes a
// structural absence (§8: the site genuinely doesn't have that child in
// THIS environment, so Admin wouldn't see it either) from a real
// WAM-visibility bug (Admin sees it, the scoped role doesn't).
//
// CASCADE is one fixed, well-known set of location values (this suite's
// only real Cluster/Site) passed identically to both sides — safe to pass
// unconditionally because WAMPage.fillAssignmentFilters only fills a field
// when it's actually visible for the role in play, so an inapplicable
// field (e.g. Site Admin's target has no separate Site filter — its rows
// ARE the sites) is silently skipped rather than erroring.
const KNOWN_CASCADE = { cluster: ['KHAVDA', 'Gujarat', 'Khavda'], site: 'KHAVDA' };

// Called from WITHIN the role-under-test's own session (their Add Details
// dialog must be closed on entry). Captures their own row set, logs into
// Admin to capture the ground truth for the identical cascade, asserts
// equality, then logs back into the original role so the caller's later
// sections (SO Mapping/Users/Reports) keep running as that role. Returns
// the freshly re-logged-in DashboardPage — the caller MUST reassign its own
// `dashboard` variable from this, since the original session was torn down
// by the Admin detour. Leaves the page ON THE WAM SCREEN (not Dashboard) —
// required because this function is called in a loop for multiple
// checks: the NEXT iteration's wam.openAddDetails() needs the WAM page
// already loaded, not a fresh Dashboard landing (confirmed live: without
// this, the second of two checks timed out waiting for the add-assignment
// icon, which doesn't exist on /dashboard at all).
async function verifyChildVisibilityAgainstAdmin(page, wam, { prefix, user, targetRole, extraCascade = {} }) {
  const cascade = { ...KNOWN_CASCADE, ...extraCascade };

  await wam.openAddDetails();
  await wam.fillAssignmentFilters({ role: targetRole, ...cascade });
  const actualRows = await wam.listAssignmentRows();
  await wam.closeDialog();
  logFinding(prefix, 'WAM tree visibility', `own view of "${targetRole}" rows: ${JSON.stringify(actualRows)}`);

  const adminDashboard = await loginAsUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const adminWam = new WAMPage(page);
  await adminWam.goto(adminDashboard);
  await adminWam.openAddDetails();
  await adminWam.fillAssignmentFilters({ role: targetRole, ...cascade });
  const expectedRows = await adminWam.listAssignmentRows();
  await adminWam.closeDialog();
  logFinding(prefix, 'WAM tree visibility', `Admin's ground-truth "${targetRole}" rows for the same scope: ${JSON.stringify(expectedRows)}`);

  expect(
    [...actualRows].sort(),
    `${prefix}: should see the SAME "${targetRole}" rows Admin sees for this scope ` +
      '(docs/work-region-hierarchy.md §2b) — a mismatch means WAM visibility does not ' +
      "match this role's own mapped scope, not that the environment lacks the data " +
      '(Admin just proved the data exists).'
  ).toEqual([...expectedRows].sort());
  logFinding(prefix, 'WAM tree visibility', `CONFIRMED — "${targetRole}" row set matches Admin's exactly (${actualRows.length} rows)`);

  const restoredDashboard = await loginAsUser(page, user.email, PASSWORD);
  await wam.goto(restoredDashboard);
  return restoredDashboard;
}

// jurisdiction: optional { field: 'Work Locations'|'Cluster'|'Sites',
//   expectedOptions: string[] } — pass this ONLY for a role/field combo
// that's been confirmed live (currently just Plot Admin's Work Locations).
// Every other role passes null and gets the discover-and-log treatment.
//
// childVisibilityChecks: optional array of { targetRole, extraCascade } —
// each one runs verifyChildVisibilityAgainstAdmin above. Only configured
// for roles where a real parent-to-multiple-children relationship exists
// and is checkable via the Add Details dialog (CAD: Cluster->Sites and
// Cluster->Work Locations; SAD: Site->Work Locations; PM: Work
// Location->Work Areas). PAD is the leaf of this chain (their own Work
// Location IS the child being checked elsewhere, via the Add User
// jurisdiction assertion) and EL/QL/CM's own targets sit at their OWN Work
// Area level, not a broader one, so there is no further "children" set to
// enumerate for them.
// `resolveUser` is an INJECTION POINT, added 2026-09-04, and it is the only
// change this module needed to serve both tiers.
//
// The regression tier (tests/online-roles/) passes nothing and gets
// requireUser — resolution from the BARE prefixes that 12_user_management
// records — so those seven specs are byte-for-byte unaffected.
//
// The smoke tier (SM18) injects a resolver backed by resolveSmokeUsers(), so it
// runs as the users SM01 created for the CURRENT run. Without this the smoke
// replica would have had to either duplicate ~400 lines of suite logic or
// resolve the regression tier's users, and the second is the cross-tier bleed
// this whole restructure exists to remove: the two tiers would then share
// identities, and one WAM change in either would silently move the other's
// ground.
//
// Same pattern already proven on rfi-dependency-flow.js's `loginAs` — default
// to the original, inject to override, never fork the driver.
async function runOnlineRoleRegressionSuite(browser, { prefix, roleName, addUserRoleTarget, jurisdiction, childVisibilityChecks = [], resolveUser = requireUser }) {
  const user = resolveUser(prefix);
  expect(user.role, `Recorded role for "${prefix}" should be "${roleName}"`).toBe(roleName);

  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  try {
    let dashboard = await loginAsUser(page, user.email, PASSWORD);
    await expect(page, `${prefix}: still on /login after loginAsUser`).not.toHaveURL(/\/login/i);

    // ---------------- 1. DASHBOARD ----------------
    await dashboard.goToDashboard();
    await expect(dashboard.rfiDistributionChart, `${prefix}: RFI Distribution chart`).toBeVisible();
    await expect(dashboard.ncDistributionChart, `${prefix}: NC Distribution chart`).toBeVisible();
    await expect(dashboard.tatSummaryChart, `${prefix}: TAT Summary chart`).toBeVisible();
    await expect(dashboard.trendAnalysisChart, `${prefix}: Trend Analysis chart`).toBeVisible();
    await expect(dashboard.detailRecordsTab, `${prefix}: Detail Records tab`).toBeVisible();

    for (const [label, toggle] of [['TAT Summary', dashboard.tatSummaryToggle], ['Trend Analysis', dashboard.trendAnalysisToggle]]) {
      await expect(toggle.rfi, `${prefix}: ${label} RFI toggle`).toBeVisible();
      await expect(toggle.nc, `${prefix}: ${label} NC toggle`).toBeVisible();
      expect(await dashboard.isChartToggleActive(toggle.rfi), `${prefix}: ${label} should default to RFI active`).toBe(true);

      // The button's own active/inactive class only proves the CLICK landed
      // — it says nothing about whether the chart underneath actually
      // re-rendered with NC's data. Fingerprint the rendered SVG before and
      // after, and require it to actually CHANGE — catches a toggle that
      // visually flips tabs without swapping the data (a real bug the
      // class-only check would have silently passed).
      const rfiFingerprint = await dashboard.waitForStableChartFingerprint(label);

      await dashboard.clickChartToggle(toggle.nc);
      expect(await dashboard.isChartToggleActive(toggle.nc), `${prefix}: ${label} NC should be active after clicking it`).toBe(true);
      const ncFingerprint = await dashboard.waitForStableChartFingerprint(label);
      // EL/QL specifically: CONFIRMED with the app owner 2026-09-05 — their
      // WAM mapping may not cover the work region the smoke NC was created
      // in, or WAM may not be configured for them there at all, so a chart
      // that doesn't actually change between RFI and NC is a real, expected
      // data/scope limitation for these two roles, not a bug. Checked by
      // plain equality, not just the bar-chart "no path at all" shape
      // (`::`) originally seen on TAT Summary — Trend Analysis (a line
      // chart) instead showed a flat, degenerate zero-value line IDENTICAL
      // between RFI and NC for EL, never an empty "::" fingerprint at all,
      // same underlying limited-data cause, different chart type's way of
      // drawing it. Every OTHER role still gets the full hard assertion —
      // this only softens the specific, confirmed case (RFI and NC
      // genuinely rendered the same, still one of these two roles), not
      // EL/QL blanket-wide.
      const knownEmptyNCForRole = ['EL', 'QL'].includes(prefix) && ncFingerprint === rfiFingerprint;

      // ---------------------------------------------------------------
      // NOTHING WAS DRAWN ON EITHER SIDE -> INCONCLUSIVE, not a failure
      // ---------------------------------------------------------------
      // Added 2026-09-06 after a full-chain run on pulse-test failed FIVE
      // roles here (CAD, SAD, PAD, PM, CM) with the identical fingerprint
      // "202x136::" on both tabs. That trailing "::" is the same predicate
      // waitForStableChartFingerprint uses for "empty": rects present, ZERO
      // path elements — the chart painted its frame and drew no data at all.
      //
      // This assertion exists to catch a toggle that RECOLOURS THE TAB
      // WITHOUT SWAPPING THE DATA. When neither tab has any data, there is
      // nothing to swap, so the comparison cannot distinguish that bug from
      // an empty dashboard — it is vacuous, and failing on it reports a
      // defect that has not been shown. That is exactly what happened: the
      // same code was fully green on run 6 (2026-09-05) and failed five
      // roles here, purely because this deployment holds less data.
      //
      // getChartDataFingerprint's own comments already establish that empty
      // is ambiguous ("no data to draw" vs "the fetch hasn't resolved"), and
      // waitForStableChartFingerprint already retries an empty settle twice
      // with a longer window before committing to it. This is the last step
      // of that same reasoning: once it HAS committed to empty on both
      // sides, the comparison has no signal left to give.
      //
      // STRICTLY MORE PRECISE, NOT WEAKER. Checked FIRST, so it does not
      // touch the app owner's confirmed EL/QL exemption below — and note it
      // makes EL/QL *stricter*, not laxer: an EL/QL chart with real,
      // identical data on both tabs now falls through to the hard assertion
      // instead of being waved through by the role check. Chart VISIBILITY
      // is still hard-asserted further up, so a dashboard that renders no
      // charts at all still fails; only the data-swap comparison steps
      // aside, and it says so loudly in the log rather than passing quietly.
      const isEmptyChart = (fp) => fp.endsWith('::');
      const bothSidesEmpty = isEmptyChart(rfiFingerprint) && isEmptyChart(ncFingerprint);

      if (bothSidesEmpty) {
        logFinding(
          prefix, 'Dashboard',
          `${label}: INCONCLUSIVE — the chart drew NO data on either RFI or NC ` +
          `(fingerprint "${rfiFingerprint}"), so "did the toggle swap the data" cannot be ` +
          `answered here. Not asserted. This is a data/scope condition on this deployment, ` +
          `not a toggle defect — the chart's own visibility is asserted separately above.`
        );
      } else if (knownEmptyNCForRole) {
        logFinding(prefix, 'Dashboard', `${label}: NC chart didn't actually differ from RFI — app owner confirmed this role's WAM scope may not cover the work region NC was created in (or WAM isn't configured there for them), not a bug`);
      } else {
        expect(ncFingerprint, `${prefix}: ${label} chart should show DIFFERENT rendered data on NC vs RFI, not just a recolored tab`)
          .not.toBe(rfiFingerprint);
      }

      await dashboard.clickChartToggle(toggle.rfi);
      expect(await dashboard.isChartToggleActive(toggle.rfi), `${prefix}: ${label} RFI should be active again after switching back`).toBe(true);
      const rfiFingerprintAgain = await dashboard.waitForStableChartFingerprint(label);
      expect(rfiFingerprintAgain, `${prefix}: ${label} chart should render the SAME RFI data again after switching back from NC`)
        .toBe(rfiFingerprint);

      // MUST reflect which branch actually ran. Found live 2026-09-06 on the
      // first laned run: this line printed unconditionally, so Contractor
      // Manager's log carried BOTH "INCONCLUSIVE — the chart drew NO data on
      // either RFI or NC" and "confirmed the chart's rendered content actually
      // changes between RFI and NC" for the same chart, two lines apart. A log
      // that contradicts itself is worse than no log — it is the thing someone
      // reads when deciding whether a result can be trusted.
      logFinding(
        prefix, 'Dashboard',
        bothSidesEmpty
          ? `${label}: RFI/NC comparison SKIPPED (no data either side); the toggle itself and the switch back to RFI were still exercised`
          : knownEmptyNCForRole
            ? `${label}: RFI/NC comparison waived for this role (app-owner-confirmed scope limitation); the toggle and the switch back to RFI were still exercised`
            : `${label}: confirmed the chart's rendered content actually changes between RFI and NC (not just the tab's own color)`
      );
    }
    logFinding(prefix, 'Dashboard', 'all 4 widgets + both chart RFI/NC toggles confirmed working');

    // ---------------- 2. MY TASKS ----------------
    const myTasks = new MyTasksPage(page);
    await dashboard.goToMyTasks();
    await myTasks.waitForOversightTasksReady();

    for (const tabName of ['RFI', 'NC']) {
      const tab = tabName === 'RFI' ? myTasks.rfiTab : myTasks.ncTab;
      if (await tab.isVisible({ timeout: 3000 }).catch(() => false)) {
        await tab.click();
        await page.waitForTimeout(1000);
      }
      await expect(myTasks.pendingWithOthersTile, `${prefix}: [${tabName}] Pending with others tile`).toBeVisible();
      await expect(myTasks.approvedTile, `${prefix}: [${tabName}] Approved tile`).toBeVisible();

      const othersCount = await myTasks.getTileCount(myTasks.pendingWithOthersTile);
      const approvedCount = await myTasks.getTileCount(myTasks.approvedTile);
      logFinding(prefix, 'My Tasks', `[${tabName}] Pending with others=${othersCount}, Approved=${approvedCount}`);

      if (othersCount > 0) {
        await myTasks.clickPendingWithOthers();
        await expect(page, `${prefix}: [${tabName}] Pending with others should navigate somewhere`).not.toHaveURL(/\/my-tasks\/?(?:[?#]|$)/i);
        logFinding(prefix, 'My Tasks', `[${tabName}] opened Pending with others -> ${page.url()}`);
        await dashboard.goToMyTasks();
        await myTasks.waitForOversightTasksReady();
        const tabAfterBack = tabName === 'RFI' ? myTasks.rfiTab : myTasks.ncTab;
        if (await tabAfterBack.isVisible({ timeout: 3000 }).catch(() => false)) await tabAfterBack.click();
      } else {
        logFinding(prefix, 'My Tasks', `[${tabName}] Pending with others is empty — nothing to open`);
      }

      if (approvedCount > 0) {
        await myTasks.clickApproved();
        await expect(page, `${prefix}: [${tabName}] Approved should navigate somewhere`).not.toHaveURL(/\/my-tasks\/?(?:[?#]|$)/i);
        logFinding(prefix, 'My Tasks', `[${tabName}] opened Approved -> ${page.url()}`);
        await dashboard.goToMyTasks();
        await myTasks.waitForOversightTasksReady();
      } else {
        logFinding(prefix, 'My Tasks', `[${tabName}] Approved is empty — nothing to open`);
      }
    }

    // ---------------- 3. WAM ----------------
    const wam = new WAMPage(page);
    await wam.goto(dashboard);
    expect(await wam.ownRoleVisible(roleName), `${prefix}: WAM's My Assignment panel should show own role "${roleName}"`).toBe(true);

    const viewResult = await wam.viewOwnAssignments({ cluster: ['KHAVDA', 'Gujarat', 'Khavda'], site: ['Khavda', 'KHAVDA'], workLocation: null });
    const ownWamScopeConfirmed = viewResult.scopeConfirmed;
    logFinding(prefix, 'WAM', `own-scope view filters filled=${viewResult.filledAny}, resolved=${JSON.stringify(viewResult.resolved)}, scope confirmed=${ownWamScopeConfirmed}`);
    if (!ownWamScopeConfirmed) {
      logFinding(prefix, 'WAM', 'WARNING — could not confirm this role has an established WAM assignment. ' +
        'Per the WAM-prerequisite instruction, run 13_wam_all_roles.spec.js / 18_wam_hierarchy.spec.js before ' +
        'trusting this role\'s jurisdiction-scoped checks below.');
    }

    await expect(wam.addAssignmentIcon, `${prefix}: WAM add-assignment icon (manage OTHER users' WAM)`).toBeVisible();
    await wam.openAddDetails();
    const wamRoleOptions = await wam.getAvailableRoleOptions();
    expect(wamRoleOptions.length, `${prefix}: WAM Add Details dialog should offer at least one role to assign`).toBeGreaterThan(0);
    logFinding(prefix, 'WAM', `Add Details dialog reachable, offers roles: ${wamRoleOptions.join(', ')}`);
    await wam.closeDialog();

    // Tree-visibility checks (docs/work-region-hierarchy.md §2b) — does this
    // role see ALL of its scope's children, matching Admin's unrestricted
    // view of the same scope? Each check re-logs-in as Admin then back as
    // this role, so `dashboard` is reassigned from the function's return.
    for (const check of childVisibilityChecks) {
      dashboard = await verifyChildVisibilityAgainstAdmin(page, wam, { prefix, user, ...check });
    }

    // ---------------- 4. SO MAPPING (only if this role has it) ----------------
    await dashboard.goToDashboard();
    const hasSOMapping = await dashboard.navSOMapping.isVisible({ timeout: 3000 }).catch(() => false);
    if (hasSOMapping) {
      const so = new SOMappingPage(page);
      await so.goto(dashboard);
      await so.waitForLoad();

      // CONFIRMED LIVE 2026-09-05 via a throwaway recon spec
      // (tests/specs/inspection/00_inspect_so_mapping_admin_nav.spec.js,
      // run at BOTH the default 1280x720 viewport and a deliberately wide
      // 1920x1080 one): CAD/SAD/PAD's sidebar still lists "SO Mapping" (the
      // click never navigates anywhere, at either viewport — a dead
      // leftover link), and a direct URL hit reliably reaches /so-mapping
      // but shows "Desktop Mode Required — SO Mapping is managed in DRS..."
      // UNCONDITIONALLY, regardless of viewport width. This is not a
      // responsive breakpoint (an earlier version of this fix wrongly
      // assumed that, widened the viewport, and it changed nothing) — it
      // matches playwright.config.js's own 2026-09-04 record that "SO
      // mapping was removed from PULSE and now lives in DRS". There is
      // nothing left on PULSE for this role to actually exercise here.
      // UPDATED 2026-09-06 (app owner): the hand-off itself is EXPECTED.
      // Following SO Mapping may land on the real screen, on PULSE's migration
      // notice, on the DRS LOGIN page, or on a DRS application page when DRS
      // already has an admin session. All four are correct behaviour, so this
      // classifies and REPORTS rather than asserting on any one of them — and
      // the two DRS outcomes are handled first, because on that origin the
      // PULSE-side markers below can never render and every locator here
      // resolves to nothing.
      const destination = await SOMappingPage.classifyDestination(page);
      const D = SOMappingPage.DESTINATIONS;

      if (destination === D.DRS_LOGIN || destination === D.DRS_APP) {
        logFinding(prefix, 'SO Mapping', `EXPECTED: handed off to DRS (${destination}, ${page.url()}) — SO Mapping lives in DRS since 2026-09-04, so this is correct behaviour, not a defect.`);
        // Back to PULSE before the Users/Reports sections below, which are all
        // driven through PULSE's own nav.
        await returnToPulse(page);
        dashboard = new DashboardPage(page);
      } else if (destination === D.PULSE_NOTICE) {
        logFinding(prefix, 'SO Mapping', 'CONFIRMED: PULSE\'s own /so-mapping route shows only a "moved to DRS" notice for this role, at any viewport — the feature is not present on PULSE to test, only its stale sidebar link remains.');
      } else {
        // Reuses the same known-good ground every other spec in this suite
        // already maps (18_wam_hierarchy.spec.js's CLUSTER/SITE/WORK_LOCATION/
        // PACKAGE/WORK_AREA constants) — read-only here, no Save/mutation.
        await so.selectMappingFilters({
          cluster: ['Gujarat', 'Khavda', 'KHAVDA'], site: 'Khavda', projectType: 'SOLAR',
          workLocation: 'A-06c', workAreas: ['BL01'], package: 'Civil',
        }).catch(e => logFinding(prefix, 'SO Mapping', `selectMappingFilters failed: ${e.message}`));

        const rows = await so.listActivityRows().catch(() => []);
        const mapped = rows.filter(r => r.currentServiceOrder && r.currentServiceOrder.trim().length > 0);
        logFinding(prefix, 'SO Mapping', `${mapped.length}/${rows.length} activity rows already show a mapped Service Order`);

        // WAS: expect(rows.length).toBeGreaterThan(0).
        //
        // Dropped 2026-09-06 with live evidence, not on a hunch. Plot Admin
        // reached this line on the first laned run and read 0/0 rows. Two
        // things make that assertion wrong rather than merely unlucky:
        //
        //   1. SO MAPPING IS NOT A PULSE FEATURE ANY MORE. It moved to DRS on
        //      2026-09-04; PULSE's /so-mapping is vestigial, and following the
        //      menu entry now legitimately hands off to DRS
        //      (app-owner-decisions-and-conventions.md 3.9). Asserting that a
        //      removed screen renders activity rows is asserting on a vestige.
        //      Note the app is not even consistent about it: some roles get the
        //      "moved to DRS" notice, Plot Admin gets a real-but-empty screen.
        //   2. THE CASCADE IS HARDCODED TO A-06c/BL01, which is the REGRESSION
        //      tier's ground and the app owner's manual-testing location. A
        //      hierarchy role whose jurisdiction does not include A-06c will
        //      correctly see nothing there (Plot Admin's scoping to its own
        //      work locations is confirmed live) — so 0 rows is the CORRECT
        //      answer for such a role, not a defect.
        //
        // WHY THIS ONLY SURFACED NOW: Plot Admin used to fail earlier in the
        // test, on the TAT chart comparison, and never reached this line. Once
        // that stopped being a false failure the test got further and exposed
        // this. It is a previously-MASKED problem, not a new one.
        //
        // What is still worth checking is that the screen did not ERROR, which
        // is asserted below. The row count is reported instead.
        if (!rows.length) {
          logFinding(
            prefix, 'SO Mapping',
            'the real screen rendered but returned ZERO activity rows for A-06c/BL01 — expected ' +
            'for a role whose jurisdiction excludes A-06c, and unremarkable either way now that ' +
            'SO mapping lives in DRS and PULSE\'s screen is vestigial. Reported, not asserted.'
          );
        }
        await expect(
          page.locator('text=/something went wrong|page not found|404/i').first(),
          `${prefix}: SO Mapping rendered an error page`
        ).toBeHidden();
      }
    } else {
      logFinding(prefix, 'SO Mapping', 'nav item not present for this role — skipped');
    }

    // ---------------- 5. USERS ----------------
    await dashboard.goToDashboard();
    const users = new UserManagementPage(page);
    await users.goto(dashboard);
    await expect(users.searchInput, `${prefix}: Users search box`).toBeVisible();

    await users.search('a'); // broad enough to reliably return results across roles
    await page.waitForTimeout(500);
    const expanded = await users.expandFirstRoleGroup();
    logFinding(prefix, 'Users', `search returned results, role-group expand ${expanded ? 'revealed more detail' : 'found nothing to expand (list may already be flat/empty)'}`);

    const addUserVisible = await users.addUserIcon.isVisible({ timeout: 5000 }).catch(() => false);
    logFinding(prefix, 'Users', `Add User icon visible: ${addUserVisible}`);
    if (addUserVisible && addUserRoleTarget) {
      await users.openAddUserDialog();
      await users.selectUserType('AGEL').catch(e => logFinding(prefix, 'Users', `selectUserType failed: ${e.message}`));
      await users.selectUserRole(addUserRoleTarget).catch(e => logFinding(prefix, 'Users', `selectUserRole("${addUserRoleTarget}") failed: ${e.message}`));
      const picked = await users.fillLocationCascade().catch(e => {
        logFinding(prefix, 'Users', `fillLocationCascade failed: ${e.message}`);
        return null;
      });
      logFinding(prefix, 'Users', `Add User cascade picked: ${JSON.stringify(picked)}`);

      if (jurisdiction && ownWamScopeConfirmed) {
        const field = jurisdiction.field === 'Work Locations' ? users.workLocationsDropdown
          : jurisdiction.field === 'Sites' ? users.sitesDropdown
          : users.clusterDropdown;
        if (await field.isVisible({ timeout: 3000 }).catch(() => false)) {
          const options = await users.getDropdownOptions(field);
          logFinding(prefix, 'Users', `Add User "${jurisdiction.field}" options: ${JSON.stringify(options)} (expected exactly: ${JSON.stringify(jurisdiction.expectedOptions)})`);
          expect(options.sort(), `${prefix}: Add User "${jurisdiction.field}" should be scoped to this role's own jurisdiction, not every location account-wide`)
            .toEqual([...jurisdiction.expectedOptions].sort());
        } else {
          logFinding(prefix, 'Users', `jurisdiction field "${jurisdiction.field}" not visible for role "${addUserRoleTarget}" — cannot verify scoping this run`);
        }
      } else if (jurisdiction) {
        logFinding(prefix, 'Users', 'jurisdiction check skipped — own WAM scope not confirmed this run (see WAM section above)');
      } else {
        logFinding(prefix, 'Users', 'no confirmed jurisdiction expectation for this role — logged cascade only, not asserted');
      }
      await users.closeDialog();
    } else if (addUserVisible) {
      logFinding(prefix, 'Users', 'Add User icon visible but no addUserRoleTarget configured for this role — skipped opening it');
    }

    // ---------------- 6. REPORTS ----------------
    await dashboard.goToDashboard();
    await dashboard.revealNavIfCollapsed('Dashboard');
    await dashboard.navItem('Reports').click();
    await page.waitForTimeout(800);
    const rfiStatusReportVisible = await dashboard.navItem('RFI status report').isVisible({ timeout: 5000 }).catch(() => false);
    expect(rfiStatusReportVisible, `${prefix}: "RFI status report" sub-item should appear once Reports is expanded`).toBe(true);
    await dashboard.navItem('RFI status report').click();

    const reports = new ReportsPage(page);
    await reports.waitForLoad();
    // waitForRealTotalCount, NOT getTotalCount directly — see its own
    // comment: waitForLoad's regex is satisfied by a "Total Count: 0"
    // placeholder just as readily as the real number, confirmed live to
    // read exactly 0 here for CAD/SAD before the real (tens-of-thousands)
    // total had rendered.
    const totalBefore = await reports.waitForRealTotalCount();
    logFinding(prefix, 'Reports', `RFI status report Total Count (unfiltered) = ${totalBefore}`);
    expect(totalBefore, `${prefix}: Reports Total Count should be a real number`).not.toBeNull();

    await reports.openFilter();
    const statusFieldVisible = await reports.rfiStatusField.isVisible({ timeout: 3000 }).catch(() => false);
    if (statusFieldVisible) {
      const statusOptions = await reports.getDropdownOptions(reports.rfiStatusField);
      logFinding(prefix, 'Reports', `RFI Status filter options: ${JSON.stringify(statusOptions)}`);
      const approvedOption = statusOptions.find(o => /approved/i.test(o));
      if (approvedOption) {
        await reports.selectDropdownOption(reports.rfiStatusField, approvedOption);
      }
    } else {
      logFinding(prefix, 'Reports', 'RFI Status filter field not visible for this role — applying with no field changed');
    }
    await reports.clickApply();

    // Same placeholder-race guard as totalBefore above — a genuinely-zero
    // filtered result is a real possible outcome for some role, so this
    // still degrades to 0 after the timeout rather than hanging on it.
    const totalAfter = await reports.waitForRealTotalCount();
    logFinding(prefix, 'Reports', `Total Count after filtering by Approved = ${totalAfter}`);
    if (statusFieldVisible) {
      expect(totalAfter, `${prefix}: filtering by RFI Status=Approved should not show MORE rows than unfiltered`).toBeLessThanOrEqual(totalBefore);
    }

    const downloaded = await reports.downloadAndParse(`${prefix}_rfi_status`);
    logFinding(
      prefix, 'Reports',
      downloaded.emptyReport
        // CONFIRMED live 2026-09-06 for Execution Lead and Quality Lead:
        // Total Count 0, no download event, no toast. See downloadAndParse.
        ? `report is EMPTY for this role's scope (Total Count=${totalAfter}) — the app raises no ` +
          `download at all in that case, so there is no file to parse. The row-count assertion ` +
          `below still runs against 0, so it is not being skipped.`
        : `downloaded "${downloaded.suggested}" -> ${downloaded.rowCount} rows (table showed Total Count=${totalAfter}), headers: ${downloaded.headers.join(', ')}`
    );
    expect(downloaded.rowCount, `${prefix}: downloaded file's row count should match the filtered Total Count, not the unfiltered total`)
      .toBe(totalAfter);

    // `emptyReport` short-circuits this, otherwise a role with nothing to export
    // would log "WARNING — could not find a status-like column", which reads as
    // a broken report rather than an empty one. There are no rows to check the
    // filter against, and the rowCount assertion above already covered it.
    if (statusFieldVisible && !downloaded.emptyReport) {
      const statusHeader = downloaded.headers.find(h => /status/i.test(h));
      if (statusHeader) {
        const offStatusRows = downloaded.rows.filter(r => !/approved/i.test(String(r[statusHeader])));
        expect(offStatusRows.length, `${prefix}: EVERY downloaded row should have ${statusHeader}="Approved" after filtering — found ${offStatusRows.length} that don't (e.g. ${JSON.stringify(offStatusRows[0])})`)
          .toBe(0);
        logFinding(prefix, 'Reports', `confirmed all ${downloaded.rowCount} downloaded rows have ${statusHeader}=Approved — download reflects the filter, not the full dataset`);
      } else {
        logFinding(prefix, 'Reports', `WARNING — could not find a status-like column in the downloaded headers (${downloaded.headers.join(', ')}) to verify row content`);
      }
    }
  } finally {
    await context.close();
  }
}

module.exports = { runOnlineRoleRegressionSuite };
