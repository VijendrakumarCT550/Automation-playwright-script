const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, installWriteGuard, loginSuperAdmin, makeDumper } = require('../utils/drs-ui');

// ===========================================================================
// DRS EXPLORATION — ROUND 19. READ-ONLY, ENFORCED.
// Checklists Configurator, before building checklists (app owner, 2026-10-15:
// some NEW, some FORKED from existing; >= 6 questions "Question no 1.." covering
// every question type x Required on/off):
//   1. New checklist → Add question: what fields does a question row have, and
//      which TYPES does its type picker offer (Text / Number / Yes-No / ...)? How is
//      Required set (switch? checkbox?)
//   2. "Fork to edit" on Post Pour Check: what opens (dialog / editable copy), what
//      can be edited (name, SFQP, questions), and what are its buttons?
// Never saves (the write guard aborts any write; Create / Save are not clicked).
// Run: npx playwright test --project=drs tests/drs/inspection/00_drs_explore_round19_checklist_questions_fork.spec.js --workers=1
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/round19');
const blocked = [];
const summary = { screens: [], findings: {} };
let context;

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, 'blocked-writes.txt'), blocked.join('\n') || '(none)');
  if (context) await context.close();
});

test('checklist question form + fork', async ({ browser }) => {
  test.setTimeout(10 * 60 * 1000);
  const f = summary.findings;
  context = await browser.newContext({ viewport: { width: 1800, height: 1200 } });
  await installWriteGuard(context, ENV, blocked);
  const page = await context.newPage();
  const dump = makeDumper(page, OUT, summary);
  await loginSuperAdmin(page, ENV);

  // ---- 1. New checklist → Add question ----
  await page.goto(`${ENV.baseUrl}/appSettings/checklistsConfigurator`);
  await page.getByRole('button', { name: 'New checklist' }).waitFor({ state: 'visible', timeout: 60000 });
  await page.getByRole('button', { name: 'New checklist' }).click();
  const dialog = page.getByRole('dialog').last();
  await dialog.waitFor({ state: 'visible', timeout: 15000 });
  await dialog.getByRole('button', { name: 'Add question' }).click();
  await page.waitForTimeout(1500);
  await dump('01-question-row');
  f.questionRowAria = await dialog.ariaSnapshot().catch((e) => e.message);
  console.log('  dialog after Add question:\n', f.questionRowAria.slice(0, 3000));
  // Open every combobox in the dialog and list its options (the type picker).
  const combos = dialog.getByRole('combobox');
  f.combos = [];
  for (let i = 0; i < await combos.count(); i += 1) {
    const c = combos.nth(i);
    await c.click().catch(() => {});
    await page.waitForTimeout(800);
    const opts = (await page.locator('[role="option"]:visible').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
    f.combos.push({ label: await c.getAttribute('aria-label'), text: (await c.innerText().catch(() => '')).trim(), options: opts });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  }
  console.log('  question comboboxes:', JSON.stringify(f.combos));
  f.switches = await dialog.locator('[role="switch"], [role="checkbox"], input[type="checkbox"]').evaluateAll((els) => els.map((e) => ({
    role: e.getAttribute('role'), aria: e.getAttribute('aria-label'), label: (e.closest('label') || {}).innerText || '',
  })));
  console.log('  switches/checkboxes:', JSON.stringify(f.switches));
  await dialog.getByRole('button', { name: 'Cancel' }).click().catch(() => {});
  await page.waitForTimeout(800);

  // ---- 2. Fork to edit on Post Pour Check ----
  await page.getByPlaceholder(/Search by name, serial or SFQP/i).fill('Post Pour Check');
  await page.waitForTimeout(2500);
  await page.getByText('Post Pour Check', { exact: true }).first().click();
  await page.waitForTimeout(3000);
  await dump('02-post-pour-check');
  f.postPourText = (await page.locator('body').innerText()).split('Fork to edit')[1]?.slice(0, 1500);
  console.log('\n  Post Pour Check:\n', (f.postPourText || '').slice(0, 1200));
  const fork = page.getByRole('button', { name: 'Fork to edit' });
  if (await fork.isVisible().catch(() => false)) {
    await fork.click();
    await page.waitForTimeout(2500);
    await dump('03-after-fork-click');
    const d2 = page.getByRole('dialog').last();
    f.forkAria = (await d2.isVisible().catch(() => false))
      ? await d2.ariaSnapshot().catch((e) => e.message)
      : await page.locator('body').ariaSnapshot().catch((e) => e.message);
    console.log('\n  after Fork to edit:\n', f.forkAria.slice(0, 3500));
  }
  console.log('  blocked writes:', blocked.length ? blocked : '(none)');
});
