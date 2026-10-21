const { test } = require('@playwright/test');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper, openCombobox, visibleOptions } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DrsSoConfigPage = require('../pages/DrsSoConfigPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 26. READ-ONLY, ENFORCED (write guard).
// SO Configuration → "Bulk edit" (app owner, 2026-10-21): select groups of cells
// (a row, a column, single cells) and map / remove an SO at once. What does the
// DOM look like, what does a row / column checkbox select, how is the selection
// counted, and where is the SO picked? Nothing is applied or saved.
// Run: REF_TAG=20102026-OB3 npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round26_so_config_bulk_edit.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round26');

test('SO Configuration bulk edit: structure and selection', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const run = state.envRecord(ENV.key).projects.find((p) => p.tag === (process.env.REF_TAG || '20102026-OB3'));
  const blocked = [];
  const context = await browser.newContext({ viewport: { width: 1900, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  const dump = makeDumper(page, OUT, { screens: [] });
  const soc = new DrsSoConfigPage(page, ENV.baseUrl);
  const version = Object.values(run.areaVersions).pop();
  const areas = Object.entries(run.areaVersions).filter(([, v]) => v === version).map(([a]) => a);
  console.log(`  ${run.name} / ${version} / ${areas.join(', ')} / Civil`);
  await soc.open(run.id, { workLocation: run.workLocation, version, workAreas: areas, pkg: 'Civil' });
  await dump('single-edit');

  await page.getByRole('radio', { name: 'Bulk edit' }).click({ force: true });
  await page.waitForTimeout(1500);
  await dump('bulk-edit-off');
  const boxes = page.getByRole('checkbox');
  console.log('  checkboxes in bulk mode:', await boxes.count());
  console.log('  checkbox names (first 12):', await boxes.evaluateAll((bs) => bs.slice(0, 12).map((b) => b.getAttribute('aria-label') || (b.closest('label') || b.parentElement).textContent.trim().slice(0, 60))));
  const html = await page.locator('main').first().evaluate((m) => {
    const head = [...m.querySelectorAll('*')].find((e) => e.textContent.trim() === 'Road' + '' ? false : /^Road\d+$/.test(e.textContent.trim()));
    const cell = [...m.querySelectorAll('[role="checkbox"], input[type="checkbox"]')][3];
    return { header: head && head.parentElement && head.parentElement.outerHTML.slice(0, 1200), cell: cell && cell.closest('div').parentElement.outerHTML.slice(0, 1500) };
  }).catch((e) => ({ err: e.message }));
  console.log('  header html:', html.header);
  console.log('  cell html:', html.cell);

  const selectedText = async () => (await page.getByText(/cells? selected/i).first().innerText().catch(() => '(none)')).trim();
  // Every checkbox of the page with the text that follows it, in DOM order.
  const map = async () => page.evaluate(() => {
    const boxes = [...document.querySelectorAll('input[type="checkbox"], [role="checkbox"]')];
    const all = [...document.querySelectorAll('*')];
    return boxes.map((b, i) => {
      const at = all.indexOf(b);
      const p = all.slice(at + 1).find((e) => e.tagName === 'P');
      return { i, text: p ? p.textContent.trim() : '', checked: b.checked || b.getAttribute('aria-checked') === 'true' || b.getAttribute('data-state') === 'checked' };
    });
  });
  const m0 = await map();
  console.log('PROBE checkbox map (first 30): ' + JSON.stringify(m0.slice(0, 30).map((x) => x.i + ':' + x.text.slice(0, 30))));
  const boxBefore = (label, nth = 0) => {
    const hits = m0.filter((x) => x.text === label);
    return page.locator('input[type="checkbox"], [role="checkbox"]').nth(hits[nth].i);
  };
  const road = areas.find((a) => /^Road/.test(a));
  await boxBefore(road).click({ force: true }); await page.waitForTimeout(800);
  console.log('PROBE after column ' + road + ': ' + await selectedText());
  await dump('bulk-column');
  const bar = await page.getByText(/cells? selected/i).first().locator('xpath=ancestor::*[.//button][1]').evaluate((e) => e.outerHTML.slice(0, 2500)).catch((e) => e.message);
  console.log('PROBE bar html: ' + bar);
  await boxBefore(road).click({ force: true }); await page.waitForTimeout(600);
  console.log('PROBE after un-ticking column: ' + await selectedText());
  await boxBefore('Drain Work').click({ force: true }); await page.waitForTimeout(800);
  console.log('PROBE after row Drain Work: ' + await selectedText());
  await dump('bulk-row');
  const pick = page.getByPlaceholder(/Select SO to assign/i).first();
  console.log('PROBE assign picker visible: ' + await pick.isVisible().catch(() => false) + ' role=' + await pick.getAttribute('role').catch(() => null));
  await openCombobox(page, pick); console.log('PROBE assign options: ' + JSON.stringify(await visibleOptions(page)));
  await page.keyboard.press('Escape').catch(() => {});
  console.log('PROBE buttons: ' + JSON.stringify(await page.getByRole('button').evaluateAll((bs) => [...new Set(bs.map((b) => (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 40)))].filter(Boolean))));
  await page.getByRole('checkbox', { name: 'Select all cells' }).click({ force: true }); await page.waitForTimeout(800);
  console.log('PROBE after Select all cells: ' + await selectedText());
  await dump('bulk-all');
  console.log('  blocked writes:', blocked);
  await context.close();
});
