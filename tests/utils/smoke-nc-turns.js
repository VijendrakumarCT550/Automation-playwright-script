const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { openFromPendingWithMe } = require('./nc-nav');
const NCCreatePage = require('../pages/NCCreatePage');
const NCResponsePage = require('../pages/NCResponsePage');
const NCReviewPage = require('../pages/NCReviewPage');
const DashboardPage = require('../pages/DashboardPage');

// THE 4-TC NC TURN DRIVER FOR THE SMOKE CHAIN.
//
// The NC counterpart of smoke-rfi-turns.js, and separate from
// nc-flow-turns.js for the same reasons that file is separate from
// rfi-flow-turns.js: the regression's driver requires ./nc-tracker-utils at
// module scope (pulling the regression's fixtures/nc-tracker.json into the
// module graph), calls loginAsRole (the .env accounts), and hardcodes NC_DATA at
// A-06c. Smoke needs its own tracker, its own created users and its own ground.
//
// Per the app owner's OPTION C (2026-09-03), nc-tracker-utils.js itself stays
// completely untouched — specs 15/16/17 and 22 keep the exact behaviour they
// have. Only this new code uses the shared flow-tracker.
//
// ---------------------------------------------------------------------------
// HOW NC DIFFERS FROM RFI — all of it confirmed by the existing regression
// ---------------------------------------------------------------------------
//   * QI CREATES the NC; CI responds. The reverse of RFI. So a TC with no ncId
//     is QI's turn, and QI is BOTH the creator and the second reviewer.
//   * ONE reject mechanism (a single OK/Not-Ok toggle), so steps carry no
//     P1/P2 `page` and there is no page-1-lock rule to assert.
//   * THE NC CODE NEVER CHANGES. QI fixes it at creation and cannot alter it
//     afterwards; CI only fills Root Cause and Corrective Action. So unlike
//     RFI there is no code-changed-on-resubmit question at all — but it does
//     mean the code MUST be read successfully at creation, because every later
//     lookup goes through it and there is no earlier value to fall back on.
//   * NO WORK SECTION CONSUMPTION. Multiple NCs against identical details are
//     legal, so there is no walk and no exclusion bookkeeping — the single
//     biggest simplification versus the RFI driver.
//   * PHOTOS ARE MANDATORY at creation, response and review, and
//     NCReviewPage.approve()/reject() attach one and tick the acknowledgement
//     checkbox internally. The attachment assertions below check that the
//     PREVIOUS actor's photo actually propagated, which is a real behaviour
//     worth guarding rather than a formality.
//
// Same session model as the RFI stage: the caller logs in once per role, in
// parallel, and round-robins turns between three live sessions.

const FAILURE_DIR = path.join('test-results', 'smoke-nc-failures');

// PHASE TIMING, added 2026-09-03 to answer a question guesswork could not.
//
// The mobile NC pass hit its 2-hour test timeout after only FIVE completed
// steps — roughly 24 minutes each, against desktop's ~32 seconds for the same
// work. RFI mobile does not behave that way (9 TCs in 22.5 min), so it is
// NC-specific, and the obvious suspects did not survive inspection:
// capturePhoto is bounded at ~41s worst case, and the codes were already
// finalized so no code re-reads were happening.
//
// Rather than run more 2-hour passes on hypotheses, each phase is timed and
// logged. Nav and action are separated because they fail for different reasons:
// nav is My Tasks -> NC tab -> Pending with me -> find card -> expand ->
// Review, while action is the form work plus the mandatory photo.
const now = () => Date.now();
const since = (t) => ((Date.now() - t) / 1000).toFixed(1) + 's';

async function timed(ctx, tcId, label, fn) {
  const t = now();
  try {
    return await fn();
  } finally {
    ctx.log('     [' + since(t).padStart(7) + '] ' + tcId + ' ' + label);
  }
}

function patchTc(tracker, tcId, fields) {
  const t = tracker.load();
  Object.assign(t[tcId], fields);
  tracker.save(t);
}

function makeNcContext({ profile, tracker, workArea, viewport, log = console.log }) {
  const nc = profile.nc;
  if (!nc) {
    throw new Error(
      `Profile "${profile.key}" has no nc data. For wind this is deliberately null — ` +
      `the NC create form has never been opened for that project type, so it needs a ` +
      `recon pass first (see docs/smoke-e2e-framework.md section 3).`
    );
  }
  return {
    profile, tracker, viewport, log,
    // Everything NCCreatePage.fillForm expects, with the work area resolved for
    // this (flow, viewport) rather than taken from the profile's default.
    ncData: { ...nc, workArea },
    workArea,
    problems: [],
  };
}

async function captureFailureEvidence(page, tcId, stage) {
  const out = { screenshotPath: null, htmlPath: null, url: null };
  try {
    fs.mkdirSync(FAILURE_DIR, { recursive: true });
    const safe = (tcId + '-' + stage).replace(/[^A-Za-z0-9._-]+/g, '-');
    const base = path.join(FAILURE_DIR, safe);
    out.url = page.url();
    await page.screenshot({ path: base + '.png', fullPage: true });
    out.screenshotPath = base + '.png';
    fs.writeFileSync(base + '.html', await page.content());
    out.htmlPath = base + '.html';
  } catch {
    // deliberately swallowed — a failed capture must not mask the real error
  }
  return out;
}

async function failTc(page, ctx, tcId, err, stage) {
  const reason = String((err && err.message) || err);
  // Picks up a scenario tag set at the throw site, exactly as the RFI driver
  // does — nc-nav.js may tag "the previous actor's action reported success but
  // this NC never became visible here" the same way rfi-nav.js does.
  const tag = (err && err.negativeScenario) || null;
  const evidence = await captureFailureEvidence(page, tcId, stage);
  ctx.tracker.markFailed(ctx.tracker.load(), tcId, reason, { stage, scenario: tag, ...evidence });
  ctx.log('  !! ' + tcId + ' FAILED at [' + stage + ']' +
    (tag ? ' {' + tag + '}' : '') + ': ' + reason.split('\n')[0]);
  if (evidence.screenshotPath) ctx.log('     evidence: ' + evidence.screenshotPath);
}

// A FINALIZED code ends in its numeric counter — "NC-S05b-BL05-CIV-7",
// "NC-A-06c-BL01-CIV-29". Anything else is still a placeholder.
//
// THIS SHAPE CHECK IS THE POINT, and a "not DRAFT" check is NOT enough. Confirmed
// live 2026-09-03: an NC read immediately after creation reported
//
//     id   0c446302-79c5-447e-bf91-cba212ef cb95
//     code NC-S05b-BL05-CIV-              cb95
//
// i.e. NC's placeholder is THE LAST FOUR CHARACTERS OF THE RECORD'S UUID, not the
// literal word "DRAFT" that RFI uses. It contains no "draft" to match on, so a
// /draft/i guard sails straight past it — which is exactly what happened: the
// placeholder was recorded as the code and CI's row lookup then failed for a code
// that does not exist.
const FINALIZED_CODE = /-\d+$/;

function looksFinalized(code) {
  return !!code && FINALIZED_CODE.test(String(code).trim()) && !/draft/i.test(code);
}

// Reads the NC's visible code off /my-tasks/nc/<id>, polling until it looks
// finalized. NOT tolerant of failure the way RFI's resubmit read is: NC has no
// earlier code to fall back on, and every later step finds the row by code.
async function readNcCode(page, ncId, ctx, tcId) {
  let last = null;
  for (let attempt = 1; attempt <= 5; attempt++) {
    const dashboard = new DashboardPage(page);
    await dashboard.goToDashboard().catch(() => {});
    await dashboard.waitForContentOnly().catch(() => {});
    await page.goto(`${process.env.BASE_URL}/my-tasks/nc/${ncId}`);
    await page.waitForLoadState('networkidle').catch(() => {});
    last = await new NCReviewPage(page).getVisibleCode().catch(() => null);
    if (looksFinalized(last)) return String(last).trim();

    // Name the known placeholder form explicitly when it appears, so this is
    // diagnosable at a glance instead of looking like a random string.
    const idTail = String(ncId).slice(-4);
    const isIdTail = last && String(last).trim().endsWith(idTail);
    ctx.log(
      '  ' + tcId + ': code reads "' + last + '" (attempt ' + attempt + '/5) — not finalized' +
      (isIdTail ? ' (this is the id-tail placeholder "' + idTail + '", not a real counter)' : '')
    );
    if (attempt < 5) await page.waitForTimeout(6000);
  }
  throw new Error(
    `${tcId}: the NC code never finalized for id ${ncId} — last read "${last}". A finalized ` +
    `code ends in its numeric counter; this is still the placeholder. Every later step finds ` +
    `the row by code and NC has no earlier code to fall back on, so this cannot continue.`
  );
}

// Returns a usable, finalized code for this TC, re-reading it from the id if
// what the tracker holds is still a placeholder.
//
// SELF-HEALING ON PURPOSE. The placeholder above was recorded once already, and a
// TC in that state could otherwise never recover: every retry would look up the
// same dead code. Re-reading costs one navigation and turns a permanently stuck
// TC into a resumable one.
async function ensureNcCode(page, ctx, tcId) {
  const tc = ctx.tracker.load()[tcId];
  if (looksFinalized(tc.ncCode)) return String(tc.ncCode).trim();

  expect(
    tc.ncId,
    `${tcId}: no NC id recorded, so the code cannot be re-read and there is nothing to act on`
  ).toBeTruthy();
  ctx.log('  ' + tcId + ': recorded code "' + tc.ncCode + '" is not finalized; re-reading from the id');
  const code = await readNcCode(page, tc.ncId, ctx, tcId);
  ctx.tracker.setCode(ctx.tracker.load(), tcId, code);
  ctx.log('  ' + tcId + ': code resolved to "' + code + '"');
  return code;
}

// ---------------------------------------------------------------------------
// QI: creates the NC, and is also the SECOND reviewer
// ---------------------------------------------------------------------------
async function createFor(page, ctx, tcId) {
  const create = new NCCreatePage(page);
  await create.goto();
  await create.clickCreateNC();
  await create.fillForm({ ...ctx.ncData, ncDescription: `Automated smoke NC - ${tcId}` });
  await create.submitNC();

  // NC's post-submit URL has NO /view suffix, unlike RFI's — confirmed live and
  // the reason this regex is anchored at the end.
  const match = page.url().match(/nc\/([a-f0-9-]+)$/i);
  expect(match, `${tcId}: could not extract an NC id after submitting; URL was ${page.url()}`).toBeTruthy();
  const ncId = match[1];

  // Record the id BEFORE reading the code: if the code read then fails, the
  // tracker still knows an NC exists, so a retry does not create a second one
  // for the same TC.
  ctx.tracker.setId(ctx.tracker.load(), tcId, ncId);
  patchTc(ctx.tracker, tcId, { workArea: ctx.workArea });

  const ncCode = await readNcCode(page, ncId, ctx, tcId);
  ctx.tracker.setCode(ctx.tracker.load(), tcId, ncCode);
  ctx.log('  >> ' + tcId + ': QI created ' + ncCode + ' (id ' + ncId + ') @ ' + ctx.workArea);
}

// ---------------------------------------------------------------------------
// CI: responds, and resubmits after a rejection
// ---------------------------------------------------------------------------
async function respondFor(page, ctx, tcId, actionLabel) {
  // Re-reads the code if what is recorded is still a placeholder — see
  // ensureNcCode. Without this a TC that recorded the id-tail placeholder at
  // creation could never be recovered by any number of retries.
  const ncCode = await ensureNcCode(page, ctx, tcId);
  const tc = ctx.tracker.load()[tcId];

  await timed(ctx, tcId, 'nav to ' + ncCode, () => openFromPendingWithMe(page, ncCode));

  const response = new NCResponsePage(page);

  // Confirms the PREVIOUS actor's mandatory photo actually reached CI, rather
  // than merely that their submit succeeded. QI always attaches one at
  // creation, and every resubmit round follows a rejection that also attached
  // one — so there should always be at least one here.
  const attachments = await response.getAttachmentCount();
  expect(
    attachments,
    `${tcId}: CI sees 0 attachments on ${ncCode} — the previous actor's mandatory photo did not propagate`
  ).toBeGreaterThan(0);
  ctx.log('  ' + tcId + ': CI sees ' + attachments + ' attachment(s)');

  // Timed separately: fillResponse includes the mandatory photo capture, which
  // is the phase most likely to behave differently at a phone viewport.
  await timed(ctx, tcId, 'fillResponse (incl. photo)', () => response.fillResponse({
    rootCause: `Automated smoke root cause - ${tcId} (${actionLabel})`,
    correctiveActions: `Automated smoke corrective actions - ${tcId} (${actionLabel})`,
  }));
  await timed(ctx, tcId, 'submitResponse', () => response.submitResponse());

  // ADVANCE ON THE CONFIRMED ACTION, exactly as the RFI driver does — see
  // ctx.problems there for the desync this prevents. The NC code cannot change,
  // so nothing needs re-reading and there is no post-check that could throw.
  ctx.tracker.advanceStep(ctx.tracker.load(), tcId, {});
  ctx.log('  >> ' + tcId + ': CI ' + actionLabel + ' ' + ncCode + ', step advanced');
}

async function runCITurn(page, ctx) {
  const pending = ctx.tracker.getPendingStepsForActor(ctx.tracker.load(), 'CI');
  if (!pending.length) { ctx.log('  CI: nothing pending'); return; }
  ctx.log('  CI: ' + pending.length + ' TC(s) pending -> ' +
    pending.map((p) => p.tcId + ':' + p.step.action).join(', '));

  for (const { tcId, step } of pending) {
    try {
      if (step.action === 'respond' || step.action === 'resubmit') {
        await respondFor(page, ctx, tcId, step.action);
      } else {
        throw new Error('Unexpected CI action "' + step.action + '" for ' + tcId);
      }
    } catch (err) {
      await failTc(page, ctx, tcId, err, 'CI ' + step.action);
    }
  }
}

// ---------------------------------------------------------------------------
// EE and QI review turns — identical mechanics, so one parameterised function
// ---------------------------------------------------------------------------
async function runReviewTurn(page, ctx, role) {
  const pending = ctx.tracker.getPendingStepsForActor(ctx.tracker.load(), role);
  if (!pending.length) { ctx.log('  ' + role + ': nothing pending'); return; }
  ctx.log('  ' + role + ': ' + pending.length + ' TC(s) pending -> ' +
    pending.map((p) => p.tcId + ':' + p.step.action).join(', '));

  for (const { tcId, step } of pending) {
    const stage = role + ' ' + step.action;
    try {
      // QI's create turn arrives through this same list (a TC with no ncId is
      // always the create actor's turn), so it is handled here rather than in a
      // separate function the caller has to remember to call.
      if (step.action === 'create') {
        await createFor(page, ctx, tcId);
        continue;
      }

      // Same self-heal as CI's turn: a recorded placeholder is re-read from the
      // id rather than being looked up forever as a code that does not exist.
      const ncCode = await ensureNcCode(page, ctx, tcId);

      await timed(ctx, tcId, 'nav to ' + ncCode, () => openFromPendingWithMe(page, ncCode));
      const review = new NCReviewPage(page);

      // A review turn always follows CI's response or resubmit, both of which
      // mandatorily attach a photo.
      const attachments = await timed(ctx, tcId, 'read attachments', () => review.getAttachmentCount());
      expect(
        attachments,
        `${tcId}: ${role} sees 0 attachments on ${ncCode} — CI's mandatory photo did not propagate`
      ).toBeGreaterThan(0);
      ctx.log('  ' + tcId + ': ' + role + ' sees ' + attachments + ' attachment(s)');

      if (step.action === 'approve') {
        // approve() sets the Ok radio, attaches the mandatory photo, ticks the
        // mandatory acknowledgement checkbox and waits for the review to
        // complete — so a return IS the confirmation.
        await timed(ctx, tcId, role + ' approve()', () => review.approve());
      } else if (step.action === 'reject') {
        await timed(ctx, tcId, role + ' reject()',
          () => review.reject(`Automated smoke ${role} rejection (${tcId})`));
      } else {
        throw new Error('Unexpected ' + role + ' action "' + step.action + '" for ' + tcId);
      }

      ctx.tracker.advanceStep(ctx.tracker.load(), tcId, {});
      ctx.log('  >> ' + tcId + ': ' + role + ' ' + step.action + 'd ' + ncCode + ', step advanced');
    } catch (err) {
      await failTc(page, ctx, tcId, err, stage);
    }
  }
}

const runEETurn = (page, ctx) => runReviewTurn(page, ctx, 'EE');
const runQITurn = (page, ctx) => runReviewTurn(page, ctx, 'QI');

module.exports = {
  makeNcContext, runCITurn, runEETurn, runQITurn, runReviewTurn,
  readNcCode, patchTc, captureFailureEvidence,
};
