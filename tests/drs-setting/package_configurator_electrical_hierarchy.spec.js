const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin } = require('../drs/utils/drs-ui');
const PackagesConfiguratorPage = require('./PackagesConfiguratorPage');
const { selectedRuns, selectedPackages, mode, expectedNames } = require('./pc-data');
const counter = require('./pc-counter');

// ===========================================================================
// PACKAGES CONFIGURATOR - sub-package hierarchy (Electrical, and Civil since 2026-10-15).
// RUNBOOK.md in this folder is the spec; this file executes it.
//
// For each row of the run matrix (Solar x All sites / Khavda / Mandvi, two
// letters each): open the Solar catalog for the site, pick a version, then
//   PC_MODE=verify (DEFAULT, READ-ONLY)  check all 19 nodes per letter exist and
//                    every checkpoint carries its checklist. The DRS write guard is
//                    installed, so a stray click cannot write.
//   PC_MODE=build    select/create a DRAFT and create whatever is missing, node by
//                    node, then verify. Idempotent: each step checks the node first
//                    (after expanding its parent - runbook gotcha 11). Never clicks
//                    Lock / Reset / Discard / Delete; the owner locks by hand.
//
// WHICH RUNS: whole matrix by default; PC_RUNS=2 or 1,3 picks rows; PC_SITE +
// PC_LETTERS=PC03,QC03 is one custom run; PC_LETTERS=next (build only) takes each
// package's next counter (PC02/QC02, PE02/QE02 ...) - see pc-counter.js.
// WHICH PACKAGES: PC_PACKAGES=Civil,Electrical (default Electrical, where the
// historic matrix letters live). Codes are per package: C = Civil, E = Electrical.
//
// STATUS 2026-10-01: written from the runbook; the app owner fixes a DRS issue
// before the first BUILD. Run verify first - it also proves the locators.
//
// Run:  npm run drs:catalog                       (verify, reads .env)
//       $env:PC_MODE="build"; npm run drs:catalog  (creates - deliberately explicit)
// ===========================================================================

const ENV = drsEnv();
const MODE = mode();
const RUNS = selectedRuns();
const OUT = path.resolve(__dirname, '../../drs-explore/package-configurator');

test.describe.configure({ mode: 'serial' });

let context, page, pc;
const blocked = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  if (MODE === 'verify') await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  pc = new PackagesConfiguratorPage(page, ENV.baseUrl);
  console.log(`  package configurator on drs-${ENV.key}, mode=${MODE}, runs=${RUNS.map((r) => `${r.id}:${r.site}[${r.letters}]`).join(' ')}`);
});

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  if (context) await context.close();
});

for (const run of RUNS) {
  test(`Solar / ${run.site} - letters ${run.letters.join(', ')} (${MODE})`, async () => {
    test.setTimeout((MODE === 'build' ? 90 : 20) * 60 * 1000);

    await pc.goto();
    await pc.selectProjectTypeAndSite(run.site);

    let version;
    if (MODE === 'build') {
      version = await pc.ensureDraft(run.site);
    } else {
      const found = await pc.openVersionWithLetters(run.site, run.letters, selectedPackages()[0]);
      console.log(`  ${run.site}: versions tried -> ${found.tried.join(' | ')}`);
      expect(found.label, `no ${run.site} catalog version holds all of ${run.letters.join(', ')} (${found.tried.join(' | ')})`).toBeTruthy();
      version = found.label;
    }
    const locked = await pc.isLockedVersion();
    console.log(`  ${run.site}: version "${version}"${locked ? ' (locked, read-only)' : ''}`);
    if (MODE === 'build') expect(locked, `"${version}" is locked - build mode needs an open draft`).toBe(false);

    for (const pkg of selectedPackages()) {
      // PC_LETTERS=next: reserve the package's next counter (one past the file and
      // the live tree) BEFORE creating anything.
      let letters = run.letters;
      if (letters.length === 1 && letters[0] === 'next') {
        expect(MODE, 'PC_LETTERS=next only makes sense with PC_MODE=build').toBe('build');
        const r = counter.reserve(ENV.key, pkg, await pc.usedLetters(pkg));
        letters = r.codes;
        console.log(`  ${pkg}: counter ${r.n} -> codes ${letters.join(', ')}`);
      }

      for (const L of letters) {
        if (MODE === 'build') {
          await pc.buildLetter(L, pkg);
          console.log(`  ${pkg} / ${L}: build finished`);
        }
        const { missing, wrongChecklist } = await pc.verifyLetter(L, pkg);
        console.log(`  ${pkg} / ${L}: ${expectedNames(L).length - missing.length}/${expectedNames(L).length} nodes present` +
          `${wrongChecklist.length ? `, ${wrongChecklist.length} without their checklist` : ''}`);
        expect(missing, `${pkg} / ${L}: nodes missing from "${version}" on ${run.site}`).toEqual([]);
        expect(wrongChecklist, `${pkg} / ${L}: checkpoints without the expected checklist`).toEqual([]);
      }
    }
  });
}
