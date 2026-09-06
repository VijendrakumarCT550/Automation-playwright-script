const { test, expect } = require('../config/test-base');
const { loginAsUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { openDialogWithInteractiveRow } = require('../utils/smoke-wam');
const DashboardPage = require('../pages/DashboardPage');
const WAMPage = require('../pages/WAMPage');

// Stage 6 of the E2E smoke chain: the WAM HIERARCHY CASCADE, driven by the ten
// users SM01 created.
//
// Mapping starts at the true top and walks DOWN one tier at a time, each step
// logged in as the user the PREVIOUS step just assigned:
//
//   Admin -> Cluster Admin -> Site Admin -> Plot Admin -> Project Manager
//         -> (Execution Lead + Quality Lead) -> (Execution Engineer,
//            Contractor Manager, Quality Inspector) -> Contractor Incharge
//
// That is the sequence the app owner described, and it is the whole point of the
// stage: it proves a NON-ADMIN login can perform the identical WAM assignment,
// restricted to its own subordinate roles and its own location scope. Anyone can
// prove Admin can assign things; SM03 already does.
//
// ---------------------------------------------------------------------------
// WHY THIS IS A SEPARATE STAGE FROM SM03
// ---------------------------------------------------------------------------
// SM03 is Admin assigning the four work-area-scoped FLOW roles onto the flow
// areas — the minimum needed for SM05/SM06 to run. This stage is a different
// question (can each tier assign the tier below?) with a different shape: the
// row granularity CHANGES per role being assigned, so it cannot share SM03's
// one-dialog-many-work-area-rows model.
//
//   Cluster Admin   no location filters at all; rows are CLUSTERS
//   Site Admin      filter by cluster;           rows are SITES
//   Plot Admin, PM  filter by cluster+site;      rows are WORK LOCATIONS
//   EE/QI/EL/QL/CM/CI  + work location, package, and a Service Order for the
//                      VENDOR roles;             rows are WORK AREAS
//
// Groupings and exclusions mirror 18_wam_hierarchy.spec.js, which established
// them live. A tier can assign every role BELOW it but never its own role nor
// anything above it.
//
// ---------------------------------------------------------------------------
// THE WORK AREA THIS STAGE USES, AND WHY IT MATTERS
// ---------------------------------------------------------------------------
// Work-area-level assignments go onto profile.demapWorkArea (BL06 for solar) —
// deliberately NOT the flow areas.
//
// WAM's Contractor Incharge and Quality Inspector rows are SINGLE-ASSIGNEE: one
// pick REPLACES whoever held the row (WAMPage.js). SM05 and SM06 depend on the
// flow users holding BL03/BL04/BL05, so assigning anyone to those rows here
// would evict them and break both flow stages — silently, since the eviction
// only shows up later as "work area not visible" during RFI creation.
//
// BL06 was already provisioned as spare ground and no flow stage touches it, so
// this stage can assign freely there. (It was originally the SO-demapping
// sacrificial area; SO mapping has since moved to DRS, freeing it up.)
//
// STRICTLY SERIAL AND IN ORDER. Unlike SM05/SM06's round-robin, each step here
// genuinely depends on the previous one having just happened: a tier cannot log
// in and assign until the tier above has assigned IT. One shared page, sequential
// role hops.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Row LABELS can differ in casing from the FILTER values — the same
// deployment/DB-state variance that made CLUSTER_CANDIDATES a list rather than a
// string. Only the Cluster and Site rows have shown it; Work Location rows have
// not. resolveRowLabel picks whichever is actually rendered.
const CLUSTER_ROW_CANDIDATES = ['Gujarat', 'KHAVDA', 'Khavda'];
const SITE_ROW_CANDIDATES = ['Khavda', 'KHAVDA'];

// Which rows are SINGLE-select, i.e. a pick REPLACES the incumbent rather than
// adding alongside. Everything else is genuinely multi-select, where clicking an
// already-selected option TOGGLES IT OFF instead of being a no-op — which is why
// the two cases need different WAMPage calls, not one.
//
// Confirmed live and documented in WAMPage.js: Contractor Incharge and Quality
// Inspector at work-area level, and Project Manager at work-location level.
const SINGLE_SELECT_ROLES = new Set(['Contractor Incharge', 'Quality Inspector', 'Project Manager']);

// STRIP ARK UI'S CHECKMARK before comparing a role label.
//
// Once an option is CHECKED, Ark UI reveals a checkmark indicator that is hidden
// while unchecked — so the same option's innerText changes from "Quality
// Inspector" to "Quality Inspector\n✓". WAMPage.js documents this and carries its
// own normalizer for exactly this reason.
//
// It bit here on the first run: Quality Lead has only ONE assignable role, it was
// already selected, and the tier-capability assertion below compared raw labels
// and failed with Expected "quality inspector" / Received
// ["quality inspector\n✓"] — a false failure against a correct app.
const normalizeRoleLabel = (s) =>
  String(s).replace(/\s*✓\s*$/, '').replace(/\s+/g, ' ').trim().toLowerCase();

test.describe('Smoke stage 6 - WAM hierarchy cascade, each tier assigns the tier below', () => {
  let page, dashboard, profile, users;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;

    // All ten roles, checked for profile AND deployment. The hierarchy tiers are
    // AGEL/online accounts, so unlike the flow users they log in in seconds.
    users = resolveSmokeUsers(profile, ['CI', 'CM', 'EE', 'QI', 'EL', 'QL', 'PM', 'PAD', 'SAD', 'CAD']);

    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    expect(
      process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD,
      'ADMIN_EMAIL and ADMIN_PASSWORD must be set in .env — Admin is the root of this cascade'
    ).toBeTruthy();

    const workArea = profile.demapWorkArea || profile.primaryWorkArea;
    expect(
      workArea,
      `Profile "${profile.key}" has no spare work area for hierarchy assignments. Set ` +
      `demapWorkArea to an area NO FLOW STAGE USES — assigning onto a flow area would ` +
      `evict the flow users from its single-assignee CI/QI rows.`
    ).toBeTruthy();
    expect(
      Object.values(profile.flowWorkAreas || {})
        .flatMap((byViewport) => Object.values(byViewport || {}).flat()),
      `The hierarchy work area "${workArea}" must not be one a flow stage uses`
    ).not.toContain(workArea);

    const context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();
    dashboard = new DashboardPage(page);

    console.log(
      `\n=== Smoke WAM hierarchy: "${profile.key}" ===\n` +
      `    cluster ${JSON.stringify(profile.cluster)} / site ${profile.site} / ` +
      `work location ${profile.workLocations[0]}\n` +
      `    work-area assignments go on "${workArea}" (spare; flow areas untouched)\n`
    );
    for (const k of ['CAD', 'SAD', 'PAD', 'PM', 'EL', 'QL', 'EE', 'QI', 'CM', 'CI']) {
      console.log(`    ${k.padEnd(4)} ${users[k].role.padEnd(22)} ${users[k].name}`);
    }
    console.log('');
  });

  test.afterAll(async () => {
    if (page) await page.context().close();
  });

  // One cascade step: log in as `asUser`, assign `targetUser` to `role` on the
  // row this role is scoped to, then verify it persisted after a dialog reopen.
  //
  // Verification is a REOPEN, not a re-read of the still-populated form: Submit
  // resets the dialog's fields but does not close it, so reading the same form
  // back proves only front-end state. Same reasoning as SM03 and 07_wam_ci.
  async function cascadeStep({ asUser, asLabel, role, targetUser, filters, rowLabel, rowCandidates }) {
    let wam = new WAMPage(page);
    await wam.goto(dashboard);
    await wam.openAddDetails();

    // Informational, not asserted: WHICH roles this tier may assign is exactly
    // what varies by tier, and 18_wam_hierarchy.spec.js found the dropdown wider
    // than "just the next tier down" (Cluster Admin offers 9 of 10). Asserting a
    // guess here would fail on a correct app; logging it makes the real shape
    // visible without pretending to know it.
    const available = await wam.getAvailableRoleOptions().catch(() => null);
    if (available) {
      const normalized = available.map(normalizeRoleLabel);
      console.log(`  ${asLabel} can assign (${normalized.length}): ${normalized.join(', ')}`);
      expect(
        normalized,
        `${asLabel} should be able to assign ${role}. The dropdown offered: ` +
        `${JSON.stringify(available)} (raw, before checkmark normalisation)`
      ).toContain(normalizeRoleLabel(role));
    }

    // THE PROBE ABOVE CAN LEAVE THE DIALOG CLOSED — and so can the filling that
    // follows it, which is the part earlier fixes here kept getting wrong.
    //
    // History, all live on 2026-09-04. First the Contractor Manager step failed
    // because the probe closed the dialog and fillAssignmentFilters then timed
    // out on the Role combobox; a guard was added right here that reopened it.
    // Then the Plot Admin -> Project Manager step failed at clickSubmit for the
    // same underlying reason at a later point, and a second guard was added
    // before Submit. Then the Site Admin -> Plot Admin step failed like this:
    //
    //     TimeoutError: locator.waitFor: Timeout 30000ms exceeded
    //     59 × locator resolved to hidden <button role="combobox" ...>
    //
    // The reopen guard HAD fired and logged; the dialog then closed AGAIN during
    // fillAssignmentFilters, so addAssigneeToRow's openDropdown() sat for 30s
    // waiting for a combobox that was present but hidden — Ark UI hides
    // [data-part="content"] and leaves the subtree in the DOM, so a row scoped
    // inside it still resolves. Submit was never reached.
    //
    // The lesson is that a fixed set of checkpoints cannot work: each guard only
    // covered the spot it was written for and the dialog closed somewhere else.
    // So the open-filter-resolve sequence is now retried AS A UNIT, verified by
    // its own postcondition (the target row's combobox is actually visible)
    // rather than by predicting where the next close will be.
    //
    // Cluster and Site rows need their rendered label resolved from what the
    // dialog shows — resolveRow runs inside the retry, so failing to resolve is
    // just another reason to try again. Work Location and Work Area rows are
    // addressed by their known code.
    const resolved = await openDialogWithInteractiveRow(
      page, dashboard, { ...filters, role },
      (w) => (rowCandidates ? w.resolveRowLabel(rowCandidates) : rowLabel)
    );
    wam = resolved.wam;
    const row = resolved.row;

    const multi = !SINGLE_SELECT_ROLES.has(role);
    const changed = multi
      ? await wam.addAssigneeToRow(row, targetUser.name)
      : await wam.assignUserIfNeeded(row, targetUser.name);
    console.log(`  ${asLabel} -> ${role} "${targetUser.name}" on row "${row}" ` +
      `(${multi ? 'multi' : 'single'}-select, changed=${changed})`);

    await expect(
      wam.getWorkAreaRow(row).locator('[role="combobox"]'),
      `${targetUser.name} should be selected on row ${row} before Submit`
    ).toContainText(targetUser.name);

    // Found live 2026-09-04 on the Plot Admin -> Project Manager step: the
    // assertion just above can pass and the dialog can STILL be gone by the
    // time control reaches Submit — clickSubmit()'s 30s wait for the Submit
    // button then times out for a button that will never appear, because there
    // is no dialog left for it to be in. Confirmed via that failure's page
    // snapshot: back on the bare "My Assignment" filter screen with nothing
    // dialog-related in the DOM. Triggered by the row pick itself
    // (assignUserIfNeeded/addAssigneeToRow) rather than by the Escape probe.
    //
    // Routed through the SAME bounded retry as the opening sequence rather than
    // reopening by hand. The hand-rolled version this replaces reopened once
    // and redid the pick — which is fine until the dialog closes during that
    // redo, at which point it is back to the original failure with no attempts
    // left. Every call here is idempotent (assignUserIfNeeded/addAssigneeToRow
    // no-op once the value matches; fillAssignmentFilters re-picks the same
    // options), so retrying costs time and changes nothing else.
    if (!(await wam.dialog.isVisible().catch(() => false))) {
      console.log(`  (dialog closed before Submit for ${asLabel} -> ${role} on row ${row} — reopening and redoing)`);
      const redone = await openDialogWithInteractiveRow(
        page, dashboard, { ...filters, role }, () => row
      );
      wam = redone.wam;
      if (multi) await wam.addAssigneeToRow(row, targetUser.name);
      else await wam.assignUserIfNeeded(row, targetUser.name);
      await expect(
        wam.getWorkAreaRow(row).locator('[role="combobox"]'),
        `${targetUser.name} should be selected on row ${row} before Submit (after reopen)`
      ).toContainText(targetUser.name);
    }

    const toast = await wam.clickSubmit();
    expect(
      toast,
      `Submit should report an assignment or an explicit no-change for ${targetUser.name}`
    ).toMatch(changed ? /Assigned successfully/i : /Assigned successfully|No changes to save/i);

    await wam.closeDialog();
    await wam.openAddDetails();
    await wam.fillAssignmentFilters({ ...filters, role });
    const persisted = await wam.getWorkAreaUserValue(row);
    expect(
      persisted,
      `${role} "${targetUser.name}" should still be on row ${row} after reopening the dialog`
    ).toContain(targetUser.name);
    await wam.closeDialog();
    console.log(`  >> ${asLabel} assigned ${role}, confirmed after reopen\n`);
  }

  // ---- The cascade, top down. Order is load-bearing. ----

  test('Admin assigns Cluster Admin', async () => {
    test.setTimeout(20 * 60 * 1000);
    await loginAsUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    // Cluster Admin has NO location filters at all — rows are the Clusters.
    await cascadeStep({
      asLabel: 'Admin', role: 'Cluster Admin', targetUser: users.CAD,
      filters: {}, rowCandidates: CLUSTER_ROW_CANDIDATES,
    });
  });

  test('Cluster Admin assigns Site Admin', async () => {
    test.setTimeout(20 * 60 * 1000);
    await loginAsUser(page, users.CAD.email, PASSWORD);
    await cascadeStep({
      asLabel: 'Cluster Admin', role: 'Site Admin', targetUser: users.SAD,
      filters: { cluster: profile.cluster }, rowCandidates: SITE_ROW_CANDIDATES,
    });
  });

  test('Site Admin assigns Plot Admin', async () => {
    test.setTimeout(20 * 60 * 1000);
    await loginAsUser(page, users.SAD.email, PASSWORD);
    await cascadeStep({
      asLabel: 'Site Admin', role: 'Plot Admin', targetUser: users.PAD,
      filters: { cluster: profile.cluster, site: profile.site },
      rowLabel: profile.workLocations[0],
    });
  });

  test('Plot Admin assigns Project Manager', async () => {
    test.setTimeout(20 * 60 * 1000);
    await loginAsUser(page, users.PAD.email, PASSWORD);
    // PM's Work Location row is SINGLE-select, unlike Plot Admin's — see
    // SINGLE_SELECT_ROLES.
    await cascadeStep({
      asLabel: 'Plot Admin', role: 'Project Manager', targetUser: users.PM,
      filters: { cluster: profile.cluster, site: profile.site },
      rowLabel: profile.workLocations[0],
    });
  });

  // From here down the rows are WORK AREAS, so every filter gains work location
  // and package, and the VENDOR roles gain a Service Order.
  const workAreaFilters = () => ({
    cluster: profile.cluster,
    site: profile.site,
    workLocation: profile.workLocations[0],
    package: profile.packages[0],
  });
  const vendorFilters = () => ({
    ...workAreaFilters(),
    // Precise SO string first, vendor name as fallback — a vendor can hold
    // several SOs and a name-only match resolves to the wrong one.
    serviceOrder: [profile.vendor.serviceOrder, profile.vendor.name],
  });
  const hierarchyArea = () => profile.demapWorkArea || profile.primaryWorkArea;

  for (const [target, roleName] of [['EL', 'Execution Lead'], ['QL', 'Quality Lead']]) {
    test(`Project Manager assigns ${roleName}`, async () => {
      test.setTimeout(20 * 60 * 1000);
      await loginAsUser(page, users.PM.email, PASSWORD);
      await cascadeStep({
        asLabel: 'Project Manager', role: roleName, targetUser: users[target],
        filters: workAreaFilters(), rowLabel: hierarchyArea(),
      });
    });
  }

  test('Execution Lead assigns Execution Engineer', async () => {
    test.setTimeout(20 * 60 * 1000);
    await loginAsUser(page, users.EL.email, PASSWORD);
    await cascadeStep({
      asLabel: 'Execution Lead', role: 'Execution Engineer', targetUser: users.EE,
      filters: workAreaFilters(), rowLabel: hierarchyArea(),
    });
  });

  test('Execution Lead assigns Contractor Manager', async () => {
    test.setTimeout(20 * 60 * 1000);
    await loginAsUser(page, users.EL.email, PASSWORD);
    await cascadeStep({
      asLabel: 'Execution Lead', role: 'Contractor Manager', targetUser: users.CM,
      filters: vendorFilters(), rowLabel: hierarchyArea(),
    });
  });

  test('Quality Lead assigns Quality Inspector', async () => {
    test.setTimeout(20 * 60 * 1000);
    await loginAsUser(page, users.QL.email, PASSWORD);
    await cascadeStep({
      asLabel: 'Quality Lead', role: 'Quality Inspector', targetUser: users.QI,
      filters: workAreaFilters(), rowLabel: hierarchyArea(),
    });
  });

  test('Contractor Manager assigns Contractor Incharge', async () => {
    // CM and CI are the PWA/offline accounts, so this login pays the 3-6 min
    // first-load the online tiers above skip.
    test.setTimeout(25 * 60 * 1000);
    await loginAsUser(page, users.CM.email, PASSWORD);
    await cascadeStep({
      asLabel: 'Contractor Manager', role: 'Contractor Incharge', targetUser: users.CI,
      filters: vendorFilters(), rowLabel: hierarchyArea(),
    });
  });
});
