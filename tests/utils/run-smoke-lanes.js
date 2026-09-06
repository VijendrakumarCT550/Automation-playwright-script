#!/usr/bin/env node
// Runs a smoke chain as PARALLEL LANES and produces ONE merged report.
//
//   node tests/utils/run-smoke-lanes.js solar
//   node tests/utils/run-smoke-lanes.js solar --lane wam     # just one lane
//   node tests/utils/run-smoke-lanes.js solar --plan         # print, run nothing
//
// The lane layout, the ground each stage touches, and the safety checks all
// live in tests/config/lanes.js — read that first. This file is only the
// mechanics of running it.
//
// ---------------------------------------------------------------------------
// SHAPE OF A RUN
// ---------------------------------------------------------------------------
//   prefix   (serial, one process)    users -> wam
//      |
//   lanes    (N processes, concurrent) flow-desktop | flow-mobile | wam | creation | readonly
//      |
//   epilogue (serial, one process)    reassign -> restore
//
// Every phase writes a BLOB report; at the end they are collected into one flat
// directory and merged into the same html/json/junit artifacts a serial run
// produces today. This is Playwright's own sharded-report mechanism, not
// something invented here.
//
// ---------------------------------------------------------------------------
// THREE MECHANICS THAT ARE NOT OPTIONAL — each verified live 2026-09-06
// ---------------------------------------------------------------------------
// 1. EVERY LANE NEEDS ITS OWN --output DIRECTORY.
//    Playwright CLEARS its outputDir (test-results/) at the start of every run.
//    Five concurrent lanes all pointed at the default would each wipe the
//    others' in-flight screenshots and traces — and the last one to start would
//    win, silently. Attachments still reach the merged report because the blob
//    carries them, but a lane mid-write when another cleared the directory is a
//    real failure with an inexplicable cause.
//
// 2. EVERY LANE NEEDS ITS OWN PLAYWRIGHT_BLOB_OUTPUT_DIR.
//    Confirmed live that this env var does control where the blob lands. Per
//    lane, so two lanes can never race on one filename.
//
// 3. merge-reports DOES NOT RECURSE.
//    Confirmed live: pointing it at a parent directory of per-lane
//    subdirectories gives "No report files found". The zips have to be
//    collected into one flat directory first, which collectBlobs() does.
//
// ---------------------------------------------------------------------------
// --workers=1 IS STILL SET, PER LANE, AND STILL MEANS SOMETHING
// ---------------------------------------------------------------------------
// Order WITHIN a lane is what makes stages like rfi-create -> rfi-bulk safe, and
// with project `dependencies` removed (see playwright.config.js) that order
// comes from --workers=1 plus declaration order. Lanes change what runs
// CONCURRENTLY WITH WHAT; they do not change how a lane runs internally.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const CHAINS = ['solar', 'wind'];

const argv = process.argv.slice(2);
const chain = CHAINS.includes(argv[0]) ? argv[0] : 'solar';
const rest = CHAINS.includes(argv[0]) ? argv.slice(1) : argv;

const planOnly = rest.includes('--plan') || rest.includes('--list');
const laneIdx = rest.indexOf('--lane');
const onlyLane = laneIdx !== -1 ? rest[laneIdx + 1] : null;

// Same stray-token filtering run-smoke.js does, and for the same reason: a `--`
// baked into a package.json script string is always present in argv and would
// be forwarded into the playwright CLI, where it ends option parsing and
// silently discards every flag after it (found live 2026-09-05 — it was why
// json/junit output never wrote).
const passthrough = rest.filter((a, i) =>
  a !== '--plan' && a !== '--list' && a !== '--' && a !== '--lane' && i !== laneIdx + 1
);

const BLOB_ROOT = path.join(ROOT, 'smoke-reports', 'blobs');
const FLAT_DIR = path.join(ROOT, 'smoke-reports', 'blobs-flat');
const OUT_ROOT = path.join(ROOT, 'test-results');

let config;
try {
  config = require(path.join(ROOT, 'playwright.config.js'));
} catch (err) {
  console.error(`Could not load playwright.config.js:\n${err.stack || err.message}`);
  process.exit(1);
}

const { getProfile } = require(path.join(ROOT, 'tests', 'config', 'projects.js'));
const { buildPlan, laneGround } = require(path.join(ROOT, 'tests', 'config', 'lanes.js'));

const prefix = `smoke-${chain}-`;
const projectNames = (config.projects || [])
  .map((p) => p.name)
  .filter((n) => typeof n === 'string' && n.startsWith(prefix));

if (!projectNames.length) {
  console.error(`No projects matching "${prefix}*" in playwright.config.js. Valid chains: ${CHAINS.join(', ')}.`);
  process.exit(1);
}

const stageIds = new Set(projectNames.map((n) => n.slice(prefix.length)));
const profileKey = chain === 'wind' ? 'wind-e2e' : 'solar-e2e';
const profile = getProfile(profileKey);

let plan;
try {
  plan = buildPlan(profile, stageIds);
} catch (err) {
  // The layout being unsafe is a REFUSAL, not a warning. A lane run with
  // overlapping ground produces failures that look like app bugs, which costs
  // far more than not starting.
  console.error(`\n${err.message}\n`);
  process.exit(1);
}

const toProjects = (ids) => ids.map((id) => `${prefix}${id}`);

// ---------------------------------------------------------------------------
function describePlan() {
  const lanes = Object.keys(plan.lanes);
  console.log(`\n[lanes] chain "${chain}" (profile ${profileKey}) — ${stageIds.size} stages\n`);
  console.log(`  prefix   (serial)  : ${plan.prefix.join(' -> ') || '(none)'}`);
  for (const name of lanes) {
    const ground = [...laneGround(profile, plan.lanes[name])].sort();
    console.log(
      `  lane ${name.padEnd(13)}: ${plan.lanes[name].join(', ')}\n` +
      `  ${' '.repeat(18)}ground: ${ground.length ? ground.join(', ') : '(none)'}`
    );
  }
  console.log(`  epilogue (serial)  : ${plan.epilogue.join(' -> ') || '(none)'}`);
  if (plan.droppedLanes.length) {
    console.log(`  (lanes with no stages on this chain, skipped: ${plan.droppedLanes.join(', ')})`);
  }
  console.log('');
}

// ARGUMENTS MUST BE QUOTED, and this is not theoretical — it broke the very
// first laned run (2026-09-06).
//
// spawn() needs `shell: true` on Windows for `npx` to resolve at all (without
// it the spawn fails with ENOENT — same reason run-smoke.js sets it). But with
// a shell, Node CONCATENATES the argv array instead of passing it through, so
// nothing is escaped — Node even warns about it (DEP0190). This repo lives at
// "C:\Users\Vijendra Kumar\Downloads\Automation playwright script", so an
// absolute --output path split at the first space and Playwright died with
//
//     EPERM: operation not permitted, mkdir 'C:\Users\Vijendra'
//
// Two defences, because either alone is a single point of failure:
//   1. paths passed as argv are REPO-RELATIVE (cwd is ROOT), so in the normal
//      case there is no space to split on at all;
//   2. anything that still contains a space is quoted here.
// The env vars are unaffected — spawn passes `env` as an object, so the shell
// never re-parses them, which is why PLAYWRIGHT_BLOB_OUTPUT_DIR was fine.
const quoteArg = (a) => (/[\s]/.test(a) && !/^".*"$/.test(a) ? `"${a}"` : a);

// One `playwright test` invocation. `label` names the phase/lane and decides
// both its blob directory and its output directory.
function runPhase(label, ids) {
  const projects = toProjects(ids);
  const blobDir = path.join(BLOB_ROOT, label);
  // Relative to ROOT, which is the spawn cwd — see quoteArg above.
  const outDir = path.join(path.relative(ROOT, OUT_ROOT), `lane-${label}`);

  const args = [
    'playwright', 'test',
    '--workers=1',
    '--output', outDir,
    ...projects.flatMap((p) => ['--project', p]),
    '--reporter=blob',
    ...passthrough,
  ].map(quoteArg);

  console.log(`[lanes] start ${label}: ${projects.length} project(s)`);

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('npx', args, {
      cwd: ROOT,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
      env: { ...process.env, PLAYWRIGHT_BLOB_OUTPUT_DIR: blobDir },
    });

    // Lane output is PREFIXED rather than inherited. Five concurrent processes
    // writing to one terminal interleave into something unreadable, and the
    // whole point of a laned run is still being able to see what happened.
    const pipe = (stream, isErr) => {
      let buf = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        buf += chunk;
        const lines = buf.split(/\r?\n/);
        buf = lines.pop();
        for (const line of lines) {
          if (line.trim()) (isErr ? process.stderr : process.stdout).write(`[${label}] ${line}\n`);
        }
      });
    };
    pipe(child.stdout, false);
    pipe(child.stderr, true);

    child.on('exit', (code, signal) => {
      const mins = ((Date.now() - started) / 60000).toFixed(1);
      const status = signal ? `signal ${signal}` : `exit ${code}`;
      console.log(`[lanes] done  ${label}: ${status} after ${mins} min`);
      resolve({ label, code: signal ? 1 : (code === null ? 1 : code), mins });
    });
    child.on('error', (err) => {
      console.error(`[lanes] ${label} failed to start: ${err.message}`);
      resolve({ label, code: 1, mins: '0.0' });
    });
  });
}

// merge-reports does not recurse (verified live), so every blob has to be in
// one flat directory. Names are already unique per phase — Playwright hashes
// them from the project set — but the phase label is prepended anyway so a
// stray collision cannot silently drop a lane's entire result.
function collectBlobs() {
  fs.rmSync(FLAT_DIR, { recursive: true, force: true });
  fs.mkdirSync(FLAT_DIR, { recursive: true });

  let count = 0;
  if (!fs.existsSync(BLOB_ROOT)) return count;
  for (const label of fs.readdirSync(BLOB_ROOT)) {
    const dir = path.join(BLOB_ROOT, label);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.zip')) continue;
      fs.copyFileSync(path.join(dir, file), path.join(FLAT_DIR, `${label}-${file}`));
      count++;
    }
  }
  return count;
}

function mergeReports() {
  return new Promise((resolve) => {
    // Repo-relative + quoted, same reason as runPhase — see quoteArg.
    const args = [
      'playwright', 'merge-reports',
      '--reporter=list,html,json,junit',
      path.relative(ROOT, FLAT_DIR),
    ].map(quoteArg);
    console.log(`\n[lanes] merging into one report: npx ${args.join(' ')}\n`);
    const child = spawn('npx', args, {
      cwd: ROOT,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      env: {
        ...process.env,
        // Same paths the serial :artifacts scripts write, so nothing downstream
        // has to know whether a run was laned. Deliberately NOT under
        // test-results/, which Playwright clears at the start of every run.
        PLAYWRIGHT_JSON_OUTPUT_NAME: path.join('smoke-reports', 'results.json'),
        PLAYWRIGHT_JUNIT_OUTPUT_NAME: path.join('smoke-reports', 'junit.xml'),
        PLAYWRIGHT_HTML_OPEN: 'never',
      },
    });
    child.on('exit', (code) => resolve(code === null ? 1 : code));
    child.on('error', () => resolve(1));
  });
}

// ---------------------------------------------------------------------------
(async () => {
  describePlan();
  if (planOnly) process.exit(0);

  if (onlyLane) {
    if (!plan.lanes[onlyLane]) {
      console.error(
        `Unknown lane "${onlyLane}" for chain "${chain}". Available: ${Object.keys(plan.lanes).join(', ')}`
      );
      process.exit(1);
    }
    const r = await runPhase(onlyLane, plan.lanes[onlyLane]);
    process.exit(r.code);
  }

  fs.rmSync(BLOB_ROOT, { recursive: true, force: true });
  const results = [];
  const overall = Date.now();

  // --- phase 1: prefix, serial -------------------------------------------
  // Everything downstream needs these users to exist and to be mapped, so a
  // failure here stops the run rather than launching lanes onto ground that was
  // never provisioned.
  if (plan.prefix.length) {
    const r = await runPhase('00-prefix', plan.prefix);
    results.push(r);
    if (r.code !== 0) {
      console.error('\n[lanes] the setup prefix FAILED — not starting the lanes, since every one of them depends on it.\n');
      const n = collectBlobs();
      if (n) await mergeReports();
      process.exit(r.code);
    }
  }

  // --- phase 2: lanes, concurrent ----------------------------------------
  const laneNames = Object.keys(plan.lanes);
  console.log(`\n[lanes] running ${laneNames.length} lanes concurrently: ${laneNames.join(', ')}\n`);
  const laneResults = await Promise.all(laneNames.map((n) => runPhase(n, plan.lanes[n])));
  results.push(...laneResults);

  // --- phase 3: epilogue, serial -----------------------------------------
  // Runs even if a lane failed. `reassign` and `restore` both need every lane
  // finished, and `restore` in particular re-asserts the baseline mapping — the
  // run where a lane died mid-mutation is exactly the run that needs it most.
  if (plan.epilogue.length) {
    results.push(await runPhase('99-epilogue', plan.epilogue));
  }

  // --- consolidate --------------------------------------------------------
  const blobCount = collectBlobs();
  console.log(`\n[lanes] collected ${blobCount} blob report(s) into ${path.relative(ROOT, FLAT_DIR)}`);
  const mergeCode = blobCount ? await mergeReports() : 1;
  if (!blobCount) console.error('[lanes] no blob reports were produced — nothing to merge.');

  const totalMins = ((Date.now() - overall) / 60000).toFixed(1);
  console.log(`\n[lanes] ---- phase summary (wall clock ${totalMins} min) ----`);
  for (const r of results) {
    console.log(`  ${r.code === 0 ? 'pass' : 'FAIL'}  ${r.label.padEnd(14)} ${r.mins} min`);
  }
  console.log(
    `\n[lanes] merged report: playwright-report/index.html  ` +
    `(npm run report)\n[lanes] machine-readable: smoke-reports/results.json, smoke-reports/junit.xml\n`
  );

  const failed = results.filter((r) => r.code !== 0);
  process.exit(failed.length || mergeCode !== 0 ? 1 : 0);
})();
