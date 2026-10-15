const { test } = require('@playwright/test');

// RUN AN EXISTING tests/specs/ FEATURE SPEC ON THE DRS PROJECT, unchanged.
// App owner, 2026-09-26: "add all" — every feature spec that was never promoted
// to smoke. Each IN07+ wrapper calls this and then `require`s the original spec,
// so its tests register in the INTEGRATION project with no copied logic.
//
// What it points at the DRS project, for the one spec being loaded:
//   * RECON_PROFILE   → the DRS smoke profile key (specs 33/34/35 read it)
//   * CI_/EE_/QI_EMAIL + _PASSWORD → the DRS users (loginAsRole reads these at
//                       login time — see ROLE_CREDENTIALS in utils/helpers.js)
//   * SPEC_WORK_LOCATION / SPEC_WORK_AREA / SPEC_NC_VENDOR → the ground
//                       (read by specs 32/39 and utils/linked-nc-flow.js)
//
// Applied only (a) around the body's own require in runSpecBody, because those
// specs read some of it into module constants, and (b) between this file's
// beforeAll and afterAll, for the reads made while its tests run. Restored
// after each, so nothing leaks into any other file — in the same worker, or in
// the runner, which loads every project's files together. `wam` provisions the
// users' WAM rows on the ground first (each stage owns its prerequisites).
//
// The scope of the specOnDrs call awaiting its runSpecBody (one per wrapper).
let current = null;

function specOnDrs({ roles = [], ground = {}, wam = null } = {}) {
  const { buildDrsSmokeProfile } = require('./drs-smoke-profile');
  let profile = null;
  let unavailable = null;
  try { profile = buildDrsSmokeProfile(); } catch (err) { unavailable = err.message; }

  const saved = {};
  const set = (k, v) => {
    if (!(k in saved)) saved[k] = process.env[k];
    if (v == null) delete process.env[k]; else process.env[k] = String(v);
  };

  let users = {};
  const apply = () => {
    if (!profile) return;
    set('RECON_PROFILE', profile.key);
    if (roles.length) {
      const { resolveSmokeUsers } = require('../utils/smoke-users');
      users = resolveSmokeUsers(profile, roles);
      for (const r of roles) {
        set(`${r}_EMAIL`, users[r].email);
        set(`${r}_PASSWORD`, process.env.BULK_USER_DEFAULT_PASSWORD);
      }
    }
    const wl = profile.workLocations[0];
    if (ground.workArea) set('SPEC_WORK_AREA', ground.workArea(profile));
    if (ground.workArea || ground.workLocation) set('SPEC_WORK_LOCATION', wl);
    if (ground.ncVendor) set('SPEC_NC_VENDOR', profile.nc.vendorName);
  };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  };

  // NOT applied here. Setting process.env when this file loads would leak into
  // every file loaded after it in the same process — in a bare `playwright
  // test`, the runner loads ALL projects' files together, so a chromium spec
  // could pick up the DRS users. runSpecBody applies it only around the
  // body's own require, and beforeAll/afterAll only around its own tests.
  current = {
    apply: () => { try { apply(); } catch (err) { unavailable = unavailable || err.message; } },
    restore,
  };

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(20 * 60 * 1000);
    if (unavailable) throw new Error(`DRS ground unavailable: ${unavailable}`);
    apply();
    if (wam && roles.length) {
      const { ensureWorkAreaMapping } = require('../utils/smoke-prereqs');
      await ensureWorkAreaMapping(browser, profile, users, {
        roles: wam.roles || roles, areas: [ground.workArea(profile)], label: wam.label,
      });
    }
  });
  test.afterAll(() => restore());

  return { profile, unavailable };
}

// The n-th BL Work Area of the DRS project, as a `ground.workArea` resolver.
const blArea = (n) => (profile) =>
  profile.drs.project.workAreas.filter((wa) => /^BL\d+$/i.test(wa))[n - 1];

// Load a tests/specs/*.body.js so its tests register in THIS file. Evicted from
// require's cache first: when every project loads in one process (a bare
// `playwright test --list`), the chromium stub has already required it, and a
// cached module would register nothing here.
//
// The DRS environment is applied ONLY for the duration of that require — the
// body reads some of it into module constants at load (specs 32/39's NC_DATA,
// 33-35's RECON_PROFILE) — and restored straight after, so nothing leaks to
// the files loaded next. Runtime reads are covered by beforeAll/afterAll.
const runSpecBody = (absPath) => {
  if (!current) throw new Error('runSpecBody: call specOnDrs(...) first in the same wrapper');
  const scope = current;
  current = null;
  delete require.cache[absPath];
  scope.apply();
  try {
    require(absPath);
  } finally {
    scope.restore();
  }
};

module.exports = { specOnDrs, blArea, runSpecBody };
