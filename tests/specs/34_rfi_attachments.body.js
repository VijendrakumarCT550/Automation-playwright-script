const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { getProfile } = require('../config/projects');
const { resolveRfiFixture } = require('../utils/smoke-rfi-fixture');
const { fillPageOne, resetToMyTasks, getVisibleCodeFor } = require('../utils/rfi-dependency-flow');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const { openFromPendingWithMe } = require('../utils/rfi-nav');

// RFI ATTACHMENTS — closes gap G-14 in docs/automation-coverage-and-gaps.md.
//
// ---------------------------------------------------------------------------
// THE GAP
// ---------------------------------------------------------------------------
// Photo capture and attachment PROPAGATION are asserted throughout the NC flow
// (nc-flow-turns.js and smoke-nc-turns.js both read getAttachmentCount() on the
// next actor's screen, specifically to prove a photo reaches the next
// responsible person). The RFI side has none of it, despite every RFI checklist
// item carrying the same "Capture Photo" box.
//
// So the question this answers is the same one the NC side already answers, and
// the one that actually matters: CI attaches a photo — do EE and QI see it?
//
// ---------------------------------------------------------------------------
// WHAT IS ALREADY KNOWN, AND MUST NOT BE RE-DERIVED
// ---------------------------------------------------------------------------
// RFIReviewPage.approve() carries the history in full, and one line of it
// governs this spec:
//
//   the app owner approved the SAME checklist manually with "No photos added"
//   on every item
//
// RFI checklist photos are therefore OPTIONAL, unlike NC's mandatory ones. An
// unfilled box is correct behaviour and is never asserted against here. What is
// asserted is what happens when a photo IS attached.
//
// ---------------------------------------------------------------------------
// HOW THE ATTACH IS OBSERVED — corrected 2026-09-11 from a live screenshot
// ---------------------------------------------------------------------------
// The first version counted "Use Camera" boxes and expected the count to DROP,
// on the reasoning that a filled item stops offering the control. Wrong: the
// run showed 16 boxes before AND after, and the failure screenshot showed why —
// item 1 rendered its thumbnail (with an `x` remove button) ALONGSIDE a
// still-present "Use Camera" box, because an item accepts MORE THAN ONE photo.
//
// The signal is therefore the IMAGE COUNT going up. The box count is still read
// and reported, since "16 boxes" is what proves the feature exists on this
// checklist at all, but it is not the pass/fail signal.
//
// MEASURED on pulse-test, 2026-09-11:
//
//   CI / before attach   photoBoxes=16 images=0 viewAttachmentsLabel=false
//   CI / after attach    photoBoxes=16 images=1 viewAttachmentsLabel=false
//   EE / review          photoBoxes=16 images=1 viewAttachmentsLabel=true
//
// So RFI DOES render a "View Attachments" label on the review side, as NC does
// — but unlike NC the thumbnail is also visible inline, so the image is
// countable without opening that expander. 16 boxes = one per checklist item.
//
// Every screen is still dumped (boxes, images, the label, any download control)
// because that is what turned a guess into the table above in a single run.
// Download stays REPORTED, never asserted: no download control has been seen on
// any screen yet.
//
// ---------------------------------------------------------------------------
// GROUND AND USERS
// ---------------------------------------------------------------------------
// featureGround.rfiCreate (BL11) — the RFI-creation-depth area SM23/SM24
// already consume, which is what this is. Each run spends one work section out
// of ~264.
//
// Smoke users via resolveSmokeUsers, like spec 33: the .env CI is measured at
// 7.9 min to log in, and using the chain's own users makes promotion to an SM*
// stage close to a copy. Built in tests/specs/ first per the spec-first rule.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const PROFILE_KEY = process.env.RECON_PROFILE || 'solar-e2e';

// Carried across the serial tests.
let rfiId = null;
let rfiCode = null;
let attachedAtItem = null;
const findings = [];

// Dumps everything about attachments on whatever screen is currently open, so a
// single run answers "what does the reviewer actually see".
async function describeAttachmentSurface(page, label) {
  const photoBoxes = await page.getByText('Use Camera', { exact: false }).count().catch(() => 0);
  const viewAttachments = await page
    .getByText('View Attachments', { exact: false }).first()
    .isVisible().catch(() => false);

  const scope = page.locator('form, [role="main"], main').first();
  const target = (await scope.count().catch(() => 0)) ? scope : page.locator('body');
  const images = await target.locator('img:not([alt*="logo" i])').count().catch(() => 0);

  // Any affordance that could be a download — recorded, not assumed to exist.
  const downloadish = await page
    .locator('a[download], button:has(svg.lucide-download), a[href*="blob:"], [aria-label*="download" i]')
    .count().catch(() => 0);

  const line =
    `${label}: photoBoxes=${photoBoxes} images=${images} ` +
    `viewAttachmentsLabel=${viewAttachments} downloadControls=${downloadish}`;
  console.log(`  ${line}`);
  findings.push({ label, photoBoxes, images, viewAttachments, downloadish });
  return { photoBoxes, images, viewAttachments, downloadish };
}

test.describe('RFI attachments — a photo CI attaches must reach EE and QI', () => {
  let profile, fixture, users, page, context;

  test.beforeAll(async ({ browser }) => {
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
    profile = getProfile(PROFILE_KEY);

    const area = profile.featureGround && profile.featureGround.rfiCreate;
    expect(area, `Profile "${profile.key}" declares no featureGround.rfiCreate area`).toBeTruthy();
    fixture = resolveRfiFixture(profile, { workArea: area });
    users = resolveSmokeUsers(profile, ['CI', 'EE', 'QI']);

    context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();

    console.log(
      `\n=== RFI attachments (G-14): "${profile.key}" ===\n` +
      `    ground    : ${fixture.baseData.workLocation} / ${area}\n` +
      `    checkpoint: ${fixture.checkpoint.name}\n` +
      `    CI ${users.CI.email}\n    EE ${users.EE.email}\n    QI ${users.QI.email}\n`
    );
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  // -------------------------------------------------------------------------
  test('CI attaches a photo to a checklist item and submits', async () => {
    test.setTimeout(20 * 60 * 1000);
    await loginAsFlowUser(page, users.CI.email, PASSWORD);

    // PICK A FREE WORK SECTION, LEARNING FROM THE SERVER'S OWN REJECTION.
    //
    // The obvious `fillPageOne(..., null)` means "take the FIRST option", which
    // is NOT the same as the first FREE one — framework doc section 11 records
    // this exact trap, and run 3 of this spec walked straight into it:
    //
    //   An RFI already exists for the workSections: R01-T01.
    //
    // R01-T01 is simply first in the list, and run 2 had already consumed it.
    // Re-running would fail identically forever.
    //
    // So: fill page 1 with '__skip__' (which deliberately stops short of the
    // irreversible Work Section pick), choose a section EXCLUDING everything
    // already known to be taken, and on a rejection parse the section name out
    // of the app's own message and try again without it. Same shape SM28 uses,
    // and the same thing the 9-TC engine does internally.
    const excluded = [];
    let rfiCreate = null;
    let outcome = null;
    let chosenSection = null;

    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const opened = await fillPageOne(page, fixture.baseData, fixture.checkpoint, '__skip__');
      rfiCreate = opened.rfiCreate;
      chosenSection = await rfiCreate.selectWorkSection(null, { exclude: excluded });

      outcome = await rfiCreate.clickProceedAndCheckOutcome();
      if (outcome.proceeded) {
        console.log(`  work section "${chosenSection}" accepted (attempt ${attempt})`);
        break;
      }

      // "An RFI already exists for the workSections: R01-T01."
      const taken = (outcome.toastText || '').match(/workSections?:\s*([^.]+)/i);
      const names = taken ? taken[1].split(',').map((x) => x.trim()).filter(Boolean) : [chosenSection];
      for (const n of names) if (n && !excluded.includes(n)) excluded.push(n);
      console.log(
        `  attempt ${attempt}: "${chosenSection}" refused — ${JSON.stringify(outcome.toastText)}; ` +
        `excluding [${excluded.join(', ')}] and retrying`
      );
      await resetToMyTasks(page);
    }

    expect(
      outcome && outcome.proceeded,
      `CI could not reach the checklist page after ${excluded.length + 1} work-section attempt(s). ` +
      `Excluded as already-used: [${excluded.join(', ')}]. ` +
      `Last app message: ${JSON.stringify((outcome || {}).toastText || '')}`
    ).toBe(true);

    const checklist = new RFIChecklistPage(page);
    // Observations first: expanding is what makes the photo boxes reachable,
    // and fillAllObservations already does the expand-all.
    const filled = await checklist.fillAllObservations('OK - attachment test (G-14)');
    expect(filled, 'the checklist should render at least one observation row').toBeGreaterThan(0);

    await describeAttachmentSurface(page, 'CI / before attach');

    const attach = await checklist.attachPhotoToFirstItem();

    // EVIDENCE BEFORE ASSERTIONS, and this is a correction. The first version
    // asserted first and dumped the "after" surface afterwards — so when the
    // assertion failed, the single most useful diagnostic never ran and the
    // screenshot had to be read by hand to find out what happened. Anything
    // gathered to explain a failure has to be gathered BEFORE the thing that
    // can fail.
    console.log(
      `  attach: photoBoxes ${attach.boxesBefore} -> ${attach.boxesAfter}, ` +
      `images ${attach.imagesBefore} -> ${attach.imagesAfter}`
    );
    await describeAttachmentSurface(page, 'CI / after attach');

    expect(
      attach.boxesBefore,
      'the RFI checklist should offer at least one "Capture Photo" box — if this is 0 the ' +
      'feature is not present on this checklist and G-14 needs re-scoping, not a fix here'
    ).toBeGreaterThan(0);

    // The IMAGE count is the signal, not the box count — see
    // RFIChecklistPage.attachPhotoToFirstItem for why the box legitimately stays.
    expect(
      attach.attached,
      `attaching a photo should add a thumbnail to the checklist (images were ` +
      `${attach.imagesBefore}, still ${attach.imagesAfter}). The capture itself may have ` +
      `silently no-op'd — see BasePage.capturePhoto, which documents the fake-stream ` +
      `timing hazard.`
    ).toBe(true);

    // Recorded as a fact about the app, not asserted as a requirement: an item
    // keeps offering "Use Camera" after a photo is added, because it accepts
    // more than one.
    console.log(
      `  note: the "Use Camera" box PERSISTS after attaching ` +
      `(${attach.boxesBefore} -> ${attach.boxesAfter}) — items accept multiple photos`
    );
    attachedAtItem = attach.imagesAfter - attach.imagesBefore;

    await checklist.submitRFI();
    const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
    expect(match, `Could not read an RFI id from the post-submit URL: ${page.url()}`).toBeTruthy();
    rfiId = match[1];
    rfiCode = await getVisibleCodeFor(page, rfiId);
    console.log(`  submitted ${rfiCode} (${rfiId}) with ${attachedAtItem} photo(s) attached`);
  });

  // -------------------------------------------------------------------------
  // EE AND QI ARE NOT SYMMETRIC OBSERVERS — corrected 2026-09-11.
  //
  // The first version looped over ['EE','QI'] and had each simply open the RFI
  // and look. EE passed; QI failed with
  //
  //   RFI RFI-S05b-BL11-CIV-48 not found in "Pending with me"
  //
  // because the RFI was still sitting WITH EE. After CI submits, the RFI is in
  // EE's queue and nowhere else; it only reaches QI once EE has APPROVED it.
  // Modelling the two as interchangeable ignored the flow the whole product is
  // built on. So EE now reads the attachment surface and then approves, which is
  // what actually hands the RFI to QI.
  async function assertAttachmentVisibleTo(role) {
    await loginAsFlowUser(page, users[role].email, PASSWORD);
    await openFromPendingWithMe(page, rfiCode);

    const review = new RFIReviewPage(page);
    await review.goToChecklistPage().catch(() => {});
    await review.expandAllChecklist().catch(() => {});
    await page.waitForTimeout(1500);

    const surface = await describeAttachmentSurface(page, `${role} / review`);

    // THE ASSERTION THIS SPEC EXISTS FOR. Everything else is reporting; this is
    // the propagation claim — the exact thing the NC side asserts and the RFI
    // side never has.
    expect(
      surface.images,
      `${role} should see the photo CI attached to the checklist, but found no image in the ` +
      `checklist region. Reported for this screen: ${JSON.stringify(surface)}. ` +
      `If "viewAttachmentsLabel" is true the photo may be behind that expander and this ` +
      `check would need to open it first (NC renders that way — see ` +
      `BasePage.getAttachmentCount); if every count is 0 the attachment genuinely did not ` +
      `reach ${role}, which is the defect G-14 was opened to look for.`
    ).toBeGreaterThan(0);

    return review;
  }

  test('EE sees the photo CI attached, then approves so it reaches QI', async () => {
    test.setTimeout(20 * 60 * 1000);
    expect(rfiCode, 'the CI step must have submitted an RFI first').toBeTruthy();

    const review = await assertAttachmentVisibleTo('EE');

    // Approving is what moves the RFI on. Without it QI has nothing to open —
    // which is precisely how the first run failed.
    await review.approve();
    console.log(`  EE approved ${rfiCode} — it should now be in QI's queue`);
    await resetToMyTasks(page).catch(() => {});
  });

  test('QI sees the same photo after EE has approved', async () => {
    test.setTimeout(20 * 60 * 1000);
    expect(rfiCode, 'the CI step must have submitted an RFI first').toBeTruthy();

    await assertAttachmentVisibleTo('QI');
    await resetToMyTasks(page).catch(() => {});
  });

  // -------------------------------------------------------------------------
  test('report what the attachment surface looks like on each screen', async () => {
    console.log('\n--- RFI attachment surface, per screen ---');
    for (const f of findings) {
      console.log(
        `  ${f.label.padEnd(22)} boxes=${String(f.photoBoxes).padEnd(3)} ` +
        `images=${String(f.images).padEnd(3)} viewAttachments=${f.viewAttachments} ` +
        `downloadControls=${f.downloadish}`
      );
    }

    // DOWNLOAD is reported, never asserted. No download affordance for RFI
    // attachments has ever been observed in this repo, and asserting one exists
    // would be inventing a requirement. If downloadControls is 0 everywhere,
    // that is the finding: there is nothing to download-test, and G-14's
    // "download" half is not applicable rather than uncovered.
    const anyDownload = findings.some((f) => f.downloadish > 0);
    console.log(
      anyDownload
        ? '  DOWNLOAD: a download-like control WAS found — worth a follow-up assertion.'
        : '  DOWNLOAD: no download control found on any screen. G-14\'s download half looks ' +
          'not-applicable rather than uncovered — confirm with the app owner before building for it.'
    );
    expect(findings.length, 'every screen should have been described').toBeGreaterThan(0);
  });
});
