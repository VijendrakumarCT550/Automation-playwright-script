/**
 * DOM INSPECTOR — NOT a test. Nothing here asserts; everything is REPORTED.
 *
 * WHY THIS RUN EXISTS
 * -------------------
 * tests/specs/35_rfi_nc_linkage.spec.js proved three things about "Raise NC"
 * (the checkbox is absent until an item is marked Not Ok, it appears after, and
 * a reject-with-NC completes). It could NOT prove the rule that matters — CI
 * cannot resubmit while a linked NC is open — for one concrete reason recorded
 * in that commit: two fields of the embedded NC panel, NC Description and
 * Defect Type, NEVER FILLED (30s timeouts). The standalone NC form's
 * placeholders ("Enter NC Description" / "Enter Defect Type") evidently do not
 * exist in the embedded panel.
 *
 * With mandatory fields unfilled, this app SILENTLY NO-OPS on submit
 * (documented in RFIReviewPage.approve). So there may never have been a linked
 * NC at all — in which case QI's action was a PLAIN reject, CI resubmitting was
 * correct, and rule (4) was never engaged. That ambiguity cannot be argued away
 * from the outside; the panel has to be looked at.
 *
 * WHAT IT CAPTURES, in one chain (CI create -> EE approve -> QI review):
 *   1. every field on QI's checklist page BEFORE anything is marked Not Ok;
 *   2. the delta after marking item 1 Not Ok (what a plain rejection needs);
 *   3. the delta after checking THAT item's "Raise NC" — the panel we need;
 *   4. whether a SECOND item can raise its own independent NC (the multi-NC
 *      half of the feature, needed later, cheap to answer now);
 *   5. whether the panel can be filled and the rejection pushed through, and
 *      which dialog the app shows when it is;
 *   6. what CI then sees: is there a real NC in CI's queue, does its detail
 *      page link back to the parent RFI, and where exactly does the RFI
 *      resubmit get blocked — at Proceed, or at the final Submit.
 *
 * Every step writes a JSON/HTML/PNG artefact under
 * test-results/linked-nc-panel/ so the locators can be written from evidence
 * instead of from a second guess.
 *
 * USERS AND GROUND: the .env CI / EE / QI accounts (user's instruction,
 * 2026-09-15, after the smoke users failed to authenticate on pulse-qa — the
 * login form came back with no app message at all), and therefore the
 * REGRESSION tier's own proven ground: rfi-flow-turns.js's RFI_DATA, i.e.
 * A-06c / BL01 / Piling - MMS / Pre Pour Inspection - Pile. That combination is
 * what the tracked 9-TC regression has been passing on with these exact
 * accounts, so a failure here is about the linked-NC panel and not about
 * guessed dropdown values or an unmapped work area.
 *
 * It deliberately leaves a rejected RFI and (hopefully) an open linked NC
 * behind: that IS the state under investigation. The cost is bounded — a linked
 * NC blocks the (activity, checkpoint, work section) TRIPLE, not the work area
 * (docs/smoke-e2e-framework.md rule R2a), and the triple it blocks is one this
 * run has already consumed by raising an RFI on it.
 *
 * Usage (PowerShell, one worker, watch it if you like):
 *   $env:PULSE_ENV="qa"
 *   npx playwright test tests/specs/inspection/00_inspect_rfi_linked_nc_panel.spec.js --project=chromium --workers=1 --headed
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsRole } = require('../../utils/helpers');
const { RFI_DATA } = require('../../utils/rfi-flow-turns');
const { NC_DATA } = require('../../utils/nc-flow-turns');
const { fillPageOne, resetToMyTasks, getVisibleCodeFor } = require('../../utils/rfi-dependency-flow');
const { openFromPendingWithMe } = require('../../utils/rfi-nav');
const RFIChecklistPage = require('../../pages/RFIChecklistPage');
const RFIReviewPage = require('../../pages/RFIReviewPage');
const RFICreatePage = require('../../pages/RFICreatePage');
const { BasePage } = require('../../pages/BasePage');

test.describe.configure({ mode: 'serial' });

const OUT = path.join('test-results', 'linked-nc-panel');

// The regression tier's RFI data, split into the shape fillPageOne() takes.
// Imported rather than retyped so this recon can never drift from the ground
// the 9-TC regression actually runs on.
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

let context, page;
let rfiCode = null;
let rfiId = null;

function say(msg) {
  console.log(`  ${msg}`);
}

// First line of an error message. A named helper, and deliberately a REGEX
// split rather than a literal escape: spec 35 records that the literal kept
// being turned into a real newline by scripted edits, breaking the file three
// times. One definition, one place to get right.
function firstLine(err) {
  return String((err && err.message) || err || '').split(/\r?\n/)[0];
}

function write(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, name);
  fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data, null, 2));
  say(`wrote ${file}`);
}

// Every field-ish element on the page, with the surrounding text that a human
// reads as its label.
//
// THE LABEL PROBLEM THIS SOLVES. This app repeatedly renders "Label *" as plain
// adjacent text with no `for`, no aria-label and no placeholder — NCResponsePage
// documents exactly that for Root Cause / Corrective Actions, and had to fall
// back to `page.locator('input').nth(0)`. So a dump of placeholders alone would
// very likely come back empty for the two fields that failed, and prove nothing.
// Walking up to the nearest ancestor that carries text is what actually
// identifies a field here.
//
// Each element is also TAGGED with data-recon="<i>", so anything found in the
// dump can be driven immediately in the same run via [data-recon="i"] — no
// second guess at a selector.
async function snapshotFields(target) {
  return target.evaluate(() => {
    const contextOf = (el) => {
      let node = el;
      let best = '';
      for (let i = 0; i < 4; i += 1) {
        node = node.parentElement;
        if (!node) break;
        const text = (node.innerText || '').replace(/\s+/g, ' ').trim();
        if (text && text.length > best.length) best = text;
        if (best.length >= 25) break;
      }
      return best.slice(0, 160);
    };

    const selector = [
      'input',
      'textarea',
      '[role="combobox"]',
      '[role="radio"]',
      '[data-scope="checkbox"][data-part="root"]',
    ].join(', ');

    return Array.from(document.querySelectorAll(selector)).map((el, i) => {
      el.setAttribute('data-recon', String(i));
      const rect = el.getBoundingClientRect();
      return {
        i,
        tag: el.tagName.toLowerCase(),
        type: el.getAttribute('type') || '',
        role: el.getAttribute('role') || '',
        placeholder: el.getAttribute('placeholder') || '',
        ariaLabel: el.getAttribute('aria-label') || '',
        name: el.getAttribute('name') || '',
        id: el.id || '',
        scope: el.getAttribute('data-scope') || '',
        part: el.getAttribute('data-part') || '',
        state: el.getAttribute('data-state') || '',
        value: typeof el.value === 'string' ? el.value.slice(0, 60) : '',
        visible: rect.width > 0 && rect.height > 0,
        context: contextOf(el),
      };
    });
  });
}

// What a field IS, independent of its position — so "what appeared after I
// clicked" is a set difference rather than an eyeball comparison of two
// 40-entry dumps.
function identity(f) {
  return [f.tag, f.type, f.role, f.placeholder, f.ariaLabel, f.name, f.context].join('|');
}

function newSince(before, after) {
  const seen = new Set(before.map(identity));
  return after.filter((f) => !seen.has(identity(f)));
}

// Fills a text field located by whatever actually identifies it — placeholder,
// aria-label, or surrounding text — using the data-recon tag the snapshot left
// behind. Returns what it did, never throws: this is a probe.
//
// Ties break toward the SHORTEST context, which is the most specific container:
// a match on "NC Description" beats a match on the whole panel's text that
// happens to contain those words too.
async function fillByAnyLabel(target, pattern, value) {
  const fields = await snapshotFields(target);
  const matches = fields
    .filter((f) => f.visible && (f.tag === 'input' || f.tag === 'textarea') && !f.role)
    .filter((f) => pattern.test(f.placeholder) || pattern.test(f.ariaLabel) || pattern.test(f.context))
    .sort((a, b) => a.context.length - b.context.length);

  if (!matches.length) return { ok: false, reason: `nothing matched ${pattern}` };

  const hit = matches[0];
  try {
    const locator = target.locator(`[data-recon="${hit.i}"]`);
    await locator.click({ timeout: 5000 });
    await locator.fill(value, { timeout: 5000 });
    const actual = await locator.inputValue().catch(() => '');
    return { ok: actual === value, hit, actual, candidates: matches.length };
  } catch (err) {
    return { ok: false, hit, reason: firstLine(err) };
  }
}

// Same idea for a dropdown — locate by surrounding text, then drive it through
// BasePage's proven listbox handling rather than a bespoke click.
async function selectByAnyLabel(target, pattern, optionText) {
  const fields = await snapshotFields(target);
  const matches = fields
    .filter((f) => f.visible && f.role === 'combobox')
    .filter((f) => pattern.test(f.ariaLabel) || pattern.test(f.context))
    .sort((a, b) => a.context.length - b.context.length);

  if (!matches.length) return { ok: false, reason: `no combobox matched ${pattern}` };

  const hit = matches[0];
  try {
    await new BasePage(target).selectDropdownOption(target.locator(`[data-recon="${hit.i}"]`), optionText);
    return { ok: true, hit };
  } catch (err) {
    return { ok: false, hit, reason: firstLine(err) };
  }
}

// Picks a work section the app will actually accept, learning from its own
// refusal. Copied from spec 35 (which took it from spec 34) for the reason
// recorded there: selectWorkSection(null) means "the first option", NOT "the
// first FREE option", and every RFI permanently consumes the pair it lands on.
async function createRfiOnFreeSection(target, rfiFixture) {
  const excluded = [];
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const { rfiCreate } = await fillPageOne(target, rfiFixture.baseData, rfiFixture.checkpoint, '__skip__');
    const chosen = await rfiCreate.selectWorkSection(null, { exclude: excluded });
    const outcome = await rfiCreate.clickProceedAndCheckOutcome();
    if (outcome.proceeded) {
      say(`work section "${chosen}" accepted (attempt ${attempt})`);
      return chosen;
    }
    const taken = (outcome.toastText || '').match(/workSections?:\s*([^.]+)/i);
    const names = taken ? taken[1].split(',').map((x) => x.trim()).filter(Boolean) : [chosen];
    for (const n of names) if (n && !excluded.includes(n)) excluded.push(n);
    say(`attempt ${attempt}: "${chosen}" refused (${JSON.stringify(outcome.toastText)}); retrying`);
    await resetToMyTasks(target);
  }
  throw new Error(`Could not find a free work section after 6 attempts; excluded: ${excluded.join(', ')}`);
}

test.beforeAll(async ({ browser }) => {
  for (const role of ['CI', 'EE', 'QI']) {
    expect(process.env[`${role}_EMAIL`], `${role}_EMAIL must be set in .env`).toBeTruthy();
    expect(process.env[`${role}_PASSWORD`], `${role}_PASSWORD must be set in .env`).toBeTruthy();
  }

  context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();

  console.log(
    `\n=== RECON: the linked-NC panel (.env users on ${process.env.BASE_URL}) ===\n` +
    `    ground    : ${FIXTURE.baseData.workLocation} / ${FIXTURE.baseData.workArea}\n` +
    `    checkpoint: ${FIXTURE.checkpoint.name}\n` +
    `    CI ${process.env.CI_EMAIL}\n    EE ${process.env.EE_EMAIL}\n    QI ${process.env.QI_EMAIL}\n`
  );
});

test.afterAll(async () => {
  if (context) await context.close();
});

// ---------------------------------------------------------------------------
test('1. CI raises an RFI and EE approves it through to QI', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAsRole(page, 'CI');
  await createRfiOnFreeSection(page, FIXTURE);

  const checklist = new RFIChecklistPage(page);
  const filled = await checklist.fillAllObservations('OK - linked NC recon');
  say(`checklist observations filled: ${filled}`);
  await checklist.submitRFI();

  const match = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
  expect(match, `no RFI id in the post-submit URL: ${page.url()}`).toBeTruthy();
  rfiId = match[1];
  rfiCode = await getVisibleCodeFor(page, rfiId);
  say(`CI submitted ${rfiCode} (${rfiId})`);

  // EE must approve before QI can see it — EE and QI are not symmetric
  // observers (the lesson spec 34 learned the hard way).
  await loginAsRole(page, 'EE');
  await openFromPendingWithMe(page, rfiCode);
  await new RFIReviewPage(page).approve();
  say(`EE approved ${rfiCode} — now with QI`);
  await resetToMyTasks(page).catch(() => {});
});

// ---------------------------------------------------------------------------
test('2. QI: dump the checklist before Not Ok, after Not Ok, and after Raise NC', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAsRole(page, 'QI');
  await openFromPendingWithMe(page, rfiCode);

  const review = new RFIReviewPage(page);
  await review.goToChecklistPage().catch(() => {});
  await review.expandAllChecklist().catch(() => {});
  await page.waitForTimeout(1000);

  const baseline = await snapshotFields(page);
  write('01-baseline-fields.json', baseline);
  say(`baseline: ${baseline.length} field-ish elements (${baseline.filter((f) => f.visible).length} visible)`);

  // Mark the FIRST item Not Ok. force:true is required — RFIReviewPage records
  // that this radio group's real <input> sits under a styled sibling that
  // permanently intercepts pointer events, so a plain click never lands.
  const notOk = page.getByRole('radio', { name: 'Not Ok' }).first();
  await notOk.waitFor({ state: 'attached', timeout: 15000 });
  await notOk.click({ force: true });
  await page.waitForTimeout(1500);

  const afterNotOk = await snapshotFields(page);
  const notOkDelta = newSince(baseline, afterNotOk);
  write('02-after-not-ok.json', { all: afterNotOk, added: notOkDelta });
  say(`after Not Ok on item 1: ${notOkDelta.length} new field(s)`);
  for (const f of notOkDelta) {
    say(`   + ${f.tag}${f.role ? `[${f.role}]` : ''} ph="${f.placeholder}" ctx="${f.context}"`);
  }

  // Now the checkbox itself.
  const raiseNc = page.getByRole('checkbox', { name: /raise\s*nc/i }).first();
  const asCheckbox = await raiseNc.isVisible().catch(() => false);
  const target = asCheckbox ? raiseNc : page.getByText(/raise\s*nc/i).first();
  say(`"Raise NC" exposed as a checkbox role: ${asCheckbox}`);
  await target.click({ force: true });
  await page.waitForTimeout(2000);

  const afterRaise = await snapshotFields(page);
  const raiseDelta = newSince(afterNotOk, afterRaise);
  write('03-after-raise-nc.json', { all: afterRaise, added: raiseDelta });

  console.log('');
  console.log('  *** THE LINKED-NC PANEL — the fields checking "Raise NC" revealed ***');
  for (const f of raiseDelta) {
    say(
      `   + ${f.tag}${f.role ? `[${f.role}]` : ''}${f.type ? `(${f.type})` : ''} ` +
      `ph=${JSON.stringify(f.placeholder)} aria=${JSON.stringify(f.ariaLabel)} ` +
      `visible=${f.visible} ctx=${JSON.stringify(f.context)}`
    );
  }
  console.log('');

  // The item's own DOM, so the per-item scoping a MULTI-NC test needs can be
  // written from the real structure rather than assumed. Anchored on the
  // "Raise NC" text and walked up far enough to contain the whole item.
  const itemHtml = await page.evaluate(() => {
    const all = Array.from(document.querySelectorAll('div, section, li, article'));
    const holder = all.find((el) => /raise\s*nc/i.test(el.textContent || '')
      && !Array.from(el.children).some((c) => /raise\s*nc/i.test(c.textContent || '')));
    if (!holder) return null;
    let node = holder;
    for (let i = 0; i < 6 && node.parentElement; i += 1) node = node.parentElement;
    return node.outerHTML.slice(0, 80000);
  });
  if (itemHtml) write('04-item-container.html', itemHtml);
  else say('could not isolate the checklist item container (see 05-page.html)');

  write('05-page.html', await page.content());
  await page.screenshot({ path: path.join(OUT, '06-raise-nc-panel.png'), fullPage: true });
});

// ---------------------------------------------------------------------------
test('3. can a SECOND checklist item raise its own independent NC?', async () => {
  test.setTimeout(15 * 60 * 1000);

  // The feature description says "one NC per question", so more than one item
  // must be able to carry its own NC in a single rejection. Answering it now is
  // nearly free; discovering it later would cost another full chain.
  const before = await snapshotFields(page);
  const beforeRaiseCount = await page.getByText(/raise\s*nc/i).count().catch(() => 0);

  const notOkRadios = page.getByRole('radio', { name: 'Not Ok' });
  const total = await notOkRadios.count();
  say(`checklist has ${total} "Not Ok" radios; "Raise NC" controls currently on page: ${beforeRaiseCount}`);

  if (total < 2) {
    say('only one checklist item — the multi-NC question cannot be answered on this checklist');
    return;
  }

  await notOkRadios.nth(1).click({ force: true });
  await page.waitForTimeout(1500);
  const afterRaiseCount = await page.getByText(/raise\s*nc/i).count().catch(() => 0);
  say(`after marking item 2 Not Ok: "Raise NC" controls on page: ${afterRaiseCount} (was ${beforeRaiseCount})`);

  const after = await snapshotFields(page);
  write('07-second-item.json', { added: newSince(before, after) });

  // REVERT item 2. This run is meant to leave exactly ONE linked NC behind, so
  // the single-NC lifecycle can be walked end to end without a second NC
  // silently holding the RFI blocked and making the result unreadable.
  const okRadios = page.getByRole('radio', { name: 'Ok', exact: true });
  await okRadios.nth(1).click({ force: true }).catch((e) => say(`could not revert item 2: ${firstLine(e)}`));
  await page.waitForTimeout(1000);
  say('item 2 reverted to Ok — this run leaves a single linked NC');
});

// ---------------------------------------------------------------------------
test('4. fill the panel from what the dump found, and push the rejection through', async () => {
  test.setTimeout(25 * 60 * 1000);

  const src = NC_DATA;
  const results = {};

  results.ncDescription = await fillByAnyLabel(page, /nc description/i, 'Linked NC raised by recon (G-01)');
  results.defectType = await fillByAnyLabel(page, /defect type/i, src.defectType || 'Workmanship defect');
  results.ncQuantity = await fillByAnyLabel(page, /nc quantity/i, String(src.ncQuantity || 1));
  results.remark = await fillByAnyLabel(page, /remark/i, 'Not Ok - linked NC recon');
  results.category = await selectByAnyLabel(page, /category/i, src.category || 'Critical');
  results.unit = await selectByAnyLabel(page, /unit of measurement|unit/i, src.unit || 'EA');

  for (const [name, r] of Object.entries(results)) {
    say(`${name}: ${r.ok ? 'FILLED' : 'FAILED'} ${r.hit ? `via ctx=${JSON.stringify(r.hit.context)}` : ''} ${r.reason || ''}`);
  }
  write('08-fill-results.json', results);

  // Target Date for Closure — the app's own date picker, driven through
  // NCCreatePage's proven calendar handling (same Ark UI widget).
  try {
    const NCCreatePage = require('../../pages/NCCreatePage');
    await new NCCreatePage(page).selectTargetDate(src.targetDateClosureDays || 14);
    say('Target Date for Closure: FILLED');
  } catch (err) {
    say(`Target Date for Closure: FAILED — ${firstLine(err)}`);
  }

  // The NC's photo is mandatory and a checklist item's is not, and spec 35
  // observed the "Use Camera" count going 16 -> 17 when Raise NC is checked —
  // so the NC's box is the newest, i.e. the last one. Reported, not assumed.
  const photoBoxes = await page.getByText('Use Camera', { exact: false }).count().catch(() => 0);
  say(`"Use Camera" boxes on the page: ${photoBoxes}`);
  if (photoBoxes > 0) {
    const review = new RFIReviewPage(page);
    const lastBox = page.getByText('Use Camera', { exact: false }).last().locator('xpath=..');
    await review.capturePhoto(lastBox).catch((e) => say(`NC photo capture failed: ${firstLine(e)}`));
    await page.waitForTimeout(800);
    const remaining = await page.getByText('Use Camera', { exact: false }).count().catch(() => 0);
    say(`"Use Camera" boxes after capturing into the last one: ${remaining}`);
  }

  await page.screenshot({ path: path.join(OUT, '09-panel-filled.png'), fullPage: true });

  // WHICH BUTTON ACTUALLY SUBMITS A REJECT-WITH-NC IS THE OPEN QUESTION.
  //
  // Spec 35 used "Reject RFI" (the page-1 reject, with its own Remarks popup)
  // and the app redirected to /my-tasks, which reads as success — but a page-1
  // reject may well be a PLAIN reject that discards the checklist panel
  // entirely, which would explain a rejected RFI with no linked NC and CI free
  // to resubmit. The checklist "Submit" is the other candidate: RFIReviewPage
  // documents that with >=1 item Not Ok it raises "Are you sure you want to
  // reject RFI?". Try Submit FIRST and report what the dialog says.
  const review = new RFIReviewPage(page);
  const submitVisible = await review.submitButton.isVisible().catch(() => false);
  say(`checklist "Submit" button visible: ${submitVisible}`);

  let outcome = 'not attempted';
  if (submitVisible) {
    await review.submitButton.click({ force: true }).catch(() => {});
    const opened = await review.confirmPopup.waitFor({ state: 'visible', timeout: 15000 })
      .then(() => true).catch(() => false);
    if (opened) {
      const text = ((await review.confirmPopup.innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      say(`confirm dialog after Submit: ${JSON.stringify(text)}`);
      await review.confirmSubmitButton.click().catch(() => {});
      const redirected = await page.waitForURL('**/my-tasks', { timeout: 30000 })
        .then(() => true).catch(() => false);
      outcome = `Submit -> ${JSON.stringify(text)} -> ${redirected ? 'redirected to /my-tasks' : `still on ${page.url()}`}`;
    } else {
      const toast = ((await page.locator('[data-scope="toast"], [role="alert"]').first()
        .innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      outcome = `Submit NO-OPPED (no confirm dialog in 15s); toast=${JSON.stringify(toast)}`;
      await page.screenshot({ path: path.join(OUT, '10-submit-noop.png'), fullPage: true });
      write('11-submit-noop-page.html', await page.content());
    }
  }
  say(`SUBMIT OUTCOME: ${outcome}`);
  write('12-submit-outcome.json', { outcome, url: page.url() });
});

// ---------------------------------------------------------------------------
test('5. what CI sees afterwards: is there a real linked NC, and where is the RFI blocked?', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAsRole(page, 'CI');

  // THE DECIDING QUESTION. If no NC is waiting for CI, then QI's action was a
  // plain reject and nothing about rule (4) can be concluded from this run —
  // which is precisely the ambiguity spec 35 ended on.
  const NCTasksPage = require('../../pages/NCTasksPage');
  const NCListPage = require('../../pages/NCListPage');
  const DashboardPage = require('../../pages/DashboardPage');

  let ncRows = [];
  try {
    await new BasePage(page).dismissToastIfPresent();
    await new DashboardPage(page).goToMyTasks();
    const ncTasks = new NCTasksPage(page);
    await ncTasks.clickNcTab();
    await ncTasks.clickPendingWithMe();
    const list = new NCListPage(page);
    await list.waitForGrid();
    ncRows = (await page.locator('[role="row"]').allInnerTexts().catch(() => []))
      .map((t) => t.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  } catch (err) {
    say(`could not read CI's NC "Pending with me" list: ${firstLine(err)}`);
  }

  say(`CI's NC "Pending with me" rows: ${ncRows.length}`);
  for (const row of ncRows.slice(0, 15)) say(`   | ${row.slice(0, 200)}`);
  write('13-ci-nc-queue.json', ncRows);
  await page.screenshot({ path: path.join(OUT, '14-ci-nc-queue.png'), fullPage: true });

  // Does an NC detail page link back to the parent RFI? (Claim 3 of section 10,
  // and the only direct evidence that a given NC belongs to THIS RFI.)
  const ncRow = page.locator('[role="row"]').filter({ hasText: /NC-/i }).first();
  if (await ncRow.isVisible().catch(() => false)) {
    await ncRow.click({ force: true }).catch(() => {});
    await page.waitForTimeout(3000);
    const bodyText = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ');
    const mentionsRfi = rfiCode ? bodyText.includes(rfiCode) : /RFI-/.test(bodyText);
    say(`NC detail page URL: ${page.url()}`);
    say(`NC detail page mentions the parent RFI (${rfiCode}): ${mentionsRfi}`);
    write('15-nc-detail.html', await page.content());
    await page.screenshot({ path: path.join(OUT, '16-nc-detail.png'), fullPage: true });
  }

  // WHERE DOES THE BLOCK BITE — at Proceed, or at the final Submit? Spec 35
  // only ever got as far as Proceed, and "reached page 2" is not "resubmitted".
  let reachable = true;
  await resetToMyTasks(page).catch(() => {});
  await openFromPendingWithMe(page, rfiCode).catch((e) => {
    reachable = false;
    say(`CI cannot open ${rfiCode} from RFI "Pending with me": ${firstLine(e)}`);
  });
  say(`rejected RFI reachable by CI: ${reachable}`);

  if (reachable) {
    const rfiCreate = new RFICreatePage(page);
    const proceeded = await rfiCreate.clickProceedAndCheckOutcome()
      .catch((e) => ({ proceeded: false, toastText: `threw: ${firstLine(e)}` }));
    say(`CI Proceed: ${proceeded.proceeded ? 'PROCEEDED' : `refused — ${JSON.stringify(proceeded.toastText)}`}`);

    if (proceeded.proceeded) {
      // All the way to the real submit — this is the step the rule is about.
      const checklist = new RFIChecklistPage(page);
      await checklist.fillAllObservations('OK - resubmit attempt (recon)').catch((e) => say(`checklist fill: ${firstLine(e)}`));
      await checklist.clickSubmit().catch((e) => say(`Submit click: ${firstLine(e)}`));
      await page.waitForTimeout(2000);
      await checklist.confirmSubmit().catch((e) => say(`confirm: ${firstLine(e)}`));
      await page.waitForTimeout(4000);
      const toast = ((await page.locator('[data-scope="toast"], [role="alert"]').first()
        .innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      say(`after CI's full resubmit attempt: url=${page.url()} toast=${JSON.stringify(toast)}`);
      write('17-resubmit-attempt.json', { url: page.url(), toast });
      await page.screenshot({ path: path.join(OUT, '18-resubmit-attempt.png'), fullPage: true });
    }
  }

  console.log('');
  console.log(`  RECON COMPLETE — artefacts in ${OUT}`);
});
