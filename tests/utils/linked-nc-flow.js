const { expect } = require('@playwright/test');
const { RFI_DATA } = require('./rfi-flow-turns');
const { NC_DATA } = require('./nc-flow-turns');
const { fillPageOne, resetToMyTasks, getVisibleCodeFor } = require('./rfi-dependency-flow');
const { openFromPendingWithMe } = require('./rfi-nav');
const { BasePage } = require('../pages/BasePage');
const MyTasksPage = require('../pages/MyTasksPage');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const RFICreatePage = require('../pages/RFICreatePage');
const RFIReviewPage = require('../pages/RFIReviewPage');
const RFIListPage = require('../pages/RFIListPage');
const NCTasksPage = require('../pages/NCTasksPage');
const NCListPage = require('../pages/NCListPage');
const NCResponsePage = require('../pages/NCResponsePage');
const NCReviewPage = require('../pages/NCReviewPage');

// ===========================================================================
// LINKED-NC FLOW — the shared machinery behind gap G-01 and its follow-ups
// ===========================================================================
// Extracted from 36_rfi_linked_nc_lifecycle.spec.js once a second and third
// spec needed the same steps (multi-NC, and the reject rounds). Every helper
// here was proven live on pulse-qa 2026-09-15 by that spec's 8/8 run; the
// comments record WHY each one is shaped the way it is, because in almost
// every case the obvious version silently returned a wrong answer rather than
// failing.
//
// THE ONE RULE THAT EXPLAINS MOST OF THIS FILE: PULSE does not block or error
// on an invalid mandatory field, it SILENTLY NO-OPS — and its lists render
// asynchronously and lag behind the previous actor's action by a few seconds.
// So any helper that concludes from "the click happened" or from one immediate
// read will eventually hand a test a confident wrong answer. Verify the effect,
// not the gesture. See docs/automation-coverage-and-gaps.md section 2b.
//
// Usage: const flow = createLinkedNcFlow({ page, note });
// `note` is the caller's own reporter (it collects findings for the run
// summary); it defaults to console.log so the module is usable from a recon
// script without ceremony.
// ===========================================================================

// The regression tier's RFI data in the shape fillPageOne() takes. Imported
// from rfi-flow-turns rather than retyped so this cannot drift from the ground
// the tracked 9-TC regression actually passes on.
const FIXTURE = {
  baseData: {
    workLocation: RFI_DATA.workLocation,
    workArea: RFI_DATA.workArea,
    package: RFI_DATA.package,
    subPackage: RFI_DATA.subPackage,
    activity: RFI_DATA.activity,
    subActivity: RFI_DATA.subActivity,
    rfiQuantity: RFI_DATA.rfiQuantity,
    unit: RFI_DATA.unit,
    subContractor: RFI_DATA.subContractor,
  },
  checkpoint: {
    name: RFI_DATA.inspectionCheckpoint,
    checklist: RFI_DATA.inspectionChecklist,
  },
};

// A linked NC's field values, with a DISTINCTIVE description — that string is
// how the NC is later identified on CI's side, since the app never shows the
// raising actor the code it generated.
function linkedNcData(label) {
  return {
    description: `Linked NC (${label}) ${Date.now()}-${Math.floor(Math.random() * 1000)}`,
    defectType: NC_DATA.defectType,
    category: NC_DATA.category,
    targetDateDays: NC_DATA.targetDateClosureDays,
    quantity: 1,
    unit: NC_DATA.unit,
  };
}

function firstLine(err) {
  return String((err && err.message) || err || '').split(/\r?\n/)[0];
}

function createLinkedNcFlow({ page, note = (m) => console.log(`  ${m}`) }) {
  const baseUrl = () => process.env.BASE_URL;

  // -------------------------------------------------------------------------
  // Navigation
  // -------------------------------------------------------------------------

  // Clicks the NC tab, matching its name EXACTLY.
  //
  // NCTasksPage.ncTab is `button:has-text("NC")`, and Playwright's `:has-text()`
  // is a CASE-INSENSITIVE SUBSTRING match — so it also matches any button whose
  // label merely contains "nc", "Cancel" among them, and `.first()` then takes
  // whichever comes first in the DOM. Seen live 2026-09-15: three consecutive
  // attempts clicked something, reported no error, and left the page on the RFI
  // grid, after which the run read RFI rows believing they were NC rows.
  //
  // Deliberately NOT a change to NCTasksPage: that locator is load-bearing for
  // the whole NC flow suite, so retargeting it under those specs without running
  // them is the bigger risk. Tracked in the landmines table.
  async function clickNcTabExactly() {
    const candidates = [
      page.getByRole('tab', { name: /^\s*NC\s*$/i }),
      page.getByRole('button', { name: /^\s*NC\s*$/i }),
      page.locator('button').filter({ hasText: /^\s*NC\s*$/ }),
    ];

    for (const candidate of candidates) {
      const tab = candidate.first();
      if (!(await tab.isVisible().catch(() => false))) continue;
      await tab.click();
      await page.waitForLoadState('networkidle').catch(() => {});
      // The scroll reset NCTasksPage.clickNcTab documents: without it the tile
      // clicked next can flip to "not visible" during click()'s own scroll step
      // and never recover.
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
      await page.waitForTimeout(500);
      return;
    }

    const controls = [...new Set(
      (await page.locator('button, [role="tab"]').allInnerTexts().catch(() => []))
        .map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
    )].slice(0, 20);
    throw new Error(`No exact "NC" tab/button found. Visible controls: ${JSON.stringify(controls)}`);
  }

  // Gets to the NC "Pending with me" LIST and PROVES it arrived.
  //
  // Two separate ways this silently lands on the RFI grid instead: the tab
  // switch not taking (above), and DashboardPage.goToMyTasks() deciding it has
  // already arrived because the RFI LIST page has a "Pending with me" element
  // of its own — hence the outright goto rather than a nav click.
  //
  // THE COLUMN HEADER IS THE PROOF, and it also distinguishes a genuinely empty
  // queue from a grid that has not rendered — both of which otherwise read as
  // zero rows. A baseline that silently reads empty is the worst outcome here:
  // it makes every later code look new.
  // Has the NC grid actually rendered? The "NC ID" column header is the proof.
  async function onNcGrid(timeout = 15000) {
    return page.getByRole('columnheader', { name: /NC ID/i }).first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true).catch(() => false);
  }

  async function openNcPendingWithMe() {
    const seen = [];

    // ROUTE FIRST, CLICKS SECOND — and this ordering is the result of the tab
    // click failing three separate times across three runs.
    //
    // The tab/tile dance is genuinely fragile here: the tab must be clicked
    // because My Tasks defaults to RFI, the click can silently not take, and on
    // the last occasion an exact-name match found a control, clicked it, and the
    // page still stayed on the RFI grid. Every one of those failures produces
    // the SAME dangerous outcome — RFI rows read as NC rows.
    //
    // The list has its own route, mirroring the RFI list's
    // (/my-tasks/rfi/list/pending-with-me), so navigating to it directly removes
    // the whole class of failure. This is not the "drive it through the UI"
    // convention being abandoned: that convention exists so the RFI/NC FLOW
    // (create, review, resubmit) is exercised the way a user drives it. Reaching
    // a queue in order to read it is setup, not the behaviour under test — and
    // the behaviour under test here is the linked-NC gate.
    //
    // The clicks remain as the fallback, so if a deployment does not serve this
    // route the spec degrades to the old path rather than failing outright.
    for (const listPath of ['/my-tasks/nc/list/pending-with-me', '/my-tasks/nc']) {
      await page.goto(`${baseUrl()}${listPath}`).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await new NCListPage(page).waitForGrid().catch(() => {});
      if (await onNcGrid(8000)) {
        await page.waitForTimeout(1000);
        return;
      }
      seen.push(`route ${listPath} -> ${page.url()}`);
    }

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await page.goto(`${baseUrl()}/my-tasks`);
      await page.waitForLoadState('networkidle').catch(() => {});
      await new BasePage(page).dismissToastIfPresent();

      await clickNcTabExactly().catch((err) => seen.push(`tab click: ${firstLine(err)}`));
      await new NCTasksPage(page).clickPendingWithMe().catch((err) => seen.push(`tile: ${firstLine(err)}`));
      await new NCListPage(page).waitForGrid().catch(() => {});

      if (await onNcGrid()) {
        await page.waitForTimeout(1000);
        note(`reached the NC list via the tab/tile clicks (attempt ${attempt})`);
        return;
      }

      const onRfiGrid = await page.getByRole('columnheader', { name: /RFI ID/i }).first()
        .isVisible().catch(() => false);
      seen.push(`clicks attempt ${attempt}: ${page.url()}${onRfiGrid ? ' (showing the RFI grid)' : ''}`);
      note(`NC queue navigation attempt ${attempt} did not land on the NC list; retrying`);
    }

    // Name what IS on screen — a bare "header never appeared" sent an earlier
    // debugging round chasing the wrong control entirely.
    const controls = [...new Set(
      (await page.locator('button, [role="tab"], a').allInnerTexts().catch(() => []))
        .map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean)
    )].slice(0, 25);

    throw new Error(
      `Could not reach the NC "Pending with me" list — the "NC ID" column header never ` +
      `appeared, by route or by clicks. Tried: ${seen.join(' | ')}. ` +
      `Visible controls: ${JSON.stringify(controls)}`
    );
  }

  // Every NC code currently in the logged-in user's "Pending with me" queue.
  async function ncCodesInPendingWithMe() {
    await openNcPendingWithMe();

    const rows = await page.locator('[role="row"]').allInnerTexts().catch(() => []);
    const codes = new Set();
    for (const row of rows) {
      for (const match of row.matchAll(/NC-[A-Za-z0-9-]+/g)) codes.add(match[0]);
    }
    return [...codes];
  }

  async function openLinkedNc(code) {
    await openNcPendingWithMe();
    await new NCListPage(page).openRowByCode(code);
  }

  // Scrolls the virtualised RFI grid INCREMENTALLY until the wanted row is
  // mounted, then hands off to RFIListPage's proven eye-icon click.
  //
  // RFIListPage.scrollToRowByCode sets `scrollTop = scrollHeight` each pass — it
  // jumps straight to the BOTTOM, because newly touched rows sort there. A row
  // in the MIDDLE of a long queue is never mounted by that motion and is
  // reported "not found in Pending with me" while plainly present. That
  // flakiness landed directly on G-01's own finding: one run concluded the block
  // is enforced at Submit, the next that the RFI never appears at all.
  //
  // The hand-off is safe because scrollToRowByCode checks `row.count() > 0`
  // BEFORE scrolling: with the row already mounted it breaks out immediately and
  // openRowByCode proceeds to its horizontal scroll and eye click unchanged.
  async function openRfiRow(code) {
    await page.goto(`${baseUrl()}/my-tasks`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await new BasePage(page).dismissToastIfPresent();
    await new MyTasksPage(page).clickPendingWithMe();

    const list = new RFIListPage(page);
    await list.waitForGrid().catch(() => {});

    const cell = page.locator('[role="gridcell"][aria-colindex="1"]').filter({ hasText: code });
    for (let i = 0; i < 40; i += 1) {
      if (await cell.count() > 0) break;
      const atEnd = await page.locator('[role="grid"]:not([data-scope="date-picker"])').first()
        .evaluate((el) => {
          const body = el.querySelector('.rdg-row')?.parentElement || el;
          const before = body.scrollTop;
          body.scrollTop = before + 300;
          return body.scrollTop === before;
        }).catch(() => true);
      await page.waitForTimeout(200);
      if (atEnd) break;
    }

    await list.openRowByCode(code);
  }

  // Polls CI's RFI "Pending with me" for one code, re-navigating each time.
  async function waitForRfiInPendingWithMe(code, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;

    while (Date.now() < deadline) {
      attempt += 1;
      try {
        await page.goto(`${baseUrl()}/my-tasks`);
        await page.waitForLoadState('networkidle').catch(() => {});
        await new BasePage(page).dismissToastIfPresent();
        await new MyTasksPage(page).clickPendingWithMe();
        await page.waitForTimeout(1500);

        for (let scroll = 0; scroll < 25; scroll += 1) {
          const rows = await page.locator('[role="row"]').allInnerTexts().catch(() => []);
          if (rows.some((row) => row.includes(code))) return true;

          const atEnd = await page.locator('[role="grid"]:not([data-scope="date-picker"])').first()
            .evaluate((el) => {
              const body = el.querySelector('.rdg-row')?.parentElement || el;
              const before = body.scrollTop;
              body.scrollTop = before + 400;
              return body.scrollTop === before;
            }).catch(() => true);
          await page.waitForTimeout(200);
          if (atEnd) break;
        }
      } catch (err) {
        note(`queue poll ${attempt} errored: ${firstLine(err)}`);
      }
      await page.waitForTimeout(15000);
    }
    return false;
  }

  // -------------------------------------------------------------------------
  // Identification
  // -------------------------------------------------------------------------

  // Finds the NC a rejection created, by OPENING candidates and looking for the
  // unique description the raising actor typed.
  //
  // WHY NOT JUST A BEFORE/AFTER DIFF. The diff is a good ordering signal but a
  // bad proof: it is only as reliable as the baseline read, and a baseline that
  // silently came back empty (grid not yet rendered) hands back several "new"
  // codes with no way to tell which is ours — or quietly picks a leftover from
  // an earlier failed run and walks IT through the approval cycle, proving
  // nothing about this run. Content is the real identity; the diff only orders
  // the search, so the happy path opens exactly one.
  async function findLinkedNc(candidates, others, description) {
    const ordered = [...candidates].reverse().concat([...others].reverse());
    const tried = [];

    for (const code of ordered) {
      await openLinkedNc(code);
      const matched = await page.locator('body')
        .filter({ hasText: description })
        .waitFor({ state: 'visible', timeout: 15000 })
        .then(() => true).catch(() => false);
      tried.push(`${code}:${matched ? 'MATCH' : 'no'}`);
      if (matched) return { code, tried };
    }
    return { code: null, tried };
  }

  // -------------------------------------------------------------------------
  // RFI steps
  // -------------------------------------------------------------------------

  // Picks a work section the app will actually accept, learning from its own
  // refusal: selectWorkSection(null) means "the first option", NOT "the first
  // FREE one", and every RFI permanently consumes the pair it lands on.
  async function createRfiOnFreeSection(fixture = FIXTURE) {
    const excluded = [];
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      const { rfiCreate } = await fillPageOne(page, fixture.baseData, fixture.checkpoint, '__skip__');
      const chosen = await rfiCreate.selectWorkSection(null, { exclude: excluded });
      const outcome = await rfiCreate.clickProceedAndCheckOutcome();
      if (outcome.proceeded) {
        note(`work section "${chosen}" accepted (attempt ${attempt})`);
        return chosen;
      }
      const taken = (outcome.toastText || '').match(/workSections?:\s*([^.]+)/i);
      const names = taken ? taken[1].split(',').map((x) => x.trim()).filter(Boolean) : [chosen];
      for (const n of names) if (n && !excluded.includes(n)) excluded.push(n);
      note(`attempt ${attempt}: "${chosen}" refused (${JSON.stringify(outcome.toastText)}); retrying`);
      await resetToMyTasks(page);
    }
    throw new Error(`Could not find a free work section after 6 attempts; excluded: ${excluded.join(', ')}`);
  }

  // CI raises an RFI and EE approves it, leaving it with QI — the precondition
  // every linked-NC scenario starts from. EE must approve first: EE and QI are
  // not symmetric observers.
  async function raiseRfiToQi({ fixture = FIXTURE, observation = 'OK - linked NC', loginAs } = {}) {
    await loginAs('CI');
    await createRfiOnFreeSection(fixture);

    const checklist = new RFIChecklistPage(page);
    const filled = await checklist.fillAllObservations(observation);
    expect(filled, 'the checklist should render at least one observation row').toBeGreaterThan(0);
    await checklist.submitRFI();

    const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
    expect(match, `Could not read an RFI id from the post-submit URL: ${page.url()}`).toBeTruthy();
    const rfiId = match[1];
    const rfiCode = await getVisibleCodeFor(page, rfiId);
    note(`CI submitted ${rfiCode}`);

    await loginAs('EE');
    await openFromPendingWithMe(page, rfiCode);
    await new RFIReviewPage(page).approve();
    note(`EE approved ${rfiCode} — now with QI`);
    await resetToMyTasks(page).catch(() => {});

    return { rfiCode, rfiId };
  }

  // QI rejects the RFI, raising ONE LINKED NC PER listed checklist item.
  //
  // Both items are marked Not Ok FIRST, then each panel is filled. Order
  // matters: markChecklistItemNotOk targets the remark box by index among the
  // boxes that exist, and those only appear for items already marked Not Ok.
  // The NC panel itself contains no "Type your comments here" field, so the
  // indices stay aligned with the items.
  async function rejectWithLinkedNcs(rfiCode, items) {
    const review = new RFIReviewPage(page);
    await review.goToChecklistPage().catch(() => {});
    await review.expandAllChecklist().catch(() => {});

    // The reveal, asserted in both directions on the first item — it is what
    // makes "Raise NC" a per-item decision rather than a page-level one.
    const before = await review.raiseNcCheckbox(0).isVisible().catch(() => false);
    expect(before, '"Raise NC" must NOT be offered before an item is marked Not Ok').toBe(false);

    for (const item of items) {
      await review.markChecklistItemNotOk(item.index, item.remark);
    }
    note(`marked ${items.length} checklist item(s) Not Ok`);

    for (let i = 0; i < items.length; i += 1) {
      await review.checkRaiseNc(i);
      await review.fillLinkedNc(i, items[i].nc);
      note(`linked NC panel ${i} filled: ${items[i].nc.description}`);
    }

    const confirmText = await review.submitChecklistRejection();
    note(`the app confirmed: ${JSON.stringify(confirmText)}`);

    // THE COMPLETION SIGNAL, and it is NOT the one a page-1 reject gives. A
    // CHECKLIST reject does not redirect: QI stays on the RFI's view page and
    // the breadcrumb flips from "RFIs Pending with me" to "RFIs Pending with
    // others" — a real state transition, the RFI having left this actor's queue.
    const leftQueue = await Promise.race([
      page.getByRole('link', { name: /pending with others/i }).first()
        .waitFor({ state: 'visible', timeout: 30000 })
        .then(() => 'breadcrumb shows "Pending with others"'),
      page.waitForURL('**/my-tasks', { timeout: 30000 }).then(() => 'redirected to /my-tasks'),
    ]).catch(() => null);

    expect(
      leftQueue,
      `The rejection was confirmed (${JSON.stringify(confirmText)}) but ${rfiCode} did not leave ` +
      `QI's queue within 30s. Everything downstream would then be measuring an RFI that was ` +
      `never actually rejected.`
    ).toBeTruthy();

    note(`QI rejected ${rfiCode} with ${items.length} linked NC(s) (${leftQueue})`);
    return confirmText;
  }

  // Drives CI's resubmit of the rejected RFI ALL THE WAY to the real Submit, and
  // REPORTS where it got to instead of asserting.
  //
  // THE RULE SAYS "CANNOT RESUBMIT", AND THAT COULD BE ENFORCED IN THREE PLACES
  // — the RFI never appearing in CI's queue, Proceed refusing, or the final
  // Submit refusing. Only the last is proven by getting that far, and live it IS
  // the last: the RFI appears within ~5s and Proceed is allowed. A test that
  // stops at Proceed reads a working gate as a broken one.
  async function attemptRfiResubmit(rfiCode, observation, { waitMs = 4 * 60 * 1000 } = {}) {
    const result = {
      reachable: true, proceeded: false, toastText: null, submitted: false, url: null,
      appearedAfterMs: null, inlineMessages: [],
    };

    // POLL FOR THE RFI RATHER THAN LOOKING ONCE. A run that checked ~20s after
    // QI's action found it absent and reported "the block is enforced by the RFI
    // never appearing"; a direct inspection minutes later found that same RFI in
    // "Pending with me" with status "Rejected". Absence is evidence of a block
    // only once it has OUTLASTED the queue's lag.
    const startedAt = Date.now();
    if (await waitForRfiInPendingWithMe(rfiCode, waitMs)) {
      result.appearedAfterMs = Date.now() - startedAt;
    } else {
      result.reachable = false;
      result.toastText = `${rfiCode} did not appear in CI's "Pending with me" within ${Math.round(waitMs / 1000)}s`;
      return result;
    }

    // Opening can fail even though the row is there (see openRfiRow), so retry
    // rather than conclude — attributing a render hiccup to the app's gate is
    // exactly what this helper exists to prevent.
    let openError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await resetToMyTasks(page).catch(() => {});
      const opened = await openRfiRow(rfiCode).then(() => true)
        .catch((err) => { openError = firstLine(err); return false; });
      if (opened) { openError = null; break; }
      note(`open attempt ${attempt} failed (${openError}); retrying`);
      await page.waitForTimeout(10000);
    }
    if (openError) {
      result.reachable = false;
      result.toastText = openError;
      return result;
    }

    const outcome = await new RFICreatePage(page).clickProceedAndCheckOutcome()
      .catch((err) => ({ proceeded: false, toastText: `threw: ${firstLine(err)}` }));
    result.proceeded = !!outcome.proceeded;
    result.toastText = outcome.toastText || result.toastText;
    if (!result.proceeded) return result;

    const checklist = new RFIChecklistPage(page);
    await checklist.fillAllObservations(observation).catch((err) => {
      result.toastText = `checklist fill failed: ${firstLine(err)}`;
    });

    try {
      await checklist.submitRFI();
      result.submitted = true;
    } catch (err) {
      // submitRFI() only resolves on arrival at /view, the app's own completion
      // signal for both create and resubmit. A throw here is a REFUSAL, not a
      // test error — so capture what the app said, since "how it refuses" is the
      // finding. This app also renders refusals INLINE rather than as a toast.
      const toast = ((await page.locator('[data-scope="toast"], [role="alert"]').first()
        .innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      const inline = [...new Set(
        (await page.getByText(/is required|not allowed|cannot|pending|nc /i).allInnerTexts().catch(() => []))
          .map((t) => t.replace(/\s+/g, ' ').trim())
          .filter((t) => t && t.length < 160)
      )].slice(0, 6);

      result.toastText = toast || (inline.length ? inline.join(' / ') : firstLine(err));
      result.inlineMessages = inline;
    }
    result.url = page.url();
    return result;
  }

  // -------------------------------------------------------------------------
  // NC steps
  // -------------------------------------------------------------------------

  // CI's turn on a linked NC: root cause + corrective action. Serves both the
  // first response and every resubmit after a rejection — per the app owner,
  // modifying the text is optional, so filling it fresh satisfies both.
  async function ciRespondToNc(ncCode, label, { expectAttachments = true } = {}) {
    await openLinkedNc(ncCode);
    const response = new NCResponsePage(page);

    if (expectAttachments) {
      const attachments = await response.getAttachmentCount().catch(() => 0);
      note(`attachments visible to CI on ${ncCode}: ${attachments}`);
      expect(
        attachments,
        `CI sees 0 attachments on ${ncCode} — the previous actor's mandatory photo did not propagate.`
      ).toBeGreaterThan(0);
    }

    await response.fillResponse({
      rootCause: `Automated root cause - ${label}`,
      correctiveActions: `Automated corrective actions - ${label}`,
    });
    await response.submitResponse();
    note(`CI submitted a response for ${ncCode} (${label})`);
  }

  // A reviewer's turn on a linked NC. `decision` is 'approve' or 'reject'.
  async function reviewNc(ncCode, role, decision, remarks) {
    await openLinkedNc(ncCode);
    const review = new NCReviewPage(page);

    if (decision === 'approve') {
      await review.approve();
    } else {
      await review.reject(remarks || `Automated ${role} rejection of the linked NC`);
    }
    note(`${role} ${decision === 'approve' ? 'approved' : 'REJECTED'} ${ncCode}`);
  }

  return {
    FIXTURE,
    clickNcTabExactly,
    openNcPendingWithMe,
    ncCodesInPendingWithMe,
    openLinkedNc,
    openRfiRow,
    waitForRfiInPendingWithMe,
    findLinkedNc,
    createRfiOnFreeSection,
    raiseRfiToQi,
    rejectWithLinkedNcs,
    attemptRfiResubmit,
    ciRespondToNc,
    reviewNc,
  };
}

module.exports = { createLinkedNcFlow, FIXTURE, linkedNcData, firstLine };
