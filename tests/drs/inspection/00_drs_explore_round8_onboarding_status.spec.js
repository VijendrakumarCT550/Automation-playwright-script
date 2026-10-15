const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');

// ===========================================================================
// DRS EXPLORATION - ROUND 8. READ-ONLY, ENFORCED.
// 2026-10-01: project AUTO-Solar-01102026-TGB finished D4-D9 but never reached
// pulse-uat (IN01 sees no AUTO-WL-01102026-TGB for ~2 h), while earlier projects
// synced within minutes. The DRS project list has an "Onboarding" column - a
// warning triangle on some rows, a green tick on others. This reads that column
// for every AUTO-Solar-* project and for a known-synced reference, so we can see
// whether "onboarding complete" is what separates synced from unsynced.
// Never clicks "Open onboarding" or anything else (the write guard aborts writes).
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round8_onboarding_status.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round8');

let context, page, dump;
const blocked = [];
const summary = { screens: [], findings: {} };

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  if (context) await context.close();
});

test('onboarding status of our AUTO-Solar projects', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  page = await context.newPage();
  dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  await page.getByRole('textbox', { name: 'Search' }).fill('AUTO-Solar');
  await page.waitForTimeout(2500);
  await dump('auto-solar-projects');

  // For each project row: its name and what the Onboarding cell shows. The cell
  // holds an icon (no text), so report its SVG's colour/class and any tooltip.
  const rows = await page.evaluate(() => {
    const grid = document.querySelector('[role="grid"]');
    if (!grid) return [];
    const headers = [...grid.querySelectorAll('[role="columnheader"]')].map((h) => h.innerText.trim());
    const onboardingIdx = headers.findIndex((h) => /onboarding/i.test(h));
    const nameIdx = headers.findIndex((h) => /project name/i.test(h));
    return [...grid.querySelectorAll('[role="row"]')].slice(1).map((r) => {
      const cells = [...r.querySelectorAll('[role="gridcell"]')];
      const cell = cells[onboardingIdx];
      const svg = cell && cell.querySelector('svg');
      const btn = cell && cell.querySelector('button');
      return {
        name: (cells[nameIdx] || {}).innerText && cells[nameIdx].innerText.trim(),
        onboardingText: cell ? cell.innerText.trim() : null,
        buttonLabel: btn ? (btn.getAttribute('aria-label') || btn.innerText || '').trim() : null,
        svgColour: svg ? (getComputedStyle(svg).color + ' | fill=' + (svg.getAttribute('fill') || '') + ' | stroke=' + (svg.getAttribute('stroke') || '')) : null,
        svgClass: svg ? (svg.getAttribute('class') || '') : null,
        cellTitle: cell ? (cell.querySelector('[title]') ? cell.querySelector('[title]').getAttribute('title') : '') : null,
      };
    });
  });
  summary.findings.rows = rows;
  for (const r of rows) console.log(`  ${String(r.name).padEnd(34)} onboarding: text="${r.onboardingText}" button="${r.buttonLabel}" svg=${r.svgColour}`);
  console.log(`  ${rows.length} AUTO-Solar project(s) listed`);
});
