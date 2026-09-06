const { expect } = require('@playwright/test');
const { fillPageOne, getVisibleCodeFor, discardCreateForm } = require('./rfi-dependency-flow');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFIReviewPage = require('../pages/RFIReviewPage');

// The (WORK AREA x CHECKPOINT x WORK SECTION) walk that finds a genuinely-free
// combination and raises an RFI on it. Extracted from SM05_rfi_flow.spec.js so
// the flow stages share ONE implementation — the walk encodes several hard-won,
// expensive-to-rediscover rules and a second copy would drift from them.
//
// Deliberately tracker-free and login-free: the caller logs in (with the right
// project's CI, which is the whole point — see smoke-rfi-turns.js's header on
// why rfi-flow-turns.js must not be imported here) and this only drives the form.
//
// ---------------------------------------------------------------------------
// WHY A WALK AT ALL — the two project types behave fundamentally differently
// ---------------------------------------------------------------------------
// Driven by `manyPerArea` (from profile.workSectionGranularity), never by a
// project-type check, so a new project type declares its own behaviour instead
// of inheriting wind's.
//
//   SOLAR (many-per-work-area): ~264 Work Sections per area. Nothing is
//     permanently consumed by ASKING, so the walk can try section after section
//     within one (area, checkpoint) until it finds a free one.
//
//   WIND (one-per-work-area): exactly ONE Work Section per area, NAMED after the
//     area ("WTG 423" => "WTG 423"). Merely SELECTING it consumes that
//     (checkpoint, Work Section) pair permanently — submitting is not required —
//     though a proper Cancel+confirm DOES release it (discardCreateForm). So
//     there is no other section to try, and several areas are provisioned
//     precisely so this keeps working.
//
// ---------------------------------------------------------------------------
// THE APP DOES NOT FILTER SPENT WORK SECTIONS — confirmed live 2026-09-03
// ---------------------------------------------------------------------------
// This is the rule that cost a whole 9-TC run to learn, and it is why the inner
// section loop exists at all.
//
// With an RFI already raised against R01-T01 on S05b/BL03, re-opening the create
// form for the SAME checkpoint still showed:
//
//     Work Section Summary:  Total 264 | Selected for RFI 0 | Pending RFI 264
//     Work Section dropdown: R01-T01 still offered, still first
//
// ...and the submit was then rejected server-side with
// "An RFI already exists for the workSections: R01-T01."
//
// So NEITHER the option list NOR the summary counters distinguish a spent
// section from a free one. "First option" is not "first available". A caller
// raising several RFIs against one (area, checkpoint) — which a 9-TC pass does
// nine times over — must remember what it has been REJECTED for and exclude it,
// or it picks R01-T01 forever and the whole pass fails on the first TC.
//
// The pre-check below (`pending === 0`) is therefore NOT a reliable
// spent-section detector on solar; it only catches a fully exhausted checkpoint.
// The authoritative signal is the server's own rejection toast, which helpfully
// names the section — so that is what drives the exclusion set.
//
// ---------------------------------------------------------------------------
// Other rules encoded below, each of which cost real checkpoints to learn:
//   * fillPageOne runs AT MOST ONCE per attempt. RFICreatePage.fillForm ends in
//     an unconditional selectWorkSection, so any retry wrapper that re-ran it
//     would burn another pair on wind. There is deliberately no withRetry.
//   * The form's own Work Section Summary is consulted BEFORE touching anything,
//     so a fully-exhausted checkpoint is skipped without selecting anything.
//   * A blocked attempt is discarded via Cancel+confirm IMMEDIATELY, at the
//     point of the block, not left to the next iteration's reset — the walk may
//     break out entirely and never reach another iteration.
//   * WITHIN an area the walk STOPS at the first DEPENDENCY block, because
//     checkpoint N blocked means N+1..end are transitively blocked too and each
//     attempt would still consume a pair. An earlier version continued through
//     them and burned all five of one area's pairs in a single run for nothing.

// Pulls the section name(s) out of the server's duplicate rejection, e.g.
// "An RFI already exists for the workSections: R01-T01." -> ['R01-T01'].
// Comma-separated lists are handled because the field is a multi-select and the
// message is plural.
function parseDuplicateSections(toast) {
  const m = String(toast || '').match(/already exists for the workSections?:\s*([^\n]+)/i);
  if (!m) return [];
  return m[1]
    .replace(/\.\s*$/, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

// Bounds the inner section loop. Generous enough to step past a handful of
// sections spent by earlier runs or by manual testing, small enough that a
// genuinely broken form fails in minutes rather than grinding through 264.
const MAX_SECTION_ATTEMPTS = 15;

async function walkAndCreateRfi(page, {
  chain,
  pool,
  baseDataFor,
  resolveWorkSection,
  observationValue,
  // Defaults FALSE, i.e. wind's conservative one-shot behaviour. A caller that
  // knows its project type has many sections per area opts in; nothing silently
  // inherits the retry loop and starts burning wind pairs.
  manyPerArea = false,
  // Work sections the CALLER already knows are taken, excluded before the first
  // attempt rather than discovered by being rejected for them.
  //
  // WHY THIS IS NEEDED AND NOT JUST AN OPTIMISATION. Confirmed live 2026-09-03:
  // work section availability does NOT propagate instantly after a create. A run
  // that started ~seconds after an RFI was raised read
  // "Total 264 | Selected for RFI 0 | Pending RFI 264" and was still offered the
  // just-consumed R01-T01; a run seven minutes later correctly read
  // "Selected for RFI 1 | Pending RFI 263" and the section was filtered out. The
  // app is right — it just needs a moment.
  //
  // A 9-TC pass does nine creates back-to-back in ONE session, so every create
  // after the first sits inside that lag window. Relying on the form to reveal
  // what THIS RUN just consumed would mean one wasted rejected attempt per
  // already-used section, i.e. O(n^2) attempts across the pass. The caller knows
  // exactly what it used, so it says so.
  seedExclude = [],
  log = console.log,
}) {
  const attempts = [];

  // One attempt at one (work area, checkpoint, section) triple. Returns a
  // verdict rather than branching the caller's control flow from three levels
  // down, which is what made the earlier version hard to follow.
  async function attemptOne({ workArea, cp, workSection, exclude }) {
    let rfiCreate;
    try {
      // '__skip__' fills page 1 WITHOUT touching the Work Section, so the
      // form's own summary can be consulted first.
      ({ rfiCreate } = await fillPageOne(
        page, baseDataFor(cp, workArea), { name: cp.checkpoint, checklist: cp.checklist }, '__skip__'
      ));
    } catch (err) {
      const msg = String((err && err.message) || err);
      attempts.push({ workArea, code: cp.code, stage: 'fillPageOne', error: msg.split('\n')[0] });
      if (err && (err.workSectionNotFound || /work section/i.test(msg))) {
        log(`      already consumed / unavailable: ${msg.split('\n')[0]}`);
        return { kind: 'next-checkpoint' };
      }
      throw err;
    }

    const summary = await rfiCreate.readWorkSectionSummary().catch(() => null);
    if (summary) {
      log(
        `      work section summary: total=${summary.total} ` +
        `selectedForRfi=${summary.selected} pendingRfi=${summary.pending}`
      );
    }
    // `pending === 0` is the only trustworthy skip signal here; null means
    // UNPARSEABLE, treated as UNKNOWN — fall through and attempt, never assume
    // zero. Note this does NOT detect an individually-spent section on solar;
    // see the header.
    if (summary && summary.pending === 0) {
      log('      -> no Work Section left pending for this checkpoint; skipping without touching it');
      attempts.push({ workArea, code: cp.code, stage: 'pre-check', summary, skipped: true });
      await discardCreateForm(page).catch(() => false);
      return { kind: 'next-checkpoint' };
    }

    // Only now commit to a Work Section.
    let selected;
    try {
      selected = await rfiCreate.selectWorkSection(workSection, { exclude });
      if (exclude.length) log(`      selected work section "${selected}" (excluding ${exclude.join(', ')})`);
    } catch (err) {
      const msg = String((err && err.message) || err);
      log(`      could not select a work section: ${msg.split('\n')[0]}`);
      attempts.push({ workArea, code: cp.code, stage: 'selectWorkSection', error: msg.split('\n')[0] });
      await discardCreateForm(page).catch(() => false);
      return { kind: 'next-checkpoint' };
    }

    const outcome = await rfiCreate.clickProceedAndCheckOutcome();
    if (!outcome.proceeded) {
      const toast = String(outcome.toastText || '');
      log(`      BLOCKED: "${toast}"`);
      attempts.push({ workArea, code: cp.code, stage: 'proceed', blocked: true, toast, selected });

      // Release the selection IMMEDIATELY — see the header. Done here rather
      // than relying on a later reset, because the walk may break out.
      const released = await discardCreateForm(page).catch(() => false);
      log(`      work section released via Cancel+confirm: ${released}`);

      // THE TOAST REASON DECIDES what to do next, and getting it wrong is
      // expensive. Three distinct messages, all captured live:
      //  1. "An RFI already exists for the workSections: X"  -> DUPLICATE: that
      //     SECTION is spent. Nothing extra was consumed by asking.
      //  2. "...is either pending or rejected"  -> predecessor exists but is not
      //     approved.
      //  3. "Missing an RFI for Dependent Inspection Point: ..."  -> the
      //     predecessor does not exist at all.
      // For 2 and 3 every LATER checkpoint here is transitively blocked, so
      // abandon the area rather than burning the rest of its pairs.
      if (/already exists for the workSections/i.test(toast)) {
        const dupes = parseDuplicateSections(toast);
        const spent = dupes.length ? dupes : (selected ? [selected] : []);
        if (manyPerArea && spent.length) {
          log(`      -> section(s) ${spent.join(', ')} already used; trying the next section`);
          return { kind: 'retry-section', spent };
        }
        // One section per area: there is nothing else to try here.
        log('      -> duplicate and only one section per area; trying the next checkpoint');
        return { kind: 'next-checkpoint' };
      }
      // A DEPENDENCY BLOCK CONDEMNS ONE ACTIVITY, NOT THE WHOLE AREA.
      //
      // Within an activity's own chain it is still transitive — checkpoint N
      // blocked means N+1..end are blocked too, and each attempt would spend a
      // pair for nothing. But it says NOTHING about a different activity: the
      // chain can now span several, and their checkpoints are independent of each
      // other. An earlier version returned 'abandon-area' here, which with a
      // multi-activity chain would throw away every remaining activity on this
      // area because one of them was blocked.
      if (/is either pending or rejected/i.test(toast)) {
        log(
          `      -> "${cp.activity || 'this activity'}" has an UNFINISHED RFI on an ` +
          `earlier checkpoint in "${workArea}" (pending or rejected), so the rest of ` +
          `THAT activity is blocked here. Other activities on this area are ` +
          `unaffected. Finish that RFI (EE+QI approve) to unblock the activity.`
        );
        return { kind: 'block-activity', activity: cp.activity };
      }
      if (/Missing an RFI for Dependent Inspection Point/i.test(toast)) {
        log(
          `      -> "${cp.activity || 'this activity'}" has no predecessor RFI in ` +
          `"${workArea}"; skipping the rest of that activity here`
        );
        return { kind: 'block-activity', activity: cp.activity };
      }
      // Unrecognised: treat like a dependency block (abandon rather than burn
      // the rest), but say so loudly so a new message shape gets noticed.
      log('      -> UNRECOGNISED block reason; abandoning this work area defensively');
      return { kind: 'abandon-area' };
    }

    log('      proceeded to the checklist page');

    const checklist = new RFIChecklistPage(page);
    const filled = await checklist.fillAllObservations(
      observationValue, true,
      // The bookend checkpoints' only checklist is the generic "Documents and
      // report information", which may legitimately have no observation rows.
      { requireObservations: cp.expectObservations !== false }
    );
    log(`      filled ${filled} observation input(s)`);
    await checklist.submitRFI();

    const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
    expect(match, `Could not extract an RFI id after submitting ${cp.code}; URL was ${page.url()}`)
      .toBeTruthy();

    const rfiId = match[1];
    // Read the human-readable code only now, via the dashboard-first re-read,
    // to dodge the DRAFT-placeholder race.
    const rfiCode = await getVisibleCodeFor(page, rfiId);
    expect(rfiCode, 'Expected a visible RFI code after submitting').toBeTruthy();
    expect(rfiCode, 'A freshly submitted RFI should not still show a DRAFT code')
      .not.toMatch(/draft/i);

    // READ THE WORK SECTION BACK FROM THE SAVED RECORD — do not trust the label
    // returned at click time.
    //
    // PROVEN NECESSARY, 2026-09-04. A create logged
    // `selected work section "R01-T01"` and was accepted, but the saved record
    // (RFI-S05b-BL04-CIV-15) holds R01-T06. So selectWorkSection's returned
    // label is not reliably the section the record ends up on — cause not yet
    // established, but the value must not be taken on trust either way.
    //
    // This matters beyond bookkeeping: the resubmit path re-selects
    // tc.workSection when a page-1 rejection clears the field, so a wrong value
    // would attach a resubmit to the WRONG section — which, since work section is
    // one of the five inputs to the visible code, would also change the code.
    //
    // Free to do here: getVisibleCodeFor above already navigated to this
    // record's /view page, so this is one DOM read with no extra navigation.
    // readAllFields handles the variable "Work Section - ( N )" label.
    let recordedSection = null;
    try {
      const fields = await new RFIReviewPage(page).readAllFields();
      recordedSection = fields.workSection ? String(fields.workSection).trim() : null;
    } catch (err) {
      log(`      (could not read the work section back from the record: ${String(err.message || err).split('\n')[0]})`);
    }

    if (recordedSection && selected && recordedSection !== String(selected).trim()) {
      // Loud on purpose. A silent divergence here is what produced a confident,
      // wrong claim that the application had accepted a duplicate work section.
      log(
        `      !! WORK SECTION MISMATCH: clicked "${selected}" but the saved record holds ` +
        `"${recordedSection}". Recording the RECORD's value. The clicked label is kept ` +
        `as clickedWorkSection for diagnosis.`
      );
    } else if (recordedSection) {
      log(`      work section confirmed on the record: "${recordedSection}"`);
    }

    return {
      kind: 'created',
      result: {
        rfiId, rfiCode, checkpoint: cp, workArea,
        // Authoritative: what the RECORD holds, falling back to the clicked
        // label only if the read-back failed outright.
        workSection: recordedSection || selected,
        clickedWorkSection: selected,
        workSectionVerified: !!recordedSection,
        observationCount: filled, attempts,
      },
    };
  }

  for (const workArea of pool) {
    const workSection = resolveWorkSection(workArea);
    log(`\n  ===== work area "${workArea}" (work section "${workSection}") =====`);

    let abandonArea = false;
    // Activities whose chain is dependency-blocked ON THIS AREA. Scoped per area,
    // because the same activity can be blocked on one area and free on another.
    const blockedActivities = new Set();

    for (const cp of chain) {
      if (cp.activity && blockedActivities.has(cp.activity)) {
        log(`  --- skipping ${cp.code}: "${cp.activity}" is dependency-blocked on ${workArea} ---`);
        continue;
      }
      // cp.activity is only present on multi-activity chains; a single-activity
      // profile carries it once on profile.rfi instead, so it is omitted here
      // rather than printed as "undefined".
      log(
        `  --- attempting ${cp.code} ` +
        `[${cp.activity ? cp.activity + ' / ' : ''}${cp.subActivity}] "${cp.checkpoint}" ---`
      );

      // Sections known or discovered to be taken for this (area, checkpoint).
      // Seeded from what the caller already used (see seedExclude), then grown
      // by the server's own rejections. Scoped per checkpoint: a section spent
      // for checkpoint A can be free for B — but the seed is applied to every
      // checkpoint because over-excluding is harmless here (hundreds of sections
      // are available) whereas under-excluding costs a wasted attempt.
      const spentHere = new Set(manyPerArea ? seedExclude.filter(Boolean) : []);
      if (spentHere.size) {
        log(`      excluding ${spentHere.size} section(s) already used by this run: ${[...spentHere].join(', ')}`);
      }
      // Only many-per-area profiles have another section to fall back on.
      const maxAttempts = manyPerArea ? MAX_SECTION_ATTEMPTS : 1;
      let verdict = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        verdict = await attemptOne({
          workArea, cp, workSection, exclude: [...spentHere],
        });

        if (verdict.kind === 'created') return verdict.result;
        if (verdict.kind === 'retry-section') {
          verdict.spent.forEach((s) => spentHere.add(s));
          if (attempt === maxAttempts) {
            log(`      -> gave up after ${maxAttempts} section attempt(s) on ${cp.code}`);
          }
          continue;
        }
        break;
      }

      // Condemn just this activity on this area and carry on with the others.
      if (verdict && verdict.kind === 'block-activity') {
        if (verdict.activity) blockedActivities.add(verdict.activity);
        else { abandonArea = true; break; }   // single-activity chain: same thing
        continue;
      }
      if (verdict && verdict.kind === 'abandon-area') { abandonArea = true; break; }
    }

    if (abandonArea) continue;
  }

  // Granularity-aware, because the wind-specific advice was actively misleading
  // on solar — it told the reader to add work areas when the real cause was that
  // every section tried in the one area was already spent.
  const advice = manyPerArea
    ? `This profile has MANY Work Sections per Work Area, so exhaustion here means every ` +
      `section the walk tried (up to ${MAX_SECTION_ATTEMPTS} per checkpoint) already had an ` +
      `RFI against it, or the form refused for another reason. Check the attempts below: if ` +
      `they are all "already exists for the workSections", raise the attempt bound or use a ` +
      `fresh Work Area; if they are dependency blocks, finish the unapproved RFIs first.`
    : `On this profile there is exactly ONE Work Section per Work Area and selecting it ` +
      `consumes the (checkpoint, Work Section) pair permanently, so every pair in this pool ` +
      `is spent. Add more work areas to the profile's workAreas / flowWorkAreas and re-run ` +
      `stages 2 (SO mapping) and 3 (WAM) so the CI can see them.`;

  throw new Error(
    `Could not raise an RFI on ANY of the ${pool.length} work area(s) x ` +
    `${chain.length} checkpoint(s) (areas tried: ${pool.join(', ')}).\n${advice}\n` +
    `Attempts: ${JSON.stringify(attempts, null, 2)}`
  );
}

module.exports = { walkAndCreateRfi, parseDuplicateSections, MAX_SECTION_ATTEMPTS };
