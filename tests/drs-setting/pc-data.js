// DATA for the Packages Configurator hierarchy spec - straight from RUNBOOK.md
// (sections 1, 2, 8.3). Nothing here touches the app.

// Section 1 - the run matrix. Each row is one full pass of the runbook: one
// Project Type (Solar) x one Site scope, two sub-package letters.
const RUNS = [
  { id: 1, site: 'All sites', letters: ['P', 'Q'] },
  { id: 2, site: 'Khavda', letters: ['R', 'S'] },
  { id: 3, site: 'Mandvi', letters: ['T', 'U'] },
];

// How the Catalog version dropdown labels a site's versions (runbook 4.1/4.2):
//   All sites  -> "v3 - draft", "All sites v4 - locked" ...
//   a site     -> "Khavda v1 - draft", "All sites v4 - locked" ...
// The separator is an EM DASH. Matching is by label prefix, never by internal id.
function versionPrefix(site) {
  return site === 'All sites' ? /^(All sites )?v\d+/i : new RegExp(`^${site} v\\d+`, 'i');
}

// Section 2.2 - checklist per checkpoint. The separator in the option label is
// an em dash (U+2014) with a space on each side; several near-duplicates exist
// ("Post-Pour Checklist", "Post Pour Check,FDD Test ...") so match the FULL label.
const CHECKLIST = {
  a: { search: 'Micro Pile Checklist', label: 'Micro Pile Checklist — RE/QA/SFQP/C/012', chip: 'Micro Pile Checklist' },
  b: { search: 'Micro Pile Cap', label: 'Micro Pile Cap Checklist — RE/QA/SFQP/C/012', chip: 'Micro Pile Cap Checklist' },
  c: { search: 'Post Pour Check', label: 'Post Pour Check — RE/QA/SFQP/C/002', chip: 'Post Pour Check' },
};

// ---- SITE-CATALOG CHECKLISTS (app owner, 2026-10-15; docs/drs-checklists.md) ----
// Part of the SITE catalog build: six checklists of our own, made in the Checklists
// Configurator right before the trees, bound to the Civil codes' .2.1 / .2.2
// checkpoints a/b/c. #1 NEW, #2/#3 FORKS of standard checklists, #4/#5/#6 forks
// of #1/#2/#3 (one-to-one). .1.x keeps the standard CHECKLIST above.
// THE PLANNED MIX - every answer type x Value required on/off. DRS answers HTTP 500
// on a checklist holding Number / YesNo / not-required questions (live 2026-10-15;
// the UI sends the same request - app owner reported the bug). Until it is fixed the
// build uses SAFE_QUESTIONS (all Text, required - what DRS accepts);
// CHECKLIST_QUESTION_MIX=1 switches the mix back on.
const MIXED_QUESTIONS = [
  { text: 'Question no 1', type: 'Text', required: true },
  { text: 'Question no 2', type: 'Text', required: false },
  { text: 'Question no 3', type: 'Number', required: true },
  { text: 'Question no 4', type: 'Number', required: false },
  { text: 'Question no 5', type: 'YesNo', required: true },
  { text: 'Question no 6', type: 'YesNo', required: false },
];
const SAFE_QUESTIONS = MIXED_QUESTIONS.map((q) => ({ ...q, type: 'Text', required: true }));
const QUESTIONS = process.env.CHECKLIST_QUESTION_MIX === '1' ? MIXED_QUESTIONS : SAFE_QUESTIONS;
const forkMark = (of) => ({ text: `Question no 7 (fork of ${of})`, type: 'Text', required: true });

// The six specs for a build whose Civil P-code is `code` (PC03 ...). A fork of a
// STANDARD checklist adds our 6 questions + the fork mark; a fork of OURS (which
// already has them) adds the fork mark only. `from` is a standard checklist (name +
// SFQP) or `{ n }` = one of this set (its SFQP is known only after it is made).
//
// Header values follow the real formats (app owner, 2026-10-15: "SERIAL C_14_9, SFQP
// RE/QA/SFQP/C/124, FORMAT QA-C/F-10 - like this it works"), in a 9xx range keyed by
// the build's counter so ours stand out: PC03 -> SERIAL C_93_1, SFQP RE/QA/SFQP/C/931,
// FORMAT QA-C/F-931. (The first try, "AUTO/SFQP/PC03/1" etc., got the 500 too.)
function siteChecklists(code) {
  const name = (n) => `AUTO ${code} Checklist ${n}`;
  const k = `9${Number(String(code).replace(/\D/g, ''))}`; // PC03 -> "93"
  return [
    { n: 1, name: name(1), kind: 'new', serial: `C_${k}_1`, sfqp: `RE/QA/SFQP/C/${k}1`, format: `QA-C/F-${k}1`, questions: QUESTIONS },
    { n: 2, name: name(2), kind: 'fork', from: { name: 'Micro Pile Cap Checklist', sfqp: 'RE/QA/SFQP/C/012' }, addQuestions: [...QUESTIONS, forkMark('Micro Pile Cap Checklist')] },
    { n: 3, name: name(3), kind: 'fork', from: { name: 'Post Pour Check', sfqp: 'RE/QA/SFQP/C/002' }, addQuestions: [...QUESTIONS, forkMark('Post Pour Check')] },
    { n: 4, name: name(4), kind: 'fork', from: { n: 1 }, addQuestions: [forkMark(name(1))] },
    { n: 5, name: name(5), kind: 'fork', from: { n: 2 }, addQuestions: [forkMark(name(2))] },
    { n: 6, name: name(6), kind: 'fork', from: { n: 3 }, addQuestions: [forkMark(name(3))] },
  ];
}

// Which of the six goes on which checkpoint: sub-activity "<a>.<s>" -> letter -> n.
const SITE_CHECKLIST_BINDING = { '2.1': { a: 1, b: 2, c: 3 }, '2.2': { a: 4, b: 5, c: 6 } };

// A made checklist ({ name, sfqp }) in the shape a checkpoint binds: search text,
// the option label ("<name> — <SFQP>", em dash, like the standard ones) and chip.
const checklistRef = (made) => ({ search: made.name, label: `${made.name} — ${made.sfqp}`, chip: made.name });

// Section 2.0/2.1 - the tree for one letter: 1 sub-package, 2 activities,
// 4 sub-activities, 12 inspection points = 19 nodes.
//
// opts (site catalog builds, Civil):
//   checklists: { 1: { name, sfqp }, ... 6: {...} } - the made checklists; the
//               .2.1 / .2.2 checkpoints bind them (SITE_CHECKLIST_BINDING).
//   dependencies: true - checkpoint b gets `after` = a's name, c gets b's
//               ("Must be completed first"; the a -> b -> c chain).
function buildTree(L, opts = {}) {
  return {
    name: `${L} Sub Package`, code: L, letter: L,
    activities: [1, 2].map((a) => ({
      name: `${L}.${a} Activity`, code: `${L}.${a}`, baseUom: 'Nos',
      subActivities: [1, 2].map((s) => ({
        name: `${L}.${a}.${s} Sub Activity`, code: `${L}.${a}.${s}`, minUnit: 'TABLE', uom: 'PER UNIT',
        checkpoints: ['a', 'b', 'c'].map((c, i, all) => {
          const own = opts.checklists && (SITE_CHECKLIST_BINDING[`${a}.${s}`] || {})[c];
          return {
            key: c,
            name: `${L}.${a}.${s} Checkpoint ${c}`,
            description: `${L}.${a}.${s} checkpoint ${c}`,
            type: 'question', optional: false, checklistRequired: true,
            checklist: own ? checklistRef(opts.checklists[own]) : CHECKLIST[c],
            ...(opts.dependencies && i > 0 ? { after: `${L}.${a}.${s} Checkpoint ${all[i - 1]}` } : {}),
          };
        }),
      })),
    })),
  };
}

// Every node name of one letter in tree order (runbook section 7, step 2).
function expectedNames(L) {
  const t = buildTree(L);
  const out = [t.name];
  for (const a of t.activities) {
    out.push(a.name);
    for (const s of a.subActivities) {
      out.push(s.name);
      for (const c of s.checkpoints) out.push(c.name);
    }
  }
  return out;
}

// CODES (app owner, 2026-10-15). A sub-package code is
//   <P|Q> + <package letter> + <2-digit counter>      e.g. PC01, QC01 / PE01, QE01
// C = Civil, E = Electrical. Each build takes the NEXT counter for its package
// (PC01/QC01, then PC02/QC02 ...), so a name never repeats - not even in a draft
// copied from a version that already holds the earlier codes. Node names are built
// from the code verbatim: "PC01 Sub Package", "PC01.1 Activity", "PC01.1.1 Checkpoint a".
// The runbook's historic single letters (P..U) are still accepted, for verify.
const PACKAGES = { Civil: 'C', Electrical: 'E' };
const PREFIXES = ['P', 'Q'];
const CODE_RE = /^([PQ])([CE])(\d{2})$/;
const LETTER_RE = /^[A-Z]{1,3}$|^[PQ][CE]\d{2}$/;
function assertLetters(letters) {
  const bad = letters.filter((l) => !LETTER_RE.test(l));
  if (bad.length) throw new Error(`Codes must look like PC01 / QE02 (or a historic 1-3 letter code), got: ${bad.join(', ')}`);
}

function packageLetter(pkg) {
  const l = PACKAGES[pkg];
  if (!l) throw new Error(`Unknown package "${pkg}" - expected one of ${Object.keys(PACKAGES).join(', ')}`);
  return l;
}

// The codes of counter `n` for a package: codesFor('Civil', 2) -> ['PC02', 'QC02'].
function codesFor(pkg, n) {
  return PREFIXES.map((p) => `${p}${packageLetter(pkg)}${String(n).padStart(2, '0')}`);
}

// The highest counter among codes of THIS package (PC07 -> 7 for Civil); 0 if none.
function highestCounter(pkg, codes) {
  const l = packageLetter(pkg);
  return codes.reduce((max, c) => {
    const m = String(c).match(CODE_RE);
    return m && m[2] === l ? Math.max(max, Number(m[3])) : max;
  }, 0);
}

// WHICH RUNS A SPEC EXECUTES, from .env / the environment:
//   PC_SITE + PC_LETTERS  -> one custom run, e.g. PC_SITE=Khavda PC_LETTERS=PC03,QC03
//                            or PC_LETTERS=next (build only: the package's next counter,
//                            see pc-counter.js)
//   PC_PACKAGES=Civil,Electrical -> which package trees a run touches (default Electrical)
//   PC_RUNS=2 (or 1,3)     -> those rows of the matrix
//   (neither)              -> the whole matrix
function selectedRuns(env = process.env) {
  const site = String(env.PC_SITE || '').trim();
  const letters = String(env.PC_LETTERS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (site || letters.length) {
    if (!site || letters.length < 1) throw new Error('PC_SITE and PC_LETTERS (e.g. "PC03,QC03" or "next") must be set together');
    const next = letters.length === 1 && letters[0].toLowerCase() === 'next';
    if (!next) assertLetters(letters);
    return [{ id: 'custom', site, letters: next ? ['next'] : letters }];
  }
  const want = String(env.PC_RUNS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return want.length ? RUNS.filter((r) => want.includes(String(r.id))) : RUNS;
}

// PC_MODE=verify (DEFAULT): read-only - open the version, check every node and
//   checklist is there. The DRS write guard is installed and aborts any write.
// PC_MODE=build: create what is missing (idempotent) on a DRAFT, then verify.
function mode(env = process.env) {
  const m = String(env.PC_MODE || 'verify').trim().toLowerCase();
  if (!['verify', 'build'].includes(m)) throw new Error(`PC_MODE must be verify or build, got "${m}"`);
  return m;
}

// Which package trees a run builds/verifies. The historic matrix rows (P..U) all
// live under Electrical, so that stays the default.
function selectedPackages(env = process.env) {
  const list = String(env.PC_PACKAGES || 'Electrical').split(',').map((s) => s.trim()).filter(Boolean);
  list.forEach(packageLetter);
  return list;
}

module.exports = {
  QUESTIONS, MIXED_QUESTIONS, SAFE_QUESTIONS, siteChecklists, SITE_CHECKLIST_BINDING, checklistRef,
  RUNS, CHECKLIST, PACKAGES, buildTree, expectedNames, versionPrefix, selectedRuns, selectedPackages, mode,
  assertLetters, codesFor, highestCounter,
};
