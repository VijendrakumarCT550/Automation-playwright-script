// DRS ENVIRONMENTS and the DRS -> Pulse PAIRING (docs/drs-pulse-integration.md §2).
//
// Set DRS_ENV=uat|dev and the DRS URL is resolved from here, the same way
// PULSE_ENV resolves the Pulse one in environments.js.
//
// THE PAIRING IS EXPLICIT, NEVER DERIVED FROM THE NAME (app owner, 2026-09-26):
// drs-uat syncs to pulse-uat, but drs-dev syncs to whichever of pulse-qa /
// pulse-dev / pulse-test is connected at the time. The DRS team recorded the
// failure this prevents: a DRS instance reading a different Pulse than the one
// under test, every call answering 200, and nothing synced. Phase 2 refuses to
// run on a Pulse env that is not listed against the DRS env that wrote its
// state.
//
// USER MANAGEMENT is a SEPARATE APP on its own host with its own login page
// (email + password; the DRS Super Admin credentials work there). Vendor
// Management moved INTO it from DRS "App Settings" (app owner, 2026-10-01), so
// D01's vendor step now logs in there. It opens from the DRS profile menu in a
// new tab. The old DRS routes /appSettings/vendors and /appSettings/createVendor
// no longer show a vendor screen.
//   uat: VERIFIED live 2026-10-01 (inspection/00_drs_explore_round6_*).
//   dev: NOT VERIFIED - assumed to follow the same naming. Open it from the
//        drs-dev profile menu and correct this line if it differs.
//
// THE URLs LIVE IN .env (app owner, 2026-10-01: "keep URLs in .env so I can change
// them manually, without changing the command"). Each environment reads its own
// keys - DRS_UAT_URL, DRS_UAT_USER_MANAGEMENT_URL, DRS_DEV_URL,
// DRS_DEV_USER_MANAGEMENT_URL - and falls back to the address below when a key is
// absent. Per-environment, NOT one global key, so editing the uat address can never
// redirect a DRS_ENV=dev run to uat (the pairing guard keys off DRS_ENV).
function fromEnv(name, fallback) {
  const v = String(process.env[name] || '').trim().replace(/[/]+$/, '');
  return v || fallback;
}

const DRS_ENVIRONMENTS = {
  uat: {
    key: 'uat',
    baseUrl: fromEnv('DRS_UAT_URL', 'https://drs-uat.cfapps.ap11.hana.ondemand.com'),
    userManagementUrl: fromEnv('DRS_UAT_USER_MANAGEMENT_URL', 'https://auth-mgmt-uat.cfapps.ap11.hana.ondemand.com'),
    // Update when the connection changes — this list is the only place it lives.
    pairedPulse: ['uat'],
  },
  dev: {
    key: 'dev',
    baseUrl: fromEnv('DRS_DEV_URL', 'https://drs-dev.cfapps.ap11.hana.ondemand.com'),
    userManagementUrl: fromEnv('DRS_DEV_USER_MANAGEMENT_URL', 'https://auth-mgmt-dev.cfapps.ap11.hana.ondemand.com'),
    pairedPulse: ['qa', 'dev', 'test'],
  },
};

function drsEnv() {
  const key = String(process.env.DRS_ENV || 'uat').trim().toLowerCase();
  const env = DRS_ENVIRONMENTS[key];
  if (!env) {
    throw new Error(
      `Unknown DRS_ENV "${key}". Known: ${Object.keys(DRS_ENVIRONMENTS).join(', ')}.`
    );
  }
  // An explicit DRS_BASE_URL still wins, for a one-off host not listed above.
  const override = String(process.env.DRS_BASE_URL || '').trim().replace(/\/+$/, '');
  const umOverride = String(process.env.DRS_USER_MANAGEMENT_URL || '').trim().replace(/\/+$/, '');
  return {
    ...env,
    ...(override ? { baseUrl: override } : {}),
    ...(umOverride ? { userManagementUrl: umOverride } : {}),
  };
}

function drsSuperAdmin() {
  const email = process.env.DRS_SUPER_ADMIN_EMAIL;
  const password = process.env.DRS_SUPER_ADMIN_PASSWORD;
  if (!email || !password) {
    throw new Error('DRS_SUPER_ADMIN_EMAIL / DRS_SUPER_ADMIN_PASSWORD must be set in .env');
  }
  return { email, password };
}

module.exports = { DRS_ENVIRONMENTS, drsEnv, drsSuperAdmin };
