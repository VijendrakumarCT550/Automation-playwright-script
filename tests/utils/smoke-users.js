const { loadLastCreatedUsers, nextBatchNumber } = require('./user-counter-utils');
const { environmentKey } = require('../config/environments');

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

// RESOLVING THE SMOKE CHAIN'S OWN USERS — and creating them when they are not
// there.
//
// ---------------------------------------------------------------------------
// WHAT CHANGED ON 2026-09-09, AND WHY
// ---------------------------------------------------------------------------
// This module used to do two checks against a FLAT record file: the entry's
// `profileKey` had to match, and its `baseUrl` had to equal the current
// BASE_URL. The second check existed for a real bug (users recorded on one
// deployment being trusted on another, see user-counter-utils.js) but it made
// the record hostile to switching environments: one prefix held one entry, so
// creating users on qa overwrote the pulse-test ones, and pointing back at
// pulse-test then REJECTED them wholesale. The app owner hit exactly that:
//
//     Cannot resolve the smoke users for profile "solar-e2e" on
//     https://pulse-test...: - EE (prefix "EESL"): no user recorded at all
//
// The record is now PARTITIONED BY DEPLOYMENT (user-counter-utils.js), so
// loadLastCreatedUsers() only ever returns users that exist on the host this
// run targets. That makes the baseUrl comparison unnecessary — being in the
// bucket IS the check — and switching URLs no longer invalidates anything.
//
// The second half of the fix is that a genuinely missing user is no longer a
// dead end. `ensureSmokeUsers` creates it (and, for the work-area-scoped flow
// roles, WAMs it onto the chain's work areas so it is immediately usable),
// which is what the stages call. `resolveSmokeUsers` stays as the pure,
// synchronous read for callers with no browser to hand.
//
// (The old `usersMatchEnvironment(entry, baseUrl)` helper is gone with the
// check it implemented. Nothing else in the repo used it.)

// The flow roles are the ones scoped to a WORK AREA, which is the granularity
// SM03 assigns at. They are the only roles the self-heal below maps, and that
// boundary is deliberate — see ensureSmokeUsers.
const FLOW_ROLES = ['CI', 'CM', 'EE', 'QI'];

// Which of `roleKeys` this deployment has, which it lacks, and which are a
// configuration error rather than a missing user.
//
//   users    role key -> recorded entry, for everything resolvable
//   missing  role keys with no usable record — CREATABLE
//   broken   problems no amount of creating fixes (the profile declares no
//            prefix for a role this caller asked for)
function inspectSmokeUsers(profile, roleKeys, { env = environmentKey() } = {}) {
  const recorded = loadLastCreatedUsers({ env });
  const users = {};
  const missing = [];
  const broken = [];

  for (const roleKey of roleKeys) {
    const prefix = profile.users && profile.users.prefixes && profile.users.prefixes[roleKey];
    if (!prefix) {
      broken.push(`${roleKey}: profile "${profile.key}" defines no prefix for this role`);
      continue;
    }
    const entry = recorded[prefix];
    if (!entry) {
      missing.push(roleKey);
      continue;
    }
    // NO baseUrl MEANS NO DEPLOYMENT, and that is not usable here even though
    // it came back from the lookup. loadLastCreatedUsers() merges the `shared`
    // bucket — entries recorded before deployments were tracked — into every
    // environment's view, which is right for 12_user_management's bare
    // regression keys but wrong for a smoke user: trusting one on every
    // deployment is exactly the phantom-user bug. Treated as missing, which is
    // the safe direction (re-creating costs minutes; a phantom fails much later
    // at a dropdown search with nothing readable to explain why).
    if (!entry.baseUrl) {
      missing.push(roleKey);
      continue;
    }
    // A prefix could in principle be reused by another profile later, and
    // silently inheriting its user would scope the whole chain to the wrong
    // project type. FATAL rather than "create a replacement": creating one
    // would overwrite the record and, for a flow role, re-point every mapped
    // work-area row to the new user — a lot of destruction in response to what
    // is really a configuration mistake. Someone should look at it.
    if (entry.profileKey !== profile.key) {
      broken.push(
        `${roleKey} (prefix "${prefix}"): recorded for profile "${entry.profileKey}", ` +
        `not "${profile.key}" — two profiles are sharing a prefix, which is a config bug`
      );
      continue;
    }
    users[roleKey] = entry;
  }

  return { users, missing, broken, env };
}

// Returns { CI: entry, EE: entry, ... } or throws naming exactly which role is
// missing and how to get it. Synchronous, so it cannot create anything — the
// stages call ensureSmokeUsers() instead; this remains for callers outside the
// smoke chain (33_negative_authorisation.spec.js, the inspection specs) and as
// the final read after a create.
function resolveSmokeUsers(profile, roleKeys, { env = environmentKey() } = {}) {
  const { users, missing, broken } = inspectSmokeUsers(profile, roleKeys, { env });

  if (missing.length || broken.length) {
    const problems = [
      ...broken,
      ...missing.map((roleKey) => {
        const prefix = profile.users.prefixes[roleKey];
        return `${roleKey} (prefix "${prefix}"): no user recorded for this deployment`;
      }),
    ];
    throw new Error(
      `Cannot resolve the smoke users for profile "${profile.key}" on ` +
      `${process.env.BASE_URL} (environment "${env}"):\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      `\n\nThe record is partitioned per deployment, so users created against a ` +
      `different host are neither used nor destroyed — these simply have not been ` +
      `created HERE yet. Create them:\n` +
      `  npx playwright test --project=smoke-${profile.key.replace('-e2e', '')}-users --workers=1\n` +
      `(the smoke stages create missing users automatically; set ` +
      `SMOKE_AUTOCREATE_USERS=0 to turn that off, which is how you get this message.)`
    );
  }

  return users;
}

// RESOLVE, AND CREATE WHATEVER IS NOT THERE.
//
// This is what every smoke stage calls. It exists because of how the chain is
// actually run: the app owner validates one stage at a time with `--no-deps`
// (see the granular-pass convention), which skips SM01 entirely — so a stage
// asking for a role no one has created on the current deployment used to abort
// the run with instructions to go run another project first. Switching
// deployments made that the normal case rather than the rare one.
//
// WHAT IT CREATES, AND WHAT IT DELIBERATELY DOES NOT MAP
// -----------------------------------------------------
// Creating a PULSE user is not enough to make it usable: a user has no access
// to anything until it is WAM'd. So for the four work-area-scoped FLOW roles
// this also performs SM03's assignment — the same filters, the same
// single-select work-area rows, the same close-reopen-verify — onto
// smokeMappedWorkAreas(profile). A self-healed CI that cannot see a work area
// would just fail one screen later with a much worse message.
//
// It does NOT map the hierarchy tiers (EL/QL/PM/PAD/SAD/CAD). That is SM04's
// cascade, and it is not a matter of convenience: the row GRANULARITY changes
// per role (clusters for Cluster Admin, sites for Site Admin, work locations
// for Plot Admin and PM, work areas below that), several of those rows are
// genuinely multi-assignee where clicking an already-selected option toggles it
// OFF, and the Project Manager work-location row is single-select so an assign
// EVICTS the incumbent. Replicating that here to save a step is how shared WAM
// data gets quietly destroyed. Such a user is created and reported with a clear
// note that SM04 must run.
//
// TWO THINGS IT REFUSES TO DO, both learned from this suite's own history:
//
//   INSIDE A LANE. tests/config/lanes.js keeps every user-creating stage in one
//   place (USER_CREATING_STAGES) and its validator FAILS a layout that spreads
//   them across concurrent lanes, because the counter and the record are
//   read-modify-write and the WAM ground is shared. Self-healing from an
//   arbitrary stage would quietly break that invariant from outside the
//   validator's view — five lanes could each create a user and re-point the
//   same work-area rows. run-smoke-lanes.js sets SMOKE_LANE on every child, so
//   a laned run fails with the resolve message instead, naming the stage to run.
//
//   A WHOLE DEPLOYMENT. Topping up one or two users is what this is for.
//   Bootstrapping ten inside one beforeAll would run past the 10-minute hook
//   budget (playwright.config.js), and SM01 already does that job properly —
//   one test per role, so one failure does not lose the other nine.
//
// SMOKE_AUTOCREATE_USERS=0 turns the creation off entirely and restores the old
// fail-with-instructions behaviour, for a run that must not mutate anything.
const MAX_SELF_HEAL = 4;

async function ensureSmokeUsers(browser, profile, roleKeys, { env = environmentKey() } = {}) {
  const { users, missing, broken } = inspectSmokeUsers(profile, roleKeys, { env });

  // A profile that declares no prefix for a requested role, or a prefix owned by
  // another profile, is a config bug that no amount of creating fixes.
  if (broken.length) return resolveSmokeUsers(profile, roleKeys, { env });
  if (!missing.length) return users;

  if (process.env.SMOKE_AUTOCREATE_USERS === '0') {
    console.log(
      `    (${missing.length} user(s) missing on "${env}" and SMOKE_AUTOCREATE_USERS=0 — not creating)`
    );
    return resolveSmokeUsers(profile, roleKeys, { env });
  }

  if (process.env.SMOKE_LANE) {
    console.log(
      `    (${missing.length} user(s) missing on "${env}", but this is lane ` +
      `"${process.env.SMOKE_LANE}" — creating users from inside a lane would race the ` +
      `other lanes for the record file and the work-area rows, so it is refused here)`
    );
    return resolveSmokeUsers(profile, roleKeys, { env });
  }

  if (missing.length > MAX_SELF_HEAL) {
    console.log(
      `    (${missing.length} of this profile's users are missing on "${env}" — that is a ` +
      `whole deployment to bootstrap, not a top-up, so it belongs to the user stage)`
    );
    return resolveSmokeUsers(profile, roleKeys, { env });
  }

  if (!(profile.users && profile.users.source === 'created')) {
    throw new Error(
      `Profile "${profile.key}" uses ${profile.users && profile.users.source} credentials, ` +
      `so ${missing.join(', ')} cannot be created for it.`
    );
  }
  if (!browser) {
    throw new Error(
      `${missing.join(', ')} are not recorded on "${env}" and no browser was passed to ` +
      `ensureSmokeUsers, so they cannot be created. Pass the test's \`browser\` fixture, ` +
      `or create them with --project=smoke-${profile.key.replace('-e2e', '')}-users.`
    );
  }

  // Required lazily. This module is imported by specs at COLLECTION time, and
  // pulling in the page objects / WAM driver (and through them @playwright/test's
  // expect) at that point is needless weight for the common case where nothing
  // has to be created.
  const { adminFreshLogin } = require('./helpers');
  const { createSmokeUser } = require('./smoke-user-factory');
  const { smokeMappedWorkAreas } = require('../config/projects');
  const { openAssignmentDialog, assignAndProve } = require('./smoke-wam');

  console.log(
    `\n=== Missing smoke users on "${env}" (${process.env.BASE_URL}) ===\n` +
    `    profile "${profile.key}" — creating: ${missing.join(', ')}\n` +
    `    (SMOKE_AUTOCREATE_USERS=0 to disable this and fail instead)`
  );

  const { context, page, dashboard } = await adminFreshLogin(browser, ADMIN_DESKTOP_CONTEXT);
  try {
    // ONE batch number for everything created in THIS call, which is the
    // established meaning of the number: users created together share it (see
    // nextBatchNumber). Note that the per-test callers (SM17, SM18) resolve one
    // role each, so a run that heals several of those spends one number per
    // role rather than one for the group — harmless, and the numbers still say
    // truthfully what was created in one go.
    const batchNumber = nextBatchNumber();
    console.log(`    batch ${batchNumber}`);

    const created = [];
    for (const roleKey of missing) {
      const { identity, role, userType } = await createSmokeUser(
        page, dashboard, profile, roleKey, batchNumber
      );
      created.push({ roleKey, name: identity.name, role, userType });
      console.log(`    created ${roleKey} (${role}, ${userType}) "${identity.name}"`);
    }

    // WAM the flow roles onto the chain's work areas — SM03's operation, on the
    // subset that was just created.
    //
    // THIS DOES EVICT THE INCUMBENT on every mapped row: work-area rows for
    // these roles are single-assignee, so assigning replaces whoever held them.
    // That is intended and is precisely what SM03 does — the role had NO user
    // on this deployment, so whatever is sitting on those rows is not this
    // chain's, and the chain cannot run until its own user holds them. It is
    // also why this only ever runs for a role with no record at all (a
    // profile-mismatched record is fatal instead, see inspectSmokeUsers) and
    // never from inside a lane, where another lane could be mid-flow on the
    // same rows.
    const flowCreated = created.filter((c) => FLOW_ROLES.includes(c.roleKey));
    const areas = smokeMappedWorkAreas(profile);
    for (const { roleKey, name, role, userType } of flowCreated) {
      if (!areas.length) {
        console.log(`    ${roleKey}: profile declares no work areas — nothing to WAM`);
        continue;
      }
      const filters = {
        role,
        cluster: profile.cluster,
        site: profile.site,
        workLocation: profile.workLocations[0],
        package: profile.packages[0],
        // Precise SO string first, vendor name as fallback — a vendor can hold
        // several SOs, exactly as SM03 does it.
        serviceOrder: userType === 'VENDOR'
          ? [profile.vendor.serviceOrder, profile.vendor.name]
          : null,
      };
      const wam = await openAssignmentDialog(page, dashboard, filters);
      // Single-select, matching SM03: work-area rows for these roles hold one
      // assignee, so a pick replaces the incumbent rather than adding to it.
      await assignAndProve(wam, {
        filters,
        entries: areas.map((row) => ({ row, userName: name })),
        multi: false,
        label: `${roleKey} self-heal`,
      });
      console.log(`    WAM'd ${roleKey} "${name}" onto ${areas.length} area(s): ${areas.join(', ')}`);
    }

    const unmapped = created.filter((c) => !FLOW_ROLES.includes(c.roleKey));
    if (unmapped.length) {
      console.log(
        `    NOTE: ${unmapped.map((c) => c.roleKey).join(', ')} were created but NOT WAM'd — ` +
        `the hierarchy tiers are mapped by SM04's cascade, whose row granularity and ` +
        `single/multi-select rules cannot be safely replicated here. Run ` +
        `--project=smoke-${profile.key.replace('-e2e', '')}-wam-hierarchy if this stage ` +
        `needs them to have access.`
      );
    }
    console.log('');
  } finally {
    await context.close();
  }

  // Read the record back rather than trusting what was just built in memory —
  // if a create silently failed to record, this is where it surfaces.
  return resolveSmokeUsers(profile, roleKeys, { env });
}

module.exports = {
  resolveSmokeUsers, ensureSmokeUsers, inspectSmokeUsers, FLOW_ROLES,
};
