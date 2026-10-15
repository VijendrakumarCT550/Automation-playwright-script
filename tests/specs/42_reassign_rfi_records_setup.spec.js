const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { fleetFor } = require('../utils/reassign-fleet');
const {
  GROUND, RFI_POOL, RFI_CREATOR, recordsFor, recordRecord, resetPool,
} = require('../utils/reassign-records');
const { getVisibleCodeFor } = require('../utils/rfi-dependency-flow');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');

// ===========================================================================
// SETUP — raises the pool of RFIs the reassignment specs act on.
// ===========================================================================
// NOT a behaviour test. Its assertions are about whether the SETUP succeeded,
// never about how reassignment behaves.
//
// App owner, 2026-09-20: *"create RFI by login users, don't wait — someone else
// will feed; specs design should be such kind: all RFI are being created first,
// then reassignment test starts."* So this stage owns record creation outright,
// the behaviour specs claim records from the store by purpose, and neither
// depends on anyone seeding data by hand.
//
// RAISED BY A FLEET CI, NOT THE .env ONE. The record's CI/EE/QI are snapshotted
// from the WAM of its work area at creation, so raising it as CI_C — the arm
// mapped to A-06c / Civil / BL07 — is what makes the record carry the fleet's
// own control arms. Family C then asks whether a DIFFERENT candidate can take
// it over and actually work it, which is the question the whole document points
// at.
//
// IDEMPOTENT. A pool entry already recorded for this deployment is skipped, so
// a re-run costs nothing and creates nothing. Delete an entry from
// fixtures/reassign-records.json to have it raised again - or, to start a whole
// fresh pool (RFI AND NC) for this deployment, set REASSIGN_POOL_RESET=1 for this
// spec only. Only 42 honours it: 43 runs after 42 and must never wipe the RFIs
// 42 just raised.
//
// GROUND COST — REAL AND PERMANENT: each RFI consumes a Work Section on BL07,
// the band the app owner freed for this work
// (app-owner-decisions-and-conventions.md section 4.1). If BL07 runs out of Work
// Sections the form says so, and this file reports that per record rather than
// failing the whole stage.
//
// Usage:
//   $env:PULSE_ENV="test"
//   npx playwright test tests/specs/42_reassign_rfi_records_setup.spec.js --project=chromium --workers=1
// Fresh pool (clears this deployment's rfi + nc entries first):
//   $env:REASSIGN_POOL_RESET="1"; npx playwright test tests/specs/42_reassign_rfi_records_setup.spec.js --project=chromium --workers=1; Remove-Item Env:REASSIGN_POOL_RESET
//
// Runs BEFORE 43_reassign_nc_records_setup.spec.js — see NC_POOL's comment: a
// non-approved NC blocks RFI create for the same (checkpoint, work section).
// ===========================================================================
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// The ground constants come from reassign-fleet (so the fleet and its records
// can never drift apart); the activity chain is 03_rfi_bulk_create's
// proven-live Civil combination, unchanged.
const RFI_DATA = {
  workLocation:         GROUND.workLocation,
  workArea:             GROUND.workArea,
  package:              GROUND.package,
  subPackage:           'Piling (MMS, Inverter, LT Cable Hangers)',
  activity:             'Piling - MMS',
  subActivity:          'Piling - MMS',
  rfiQuantity:          null,
  unit:                 null,
  subContractor:        null,
  inspectionCheckpoint: 'Pre Pour Inspection - Pile',
  inspectionChecklist:  'Micro Pile Checklist',
};

let context, page, creator;
const built = [];
const skipped = [];
const failed = [];

test.beforeAll(async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);

  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const fleet = fleetFor();
  creator = fleet[RFI_CREATOR];
  expect(
    creator && creator.email,
    `The RFI creator ${RFI_CREATOR} is not in the fleet for this deployment. ` +
    `Build it first: $env:REASSIGN_FLEET_GROUP="candidates"; ` +
    `npx playwright test tests/specs/40_reassign_fleet_setup.spec.js --project=chromium --workers=1`
  ).toBeTruthy();
  expect(
    creator.wamApplied,
    `${RFI_CREATOR} (${creator.email}) has no WAM recorded, so it cannot raise an RFI on ` +
    `${GROUND.workArea} — it would not see the work area at all. Remap it with ` +
    `REASSIGN_FLEET_REMAP=${RFI_CREATOR}.`
  ).toBeTruthy();

  // Own context rather than the `page` fixture: every record shares ONE CI
  // session, and geolocation/permissions are not inherited by a hand-made
  // context (they are set in playwright.config.js's `use` block).
  context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();

  await loginAsFlowUser(page, creator.email, PASSWORD);

  console.log(
    `\n=== Reassignment RFI record pool on ${process.env.BASE_URL} ===\n` +
    `    raising as ${RFI_CREATOR} (${creator.name}) on ` +
    `${GROUND.workLocation}/${GROUND.package}/${GROUND.workArea}\n`
  );
});

test.afterAll(async () => {
  console.log('\n=== RFI record pool summary ===');
  for (const r of built) console.log(`  BUILT   ${r.key.padEnd(16)} ${r.code}`);
  for (const k of skipped) console.log(`  SKIP    ${k.padEnd(16)} already recorded`);
  for (const f of failed) console.log(`  FAILED  ${f.key.padEnd(16)} ${f.error}`);
  console.log(`\n  built ${built.length}, skipped ${skipped.length}, failed ${failed.length}`);
  if (context) await context.close();
});

// Returns to My Tasks, dismissing an auto-resumed draft from the previous
// iteration. RFI autosaves a half-filled create form, so landing back on
// /create with the previous record's Work Section still selected is the normal
// case, not an error — see 24_rfi_draft_autosave.
async function resetToMyTasks() {
  for (let attempt = 0; attempt < 5; attempt++) {
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForTimeout(300);
    if (!page.url().includes('/create')) return;

    const cancel = page.getByRole('button', { name: 'Cancel' });
    if (await cancel.isVisible({ timeout: 1000 }).catch(() => false)) {
      await cancel.click();
      await page.waitForTimeout(500);
      // The "are you sure?" confirmation, when the app asks for one.
      const yes = page.getByRole('button', { name: /^(Yes|Confirm)$/i }).first();
      if (await yes.isVisible({ timeout: 1000 }).catch(() => false)) {
        await yes.click();
        await page.waitForTimeout(500);
      }
    }
  }
  throw new Error('could not get back to My Tasks — the create form kept resuming');
}

test(`raise the ${RFI_POOL.length}-record RFI pool for the reassignment specs`, async () => {
  test.setTimeout(45 * 60 * 1000);

  if (process.env.REASSIGN_POOL_RESET === '1') {
    const dropped = resetPool();
    console.log(`  REASSIGN_POOL_RESET=1: cleared ${dropped.rfi} RFI and ${dropped.nc} NC pool entr${dropped.rfi + dropped.nc === 1 ? 'y' : 'ies'} for this deployment`);
  }
  const already = recordsFor().rfi;

  for (const entry of RFI_POOL) {
    const recorded = already[entry.key];

    // REPAIR, NOT RE-RAISE. An entry recorded with a DRAFT placeholder is a
    // real record that simply had no code yet when it was read (see the DRAFT
    // race below). Raising a replacement would consume a second Work Section
    // and strand the first record, so re-read the code by id instead.
    if (recorded && recorded.id && /DRAFT/i.test(String(recorded.code))) {
      try {
        const code = await getVisibleCodeFor(page, recorded.id);
        if (/DRAFT/i.test(String(code))) {
          throw new Error(`still reads as a draft placeholder (${code})`);
        }
        const fixed = recordRecord('rfi', entry.key, { ...recorded, code, repairedFrom: recorded.code });
        built.push(fixed);
        console.log(`  ${entry.key}: repaired ${recorded.code} -> ${code}`);
      } catch (err) {
        const msg = String(err.message || err).split(/\r?\n/)[0];
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

    console.log(`\n  ${entry.key}: raising — ${entry.purpose}`);
    try {
      await resetToMyTasks();

      const myTasks = new MyTasksPage(page);
      await myTasks.waitForLoad();
      await myTasks.clickCreateRFI();

      const rfiCreate = new RFICreatePage(page);
      const workSections = await rfiCreate.fillForm(RFI_DATA);
      await rfiCreate.clickProceed();

      const checklist = new RFIChecklistPage(page);
      // A pool entry may carry its own observation text and a photo, so a
      // family that checks CONTENT (I2) has something recognisable to compare.
      // Every other entry keeps the original default.
      const observation = entry.observation || 'OK - as per standard';
      await checklist.fillAllObservations(observation, true);
      let photos = null;
      if (entry.attachPhoto) {
        const attach = await checklist.attachPhotoToFirstItem();
        expect(
          attach.imagesAfter,
          `${entry.key}: the photo did not attach (images ${attach.imagesBefore} -> ${attach.imagesAfter})`
        ).toBeGreaterThan(attach.imagesBefore);
        photos = attach.imagesAfter;
      }
      await checklist.submitRFI();

      // confirmSubmit already waited for /rfi/<id>/view, the only reliable
      // completion signal for a create — so reaching here means it landed.
      const match = page.url().match(/\/rfi\/([a-f0-9-]+)\/view/i);
      expect(match, `could not read an RFI id from the post-submit URL: ${page.url()}`).toBeTruthy();

      // getVisibleCodeFor, NOT checklist.getVisibleCode(): read straight off the
      // post-submit view, the breadcrumb can still say
      // "RFI-A-06c-BL07-CIV-DRAFT" — the code is assigned server-side a moment
      // later. That is the DRAFT race smoke-rfi-turns and rfi-flow-turns both
      // document, and it bit four of the first seven records here on
      // 2026-09-20. Going through the dashboard first is what actually clears
      // the stale state and forces a full refresh.
      const code = await getVisibleCodeFor(page, match[1]);
      expect(code, 'the RFI view must show a visible code to address the record by').toBeTruthy();
      expect(
        code,
        `${entry.key} read back as a DRAFT placeholder (${code}) — the record exists ` +
        `(${match[1]}) but has no addressable code yet. Re-run this setup: it repairs ` +
        `DRAFT-coded entries in place rather than raising a duplicate.`
      ).not.toMatch(/DRAFT/i);

      const saved = recordRecord('rfi', entry.key, {
        id: match[1],
        code,
        purpose: entry.purpose,
        mutated: entry.mutated,
        ground: GROUND,
        workSections: workSections || null,
        ...(entry.observation ? { observation } : {}),
        ...(photos != null ? { photos } : {}),
        createdBy: { key: RFI_CREATOR, name: creator.name, email: creator.email },
      });

      built.push(saved);
      console.log(`  ${entry.key}: ${code} (${match[1]})`);
    } catch (err) {
      const msg = String(err.message || err).split(/\r?\n/)[0];
      failed.push({ key: entry.key, error: msg });
      console.log(`  ${entry.key}: FAILED — ${msg}`);
      // Keep going: one exhausted Work Section must not cost the whole pool.
    }
  }

  expect(
    built.length + skipped.length,
    `No RFI could be raised on ${GROUND.workArea}. Failures: ` +
    JSON.stringify(failed.map((f) => `${f.key}: ${f.error}`), null, 2)
  ).toBeGreaterThan(0);
});
