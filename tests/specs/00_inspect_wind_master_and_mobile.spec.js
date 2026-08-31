const { test, expect, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const SOMappingPage = require('../pages/SOMappingPage');
const DashboardPage = require('../pages/DashboardPage');
const { adminFreshLogin } = require('../utils/helpers');

// Read-only recon for the WTG/wind inclusion work. Answers, in ONE run, the
// questions that would otherwise be guesses baked into the new profile
// config (tests/config/) and the mobile page objects:
//
//   Test 1 (desktop): the WIND master data as the APP actually reports it —
//     Project Type options, the exact Work Location string (screenshot says
//     "WTG-Khavda", the brief said "WTG-Khavada"), the Work Area list under
//     it, the Package list, and every Package's activity rows + their
//     CURRENT Service Order values. The activity names are diffed against
//     tests/fixtures/wind-activity-checklist.json so we learn immediately
//     whether the Draft sheet (23.04.26) matches the deployed master.
//
//   Test 2 (mobile viewport): whether the smartphone UI is the same app
//     reflowing at a narrow viewport or a different shell — which decides
//     whether Mobile* page objects are thin overrides or a parallel tree.
//
// NEVER clicks Save and never submits anything. Selecting a Work Area in SO
// Mapping is not the RFI "selecting a Work Section consumes it" bug (that is
// RFI-create-side, per docs/rfi-activity-dependency-chain.md) — nothing here
// mutates app state.
//
// NOTE: the RFI-side wind questions (are the checklist-less Pre-Activity /
// Post-Activity checkpoints raisable, how the repeated "Routine Inspection"
// name disambiguates, Work Section granularity per WTG) CANNOT be answered
// here — the RFI create form needs a WIND CI who is SO-mapped and WAM'd, and
// no such user exists yet. Those need a second recon pass after
// user-creation -> SO mapping -> WAM.

const OUT_DIR = path.join(__dirname, '..', '..', 'test-results', 'wind-recon');

function writeOut(name, data) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  console.log(`  [saved] ${path.relative(path.join(__dirname, '..', '..'), file)}`);
}

// Opens a dropdown, reads every option's text, closes it again without
// selecting. Uses BasePage.openDropdown so it inherits the same
// transform/positioner waiting the rest of the suite relies on.
async function listOptions(pageObject, dropdown, label) {
  const listbox = await pageObject.openDropdown(dropdown);
  const texts = (await listbox.locator('[role="option"]').allInnerTexts())
    .map(t => t.replace(/\s*✓\s*$/, '').trim())
    .filter(Boolean);
  await pageObject.closeAnyOpenListbox();
  console.log(`  ${label} (${texts.length}): ${JSON.stringify(texts)}`);
  return texts;
}

test.describe('Recon - WIND master data + mobile shell', () => {

  test('WIND master data as reported by SO Mapping', async ({ browser }) => {
    const { context, page, dashboard } = await adminFreshLogin(browser);
    const report = { baseUrl: process.env.BASE_URL };

    try {
      const so = new SOMappingPage(page);
      await so.goto(dashboard);

      // ---- Cluster / Site ----
      report.clusterOptions = await listOptions(so, so.clusterDropdown, 'Cluster');
      await so.selectDropdownOptionAny(so.clusterDropdown, ['Gujarat', 'Khavda']);
      report.siteOptions = await listOptions(so, so.siteDropdown, 'Site');
      await so.selectDropdownOption(so.siteDropdown, 'Khavda');

      // ---- Project Type: confirm WIND exists and its exact casing ----
      report.projectTypeOptions = await listOptions(so, so.projectTypeDropdown, 'Project Type');
      const windOption = report.projectTypeOptions.find(t => /wind/i.test(t));
      expect(windOption, 'A WIND project type must exist in SO Mapping').toBeTruthy();
      report.windProjectType = windOption;
      await so.selectDropdownOption(so.projectTypeDropdown, windOption);

      // ---- Work Location: the exact string ("WTG-Khavda" vs "WTG-Khavada") ----
      report.windWorkLocations = await listOptions(so, so.workLocationDropdown, 'Work Location (WIND)');
      const wtgLocation = report.windWorkLocations.find(t => /wtg/i.test(t));
      expect(wtgLocation, 'A WTG-* Work Location must exist under WIND').toBeTruthy();
      report.wtgWorkLocation = wtgLocation;
      console.log(`\n  >>> EXACT Work Location string: "${wtgLocation}"\n`);
      await so.selectDropdownOption(so.workLocationDropdown, wtgLocation);

      // ---- Work Areas under it (are they per-WTG? how many?) ----
      report.windWorkAreas = await listOptions(so, so.workAreaDropdown, 'Work Area (WIND)');

      // Pick KH34 if present (the one in the brief's screenshot), else the first.
      const targetArea = report.windWorkAreas.find(a => a.trim() === 'KH34')
        || report.windWorkAreas[0];
      report.workAreaInspected = targetArea;
      await so.selectWorkAreas([targetArea]);

      // ---- Packages, and every package's activity rows + current SO ----
      report.windPackages = await listOptions(so, so.packageDropdown, 'Package (WIND)');
      report.packages = {};

      for (const pkg of report.windPackages) {
        await so.selectDropdownOption(so.packageDropdown, pkg);
        await page.waitForTimeout(1500);

        // Activity name lives in a <p> inside each activity's div.d_grid row
        // (see SOMappingPage header comment on the empty-label problem).
        const rows = page.locator('div.d_grid').filter({ has: page.locator('[role="combobox"]') });
        const count = await rows.count();
        const activities = [];
        for (let i = 0; i < count; i++) {
          const row = rows.nth(i);
          const name = (await row.locator('p').first().innerText().catch(() => '')).trim();
          const currentSo = (await row.locator('[role="combobox"]').first().innerText().catch(() => '')).trim();
          if (name) activities.push({ name, currentServiceOrder: currentSo });
        }
        report.packages[pkg] = activities;
        console.log(`\n  Package "${pkg}" — ${activities.length} activity rows:`);
        for (const a of activities) console.log(`    ${a.name}  ->  ${a.currentServiceOrder}`);
      }

      // ---- Diff the live activity names against the extracted Draft sheet ----
      const sheet = JSON.parse(fs.readFileSync(
        path.join(__dirname, '..', 'fixtures', 'wind-activity-checklist.json'), 'utf-8'));
      const sheetActivities = [...new Set(sheet.map(r => r.activity))];
      const liveActivities = [...new Set(
        Object.values(report.packages).flat().map(a => a.name.replace(/^\d+\.\s*/, '').trim())
      )];

      report.activityDiff = {
        liveCount: liveActivities.length,
        sheetCount: sheetActivities.length,
        inSheetNotLive: sheetActivities.filter(a => !liveActivities.includes(a)),
        inLiveNotSheet: liveActivities.filter(a => !sheetActivities.includes(a)),
      };
      console.log('\n  === Activity name diff (live SO Mapping vs Draft sheet 23.04.26) ===');
      console.log(`  live: ${liveActivities.length}   sheet: ${sheetActivities.length}`);
      console.log(`  in sheet but NOT live (${report.activityDiff.inSheetNotLive.length}): ${JSON.stringify(report.activityDiff.inSheetNotLive)}`);
      console.log(`  live but NOT in sheet (${report.activityDiff.inLiveNotSheet.length}): ${JSON.stringify(report.activityDiff.inLiveNotSheet)}`);

      // ---- Vendor options available on one activity row (is BAUER there?) ----
      const firstPkg = report.windPackages[0];
      await so.selectDropdownOption(so.packageDropdown, firstPkg);
      await page.waitForTimeout(1500);
      const firstRowCombo = page.locator('div.d_grid')
        .filter({ has: page.locator('[role="combobox"]') }).first()
        .locator('[role="combobox"]').first();
      report.serviceOrderOptions = await listOptions(so, firstRowCombo, 'Service Order options');
      report.bauerOption = report.serviceOrderOptions.find(o => /bauer/i.test(o)) || null;
      console.log(`\n  >>> BAUER service order option: ${JSON.stringify(report.bauerOption)}\n`);

      await page.screenshot({ path: path.join(OUT_DIR, 'so-mapping-wind-desktop.png'), fullPage: true });
      writeOut('wind-master-data.json', report);
    } finally {
      writeOut('wind-master-data-partial.json', report);
      await context.close();
    }
  });

  test('Mobile shell - same app reflowed, or a different shell?', async ({ browser }) => {
    // `defaultBrowserType` is part of Playwright's device descriptor but is
    // not a browser.newContext() option — strip it, keep viewport/UA/
    // deviceScaleFactor/isMobile/hasTouch.
    const { defaultBrowserType, ...device } = devices['Pixel 7'];
    const report = { device: { ...device }, baseUrl: process.env.BASE_URL };

    // Desktop baseline first, in its own context, so the two DOMs are
    // captured from the same login flow and can be diffed directly.
    const desktop = await adminFreshLogin(browser);
    try {
      report.desktop = await captureShell(desktop.page, 'desktop');
      await desktop.page.screenshot({ path: path.join(OUT_DIR, 'dashboard-desktop.png'), fullPage: true });
    } finally {
      await desktop.context.close();
    }

    // Same BASE_URL, same credentials, mobile device descriptor.
    const mobile = await adminFreshLogin(browser, { ...device });
    try {
      report.mobile = await captureShell(mobile.page, 'mobile');
      await mobile.page.screenshot({ path: path.join(OUT_DIR, 'dashboard-mobile.png'), fullPage: true });

      // Do the desktop sidebar locators still resolve on mobile? This is the
      // single most useful signal: if they do, Mobile* page objects are thin
      // overrides; if none do, it's a separate shell.
      const dash = new DashboardPage(mobile.page);
      const navChecks = {};
      for (const key of Object.keys(dash)) {
        if (!/^nav/.test(key)) continue;
        const loc = dash[key];
        if (!loc || typeof loc.count !== 'function') continue;
        navChecks[key] = {
          count: await loc.count().catch(() => -1),
          visible: await loc.first().isVisible().catch(() => false),
        };
      }
      report.mobile.desktopNavLocators = navChecks;
      console.log('\n  === Desktop DashboardPage nav locators, evaluated on MOBILE ===');
      for (const [k, v] of Object.entries(navChecks)) {
        console.log(`    ${k}: count=${v.count} visible=${v.visible}`);
      }
    } finally {
      await mobile.context.close();
    }

    report.verdict = {
      sameUserAgentMarkup: report.desktop.bodyClasses === report.mobile.bodyClasses,
      desktopNavResolvesOnMobile: Object.values(report.mobile.desktopNavLocators || {})
        .some(v => v.visible),
    };
    console.log(`\n  === VERDICT ===\n  ${JSON.stringify(report.verdict, null, 2)}\n`);
    writeOut('mobile-shell.json', report);
  });
});

// Structural fingerprint of whatever shell rendered — enough to tell "same
// app, CSS reflow" from "different markup" without dumping whole pages.
async function captureShell(page, label) {
  const shell = await page.evaluate(() => {
    const vis = el => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    return {
      url: location.href,
      userAgent: navigator.userAgent,
      viewport: { w: window.innerWidth, h: window.innerHeight, dpr: window.devicePixelRatio },
      bodyClasses: document.body.className,
      htmlDataAttrs: Object.fromEntries(
        [...document.documentElement.attributes].map(a => [a.name, a.value])),
      // Nav/menu candidates — a hamburger or bottom tab bar would show here.
      buttonsWithoutText: [...document.querySelectorAll('button')]
        .filter(b => vis(b) && !b.innerText.trim()).length,
      visibleButtonLabels: [...document.querySelectorAll('button')]
        .filter(vis).map(b => b.innerText.trim() || `[icon:${b.getAttribute('aria-label') || '?'}]`)
        .slice(0, 40),
      visibleLinkLabels: [...document.querySelectorAll('a')]
        .filter(vis).map(a => a.innerText.trim()).filter(Boolean).slice(0, 40),
      roleCounts: ['navigation', 'dialog', 'combobox', 'grid', 'row', 'tablist', 'menu']
        .reduce((acc, r) => {
          acc[r] = document.querySelectorAll(`[role="${r}"]`).length;
          return acc;
        }, {}),
      totalElements: document.querySelectorAll('*').length,
    };
  });
  console.log(`\n  === ${label.toUpperCase()} shell ===`);
  console.log(`    viewport: ${JSON.stringify(shell.viewport)}`);
  console.log(`    body.class: "${shell.bodyClasses}"`);
  console.log(`    roles: ${JSON.stringify(shell.roleCounts)}`);
  console.log(`    elements: ${shell.totalElements}, icon-only buttons: ${shell.buttonsWithoutText}`);
  console.log(`    visible buttons: ${JSON.stringify(shell.visibleButtonLabels)}`);
  console.log(`    visible links:   ${JSON.stringify(shell.visibleLinkLabels)}`);
  return shell;
}
