const { test } = require('@playwright/test');
const LoginPage = require('../pages/LoginPage');

// THROWAWAY inspector — reimplements loginAsRole()'s login sequence
// step-by-step with timestamped logging and periodic full-page
// screenshots, to diagnose the long CI-login idle window reported live
// (2026-08-19) without needing someone to watch the headed browser in
// real time. Delete once the root cause is found and captured in code
// comments, matching this repo's 00_inspect_*.spec.js convention.
test('INSPECT: instrumented CI login with periodic screenshots', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);

  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
  const t0 = Date.now();
  let shotCount = 0;
  const shot = async (label) => {
    shotCount++;
    const path = `test-results/hang-debug-${String(shotCount).padStart(2, '0')}-${label}.png`;
    await page.screenshot({ path, fullPage: true }).catch((e) => log(`screenshot failed: ${e.message}`));
    log(`screenshot -> ${path}`);
  };

  await page.context().clearCookies();
  const login = new LoginPage(page);
  log('goto login page');
  await login.goto();
  log('submitting CI credentials');
  await login.login(process.env.CI_EMAIL, process.env.CI_PASSWORD);
  log(`login() returned, url=${page.url()}`);
  await shot('post-login');

  // ---- Stage 1: spinner-vs-content race (DashboardPage.waitForLoad) ----
  const content = page.locator('text=RFI Distribution')
    .or(page.locator('text=Create RFI'))
    .or(page.locator('text=Pending with me'))
    .or(page.locator('text=Pending with others'))
    .first();
  const spinner = page.locator('text=100%');

  log('STAGE 1: racing spinner vs content...');
  const winner = await Promise.race([
    spinner.waitFor({ state: 'visible', timeout: 600000 }).then(() => 'spinner').catch(() => 'timeout'),
    content.waitFor({ state: 'visible', timeout: 600000 }).then(() => 'content').catch(() => 'timeout'),
  ]);
  log(`STAGE 1 winner: ${winner}`);
  await shot('stage1-race-winner');

  if (winner === 'spinner') {
    await page.waitForTimeout(2000);
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await page.waitForLoadState('networkidle');
    log('STAGE 1: navigated to /my-tasks after spinner');
    await shot('stage1-post-spinner-nav');
  }

  log('STAGE 1: waiting for content to be visible (final, up to 5 min)...');
  await content.waitFor({ state: 'visible', timeout: 300000 });
  await page.waitForLoadState('networkidle');
  log('STAGE 1 DONE: content visible + networkidle');
  await shot('stage1-done');

  // ---- Stage 2: incomplete-download-banner reload + check ----
  log('STAGE 2: reloading for banner check...');
  await page.reload();
  await page.waitForLoadState('networkidle');
  log('STAGE 2: reload networkidle, waiting for content again (up to 5 min)...');
  await content.waitFor({ state: 'visible', timeout: 300000 });
  log('STAGE 2: post-reload content visible');
  await shot('stage2-post-reload');

  const downloadButton = page.getByRole('button', { name: 'Download missing data' });
  const bannerVisible = await downloadButton.isVisible({ timeout: 3000 }).catch(() => false);
  log(`STAGE 2: banner visible = ${bannerVisible}`);
  if (bannerVisible) {
    await downloadButton.click();
    await page.waitForLoadState('networkidle');
    log('STAGE 2: clicked Download missing data');
    await shot('stage2-after-banner-click');
  }
  log('STAGE 2 DONE');

  // ---- Stage 3: goToMyTasks click-and-verify retry loop ----
  const navMyTasks = page.locator('a:has-text("My Tasks"), nav >> text=My Tasks').first();
  const arrived = () => page.locator('text=Create RFI')
    .or(page.locator('text=Pending with me'))
    .or(page.locator('text=Pending with others'))
    .first().waitFor({ state: 'visible', timeout: 5000 }).then(() => true).catch(() => false);

  log('STAGE 3: goToMyTasks retry loop (up to 3 min)...');
  const deadline = Date.now() + 3 * 60 * 1000;
  let attempt = 0;
  let ok = false;
  do {
    attempt++;
    log(`STAGE 3 attempt ${attempt}: clicking My Tasks nav`);
    await navMyTasks.click();
    await page.waitForLoadState('networkidle');
    ok = await arrived();
    log(`STAGE 3 attempt ${attempt}: arrived=${ok}`);
    if (!ok) {
      await shot(`stage3-attempt-${attempt}`);
      await page.waitForTimeout(1000);
    }
  } while (!ok && Date.now() < deadline);

  await shot('final');
  log(`DONE — total STAGE 3 attempts=${attempt}, arrived=${ok}, total elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
});
