const { test, expect } = require('../config/test-base');
const { loginAsFlowUser, stripLabelPrefix } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const { fillPageOne, getVisibleCodeFor, discardCreateForm } = require('../utils/rfi-dependency-flow');
const { openFromPendingWithMe } = require('../utils/rfi-nav');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');

// Stage 5 of the E2E smoke chain: the RFI flow for one project type, driven by
// the users stages 1-3 created, SO-mapped and WAM'd. CI creates and submits ->
// EE approves -> QI approves.
//
// ---------------------------------------------------------------------------
// WHAT THIS REUSES, AND WHAT IT DELIBERATELY DOES NOT
// ---------------------------------------------------------------------------
// REUSED from tests/utils/rfi-dependency-flow.js (tracker-free, and neither
// function logs anybody in, so they are safe for wind's own credentials):
//   fillPageOne(page, baseData, checkpoint, workSectionLabel)
//     — includes resetToMyTasks(), which is the CORRECTED draft discard
//       (Cancel *and* confirm the resulting popup). rfi-flow-turns.js's
//       createNewRfi has an inline version that clicks Cancel but never
//       confirms, leaving the draft — and the Work Section it holds — alive.
//       Harmless on solar, which has many Work Sections per area; on wind that
//       silently burns the ONLY one.
//   getVisibleCodeFor(page, rfiId) — the dashboard-first re-read that dodges
//       the DRAFT-placeholder code race.
//
// NOT imported: tests/utils/rfi-flow-turns.js. It requires ./tracker-utils at
// MODULE scope (line 7), so importing even one clean function from it would
// pull the solar 9-TC tracker into this file's module graph. This stage must
// never read or write tests/fixtures/rfi-tracker.json — same isolation
// convention as 23_rfi_data_integrity.spec.js and 29/30_rfi_activity_*.
//
// NOT used: rfi-dependency-flow's own approveAsRole / runDependencyChain*
// drivers, and rfi-flow-turns' withLoginRetryOnStaleWorkSection. All of them
// call loginAsRole(page, role), which reads CI_EMAIL/EE_EMAIL/QI_EMAIL from
// .env — i.e. the SOLAR users. Calling any of them mid-wind-flow would
// silently swap in the wrong user. The review step is therefore written out
// here against loginAsFlowUser + openFromPendingWithMe + RFIReviewPage.
//
// NOT used: 21_rfi_flow_single_session.spec.js's model of three concurrent
// browser contexts. The app is one-session-at-a-time; this stage uses ONE page
// and hops roles sequentially, like specs 08/23/29.
//
// ---------------------------------------------------------------------------
// WHY THIS STAGE IS NOT IDEMPOTENT (unlike s01-s03)
// ---------------------------------------------------------------------------
// Wind has exactly ONE Work Section per Work Area, and it is the Work Area's
// own name (confirmed live: Work Area "KH 34" => Work Section "KH 34"). Per
// docs/rfi-activity-dependency-chain.md, merely SELECTING a Work Section
// permanently consumes that (checkpoint, Work Section) pair — submitting is not
// required. So there is no spare section to retry with, and each run spends one
// checkpoint of profile.rfi.checkpointChain. The chain has 5 entries, giving
// roughly 5 runs before this activity is exhausted and a fresh Work Area is
// needed (which would first have to be SO-mapped and WAM'd — a CI only sees
// work areas it was WAM'd onto).
//
// Consequences encoded below:
//   * The walk covers (WORK AREA x CHECKPOINT), most-preferred area first, and
//     takes the first pair that is genuinely free. Several work areas are
//     provisioned (stages 2 and 3 map and WAM them all) precisely so the stage
//     keeps working as pairs are used up.
//   * WITHIN an area the walk STOPS at the first DEPENDENCY block. Wind enforces
//     the preceding-checkpoint rule, so if checkpoint N is blocked then N+1..end
//     are transitively blocked too — and each attempt still selects the Work
//     Section, consuming that pair. An earlier version continued through them
//     and burned all five of KH 35's pairs in one run for nothing. A DUPLICATE
//     block ("An RFI already exists for the workSections") is different: that
//     pair was already spent, so the walk moves to the next checkpoint.
//   * fillPageOne is called AT MOST ONCE per (area, checkpoint).
//     RFICreatePage.fillForm ends in an unconditional selectWorkSection, so any
//     retry wrapper that re-runs it would burn another pair. There is
//     deliberately no withRetry here.
//   * The solar stale-Work-Section remedy (relogin and retry) does NOT apply. On
//     solar "An RFI already exists for the workSections: X" is a known
//     cookies-not-cleared symptom; on wind it is the literal truth, so retrying
//     would loop forever.
test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;

// Shared across the serial tests: what CI created, for EE and QI to act on.
//
// Seeded from SMOKE_RFI_CODE at MODULE scope, not inside the CI test, so that
// running a subset (e.g. `--grep "QI approves"`) still has the code available
// even though the CI test never executes.
const created = {
  rfiId: null,
  workArea: null,
  rfiCode: process.env.SMOKE_RFI_CODE || null,
  checkpoint: process.env.SMOKE_RFI_CODE ? { code: '(pre-existing)', subActivity: '(pre-existing)' } : null,
  observationCount: null,
};

// Describe title deliberately avoids the words "CI"/"EE"/"QI approves": the
// per-role tests below are generated from one template, and a describe title
// containing those phrases makes `--grep "QI approves"` match EVERY test in the
// file (grep tests the full title path, describe included), which silently runs
// the roles you were trying to exclude.
test.describe('Smoke stage 5 - RFI flow end to end', () => {
  let profile, users;

  test.beforeAll(async ({ profile: p }) => {
    profile = p;
    expect(profile.rfi, `Profile "${profile.key}" has no rfi data — see tests/config/projects.js`).toBeTruthy();
    expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();

    const recorded = loadLastCreatedUsers();
    users = {};
    for (const roleKey of ['CI', 'EE', 'QI']) {
      const prefix = profile.users.prefixes[roleKey];
      const entry = recorded[prefix];
      expect(
        entry && entry.profileKey === profile.key,
        `No recorded ${roleKey} user (prefix "${prefix}") for profile "${profile.key}" — run the earlier smoke stages first.`
      ).toBeTruthy();
      users[roleKey] = entry;
    }

    console.log(
      `\n=== Smoke RFI flow: "${profile.key}" @ ${profile.rfi.workLocation} ` +
      `/ ${profile.rfi.package} / ${profile.rfi.subPackage} / ${profile.rfi.activity} ===\n` +
      `    work area per viewport: ${JSON.stringify(profile.flowWorkAreas || profile.primaryWorkArea)}`
    );
    for (const k of ['CI', 'EE', 'QI']) console.log(`    ${k}: ${users[k].name} <${users[k].email}>`);
    console.log('');
  });

  // Page-1 data for one checkpoint. subActivity varies per checkpoint (the
  // activity master's rows are 1:1 with (Sub-Activity, Checkpoint) pairs, and
  // the form's Checkpoint dropdown is scoped by the selected Sub-Activity), so
  // it cannot live in a single flat constant.
  const baseDataFor = (cp, workArea) => ({
    workLocation: profile.rfi.workLocation,
    workArea,
    package: profile.rfi.package,
    subPackage: profile.rfi.subPackage,
    activity: profile.rfi.activity,
    subActivity: cp.subActivity,
    // All three null for now — unconfirmed whether wind requires them.
    // fillForm skips null values entirely.
    rfiQuantity: profile.rfi.rfiQuantity,
    unit: profile.rfi.unit,
    subContractor: profile.rfi.subContractor,
  });

  // The desktop and mobile flow runs deliberately use DIFFERENT Work Areas.
  //
  // Wind has exactly one Work Section per Work Area and a run consumes that
  // (checkpoint, Work Section) pair permanently, so if both viewports shared an
  // area they would eat each other's checkpoints and neither could be re-run
  // independently. profile.flowWorkAreas assigns one per viewport; the same CI
  // is SO-mapped and WAM'd on both (stages 2 and 3 iterate profile.workAreas),
  // so the SAME activity and checkpoint chain works in either.
  //
  // Falls back to primaryWorkArea for a profile that doesn't split them (solar
  // has many Work Sections per area, so it does not need to).
  // The ORDERED POOL of work areas this viewport should try, most-preferred
  // first. profile.flowWorkAreas gives each viewport its own preference list so
  // the two normally stay out of each other's way; the remaining areas are
  // appended as fallback so a viewport whose own areas are spent keeps working
  // instead of failing.
  const resolveWorkAreaPool = (isMobile) => {
    const all = (profile.workAreas || []).filter(Boolean);
    const map = profile.flowWorkAreas;
    const preferredRaw = map ? (isMobile ? map.mobile : map.desktop) : null;
    const preferred = (Array.isArray(preferredRaw) ? preferredRaw : [preferredRaw]).filter(Boolean);
    const rest = all.filter(a => !preferred.includes(a));
    const pool = [...preferred, ...rest];
    return pool.length ? pool : [profile.primaryWorkArea || profile.rfi.workArea].filter(Boolean);
  };

  // Single most-preferred area — used by the EE/QI review-screen assertion,
  // which only needs to know what CI actually used (recorded in `created`).
  const resolveWorkArea = (isMobile) => resolveWorkAreaPool(isMobile)[0];

  // Wind's single Work Section is NAMED AFTER its Work Area, so it must track
  // whichever area this run resolved to. profile.rfi.workSection is null for
  // wind precisely so this cannot be hardcoded to the desktop area.
  const resolveWorkSection = (workArea) => profile.rfi.workSection || workArea;

  test('CI creates and submits a wind RFI on the next free checkpoint', async ({ page, isMobileViewport }) => {
    // Three PWA logins across this file at up to ~6 minutes each, plus form and
    // grid work — the config's 10-minute default is not enough.
    test.setTimeout(25 * 60 * 1000);

    // SMOKE_RFI_CODE lets this stage act on an RFI that ALREADY exists and is
    // pending with EE, skipping creation entirely.
    //
    // This exists because creation is the expensive, irreversible half: each
    // run permanently consumes one of only ~5 (checkpoint, "KH 34") pairs. When
    // iterating on the EE/QI review steps — which is where the fiddly UI work
    // is — re-creating an RFI every attempt would exhaust the activity in a
    // handful of debug cycles for no benefit.
    if (process.env.SMOKE_RFI_CODE) {
      console.log(
        `\n  >>> SMOKE_RFI_CODE set — skipping creation and reviewing ` +
        `${created.rfiCode} instead. No checkpoint is consumed.\n`
      );
      test.skip(true, 'SMOKE_RFI_CODE supplied; reusing an existing RFI');
      return;
    }

    await loginAsFlowUser(page, users.CI.email, PASSWORD);

    const chain = profile.rfi.checkpointChain;
    const pool = resolveWorkAreaPool(isMobileViewport);
    console.log(
      `  viewport: ${isMobileViewport ? 'MOBILE' : 'desktop'} -> ` +
      `work area pool (in order): ${JSON.stringify(pool)}\n`
    );
    const attempts = [];

    // Walk (work area x checkpoint), not just checkpoints.
    //
    // One area yields about as many runs as the activity has checkpoints (5 for
    // Crane Pad), because each run permanently consumes one (checkpoint, Work
    // Section) pair and wind has exactly one Work Section per area. Walking the
    // pool as well means the stage keeps working across roughly
    // pool.length x chain.length runs instead of failing the moment one area is
    // spent — the app owner's instruction, and why stages 2 and 3 now provision
    // several areas at once.
    outer:
    for (const workArea of pool) {
      const workSection = resolveWorkSection(workArea);
      console.log(`\n  ===== work area "${workArea}" (work section "${workSection}") =====`);

      for (const cp of chain) {
        console.log(`  --- attempting ${cp.code} [${cp.subActivity}] "${cp.checkpoint}" ---`);

      // AT MOST ONE fillPageOne per (work area, checkpoint) — see the header
      // comment. Never retried for the same pair.
      let rfiCreate;
      try {
        // '__skip__' fills page 1 WITHOUT touching the Work Section, so the
        // form's own summary can be consulted first. See the pre-check below.
        ({ rfiCreate } = await fillPageOne(
          page, baseDataFor(cp, workArea), { name: cp.checkpoint, checklist: cp.checklist }, '__skip__'
        ));
      } catch (err) {
        const msg = String(err && err.message || err);
        attempts.push({ workArea, code: cp.code, stage: 'fillPageOne', error: msg.split('\n')[0] });
        // A Work Section that no longer exists for this checkpoint means this
        // pair is already spent; move on. Anything else is a real failure and
        // should not be swallowed.
        if (err && (err.workSectionNotFound || /work section/i.test(msg))) {
          console.log(`      already consumed / unavailable: ${msg.split('\n')[0]}`);
          continue;
        }
        throw err;
      }

      // ---- PRE-CHECK: ask the form before touching anything ----
      //
      // The form has a "Work Section Summary" panel — Total Work Sections /
      // Work Sections Selected for RFI / Work Sections Pending RFI — which tells
      // us whether this checkpoint still has a free Work Section, and it is
      // readable BEFORE any selection.
      //
      // Consulting it means we no longer attempt a create just to be told "An RFI
      // already exists for the workSections: X". That attempt was not creating
      // duplicates — the app correctly rejected it — but it filled nine
      // dropdowns, touched the Work Section, and needed a Cancel+confirm to undo,
      // all to learn something the form was already displaying.
      //
      // `pending === 0` is the skip signal. A null means the panel could not be
      // parsed, and is treated as UNKNOWN — fall through and attempt, never
      // assume zero.
      const summary = await rfiCreate.readWorkSectionSummary().catch(() => null);
      if (summary) {
        console.log(
          `      work section summary: total=${summary.total} ` +
          `selectedForRfi=${summary.selected} pendingRfi=${summary.pending}`
        );
      }
      if (summary && summary.pending === 0) {
        console.log('      -> no Work Section left pending for this checkpoint; skipping without touching it');
        attempts.push({ workArea, code: cp.code, stage: 'pre-check', summary, skipped: true });
        await discardCreateForm(page).catch(() => false);
        continue;
      }

      // Only now commit to the Work Section.
      try {
        await rfiCreate.selectWorkSection(workSection);
      } catch (err) {
        const msg = String(err && err.message || err);
        console.log(`      could not select work section "${workSection}": ${msg.split('\n')[0]}`);
        attempts.push({ workArea, code: cp.code, stage: 'selectWorkSection', error: msg.split('\n')[0] });
        await discardCreateForm(page).catch(() => false);
        continue;
      }

      const outcome = await rfiCreate.clickProceedAndCheckOutcome();
      if (!outcome.proceeded) {
        const toast = String(outcome.toastText || '');
        console.log(`      BLOCKED: "${toast}"`);
        attempts.push({ workArea, code: cp.code, stage: 'proceed', blocked: true, toast });

        // RELEASE THE WORK SECTION IMMEDIATELY, before doing anything else.
        //
        // App owner: navigating away from a filled create form AUTOSAVES a draft
        // and permanently consumes the Work Section it holds — but clicking
        // Cancel AND confirming the "are you sure you want to cancel RFI?" popup
        // RELEASES it. So a blocked attempt only costs a Work Section if the form
        // is abandoned sloppily. Discarding it properly right here is what makes
        // the walk non-destructive.
        //
        // Done at the point of the block rather than relying on the next
        // iteration's resetToMyTasks, because the walk may `break` out entirely
        // and never reach another iteration.
        const released = await discardCreateForm(page).catch(() => false);
        console.log(`      work section released via Cancel+confirm: ${released}`);

        // THE TOAST REASON DECIDES WHETHER TO WALK ON OR ABANDON THIS AREA, and
        // getting this wrong is expensive. Three distinct messages, all captured
        // live 2026-08-31:
        //
        //  1. "An RFI already exists for the workSections: KH 35."
        //     -> DUPLICATE. This (checkpoint, Work Section) pair is already
        //        used, which is normal on a re-run. Nothing extra is consumed by
        //        having asked, so move to the NEXT CHECKPOINT.
        //
        //  2. "A RFI with for the Inspection point: <X> of Activity <Y> is
        //      either pending or rejected"
        //     -> the predecessor EXISTS but is not APPROVED.
        //
        //  3. "Missing an RFI for Dependent Inspection Point: <X> of the
        //      Activity: <Y>"
        //     -> the predecessor does not exist at all.
        //
        // For 2 and 3 every LATER checkpoint in this work area is transitively
        // blocked too, and — critically — each attempt still SELECTS the Work
        // Section, which consumes that pair permanently. An earlier version of
        // this walk continued through them and burned all five of KH 35's pairs
        // in a single run for nothing. So: abandon this work area and move to
        // the next one.
        if (/already exists for the workSections/i.test(toast)) {
          console.log('      -> duplicate: pair already used, trying the next checkpoint');
          continue;
        }
        if (/is either pending or rejected/i.test(toast)) {
          console.log(
            `      -> this area has an UNFINISHED RFI on the previous checkpoint ` +
            `(pending or rejected). Everything after it is blocked, so abandoning ` +
            `"${workArea}". Finish that RFI (EE+QI approve) to unblock this area — ` +
            `SMOKE_RFI_CODE=<its code> runs just the review steps.`
          );
          break;
        }
        if (/Missing an RFI for Dependent Inspection Point/i.test(toast)) {
          console.log(`      -> dependency not built in "${workArea}"; abandoning this area`);
          break;
        }
        // Unrecognised block reason: treat it like a dependency block (abandon
        // the area rather than burn the rest of its pairs), but say so loudly so
        // a new message shape gets noticed instead of silently absorbed.
        console.log('      -> UNRECOGNISED block reason; abandoning this work area defensively');
        break;
      }

      console.log(`      proceeded to the checklist page`);

      const checklist = new RFIChecklistPage(page);
      const filled = await checklist.fillAllObservations(
        profile.rfi.observationValue, true,
        // The bookend checkpoints' only checklist is the generic "Documents and
        // report information", which may legitimately have no observation rows.
        { requireObservations: cp.expectObservations !== false }
      );
      console.log(`      filled ${filled} observation input(s)`);
      await checklist.submitRFI();

      const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
      expect(match, `Could not extract an RFI id after submitting ${cp.code}; URL was ${page.url()}`).toBeTruthy();

      created.rfiId = match[1];
      created.checkpoint = cp;
      created.workArea = workArea;
      created.observationCount = filled;
      break outer;
      }
    }

    if (!created.rfiId) {
      throw new Error(
        `Could not raise an RFI on ANY of the ${pool.length} work area(s) x ` +
        `${chain.length} checkpoint(s) of "${profile.rfi.activity}" ` +
        `(areas tried: ${pool.join(', ')}). Wind has exactly one Work Section per ` +
        `Work Area and selecting it consumes the (checkpoint, Work Section) pair ` +
        `permanently, so every pair in this pool is spent. Add more work areas to ` +
        `WIND_E2E.workAreas / flowWorkAreas and re-run stages 2 (SO mapping) and ` +
        `3 (WAM) so the CI can see them.\n` +
        `Attempts: ${JSON.stringify(attempts, null, 2)}`
      );
    }

    // Read the human-readable code only now, via the dashboard-first re-read,
    // to dodge the DRAFT-placeholder race.
    created.rfiCode = await getVisibleCodeFor(page, created.rfiId);
    expect(created.rfiCode, 'Expected a visible RFI code after submitting').toBeTruthy();
    expect(created.rfiCode, 'A freshly submitted RFI should not still show a DRAFT code')
      .not.toMatch(/draft/i);

    console.log(
      `\n  >>> CI created ${created.rfiCode} (id ${created.rfiId}) ` +
      `on ${created.checkpoint.code} [${created.checkpoint.subActivity}]\n`
    );
  });

  // EE then QI. Identical mechanics by design — the app owner has confirmed
  // both reviewers act the same way — so this is one parameterised loop rather
  // than two near-copies.
  for (const role of ['EE', 'QI']) {
    test(`${role} approves the wind RFI`, async ({ page, isMobileViewport }) => {
      test.setTimeout(25 * 60 * 1000);

      expect(created.rfiCode, `CI's step did not produce an RFI code, so ${role} has nothing to review`)
        .toBeTruthy();

      await loginAsFlowUser(page, users[role].email, PASSWORD);

      // exact: true anchors the row lookup to the WHOLE code cell rather than a
      // substring — see RFIListPage.getRowByCode. Defensive rather than fixing a
      // live break (wind's code counter turned out to be global, in the
      // thousands, not restarting per Work-Location/Work-Area/Package as first
      // assumed), but a lookup for "...-CIV-3037" would still match a future
      // "...-CIV-30370".
      try {
        await openFromPendingWithMe(
          page, created.rfiCode, `${role} review of wind smoke RFI`, { exact: true }
        );
      } catch (err) {
        // The RFI is not in THIS role's "Pending with me". Two possible causes,
        // indistinguishable from absence alone:
        //   (a) this role has ALREADY approved it, or
        //   (b) the previous actor's action never actually landed.
        //
        // In RESUME mode (SMOKE_RFI_CODE given) the caller is deliberately
        // pointing at a pre-existing RFI whose state they may not know, so (a)
        // is the likely reading and skipping is right — this is exactly the
        // situation after an approval succeeded but a post-check failed, where a
        // hard failure would be reporting a problem that does not exist.
        //
        // In NORMAL mode CI created the RFI moments earlier in this same run, so
        // the handoff IS guaranteed and absence is a real bug worth failing on.
        if (process.env.SMOKE_RFI_CODE) {
          console.log(
            `  ${created.rfiCode} is not in ${role}'s "Pending with me". In resume mode ` +
            `that most likely means ${role} has already approved it, so skipping.\n` +
            `  (${String(err.message || err).split('\n')[0]})`
          );
          test.skip(true, `${created.rfiCode} already actioned by ${role} (resume mode)`);
          return;
        }
        throw err;
      }

      const review = new RFIReviewPage(page);

      // Echo back what the form actually holds, so a data-integrity problem
      // shows up here rather than as a mystery later. Compared with the numeric
      // prefix stripped and case-insensitively: the create form renders
      // "1. Crane Pad" / "1.1 Pre-Activity Work" and the review screen's
      // rendering of the same values is not assumed identical.
      // stripLabelPrefix handles the inconsistent prefix formats ("1.2 OGL" vs
      // "1. 2 Stone Column Work"); see its comment in helpers.js.
      const strip = (s) => stripLabelPrefix(s).toLowerCase();
      const fields = await review.readAllFields().catch((err) => {
        console.log(`  (readAllFields failed, continuing to the approval: ${String(err.message || err).split('\n')[0]})`);
        return null;
      });
      if (fields) {
        console.log(`  ${role} sees: ${JSON.stringify(fields, null, 2)}`);
        if (fields.activity) {
          expect(
            strip(fields.activity),
            `${role}'s review screen should show the activity CI submitted`
          ).toBe(strip(profile.rfi.activity));
        }
        // Assert against the area CI ACTUALLY used, recorded in `created` —
        // not a recomputed "preferred" area. The walk may have fallen through
        // several areas before finding a free (area, checkpoint) pair, so
        // recomputing would compare against the wrong one.
        if (fields.workArea && created.workArea) {
          expect(strip(fields.workArea), `${role} should see work area ${created.workArea}`)
            .toBe(strip(created.workArea));
        }
      }

      // expandAllChecklist() BEFORE approve() — this is the established order
      // in rfi-dependency-flow.js's approveAsRole, not decoration.
      await review.expandAllChecklist();

      // RFIReviewPage.approve() returns NOTHING. It clicks Submit, waits for the
      // confirm popup to appear (10s) and waits for it to close — so it throws
      // if the approval does not go through, and that is its assertion. An
      // earlier version of this spec expected a toast string back and failed on
      // `undefined` AFTER the approval had already succeeded.
      await review.approve();
      console.log(`  ${role} approval submitted and the confirm popup closed`);

      // Positive confirmation that the approval actually moved the RFI on:
      // it must no longer sit in THIS role's "Pending with me". For EE the RFI
      // moves to QI; for QI it leaves the review queue entirely.
      const stillPending = await isStillPendingWithMe(page, created.rfiCode);
      expect(
        stillPending,
        `After ${role} approved, ${created.rfiCode} should no longer be in ${role}'s "Pending with me" list`
      ).toBe(false);
      console.log(`  ${role}: confirmed ${created.rfiCode} has left "Pending with me"\n`);
    });
  }
});

// Re-checks the current role's "Pending with me" grid for a code. Uses the same
// exact-match lookup as the navigation above, for the same reason.
async function isStillPendingWithMe(page, rfiCode) {
  const DashboardPage = require('../pages/DashboardPage');
  const MyTasksPage = require('../pages/MyTasksPage');
  const RFIListPage = require('../pages/RFIListPage');

  const dashboard = new DashboardPage(page);
  await dashboard.closeAnyOpenDialog();
  await dashboard.dismissToastIfPresent();
  await dashboard.goToMyTasks();

  const myTasks = new MyTasksPage(page);
  await myTasks.pendingWithMeTile.waitFor({ state: 'visible', timeout: 30000 });
  await myTasks.clickPendingWithMe();

  const list = new RFIListPage(page);
  // listRowCodes() is layout-aware (grid cells on desktop, card titles on
  // mobile), so membership is a cleaner check than a row locator — and it cannot
  // accidentally reach for grid-only machinery on a viewport that has no grid.
  const codes = await list.listRowCodes();
  return codes.some((c) => c.trim() === String(rfiCode).trim());
}
