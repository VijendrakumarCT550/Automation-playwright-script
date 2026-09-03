/**
 * DOM Discovery script — NOT a real test, no assertions.
 *
 * NC's "Capture Photo" / "Use Camera" control has never been automated in
 * this codebase (it was previously optional and simply skipped — see
 * project_nc_creation_feature memory). It's about to become MANDATORY
 * throughout the NC flow (creation, CI response, EE/QI review), so before
 * writing real automation for it, dump what actually happens when "Use
 * Camera" is clicked: a getUserMedia-based in-page modal, a native OS file
 * picker, or something else — plus what turns the resulting photo into an
 * attached thumbnail (a "Capture"/confirm button, auto-attach, etc).
 *
 * Same "explore first, write real selectors after" pattern as
 * tests/discovery.spec.js and the other 00_inspect_*.spec.js files.
 *
 * Usage (single run, headed so you can watch):
 *   npx playwright test tests/specs/inspection/00_inspect_nc_capture_photo.spec.js --project=chromium --headed --reporter=list --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const { loginAsRole } = require('../../utils/helpers');
const NCCreatePage = require('../../pages/NCCreatePage');

test('inspect NC Capture Photo / Use Camera control', async ({ page }) => {
  test.setTimeout(10 * 60 * 1000);
  await loginAsRole(page, 'QI');

  const ncCreate = new NCCreatePage(page);
  await ncCreate.goto();
  await ncCreate.clickCreateNC();

  fs.mkdirSync('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/nc_capture_00_form.png', fullPage: true });

  // Find whatever's around the "Capture Photo" / "Use Camera" text without
  // assuming its tag/structure yet.
  const useCameraLocator = page.getByText('Use Camera', { exact: false }).first();
  const hasUseCamera = await useCameraLocator.isVisible({ timeout: 10000 }).catch(() => false);
  console.log('Use Camera visible:', hasUseCamera);

  if (!hasUseCamera) {
    console.log('Use Camera control not found without scrolling — dumping body text.');
    console.log(await page.locator('body').innerText());
    return;
  }

  // Dump the DOM neighborhood around "Use Camera" (ancestor chain + its
  // clickable node) so we know what to actually target.
  const neighborhood = await useCameraLocator.evaluate((el) => {
    const describe = (node) => node && ({
      tag: node.tagName,
      id: node.id,
      className: node.className,
      role: node.getAttribute && node.getAttribute('role'),
      text: node.innerText ? node.innerText.trim().slice(0, 80) : null,
    });
    return {
      self: describe(el),
      parent: describe(el.parentElement),
      grandparent: describe(el.parentElement && el.parentElement.parentElement),
      outerHTMLSnippet: el.parentElement ? el.parentElement.outerHTML.slice(0, 1500) : el.outerHTML.slice(0, 1500),
    };
  });
  console.log('USE CAMERA NEIGHBORHOOD:', JSON.stringify(neighborhood, null, 2));

  // Click it and see what appears — set up permission-dialog logging first
  // in case Chrome's own camera prompt appears despite context permissions.
  page.on('dialog', async (dialog) => {
    console.log('DIALOG:', dialog.type(), dialog.message());
    await dialog.dismiss().catch(() => {});
  });

  await useCameraLocator.click({ force: true });
  await page.waitForTimeout(2000);

  await page.screenshot({ path: 'test-results/nc_capture_01_after_click.png', fullPage: true });

  // Dump every dialog/modal/video/canvas/button now visible.
  const postClickState = await page.evaluate(() => {
    const describe = (node) => ({
      tag: node.tagName,
      id: node.id,
      className: typeof node.className === 'string' ? node.className : '',
      text: node.innerText ? node.innerText.trim().slice(0, 60) : null,
    });
    return {
      videos: Array.from(document.querySelectorAll('video')).map(describe),
      canvases: Array.from(document.querySelectorAll('canvas')).map(describe),
      dialogs: Array.from(document.querySelectorAll('[role="dialog"], [data-scope="dialog"]')).map(describe),
      fileInputs: Array.from(document.querySelectorAll('input[type="file"]')).map(el => ({
        ...describe(el),
        accept: el.accept,
        capture: el.getAttribute('capture'),
      })),
      visibleButtons: Array.from(document.querySelectorAll('button'))
        .filter(b => b.offsetParent !== null)
        .map(describe)
        .filter(b => b.text),
    };
  });
  console.log('POST-CLICK STATE:', JSON.stringify(postClickState, null, 2));

  fs.writeFileSync('test-results/nc_capture_post_click.html', await page.content());

  // --- Round 2: click "Capture" and see what happens to the video/thumbnail ---
  const captureButton = page.getByRole('button', { name: 'Capture', exact: true }).first();
  const hasCaptureButton = await captureButton.isVisible({ timeout: 5000 }).catch(() => false);
  console.log('Capture button visible:', hasCaptureButton);

  if (hasCaptureButton) {
    await captureButton.click();
    await page.waitForTimeout(2000);
    await page.screenshot({ path: 'test-results/nc_capture_02_after_capture.png', fullPage: true });

    const postCaptureState = await page.evaluate(() => {
      const describe = (node) => ({
        tag: node.tagName,
        id: node.id,
        className: typeof node.className === 'string' ? node.className : '',
        text: node.innerText ? node.innerText.trim().slice(0, 60) : null,
        src: node.src ? node.src.slice(0, 60) : null,
      });
      return {
        videos: Array.from(document.querySelectorAll('video')).map(describe),
        canvases: Array.from(document.querySelectorAll('canvas')).map(describe),
        images: Array.from(document.querySelectorAll('img')).map(describe),
        visibleButtons: Array.from(document.querySelectorAll('button'))
          .filter(b => b.offsetParent !== null)
          .map(describe)
          .filter(b => b.text),
      };
    });
    console.log('POST-CAPTURE STATE:', JSON.stringify(postCaptureState, null, 2));
    fs.writeFileSync('test-results/nc_capture_post_capture.html', await page.content());
  }
});
