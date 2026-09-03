const { test } = require('@playwright/test');
const { loginAsUser } = require('../../utils/helpers');
const WAMPage = require('../../pages/WAMPage');

// PURE RECON, pulse-dev — the user's own screenshot showed something my
// pulse-test recon completely missed: Admin's "My Assignment" panel, once
// Cluster="Gujarat" and Sites="Khavda" are picked, renders a real
// SCROLLABLE LIST of Work Locations (A-01, A-01a-50MW, A-06c, ...) — a
// genuine child-visibility display distinct from the "Add Details" dialog's
// row grid. This finds the real DOM shape of that list so WAMPage.js can
// get a proper locator/reader for it, on the environment that actually has
// this data (pulse-dev — pulse-test's much thinner dataset likely never
// rendered a visible list at all, which is why the first round of recon
// missed it).
test('RECON (pulse-dev): "My Assignment" results list DOM shape, as Admin', async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  const context = await browser.newContext({
    permissions: ['geolocation'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  const page = await context.newPage();

  const dashboard = await loginAsUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const wam = new WAMPage(page);
  await wam.goto(dashboard);

  await wam.viewOwnAssignments({ cluster: ['Gujarat', 'KHAVDA', 'Khavda'], site: ['Khavda', 'KHAVDA'] });
  await page.waitForTimeout(1500);

  const bodyText = await page.locator('body').innerText();
  console.log('Full body text after Cluster+Sites resolve (first 2500 chars):\n', bodyText.slice(0, 2500));

  // Find the container the list items live in, and dump its structure.
  const listInfo = await page.evaluate(() => {
    // Heuristic: find the smallest element containing MANY short text-only
    // children (work location names), by walking common list-ish tags.
    const candidates = Array.from(document.querySelectorAll('ul, div, [role="list"]'));
    let best = null;
    for (const el of candidates) {
      const directChildren = Array.from(el.children);
      if (directChildren.length >= 10 && directChildren.length < 200) {
        const sample = directChildren.slice(0, 3).map(c => c.textContent.trim());
        if (sample.every(t => t.length > 0 && t.length < 40)) {
          if (!best || directChildren.length > best.count) {
            best = {
              tag: el.tagName, className: el.className, count: directChildren.length,
              childTag: directChildren[0].tagName, childClassName: directChildren[0].className,
              sample: directChildren.slice(0, 8).map(c => c.textContent.trim()),
            };
          }
        }
      }
    }
    return best;
  });
  console.log('Detected list container:', JSON.stringify(listInfo, null, 1));

  // Also confirm: is this list SCOPED to Cluster+Sites only, or does it
  // require Work Location too? (screenshot showed it appearing BEFORE
  // Work Location was picked.)
  const workLocationFieldValue = await wam.viewWorkLocationField.innerText().catch(() => 'N/A (not visible)');
  console.log('Work Location field value/state at this point:', workLocationFieldValue);

  await page.screenshot({ path: 'test-results/recon5_my_assignment_list.png', fullPage: true }).catch(() => {});
  await context.close();
});
