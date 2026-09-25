const { test, expect } = require('@playwright/test');
const { loginAsFlowUser, clearBrowserSession } = require('../utils/helpers');
const { getProfile } = require('../config/projects');
const { environmentKey } = require('../config/environments');
const {
  groupFor, fleetFor, recordMember, mintIdentity, DEFERRED, serviceOrderFor,
} = require('../utils/reassign-fleet');
const LoginPage = require('../pages/LoginPage');
const UserManagementPage = require('../pages/UserManagementPage');
const WAMPage = require('../pages/WAMPage');
const { assignAndProve } = require('../utils/smoke-wam');

// ===========================================================================
// SETUP — builds the reassignment fleet (docs/reassignment-scenarios.md §2)
// ===========================================================================
// NOT a behaviour test. It creates real users and real WAM mappings, and its
// assertions are only about whether the SETUP succeeded — never about how
// reassignment behaves.
//
// IDEMPOTENT BY DESIGN. Every member already recorded in
// fixtures/reassign-fleet.json for this deployment is skipped, so re-running
// costs nothing and does not litter the environment. Delete a member's entry to
// have it rebuilt.
//
// WHY EACH MEMBER IS BUILT TO SPEC RATHER THAN REUSED. The feature's hardest
// scenarios turn on provisioning (Add User) and WAM DISAGREEING — eligible in
// the record's work location, but mapped somewhere else entirely. A fleet of
// "roughly the right users" cannot express that, so each member is created with
// an exact work-location set and an exact mapping (or deliberately none).
//
// VERIFIES THE LOGIN, because a fleet member that cannot sign in is useless and
// the failure would otherwise surface much later, inside a behaviour spec, as
// something that looks like a reassignment bug. Confirmed live 2026-09-16 that
// a freshly created user CAN log in with BULK_USER_DEFAULT_PASSWORD.
//
// Usage:
//   $env:PULSE_ENV="qa"
//   $env:REASSIGN_FLEET_GROUP="reassigners"   # or "candidates" / "all"
//   npx playwright test tests/specs/40_reassign_fleet_setup.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const GROUP = process.env.REASSIGN_FLEET_GROUP || 'reassigners';
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Keys whose WAM should be (re)applied even though the account already exists —
// e.g. a mapping that landed on the wrong row. Comma-separated.
const REMAP = (process.env.REASSIGN_FLEET_REMAP || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

let context, page, profile;
// Set once the first account created in this run has been shown to sign in —
// see verifyLogin's comment for why one check covers the whole run.
let loginProvenThisRun = false;
const built = [];
const skipped = [];
const failed = [];

function note(msg) {
  console.log(`  ${msg}`);
}

function firstLine(err) {
  return String((err && err.message) || err || '').split(/\r?\n/)[0];
}

// Creates one user through Add User and returns its identity, or throws with
// the app's own toast text.
async function createUser(member) {
  const identity = mintIdentity(member.key);
  const users = new UserManagementPage(page);

  const dashboard = await loginAsFlowUser(
    page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, { navigateToMyTasks: false }
  );
  await users.goto(dashboard);
  await users.openAddUserDialog();

  await users.selectUserType(member.userType);
  if (member.userType === 'VENDOR') {
    // `member.vendor` overrides the profile's vendor — that is the whole point
    // of the CI_G arm, which must belong to a DIFFERENT vendor so it can be
    // shown NOT to appear in a CHOUHAN record's "Assign to" list.
    await users.selectVendorCategory(profile.vendor.category);
    await users.selectVendor(member.vendor || profile.vendor.name);
  }
  await users.selectUserRole(member.role);

  const picked = await users.fillLocationCascade({
    cluster: profile.cluster,
    site: [profile.site],
    projectTypes: member.projectTypes || [profile.projectType],
    projectTypeCount: (member.projectTypes || [profile.projectType]).length,
    workLocations: member.workLocations,
    workLocationCount: member.workLocations.length,
  });

  // PROJECT TYPE MUST ACTUALLY BE SET, and it is not safe to assume it was.
  //
  // fillLocationCascade fills only the fields a role renders, deciding with
  // `isVisible({ timeout: 1000 })` per field. That 1s check RACES the cascade:
  // Project type only renders after Cluster/Site resolve, so a slow render makes
  // the field look absent and it is skipped in silence.
  //
  // Measured 2026-09-16: creating a Contractor Manager returned
  // `{cluster, sites, workLocations}` with NO projectType — while a direct look
  // at the dialog (00_inspect_add_user_fields.spec.js) showed the field IS
  // rendered for both VENDOR and AGEL roles, offering SOLAR/WIND/PSS/INFRA/
  // BESS/TRANSMISSION_LINE. So the field was there and simply missed.
  //
  // This matters far beyond tidiness: ELIGIBILITY for reassignment is driven by
  // the candidate's work location AND PROJECT TYPE (docs §1.2). A fleet member
  // created with no project type is in an unknown state, and every Family E
  // result measured against it would be meaningless. Repair it here, or fail.
  if (!picked.projectType || !picked.projectType.length) {
    const visible = await users.projectTypeDropdown.isVisible({ timeout: 5000 }).catch(() => false);

    if (!visible) {
      // LEGITIMATELY ABSENT — SOME ROLES HAVE NO PROJECT TYPE FIELD.
      //
      // Confirmed by the app owner's own screenshot (2026-09-16): the Add User
      // form for **Contractor Manager** runs User Type -> Vendor Category ->
      // Vendor -> UserRole -> Cluster -> Sites -> Work Locations, with no
      // Project type at all, and its Work Locations list offers everything
      // (S05b, A-06c and the WIND location WTG-Khavda together) rather than
      // being scoped by project type. Their instruction: *"dont worry about
      // project type filtering in CM role, just create users based on required
      // work location."*
      //
      // An earlier version THREW here, on the assumption that a missing value
      // always meant the 1s visibility check had raced the cascade. That was
      // over-generalised from a probe of only two roles (Contractor Incharge and
      // Execution Engineer, both of which DO render the field) — and it failed
      // the CM outright on pulse-dev. Absent and skipped-by-a-race are different
      // things and only the second is a problem.
      note('  no Project type field for this role — recorded as null (not scoped by project type)');
      picked.projectType = null;
    } else {
      // PRESENT BUT UNSET — this is the race, and it does matter: eligibility
      // is driven by work location AND project type, so a member left blank
      // here would be in an unknown state and every Family E result measured
      // against it would be meaningless.
      note('  Project type was skipped by the cascade race — selecting it explicitly');
      picked.projectType = await users.selectMultiAware(users.projectTypeDropdown, {
        preferred: member.projectTypes || [profile.projectType],
        count: (member.projectTypes || [profile.projectType]).length,
      });
      // Work Locations hang off Project type, so re-pick them after changing it.
      picked.workLocations = await users.selectMultiAware(users.workLocationsDropdown, {
        preferred: member.workLocations,
        count: member.workLocations.length,
      });

      expect(
        (picked.projectType || []).join(','),
        `${member.key}: the Project type field IS rendered but nothing could be selected — ` +
        `this member's provisioning would be unknown`
      ).toBeTruthy();
    }
  }

  await users.fillIdentity(identity);
  const toast = await users.submit();
  if (!toast || /error|fail/i.test(String(toast))) {
    throw new Error(`Add User did not report success for ${member.key}: ${JSON.stringify(toast)}`);
  }

  return { ...identity, picked, toast: String(toast).replace(/\s+/g, ' ').trim() };
}

// Confirms a new account can actually sign in. A member that cannot is worse
// than a missing one: it looks present in the store and fails much later.
//
// CALLED ONCE PER RUN, NOT ONCE PER MEMBER (app owner, 2026-09-20: *"only check
// for first user; if that is added in usersauth so all will be"*). Provisioning
// into the deployment's user auth is a property of the DEPLOYMENT, not of the
// individual account — a login that works for the first user created in a run
// works for the rest, and each check costs a full session clear plus a login
// round trip. Verifying all 18 spent roughly a third of the build for one bit of
// information.
//
// The first member of a run is still checked, because that bit is worth having:
// it is what told us on 2026-09-16 that generated users CAN log in here while
// the older …User151 accounts get 401, and a fleet of accounts that cannot sign
// in would otherwise surface much later inside a behaviour spec looking like a
// reassignment bug.
async function verifyLogin(email) {
  let authStatus = null;
  const onResponse = (res) => {
    if (/\/api\/v1\/auth\/login/i.test(res.url())) authStatus = res.status();
  };
  page.on('response', onResponse);
  try {
    await clearBrowserSession(page.context(), page);
    const login = new LoginPage(page);
    await page.goto(process.env.BASE_URL);
    await page.waitForLoadState('networkidle').catch(() => {});
    await login.revealLoginFormIfLandingPage();
    await login.typeInField(login.emailInput, email);
    await page.keyboard.press('Tab');
    await login.typeInField(login.passwordInput, PASSWORD);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    await login.loginButton.click({ force: true });
    const ok = await page.waitForURL((u) => !u.href.includes('/login'), { timeout: 45000 })
      .then(() => true).catch(() => false);
    return { ok, authStatus };
  } finally {
    page.off('response', onResponse);
  }
}

// Applies one WAM mapping, through the smoke chain's proven assign-and-prove
// wrapper rather than a bare WAMPage call — that helper is what knows how to
// tell "the dialog accepted it" from "the server stored it".
async function applyWam(member, userName) {
  const dashboard = await loginAsFlowUser(
    page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, { navigateToMyTasks: false }
  );
  const wam = new WAMPage(page);
  await wam.goto(dashboard);
  await wam.waitForLoad();

  // THE VENDOR-SIDE ROLES NEED A SERVICE ORDER, or WAM offers no rows at all.
  // Contractor Incharge and Contractor Manager are gated behind it — see
  // reassign-fleet.js's serviceOrderFor, and 18_wam_hierarchy.spec.js's per-role
  // filter table, which is the authority. Omitting it is exactly why the CM
  // returned zero rows on 2026-09-16 while EL/QL returned BL01..BL08 for
  // otherwise identical filters.
  const serviceOrder = serviceOrderFor(member.role);
  const filters = {
    role: member.role,
    cluster: profile.cluster,
    site: profile.site,
    workLocation: member.wam.workLocation,
    package: member.wam.package,
    ...(serviceOrder ? { serviceOrder } : {}),
  };
  if (serviceOrder) note(`  ${member.role} is vendor-side — filtering by Service Order "${serviceOrder}"`);

  // RESOLVE THE ROW AT RUN TIME rather than hardcoding a work area.
  //
  // WAM's row granularity is ROLE-DEPENDENT — the "one level down" rule
  // (docs/wam-hierarchy-business-logic.md): CI/EE/QI are assigned per WORK
  // AREA, while the lead/manager tier is assigned a level up. So "BL01" is the
  // right row for a Contractor Incharge and simply does not exist for a Project
  // Manager. Asking the dialog what rows it actually has is the only thing that
  // works across both, and it also means a deployment with different area
  // labels needs no change here.
  //
  // A member may pin `wam.workArea` when the exact row matters (the candidate
  // fleet's "right package, wrong area" arm will); otherwise the first row is
  // taken, which is all the reassigners need — they simply have to be mapped
  // SOMEWHERE in the work location to see its records.
  // SOME ROLES OFFER NO ROWS FOR A PACKAGE-SCOPED FILTER. Confirmed live
  // 2026-09-16: Contractor Manager returned zero rows at A-06c / Civil while
  // Execution Lead and Quality Lead returned BL01..BL08 for the identical
  // filters. Rather than fail on the first shape, try the package-scoped filter
  // and then the same filter WITHOUT a package — which of the two works is
  // itself a finding worth reporting.
  const attempts = [
    { label: `${member.wam.workLocation}/${member.wam.package}`, filters },
    { label: `${member.wam.workLocation} (no package filter)`, filters: { ...filters, package: undefined } },
  ];

  let rows = [];
  let used = null;
  for (const attempt of attempts) {
    await wam.openAddDetails();
    await wam.fillAssignmentFilters(attempt.filters);
    await wam.waitForRowsLoaded().catch(() => {});
    rows = await wam.listAssignmentRows();
    note(`  WAM rows for ${member.role} @ ${attempt.label}: ${rows.length}` +
      `${rows.length ? ` ${JSON.stringify(rows.slice(0, 8))}` : ''}`);
    if (rows.length) { used = attempt; break; }
  }

  if (!used) {
    throw new Error(
      `WAM offered no rows for ${member.role} at ${member.wam.workLocation} with or ` +
      `without a package filter — nothing to map this user onto`
    );
  }

  // PICK THE ROW THAT MATCHES THE TARGET, NOT rows[0].
  //
  // Row granularity is ROLE-DEPENDENT (the "one level down" rule): CI/EE/QI and
  // the EL/QL tier list WORK AREAS, while Project Manager lists WORK LOCATIONS.
  // Taking the first row blindly mapped a PM to "A-01" instead of "A-06c" on
  // 2026-09-16 — a silently wrong mapping that the store then recorded as
  // correct, which is worse than a failure. Prefer, in order: a pinned work
  // area, the target work location itself, then the first row.
  const preferred = [member.wam.workArea, member.wam.workLocation].filter(Boolean);
  const row = preferred.find((p) => rows.some((r) => r.toLowerCase() === String(p).toLowerCase()))
    || (member.wam.workArea ? null : rows[0]);

  if (!row) {
    throw new Error(
      `WAM row "${member.wam.workArea}" is not offered for ${member.role} at ` +
      `${member.wam.workLocation}. Rows: ${JSON.stringify(rows.slice(0, 12))}`
    );
  }
  note(`  using row "${row}" (${used.label})`);

  await assignAndProve(wam, {
    filters: used.filters,
    entries: [{ row, userName }],
    label: `${member.key} `,
  });

  return { row, filters: used.label };
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  expect(process.env.ADMIN_EMAIL, 'ADMIN_EMAIL must be set in .env').toBeTruthy();

  profile = getProfile('solar-e2e');
  context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();

  console.log(
    `\n=== Reassignment fleet setup — group "${GROUP}" on ${process.env.BASE_URL} ===\n` +
    `    store: tests/fixtures/reassign-fleet.json (environment "${environmentKey()}")\n` +
    `    deferred (need a fact we do not have yet): ${DEFERRED.join(', ')}\n`
  );
});

test.afterAll(async () => {
  console.log('');
  console.log('=== Fleet setup summary ===');
  for (const m of built) console.log(`  BUILT   ${m.key.padEnd(7)} ${m.role.padEnd(20)} ${m.email}`);
  for (const k of skipped) console.log(`  SKIP    ${k} (already in the store)`);
  for (const f of failed) console.log(`  FAILED  ${f.key.padEnd(7)} ${f.error}`);
  console.log(`\n  built ${built.length}, skipped ${skipped.length}, failed ${failed.length}`);
  if (context) await context.close();
});

test(`build the "${GROUP}" group of the reassignment fleet`, async () => {
  test.setTimeout(60 * 60 * 1000);

  const existing = fleetFor();
  const members = groupFor(GROUP);
  expect(members.length, `No fleet members defined for group "${GROUP}"`).toBeGreaterThan(0);

  for (const member of members) {
    if (existing[member.key]) {
      const record = existing[member.key];

      // REMAP RATHER THAN RECREATE. A member whose account exists but whose WAM
      // never landed (or landed on the wrong row) must be FIXED, not duplicated
      // — creating a second account for the same slot wastes an account and
      // leaves the first one lying around looking legitimate.
      const needsRemap = REMAP.includes(member.key)
        || (member.wam && record.wamApplied === false);

      if (!needsRemap) {
        skipped.push(member.key);
        note(`${member.key}: already recorded (${record.email}) — skipping`);
        continue;
      }

      note(`${member.key}: account exists (${record.email}) — (re)applying WAM only`);
      try {
        const applied = await applyWam(member, record.name);
        const updated = recordMember({
          ...record, wam: member.wam, wamApplied: true, wamDetail: applied,
        });
        note(`  WAM applied: row "${applied.row}" via ${applied.filters}`);
        built.push(updated);
      } catch (err) {
        failed.push({ key: member.key, error: firstLine(err) });
        note(`  REMAP FAILED — ${firstLine(err)}`);
      }
      continue;
    }

    note(`${member.key}: creating ${member.role} in [${member.workLocations.join(', ')}]` +
      `${member.wam ? ` + WAM ${member.wam.workLocation}/${member.wam.package}` : ' (NO WAM — init only)'}`);

    try {
      const identity = await createUser(member);
      note(`  created ${identity.email} — ${identity.toast}`);

      if (!loginProvenThisRun) {
        const login = await verifyLogin(identity.email);
        note(`  login: ${login.ok ? 'OK' : 'REFUSED'} (auth ${login.authStatus ?? 'n/a'})` +
          ` — checked once for this run; the rest are taken on trust`);
        if (!login.ok) {
          throw new Error(`created but cannot log in (auth ${login.authStatus})`);
        }
        loginProvenThisRun = true;
      } else {
        note('  login: not re-checked (proven once this run)');
      }

      // RECORD BEFORE MAPPING. A WAM failure used to leave the created account
      // ORPHANED — it existed in the app but not in the store, so the next run
      // created a second one (this happened to RA_CM on 2026-09-16). Recording
      // first means a mapping failure leaves a usable, honestly-labelled member
      // that a later remap pass can finish, instead of wasted accounts.
      let record = recordMember({
        key: member.key,
        role: member.role,
        userType: member.userType,
        email: identity.email,
        name: identity.name,
        phone: identity.phone,
        workLocations: member.workLocations,
        // What the dialog ACTUALLY recorded, not what was asked for — the two
        // can differ (see the Project type race in createUser).
        provisioned: identity.picked || null,
        wam: member.wam || null,
        wamApplied: !member.wam,
        wamDetail: null,
        probes: member.probes || null,
        createdAt: new Date().toISOString(),
      });

      if (member.wam) {
        const applied = await applyWam(member, identity.name);
        record = recordMember({ ...record, wamApplied: true, wamDetail: applied });
        note(`  WAM applied: row "${applied.row}" via ${applied.filters}`);
      }

      built.push(record);
    } catch (err) {
      failed.push({ key: member.key, error: firstLine(err) });
      note(`  FAILED — ${firstLine(err)}`);
      // Keep going: one bad member must not cost the whole fleet, and the
      // summary reports exactly which ones need another pass.
    }
  }

  expect(
    built.length + skipped.length,
    `No fleet member was built or already present. Failures: ` +
    failed.map((f) => `${f.key}: ${f.error}`).join(' | ')
  ).toBeGreaterThan(0);
});
