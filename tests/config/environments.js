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

// ---------------------------------------------------------------------------
// DRS — THE PLATFORM SO MAPPING MOVED TO
// ---------------------------------------------------------------------------
// App owner, 2026-09-06, and this is a NOT-A-BUG rule, not a workaround:
//
//   "if after clicking SO mapping screen user either lands on SO mapping
//    screen, or on DRS login page (or on dashboard if DRS platform is already
//    logged in with admin credential) — [that] is expected behaviour, not a
//    bug."
//
// SO Mapping was removed from PULSE on 2026-09-04 and now lives in DRS, which
// PULSE syncs its project and work-location configuration from. PULSE's own
// sidebar still carries the "SO Mapping" entry, and following it can therefore
// legitimately end in any of FOUR places:
//
//   1. the real PULSE /so-mapping screen        (older deployments)
//   2. PULSE's "Desktop Mode Required" migration notice
//   3. the DRS LOGIN page                       (no DRS session yet)
//   4. a DRS application page, e.g. /projects   (DRS already authenticated)
//
// Outcomes 3 and 4 leave the PULSE ORIGIN ENTIRELY, which is what makes this
// worth encoding rather than just documenting. The menu sweeps (SM17, spec 31)
// assert `not.toHaveURL(/\/login/i)` after opening each item — and DRS's own
// login URL ends in `/login`, so the hand-off would be reported as "SO Mapping
// bounced to /login", i.e. a PULSE session failure, which it is not. Anything
// continuing to drive the page afterwards is also now on the wrong origin.
//
// Recognised by HOSTNAME rather than by a hardcoded URL: the DRS deployment
// tracks the PULSE one (drs-uat / drs-dev / ...) and no test needs to know
// which, only that the page is no longer PULSE. Set DRS_BASE_URL in .env to
// name an exact host as well; the prefix match still applies either way.
function isDrsUrl(url) {
  if (!url) return false;

  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch (e) {
    return false; // not an absolute URL (about:blank, a bare path) — not DRS
  }

  const configured = String(process.env.DRS_BASE_URL || '').trim();
  if (configured) {
    try {
      if (host === new URL(configured).hostname.toLowerCase()) return true;
    } catch (e) {
      // A malformed DRS_BASE_URL must not break the prefix check below.
    }
  }

  // Confirmed live 2026-09-06: drs-uat.cfapps.ap11.hana.ondemand.com
  return /^drs[-.]/.test(host);
}

// True when `url` is on the deployment this run targets (PULSE). Everything
// else — DRS included — is somewhere the suite did not navigate deliberately.
function isPulseUrl(url) {
  if (!url) return false;
  try {
    return new URL(url).origin === new URL(process.env.BASE_URL).origin;
  } catch (e) {
    return false;
  }
}

module.exports = { ENVIRONMENTS, resolveEnvironment, applyEnvironment, isDrsUrl, isPulseUrl };
