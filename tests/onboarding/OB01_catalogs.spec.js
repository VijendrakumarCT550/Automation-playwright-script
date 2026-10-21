const { test, expect } = require('@playwright/test');
const { drsEnv, loginSuperAdmin } = require('../drs/utils/drs-ui');
const DATA = require('../drs/drs-data');
const PackagesConfiguratorPage = require('../drs-setting/PackagesConfiguratorPage');
const { ROUNDS, currentRun, putRun, chainName } = require('./onboarding-run');
const { buildRound } = require('./catalog-round');

// ===========================================================================
// OB01 — THE RUN'S CATALOG VERSIONS (onboarding suite; docs/drs-onboarding-suite.md).
//
//   roots  All sites v1, and <site> v1 when the site has one
//   A1     All sites  <- All sites v1        first dependency plan, standard checklists
//   S1     <site>     <- <site> v1 (or All sites v1)   first plan + our six checklists
//   A2     All sites  <- A1                  inherited P-code -> second plan; new code first plan
//   S2     <site>     <- S1                  same, + our six checklists on its new code
// Dependencies: Civil P-code only, both chains. Our checklists: site rounds only.
// Every round ends LOCKED and verified. A chain with a foreign open draft has it
// locked first - or the run stops with DRS's reason (app owner, 2026-10-19).
//
// Run (inside the suite): npm run onboarding:uat
// ===========================================================================

const ENV = drsEnv();

// TWO CHAINS SIDE BY SIDE (2026-10-21): All sites (A1 -> A2) and the site's own
// (S1 -> S2) do not depend on each other, so each is a serial group and the two
// groups run in parallel workers (npm run onboarding:uat gives OB01 --workers=2;
// with one worker they simply run one after the other). Inside a chain the order
// is fixed: round 2 is drafted from round 1. The shared records - the run, the
// catalog records, the code counter - are written atomically (drs-state lock).
test.describe.configure({ mode: 'parallel' });

const CHAINS = [
  { name: 'All sites', rootKey: 'allSites', rounds: ROUNDS.filter((r) => r.chain === 'All sites') },
  { name: DATA.site, rootKey: 'site', rounds: ROUNDS.filter((r) => r.chain === 'site') },
];

for (const chain of CHAINS) {
  test.describe(`OB1 chain: ${chain.name}`, () => {
    test.describe.configure({ mode: 'serial' });
    let context, page;

    test.beforeAll(async ({ browser }) => {
      test.setTimeout(5 * 60 * 1000);
      const run = currentRun(ENV.key);
      console.log(`  onboarding run ${run.run} on drs-${ENV.key}, chain ${chain.name}`);
      context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
      page = await context.newPage();
      await loginSuperAdmin(page, ENV);
    });

    test.afterAll(async () => { if (context) await context.close(); });

    // The chain's root: All sites v1 (must be locked), or the site's own v1 when it
    // has one (else the site chain starts from All sites v1 - 5 versions this run).
    test(`OB1.0 root of ${chain.name}`, async () => {
      test.setTimeout(5 * 60 * 1000);
      let run = currentRun(ENV.key);
      if (run.roots && chain.rootKey in run.roots) { console.log(`  ${chain.name}: root already decided: ${run.roots[chain.rootKey]}`); return; }
      const pc = new PackagesConfiguratorPage(page, ENV.baseUrl);
      await pc.goto();
      await pc.selectProjectTypeAndSite(chain.name);
      const labels = await pc.optionLabels('Catalog version');
      let root;
      if (chain.rootKey === 'allSites') {
        expect(labels.some((l) => /^All sites v1\s+—\s+locked$/.test(l)), 'All sites v1 is not a locked version').toBe(true);
        root = 'All sites v1';
      } else {
        root = labels.some((l) => l === `${DATA.site} v1 — locked`) ? `${DATA.site} v1` : null;
      }
      run = putRun(ENV.key, run.run, { roots: { [chain.rootKey]: root } });
      console.log(`  ${chain.name}: root ${root || '(none - the site has no v1: 5 Work Areas this run)'}`);
    });

    for (const r of chain.rounds) {
      test(`OB1.${r.key} ${chain.name} round ${r.round}: draft, build, lock`, async () => {
        test.setTimeout(90 * 60 * 1000);
        let run = currentRun(ENV.key);
        const source = r.key === 'A1' ? run.roots.allSites
          : r.key === 'S1' ? (run.roots.site || 'All sites v1')
            : run.rounds[r.key === 'A2' ? 'A1' : 'S1'] && run.rounds[r.key === 'A2' ? 'A1' : 'S1'].label;
        expect(source, `${r.key}: its source is not locked yet - the previous round must finish first`).toBeTruthy();
        const rec = await buildRound(page, ENV, {
          key: r.key, chain: chainName(r), round: r.round, source, run: run.run, withChecklists: r.chain === 'site',
        });
        run = putRun(ENV.key, run.run, { rounds: { [r.key]: { label: rec.label, chain: chainName(r), source, codes: rec.codes } } });
        console.log(`  ${r.key}: ${rec.label} locked (from ${source})`);
      });
    }
  });
}
