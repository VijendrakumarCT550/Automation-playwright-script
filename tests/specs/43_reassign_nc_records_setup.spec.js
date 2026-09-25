const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { fleetFor } = require('../utils/reassign-fleet');
const {
  GROUND, NC_POOL, NC_CREATOR, recordsFor, recordRecord,
} = require('../utils/reassign-records');
const { readNcCode } = require('../utils/smoke-nc-turns');
const NCCreatePage = require('../pages/NCCreatePage');

// ===========================================================================
// SETUP — raises the pool of NCs the reassignment specs act on.
// ===========================================================================
// The NC half of 42_reassign_rfi_records_setup, and deliberately a SEPARATE
// FILE with its own data constant, its own page object and its own loop, per
// the standing rule that NC files never share code with RFI ones. The two look
// alike on purpose; that is not an invitation to factor them together.
//
// App owner, 2026-09-20: *"same applies for NC also — specs of reassignment
// should start from NC creation first."* So NCs are created up front here, and
// the reassignment specs claim them from the store rather than creating any.
//
// RUN THIS AFTER 42. A non-approved NC BLOCKS RFI create for the same
// (inspection checkpoint, work section) — rule R2a, asserted live by SM28. With
// every RFI raised first, these NCs cannot get in their way. A later run that
// needs to ADD an RFI on this ground may be refused because of them; that is
// the rule working, not a defect.
//
// RAISED BY A FLEET QI, NOT THE .env ONE — an NC is created by the QUALITY
// INSPECTOR, the reverse of RFI. QI_D is the arm mapped to A-06c / Civil / BL07,
// so the records carry the fleet's control arms as their assignees.
//
// IDEMPOTENT: a pool entry already recorded for this deployment is skipped.
//
// GROUND COST: NCs are cheaper than RFIs here — an NC consumes nothing and
// duplicate NCs against identical details are legal (see 39_nc_bulk_create_qi).
// What they DO cost is the RFI-blocking rule above.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/43_reassign_nc_records_setup.spec.js --project=chromium --workers=1
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// 14_nc_create_qi / 39_nc_bulk_create_qi's proven-live combination, with the
// work area taken from the fleet's ground so the two can never drift apart.
//
// Work Location MUST be set explicitly: confirmed live that it is no longer
// pre-populated for the QI, and leaving it empty leaves every downstream
// dropdown empty with no error explaining why.
const NC_DATA = {
  workLocation:     GROUND.workLocation,
  workArea:         GROUND.workArea,
  vendorName:       'CHOUHAN',
  package:          GROUND.package,
  activity:         'Piling - Robotic Docking System',
  subActivity:      'Piling - Robotic Docking System',
  workSectionCount: 2,
  ncQuantity:       2,
  unit:             'EA',
  defectType:       'Workmanship defect',
  category:         'Critical',
  // capturePhoto is not listed — NCCreatePage.fillForm defaults it to true,
  // and the photo is mandatory.
  targetDateClosureDays: 14,
};

let context, page, ncCreate, creator;
const built = [];
const skipped = [];
const failed = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);

  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const fleet = fleetFor();
  creator = fleet[NC_CREATOR];
  expect(
    creator && creator.email,
    `The NC creator ${NC_CREATOR} is not in the fleet for this deployment — build the ` +
    `"candidates" group with 40_reassign_fleet_setup.spec.js first.`
  ).toBeTruthy();
  expect(
    creator.wamApplied,
    `${NC_CREATOR} (${creator.email}) has no WAM recorded, so it cannot raise an NC on ` +
    `${GROUND.workArea}. Remap it with REASSIGN_FLEET_REMAP=${NC_CREATOR}.`
  ).toBeTruthy();

  // A hand-made context does NOT inherit playwright.config.js's `use` block,
  // and NC's mandatory Capture Photo needs `camera`. (The fake-media-stream
  // launch args do come through — they are set on the browser.)
  context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();

  await loginAsFlowUser(page, creator.email, PASSWORD);
  ncCreate = new NCCreatePage(page);

  console.log(
    `\n=== Reassignment NC record pool on ${process.env.BASE_URL} ===\n` +
    `    raising as ${NC_CREATOR} (${creator.name}) on ` +
    `${GROUND.workLocation}/${GROUND.package}/${GROUND.workArea}\n`
  );
});

test.afterAll(async () => {
  console.log('\n=== NC record pool summary ===');
  for (const r of built) console.log(`  BUILT   ${r.key.padEnd(18)} ${r.code}`);
  for (const k of skipped) console.log(`  SKIP    ${k.padEnd(18)} already recorded`);
  for (const f of failed) console.log(`  FAILED  ${f.key.padEnd(18)} ${f.error}`);
  console.log(`\n  built ${built.length}, skipped ${skipped.length}, failed ${failed.length}`);
  if (context) await context.close();
});

test(`raise the ${NC_POOL.length}-record NC pool for the reassignment specs`, async () => {
  test.setTimeout(Math.max(45, NC_POOL.length * 6) * 60 * 1000);

  const already = recordsFor().nc;

  for (const entry of NC_POOL) {
    const recorded = already[entry.key];

    // REPAIR, NOT RE-RAISE. An entry holding a placeholder code is a real NC
    // that simply had no counter yet when it was read. Creating a replacement
    // would leave the first one behind on the ground for nothing, so re-read
    // the code from the id instead — which is all readNcCode does.
    const finalized = (c) => /-\d+$/.test(String(c || '').trim()) && !/draft/i.test(String(c || ''));
    if (recorded && recorded.id && !finalized(recorded.code)) {
      try {
        const code = await readNcCode(page, recorded.id, { log: (m) => console.log(m) }, entry.key);
        const fixed = recordRecord('nc', entry.key, { ...recorded, code, repairedFrom: recorded.code });
        built.push(fixed);
        console.log(`  ${entry.key}: repaired ${recorded.code} -> ${code}`);
      } catch (err) {
        const msg = String(err.message || err).split(String.fromCharCode(10))[0];
        failed.push({ key: entry.key, error: `repair failed: ${msg}` });
        console.log(`  ${entry.key}: REPAIR FAILED — ${msg}`);
      }
      continue;
    }

    if (recorded && recorded.code) {
      skipped.push(entry.key);
      console.log(`  ${entry.key}: already recorded as ${recorded.code} — skipped`);
      continue;
    }

    // A unique description per record, so the pool entries are told apart on
    // the NC list by hand — an iteration that silently re-saved the previous
    // NC instead of creating its own is otherwise invisible.
    const marker = `Reassignment pool ${entry.key} - ${entry.purpose}`;
    console.log(`\n  ${entry.key}: raising — ${entry.purpose}`);

    try {
      // A plain navigation is a clean reset here: NC does NOT autosave on
      // navigate-away (proven in 32_nc_draft_autosave), so nothing is left for
      // the next iteration to resume even after a failure. Never "reset" by
      // confirming the Cancel popup — that DELETES a drafted NC.
      await page.goto(`${process.env.BASE_URL}/my-tasks?type=nc`);
      await page.waitForTimeout(1000);
      await ncCreate.closeAnyOpenListbox();
      await ncCreate.closeAnyOpenDialog();

      await ncCreate.goto();
      await ncCreate.clickCreateNC();

      const workSections = await ncCreate.fillForm({ ...NC_DATA, ncDescription: marker });
      await ncCreate.submitNC();

      const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
      expect(match, `could not read an NC id from the post-submit URL: ${page.url()}`).toBeTruthy();

      // A freshly created NC must be V1 — one that arrives past V1 means the
      // version counter picked up state from the previous record.
      const version = await ncCreate.getVersionBadge();
      expect(version.toLowerCase(), `${entry.key} (${match[1]}) should start at V1`).toBe('v1');

      // readNcCode, NOT getVisibleCode(): read straight after creation, an NC's
      // code is still a PLACEHOLDER MADE OF THE LAST FOUR CHARACTERS OF ITS
      // UUID — "NC-A-06c-BL07-CIV-9fbd" rather than "…-CIV-40". It contains no
      // "draft" to match on, so RFI's /draft/i guard does not catch it; the
      // shape check (a finalized code ends in its numeric counter) is what
      // does. This bit one of the first three records here on 2026-09-20, and
      // smoke-nc-turns had already solved it in 2026-09-03 — hence reusing that
      // reader, which polls the id until the code finalizes.
      const code = await readNcCode(page, match[1], { log: (m) => console.log(m) }, entry.key);
      expect(code, 'the NC view must show a visible code to address the record by').toBeTruthy();

      const saved = recordRecord('nc', entry.key, {
        id: match[1],
        code,
        purpose: entry.purpose,
        mutated: entry.mutated,
        ground: GROUND,
        description: marker,
        workSections: workSections || null,
        createdBy: { key: NC_CREATOR, name: creator.name, email: creator.email },
      });

      built.push(saved);
      console.log(`  ${entry.key}: ${code} (${match[1]}) at ${version}`);
    } catch (err) {
      const msg = String(err.message || err).split(/\r?\n/)[0];
      failed.push({ key: entry.key, error: msg });
      console.log(`  ${entry.key}: FAILED — ${msg}`);
    }
  }

  expect(
    built.length + skipped.length,
    `No NC could be raised on ${GROUND.workArea}. Failures: ` +
    JSON.stringify(failed.map((f) => `${f.key}: ${f.error}`), null, 2)
  ).toBeGreaterThan(0);
});
