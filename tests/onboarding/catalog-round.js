const { expect } = require('@playwright/test');
const state = require('../drs/utils/drs-state');
const counter = require('../drs-setting/pc-counter');
const PackagesConfiguratorPage = require('../drs-setting/PackagesConfiguratorPage');
const ChecklistsConfiguratorPage = require('../drs-setting/ChecklistsConfiguratorPage');
const { expectedNames, siteChecklists, DEPENDENCY_PLANS } = require('../drs-setting/pc-data');

// ONE CATALOG ROUND of the onboarding suite (docs/drs-onboarding-suite.md):
//   foreign open draft? -> lock it, or STOP with DRS's validation message
//   New draft from `source` -> copy check -> reserve codes (Civil P/Q, Electrical P/Q)
//   -> site rounds: our six checklists (fresh, "AUTO R<n> <code> Checklist <k>")
//   -> build the new codes: Civil P-code with the FIRST dependency plan (+ our
//      checklists on .2.1/.2.2 in site rounds); everything else standard
//   -> round 2: the INHERITED Civil P-code of this run's round 1 is reconciled to
//      the SECOND plan (first-draft dependencies removed, .2.x a->b->c added)
//   -> verify every code (strictly where a plan applies) -> LOCK -> verify again.
// Records land in the state file's env.catalogs[<chain>][<run>-<key>] (the shape
// drs-data.catalogCodes and the project stages read) the moment each piece exists;
// a re-run resumes the same draft with the same codes and checklists.

const PACKAGES = ['Civil', 'Electrical'];
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function chainRecs(envKey, chain) { return ((state.envRecord(envKey).catalogs || {})[chain]) || {}; }
// Atomic (state.mutateEnv, under the state lock): the two chains are built by
// parallel workers, and a stale read here would drop the other chain's records.
function putCat(envKey, chain, key, patch) {
  return state.mutateEnv(envKey, (env) => {
    env.catalogs = env.catalogs || {};
    const c = env.catalogs[chain] = env.catalogs[chain] || {};
    c[key] = { ...(c[key] || {}), ...patch, updatedAt: new Date().toISOString() };
    return c[key];
  });
}
// Any recorded version (either chain) by its label.
function recByLabel(envKey, label) {
  return Object.values(state.envRecord(envKey).catalogs || {}).flatMap((c) => Object.values(c))
    .find((r) => r && r.label === label) || null;
}

// Build / verify options of one code in one version (from the version's codePlans).
function optsFor(rec, L) {
  const p = (rec.codePlans || {})[L];
  if (!p) return {};
  return { ...(p.checklists ? { checklists: p.checklists } : {}), ...(p.deps ? { dependencies: DEPENDENCY_PLANS[p.deps] } : {}) };
}

async function verifyCodes(pc, rec, codes, label) {
  for (const pkg of PACKAGES) {
    for (const L of codes[pkg] || []) {
      const { missing, wrongChecklist, missingDependency } = await pc.verifyLetter(L, pkg, optsFor(rec, L));
      const total = expectedNames(L).length;
      console.log(`    ${label} / ${pkg} / ${L}: ${total - missing.length}/${total} nodes` +
        `${wrongChecklist.length ? `, ${wrongChecklist.length} wrong checklist` : ''}` +
        `${missingDependency.length ? `, ${missingDependency.length} dependency problems ${JSON.stringify(missingDependency)}` : ''}` +
        `${(rec.codePlans || {})[L] ? ` [${JSON.stringify((rec.codePlans || {})[L].deps || 'no deps')}${(rec.codePlans[L] || {}).checklists ? ', our checklists' : ''}]` : ''}`);
      expect(missing, `${label}: ${pkg} / ${L} nodes missing`).toEqual([]);
      expect(wrongChecklist, `${label}: ${pkg} / ${L} wrong checklists`).toEqual([]);
      expect(missingDependency, `${label}: ${pkg} / ${L} dependencies`).toEqual([]);
    }
  }
}

const mergeCodes = (a, b) => Object.fromEntries(PACKAGES.map((p) => [p, [...((a || {})[p] || []), ...((b || {})[p] || [])]]));

// Our six checklists for `code`, made in the Checklists Configurator and recorded the
// moment each exists (they cannot be deleted); read back and checked.
async function ensureChecklists(page, ENV, chain, key, code, prefix) {
  const cl = new ChecklistsConfiguratorPage(page, ENV.baseUrl);
  const made = { ...((chainRecs(ENV.key, chain)[key] || {}).checklists || {}) };
  for (const spec of siteChecklists(code, prefix)) {
    if (!made[spec.n]) {
      await cl.goto();
      let found = await cl.read(spec.name);
      if (!found) {
        const res = spec.kind === 'new'
          ? await cl.create(spec)
          : await cl.fork(spec.from.n ? made[spec.from.n] : spec.from, { name: spec.name, addQuestions: spec.addQuestions });
        console.log(`    checklist ${spec.n} "${spec.name}" (${spec.kind}) -> HTTP ${res.status}`);
        if (res.status >= 300) console.log(`      sent: ${res.payload}\n      answer: ${res.body.slice(0, 400)}`);
        expect(res.status, `${spec.name}: ${spec.kind} answered ${res.status}`).toBeLessThan(300);
        await cl.goto();
        found = await cl.read(spec.name);
      }
      expect(found, `${spec.name} not listed after its ${spec.kind}`).toBeTruthy();
      made[spec.n] = { name: found.name, sfqp: found.sfqp, kind: spec.kind };
      putCat(ENV.key, chain, key, { checklists: made });
    }
    await cl.goto();
    const got = await cl.read(made[spec.n].name, made[spec.n].sfqp);
    for (const q of (spec.kind === 'new' ? spec.questions : spec.addQuestions)) {
      const g = got.questions.find((x) => x.text === q.text);
      expect(g, `${spec.name}: question "${q.text}" missing`).toBeTruthy();
    }
    console.log(`    checklist ${spec.n} "${got.name}" (${got.sfqp}): ${got.questions.length} question(s) ok`);
    // The question texts as DRS holds them (forks carry the source's too): OB04
    // checks Pulse's checklist page shows exactly these (2026-10-21).
    made[spec.n] = { ...made[spec.n], questions: got.questions.map((q) => q.text) };
    putCat(ENV.key, chain, key, { checklists: made });
  }
  return made;
}

// If the chain has an OPEN draft this suite did not make, try to LOCK it (app owner,
// 2026-10-19). A refused lock stops the run with DRS's own reason, for a person to
// lock or discard it by hand.
async function clearForeignDraft(pc, ENV, chain) {
  const offered = await pc.optionLabels('Catalog version');
  const draftRe = new RegExp(`^${esc(chain)} v\\d+\\s+—\\s+draft$`, 'i');
  const open = offered.find((l) => draftRe.test(l));
  if (!open) return;
  const label = PackagesConfiguratorPage.bareLabel(open);
  if (Object.values(chainRecs(ENV.key, chain)).some((r) => r.label === label && r.status !== 'locked')) return; // ours
  console.log(`  ${chain}: foreign open draft "${label}" - trying to lock it`);
  await pc.openDraft(label);
  const lock = await pc.lockVersion(label).catch((e) => ({ status: 0, body: e.message, dialogText: '', after: '' }));
  await pc.goto();
  await pc.selectProjectTypeAndSite(chain);
  const still = (await pc.optionLabels('Catalog version')).some((l) => l === `${label} — draft`);
  if (lock.status >= 300 || lock.status === 0 || still) {
    throw new Error(`Locking the foreign draft "${label}" (${chain}) failed - DRS validation: ` +
      `${(lock.after || lock.dialogText || lock.body || '').slice(0, 800)}\n` +
      'Lock or discard it by hand in DRS, then re-run the suite.');
  }
  console.log(`  ${chain}: "${label}" locked (HTTP ${lock.status})`);
}

// round = { key, chain: 'All sites'|<site>, round: 1|2, source, run: 'R1', withChecklists }
async function buildRound(page, ENV, round) {
  const pc = new PackagesConfiguratorPage(page, ENV.baseUrl);
  const key = `${round.run}-${round.key}`;
  const chain = round.chain;
  let rec = chainRecs(ENV.key, chain)[key];
  await pc.goto();
  await pc.selectProjectTypeAndSite(chain);

  if (rec && rec.status === 'locked') {
    await pc.chooseVersion(rec.label);
    expect(await pc.isLockedVersion(), `${rec.label} is recorded locked but is not`).toBe(true);
    await verifyCodes(pc, rec, mergeCodes(rec.inheritedCodes, rec.codes), `${rec.label} (locked)`);
    console.log(`  ${key}: ${rec.label} already locked - verified`);
    return rec;
  }

  if (!rec || !rec.label) {
    await clearForeignDraft(pc, ENV, chain);
    await pc.goto();
    await pc.selectProjectTypeAndSite(chain);
    const created = await pc.newDraftFrom(chain, round.source);
    rec = putCat(ENV.key, chain, key, { label: created.label, source: round.source, status: 'drafted', run: round.run, round: round.round, onboarding: true, draftedAt: new Date().toISOString() });
    console.log(`  ${key}: New draft from "${round.source}" -> "${created.label}"`);
  } else {
    await pc.openDraft(rec.label);
    console.log(`  ${key}: resuming draft ${rec.label}`);
  }

  // Copy check, once: the draft holds the same sub-packages as its source.
  if (!rec.copied) {
    // ONE package at a time: reading both trees in parallel made the two expand
    // clicks interfere (live 2026-10-19: Civil never opened).
    const fp = async () => {
      const out = {};
      for (const p of PACKAGES) out[p] = [...await pc.subPackageNames(p)].sort();
      return out;
    };
    await pc.chooseVersion(round.source);
    const fpSource = await fp();
    await pc.openDraft(rec.label);
    const fpDraft = await fp();
    expect(same(fpDraft, fpSource), `${rec.label} is not a copy of "${round.source}"`).toBe(true);
    // What came along: the source's own codes (if it is one of ours) and its plans.
    const src = recByLabel(ENV.key, round.source);
    const inheritedCodes = src ? mergeCodes(src.inheritedCodes, src.codes) : mergeCodes({}, {});
    rec = putCat(ENV.key, chain, key, { copied: true, inheritedCodes, codePlans: { ...((src && src.codePlans) || {}) } });
    console.log(`  ${key}: copy of "${round.source}" ok; inherited ${JSON.stringify(inheritedCodes)}`);
  }

  // Codes, reserved once, before any node exists.
  if (!rec.codes) {
    const codes = {};
    for (const pkg of PACKAGES) codes[pkg] = counter.reserve(ENV.key, pkg, await pc.usedLetters(pkg)).codes;
    rec = putCat(ENV.key, chain, key, { codes });
  }
  const civilP = rec.codes.Civil.find((c) => c.startsWith('P'));
  console.log(`  ${key}: codes ${JSON.stringify(rec.codes)}`);

  // Plans of the NEW codes (+ the inherited round-1 P-code in round 2).
  const plans = { ...(rec.codePlans || {}) };
  if (!plans[civilP]) {
    plans[civilP] = { deps: 'first' };
    if (round.withChecklists) {
      const checklists = await ensureChecklists(page, ENV, chain, key, civilP, round.run);
      plans[civilP].checklists = checklists;
      await pc.goto();
      await pc.selectProjectTypeAndSite(chain);
      await pc.openDraft(rec.label);
    }
    rec = putCat(ENV.key, chain, key, { codePlans: plans });
  }
  const inheritedP = round.round === 2
    ? (rec.inheritedCodes.Civil || []).find((c) => (plans[c] || {}).deps === 'first')
    : null;

  // Build the new codes.
  for (const pkg of PACKAGES) {
    for (const L of rec.codes[pkg]) {
      await pc.buildLetter(L, pkg, optsFor(rec, L));
      console.log(`    ${pkg} / ${L}: built`);
    }
  }
  // Round 2: the inherited round-1 P-code moves to the second plan.
  if (inheritedP) {
    await pc.expand('Civil');
    await pc.expand(`${inheritedP} Sub Package`);
    for (const a of [1, 2]) await pc.expand(`${inheritedP}.${a} Activity`).catch(() => {});
    await pc.reconcileDependencies(inheritedP, DEPENDENCY_PLANS.first, DEPENDENCY_PLANS.secondInherited);
    plans[inheritedP] = { ...plans[inheritedP], deps: 'secondInherited' };
    rec = putCat(ENV.key, chain, key, { codePlans: plans });
    console.log(`    Civil / ${inheritedP}: dependencies moved first -> secondInherited`);
  }

  await verifyCodes(pc, rec, mergeCodes(rec.inheritedCodes, rec.codes), rec.label);
  rec = putCat(ENV.key, chain, key, { status: 'built' });

  const lock = await pc.lockVersion(rec.label);
  console.log(`  ${key}: lock -> HTTP ${lock.status}`);
  expect(lock.status, `lock of ${rec.label} answered ${lock.status}: ${lock.body.slice(0, 400)} ${lock.after.slice(0, 400)}`).toBeLessThan(300);
  await pc.goto();
  await pc.selectProjectTypeAndSite(chain);
  expect(await pc.optionLabels('Catalog version'), `${rec.label} is not listed as locked`).toContain(`${rec.label} — locked`);
  await pc.chooseVersion(rec.label);
  expect(await pc.isLockedVersion()).toBe(true);
  rec = putCat(ENV.key, chain, key, { status: 'locked', lockedAt: new Date().toISOString() });
  await verifyCodes(pc, rec, mergeCodes(rec.inheritedCodes, rec.codes), `${rec.label} (locked)`);
  return rec;
}

module.exports = { buildRound, recByLabel, chainRecs };
