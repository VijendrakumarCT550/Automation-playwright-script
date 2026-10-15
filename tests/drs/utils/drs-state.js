const fs = require('fs');
const path = require('path');

// THE DRS SETUP STATE (docs/drs-pulse-integration.md §7), one record per DRS
// environment — the same partitioning last-created-users.json uses, for the
// same reason: a vendor or project made on drs-uat means nothing on drs-dev.
//
// Everything DRS creates here is PERMANENT (no delete for vendors, projects,
// SOs), so a stage records its record THE MOMENT THE SERVER ACCEPTS IT. A
// create that is never recorded is an orphan nothing can find again.
//
// Writes go through a temp file + rename, so a crash mid-write can never leave
// a half-written store behind.

const STATE_PATH = path.resolve(__dirname, '../../fixtures/drs/drs-setup.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8'));
  } catch {
    return { version: 1, environments: {} };
  }
}

function save(store) {
  fs.mkdirSync(path.dirname(STATE_PATH), { recursive: true });
  const tmp = `${STATE_PATH}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`);
  fs.renameSync(tmp, STATE_PATH);
}

function envRecord(envKey) {
  const store = load();
  return store.environments[envKey] || { projects: [] };
}

// Shallow-merges `patch` into the env's record (vendor, spv, site, ...).
function updateEnv(envKey, patch) {
  const store = load();
  const current = store.environments[envKey] || { projects: [] };
  store.environments[envKey] = { ...current, ...patch, updatedAt: new Date().toISOString() };
  save(store);
  return store.environments[envKey];
}

// The newest project that has not finished every stage — what a rerun resumes.
// A project marked `abandoned` (e.g. stopped mid-chain because its design
// changed) is never resumed.
function incompleteProject(envKey, finalStage) {
  const { projects = [] } = envRecord(envKey);
  return [...projects].reverse()
    .find((p) => !p.abandoned && !(p.stagesDone || []).includes(finalStage)) || null;
}

function latestProject(envKey) {
  const { projects = [] } = envRecord(envKey);
  return projects[projects.length - 1] || null;
}

// Adds a new project record, or merges into the one with the same tag.
function upsertProject(envKey, tag, patch) {
  const store = load();
  const env = store.environments[envKey] || { projects: [] };
  env.projects = env.projects || [];
  const i = env.projects.findIndex((p) => p.tag === tag);
  if (i === -1) env.projects.push({ tag, createdAt: new Date().toISOString(), stagesDone: [], ...patch });
  else env.projects[i] = { ...env.projects[i], ...patch };
  store.environments[envKey] = env;
  save(store);
  return env.projects[i === -1 ? env.projects.length - 1 : i];
}

function markStageDone(envKey, tag, stage) {
  const p = envRecord(envKey).projects.find((x) => x.tag === tag);
  const done = new Set((p && p.stagesDone) || []);
  done.add(stage);
  return upsertProject(envKey, tag, { stagesDone: [...done] });
}

module.exports = {
  STATE_PATH, load, envRecord, updateEnv, incompleteProject, latestProject,
  upsertProject, markStageDone,
};
