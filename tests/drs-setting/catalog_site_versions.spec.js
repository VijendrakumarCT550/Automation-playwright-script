const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { drsEnv, loginSuperAdmin, makeDumper } = require('../drs/utils/drs-ui');
const state = require('../drs/utils/drs-state');
const PackagesConfiguratorPage = require('./PackagesConfiguratorPage');
const { expectedNames, siteChecklists } = require('./pc-data');
const ChecklistsConfiguratorPage = require('./ChecklistsConfiguratorPage');
const counter = require('./pc-counter');

// ===========================================================================
// SITE CATALOG VERSIONS - AUTOMATION SITE v1 and v2 (app owner, 2026-10-15).
//
//   S1  select "All sites v1" -> New draft (a site draft: "AUTOMATION SITE v1")
//       -> build the NEXT codes under BOTH Civil and Electrical (PC01/QC01 and
//       PE01/QE01 on a fresh counter) -> verify -> LOCK.
//   S2  select "AUTOMATION SITE v1" -> New draft ("AUTOMATION SITE v2") -> prove
//       S1's trees came along -> build the next codes (PC02/QC02, PE02/QE02)
//       -> verify -> LOCK.
//
// WHAT A NEW DRAFT COPIES: the app owner says the version that is SELECTED when
// New draft is clicked; the catalog guide (4.6) says the newest locked one. Before
// New draft the spec reads the sub-package lists of the source and of the newest
// locked version, compares the draft with both, records the result, and stops
// before building if the draft is not the source's copy.
//
// PERMANENT: New draft, every node, and above all LOCK (no unlock, no delete -
// guide section 2). Each step is recorded in tests/fixtures/drs/drs-setup.json
// (env.catalogs["<site>"].S1 / .S2) THE MOMENT the server accepts it, so a rerun
// resumes the same draft with the same codes instead of making a second one. A
// lock happens only after every node and checklist of the step is verified; a lock
// advisory or refusal is never accepted.
//
// Codes: <P|Q><C|E><NN> (pc-data.js), counter per package in
// tests/fixtures/drs/catalog-counter.json (pc-counter.js). A Letter cannot hold a
// digit (guide 6.4), so the code is the Name/Code and the app assigns the Letter.
//
// Run:  npx playwright test --project=drs-setting tests/drs-setting/catalog_site_versions.spec.js --workers=1
//       CATALOG_SITE="AUTOMATION SITE" (default)   CATALOG_STEPS=S1 (one step only)
//       CATALOG_NO_LOCK=1 (build + verify, leave the draft for a person to lock)
// ===========================================================================

const ENV = drsEnv();
const SITE = process.env.CATALOG_SITE || require('../drs/drs-data').site;
const PACKAGES = ['Civil', 'Electrical'];
const OUT = path.resolve(__dirname, '../../drs-explore/catalog-site-versions');
// THE SITE CHAIN, ONE VERSION PER RUN (app owner, 2026-10-15): S1 = draft from
// "All sites v1"; every later S<n> = draft from S<n-1>. A run works on the newest
// step: it resumes it when not locked yet, else it builds the NEXT one.
// CATALOG_STEPS=S1,S2 re-verifies those (locked) steps instead.
// From S3 on (CHECKLISTS_FROM) the build also makes our six checklists and binds
// them on the Civil P-code's .2.1 / .2.2 checkpoints only, with the a -> b -> c
// dependencies there (docs/drs-checklists.md). S1/S2 were built before that.
const CHECKLISTS_FROM = 3;
const stepNo = (key) => Number(String(key).replace(/^S/, ''));
function planSteps() {
  const recorded = Object.keys(cats()).filter((k) => /^S\d+$/.test(k)).sort((a, b) => stepNo(a) - stepNo(b));
  const chosen = process.env.CATALOG_STEPS ? process.env.CATALOG_STEPS.split(',').map((x) => x.trim()) : null;
  let keys = chosen;
  if (!keys) {
    const last = recorded[recorded.length - 1];
    if (!last) keys = ['S1'];
    else keys = cats()[last].status === 'locked' ? [`S${stepNo(last) + 1}`] : [last];
  }
  return keys.map((key) => ({
    key,
    withChecklists: stepNo(key) >= CHECKLISTS_FROM,
    source: (c) => {
      if (key === 'S1') return 'All sites v1';
      const prev = c[`S${stepNo(key) - 1}`];
      return prev && prev.status === 'locked' && prev.label;
    },
  }));
}

test.describe.configure({ mode: 'serial' });

let context, page, pc, dump;
const summary = { screens: [] };

function cats() { return ((state.envRecord(ENV.key).catalogs || {})[SITE]) || {}; }
function putCat(key, patch) {
  const all = state.envRecord(ENV.key).catalogs || {};
  const site = all[SITE] || {};
  site[key] = { ...(site[key] || {}), ...patch, updatedAt: new Date().toISOString() };
  state.updateEnv(ENV.key, { catalogs: { ...all, [SITE]: site } });
  return site[key];
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The sub-package names per package, SORTED: a new draft recomputes positions
// (guide 6.2), so its tree lists the same sub-packages in another order - seen live
// 2026-10-15, AUTOMATION SITE v1 listed All sites v1's seven Civil sub-packages
// alphabetically. Order is not identity; the set of names is.
async function fingerprint() {
  const fp = {};
  for (const pkg of PACKAGES) fp[pkg] = [...await pc.subPackageNames(pkg)].sort();
  return fp;
}

// Which version did the draft copy - the chosen source or the newest locked one?
// Reads all three trees; leaves the DRAFT selected.
async function copyCheck(source, newestLocked, draftLabel) {
  await pc.chooseVersion(newestLocked);
  const fpNewest = await fingerprint();
  await pc.chooseVersion(source);
  const fpSource = await fingerprint();
  await pc.openDraft(draftLabel);
  const fpDraft = await fingerprint();
  return {
    copied: {
      source, newestLocked,
      matchesSource: same(fpDraft, fpSource), matchesNewest: same(fpDraft, fpNewest),
      distinguishable: !same(fpSource, fpNewest),
    },
    fpDraft, fpSource, fpNewest,
  };
}

// The build options of one code: the code that got our checklists (recorded on its
// step as `checklistCode` + `checklists`) is built AND verified with them and with
// the a -> b -> c dependencies; every other code with the standard checklists.
function optsFor(L) {
  const rec = Object.values(cats()).find((c) => c.checklistCode === L && c.checklists);
  return rec ? { checklists: rec.checklists, dependencies: true } : {};
}

// Every code of `codes` ({ Civil: [...], Electrical: [...] }) fully present?
async function verifyCodes(codes, label) {
  for (const pkg of PACKAGES) {
    for (const L of codes[pkg] || []) {
      const { missing, wrongChecklist, missingDependency } = await pc.verifyLetter(L, pkg, optsFor(L));
      const total = expectedNames(L).length;
      console.log(`  ${label} / ${pkg} / ${L}: ${total - missing.length}/${total} nodes` +
        `${wrongChecklist.length ? `, ${wrongChecklist.length} without their checklist` : ''}` +
        `${missingDependency.length ? `, ${missingDependency.length} without their dependency` : ''}`);
      expect(missing, `${label}: ${pkg} / ${L} nodes missing`).toEqual([]);
      expect(wrongChecklist, `${label}: ${pkg} / ${L} checkpoints without their checklist`).toEqual([]);
      expect(missingDependency, `${label}: ${pkg} / ${L} checkpoints without their dependency`).toEqual([]);
    }
  }
}

// THE SIX CHECKLISTS of a step (docs/drs-checklists.md §2), made in the Checklists
// Configurator and recorded on the step the moment each exists (they cannot be
// deleted). Idempotent: a recorded one is re-read; one that exists by name but was
// not recorded (a run cut off after its create) is adopted. Each is read back and
// checked: our questions with their type + required flag, and a fork's NEW SFQP.
async function ensureChecklists(stepKey, code) {
  const cl = new ChecklistsConfiguratorPage(page, ENV.baseUrl);
  const made = { ...((cats()[stepKey] || {}).checklists || {}) };
  for (const spec of siteChecklists(code)) {
    if (!made[spec.n]) {
      await cl.goto();
      let found = await cl.read(spec.name);
      if (!found) {
        const res = spec.kind === 'new'
          ? await cl.create(spec)
          : await cl.fork(spec.from.n ? made[spec.from.n] : spec.from, { name: spec.name, addQuestions: spec.addQuestions });
        const of = spec.from ? ` of ${spec.from.n ? `#${spec.from.n}` : spec.from.name}` : '';
        console.log(`    checklist ${spec.n} "${spec.name}" (${spec.kind}${of}) -> ${res.method} ${res.url} HTTP ${res.status}`);
        if (res.status >= 300) console.log(`      sent: ${res.payload}
      answer: ${res.body.slice(0, 500)}`);
        expect(res.status, `${spec.name}: ${spec.kind} answered ${res.status}: ${res.body.slice(0, 300)}`).toBeLessThan(300);
        await cl.goto();
        found = await cl.read(spec.name);
      } else {
        console.log(`    checklist ${spec.n} "${spec.name}" already exists (${found.sfqp}) - adopting`);
      }
      expect(found, `${spec.name} not in the list after its ${spec.kind}`).toBeTruthy();
      made[spec.n] = { name: found.name, sfqp: found.sfqp, kind: spec.kind, from: spec.from || null };
      putCat(stepKey, { checklists: made });
    }
    // Read back: every question we put in, with its type and required flag.
    await cl.goto();
    const got = await cl.read(made[spec.n].name, made[spec.n].sfqp);
    expect(got, `${spec.name} (${made[spec.n].sfqp}) not found on read-back`).toBeTruthy();
    const want = spec.kind === 'new' ? spec.questions : spec.addQuestions;
    for (const q of want) {
      const g = got.questions.find((x) => x.text === q.text);
      expect(g, `${spec.name}: question "${q.text}" missing (read: ${JSON.stringify(got.questions.map((x) => x.text))})`).toBeTruthy();
      expect(g.type, `${spec.name}: "${q.text}" type`).toBe(q.type);
      expect(g.required, `${spec.name}: "${q.text}" required`).toBe(q.required);
    }
    if (spec.kind === 'fork') {
      const src = spec.from.n ? made[spec.from.n] : spec.from;
      expect(got.sfqp, `${spec.name}: a fork should get a NEW SFQP, not its source's`).not.toBe(src.sfqp);
    }
    console.log(`    checklist ${spec.n} "${got.name}" (${got.sfqp}): ${got.questions.length} question(s) ok`);
  }
  return made;
}

test.beforeAll(async ({ browser }) => {
  test.setTimeout(5 * 60 * 1000);
  context = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  page = await context.newPage();
  await loginSuperAdmin(page, ENV);
  pc = new PackagesConfiguratorPage(page, ENV.baseUrl);
  dump = makeDumper(page, OUT, summary);
  console.log(`  site catalogs for "${SITE}" on drs-${ENV.key}; recorded: ${JSON.stringify(cats())}`);
});

test.afterAll(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ ...summary, catalogs: cats() }, null, 2));
  if (context) await context.close();
});

for (const step of planSteps()) {
  test(`${step.key}. ${SITE}: draft, build Civil + Electrical, lock`, async () => {
    test.setTimeout(4 * 60 * 60 * 1000);
    let rec = cats()[step.key];
    const source = step.source(cats());
    expect(source, `${step.key}: its source version is not locked yet - run the previous step first`).toBeTruthy();

    await pc.goto();
    await pc.selectProjectTypeAndSite(SITE);
    const chainRe = new RegExp(`^${SITE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} v\\d+\\s+—`, 'i');

    // ---- already locked: re-verify read-only and stop ----
    if (rec && rec.status === 'locked') {
      await pc.chooseVersion(rec.label);
      expect(await pc.isLockedVersion(), `${rec.label} is recorded locked but is not`).toBe(true);
      await verifyCodes(mergeCodes(rec.inheritedCodes || {}, rec.codes), rec.label);
      console.log(`  ${step.key}: ${rec.label} already locked - verified`);
      return;
    }

    // ---- the draft: new, or resumed ----
    if (!rec || !rec.label) {
      const offered = await pc.optionLabels('Catalog version');
      const own = offered.filter((l) => chainRe.test(l));
      const recordedLabels = Object.values(cats()).map((c) => c.label).filter(Boolean);
      // The source is expected: with CATALOG_SITE="All sites" the chain's own v1 is it.
      const strangers = own.filter((l) => ![...recordedLabels, source].includes(PackagesConfiguratorPage.bareLabel(l)));
      expect(strangers, `${SITE} has versions this spec did not record - check by hand before going on`).toEqual([]);

      // What a draft COULD copy: the chosen source, or the newest locked version.
      const newest = PackagesConfiguratorPage.bareLabel(offered.find((l) => /—\s*locked$/i.test(l)));
      await pc.chooseVersion(source);
      await dump(`${step.key}-source-${source.replace(/\W+/g, '-')}`);

      const created = await pc.newDraftFrom(SITE, source);
      rec = putCat(step.key, { label: created.label, source, newestLocked: newest, status: 'drafted', draftedAt: new Date().toISOString() });
      console.log(`  ${step.key}: New draft from "${source}" -> "${created.label}" (HTTP ${created.status})`);
      await dump(`${step.key}-new-draft`);
    } else {
      await pc.openDraft(rec.label);
      console.log(`  ${step.key}: resuming draft ${rec.label}`);
    }

    // ---- which version did the draft copy? (once per draft; nothing built yet) ----
    if (!rec.copied || !rec.copied.matchesSource) {
      const offered = await pc.optionLabels('Catalog version');
      const newest = rec.newestLocked || PackagesConfiguratorPage.bareLabel(offered.find((l) => /—\s*locked$/i.test(l)));
      const { copied, fpDraft, fpSource, fpNewest } = await copyCheck(source, newest, rec.label);
      rec = putCat(step.key, { copied, newestLocked: newest });
      console.log(`  ${step.key}: draft copy check ${JSON.stringify(copied)}`);
      expect(copied.matchesSource, `${rec.label} is not a copy of "${source}" (sorted sub-packages - draft ` +
        `${JSON.stringify(fpDraft)} / source ${JSON.stringify(fpSource)} / newest ${JSON.stringify(fpNewest)})`).toBe(true);
    }

    // ---- S2+: the previous step's trees came along in the copy ----
    if (step.key !== 'S1') {
      const prev = cats()[`S${stepNo(step.key) - 1}`];
      const inheritedCodes = mergeCodes(prev.inheritedCodes || {}, prev.codes);
      await verifyCodes(inheritedCodes, `${rec.label} (inherited from ${prev.label})`);
      rec = putCat(step.key, { inheritedCodes });
    }

    // ---- codes: reserved once, before any node is created ----
    if (!rec.codes) {
      const codes = {};
      for (const pkg of PACKAGES) {
        const r = counter.reserve(ENV.key, pkg, await pc.usedLetters(pkg));
        codes[pkg] = r.codes;
      }
      rec = putCat(step.key, { codes });
    }
    console.log(`  ${step.key}: codes ${JSON.stringify(rec.codes)}`);

    // ---- S3+: our six checklists, for the Civil P-code ONLY (PCxx.2.1 / .2.2 -
    //      app owner: "only PC.xx.2.1 and .2.2, not QC, nowhere else") ----
    if (step.withChecklists) {
      const code = rec.codes.Civil.find((c) => c.startsWith('P'));
      rec = putCat(step.key, { checklistCode: code });
      const checklists = await ensureChecklists(step.key, code);
      rec = putCat(step.key, { checklists });
      await pc.goto();
      await pc.selectProjectTypeAndSite(SITE);
      await pc.openDraft(rec.label);
    }

    // ---- build + verify ----
    for (const pkg of PACKAGES) {
      for (const L of rec.codes[pkg]) {
        await pc.buildLetter(L, pkg, optsFor(L));
        console.log(`  ${step.key} / ${pkg} / ${L}: built`);
      }
    }
    await verifyCodes(rec.codes, rec.label);
    rec = putCat(step.key, { status: 'built' });
    await dump(`${step.key}-built`);

    // CATALOG_NO_LOCK=1: leave the built draft open - the app owner locks it by hand
    // (drs-dev, 2026-10-30). A later run resumes it (status stays below 'locked').
    if (process.env.CATALOG_NO_LOCK === '1') {
      console.log(`  ${step.key}: ${rec.label} built + verified, left as DRAFT (CATALOG_NO_LOCK=1) - lock it by hand`);
      return;
    }

    // ---- lock (permanent) ----
    const lock = await pc.lockVersion(rec.label);
    console.log(`  ${step.key}: lock -> HTTP ${lock.status} ${lock.url}\n    dialog: ${lock.dialogText.slice(0, 200)}\n    after: ${lock.after.slice(0, 300)}`);
    expect(lock.status, `lock of ${rec.label} answered ${lock.status}: ${lock.body.slice(0, 400)}`).toBeLessThan(300);

    await pc.goto();
    await pc.selectProjectTypeAndSite(SITE);
    const offered = await pc.optionLabels('Catalog version');
    expect(offered, `${rec.label} is not listed as locked`).toContain(`${rec.label} — locked`);
    await pc.chooseVersion(rec.label);
    expect(await pc.isLockedVersion()).toBe(true);
    rec = putCat(step.key, { status: 'locked', lockedAt: new Date().toISOString() });
    await verifyCodes(mergeCodes(rec.inheritedCodes || {}, rec.codes), `${rec.label} (locked)`);
    await dump(`${step.key}-locked`);
  });
}

function mergeCodes(a, b) {
  const out = {};
  for (const pkg of PACKAGES) out[pkg] = [...((a && a[pkg]) || []), ...((b && b[pkg]) || [])];
  return out;
}
