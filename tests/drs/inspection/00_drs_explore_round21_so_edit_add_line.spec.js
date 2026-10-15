const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DrsServiceOrderPage = require('../pages/DrsServiceOrderPage');

// ===========================================================================
// DRS EXPLORATION — ROUND 21. READ-ONLY, ENFORCED.
// Before bringing a new catalog version onto an EXISTING project (app owner,
// 2026-10-15: any Work Area with no records can take a new version - no new project
// needed): can lines be ADDED to an existing SO? Opens the Civil SO's Edit form on
// DRS_PROJECT_TAG's project, reads its line blocks and buttons, clicks "Add Line"
// if offered and reads the new block. Never saves (write guard).
// Run: DRS_PROJECT_TAG=15102026-RHY npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round21_so_edit_add_line.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round21');
const blocked = [];
const summary = { screens: [], findings: {} };

test('SO edit: can a line be added?', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const run = state.envRecord(ENV.key).projects.find((p) => p.tag === process.env.DRS_PROJECT_TAG);
  const so = (run.serviceOrders && run.serviceOrders.Civil) || run.serviceOrder;
  const context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  const dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);
  const sop = new DrsServiceOrderPage(page, ENV.baseUrl);
  await sop.gotoList(run.id);
  const card = page.locator('div').filter({ has: page.getByText(String(so.number), { exact: true }) })
    .filter({ has: page.getByRole('button', { name: 'Edit' }) }).last();
  await card.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('textbox', { name: 'SO Number*' }).waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(2000);
  await dump('01-edit-form');
  const f = summary.findings;
  f.buttons = (await page.getByRole('button').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
  f.lineHeaders = (await page.getByText(/^Line \d+$/).allInnerTexts()).length;
  f.linesCaption = await page.getByText(/Service Order Lines \(\d+\)/).first().innerText().catch(() => '');
  console.log(`  SO ${so.number}: ${f.linesCaption}; line blocks ${f.lineHeaders}; buttons ${JSON.stringify(f.buttons.slice(0, 30))}`);
  const add = page.getByRole('button', { name: 'Add Line' });
  f.addLine = await add.isVisible().catch(() => false);
  if (f.addLine) {
    await add.click();
    await page.waitForTimeout(1500);
    f.afterAdd = await page.getByText(/Service Order Lines \(\d+\)/).first().innerText().catch(() => '');
    f.lastLineNumberValue = await sop.lineField('Line Number').inputValue().catch((e) => `ERR ${e.message}`);
    await dump('02-after-add-line');
    console.log(`  Add Line -> ${f.afterAdd}; new block's Line Number value "${f.lastLineNumberValue}"`);
  }
  console.log('  blocked writes:', blocked.length ? blocked : '(none)');
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  await context.close();
});
