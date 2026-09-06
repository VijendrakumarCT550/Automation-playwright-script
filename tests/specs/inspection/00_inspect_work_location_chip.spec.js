const { test } = require('@playwright/test');
const { adminFreshLogin } = require('../../utils/helpers');
const DashboardFilterPage = require('../../pages/DashboardFilterPage');

// PURE RECON — no assertions. SM16's "select Work Location, then check it's
// still shown" assertion fails no matter which DOM property is read
// (textContent AND inputValue both come back empty) — dumping the actual
// surrounding DOM after a real selection to see where the selected value
// really renders, instead of guessing a third property to read.
test('RECON: where does the selected Work Location value actually render in the DOM', async ({ browser }) => {
  test.setTimeout(2 * 60 * 1000);
  const { context, page, dashboard } = await adminFreshLogin(browser);
  const filter = new DashboardFilterPage(page);

  await filter.goto();
  await filter.switchToRFI();
  await filter.openFilter();

  console.log('\n========== Work Location field BEFORE selection ==========');
  console.log(await filter.workLocationField.evaluate(el => el.outerHTML));
  console.log('Parent (1 level up):');
  console.log(await filter.workLocationField.evaluate(el => el.parentElement.outerHTML.slice(0, 1000)));

  await filter.selectField(filter.workLocationField, 'S05b');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(2000);

  console.log('\n========== Work Location field AFTER selecting S05b ==========');
  console.log('input.value:', await filter.workLocationField.inputValue().catch(e => `ERROR: ${e.message}`));
  console.log('textContent:', await filter.workLocationField.evaluate(el => el.textContent));
  console.log('outerHTML:', await filter.workLocationField.evaluate(el => el.outerHTML));

  console.log('\nGrandparent container (2 levels up), full HTML:');
  console.log(await filter.workLocationField.evaluate(el => el.parentElement.parentElement.outerHTML));

  await context.close();
});

test('RECON: what does Work Area actually show after a cross-tab switch', async ({ browser }) => {
  test.setTimeout(2 * 60 * 1000);
  const { context, page, dashboard } = await adminFreshLogin(browser);
  const filter = new DashboardFilterPage(page);

  await filter.goto();
  await filter.switchToRFI();
  await filter.openFilter();
  await filter.selectField(filter.workLocationField, 'S05b');
  await page.waitForLoadState('networkidle');
  await filter.confirmWorkLocationSelected('S05b');
  await filter.selectField(filter.workAreaField, '__first__');
  await filter.clickApply();

  await filter.switchToNC();
  await filter.openFilter();

  console.log('\n========== Work Area field state after switching RFI -> NC ==========');
  console.log('placeholder attr:', await filter.workAreaField.getAttribute('placeholder').catch(() => null));
  console.log('getFieldGatingText():', await filter.getFieldGatingText(filter.workAreaField));
  console.log('option count:', await filter.getFieldOptionCount(filter.workAreaField).catch(e => `ERROR: ${e.message}`));
  console.log('Work Location chip container text:', await filter.selectedChipsContainer(filter.workLocationField).textContent().catch(() => 'ERROR'));
  console.log('Work Area field outerHTML:', await filter.workAreaField.evaluate(el => el.outerHTML));

  await context.close();
});
