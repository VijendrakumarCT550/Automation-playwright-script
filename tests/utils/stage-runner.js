// THE STAGE RUNNER shared by the onboarding suite (run-onboarding.js) and the
// onboarding smoke suite (run-onboarding-smoke.js), so the two can never drift:
// stages as separate Playwright invocations, the per-version smoke chains in
// parallel lanes, and ONE merged report per invocation (2026-10-21).
//
// A stage is { id, project, files, workers, needsProject?, versionChains?, env? }.

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LANES = Math.max(1, Number(process.env.ONBOARDING_LANES || 3));
const fmt = (ms) => (ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${Math.round(ms / 1000)} s`);

// PULSE_ENV defaults to the Pulse the DRS environment syncs to (pairedPulse), so the
// Pulse stages never land on an unpaired Pulse.
function defaultPulseEnv() {
  if (process.env.PULSE_ENV) return;
  const { DRS_ENVIRONMENTS } = require('../config/drs-environments');
  const drs = DRS_ENVIRONMENTS[String(process.env.DRS_ENV || 'uat').toLowerCase()];
  if (drs && drs.pairedPulse && drs.pairedPulse.length) process.env.PULSE_ENV = drs.pairedPulse[0];
}

// --from <stage>, --only <a,b>, --list. Returns the stages to run, or exits.
function selectStages(stages, argv, scriptName) {
  const arg = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; };
  const from = arg('--from');
  const only = arg('--only') ? arg('--only').split(',').map((s) => s.trim()) : null;
  const start = from ? stages.findIndex((s) => s.id === from) : 0;
  if (start < 0) { console.error(`unknown stage "${from}" - one of ${stages.map((s) => s.id).join(', ')}`); process.exit(2); }
  const picked = stages.filter((s, i) => i >= start && (!only || only.includes(s.id)));
  if (argv.includes('--list')) {
    stages.forEach((s) => console.log(`${picked.includes(s) ? '        ' : '  (skip)'} ${s.id}  ${s.project}  workers ${Math.min(s.workers, LANES)}  ${s.files.join(' ')}`));
    process.exit(0);
  }
  return { picked, from, only, resumeHint: (id) => `node tests/utils/${scriptName} --from ${id}` };
}

// THE REPORT - the same places as the smoke / integration runs: every stage writes
// a blob, and at the end (also when a stage fails) they are merged into ONE report:
//   playwright-report/index.html   (npx playwright show-report)
//   <reports>/results.json, junit.xml, summary.md
// plus a copy of all four in <reports>/<start time>/ as history.
function createReport(reportsDirName) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const latest = path.join(ROOT, reportsDirName);
  const html = path.join(ROOT, 'playwright-report');
  const dir = path.join(latest, stamp);
  const blobs = path.join(dir, 'blobs');
  fs.mkdirSync(blobs, { recursive: true });
  const results = [];
  function write(title, metaLines) {
    if (fs.readdirSync(blobs).length) {
      spawnSync('npx', ['playwright', 'merge-reports', '--reporter=html,json,junit', `"${blobs}"`], {
        cwd: ROOT, stdio: 'inherit', shell: true,
        env: {
          ...process.env, PLAYWRIGHT_HTML_OUTPUT_DIR: html, PLAYWRIGHT_HTML_OPEN: 'never',
          PLAYWRIGHT_JSON_OUTPUT_NAME: path.join(latest, 'results.json'), PLAYWRIGHT_JUNIT_OUTPUT_NAME: path.join(latest, 'junit.xml'),
        },
      });
    }
    let stats = null;
    try { stats = JSON.parse(fs.readFileSync(path.join(latest, 'results.json'), 'utf8')).stats; } catch { /* no tests ran */ }
    const lines = [
      `# ${title}`, '',
      ...metaLines,
      `- **DRS / Pulse:** drs-${String(process.env.DRS_ENV || 'uat').toLowerCase()} / pulse-${process.env.PULSE_ENV || '?'}`,
      `- **Started:** ${stamp} (UTC), **lanes:** ${LANES}`,
      ...(stats ? [`- **Tests:** ${stats.expected} passed, ${stats.unexpected} failed, ${stats.flaky} flaky, ${stats.skipped} skipped`] : []),
      `- **Report:** playwright-report/index.html (\`npx playwright show-report\`), ${reportsDirName}/results.json, ${reportsDirName}/junit.xml`, '',
      '| Stage | Result | Workers | Time |', '|---|---|---|---|',
      ...results.map((r) => `| ${r.id} | ${r.ok ? 'passed' : `**FAILED** (exit ${r.status})`} | ${r.workers} | ${fmt(r.ms)} |`),
      `| **Total** | | | **${fmt(results.reduce((a, r) => a + r.ms, 0))}** |`,
    ];
    fs.writeFileSync(path.join(latest, 'summary.md'), `${lines.join('\n')}\n`);
    for (const f of ['summary.md', 'results.json', 'junit.xml']) {
      if (fs.existsSync(path.join(latest, f))) fs.copyFileSync(path.join(latest, f), path.join(dir, f));
    }
    if (fs.existsSync(html)) fs.cpSync(html, path.join(dir, 'html'), { recursive: true });
    console.log(`\n${lines.join('\n')}\n\n=== report: playwright-report/index.html  (npx playwright show-report)\n=== results: ${reportsDirName}/results.json, junit.xml, summary.md`);
  }
  return { blobs, results, write };
}

// One `playwright test` invocation, as a promise of its exit code.
function runInvocation(label, project, files, workers, env) {
  const cmd = ['playwright', 'test', `--project=${project}`, ...files, `--workers=${workers}`, '--reporter=list,blob'];
  console.log(`\n=== ${label}: npx ${cmd.join(' ')}${env.DRS_PROJECT_TAG ? `  (DRS_PROJECT_TAG=${env.DRS_PROJECT_TAG})` : ''}`);
  return new Promise((resolve) => {
    const child = spawn('npx', cmd, { cwd: ROOT, stdio: 'inherit', shell: true, env: { ...process.env, ...env } });
    child.on('exit', (code) => resolve(code === null ? 1 : code));
  });
}

// The smoke RFI / NC stages on every other catalog version: one `smoke-drsv<nn>-*`
// chain per version (playwright.config.js builds them for DRS_PROJECT_TAG), each its
// own invocation with ONE worker, up to LANES chains at once (own users and ground
// per version); then the `sequential` chains (draft autosave) one at a time.
async function runVersionChains(stage, n, tag, blobs, extraEnv = {}) {
  process.env.DRS_PROJECT_TAG = tag;
  delete require.cache[require.resolve('../integration/drs-smoke-profile')];
  const chains = require('../integration/drs-smoke-profile').currentVersionSmokeChains();
  if (!chains.length) { console.log(`\n=== ${stage.id}: no per-version smoke areas on ${tag} - nothing to run`); return 0; }
  console.log(`\n=== ${stage.id}: ${chains.length} version chain(s), ${Math.min(LANES, chains.length)} at a time: ${chains.map((c) => `${c.chain} (${c.version})`).join(', ')}`);
  const codes = [];
  const runQueue = async (list, lanes) => {
    const queue = [...list];
    const lane = async () => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        // The PM is shared by every version chain (one Work Location row), so the
        // version chains' NC flows leave it out (drs-smoke-profile.js).
        const env = { ...extraEnv, DRS_PROJECT_TAG: tag, SMOKE_NC_CREATORS: 'QI,EE,EL,QL',
          PLAYWRIGHT_BLOB_OUTPUT_FILE: path.join(blobs, `${String(n).padStart(2, '0')}-${stage.id}-${c.chain}.zip`),
          PLAYWRIGHT_OUTPUT_DIR: path.join(ROOT, 'test-results', c.chain) };
        const code = await runInvocation(`${stage.id} ${c.chain} (${c.version})`, `smoke-${c.chain}-*`, [], 1, env);
        console.log(`\n=== ${stage.id} ${c.chain} (${c.version}): ${code === 0 ? 'passed' : `FAILED (exit ${code})`}`);
        codes.push(code);
      }
    };
    await Promise.all(Array.from({ length: Math.min(lanes, list.length) }, lane));
  };
  await runQueue(chains.filter((c) => !c.sequential), LANES);
  await runQueue(chains.filter((c) => c.sequential), 1);
  return codes.find((c) => c !== 0) || 0;
}

// Runs the picked stages in order, stopping at the first failure. `projectTag()`
// gives the project a needsProject stage runs on; `stageEnv(stage)` any extra env.
async function runStages({ picked, report, projectTag, stageEnv = () => ({}), resumeHint, onFail }) {
  for (const [i, stage] of picked.entries()) {
    const env = { PLAYWRIGHT_BLOB_OUTPUT_FILE: path.join(report.blobs, `${String(i + 1).padStart(2, '0')}-${stage.id}.zip`), ...(stage.env || {}), ...stageEnv(stage) };
    if (stage.needsProject) {
      const tag = projectTag();
      if (!tag) { console.error(`${stage.id}: no project to run on`); onFail(`stopped before ${stage.id}`); process.exit(1); }
      env.DRS_PROJECT_TAG = tag;
    }
    const workers = Math.min(stage.workers, LANES);
    const t0 = Date.now();
    const status = stage.versionChains
      ? await runVersionChains(stage, i + 1, env.DRS_PROJECT_TAG, report.blobs, { ...(stage.env || {}), ...stageEnv(stage) })
      : await runInvocation(stage.id, stage.project, stage.files, workers, env);
    report.results.push({ id: stage.id, ok: status === 0, status, workers: stage.versionChains ? `${LANES} chains` : workers, ms: Date.now() - t0 });
    if (status !== 0) {
      console.error(`\n=== ${stage.id} FAILED (exit ${status}). Fix and resume with: ${resumeHint(stage.id)}`);
      onFail(`FAILED at ${stage.id}`);
      process.exit(status || 1);
    }
  }
}

module.exports = { ROOT, LANES, defaultPulseEnv, selectStages, createReport, runInvocation, runVersionChains, runStages };
