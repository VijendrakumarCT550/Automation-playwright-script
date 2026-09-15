const { test, expect } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const NCCreatePage = require('../pages/NCCreatePage');

// ===========================================================================
// BULK NC CREATION — N NCs as the QI, in ONE run / ONE session.
//
// The NC counterpart of 03_rfi_bulk_create.spec.js: same shape (one login,
// one serial loop, per-iteration try/catch, an end-of-run summary), against
// the NC create form instead of the RFI one.
//
// KEPT 100% SEPARATE FROM THE RFI BULK SPEC, per the standing rule that NC
// files never share code with RFI ones: its own data constant, its own page
// object, its own loop. The two files look alike on purpose; that is not an
// invitation to factor them together.
//
// WHAT IS DIFFERENT FROM THE RFI BULK LOOP, and why the loop body is simpler:
//
//   1. NC IS CREATED BY THE QI, not the CI — the reverse of RFI.
//   2. NC's form is ONE scrollable page with Submit at the bottom. There is
//      no Proceed -> checklist second step, so there is no checklist pass
//      per iteration (the RFI loop's fillAllObservations step).
//   3. NC DOES NOT AUTOSAVE ON NAVIGATE-AWAY — proven live 2026-09-05 in
//      32_nc_draft_autosave.spec.js: leaving a half-filled NC form mid-fill
//      saves nothing at all. So this loop needs NONE of the RFI loop's
//      "cancel the auto-resumed draft from the previous iteration" retry
//      dance; a plain navigation back to NC My Tasks is already a clean
//      reset, even after a failed iteration.
//
//      Corollary, and the one thing never to add here: do NOT click Cancel
//      and confirm the "are you sure you want to cancel NC?" popup as a
//      reset. Confirming that popup DELETES a drafted NC (app owner,
//      2026-09-05) and it buys nothing this loop needs.
//
// GROUND COST: this creates TOTAL_NCS real NCs against the work area below,
// and they stay there. That is safe on NC-only ground for the reason SM26
// documents — an NC consumes nothing, and duplicate NCs against identical
// details are legal — but it is NOT safe on RFI ground: a non-approved NC
// BLOCKS RFI create/resubmit for the same (inspection checkpoint, work
// section), so pointing this file at an area the RFI flow uses would lock
// that flow out of it. Keep workArea on NC-only ground.
//
// Run examples:
//   npx playwright test tests/specs/39_nc_bulk_create_qi.spec.js --project=chromium
// ===========================================================================

// EDIT THIS before a run — how many NCs this run should create.
const TOTAL_NCS = 10;

// Values are 14_nc_create_qi.spec.js's proven-live combination, unchanged.
// Work Location MUST be set explicitly: confirmed live that it is no longer
// pre-populated for the QI, and leaving it empty leaves every downstream
// dropdown (Work Area, Vendor, Package, Activity, ...) empty with nothing to
// pick and no error explaining why.
//
// NC Quantity/UOM rule (per app owner): both required UNLESS the selected
// Unit is "Not Applicable (NA)", in which case NC Quantity is not required.
const NC_DATA = {
  workLocation:     'A-06c',
  workArea:         'BL02',
  vendorName:       'CHOUHAN',
  package:          'Civil',
  activity:         'Piling - Robotic Docking System',
  subActivity:      'Piling - Robotic Docking System',
  workSectionCount: 2,
  ncQuantity:       2,
  unit:             'EA',
  defectType:       'Workmanship defect',
  category:         'Critical',
  // Mandatory. capturePhoto is not listed — NCCreatePage.fillForm defaults it
  // to true, and the photo is mandatory too.
  targetDateClosureDays: 14,
};

// SERIAL, like the RFI bulk spec: every iteration shares ONE QI session, and
// playwright.config.js sets `fullyParallel: true` globally.
test.describe.configure({ mode: 'serial' });

test.describe('NC Bulk Creation - QI', () => {
  let context, page, ncCreate;
  const results = [];

  test.beforeAll(async ({ browser }) => {
    // beforeAll has its own timeout ceiling (playwright.config.js's
    // `timeout: 600000`), separate from the test.setTimeout() below which
    // only covers the test body. DashboardPage's spinner wait alone is
    // 600000ms, so this needs real headroom above that.
    test.setTimeout(15 * 60 * 1000);

    // Own context rather than the `page` fixture, because every iteration
    // shares ONE session. Permissions and geolocation replicate
    // playwright.config.js's `use` block — a manually created context does
    // NOT inherit those, and NC's mandatory Capture Photo needs `camera`.
    // (The fake-media-stream launch args DO come through, since they are set
    // on the browser, not the context.)
    context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    await context.clearCookies();
    page = await context.newPage();

    // NC is created by the QUALITY INSPECTOR, not CI — the reverse of RFI.
    await loginAsRole(page, 'QI');
    ncCreate = new NCCreatePage(page);
  });

  test.afterAll(async () => {
    console.log('\n=== Bulk NC Creation Summary ===');
    results.forEach(r =>
      console.log(
        `  NC ${String(r.index).padStart(2, '0')}: ${r.status}` +
        `${r.ncId ? ' — ' + r.ncId : ''}` +
        `${r.workSections && r.workSections.length ? ' [' + r.workSections.join(', ') + ']' : ''}` +
        `${r.error ? ' — ' + r.error : ''}`
      )
    );
    const submitted = results.filter(r => r.status === 'submitted').length;
    console.log(`\n  Total submitted: ${submitted} / ${TOTAL_NCS}`);
    if (context) await context.close();
  });

  test(`Create ${TOTAL_NCS} NCs as QI in a single session`, async () => {
    // ~5 min per NC (full cascade + work sections + date picker + camera),
    // with a floor of 45 min so a small TOTAL_NCS still has headroom.
    test.setTimeout(Math.max(45, TOTAL_NCS * 5) * 60 * 1000);

    for (let i = 1; i <= TOTAL_NCS; i++) {
      console.log(`\n→ NC ${i}/${TOTAL_NCS}: starting`);

      // A unique marker per NC, so the created records are told apart on the
      // NC list afterwards — an iteration that silently re-saved the previous
      // NC instead of creating its own is otherwise invisible.
      const marker = `Automated bulk NC ${String(i).padStart(2, '0')}/${TOTAL_NCS} - regression test`;

      try {
        // Clean reset. Safe as a plain navigation because NC does not
        // autosave on navigate-away (see this file's header) — nothing is
        // left behind for the next iteration to auto-resume, even if the
        // previous one died mid-form.
        await page.goto(`${process.env.BASE_URL}/my-tasks?type=nc`);
        await page.waitForTimeout(1000);
        // Anything a failed iteration left open (an option listbox, a confirm
        // dialog) sits above the page and intercepts the Create NC click.
        await ncCreate.closeAnyOpenListbox();
        await ncCreate.closeAnyOpenDialog();

        await ncCreate.goto();
        await ncCreate.clickCreateNC();

        const workSections = await ncCreate.fillForm({ ...NC_DATA, ncDescription: marker });
        await ncCreate.submitNC();
        console.log(`NC ${i} post-submit URL: ${page.url()}`);

        const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
        expect(match, `NC ${i}: could not extract an NC id from URL: ${page.url()}`).toBeTruthy();
        const ncId = match[1];

        // A freshly created NC must be V1. A new NC that comes into existence
        // already past V1 means the version counter is picking up state from a
        // previous NC — exactly the kind of thing a bulk run is placed to
        // catch, and nothing else in this loop would notice it.
        const version = await ncCreate.getVersionBadge();
        expect(version.toLowerCase(), `NC ${i} (${ncId}) should start at V1`).toBe('v1');

        results.push({ index: i, status: 'submitted', ncId, workSections });
        console.log(`✓ NC ${i} submitted — ${ncId} at ${version}` +
          `${workSections.length ? ` on work section(s) ${workSections.join(', ')}` : ''}`);

      } catch (err) {
        const msg = err.message.split('\n')[0];
        results.push({ index: i, status: 'failed', error: msg });
        console.log(`✗ NC ${i} failed: ${msg}`);
        // Continue to the next iteration — one bad NC does not abort the run.
      }
    }

    const submitted = results.filter(r => r.status === 'submitted').length;
    expect(submitted, 'No NC was created at all — see the per-NC log above').toBeGreaterThan(0);

    // Every submitted NC must be its OWN record. A repeated id would mean an
    // iteration re-opened and re-saved the previous NC rather than creating a
    // new one, which the per-iteration assertions above cannot see.
    const ids = results.filter(r => r.ncId).map(r => r.ncId);
    expect(
      new Set(ids).size,
      `Every iteration should have produced its own NC, got ids ${JSON.stringify(ids)}`
    ).toBe(ids.length);
  });
});
