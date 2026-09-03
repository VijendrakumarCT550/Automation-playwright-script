// Which PULSE deployment a run targets.
//
// Before this file, the target was a single BASE_URL line in .env that had to
// be hand-edited to switch environments — easy to forget, and invisible in the
// run output, so a suite could silently run against the wrong deployment.
// Now: set PULSE_ENV=dev|test and the URL is resolved from here.
//
// Back-compat is deliberate: with PULSE_ENV unset, whatever BASE_URL is
// already in .env still wins, so nothing that ran before this file changes
// behaviour. playwright.config.js calls applyEnvironment() once at load and
// writes the resolved URL back into process.env.BASE_URL, because a lot of
// the suite reads process.env.BASE_URL directly (page.goto(`${...}/my-tasks`)
// in rfi-flow-turns.js, rfi-nav.js, the 00_inspect_* specs) rather than going
// through Playwright's own `use.baseURL`. Both paths must agree or specs would
// navigate to a different host than the one the config reports.
const ENVIRONMENTS = {
  // The deployment the WTG/wind inclusion work runs against, per the app
  // owner: "all test and trial u will do on pulse-dev".
  dev: {
    key: 'dev',
    baseUrl: 'https://pulse-dev.cfapps.ap11.hana.ondemand.com',
    description: 'pulse-dev — WTG/wind inclusion + mobile-view development',
  },
  // The QA deployment. Added 2026-09-03: the E2E smoke chain runs here, and
  // .env's BASE_URL already pointed at it — but with no named entry the config
  // reported it as "custom", which is exactly the "silently running against the
  // wrong deployment" problem this file exists to prevent. Naming it also makes
  // PULSE_ENV=qa usable instead of hand-editing BASE_URL.
  //
  // NOTE: the long-standing .env CI account has been seen getting a 401 here
  // (not provisioned in this deployment's user auth). The smoke chain creates
  // its own users, so it should be unaffected — but that is worth confirming
  // with a single login before relying on it.
  qa: {
    key: 'qa',
    baseUrl: 'https://pulse-qa.cfapps.ap11.hana.ondemand.com',
    description: 'pulse-qa — E2E smoke chain',
  },
  test: {
    key: 'test',
    baseUrl: 'https://pulse-test.cfapps.ap11.hana.ondemand.com',
    description: 'pulse-test — where the solar regression suite has been running',
  },
};

function resolveEnvironment() {
  const key = String(process.env.PULSE_ENV || '').trim().toLowerCase();

  if (key) {
    const env = ENVIRONMENTS[key];
    if (!env) {
      throw new Error(
        `Unknown PULSE_ENV="${process.env.PULSE_ENV}". ` +
        `Valid values: ${Object.keys(ENVIRONMENTS).join(', ')}`
      );
    }
    return env;
  }

  // No PULSE_ENV — fall back to the raw .env BASE_URL so every pre-existing
  // invocation keeps working untouched.
  const fromEnvFile = process.env.BASE_URL;
  if (!fromEnvFile) {
    throw new Error(
      'Neither PULSE_ENV nor BASE_URL is set. ' +
      `Set PULSE_ENV to one of: ${Object.keys(ENVIRONMENTS).join(', ')}`
    );
  }

  const known = Object.values(ENVIRONMENTS).find(e => e.baseUrl === fromEnvFile.replace(/\/+$/, ''));
  return known || { key: 'custom', baseUrl: fromEnvFile, description: 'from .env BASE_URL' };
}

// Resolves the target and writes it back to process.env.BASE_URL so the
// direct-process.env.BASE_URL readers across the suite see the same host
// Playwright's baseURL points at. Returns the resolved environment.
function applyEnvironment() {
  const env = resolveEnvironment();
  process.env.BASE_URL = env.baseUrl;
  return env;
}

module.exports = { ENVIRONMENTS, resolveEnvironment, applyEnvironment };
