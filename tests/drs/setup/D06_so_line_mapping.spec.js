const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper, openCombobox } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DATA = require('../drs-data');

// ===========================================================================
// D06 — SO LINE MAPPING (Configuration → 5): map the SO's line to its
// sub-activities. docs/drs-pulse-integration.md §3.
//
// Measured on our own project, drs-uat 2026-09-26 (round 4): step 5 unlocks
// once the SO has a line and step 4 maps activities onto it. Pick the SO in
// "Select a service order", then each line shows its fields and a "Select Sub
// Activity" combobox offering exactly the sub-activities step 4 mapped
// (here "EA - Piling - Inverter" / "- LT Cable Hanger System" / "- MMS" /
// "- Robotic Docking System"), with "No sub activities mapped" until one is.
//
// ONE LINE PER CATALOG VERSION (app owner, 2026-10-15; docs/drs-catalog-versions-
// and-so-lines.md §7-8). D04 gives the SO one line per version the run pins; each
// line here gets the Piling sub-activities of ITS version only. The picker lists
// every pinned version's copy of a sub-activity ("EA - Piling - MMS — Solar ·
// All sites v2 — VER-ALL-V2" ...): different sub-activities, not duplicates, so the
// match is on "· <version label> —". A WMC covers one version, so a line never
// mixes versions - the proof after reload checks that too.
// A project from before 2026-10-15 (one line, no version on it) keeps the old
// behaviour: its one line gets the default version's sub-activities.
// Idempotent: already-mapped sub-activities are not re-added. LAST stage (D9).
//
// Run: npx playwright test --project=drs tests/drs/setup/D06_so_line_mapping.spec.js
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/stage-d06');

test.describe.configure({ mode: 'serial' });

let context, page, dump, run;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  run = state.incompleteProject(ENV.key, 'D9');
  expect(run, `no unfinished project on ${ENV.key}`).toBeTruthy();
  expect(run.stagesDone, `${run.name}: SO Configuration not done — run D05 first`).toContain('D8');
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  dump = makeDumper(page, OUT, { screens: [] });
});

test.afterAll(async () => {
  if (context) await context.close();
});

async function openLineMapping() {
  await page.goto(`${ENV.baseUrl}/projects/${run.id}/configuration?step=so_line_mapping`);
  const so = page.getByRole('combobox', { name: 'Select a service order' });
  await so.waitFor({ state: 'visible', timeout: 60000 });
  // The SO reads "<number> — <VENDOR NAME>" once the SO's advanced vendor
  // fields are set (D04), so match by prefix.
  const current = (await so.inputValue().catch(() => '')).trim();
  if (!current.startsWith(run.serviceOrder.number)) {
    await openCombobox(page, so);
    await page.locator('[role="option"]:visible').filter({ hasText: run.serviceOrder.number }).first().click();
  }
  // The line card, not the picker: a fully mapped line shows its sub-activity
  // chips and no "Select Sub Activity" placeholder at all (measured live).
  await page.getByText(/S\.O\. Activity/).first().waitFor({ state: 'visible', timeout: 30000 });
  await page.waitForTimeout(1000);
}

// The card of one SO line: the element holding its "<line>-<item> S.O. Activity"
// caption AND a combobox (the Sub Activity picker).
function lineCard(line) {
  const caption = new RegExp(`^\\s*${line.lineNumber}-${line.serviceItemNo}\\s+S\\.O\\. Activity`);
  return page.getByText(caption).first().locator('xpath=ancestor::div[.//*[@role="combobox"]][1]');
}

// Sub-activity chips shown ON ONE LINE: visible own-text nodes mentioning "Piling -"
// inside the card, NOT inside a listbox/option. Caught live on the first run: DRS
// keeps a closed listbox's options in the DOM, so a plain text search read the
// OPTIONS as mapped sub-activities. A chip is a <div> holding a bare TEXT NODE plus
// a remove button (measured), so match on the element's own text nodes.
async function mappedSubs(card) {
  const texts = await card.evaluate((root) => [...root.querySelectorAll('p, span, div')]
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /Piling -/.test(n.textContent || '')))
    // NOT a bare [data-part="content"]: the wizard's own tab panel is an Ark
    // `content` part, so that excluded every chip on the page (debugged live).
    // Closed-listbox items measure 0x0, which the size check drops.
    .filter((el) => !el.closest('[role="listbox"], [role="option"], [data-scope="combobox"][data-part="content"]'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((el) => el.textContent.trim()));
  return [...new Set(texts.filter((t) => t.length < 200))];
}

const tagOf = (version) => `· ${version} —`;

// Opens a card's picker and returns the visible option texts (the list stays open).
async function openPicker(card) {
  const picker = card.locator('[role="combobox"]').first();
  await picker.scrollIntoViewIfNeeded();
  await openCombobox(page, picker);
  return (await page.locator('[role="option"]:visible').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

test('D9. map each SO line to its own catalog version\'s Piling sub-activities', async () => {
  test.setTimeout(10 * 60 * 1000);
  const lines = (run.serviceOrder.lines || []).map((l) => ({ ...l, version: l.version || DATA.catalogOptionLabel }));
  console.log(`  lines: ${lines.map((l) => `${l.lineNumber}-${l.serviceItemNo} -> ${l.version}`).join(' | ')}`);
  await openLineMapping();

  const plan = {};
  let added = 0;
  for (const line of lines) {
    const key = `${line.lineNumber}-${line.serviceItemNo}`;
    const card = lineCard(line);
    await card.waitFor({ state: 'visible', timeout: 30000 });
    const before = await mappedSubs(card);

    const allOffered = await openPicker(card);
    const offered = allOffered.filter((t) => t.includes(tagOf(line.version)));
    console.log(`  ${key} (${line.version}): ${offered.length} of ${allOffered.length} offered are this version's`);
    for (const t of offered) console.log(`    ${t}`);
    expect(offered.length, `line ${key}: no sub-activity of "${line.version}" offered - is it pinned + configured (D03/D05)?`).toBeGreaterThan(0);
    const foreign = before.filter((m) => !m.includes(tagOf(line.version)));
    expect(foreign, `line ${key} already holds sub-activities of another version`).toEqual([]);

    // SPEED (2026-10-15): the picker is a MULTI-select - the list stays open after
    // a pick, and once one chip is in the box is no longer named "Select Sub
    // Activity". Click each option in the open list; reopen only if it closed.
    for (const sub of offered) {
      if (before.includes(sub)) continue;
      const opt = page.locator('[role="option"]:visible').filter({ hasText: sub }).first();
      if (!(await opt.isVisible().catch(() => false))) {
        await openPicker(card);
        if (!(await opt.isVisible().catch(() => false))) continue;
      }
      await opt.click();
      await page.waitForTimeout(250);
      added += 1;
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.waitForTimeout(300);
    plan[key] = { version: line.version, subActivities: offered };
  }
  await dump('lines-before-save');
  console.log(`  sub-activities added: ${added}`);

  if (added) {
    const response = page.waitForResponse(
      (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\//.test(r.url())
        && !/\/api\/v1\/query\//.test(r.url()),
      { timeout: 90000 },
    );
    await page.getByRole('button', { name: 'Save' }).click();
    const res = await response;
    const body = await res.text().catch(() => '');
    console.log(`  save → ${res.request().method()} HTTP ${res.status()} ${res.url()}\n    ${body.slice(0, 300)}`);
    expect(res.status(), `line mapping save answered ${res.status()}: ${body.slice(0, 300)}`).toBeLessThan(300);
  }

  // Proof after a reload: each line holds exactly its own version's sub-activities.
  await openLineMapping();
  await dump('lines-after-reload');
  for (const line of lines) {
    const key = `${line.lineNumber}-${line.serviceItemNo}`;
    const after = await mappedSubs(lineCard(line));
    console.log(`  ${key} after reload: ${after.length} chip(s)`);
    for (const sub of plan[key].subActivities) expect(after, `line ${key}: "${sub}" missing after save`).toContain(sub);
    expect(after.filter((m) => !m.includes(tagOf(line.version))), `line ${key} holds another version's sub-activity`).toEqual([]);
  }
  await expect(page.getByText('No sub activities mapped')).toHaveCount(0);

  state.upsertProject(ENV.key, run.tag, { soLineMapping: { lines: plan } });
  state.markStageDone(ENV.key, run.tag, 'D9');
});
