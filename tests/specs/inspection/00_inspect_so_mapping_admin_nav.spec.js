const { test } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const { loadLastCreatedUsers } = require('../../utils/user-counter-utils');
const DashboardPage = require('../../pages/DashboardPage');

// PURE RECON — no assertions. SM18's online-role sweep found CAD/SAD/PAD all
// timing out waiting for SO Mapping's empty-state hint after clicking
// dashboard.navSOMapping — but the failure SCREENSHOT showed the page still
// sitting on a fully-settled /dashboard, not mid-navigation or on
// /so-mapping. That means the click itself isn't landing on a working nav
// link, not that the destination page loads slowly. This dumps every DOM
// match for "SO Mapping" text and what actually happens on click, using the
// regression tier's own CAD account (different identity than SM18's smoke
// batch, but the same role/access tier, which is what matters here).
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const lastCreated = loadLastCreatedUsers();

test('RECON: what does dashboard.navSOMapping actually resolve to, and does clicking it navigate', async ({ browser }) => {
  test.setTimeout(3 * 60 * 1000);
  const cad = lastCreated.CAD;
  console.log('Using CAD account:', cad && cad.email);
  const page = await (await browser.newContext()).newPage();
  const dashboard = await loginAsUser(page, cad.email, PASSWORD);
  await dashboard.goToDashboard();

  console.log('\n========== every element matching "SO Mapping" text ==========');
  const matches = await page.locator('a:has-text("SO Mapping"), nav >> text=SO Mapping').evaluateAll(
    els => els.map(el => ({
      tag: el.tagName,
      text: el.textContent.trim(),
      href: el.getAttribute('href'),
      visible: !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length),
      outerHTML: el.outerHTML.slice(0, 300),
    }))
  );
  console.log(`Found ${matches.length} match(es):`);
  matches.forEach((m, i) => console.log(`  [${i}] ${JSON.stringify(m)}`));

  console.log('\n========== clicking dashboard.navSOMapping (.first() of the above) ==========');
  console.log('URL before click:', page.url());
  await dashboard.navSOMapping.click();
  await page.waitForTimeout(2000);
  console.log('URL 2s after click:', page.url());
  await page.waitForTimeout(6000);
  console.log('URL 8s after click:', page.url());

  const emptyHint = page.locator('text=Select a package and Work Area to see activities.');
  console.log('Empty-state hint visible?', await emptyHint.isVisible().catch(() => false));

  // If we're still on /dashboard, try the sidebar treeitem pattern instead
  // (DashboardPage.navItem — used successfully elsewhere in this suite for
  // sidebar navigation) to see if THAT resolves/clicks correctly where the
  // anchor-based locator didn't.
  if (page.url().includes('/dashboard')) {
    console.log('\n========== still on /dashboard — trying navItem("SO Mapping") instead ==========');
    const treeItem = dashboard.navItem('SO Mapping');
    console.log('navItem("SO Mapping") visible?', await treeItem.isVisible({ timeout: 2000 }).catch(() => false));
    if (await treeItem.isVisible({ timeout: 2000 }).catch(() => false)) {
      await treeItem.click();
      await page.waitForTimeout(3000);
      console.log('URL after navItem click:', page.url());
    }
  }

  console.log('\n========== trying force-click on the <p> itself ==========');
  await dashboard.navSOMapping.click({ force: true }).catch(e => console.log('force click failed:', e.message));
  await page.waitForTimeout(3000);
  console.log('URL after force click:', page.url());

  console.log('\n========== trying direct page.goto("/so-mapping") at the DEFAULT viewport ==========');
  await page.goto(`${process.env.BASE_URL}/so-mapping`);
  await page.waitForLoadState('networkidle');
  console.log('URL after direct goto:', page.url());
  console.log('Empty-state hint visible after direct goto?', await emptyHint.isVisible({ timeout: 5000 }).catch(() => false));
  const bodyText = await page.locator('body').innerText().catch(() => '');
  console.log('Body text snippet (first 400 chars):', bodyText.slice(0, 400));

  console.log('\n========== NOW widening to 1920x1080, then direct page.goto("/so-mapping") again ==========');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`${process.env.BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  await page.goto(`${process.env.BASE_URL}/so-mapping`);
  await page.waitForLoadState('networkidle');
  console.log('URL after wide-viewport direct goto:', page.url());
  console.log('Empty-state hint visible at wide viewport?', await emptyHint.isVisible({ timeout: 5000 }).catch(() => false));
  const bodyText2 = await page.locator('body').innerText().catch(() => '');
  console.log('Body text snippet at wide viewport (first 400 chars):', bodyText2.slice(0, 400));

  console.log('\n========== at the wide viewport, does clicking the sidebar link navigate now? ==========');
  await page.goto(`${process.env.BASE_URL}/dashboard`);
  await page.waitForLoadState('networkidle');
  console.log('URL before wide-viewport click:', page.url());
  await dashboard.navSOMapping.click();
  await page.waitForTimeout(3000);
  console.log('URL after wide-viewport click:', page.url());

  await page.context().close();
});
