// Prints the smoke chain's per-TC state as a readable table.
//
// The Playwright HTML report says which STAGES passed; this says which TEST CASES
// did, and against which records. That is the more useful thing when showing
// where the automation stands, because a stage is one Playwright test containing
// nine or four TCs.
//
// Usage:  npm run smoke:status
//         node tests/utils/print-smoke-trackers.js
//         node tests/utils/print-smoke-trackers.js --json     (machine-readable)
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'fixtures', 'smoke');
const asJson = process.argv.includes('--json');

if (!fs.existsSync(DIR)) {
  console.log('No smoke tracker state yet — fixtures/smoke/ does not exist.');
  console.log('It is created on the first flow-stage run (seedIfMissing).');
  process.exit(0);
}

const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).sort();
if (!files.length) {
  console.log('fixtures/smoke/ is empty — no flow stage has run yet.');
  process.exit(0);
}

const report = [];
for (const file of files) {
  // rfi-tracker.solar-e2e.desktop.full.json -> flow / profile / viewport / set
  const m = file.match(/^(rfi|nc)-tracker\.(.+?)\.(desktop|mobile)\.(quick|full)\.json$/);
  const meta = m
    ? { flow: m[1].toUpperCase(), profile: m[2], viewport: m[3], set: m[4] }
    : { flow: '?', profile: file, viewport: '?', set: '?' };

  let tcs;
  try {
    tcs = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  } catch (err) {
    report.push({ ...meta, file, error: String(err.message || err) });
    continue;
  }

  const rows = Object.entries(tcs).map(([id, tc]) => ({
    id,
    status: tc.status,
    step: `${tc.currentStepIndex}/${tc.steps.length}`,
    code: tc.rfiCode || tc.ncCode || null,
    workArea: tc.workArea || null,
    workSection: tc.workSection || null,
    checkpoint: tc.checkpointCode || null,
    failureStage: tc.failureStage || null,
    failureScenario: tc.failureScenario || null,
  }));

  report.push({
    ...meta,
    file,
    total: rows.length,
    done: rows.filter((r) => r.status === 'done').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    other: rows.filter((r) => r.status !== 'done' && r.status !== 'failed').length,
    tcs: rows,
  });
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

const bar = '='.repeat(78);
console.log('\n' + bar);
console.log('SMOKE CHAIN STATUS  (per test case, from fixtures/smoke/)');
console.log(bar);

for (const r of report) {
  if (r.error) {
    console.log(`\n${r.file}\n  UNREADABLE: ${r.error}`);
    continue;
  }
  const verdict = r.failed ? 'FAILED' : r.other ? 'INCOMPLETE' : 'PASSED';
  console.log(
    `\n${r.flow} ${r.profile} / ${r.viewport} / ${r.set}` +
    `   ${r.done}/${r.total} done` +
    (r.failed ? `, ${r.failed} failed` : '') +
    (r.other ? `, ${r.other} incomplete` : '') +
    `   [${verdict}]`
  );
  for (const tc of r.tcs) {
    const flag = tc.status === 'done' ? 'ok  ' : tc.status === 'failed' ? 'FAIL' : '... ';
    let line = `   ${flag} ${tc.id}  ${String(tc.step).padEnd(5)} ${tc.code || '(no code)'}`;
    if (tc.workArea) line += `  @ ${tc.workArea}`;
    if (tc.workSection && tc.workSection !== tc.workArea) line += ` / ${tc.workSection}`;
    if (tc.checkpoint) line += `  [${tc.checkpoint}]`;
    if (tc.failureStage) line += `  <${tc.failureStage}${tc.failureScenario ? ' ' + tc.failureScenario : ''}>`;
    console.log(line);
  }
}

const totals = report.filter((r) => !r.error).reduce(
  (a, r) => ({ total: a.total + r.total, done: a.done + r.done, failed: a.failed + r.failed, other: a.other + r.other }),
  { total: 0, done: 0, failed: 0, other: 0 }
);
console.log('\n' + bar);
console.log(
  `TOTAL: ${totals.total} test case(s)  |  done ${totals.done}  |  ` +
  `failed ${totals.failed}  |  incomplete ${totals.other}`
);
console.log(bar + '\n');

// Non-zero only when something actually failed, so this is safe to chain after a
// run without masking the run's own exit code semantics.
process.exit(totals.failed > 0 ? 1 : 0);
