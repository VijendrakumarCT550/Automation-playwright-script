const { test, expect } = require('@playwright/test');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper, openCombobox } = require('../utils/drs-ui');
const state = require('../utils/drs-state');
const DATA = require('../drs-data');

// ===========================================================================
// D06 — SO LINE MAPPING (Configuration → 5): map each SO line to its
// sub-activities. docs/drs-catalog-versions-and-so-lines.md §7-8.
//
// Measured on our own project, drs-uat 2026-09-26 (round 4): step 5 unlocks
// once the SO has a line and step 4 maps activities onto it. Pick the SO in
// "Select a service order", then each line card shows its fields and a "Select
// Sub Activity" picker offering the sub-activities step 4 mapped onto that SO.
//
// THE RULES (app owner, 2026-10-15):
//   * one SO per package (D04) - each SO here is mapped on its own, and saved
//     before the next is selected ("Save your changes before switching");
//   * a line holds sub-activities of ONE catalog version only (a WMC covers one
//     version) - matched on "· <version label> —" in the option text, because the
//     picker lists every pinned version's copy of a sub-activity ("EA - Piling - MMS
//     — Solar · All sites v2 — BL03 AS-v2" ...), which are different sub-activities;
//   * a line holds AT MOST 2 sub-activities - D04 planned each line's pair
//     (drs-data.js soPlan), and this stage maps exactly that pair.
// A sub-activity mapped to one line is no longer offered on the others.
// The proof after a reload: every line holds exactly its pair, of its version.
//
// A project from before 2026-10-15 15:00 (one SO, one line per version, no pair
// planned) keeps the older rule: the line gets every sub-activity of its version.
// Idempotent: already-mapped sub-activities are not re-added. LAST stage (D9).
//
// Run: npx playwright test --project=drs tests/drs/setup/D06_so_line_mapping.spec.js
//      DRS_PROJECT_TAG=<tag> to re-run on a project that already finished the chain.
// ===========================================================================

const ENV = drsEnv();
const OUT = path.resolve(__dirname, '../../../drs-explore/stage-d06');


// ONE TEST PER SO (2026-10-21), so the onboarding runner can map the Civil and
// Electrical SOs in parallel workers (npm run drs:setup keeps --workers=1). The
// project is resolved at load time; each SO records its mapping atomically and D9
// is marked once every SO is in.
test.describe.configure({ mode: 'parallel' });
const run = state.targetProject(ENV.key, 'D9');
DATA.bindProject(run); // WA01-style areas: versions from the project's areaVersions

let context, page, dump;

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
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

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tagOf = (version) => `· ${version} —`;

async function openLineMapping(soNumber) {
  await page.goto(`${ENV.baseUrl}/projects/${run.id}/configuration?step=so_line_mapping`);
  const so = page.getByRole('combobox', { name: 'Select a service order' });
  await so.waitFor({ state: 'visible', timeout: 60000 });
  // The SO reads "<number> — <VENDOR NAME>" once the SO's advanced vendor
  // fields are set (D04), so match by prefix.
  const current = (await so.inputValue().catch(() => '')).trim();
  if (!current.startsWith(soNumber)) {
    await openCombobox(page, so);
    await page.locator('[role="option"]:visible').filter({ hasText: soNumber }).first().click();
  }
  await expect(so).toHaveValue(new RegExp(`^${esc(soNumber)}`), { timeout: 15000 });
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

// Sub-activity chips shown ON ONE LINE: visible own-text nodes carrying a version
// label ("… — Solar · <version> — …"), NOT inside a listbox/option. Caught live on
// the first run: DRS keeps a closed listbox's options in the DOM, so a plain text
// search read the OPTIONS as mapped sub-activities. A chip is a <div> holding a
// bare TEXT NODE plus a remove button (measured), so match on own text nodes.
async function mappedSubs(card) {
  const texts = await card.evaluate((root) => [...root.querySelectorAll('p, span, div')]
    .filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && /—\s*\w+\s*·/.test(n.textContent || '')))
    // NOT a bare [data-part="content"]: the wizard's own tab panel is an Ark
    // `content` part, so that excluded every chip on the page (debugged live).
    // Closed-listbox items measure 0x0, which the size check drops.
    .filter((el) => !el.closest('[role="listbox"], [role="option"], [data-scope="combobox"][data-part="content"]'))
    .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map((el) => el.textContent.trim()));
  return [...new Set(texts.filter((t) => t.length < 200))];
}

// Removes one chip from a line: a chip is an element holding the label as its own
// text node plus an unnamed button (the ×) - inspection round 13 aria: "text: EA -
// Piling - Inverter — Solar · …" then "button". Returns whether it found the chip.
async function removeChip(card, text) {
  const done = await card.evaluate((root, t) => {
    const chip = [...root.querySelectorAll('div, span, p')].find((el) => [...el.childNodes]
      .some((n) => n.nodeType === 3 && n.textContent.trim() === t) && el.querySelector('button'));
    if (!chip) return false;
    chip.querySelector('button').click();
    return true;
  }, text);
  await page.waitForTimeout(400);
  return done;
}

// An option / chip text is sub-activity `name` of `version`:
// "<UOM> - <name> — <type> · <version> — <work areas>".
const isSub = (text, name, version) => new RegExp(` - ${esc(name)} — .*${esc(tagOf(version))}`).test(text);

// Opens a card's picker; returns the visible option texts (the list stays open).
async function openPicker(card) {
  const picker = card.locator('[role="combobox"]').first();
  await picker.scrollIntoViewIfNeeded();
  await openCombobox(page, picker);
  return (await page.locator('[role="option"]:visible').allInnerTexts()).map((t) => t.trim()).filter(Boolean);
}

// The SOs to map: one per package (serviceOrders), or the single SO of an older project.
function serviceOrders() {
  if (run.serviceOrders) return Object.values(run.serviceOrders);
  // Resolved at load time (one test per SO): a project with no SO yet must not
  // break loading - D9 then fails with the reason below.
  if (!run.serviceOrder) return [];
  return [{ ...run.serviceOrder, package: 'Civil',
    lines: (run.serviceOrder.lines || []).map((l) => ({ ...l, version: l.version || DATA.catalogOptionLabel })) }];
}

const SOS = run ? serviceOrders() : [];
if (!run) test('D9. SO Line Mapping', () => { throw new Error(`no unfinished project on ${ENV.key}`); });
else if (!SOS.length) test('D9. SO Line Mapping', () => { throw new Error(`${run.name}: no service order yet - run D04 first`); });

for (const so of SOS) {
  test(`D9. ${so.package} SO ${so.number}: every line holds its planned sub-activities (max 2, one catalog version)`, async () => {
    test.setTimeout(30 * 60 * 1000);
    const record = {};
    console.log(`\n  SO ${so.number} (${so.package}): ${so.lines.length} line(s)`);
    await openLineMapping(so.number);
    let added = 0;

    for (const line of so.lines) {
      const key = `${line.lineNumber}-${line.serviceItemNo}`;
      const card = lineCard(line);
      await card.waitFor({ state: 'visible', timeout: 30000 });
      let before = await mappedSubs(card);
      const planned = line.subActivities;

      // SERVICE-CODE AUTO-POPULATE (docs/drs-so-lines-and-service-codes.md §3): a line
      // given a code in its Activity Code can arrive pre-filled with the code's mapped
      // sub-activities - possibly of EVERY version the code maps. Keep only the line's
      // own version and plan: remove any chip of another version, and any chip the
      // plan does not list. The user may edit an auto-populated line (app owner).
      const unwanted = before.filter((m) => !m.includes(tagOf(line.version))
        || (planned && !planned.some((n) => isSub(m, n, line.version))));
      if (before.length) console.log(`    ${key} (${line.version}${line.serviceCode ? `, code ${line.serviceCode}` : ''}): arrived with ${before.length} chip(s)${unwanted.length ? `, removing ${unwanted.length}` : ''}`);
      for (const m of unwanted) {
        expect(await removeChip(card, m), `${so.package} line ${key}: could not remove "${m}"`).toBe(true);
        console.log(`      − ${m}`);
        added += 1; // a change to save
      }
      if (unwanted.length) before = await mappedSubs(card);

      // What this line must hold: its planned group, or (older project) every
      // sub-activity of its version the picker offers.
      const missing = planned ? planned.filter((n) => !before.some((m) => isSub(m, n, line.version))) : null;
      if (planned && !missing.length) {
        console.log(`    ${key} (${line.version}): already holds ${planned.join(' + ')}`);
        continue;
      }

      const offered = await openPicker(card);
      const pick = planned
        ? missing.map((n) => {
          const t = offered.find((o) => isSub(o, n, line.version));
          expect(t, `${so.package} line ${key}: "${n}" of ${line.version} not offered - mapped in SO Configuration (D05)? ` +
            `Offered: ${JSON.stringify(offered.slice(0, 12))}`).toBeTruthy();
          return t;
        })
        : offered.filter((o) => o.includes(tagOf(line.version)) && !before.includes(o));
      console.log(`    ${key} (${line.version}): + ${pick.join(' | ')}`);

      // SPEED (2026-10-15): the picker is a MULTI-select - the list stays open
      // after a pick, and once one chip is in the box is no longer named "Select
      // Sub Activity". Click each option in the open list; reopen only if it closed.
      for (const text of pick) {
        const opt = page.locator('[role="option"]:visible').filter({ hasText: text }).first();
        if (!(await opt.isVisible().catch(() => false))) {
          await openPicker(card);
          await opt.waitFor({ state: 'visible', timeout: 10000 });
        }
        await opt.click();
        await page.waitForTimeout(250);
        added += 1;
      }
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    }
    await dump(`so-${so.package.toLowerCase()}-before-save`);
    console.log(`  SO ${so.number}: sub-activities added ${added}`);

    if (added) {
      const response = page.waitForResponse(
        (r) => ['POST', 'PUT', 'PATCH'].includes(r.request().method()) && /\/api\//.test(r.url())
          && !/\/api\/v1\/query\//.test(r.url()),
        { timeout: 90000 },
      );
      await page.getByRole('button', { name: 'Save' }).click();
      const res = await response;
      const body = await res.text().catch(() => '');
      console.log(`  save → ${res.request().method()} HTTP ${res.status()} ${res.url()}\n    ${body.slice(0, 200)}`);
      expect(res.status(), `${so.package} SO line mapping save answered ${res.status()}: ${body.slice(0, 300)}`).toBeLessThan(300);
    }

    // Proof: each line holds exactly what it should, of its version - re-read
    // from DRS after a Save (the one reload); with nothing to change, the cards
    // just read are current.
    if (added) await openLineMapping(so.number);
    await dump(`so-${so.package.toLowerCase()}-after-reload`);
    record[so.package] = { number: so.number, lines: {} };
    for (const line of so.lines) {
      const key = `${line.lineNumber}-${line.serviceItemNo}`;
      const after = await mappedSubs(lineCard(line));
      expect(after.filter((m) => !m.includes(tagOf(line.version))), `${so.package} line ${key} holds another version's sub-activity`).toEqual([]);
      if (line.subActivities) {
        // Exactly the planned set: a service-code line its whole group (Piling 3,
        // Robot 2), one of our own lines its pair (max 2).
        expect(after.length, `${so.package} line ${key} holds ${after.length} sub-activities, planned ${line.subActivities.length}: ${JSON.stringify(after)}`)
          .toBe(line.subActivities.length);
        if (!line.group) expect(after.length).toBeLessThanOrEqual(DATA.maxSubActivitiesPerLine);
        for (const n of line.subActivities) {
          expect(after.some((m) => isSub(m, n, line.version)), `${so.package} line ${key}: "${n}" missing after save`).toBe(true);
        }
      }
      expect(after.length, `${so.package} line ${key} is empty after save`).toBeGreaterThan(0);
      record[so.package].lines[key] = { version: line.version, subActivities: after };
      console.log(`    ${key}${added ? ' after reload' : ''}: ${after.length} chip(s) of ${line.version}`);
    }
    await expect(page.getByText('No sub activities mapped')).toHaveCount(0);

    // Recorded atomically (parallel workers); D9 is done once every SO is in.
    state.mutateProject(ENV.key, run.tag, (p) => {
      p.soLineMapping = { ...(p.soLineMapping || {}), ...record };
      if (SOS.every((x) => p.soLineMapping[x.package])) p.stagesDone = [...new Set([...(p.stagesDone || []), 'D9'])];
    });
  });
}
