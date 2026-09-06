const { test, expect } = require('@playwright/test');
const { getProfile } = require('../../config/projects');
const { loginAsFlowUser } = require('../../utils/helpers');
const { resolveSmokeUsers } = require('../../utils/smoke-users');
const NCCreatePage = require('../../pages/NCCreatePage');

// RECON — which S05b work areas actually populate Vendor Name on the NC create
// form, and is an empty one EMPTY or merely SLOW.
//
// ---------------------------------------------------------------------------
// WHY
// ---------------------------------------------------------------------------
// The app owner confirmed on 2026-09-05 that Vendor Name does not populate on
// BL05 during NC create, and that it does on BL03 — which is why three
// TEMPORARY-BL03 markers exist in tests/config/projects.js.
//
// SM28 was pointed at BL06 (sacrificial ground, nothing else uses it) and on its
// first live run, 2026-09-06, failed at exactly the same place:
//
//   locator.waitFor: Timeout 5000ms exceeded
//   waiting for [role=option] filter({ hasText: 'CHOUHAN' })
//
// So the problem is not specific to BL05. Before moving SM28's ground on a
// guess, this establishes which areas actually work.
//
// ---------------------------------------------------------------------------
// EMPTY vs SLOW — the distinction this exists to settle
// ---------------------------------------------------------------------------
// NCCreatePage._selectScrollableOption waits 5s for the named option. That is
// short for this app, so "no CHOUHAN in 5 seconds" and "no vendors at all" are
// NOT the same finding, and treating them as one would send SM28 to the wrong
// area for the wrong reason. This reads the FULL option list per area after a
// generous wait and reports the count, so a slow-but-populated dropdown is
// visibly different from an empty one.
//
// ---------------------------------------------------------------------------
// READ-ONLY, AND CAREFULLY SO
// ---------------------------------------------------------------------------
// This NEVER touches the Work Section field and NEVER submits. Selecting a work
// section is the irreversible half of these forms — it ties up a
// (checkpoint, work section) pair and abandoning the form without properly
// confirming Cancel consumes it permanently (docs/rfi-activity-dependency-chain.md).
// Only Work Location / Work Area / Vendor are touched, and Vendor is only READ.
//
// Recon, so it reports and does not assert. Its output is the input to a
// one-line ground change in tests/config/projects.js.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// The S05b band, plus the flow areas. BL03 is included deliberately as the
// KNOWN-GOOD control: if BL03 also reads empty here, the probe itself is wrong
// and nothing else it says can be trusted.
const AREAS = ['BL03', 'BL04', 'BL05', 'BL06', 'BL07', 'BL08', 'BL10', 'BL11', 'BL12'];

// Resolves its own profile rather than taking the `profile` fixture. This file
// lives under tests/specs/inspection/, which only the `chromium` project matches
// — and that project defaults to solar-regression, whose users come from .env
// and which therefore has no users.prefixes for resolveSmokeUsers() to read.
// Naming the smoke profile here keeps the recon runnable with a plain
// `npx playwright test <file>` and needs no change to playwright.config.js.
const PROFILE_KEY = process.env.RECON_PROFILE || 'solar-e2e';

test('which S05b work areas populate Vendor Name on the NC create form', async ({ browser }) => {
  test.setTimeout(20 * 60 * 1000);
  const profile = getProfile(PROFILE_KEY);
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  expect(profile.nc, `Profile "${profile.key}" has no nc data`).toBeTruthy();

  const qi = resolveSmokeUsers(profile, ['QI']).QI;
  const context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  const results = [];
  try {
    console.log(`\n=== NC Vendor-by-Work-Area recon (${profile.key}) ===\n    QI: ${qi.name} <${qi.email}>\n`);
    await loginAsFlowUser(page, qi.email, PASSWORD);

    const nc = new NCCreatePage(page);

    for (const area of AREAS) {
      // A FRESH FORM PER AREA, deliberately. Re-selecting Work Area inside one
      // open form leaves the previous area's cascade half-resolved, and a stale
      // vendor list would be indistinguishable from a correctly-empty one —
      // which is the exact question being asked.
      let vendors = [];
      let note = '';
      try {
        await nc.goto();
        await nc.clickCreateNC();

        await nc._selectScrollableOption(nc.workLocationDropdown, profile.nc.workLocation);
        await nc._selectScrollableOption(nc.workAreaDropdown, area);

        // Generous, and polled: this is the whole point. Anything still empty
        // after this is empty, not slow.
        const deadline = Date.now() + 20000;
        while (Date.now() < deadline) {
          vendors = await nc.getDropdownOptions(nc.vendorNameDropdown).catch(() => []);
          await nc.closeAnyOpenListbox().catch(() => {});
          if (vendors.length) break;
          await page.waitForTimeout(1000);
        }
      } catch (err) {
        note = ` (probe error: ${err.message.split('\n')[0].slice(0, 80)})`;
      }

      const hasChouhan = vendors.some((v) => /CHOUHAN/i.test(v));
      results.push({ area, count: vendors.length, hasChouhan, vendors });
      console.log(
        `  ${area.padEnd(5)} vendors=${String(vendors.length).padEnd(3)} ` +
        `CHOUHAN=${hasChouhan ? 'YES' : 'no '} ${vendors.length ? JSON.stringify(vendors.slice(0, 4)) : ''}${note}`
      );
    }

    console.log('\n--- summary ---');
    const usable = results.filter((r) => r.hasChouhan).map((r) => r.area);
    const empty = results.filter((r) => r.count === 0).map((r) => r.area);
    console.log(`  usable for NC create (CHOUHAN present): ${usable.join(', ') || '(none)'}`);
    console.log(`  vendor list EMPTY:                      ${empty.join(', ') || '(none)'}`);

    const control = results.find((r) => r.area === 'BL03');
    if (control && !control.hasChouhan) {
      console.log(
        '  WARNING: BL03 is the known-good control and it did NOT show CHOUHAN either — ' +
        'treat every result above as unreliable and fix the probe before acting on it.'
      );
    }
  } finally {
    await context.close();
  }

  // Recon: reports, never asserts. The only failure mode worth having is the
  // probe not running at all.
  expect(results.length, 'the probe should have visited every candidate area').toBe(AREAS.length);
});
