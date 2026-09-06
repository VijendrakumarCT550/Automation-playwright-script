#!/usr/bin/env node
// Runs an ENTIRE smoke chain by deriving the project list from
// playwright.config.js instead of hardcoding it in package.json.
//
// WHY THIS EXISTS. Playwright's CLI has no project wildcard: `--project` takes
// exact names only. The smoke chain is now ~28 projects and every new SM* stage
// adds another, so the old `smoke:full` script was a single line naming all of
// them — which had already gone stale by the time it was next run. On
// 2026-09-04 the feature stages moved from `smoke-feature-*` (pointing at
// tests/specs/) into the solar chain as `smoke-solar-*`, and every script that
// named the old projects would have died with "unknown project".
//
// App owner's requirement is "in one run I can get report of all specs nothing
// should be escaped", so the list of what runs must not be something a human has
// to remember to update. Reading it back off the config makes adding a stage a
// one-line change to SMOKE_FEATURE_STAGES and nothing else.
//
// USAGE
//   node tests/utils/run-smoke.js                  # every smoke-solar-* project
//   node tests/utils/run-smoke.js wind             # every smoke-wind-* project
//   node tests/utils/run-smoke.js solar --headed   # extra args pass through
//   node tests/utils/run-smoke.js --list           # print the projects, run nothing
//
// Everything after the chain name is forwarded to `playwright test` verbatim, so
// --reporter, --grep, --retries and friends all still work.

const { spawn } = require('child_process');
const path = require('path');

const CHAINS = ['solar', 'wind'];

const argv = process.argv.slice(2);
const chain = CHAINS.includes(argv[0]) ? argv[0] : 'solar';
// Also strips a literal '--' token, not just '--list' — CONFIRMED LIVE
// 2026-09-05: package.json's own script strings hardcode one (e.g.
// "...run-smoke.js solar -- --reporter=list,html,json,junit"), meant as the
// conventional "extra args start here" separator for a HUMAN invoking `npm
// run smoke:full:artifacts -- --extra-flag`. But baked directly into the
// script string like this, that '--' is ALWAYS present in argv regardless —
// and forwarding it straight into the final `npx playwright test ...`
// command (this array's own log line showed it landing right before
// `--reporter=...`) makes Playwright's CLI treat everything after it as a
// positional test-file pattern instead of flags. Confirmed live: the
// resulting command still ran the right tests (workers/project flags came
// before the stray '--', so those still parsed fine) and 'list'/'html'
// still worked (they're ALSO playwright.config.js's own default reporter
// array, used whenever the CLI override silently fails to parse) — but
// 'json'/'junit' output never got selected at all, silently leaving
// smoke-reports/results.json and junit.xml stale from whatever run last
// wrote them correctly. Filtering the stray '--' out here fixes it at the
// one place every chain invocation passes through, rather than editing
// every package.json script string that happens to include one.
const passthrough = (CHAINS.includes(argv[0]) ? argv.slice(1) : argv)
  .filter((a) => a !== '--list' && a !== '--');
const listOnly = argv.includes('--list');

// Load the config the same way Playwright will, so the project list can never
// disagree with the one the run actually uses.
const configPath = path.join(__dirname, '..', '..', 'playwright.config.js');
let config;
try {
  config = require(configPath);
} catch (err) {
  console.error(`Could not load ${configPath}:\n${err.stack || err.message}`);
  process.exit(1);
}

const prefix = `smoke-${chain}-`;
const projects = (config.projects || [])
  .map((p) => p.name)
  .filter((n) => typeof n === 'string' && n.startsWith(prefix));

if (!projects.length) {
  console.error(
    `No projects found matching "${prefix}*" in playwright.config.js.\n` +
    `Valid chains: ${CHAINS.join(', ')}.\n` +
    `If you expected feature stages here, remember they are gated on the ` +
    `profile declaring featureGround (see tests/config/projects.js) and on the ` +
    `SM* file actually existing.`
  );
  process.exit(1);
}

console.log(`[run-smoke] chain "${chain}" -> ${projects.length} project(s):`);
for (const p of projects) console.log(`  ${p}`);
if (listOnly) process.exit(0);

// --workers=1 is NOT optional and is not a performance choice. The app is
// one-session-at-a-time, and the flow/feature stages are sibling leaves rather
// than a chain, so it is the worker cap — not the dependency graph — that stops
// two of them overlapping. See the CONSEQUENCE note in smokeChain().
const args = [
  'playwright', 'test',
  '--workers=1',
  ...projects.flatMap((p) => ['--project', p]),
  ...passthrough,
];

console.log(`[run-smoke] npx ${args.join(' ')}\n`);

const child = spawn('npx', args, {
  stdio: 'inherit',
  // npx resolves through a shell on Windows; without this the spawn fails with
  // ENOENT even though `npx` works fine interactively.
  shell: process.platform === 'win32',
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[run-smoke] playwright terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code === null ? 1 : code);
});

child.on('error', (err) => {
  console.error(`[run-smoke] failed to start playwright: ${err.message}`);
  process.exit(1);
});
