const { test, expect } = require('../config/test-base');
const { loginAsFlowUser } = require('../utils/helpers');
const { resolveSmokeUsers } = require('../utils/smoke-users');
const { requireFeatureGround } = require('../config/projects');
const { attemptCheckpoint, resetToMyTasks } = require('../utils/rfi-dependency-flow');
const MyTasksPage = require('../pages/MyTasksPage');
const NCCreatePage = require('../pages/NCCreatePage');
const RFICreatePage = require('../pages/RFICreatePage');

// Feature stage SM28: RULE R2a — A NON-APPROVED NC BLOCKS RFI ON THE SAME TRIPLE.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS
// ---------------------------------------------------------------------------
// R2a is one of the three rules the whole smoke chain's ground allocation is
// built around (docs/smoke-e2e-framework.md §4.1, and
// docs/app-owner-decisions-and-conventions.md §3.2). Verbatim, from the app
// owner: if an NC exists in a non-approved state for a given
//
//     (activity / sub-activity, inspection checkpoint, work section)
//
// then CI **cannot create or resubmit an RFI** for that same triple. Note the
// scope: the FULL triple, not the work area. A different work section, or a
// different activity on the SAME work section, is unaffected.
//
// Until now the suite only ever DESIGNED AROUND that rule — the NC flow areas
// are disjoint from the RFI ones precisely because of it, and the chain orders
// the RFI flows before the NC flows for the same reason. Nothing asserted it.
// So a regression that removed the block entirely would have passed every test
// in this repository, while quietly making a documented data-integrity
// guarantee untrue. That gap is what this stage closes.
//
// ---------------------------------------------------------------------------
// THE SHAPE OF THE PROOF — the control arm is not optional
// ---------------------------------------------------------------------------
// "The RFI was refused" on its own proves very little: a broken form, a missing
// WAM row and a genuinely-enforced rule all look identical from the outside. So
// the stage always runs BOTH arms, in this order:
//
//   1. CI finds a work section that is genuinely RFI-AVAILABLE right now, and
//      releases it again (proving the release worked by re-offering it).
//   2. QI raises an NC pinned to that exact section, and leaves it
//      non-approved — which is the precondition the rule is about.
//   3. CI attempts an RFI on that exact triple           -> must be REFUSED.
//   4. CI attempts one on a DIFFERENT work section,
//      same activity and checkpoint                      -> must SUCCEED.
//
// Step 4 is what makes step 3 mean something. Without it, a stage that failed
// for any unrelated reason would report the rule as "confirmed".
//
// Step 1 matters for the same kind of reason. An RFI permanently CONSUMES its
// work section (rule R1), so a section that is absent from the picker in step 3
// looks the same whether the NC blocked it or an earlier run had already spent
// it. Establishing availability immediately before the NC is created — and
// re-opening the form to prove the section came back — removes that ambiguity,
// so a "not offered" result in step 3 can only mean the block.
//
// ---------------------------------------------------------------------------
// GROUND: featureGround.ncBlock (BL06 for solar)
// ---------------------------------------------------------------------------
// This stage DELIBERATELY LEAVES A NON-APPROVED NC BEHIND. That is not
// untidiness — it is the precondition, and cleaning it up would destroy what
// the rule is about. So it must run on ground no flow stage uses. See
// featureGround.ncBlock in tests/config/projects.js for why BL06 is the right
// area (already provisioned by SM03, already claimed against the flow
// fallthrough pool, and free since SO demapping moved to DRS).
//
// RE-RUNNABLE INDEFINITELY. Each run spends exactly one work section (the
// control arm's RFI, in step 4); solar carries ~264-490 per area. The NC arm
// spends nothing — duplicate NCs against identical details are legal — so a
// second run simply raises another NC against the same section and re-proves
// the same block.
//
// ---------------------------------------------------------------------------
// SESSION MODEL
// ---------------------------------------------------------------------------
// One page, re-logged-in between roles (CI -> QI -> CI), the way SM07 does it
// rather than SM05/SM06's three parallel sessions. There is nothing to
// round-robin here: every step strictly depends on the previous one having
// happened, so a serial single page is both simpler and correct.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Carried between the serial tests below. `blockedWorkSection` is the whole
// point of the stage: step 1 discovers it, step 2 pins the NC to it, step 3
// asserts CI is locked out of it.
let blockedWorkSection = null;
let ncId = null;

test.describe('Smoke stage SM28 - a non-approved NC blocks RFI on the same triple', () => {
  let context, page, profile, ci, qi, area, data, baseData, checkpoint;

  test.beforeAll(async ({ browser, profile: p }) => {
    profile = p;
    const ground = requireFeatureGround(profile);

    // Fails loudly rather than skipping, the same way SM06 does on `nc: null`
    // and SM07 on `dependencyChain: null`. A silent skip here would report a
    // rule as covered when nothing ran.
    expect(
      profile.ncBlock,
      `Profile "${profile.key}" has no ncBlock data. This is deliberate for wind ` +
      `(RFI/NC parked) and for the regression tier (this stage leaves a non-approved ` +
      `NC behind and must never touch regression ground) — see tests/config/projects.js.`
    ).toBeTruthy();
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

    data = profile.ncBlock;
    area = ground.ncBlock || data.workArea;
    expect(
      area,
      `Profile "${profile.key}" declares no featureGround.ncBlock area, and this stage ` +
      `must not run on flow ground — it leaves a non-approved NC in place on purpose.`
    ).toBeTruthy();

    // The RFI side of the same triple. Built from profile.ncBlock rather than
    // from profile.rfi on purpose: the NC and the RFI have to name the SAME
    // activity for the rule to apply at all, and profile.rfi / profile.nc
    // deliberately name different ones so the flows never block each other.
    baseData = {
      workLocation: data.workLocation,
      workArea: area,
      package: data.package,
      subPackage: data.subPackage,
      activity: data.activity,
      subActivity: data.subActivity,
    };
    checkpoint = { name: data.checkpoint, checklist: data.checklist };

    const users = resolveSmokeUsers(profile, ['CI', 'QI']);
    ci = users.CI;
    qi = users.QI;

    context = await browser.newContext({
      permissions: ['geolocation', 'camera'],
      geolocation: { latitude: 23.0225, longitude: 72.5714 },
    });
    page = await context.newPage();

    console.log(
      `\n=== SM28 NC-blocks-RFI (rule R2a): "${profile.key}" ===\n` +
      `    CI        : ${ci.name} <${ci.email}>\n` +
      `    QI        : ${qi.name} <${qi.email}>\n` +
      `    ground    : ${data.workLocation} / ${area} / ${data.package}  (sacrificial — an unapproved NC is LEFT here)\n` +
      `    triple    : ${data.activity} / ${data.subActivity} / ${data.checkpoint}\n`
    );
  });

  test.afterAll(async () => {
    if (context) await context.close();
  });

  // -------------------------------------------------------------------------
  test('CI finds a work section that is RFI-available now, and releases it again', async () => {
    test.setTimeout(20 * 60 * 1000);

    await loginAsFlowUser(page, ci.email, PASSWORD);

    const openCreateForm = async () => {
      await resetToMyTasks(page);
      const myTasks = new MyTasksPage(page);
      await myTasks.waitForLoad();
      await myTasks.clickCreateRFI();
      const rfiCreate = new RFICreatePage(page);
      // '__skip__' fills page 1 without touching the Work Section multi-select
      // — selecting a section is the irreversible half of this form, so it is
      // done explicitly below rather than as a side effect of filling.
      await rfiCreate.fillForm({
        ...baseData,
        inspectionCheckpoint: checkpoint.name,
        inspectionChecklist: checkpoint.checklist,
        workSection: '__skip__',
      });
      return rfiCreate;
    };

    // First open: take whatever is free.
    let rfiCreate = await openCreateForm();
    const summary = await rfiCreate.readWorkSectionSummary().catch(() => null);
    if (summary) {
      console.log(`  work section summary: total=${summary.total} selected=${summary.selected} pending=${summary.pending}`);
    }
    const section = await rfiCreate.selectWorkSection(null);
    expect(section, 'CI should be offered at least one free work section on this triple').toBeTruthy();
    console.log(`  candidate work section: "${section}"`);

    // Release it. resetToMyTasks discards the form via the "Are you sure you
    // want to Cancel RFI?" popup, and CONFIRMING that popup is what actually
    // frees the section (see discardCreateForm in rfi-dependency-flow.js).
    await resetToMyTasks(page);

    // Prove the release worked, by asking for the SAME section by name.
    // selectWorkSection throws a tagged WORK_SECTION_NOT_FOUND if it is not
    // offered, so this is a real check and not a formality.
    //
    // This is what makes step 3's result unambiguous: a section missing from
    // the picker there can only be the NC's block, never our own probe having
    // quietly consumed it.
    rfiCreate = await openCreateForm();
    const reoffered = await rfiCreate.selectWorkSection(section);
    expect(
      reoffered,
      `Work section "${section}" was not re-offered after cancelling the form, so it was ` +
      `CONSUMED rather than released. Every later step here depends on it being free, and ` +
      `a "blocked" result would be indistinguishable from a consumed one.`
    ).toBeTruthy();
    await resetToMyTasks(page);

    blockedWorkSection = section;
    console.log(`  confirmed RFI-available and released: "${blockedWorkSection}"`);
  });

  // -------------------------------------------------------------------------
  test('QI raises an NC pinned to that exact work section, and leaves it non-approved', async () => {
    test.setTimeout(20 * 60 * 1000);
    expect(blockedWorkSection, 'the previous step must have recorded a work section').toBeTruthy();

    await loginAsFlowUser(page, qi.email, PASSWORD);

    const ncCreate = new NCCreatePage(page);
    await ncCreate.goto();
    await ncCreate.clickCreateNC();

    // preferredWorkSections is what pins the NC to the section CI just proved
    // free. Without it, NC creation takes the first available one, which on
    // ground an earlier run has touched need not be the same section — and the
    // whole stage turns into two unrelated operations that prove nothing.
    const picked = await ncCreate.fillForm({
      workLocation: data.workLocation,
      workArea: area,
      vendorName: data.vendorName,
      package: data.package,
      activity: data.activity,
      subActivity: data.subActivity,
      workSectionCount: data.workSectionCount,
      preferredWorkSections: [blockedWorkSection],
      ncQuantity: data.ncQuantity,
      unit: data.unit,
      ncDescription: `Smoke SM28 - R2a block check on ${blockedWorkSection}`,
      defectType: data.defectType,
      category: data.category,
      targetDateClosureDays: data.targetDateClosureDays,
    });

    // If the NC landed somewhere else, everything below is meaningless — the
    // RFI would then be attempted on a section no NC touches, and the expected
    // outcome inverts. Fail here, where the cause is readable.
    expect(
      picked,
      `NC creation selected no work section at all (expected "${blockedWorkSection}")`
    ).toBeTruthy();
    // EXACT match, deliberately, not `.includes()`.
    //
    // preferredWorkSections resolves through Playwright's `hasText`, which is a
    // SUBSTRING match — so asking for "R01-T2" can legitimately land on
    // "R01-T20". A substring assertion here would then agree with itself and
    // the whole stage would silently measure the wrong section: the NC on one,
    // the blocked-RFI attempt on another, and a guaranteed "not blocked"
    // result read as a rule violation.
    expect(
      picked.map((s) => s.trim()),
      `The NC had to land on the SAME work section CI just proved free ("${blockedWorkSection}") ` +
      `for rule R2a to be testable, but it selected ${JSON.stringify(picked)} instead. ` +
      `(preferredWorkSections matches by substring, so a near-miss like R01-T2 vs R01-T20 lands ` +
      `here rather than passing quietly.) Nothing below would be measuring the rule.`
    ).toContain(blockedWorkSection.trim());

    await ncCreate.submitNC();
    const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
    expect(match, `Could not read an NC id from the post-submit URL: ${page.url()}`).toBeTruthy();
    ncId = match[1];

    // A freshly created NC sits at V1 awaiting CI's response — i.e. it is
    // NON-APPROVED, which is precisely the state rule R2a is about. It is
    // deliberately left that way.
    console.log(`  NC ${ncId} created on "${blockedWorkSection}" and left non-approved`);
  });

  // -------------------------------------------------------------------------
  test('CI is REFUSED an RFI for that same activity, checkpoint and work section', async () => {
    test.setTimeout(20 * 60 * 1000);
    expect(ncId, 'the NC must have been created before this can mean anything').toBeTruthy();

    await loginAsFlowUser(page, ci.email, PASSWORD);

    // Two legitimate shapes of "blocked", and both count:
    //
    //   * the work section is no longer OFFERED in the picker — the app
    //     filtering it out up front. selectWorkSection throws a tagged
    //     WORK_SECTION_NOT_FOUND for this, which is why it is caught rather
    //     than allowed to fail the test.
    //   * the section is offered, and Proceed is refused with a validation
    //     message. clickProceedAndCheckOutcome reports that as
    //     { proceeded: false, toastText }.
    //
    // Which one the app does is NOT asserted — it is recorded. The rule is
    // about CI being unable to raise the RFI, not about how the app says so,
    // and pinning the presentation would make this fail on a cosmetic change.
    let blockedBy = null;
    let toastText = '';
    let proceeded = false;

    try {
      const outcome = await attemptCheckpoint(page, baseData, checkpoint, blockedWorkSection);
      proceeded = outcome.proceeded;
      toastText = outcome.toastText || '';
      if (!proceeded) blockedBy = 'proceed-refused';
    } catch (err) {
      if (err.workSectionNotFound) {
        blockedBy = 'section-not-offered';
        console.log(`  work section "${blockedWorkSection}" is no longer offered to CI at all`);
      } else {
        throw err;
      }
    }

    // Release whatever the attempt selected, so a re-run starts from the same
    // state this one did.
    await resetToMyTasks(page);

    expect(
      proceeded,
      `RULE R2a IS NOT HOLDING. A non-approved NC (${ncId}) exists for ` +
      `${data.activity} / ${data.subActivity} / ${data.checkpoint} on work section ` +
      `"${blockedWorkSection}", so CI must NOT be able to raise an RFI for that same ` +
      `triple — but the create form proceeded to the checklist page. The previous step ` +
      `proved the section was RFI-available before the NC existed, and the next step ` +
      `proves an unaffected section still works, so this is the rule itself, not setup. ` +
      `See docs/smoke-e2e-framework.md rule R2a.`
    ).toBe(false);

    console.log(`  CONFIRMED blocked (${blockedBy})${toastText ? ` — app said: "${toastText}"` : ''}`);
  });

  // -------------------------------------------------------------------------
  test('CI CAN still raise an RFI for the same checkpoint on a DIFFERENT work section', async () => {
    test.setTimeout(20 * 60 * 1000);
    expect(blockedWorkSection, 'the blocked work section must be known').toBeTruthy();

    // The control arm. Without it, the refusal above is equally consistent
    // with a broken form, a missing WAM row, or bad profile data — none of
    // which R2a has anything to do with.
    await resetToMyTasks(page);
    const myTasks = new MyTasksPage(page);
    await myTasks.waitForLoad();
    await myTasks.clickCreateRFI();

    const rfiCreate = new RFICreatePage(page);
    await rfiCreate.fillForm({
      ...baseData,
      inspectionCheckpoint: checkpoint.name,
      inspectionChecklist: checkpoint.checklist,
      workSection: '__skip__',
    });

    // `exclude` rather than "first available": the blocked section may well
    // still be first in the list, and picking it would re-run the previous
    // test instead of controlling for it.
    const controlSection = await rfiCreate.selectWorkSection(null, { exclude: [blockedWorkSection] });
    expect(controlSection, 'a second, unaffected work section should be available').toBeTruthy();
    expect(controlSection).not.toBe(blockedWorkSection);

    const outcome = await rfiCreate.clickProceedAndCheckOutcome();
    expect(
      outcome.proceeded,
      `The control arm failed: CI could not raise an RFI on work section "${controlSection}" ` +
      `either, for the same activity and checkpoint that has no NC against it. ` +
      `${outcome.toastText ? `The app said: "${outcome.toastText}". ` : ''}` +
      `That means the refusal in the previous test cannot be attributed to rule R2a — ` +
      `something is blocking RFI creation on this ground generally.`
    ).toBe(true);

    console.log(
      `  CONFIRMED scoped: "${blockedWorkSection}" is blocked, "${controlSection}" is not — ` +
      `the block is keyed on the work section, not the work area`
    );

    await resetToMyTasks(page);
  });

  // -------------------------------------------------------------------------
  test('PROBE (reported, never asserted): the blocked section under a different activity', async () => {
    test.setTimeout(20 * 60 * 1000);

    // R2a's second half, per the app owner: CI can raise an RFI on the blocked
    // work section itself if the ACTIVITY or SUB-ACTIVITY differs, because a
    // different activity is a different triple.
    //
    // REPORTED, NOT ASSERTED, and deliberately so. Two things about it are
    // genuinely unconfirmed: whether the other activity even shares this work
    // section's inventory, and what ITS first checkpoint's own dependency state
    // is. A negative result here could mean either of those rather than a
    // broken rule, so asserting would make an unconfirmed assumption fail the
    // run. Every outcome is logged; none fails the test.
    if (!data.otherActivity) {
      console.log('  PROBE skipped: profile.ncBlock declares no otherActivity');
      return;
    }

    let verdict;
    try {
      await resetToMyTasks(page);
      const myTasks = new MyTasksPage(page);
      await myTasks.waitForLoad();
      await myTasks.clickCreateRFI();

      const rfiCreate = new RFICreatePage(page);
      // '__first__' for the checkpoint and checklist: the other activity's own
      // checkpoint names are not recorded anywhere in this repo, and guessing
      // them would fail for a reason that has nothing to do with the probe.
      await rfiCreate.fillForm({
        ...baseData,
        activity: data.otherActivity,
        subActivity: data.otherSubActivity || data.otherActivity,
        inspectionCheckpoint: '__first__',
        inspectionChecklist: '__first__',
        workSection: '__skip__',
      });

      const label = await rfiCreate.selectWorkSection(blockedWorkSection);
      const outcome = await rfiCreate.clickProceedAndCheckOutcome();
      verdict = outcome.proceeded
        ? `NOT BLOCKED under "${data.otherActivity}" on the same section "${label}" — consistent with R2a's per-triple scope`
        : `blocked under "${data.otherActivity}" too${outcome.toastText ? ` ("${outcome.toastText}")` : ''} — INCONCLUSIVE, could be that activity's own checkpoint dependency rather than the NC`;
    } catch (err) {
      verdict = err.workSectionNotFound
        ? `INCONCLUSIVE: "${blockedWorkSection}" is not in "${data.otherActivity}"'s work section list at all, so the two activities do not share this section`
        : `INCONCLUSIVE: ${err.message.split('\n')[0]}`;
    }

    console.log(`  PROBE (different activity, same work section): ${verdict}`);
    await resetToMyTasks(page).catch(() => {});
  });
});
