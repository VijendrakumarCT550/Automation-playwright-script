const { test, expect } = require('../../config/test-base');
const { devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser } = require('../../utils/helpers');
const { ensureSmokeUsers } = require('../../utils/smoke-users');
const { ensureWorkAreaMapping } = require('../../utils/smoke-prereqs');
const MyTasksPage   = require('../../pages/MyTasksPage');
const RFICreatePage = require('../../pages/RFICreatePage');
const RFIListPage   = require('../../pages/RFIListPage');
const NCCreatePage  = require('../../pages/NCCreatePage');
const NCTasksPage   = require('../../pages/NCTasksPage');
const NCListPage    = require('../../pages/NCListPage');

// THROWAWAY inspector — the draft Delete button (app change 2026-10-23, see
// docs/app-owner-decisions-and-conventions.md §3.10).
//
// A draft row now has a Delete button next to its eye icon (desktop grid
// Actions cell; the record card on mobile). On a NEW draft it deletes the
// draft. This run captures, for RFI (CI) and NC (QI), on desktop and mobile:
//   * the Actions cell / card HTML (so the real spec can name the button),
//   * whatever appears after clicking it (confirm dialog text + buttons, toast),
//   * In-Draft row count before/after, and what Create RFI/NC opens afterwards.
// It also records whether a draft made on DESKTOP is visible from a separate
// MOBILE login — i.e. whether drafts are still browser-local (2026-08-19) or
// now server-side (the resume URL carries a record uuid).
//
// Ground: the same areas SM09 (RFI, BL03) and SM26 (NC, BL05) use. Drafts
// only, nothing is submitted. The Discard (resubmit-step) half needs a
// REJECTED record and is recon'd separately.
//
// Run:  npx playwright test tests/specs/inspection/00_inspect_draft_delete.spec.js --project chromium
//
// Output: test-results/draft-delete/*.png + findings.json

test.use({ profileKey: 'solar-e2e' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const OUT = path.join('test-results', 'draft-delete');
const MOBILE = (({ defaultBrowserType, ...d }) => d)(devices['Pixel 7']);
const CONTEXT_OPTS = { permissions: ['geolocation', 'camera'], geolocation: { latitude: 23.0, longitude: 69.0 } };

const findings = {};
const t0 = Date.now();
const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);
const save = () => fs.writeFileSync(path.join(OUT, 'findings.json'), JSON.stringify(findings, null, 2));
const shot = async (page, label) => {
  await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true }).catch(() => {});
  log(`screenshot -> ${label}.png`);
};

// Every button in a container, with what identifies it.
async function describeButtons(container) {
  return container.locator('button').evaluateAll((els) => els.map((b) => ({
    text: b.innerText.trim(),
    ariaLabel: b.getAttribute('aria-label'),
    title: b.getAttribute('title'),
    svgClass: b.querySelector('svg')?.getAttribute('class') || null,
    disabled: b.disabled,
  }))).catch(() => []);
}

// Whatever overlay/toast is on screen right now.
async function captureOverlay(page) {
  const dialog = page.locator(
    '[role="alertdialog"], [role="dialog"], [data-scope="dialog"][data-part="content"]'
  ).filter({ visible: true }).first();
  const hasDialog = await dialog.waitFor({ state: 'visible', timeout: 3000 }).then(() => true).catch(() => false);
  const toast = page.locator('[data-scope="toast"], [role="status"], [role="alert"]').filter({ visible: true });
  return {
    dialog: hasDialog ? {
      text: (await dialog.innerText().catch(() => '')).trim(),
      buttons: await describeButtons(dialog),
    } : null,
    toasts: await toast.allInnerTexts().catch(() => []),
    _dialog: hasDialog ? dialog : null,
  };
}

async function draftRowCount(page) {
  return page.locator('[role="row"]').filter({ hasText: 'In-Draft' }).count();
}

// Desktop: find the In-Draft row, scroll its Actions cell into view, dump it.
async function desktopActionsCell(list) {
  const row = await list.scrollToRowByStatus('In-Draft');
  await row.first().waitFor({ state: 'visible', timeout: 15000 });
  const rowIndex = await row.first().getAttribute('aria-rowindex');
  const cell = list.getRowByAriaIndex(rowIndex).locator('[role="gridcell"]').last();
  for (let i = 0; i < 20; i++) {
    if (await cell.locator('button:has(svg.lucide-eye)').first().isVisible().catch(() => false)) break;
    const atEnd = await list.grid.evaluate((el) => {
      const before = el.scrollLeft;
      el.scrollLeft = el.scrollWidth;
      return el.scrollLeft === before;
    });
    await list.page.waitForTimeout(400);
    if (atEnd) break;
  }
  return cell;
}

// Mobile: the card holding "In-Draft".
async function mobileDraftCard(page) {
  const badge = page.getByText('In-Draft').first();
  await badge.waitFor({ state: 'visible', timeout: 15000 });
  // Walk up to the nearest ancestor that also holds buttons — that is the card.
  const handle = await badge.evaluateHandle((el) => {
    let n = el;
    while (n && n.parentElement && !(n.querySelectorAll('button').length >= 1 && n.innerText.length > 30)) {
      n = n.parentElement;
    }
    return n;
  });
  return handle.asElement();
}

// Clicks the non-eye button, captures the overlay, confirms it if there is one.
async function clickDeleteAndCapture(page, deleteButton, label) {
  await deleteButton.click();
  const overlay = await captureOverlay(page);
  await shot(page, `${label}-after-delete-click`);
  if (overlay._dialog) {
    const confirm = overlay._dialog.getByRole('button', { name: /delete|yes|confirm|ok|discard|remove/i }).first();
    if (await confirm.isVisible().catch(() => false)) {
      log(`${label}: confirming dialog via "${(await confirm.innerText()).trim()}"`);
      await confirm.click();
      await page.waitForTimeout(1500);
    }
  }
  const afterToasts = await page.locator('[data-scope="toast"], [role="status"], [role="alert"]')
    .filter({ visible: true }).allInnerTexts().catch(() => []);
  await shot(page, `${label}-after-confirm`);
  delete overlay._dialog;
  return { ...overlay, toastsAfterConfirm: afterToasts };
}

test.describe('INSPECT: draft Delete button (RFI + NC, desktop + mobile)', () => {
  let users;

  test.beforeAll(async ({ browser, profile }) => {
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    fs.mkdirSync(OUT, { recursive: true });
    users = await ensureSmokeUsers(browser, profile, ['CI', 'EE', 'QI']);
    await ensureWorkAreaMapping(browser, profile, users, {
      roles: ['CI'], areas: [profile.flowWorkAreas?.rfi?.desktop?.[0] || 'BL03'], label: 'recon prereq (RFI)',
    }).catch((e) => log(`RFI WAM prereq: ${e.message}`));
    await ensureWorkAreaMapping(browser, profile, users, {
      roles: ['QI'], areas: [profile.nc.workArea], label: 'recon prereq (NC)',
    }).catch((e) => log(`NC WAM prereq: ${e.message}`));
  });

  test('RFI draft Delete — desktop, then cross-session visibility + mobile', async ({ browser, profile }) => {
    test.setTimeout(30 * 60 * 1000);
    const r = findings.rfi = {};
    const rfi = profile.rfi;

    const desk = await browser.newContext({ ...CONTEXT_OPTS });
    const page = await desk.newPage();
    await loginAsFlowUser(page, users.CI.email, PASSWORD);
    const myTasks = new MyTasksPage(page);

    const makeDraft = async () => {
      await myTasks.goto();
      await myTasks.clickCreateRFI();
      const create = new RFICreatePage(page);
      await create.selectOption(create.workLocationDropdown, rfi.workLocation);
      await page.goBack();
      await page.waitForTimeout(3000);
      await page.goto(`${process.env.BASE_URL}/my-tasks`);
      await myTasks.waitForLoad();
      await myTasks.clickPendingWithMe();
      await page.waitForTimeout(2000);
    };

    // ---- Desktop delete ----
    await makeDraft();
    r.desktopRowsBefore = await draftRowCount(page);
    log(`RFI desktop: In-Draft rows before = ${r.desktopRowsBefore}`);
    const list = new RFIListPage(page);
    await list.waitForGrid();
    const cell = await desktopActionsCell(list);
    r.desktopActionsCellHtml = (await cell.innerHTML().catch(() => '')).slice(0, 4000);
    r.desktopActionsButtons = await describeButtons(cell);
    log(`RFI desktop Actions buttons: ${JSON.stringify(r.desktopActionsButtons)}`);
    await shot(page, 'rfi-desktop-01-row');

    const del = cell.locator('button:not(:has(svg.lucide-eye))').first();
    if (await del.isVisible().catch(() => false)) {
      r.desktopDelete = await clickDeleteAndCapture(page, del, 'rfi-desktop-02');
      await page.goto(`${process.env.BASE_URL}/my-tasks`);
      await myTasks.waitForLoad();
      await myTasks.clickPendingWithMe();
      await page.waitForTimeout(2000);
      r.desktopRowsAfter = await draftRowCount(page);
      log(`RFI desktop: In-Draft rows after delete = ${r.desktopRowsAfter}`);
      await myTasks.clickCreateRFI();
      await page.waitForTimeout(2000);
      r.createAfterDeleteWorkLocation = (await new RFICreatePage(page).workLocationDropdown.innerText().catch(() => '')).trim();
      r.createAfterDeleteUrl = page.url();
      log(`RFI desktop: Create RFI after delete shows Work Location = "${r.createAfterDeleteWorkLocation}"`);
      await shot(page, 'rfi-desktop-03-create-after-delete');
    } else {
      r.desktopDelete = 'NO non-eye button in the Actions cell';
    }
    save();

    // ---- Cross-session: does a desktop draft show up on a separate mobile login? ----
    await makeDraft();
    r.desktopSecondDraftRows = await draftRowCount(page);
    const mob = await browser.newContext({ ...MOBILE, ...CONTEXT_OPTS });
    const mpage = await mob.newPage();
    await loginAsFlowUser(mpage, users.CI.email, PASSWORD);
    const mTasks = new MyTasksPage(mpage);
    await mTasks.waitForLoad();
    await mTasks.clickPendingWithMe();
    await mpage.waitForTimeout(3000);
    r.mobileSeesDesktopDraft = await mpage.getByText('In-Draft').first()
      .waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false);
    log(`RFI: draft made on desktop visible from a separate mobile login = ${r.mobileSeesDesktopDraft}`);
    await shot(mpage, 'rfi-mobile-01-list');

    if (!r.mobileSeesDesktopDraft) {
      log('RFI mobile: creating a mobile-side draft instead');
      await mTasks.clickCreateRFI();
      const mcreate = new RFICreatePage(mpage);
      await mcreate.selectOption(mcreate.workLocationDropdown, rfi.workLocation);
      await mpage.goBack();
      await mpage.waitForTimeout(3000);
      await mpage.goto(`${process.env.BASE_URL}/my-tasks`);
      await mTasks.waitForLoad();
      await mTasks.clickPendingWithMe();
      await mpage.waitForTimeout(2000);
    }

    const card = await mobileDraftCard(mpage).catch(() => null);
    if (card) {
      r.mobileCardHtml = (await card.innerHTML()).slice(0, 4000);
      r.mobileCardButtons = await card.$$eval('button', (els) => els.map((b) => ({
        text: b.innerText.trim(), ariaLabel: b.getAttribute('aria-label'),
        svgClass: b.querySelector('svg')?.getAttribute('class') || null,
      })));
      log(`RFI mobile card buttons: ${JSON.stringify(r.mobileCardButtons)}`);
      const delHandle = await card.$('button:not(:has(svg.lucide-eye))');
      if (delHandle) {
        await delHandle.click();
        const overlay = await captureOverlay(mpage);
        await shot(mpage, 'rfi-mobile-02-after-delete-click');
        if (overlay._dialog) {
          const confirm = overlay._dialog.getByRole('button', { name: /delete|yes|confirm|ok|discard|remove/i }).first();
          if (await confirm.isVisible().catch(() => false)) await confirm.click();
          await mpage.waitForTimeout(1500);
        }
        delete overlay._dialog;
        r.mobileDelete = overlay;
        await shot(mpage, 'rfi-mobile-03-after-confirm');
      } else {
        r.mobileDelete = 'NO non-eye button on the draft card';
      }
    } else {
      r.mobileDelete = 'no In-Draft card found on mobile';
    }
    save();

    // Leftover: if the desktop second draft survived (local-only drafts), delete it on desktop.
    await page.goto(`${process.env.BASE_URL}/my-tasks`);
    await myTasks.waitForLoad();
    await myTasks.clickPendingWithMe();
    await page.waitForTimeout(2000);
    r.desktopRowsAtEnd = await draftRowCount(page);
    log(`RFI: desktop In-Draft rows at end = ${r.desktopRowsAtEnd}`);
    if (r.desktopRowsAtEnd > 0) {
      const c2 = await desktopActionsCell(new RFIListPage(page));
      const d2 = c2.locator('button:not(:has(svg.lucide-eye))').first();
      if (await d2.isVisible().catch(() => false)) await clickDeleteAndCapture(page, d2, 'rfi-desktop-04-cleanup');
    }
    save();
    await mob.close();
    await desk.close();
  });

  test('NC draft Delete — desktop + mobile', async ({ browser, profile }) => {
    test.setTimeout(30 * 60 * 1000);
    const n = findings.nc = {};
    const nc = profile.nc;
    const draftData = {
      workLocation: nc.workLocation, workArea: nc.workArea, vendorName: nc.vendorName,
      package: nc.package, activity: nc.activity, subActivity: nc.subActivity, workSectionCount: 1,
      capturePhoto: false,
    };

    const runViewport = async (label, ctxOpts) => {
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      await loginAsFlowUser(page, users.QI.email, PASSWORD);
      const ncCreate = new NCCreatePage(page);
      const ncTasks = new NCTasksPage(page);
      const out = n[label] = {};

      await ncCreate.goto();
      await ncCreate.clickCreateNC();
      await ncCreate.fillForm(draftData);
      // The Draft button is the only thing that drafts an NC (spec 32).
      await ncCreate.clickSaveDraft();
      await page.waitForTimeout(3000);
      await page.goto(`${process.env.BASE_URL}/my-tasks?type=nc`);
      await page.waitForTimeout(1500);
      await ncTasks.clickNcTab();
      await ncTasks.clickPendingWithMe();
      await page.waitForTimeout(2000);
      out.rowsBefore = await draftRowCount(page);
      await shot(page, `nc-${label}-01-list`);

      if (label === 'desktop') {
        const list = new NCListPage(page);
        await list.waitForGrid();
        const cell = await desktopActionsCell(list);
        out.actionsCellHtml = (await cell.innerHTML().catch(() => '')).slice(0, 4000);
        out.actionsButtons = await describeButtons(cell);
        log(`NC desktop Actions buttons: ${JSON.stringify(out.actionsButtons)}`);
        const del = cell.locator('button:not(:has(svg.lucide-eye))').first();
        out.delete = (await del.isVisible().catch(() => false))
          ? await clickDeleteAndCapture(page, del, 'nc-desktop-02')
          : 'NO non-eye button in the Actions cell';
      } else {
        const card = await mobileDraftCard(page).catch(() => null);
        if (card) {
          out.cardHtml = (await card.innerHTML()).slice(0, 4000);
          out.cardButtons = await card.$$eval('button', (els) => els.map((b) => ({
            text: b.innerText.trim(), ariaLabel: b.getAttribute('aria-label'),
            svgClass: b.querySelector('svg')?.getAttribute('class') || null,
          })));
          log(`NC mobile card buttons: ${JSON.stringify(out.cardButtons)}`);
          const delHandle = await card.$('button:not(:has(svg.lucide-eye))');
          if (delHandle) {
            await delHandle.click();
            const overlay = await captureOverlay(page);
            await shot(page, 'nc-mobile-02-after-delete-click');
            if (overlay._dialog) {
              const confirm = overlay._dialog.getByRole('button', { name: /delete|yes|confirm|ok|discard|remove/i }).first();
              if (await confirm.isVisible().catch(() => false)) await confirm.click();
              await page.waitForTimeout(1500);
            }
            delete overlay._dialog;
            out.delete = overlay;
          } else {
            out.delete = 'NO non-eye button on the draft card';
          }
        } else {
          out.delete = 'no In-Draft card found on mobile';
        }
      }

      await page.goto(`${process.env.BASE_URL}/my-tasks?type=nc`);
      await page.waitForTimeout(1500);
      await ncTasks.clickNcTab();
      await ncTasks.clickPendingWithMe();
      await page.waitForTimeout(2000);
      out.rowsAfter = await draftRowCount(page);
      log(`NC ${label}: In-Draft rows before=${out.rowsBefore} after=${out.rowsAfter}`);
      await shot(page, `nc-${label}-03-list-after`);
      save();
      await ctx.close();
    };

    await runViewport('desktop', { ...CONTEXT_OPTS });
    await runViewport('mobile', { ...MOBILE, ...CONTEXT_OPTS });
  });

  test.afterAll(() => {
    if (fs.existsSync(OUT)) save();
    console.log('\n===== DRAFT DELETE FINDINGS =====\n' + JSON.stringify(findings, null, 2));
  });
});
