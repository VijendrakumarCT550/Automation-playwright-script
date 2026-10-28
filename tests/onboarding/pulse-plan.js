const state = require('../drs/utils/drs-state');
const DATA = require('../drs/drs-data');
const { buildTree, DEPENDENCY_PLANS, SITE_CHECKLIST_BINDING } = require('../drs-setting/pc-data');
const { coverageArea } = require('./onboarding-run');

// THE PULSE SIDE OF AN ONBOARDING RUN (docs/drs-onboarding-suite.md §5).
//
// From the run's project (areaVersions) and its catalog records (codePlans), the
// list of RFI items OB04 walks, per catalog version:
//
//   plain    one RFI, CI -> EE -> QI approve, on every Work Area:
//              WA<nn>  Civil       the standard Piling RFI (Piling - MMS / Pre Pour
//                                  Inspection - Pile / Micro Pile Checklist)
//              WA<nn>  Electrical  the version's newest PE code, .1.1 Checkpoint a
//                                  (a version with no PE code has none)
//              Road<nn> / Drain<nn> / Culvert<nn>  Civil, their own sub-package,
//                                  first activity / sub-activity / checkpoint
//   chain    a dependency plan of our Civil P-code, per sub-activity "<a>.<s>"
//            (pc-data DEPENDENCY_PLANS): `deps` = the checkpoints that wait for
//            the one before them ([] = none - b and c must go through with no
//            predecessor; for a round-2 INHERITED code that proves the removal
//            reached Pulse)
//
// Which sub-activities are checked per plan:
//   first            1.1 (b<-a), 1.2 (b<-a, c<-b)
//   secondInherited  1.1 [], 1.2 [] (removed) and 2.1, 2.2 (b<-a, c<-b, added)
// The roots (All sites v1, <site> v1) get plain RFIs only.

// The standard Civil RFI every version carries (projects.js SOLAR_E2E.rfi).
const STANDARD_CIVIL = {
  subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
  activity: 'Piling - MMS',
  subActivity: 'Piling - MMS',
  checkpoint: 'Pre Pour Inspection - Pile',
  checklist: 'Micro Pile Checklist',
};

// The linear Work Areas' own sub-packages in the Solar catalog (DRS tree, All
// sites v1) and the activity each maps to in SO Configuration (D05).
const LINEAR = {
  Road: { subPackage: 'Road Works - IDT Road', activity: '__first__' },
  Drain: { subPackage: 'Drain Work - Plot Area', activity: 'Drain Work' },
  Culvert: { subPackage: 'Culvert Works - Plot Area', activity: '__first__' },
};

const CHECKED_SUBS = {
  first: ['1.1', '1.2'],
  secondInherited: ['1.1', '1.2', '2.1', '2.2'],
};

// The catalog record of a version label (any chain), or null.
function catalogRecord(envRecord, label) {
  for (const chain of Object.values(envRecord.catalogs || {})) {
    for (const rec of Object.values(chain)) if (rec && rec.label === label) return rec;
  }
  return null;
}

// One checkpoint as the RFI form takes it: { name, checklist (chip) }, plus `own`
// = the made checklist ({ name, sfqp, questions? }) when the checkpoint binds one
// of OUR checklists - OB04 then checks Pulse shows exactly its questions.
function cpOf(c, subKey, checklists) {
  const n = checklists && (SITE_CHECKLIST_BINDING[subKey] || {})[c.key];
  return { name: c.name, checklist: c.checklist.chip, ...(n && checklists[n] ? { own: { n, ...checklists[n] } } : {}) };
}

const SUB_KEYS = ['1.1', '1.2', '2.1', '2.2'];
const PKG_OF = (code) => (/^.C/.test(code) ? 'Civil' : 'Electrical');

// EVERY CHECKPOINT OF EVERY NEW CODE (app owner, 2026-10-21: "all newly added
// entities from DRS tested fully"). For each round version, each of its OWN new
// codes (PCxx, QCxx, PExx, QExx), each of the 4 sub-activities:
//   - a sub-activity its dependency plan covers -> a `chain` item (blocked /
//     released, every RFI approved);
//   - any other -> a `full` item: checkpoints a, b, c raised on one Work Section
//     and each approved by EE + QI.
// The code INHERITED into round 2 keeps its dependency items (CHECKED_SUBS).
// NC: one per sub-activity of every new code (ncItems, OB05).
function codeItems(wa, code, p, { inherited }) {
  const pkg = PKG_OF(code);
  const depPlan = p && p.deps ? DEPENDENCY_PLANS[p.deps] : null;
  const checklists = p && p.checklists;
  const tree = buildTree(code, { ...(checklists ? { checklists } : {}), ...(depPlan ? { dependencies: depPlan } : {}) });
  const subs = inherited ? (CHECKED_SUBS[p.deps] || []) : SUB_KEYS;
  return subs.map((subKey) => {
    const [ai, si] = subKey.split('.').map(Number);
    const activity = tree.activities[ai - 1];
    const sub = activity.subActivities[si - 1];
    const deps = (depPlan && depPlan[subKey]) || [];
    const base = { pkg, workArea: wa, code, subPackage: tree.name, activity: activity.name, subActivity: sub.name,
      checkpoints: sub.checkpoints.map((c) => cpOf(c, subKey, checklists)) };
    // An inherited code's sub-activity the plan gives no dependency is the REMOVAL
    // proof (b / c go through with no predecessor) - a chain item with deps [].
    if (deps.length || inherited) return { id: `${wa}/${pkg}/${code}.${subKey}`, kind: 'chain', plan: p.deps, deps, ...base };
    return { id: `${wa}/${pkg}/${code}.${subKey}`, kind: 'full', plan: (p && p.deps) || 'none', deps: [], ...base };
  });
}

// TWO MODES (app owner, 2026-10-21: onboarding back to ~1.9 h, the depth in
// tests/onboarding-smoke):
//   'onboarding' (default)  per version: the standard Civil RFI, one RFI on the
//                           newest PE code, one per Road / Drain / Culvert, and the
//                           dependency checks of every planned P-code (CHECKED_SUBS:
//                           blocked / released, the round-2 removal proof)
//   'coverage'              EVERYTHING ELSE on the version's new codes - every
//                           checkpoint of every PC / QC / PE / QE sub-activity, our
//                           checklists' questions - and one NC per sub-activity
// ONBOARDING_PLAN picks it (OB04 / OB05); the two never repeat each other's items.
function plan(project, mode = process.env.ONBOARDING_PLAN || 'onboarding') {
  const env = state.envRecord(DATA.DRS_ENV || String(process.env.DRS_ENV || 'uat').toLowerCase());
  const byVersion = {};
  for (const [wa, version] of Object.entries(project.areaVersions || {})) {
    (byVersion[version] = byVersion[version] || []).push(wa);
  }
  const versions = [];
  for (const [version, areas] of Object.entries(byVersion)) {
    const kindArea = (k) => areas.find((a) => new RegExp(`^${k}\\d+$`).test(a));
    const basic = [];
    const wa = kindArea('WA');
    const rec = catalogRecord(env, version);
    const plans = (rec && rec.codePlans) || {};
    if (wa) {
      basic.push({ id: `${wa}/Civil/standard`, kind: 'plain', pkg: 'Civil', workArea: wa, ...STANDARD_CIVIL });
      const pe = DATA.catalogCodes(env, version, 'Electrical').filter((c) => c.startsWith('P')).pop();
      if (pe) {
        const t = buildTree(pe);
        const a = t.activities[0]; const sb = a.subActivities[0]; const c = sb.checkpoints[0];
        basic.push({ id: `${wa}/Electrical/${pe}`, kind: 'plain', pkg: 'Electrical', workArea: wa,
          subPackage: t.name, activity: a.name, subActivity: sb.name, checkpoint: c.name, checklist: c.checklist.chip });
      }
    }
    for (const [k, l] of Object.entries(LINEAR)) {
      const area = kindArea(k);
      if (area) basic.push({ id: `${area}/Civil/${k}`, kind: 'plain', pkg: 'Civil', workArea: area,
        subPackage: l.subPackage, activity: l.activity, subActivity: '__first__', checkpoint: '__first__', checklist: '__first__' });
    }
    if (wa) {
      for (const [code, p] of Object.entries(plans)) {
        if (p.deps && CHECKED_SUBS[p.deps]) basic.push(...codeItems(wa, code, p, { inherited: true }));
      }
    }
    if (mode !== 'coverage') { versions.push({ version, areas, items: basic, ncItems: [] }); continue; }

    // COVERAGE: this round's NEW codes - only versions THIS SUITE built (a root such
    // as <site> v1 predates the run) - every sub-activity / checkpoint not already
    // an onboarding item, and one NC per sub-activity.
    const own = (rec && rec.onboarding && rec.codes) || {};
    const newCodes = [...(own.Civil || []), ...(own.Electrical || [])];
    // On the run's own coverage area CV<nn>-<run> (onboarding-run.js
    // coverageAreaPlan) when OS01 imported it, else on WA<nn>.
    const run = process.env.ONBOARDING_RECORD;
    const cv = wa && run ? areas.find((a) => a === coverageArea(wa.slice(2), run)) : null;
    const area = cv || wa;
    const sameItem = new Set(basic.map((it) => it.id.slice(it.workArea.length)));
    const items = [];
    const ncItems = [];
    if (area) {
      for (const code of newCodes) {
        const its = codeItems(area, code, plans[code], { inherited: false });
        items.push(...its.filter((it) => !sameItem.has(it.id.slice(area.length))));
        for (const it of its) ncItems.push({ id: `${it.id}/NC`, pkg: it.pkg, workArea: area, code, activity: it.activity, subActivity: it.subActivity });
      }
    }
    versions.push({ version, areas, items, ncItems });
  }
  return versions;
}

// The Pulse stages act ONLY on an onboarding project, named by DRS_PROJECT_TAG (the
// runner sets it). Without one, the integration profile falls back to the newest
// regular DRS project - which these stages must never touch - so the profile is
// marked unavailable and every test fails with this reason instead.
function onboardingOnly(profile) {
  if (profile.unavailable) return profile;
  if (profile.drs.project.onboardingRun && process.env.DRS_PROJECT_TAG) return profile;
  return { ...profile, unavailable: `${profile.drs.project.name} is not an onboarding project named by DRS_PROJECT_TAG - run the onboarding Pulse stages through tests/utils/run-onboarding.js (or set DRS_PROJECT_TAG to an onboarding project)` };
}

module.exports = { plan, onboardingOnly, STANDARD_CIVIL, LINEAR, CHECKED_SUBS, catalogRecord };
