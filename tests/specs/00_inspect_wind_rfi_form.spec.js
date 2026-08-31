const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const MyTasksPage = require('../pages/MyTasksPage');
const RFICreatePage = require('../pages/RFICreatePage');
const { loginAsFlowUser, stripLabelPrefix } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const { WIND_E2E } = require('../config/projects');

// Recon pass #2 for wind. Logs in as the WTG Contractor Incharge created and
// WAM'd by the smoke chain (stages 1-3) and ENUMERATES the RFI create form.
//
// Answers the six questions docs/wind-activity-checklist-reference.md lists as
// still open, all of which need this form and could not be answered from the
// spreadsheet or from SO Mapping:
//
//   Q3  Are the checklist-less Pre-Activity / Post-Activity checkpoints even
//       offered in the Inspection Checkpoint dropdown? 68 of 144 sheet rows are
//       these bookends, and they sit at the start and end of every chain.
//   Q4  How does the dropdown disambiguate the repeated "Routine Inspection"
//       name? Seven activities reuse it (A1.4 x5, A1.14 x5, A1.15 x5, A1.17 x4,
//       A1.16 x3, A1.5 x2, A1.8 x2), differing only by Sub-Activity.
//   Q6  What IS a wind Work Section, given uniform "Per WTG" granularity? One
//       per Work Area (solar's "Block" case -> two-Work-Areas strategy) or many
//       (solar's "Per Table" case -> throwaway-Work-Section strategy)?
//   Q9  Which column feeds the Inspection Checklist dropdown — Checklist Name
//       or Checklist Document — and is any code prefix stripped?
//
// (Q5 "is Optional=Y real / is the dependency enforced" and Q7 "does the
// Work-Section-consumption bug apply" both require actually SUBMITTING RFIs,
// so they are out of scope here and belong to the dependency spec.)
//
// STRICTLY NON-MUTATING, and one rule matters more than the rest: it NEVER
// selects a Work Section. Per docs/rfi-activity-dependency-chain.md, merely
// SELECTING a Work Section — without ever submitting — permanently consumes
// that (checkpoint, Work Section) pair. So Work Sections are only ever COUNTED
// and read, never clicked. The form is abandoned via Cancel at the end.
const OUT_DIR = path.join(__dirname, '..', 'fixtures', 'so-mapping-baseline');
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// The RFI form renders Activity and Sub-Activity with a position prefix
// ("1. Crane Pad", "1.3 Boulder laying", and inconsistently "1. 2 Stone Column
// Work") while the activity master has neither the prefix nor the same casing
// ("Crane Pad", "Boulder Laying"). Comparing raw strings matched nothing — the
// first run of this spec reported "sheet says (0 rows)" for an activity that has
// five. Delegates to helpers.js's stripLabelPrefix, which is the single
// canonical implementation and documents every prefix form seen live.
const normalizeFormLabel = stripLabelPrefix;

// Read straight off the extracted activity master so the comparison is against
// the real sheet rather than a hand-copied list.
function sheetCheckpointsFor(activity) {
  const rows = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'fixtures', 'wind-activity-checklist.json'), 'utf-8'));
  const wanted = normalizeFormLabel(activity).toLowerCase();
  return rows
    .filter(r => r.activity.trim().toLowerCase() === wanted)
    .map(r => ({
      code: r.code, checkpoint: r.checkpoint, subActivity: r.subActivity,
      checklist: r.checklist, checklistDoc: r.checklistDoc, preceding: r.preceding,
    }));
}

// Opens a dropdown, reads every option, closes it WITHOUT selecting.
async function readOptions(rfi, dropdown, label) {
  const listbox = await rfi._openDropdown(dropdown);
  const texts = (await listbox.locator('[role="option"]').allInnerTexts())
    .map(t => t.replace(/\s*✓\s*$/, '').trim()).filter(Boolean);
  await rfi.closeAnyOpenListbox();
  console.log(`  ${label} (${texts.length}): ${JSON.stringify(texts.slice(0, 25))}` +
    (texts.length > 25 ? ` ...+${texts.length - 25} more` : ''));
  return texts;
}

test('WIND RFI create form - checkpoints, checklists, work sections', async ({ page }) => {
  // The config's 10-minute default is not enough here: a Contractor Incharge
  // login alone can take 5-6 minutes (first-time PWA install spinner), and
  // this then walks every sub-activity x checkpoint combination, opening three
  // dropdowns per checkpoint. 30 minutes so a slow login can't truncate the
  // enumeration half way and leave the answers ambiguous.
  test.setTimeout(1_800_000);

  const ci = loadLastCreatedUsers()[WIND_E2E.users.prefixes.CI];
  expect(ci && ci.profileKey === WIND_E2E.key,
    'No WTG Contractor Incharge recorded — run the smoke-wind-users/so/wam stages first.'
  ).toBeTruthy();
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

  const report = {
    baseUrl: process.env.BASE_URL,
    loggedInAs: { name: ci.name, email: ci.email, role: ci.role },
    workLocation: WIND_E2E.workLocations[0],
    workArea: WIND_E2E.primaryWorkArea,
    package: WIND_E2E.packages[0],
    cascade: {},
    activities: {},
  };

  try {
    console.log(`\n  Logging in as WTG CI "${ci.name}" <${ci.email}> ` +
      `(PWA-spinner role — this can take several minutes)\n`);
    await loginAsFlowUser(page, ci.email, PASSWORD);

    const myTasks = new MyTasksPage(page);
    await myTasks.waitForLoad();
    await myTasks.clickCreateRFI();

    const rfi = new RFICreatePage(page);

    // ---- Cascade down to Activity, recording each level's options ----
    report.cascade.workLocations = await readOptions(rfi, rfi.workLocationDropdown, 'Work Location');
    await rfi.selectOption(rfi.workLocationDropdown, report.workLocation);

    report.cascade.workAreas = await readOptions(rfi, rfi.workAreaDropdown, 'Work Area');
    await rfi.selectOption(rfi.workAreaDropdown, report.workArea);

    report.cascade.packages = await readOptions(rfi, rfi.packageDropdown, 'Package');
    await rfi.selectOption(rfi.packageDropdown, report.package);

    report.cascade.subPackages = await readOptions(rfi, rfi.subPackageDropdown, 'Sub-Package');

    // Probe targets, chosen to answer specific questions rather than to sweep
    // everything (WTG Foundation alone is 11 activities x ~5 sub-activities,
    // which would be hundreds of dropdown opens):
    //
    //  - Crane Pad / Crane Pad: the smallest activity (5 rows), unique
    //    checkpoint names. Establishes the baseline shape. Already run once.
    //  - WTG Foundation / Blanket Layer/GSB Layer: the Q4 ambiguity case — the
    //    sheet gives it FIVE rows all named "Routine Inspection", differing
    //    only by Sub-Activity (Blanket/GSB Layer 1..5). If the checkpoint
    //    dropdown really is scoped per Sub-Activity, each of the five
    //    sub-activities should offer exactly one "Routine Inspection" and
    //    there is no ambiguity to resolve. This is the direct test of that.
    //
    // Activity/Sub-Activity names carry numeric prefixes live, so targets are
    // matched with normalizeFormLabel rather than by exact string.
    const PROBE_TARGETS = [
      { subPackage: 'WTG Foundation', activity: 'Blanket Layer/GSB Layer' },
      { subPackage: 'Crane Pad', activity: 'Crane Pad' },
    ];

    for (const target of PROBE_TARGETS) {
      const subPackage = report.cascade.subPackages.find(
        sp => normalizeFormLabel(sp).toLowerCase() === target.subPackage.toLowerCase());
      if (!subPackage) {
        console.log(`\n  (skipping ${target.subPackage} — not offered to this user)`);
        continue;
      }
      await rfi.selectOption(rfi.subPackageDropdown, subPackage);
      await page.waitForTimeout(800);

      const activities = await readOptions(
        rfi, rfi.activityDropdown, `Activity (sub-package "${subPackage}")`);
      report.cascade[`activities:${subPackage}`] = activities;

      const activity = activities.find(
        a => normalizeFormLabel(a).toLowerCase() === target.activity.toLowerCase());
      if (!activity) {
        console.log(`  (skipping activity ${target.activity} — not in "${subPackage}": ` +
          `${JSON.stringify(activities.map(normalizeFormLabel))})`);
        continue;
      }

      console.log(`\n  ===== Activity: ${activity} (sub-package "${subPackage}") =====`);
      await rfi.selectOption(rfi.activityDropdown, activity);

      const subActivities = await readOptions(rfi, rfi.subActivityDropdown, 'Sub-Activity');
      const entry = { subActivities, sheet: sheetCheckpointsFor(activity), checkpoints: {} };

      console.log(`  --- sheet says (${entry.sheet.length} rows) ---`);
      for (const r of entry.sheet) {
        console.log(`      ${r.code}  ${r.checkpoint}  [sub-act: ${r.subActivity}]  chk: ${r.checklist}`);
      }

      // Walk EVERY sub-activity: the sheet's repeated "Routine Inspection"
      // rows differ only by Sub-Activity, so if the app scopes checkpoints by
      // Sub-Activity, that is where the disambiguation shows up.
      for (const subActivity of subActivities) {
        await rfi.selectOption(rfi.subActivityDropdown, subActivity);
        const checkpoints = await readOptions(
          rfi, rfi.inspectionCheckpointDropdown, `  Checkpoints for sub-activity "${subActivity}"`);

        const perCheckpoint = {};
        for (const cp of checkpoints) {
          await rfi.selectOption(rfi.inspectionCheckpointDropdown, cp);
          let checklists = [];
          let checklistError = null;
          try {
            checklists = await readOptions(
              rfi, rfi.inspectionChecklistDropdown, `      Checklists for "${cp}"`);
          } catch (err) {
            // Expected for the checklist-less Pre/Post-Activity bookends —
            // capture rather than fail, that IS the finding (Q3).
            checklistError = String(err.message || err).split('\n')[0];
            console.log(`      Checklists for "${cp}": DROPDOWN UNAVAILABLE — ${checklistError}`);
            await rfi.closeAnyOpenListbox().catch(() => {});
          }

          // Work Sections: COUNT ONLY, never click one (see header comment).
          let workSectionCount = null;
          let workSectionSample = [];
          try {
            const listbox = await rfi._openDropdown(rfi.workSectionToggle);
            const texts = (await listbox.locator('[role="option"]').allInnerTexts())
              .map(t => t.replace(/\s*✓\s*$/, '').trim()).filter(Boolean);
            workSectionCount = texts.length;
            workSectionSample = texts.slice(0, 8);
            await rfi.closeAnyOpenListbox();
            console.log(`      Work Sections for "${cp}": ${workSectionCount} ` +
              `-> ${JSON.stringify(workSectionSample)}`);
          } catch (err) {
            console.log(`      Work Sections for "${cp}": unavailable — ` +
              String(err.message || err).split('\n')[0]);
            await rfi.closeAnyOpenListbox().catch(() => {});
          }

          perCheckpoint[cp] = {
            checklists, checklistError, workSectionCount, workSectionSample,
          };
        }
        entry.checkpoints[subActivity] = perCheckpoint;
      }

      report.activities[activity] = entry;
    }

    // ---- Summarise the answers ----
    console.log('\n\n  ================ ANSWERS ================');
    for (const [activity, entry] of Object.entries(report.activities)) {
      console.log(`\n  ${activity}:`);
      const allLive = new Set();
      for (const per of Object.values(entry.checkpoints)) {
        Object.keys(per).forEach(cp => allLive.add(cp));
      }
      // Sub-Activity comparison too — the sheet's rows are 1:1 with
      // (Sub-Activity, Checkpoint) pairs, so a mismatch here means the app and
      // the sheet disagree about the activity's breakdown.
      const liveSubActs = entry.subActivities.map(s => normalizeFormLabel(s).toLowerCase());
      const sheetSubActs = entry.sheet.map(r => r.subActivity.trim().toLowerCase());
      console.log(`    sub-activities: live ${liveSubActs.length} vs sheet ${sheetSubActs.length}`);
      console.log(`      in sheet not live: ${JSON.stringify(sheetSubActs.filter(s => !liveSubActs.includes(s)))}`);
      console.log(`      live not in sheet: ${JSON.stringify(liveSubActs.filter(s => !sheetSubActs.includes(s)))}`);

      // Checklist name the app offers vs the one the sheet records, per
      // (sub-activity, checkpoint) pair — this is how the Crane Pad
      // "GSB Inspection Checklist" vs sheet "GSB Laying Checklist"
      // discrepancy was found, so make it a reported comparison, not a
      // manual eyeball.
      for (const [subActivity, per] of Object.entries(entry.checkpoints)) {
        const subKey = normalizeFormLabel(subActivity).toLowerCase();
        for (const [cp, data] of Object.entries(per)) {
          const sheetRow = entry.sheet.find(
            r => r.subActivity.trim().toLowerCase() === subKey && r.checkpoint === cp);
          if (!sheetRow) {
            console.log(`      MISMATCH: live [${subActivity}]/"${cp}" has no sheet row`);
            continue;
          }
          const live = data.checklists[0] || null;
          const sheetChk = sheetRow.checklist === '-' ? null : sheetRow.checklist;
          if (live !== sheetChk) {
            console.log(`      CHECKLIST DIFF ${sheetRow.code} [${subActivity}]/"${cp}": ` +
              `app="${live}" sheet="${sheetChk}"`);
          }
        }
      }

      const sheetCps = new Set(entry.sheet.map(r => r.checkpoint));
      const bookends = entry.sheet
        .filter(r => /^(Pre|Post)-Activity Checkpoint$/.test(r.checkpoint))
        .map(r => r.checkpoint);

      console.log(`    live checkpoint names: ${JSON.stringify([...allLive])}`);
      console.log(`    Q3 bookends offered?   ${bookends.filter(b => allLive.has(b)).length}/` +
        `${new Set(bookends).size} of ${JSON.stringify([...new Set(bookends)])}`);
      console.log(`    in sheet not live:     ${JSON.stringify([...sheetCps].filter(c => !allLive.has(c)))}`);
      console.log(`    live not in sheet:     ${JSON.stringify([...allLive].filter(c => !sheetCps.has(c)))}`);

      for (const [subActivity, per] of Object.entries(entry.checkpoints)) {
        for (const [cp, data] of Object.entries(per)) {
          console.log(`    [${subActivity}] "${cp}": ` +
            `${data.checklists.length} checklist option(s)` +
            `${data.checklistError ? ' (ERROR)' : ''}, ` +
            `${data.workSectionCount} work section(s)`);
        }
      }
    }
  } finally {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    const dst = path.join(OUT_DIR, 'wind-rfi-form-recon.json');
    fs.writeFileSync(dst, JSON.stringify(report, null, 2));
    console.log(`\n  [saved] ${path.relative(path.join(__dirname, '..', '..'), dst)}`);

    // Abandon the form. Cancel + confirm the discard popup, per the app
    // owner's guidance recorded in docs/rfi-activity-dependency-chain.md —
    // best-effort, since nothing here selected a Work Section so there should
    // be nothing held anyway.
    const cancel = page.getByRole('button', { name: 'Cancel' });
    if (await cancel.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cancel.click().catch(() => {});
      const confirm = page.locator('[role="dialog"]')
        .getByRole('button', { name: /yes|confirm|discard|ok/i }).first();
      if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) {
        await confirm.click().catch(() => {});
      }
    }
  }
});
