const { test, expect, devices } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { SOLAR_E2E, resolveFlowWorkAreas } = require('../../config/projects');
const { loginAsFlowUser } = require('../../utils/helpers');
const { loadLastCreatedUsers } = require('../../utils/user-counter-utils');
const { getVisibleCodeFor, discardCreateForm } = require('../../utils/rfi-dependency-flow');
const { openFromPendingWithMe } = require('../../utils/rfi-nav');
const MyTasksPage = require('../../pages/MyTasksPage');
const RFICreatePage = require('../../pages/RFICreatePage');
const RFIChecklistPage = require('../../pages/RFIChecklistPage');
const RFIReviewPage = require('../../pages/RFIReviewPage');
const RFIListPage = require('../../pages/RFIListPage');

// MOBILE DOM/UI RECON — the app owner's instruction: get the FULL RFI flow
// (CI -> EE -> QI) running in ONE SESSION at a phone viewport the way desktop
// already does, using SOLAR, specifically in order to learn the real mobile DOM
// before wind is touched again.
//
// WHY SOLAR AND NOT WIND. Solar has ~490 Work Sections per Work Area, so a run
// consumes nothing that matters and this can be repeated as often as the DOM
// needs re-reading. Wind has exactly ONE per Work Area and each run permanently
// spends a (checkpoint, Work Section) pair — using wind to go looking for DOM
// would burn the very checkpoints the wind smoke stage needs.
//
// WHY THIS EXISTS AT ALL, rather than just fixing the mobile specs by trial.
// Every mobile failure so far has been the same shape: a `.first()` on a
// generic role selector silently resolving to the wrong element, because mobile
// renders structurally different markup (cards instead of a grid, a two-screen
// review, a drawer nav, several dialogs open at once, the RFI code CSS-truncated
// out of the header). Guessing at those costs a full ~30-minute run per guess.
// Capturing the real DOM once, at every screen, turns that into desk work.
//
// WHAT IT PRODUCES, per screen, into tests/fixtures/mobile-dom-recon/:
//   <nn>-<label>.json  structured inventory — every visible button/combobox/
//                      radio/checkbox/input/dialog/grid with its accessible
//                      name, data-scope/data-part, disabled + checked state
//   <nn>-<label>.html  full page HTML, for anything the inventory misses
//   <nn>-<label>.png   full-page screenshot
//   index.json         one line per screen, in order
//
// It writes NOTHING into tests/fixtures/rfi-tracker.json and reads no tracker —
// same isolation convention as 23/29/30 and the smoke chain.
//
// The reject popup is captured NON-DESTRUCTIVELY: opened, snapshotted, then
// dismissed without rejecting, so the happy path this run is proving stays
// intact. The actual reject+resubmit cycle is a separate, env-gated test below
// (MOBILE_RECON_REJECT=1) so it can never run by accident during a happy-path
// verification.

// Pixel 7, matching playwright.config's SMOKE_VIEWPORTS mobile entry.
// defaultBrowserType is a launch-level key, not a valid test option — spreading
// the device descriptor without stripping it makes test.use throw.
const { defaultBrowserType, ...PIXEL_7 } = devices['Pixel 7'];
test.use(PIXEL_7);

test.describe.configure({ mode: 'serial' });

const OUT_DIR = path.join(__dirname, '..', '..', 'fixtures', 'mobile-dom-recon');
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
// Set MOBILE_RECON_RFI_CODE=<code> to re-run only the EE/QI review half against
// an RFI that already exists and is pending with EE.
const RESUME_CODE = process.env.MOBILE_RECON_RFI_CODE || null;
const PROFILE = SOLAR_E2E;
// Mobile's own work area, per SOLAR_E2E.flowWorkAreas — keeps this recon off
// the desktop variant's ground so both stay independently re-runnable.
const WORK_AREA = resolveFlowWorkAreas(PROFILE, { flow: 'rfi', viewport: 'mobile' })[0];
const CHECKPOINT = PROFILE.rfi.checkpointChain[0];

let seq = 0;
const index = [];

// One screen's worth of evidence. Everything here is collected in ONE
// page.evaluate rather than via a series of Playwright locator queries: the
// point is to see what the DOM actually contains, including elements no
// existing locator knows to look for.
async function snapshot(page, label) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const base = `${String(++seq).padStart(2, '0')}-${label}`;

  // Let any in-flight animation/toast settle so the capture reflects a
  // steady state rather than a transition frame.
  await page.waitForTimeout(600);

  const data = await page.evaluate(() => {
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return false;
      const s = getComputedStyle(el);
      return s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
    };
    const txt = (el) => (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 140);
    const all = (sel) => Array.from(document.querySelectorAll(sel)).filter(visible);
    const describe = (el) => ({
      text: txt(el),
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || null,
      ariaLabel: el.getAttribute('aria-label') || null,
      id: el.id || null,
      dataScope: el.getAttribute('data-scope') || null,
      dataPart: el.getAttribute('data-part') || null,
      dataState: el.getAttribute('data-state') || null,
      disabled: el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true',
      cls: (el.getAttribute('class') || '').slice(0, 180) || null,
    });
    const checkedOf = (el) =>
      el.getAttribute('aria-checked') === 'true' || el.checked === true || el.getAttribute('data-state') === 'checked';

    return {
      url: location.href,
      viewport: { w: window.innerWidth, h: window.innerHeight },
      headings: all('h1,h2,h3,h4,[role="heading"]').map(txt).filter(Boolean),
      buttons: all('button,[role="button"]').map(describe),
      links: all('a[href]').map((e) => ({ text: txt(e), href: e.getAttribute('href') })),
      comboboxes: all('[role="combobox"],select').map(describe),
      radios: all('[role="radio"],input[type="radio"]').map((e) => ({ ...describe(e), checked: checkedOf(e) })),
      checkboxes: all('[role="checkbox"],input[type="checkbox"]').map((e) => ({ ...describe(e), checked: checkedOf(e) })),
      textInputs: all('input:not([type="radio"]):not([type="checkbox"]),textarea').map((e) => ({
        ...describe(e),
        placeholder: e.getAttribute('placeholder'),
        value: String(e.value || '').slice(0, 80),
      })),
      // Several dialogs can be open at once on this app (the earlier mobile
      // recon measured three) — that is precisely why `.first()` on a generic
      // dialog selector has bitten this suite repeatedly, so list them ALL.
      // Ark UI puts data-scope="dialog" on the TRIGGER button as well as on the
      // real surfaces — the notification bell is one — so an unfiltered query
      // reports a phantom "1 dialog open" on literally EVERY screen. That would
      // wreck the exact analysis this recon exists for, since the whole question
      // is which screens genuinely have several dialog surfaces mounted at once
      // (where a .first() picks the wrong one). Keep only real surfaces; count
      // triggers separately so the information is not lost.
      dialogs: all('[role="dialog"],[data-scope="dialog"]')
        .filter((e) => {
          const part = e.getAttribute('data-part');
          return part !== 'trigger' && part !== 'backdrop';
        })
        .map((e) => ({ ...describe(e), text: txt(e) })),
      dialogTriggers: all('[data-scope="dialog"][data-part="trigger"]').length,
      grids: all('[role="grid"],table').map((e) => ({
        ...describe(e),
        rowCount: e.querySelectorAll('[role="row"],tr').length,
      })),
      toasts: all('[data-scope="toast"],[role="alert"],[role="status"]').map(txt).filter(Boolean),
      // The mobile list renders RFIs as CARDS, not grid rows. There is no
      // stable class to rely on yet, so capture the shallow block structure of
      // the main region and let the HTML dump settle the details.
      bodyText: (document.body.innerText || '').replace(/\n{3,}/g, '\n\n').slice(0, 6000),
    };
  });

  fs.writeFileSync(path.join(OUT_DIR, `${base}.json`), JSON.stringify(data, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, `${base}.html`), await page.content());
  await page.screenshot({ path: path.join(OUT_DIR, `${base}.png`), fullPage: true }).catch(() => {});

  const btnNames = data.buttons.map((b) => b.text || b.ariaLabel).filter(Boolean);
  console.log(`\n  [${base}] ${data.url}`);
  console.log(`     headings : ${JSON.stringify(data.headings.slice(0, 8))}`);
  console.log(`     buttons  : ${JSON.stringify(btnNames.slice(0, 20))}`);
  if (data.dialogs.length) console.log(`     DIALOGS  : ${data.dialogs.length} open -> ${JSON.stringify(data.dialogs.map((d) => d.text.slice(0, 60)))}`);
  if (data.toasts.length) console.log(`     toasts   : ${JSON.stringify(data.toasts)}`);

  index.push({
    file: base,
    url: data.url,
    headings: data.headings,
    buttons: btnNames,
    dialogCount: data.dialogs.length,
    gridCount: data.grids.length,
    radioCount: data.radios.length,
    toasts: data.toasts,
  });
  return data;
}

function writeIndex(extra = {}) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'index.json'),
    JSON.stringify({ capturedAt: new Date().toISOString(), baseUrl: process.env.BASE_URL, profile: PROFILE.key, workArea: WORK_AREA, ...extra, screens: index }, null, 2)
  );
  console.log(`\n  [index] ${index.length} screen(s) -> ${path.relative(path.join(__dirname, '..', '..', '..'), OUT_DIR)}`);
}

function loadUsers() {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  const recorded = loadLastCreatedUsers();
  const users = {};
  for (const roleKey of ['CI', 'EE', 'QI']) {
    const prefix = PROFILE.users.prefixes[roleKey];
    const entry = recorded[prefix];
    expect(
      entry && entry.profileKey === PROFILE.key,
      `No recorded ${roleKey} user (prefix "${prefix}") for profile "${PROFILE.key}" — run smoke stages 1-3 first.`
    ).toBeTruthy();
    users[roleKey] = entry;
  }
  return users;
}

const baseData = () => ({
  workLocation: PROFILE.rfi.workLocation,
  workArea: WORK_AREA,
  package: PROFILE.rfi.package,
  subPackage: PROFILE.rfi.subPackage,
  activity: PROFILE.rfi.activity,
  subActivity: CHECKPOINT.subActivity,
  rfiQuantity: PROFILE.rfi.rfiQuantity,
  unit: PROFILE.rfi.unit,
  subContractor: PROFILE.rfi.subContractor,
});

test('mobile DOM recon: full solar RFI flow CI -> EE -> QI in one session', async ({ page }) => {
  // Three PWA logins at up to ~6 minutes each, plus form/list/review work at a
  // phone viewport, plus a full-page screenshot per screen.
  test.setTimeout(90 * 60 * 1000);

  const users = loadUsers();
  console.log(
    `\n=== MOBILE DOM recon: "${PROFILE.key}" @ ${PROFILE.rfi.workLocation} / ${WORK_AREA} ` +
    `/ ${PROFILE.rfi.activity} / ${CHECKPOINT.checkpoint} ===`
  );
  for (const k of ['CI', 'EE', 'QI']) console.log(`    ${k}: ${users[k].name} <${users[k].email}>`);

  let rfiId = null;
  let rfiCode = null;

  try {
    // ------------------------------------------------------------------
    // CI — create and submit
    // ------------------------------------------------------------------
    // RESUME: point at an RFI that already exists and is pending with EE, so
    // the EE/QI half can be re-run without creating another record. Solar
    // costs nothing to re-create, but every abandoned run leaves an RFI
    // parked in a reviewer's queue, and those accumulate.
    if (RESUME_CODE) {
      rfiCode = RESUME_CODE;
      // Offset so a resume run cannot interleave its screen numbering with the
      // CI screens already captured on disk by a full run.
      seq = 50;
      console.log(`
  >>> RESUME MODE: skipping CI creation, reviewing ${rfiCode}
`);
    } else {
      await loginAsFlowUser(page, users.CI.email, PASSWORD);
      await snapshot(page, 'ci-landing-after-login');

      const myTasks = new MyTasksPage(page);
      await myTasks.waitForLoad();
      await snapshot(page, 'ci-my-tasks');

      await myTasks.clickCreateRFI();
      const rfiCreate = new RFICreatePage(page);
      await snapshot(page, 'ci-create-page1-empty');

      // workSection null => "pick the first available", which on solar yields a
      // fresh section every run. Nothing is consumed in a way that matters.
      await rfiCreate.fillForm({
        ...baseData(),
        inspectionCheckpoint: CHECKPOINT.checkpoint,
        inspectionChecklist: CHECKPOINT.checklist,
        workSection: null,
      });
      await snapshot(page, 'ci-create-page1-filled');

      await rfiCreate.clickProceed();
      await snapshot(page, 'ci-checklist-page2');

      const checklist = new RFIChecklistPage(page);
      const filled = await checklist.fillAllObservations(PROFILE.rfi.observationValue, true);
      console.log(`\n  CI filled ${filled} observation input(s)`);
      await snapshot(page, 'ci-checklist-page2-filled');

      await checklist.submitRFI();
      await snapshot(page, 'ci-after-submit');

      const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
      expect(match, `Could not extract an RFI id after submitting; URL was ${page.url()}`).toBeTruthy();
      rfiId = match[1];

      rfiCode = await getVisibleCodeFor(page, rfiId);
      expect(rfiCode, 'Expected a visible RFI code after submitting').toBeTruthy();
      expect(rfiCode, 'A freshly submitted RFI should not still show a DRAFT code').not.toMatch(/draft/i);
      await snapshot(page, 'ci-view-with-code');
      console.log(`\n  >>> CI created ${rfiCode} (id ${rfiId})\n`);
    }

    // ------------------------------------------------------------------
    // EE — list, review, reject-popup peek, approve
    // ------------------------------------------------------------------
    await loginAsFlowUser(page, users.EE.email, PASSWORD);
    await snapshot(page, 'ee-landing-after-login');

    const eeTasks = new MyTasksPage(page);
    // NOT waitForLoad(): that waits for the Create RFI button, which only CI
    // has. Confirmed live here — EE's My Tasks has the tabs and all three tiles
    // but no Create RFI button, so waitForLoad() burned 30s and failed on a
    // fully-loaded page.
    console.log(`
  EE My Tasks ready via: ${await eeTasks.waitForTasksReady()}`);
    await snapshot(page, 'ee-my-tasks-tiles');

    // Capture the LIST on its own before navigating into the record — this is
    // the screen that renders as cards instead of a grid, and the one whose
    // shape openRowByCode has to branch on.
    await eeTasks.clickPendingWithMe();
    const eeList = new RFIListPage(page);
    const eeLayout = await eeList.waitForGrid();
    const eeCodes = await eeList.listRowCodes();
    console.log(`\n  EE list layout: "${eeLayout}"; ${eeCodes.length} row(s): ${JSON.stringify(eeCodes.slice(0, 10))}`);
    await snapshot(page, 'ee-pending-with-me-list');

    await openFromPendingWithMe(page, rfiCode, 'EE mobile DOM recon', { exact: true });
    const eeReview = new RFIReviewPage(page);
    await snapshot(page, 'ee-review-page1');

    // ---- Reject popup, peeked WITHOUT rejecting ----
    // The mobile "Reject RFI" button has never been clicked by this suite.
    // Capturing its popup here is the whole point of the exercise; dismissing
    // it again keeps this run's happy path intact.
    if (await eeReview.rejectRfiButton.isVisible({ timeout: 5000 }).catch(() => false)) {
      await eeReview.rejectRfiButton.click();
      await snapshot(page, 'ee-reject-popup-OPEN');

      const cancelInPopup = eeReview.rejectPopup.getByRole('button', { name: /^\s*cancel\s*$/i }).first();
      if (await cancelInPopup.isVisible({ timeout: 3000 }).catch(() => false)) {
        await cancelInPopup.click();
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
      await page.waitForTimeout(1200);
      await snapshot(page, 'ee-reject-popup-dismissed');

      // If the popup is still up, everything after this fails behind its
      // backdrop for no visible reason — say so here instead.
      const stillOpen = await eeReview.rejectPopup.isVisible({ timeout: 1000 }).catch(() => false);
      expect(stillOpen, 'The Reject RFI popup could not be dismissed — the page is wedged behind its backdrop').toBe(false);
    } else {
      console.log('\n  NOTE: no "Reject RFI" button on EE mobile review page 1');
    }

    // ---- Page 1 -> Page 2 hop, captured explicitly ----
    const proceed = page.getByRole('button', { name: /^\s*proceed\s*$/i }).first();
    const hadProceed = await proceed.isVisible({ timeout: 3000 }).catch(() => false);
    console.log(`\n  EE review has a Proceed button (mobile two-screen split): ${hadProceed}`);
    if (hadProceed) {
      await proceed.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await snapshot(page, 'ee-review-page2');
    }

    await eeReview.expandAllChecklist();
    await snapshot(page, 'ee-review-page2-expanded');

    await eeReview.approve();
    await snapshot(page, 'ee-after-approve');
    console.log(`\n  >>> EE approved ${rfiCode}\n`);

    // ------------------------------------------------------------------
    // QI — the second reviewer, same mechanics
    // ------------------------------------------------------------------
    await loginAsFlowUser(page, users.QI.email, PASSWORD);
    await snapshot(page, 'qi-landing-after-login');

    const qiTasks = new MyTasksPage(page);
    console.log(`
  QI My Tasks ready via: ${await qiTasks.waitForTasksReady()}`);
    await snapshot(page, 'qi-my-tasks-tiles');

    await qiTasks.clickPendingWithMe();
    const qiList = new RFIListPage(page);
    const qiLayout = await qiList.waitForGrid();
    const qiCodes = await qiList.listRowCodes();
    console.log(`\n  QI list layout: "${qiLayout}"; ${qiCodes.length} row(s): ${JSON.stringify(qiCodes.slice(0, 10))}`);
    await snapshot(page, 'qi-pending-with-me-list');

    await openFromPendingWithMe(page, rfiCode, 'QI mobile DOM recon', { exact: true });
    const qiReview = new RFIReviewPage(page);
    await snapshot(page, 'qi-review-page1');

    const qiProceed = page.getByRole('button', { name: /^\s*proceed\s*$/i }).first();
    if (await qiProceed.isVisible({ timeout: 3000 }).catch(() => false)) {
      await qiProceed.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      await snapshot(page, 'qi-review-page2');
    }

    await qiReview.expandAllChecklist();
    await qiReview.approve();
    await snapshot(page, 'qi-after-approve');
    console.log(`\n  >>> QI approved ${rfiCode} — full mobile CI -> EE -> QI cycle complete\n`);
  } finally {
    // The evidence is the deliverable — write it even if the flow died
    // partway, since a failed run's DOM is exactly what explains the failure.
    await discardCreateForm(page).catch(() => {});
    writeIndex({ rfiId, rfiCode });
  }
});

// ---------------------------------------------------------------------------
// Reject + resubmit, env-gated so it can never run during a happy-path check.
//
// Deliberately SEPARATE from the flow above rather than folded into it: this
// one deliberately leaves an RFI in a rejected state partway through, and if it
// dies mid-cycle it leaves the record pending with CI. On solar that costs
// nothing (fresh Work Section every run), which is exactly why the mechanics
// get learned here and not on wind.
//
// Run with:  MOBILE_RECON_REJECT=P1  (reject from review page 1)
//            MOBILE_RECON_REJECT=P2  (reject from the checklist page)
// ---------------------------------------------------------------------------
const REJECT_MODE = (process.env.MOBILE_RECON_REJECT || '').toUpperCase();

test(`mobile DOM recon: reject (${REJECT_MODE || 'disabled'}) + resubmit cycle`, async ({ page }) => {
  test.skip(
    REJECT_MODE !== 'P1' && REJECT_MODE !== 'P2',
    'Set MOBILE_RECON_REJECT=P1 or P2 to capture the reject/resubmit DOM'
  );
  test.setTimeout(120 * 60 * 1000);

  const users = loadUsers();
  seq = 100; // keep these screens clearly separated from the happy path's
  console.log(`\n=== MOBILE DOM recon: reject-from-${REJECT_MODE} + resubmit ===`);

  let rfiId = null;
  let rfiCode = null;

  try {
    // RESUME: point at an RFI that has ALREADY been rejected and is sitting with
    // CI, to iterate on just the resubmit half. Saves two ~6-minute PWA logins
    // and, more to the point, stops every failed attempt leaving another
    // rejected orphan parked in CI's queue.
    if (RESUME_CODE) {
      rfiCode = RESUME_CODE;
      seq = 150;
      console.log(`
  >>> RESUME: skipping create+reject, resubmitting ${rfiCode}
`);
    } else {
      // ---- CI creates ----
      //
      // RETRY-VIA-FRESH-LOGIN, and it is needed here specifically. The Work
      // Section dropdown can offer an option the backend then rejects with
      // "An RFI already exists for the workSections: <x>" — the app owner
      // confirmed this is a cookies-not-fully-cleared symptom, and the remedy is a
      // fresh login, NOT picking a different Work Section (RFICreatePage.clickProceed
      // tags it as err.staleWorkSection for exactly this).
      //
      // The happy-path test above gets away without this because it is CI's FIRST
      // login of the run. This test is CI's second, and it hit the stale error on
      // its very first attempt. Safe to retry on SOLAR only, where a fresh Work
      // Section is always available; on wind the same message is the literal truth
      // and retrying would loop forever.
      const MAX_CREATE_ATTEMPTS = 3;
      for (let attempt = 1; attempt <= MAX_CREATE_ATTEMPTS; attempt++) {
        await loginAsFlowUser(page, users.CI.email, PASSWORD);
        const myTasks = new MyTasksPage(page);
        await myTasks.waitForLoad();
        await myTasks.clickCreateRFI();

        const rfiCreate = new RFICreatePage(page);
        // Always "pick the first available". The retry used to switch to
        // __random__ on later attempts; that is GONE deliberately.
        //
        // Retrying with null once failed identically 3 times, and my first
        // reading — an app-side Work Section filtering gap — was WRONG. The real
        // cause was session state surviving the login: clearCookies() does not
        // clear localStorage, PULSE autosaves an RFI draft there, and that draft
        // keeps HOLDING the Work Section it selected. The backend was correctly
        // refusing a section our own leftover local state still owned.
        //
        // helpers.clearBrowserSession() now clears cookies + localStorage +
        // sessionStorage before every page-reusing login, which removed the cause
        // (proved live: "first available" moved from the stuck R01-S05 to R01-S06
        // and created first time). The __random__ workaround is therefore DELETED
        // rather than kept as a backstop — leaving it in would quietly step around
        // a returning session leak instead of letting it fail visibly. The retry
        // loop itself stays, so a genuine one-off still gets a second chance.
        const selectedWorkSection = await rfiCreate.fillForm({
          ...baseData(),
          inspectionCheckpoint: CHECKPOINT.checkpoint,
          inspectionChecklist: CHECKPOINT.checklist,
          workSection: null,
        });
        console.log(`  attempt ${attempt}: work section "${selectedWorkSection}"`);

        try {
          await rfiCreate.clickProceed();
        } catch (err) {
          if (err && err.staleWorkSection && attempt < MAX_CREATE_ATTEMPTS) {
            // Discard properly FIRST — navigating away from a filled form
            // autosaves a draft and consumes the Work Section it holds, whereas
            // Cancel+confirm releases it.
            console.log(
              `  attempt ${attempt}: backend rejected work section "${selectedWorkSection}" ` +
              `as already used; discarding and retrying with a different one`
            );
            await discardCreateForm(page).catch(() => {});
            continue;
          }
          throw err;
        }

        const checklist = new RFIChecklistPage(page);
        await checklist.fillAllObservations(PROFILE.rfi.observationValue, true);
        await checklist.submitRFI();
        break;
      }

      const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
      expect(match, `Could not extract an RFI id after submitting; URL was ${page.url()}`).toBeTruthy();
      rfiId = match[1];
      rfiCode = await getVisibleCodeFor(page, rfiId);
      console.log(`\n  >>> CI created ${rfiCode} (id ${rfiId}) for the reject cycle\n`);

      // ---- EE rejects ----
      await loginAsFlowUser(page, users.EE.email, PASSWORD);
      await openFromPendingWithMe(page, rfiCode, `EE reject-${REJECT_MODE} recon`, { exact: true });
      const review = new RFIReviewPage(page);
      await snapshot(page, `reject-${REJECT_MODE}-ee-review-page1`);

      const remarks = `Mobile recon rejection from ${REJECT_MODE}`;
      if (REJECT_MODE === 'P1') {
        await review.rejectRfiButton.click();
        await snapshot(page, 'reject-P1-popup');
        await review.rejectRemarksInput.fill(remarks);
        await snapshot(page, 'reject-P1-popup-filled');
        await review.rejectPopupButton.click();
        await page.waitForTimeout(3000);
        await snapshot(page, 'reject-P1-after');
      } else {
        // Mobile splits the review across two screens, so the checklist — and
        // its Not Ok radios — live on page 2 behind Proceed. Desktop shows both
        // panes at once, which is why the existing rejectFromChecklistPage has
        // never needed this hop.
        const proceed = page.getByRole('button', { name: /^\s*proceed\s*$/i }).first();
        if (await proceed.isVisible({ timeout: 3000 }).catch(() => false)) {
          await proceed.click();
          await page.waitForLoadState('networkidle').catch(() => {});
        }
        await snapshot(page, 'reject-P2-checklist-page');
        await review.expandAllChecklist();
        await snapshot(page, 'reject-P2-checklist-expanded');

        const notOk = page.getByRole('radio', { name: 'Not Ok' }).first();
        await notOk.click({ force: true });
        const remarkInput = page.getByPlaceholder('Type your comments here').first();
        await remarkInput.waitFor({ state: 'visible', timeout: 8000 });
        await remarkInput.fill(remarks);
        await snapshot(page, 'reject-P2-notok-filled');

        await review.submitButton.click();
        await snapshot(page, 'reject-P2-confirm-popup');
        await review.confirmSubmitButton.click();
        await page.waitForTimeout(3000);
        await snapshot(page, 'reject-P2-after');
      }
      console.log(`\n  >>> EE rejected ${rfiCode} from ${REJECT_MODE}\n`);
    }

    // ---- CI resubmits ----
    await loginAsFlowUser(page, users.CI.email, PASSWORD);
    await snapshot(page, `resubmit-${REJECT_MODE}-ci-my-tasks`);

    await openFromPendingWithMe(page, rfiCode, `CI resubmit after ${REJECT_MODE} reject`, { exact: true });
    await snapshot(page, `resubmit-${REJECT_MODE}-ci-opened-view`);

    // The eye icon always lands on the READ-ONLY /view. The editable form is at
    // /re-submit, reached via a Resubmit/Edit button — capture what that button
    // is actually called and where it sits on mobile.
    console.log(`\n  URL after opening as CI: ${page.url()}`);
    if (!page.url().includes('/re-submit')) {
      const resubmitBtn = page.getByRole('button', { name: /resubmit|edit/i }).first();
      const found = await resubmitBtn.isVisible({ timeout: 10000 }).catch(() => false);
      console.log(`  Resubmit/Edit button visible on mobile /view: ${found}`);
      expect(found, 'No Resubmit/Edit button on the rejected RFI at a mobile viewport').toBe(true);
      await resubmitBtn.click();
      await page.waitForLoadState('networkidle').catch(() => {});
    }
    await snapshot(page, `resubmit-${REJECT_MODE}-form-page1`);
    console.log(`  URL after clicking Resubmit: ${page.url()}`);

    // THE BEHAVIOURAL RULE UNDER TEST: page 1 is editable after a page-1
    // rejection and LOCKED after a checklist-page rejection.
    const createPage = new RFICreatePage(page);
    const locked = await createPage.isFirstPageLocked();
    console.log(`  Page 1 locked after a ${REJECT_MODE} rejection: ${locked}`);
    expect(
      locked,
      REJECT_MODE === 'P1'
        ? 'Page 1 should be EDITABLE after a page-1 rejection'
        : 'Page 1 should be LOCKED after a checklist-page rejection'
    ).toBe(REJECT_MODE === 'P2');

    await createPage.clickProceed();
    await snapshot(page, `resubmit-${REJECT_MODE}-checklist`);
    const reChecklist = new RFIChecklistPage(page);
    await reChecklist.fillAllObservations(PROFILE.rfi.observationValue, true);
    await reChecklist.submitRFI();
    await snapshot(page, `resubmit-${REJECT_MODE}-after-submit`);

    // Resubmitting creates a NEW CHILD RECORD with its own id; the original is
    // archived. Per the app owner the VISIBLE CODE only changes if work
    // location, work area or package changed — none did here, so it must not.
    const newMatch = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
    expect(newMatch, `Could not extract the new RFI id after resubmit; URL was ${page.url()}`).toBeTruthy();
    const newId = newMatch[1];
    const newCode = await getVisibleCodeFor(page, newId);
    console.log(
      `\n  >>> RESUBMIT RESULT\n` +
      `      original : id=${rfiId} code=${rfiCode}\n` +
      `      child    : id=${newId} code=${newCode}\n` +
      `      id changed   : ${newId !== rfiId}\n` +
      `      code changed : ${newCode !== rfiCode}\n`
    );
    // Only meaningful when THIS run created the original — in resume mode rfiId
    // is null and comparing against it would assert nothing while looking green.
    if (rfiId) {
      expect(newId, 'Resubmitting should create a NEW child record with its own id').not.toBe(rfiId);
    } else {
      console.log('  (resume mode: original id unknown, so the new-child-id check is skipped)');
    }
    expect(
      newCode,
      'The visible code must NOT change on resubmit when work location, work area and package are unchanged'
    ).toBe(rfiCode);

    rfiId = newId;

    // ---- Finish the cycle: EE then QI approve the resubmitted child ----
    //
    // Two reasons this is not optional. Stopping at the resubmit would park an
    // orphan in EE's queue every run, and on wind that permanently blocks the
    // work area (solar tolerates it, which is exactly why the mechanics get
    // learned here). It is also the only thing that exercises approve()'s
    // reject-guard against a record that really has been through a rejection.
    for (const role of ['EE', 'QI']) {
      await loginAsFlowUser(page, users[role].email, PASSWORD);
      await openFromPendingWithMe(page, rfiCode, `${role} approve after ${REJECT_MODE} resubmit`, { exact: true });

      const rv = new RFIReviewPage(page);
      await snapshot(page, `resubmit-${REJECT_MODE}-${role.toLowerCase()}-review`);

      // Get onto the checklist screen FIRST (a no-op on desktop, the Proceed
      // hop on mobile) — otherwise setAllChecklistOk would be counting radios
      // on mobile page 1, which has none at all, and report a confident zero.
      await rv.goToChecklistPage();
      await rv.expandAllChecklist().catch(() => {});

      // A checklist rejection can leave items marked "Not Ok". approve() now
      // refuses to submit when the confirm popup says "reject", so clear them
      // and report the count — whether they actually carry over to the
      // resubmitted child is still unconfirmed, and this measures it.
      const { total, flipped } = await rv.setAllChecklistOk();
      console.log(`  ${role}: ${total} "Ok" radio(s) present, flipped ${flipped} back to "Ok"`);
      // total === 0 means the radios were never reached (accordion not expanded),
      // which is a very different thing from "nothing needed changing".
      expect(total, `${role} should see checklist radios on the review screen`).toBeGreaterThan(0);

      await rv.approve();
      await snapshot(page, `resubmit-${REJECT_MODE}-${role.toLowerCase()}-approved`);
      console.log(`  >>> ${role} approved the resubmitted ${rfiCode}`);
    }
    console.log(`\n  >>> ${REJECT_MODE} reject + resubmit cycle COMPLETE for ${rfiCode}\n`);
  } finally {
    await discardCreateForm(page).catch(() => {});
    writeIndex({ rejectMode: REJECT_MODE, rfiId, rfiCode });
  }
});
