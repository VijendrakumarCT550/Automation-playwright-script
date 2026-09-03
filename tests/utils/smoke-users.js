const { loadLastCreatedUsers } = require('./user-counter-utils');

// RESOLVING THE SMOKE CHAIN'S OWN USERS, with the two checks that matter.
//
// fixtures/last-created-users.json is keyed by role PREFIX only (CISL, CIWTG,
// ...). Two things therefore have to be verified before a recorded entry can be
// trusted, and BOTH have produced real confusion:
//
//   1. profileKey — a prefix could be reused by another profile later, and
//      silently inheriting its user would scope the whole chain to the wrong
//      project type. This check already existed.
//
//   2. baseUrl — THE FILE HAS NO ENVIRONMENT DIMENSION. Users created against
//      one deployment stay recorded when the suite is pointed at another, where
//      they do not exist. Found live on 2026-09-03: SM01 was pointed at pulse-qa,
//      found four recorded solar users from an earlier pulse-dev/pulse-test run,
//      decided they already existed, SKIPPED all four tests and exited 0 — a
//      completely clean-looking run that had created nothing and left the chain
//      pointing at users the target deployment had never heard of.
//
// Entries recorded before baseUrl was added carry `undefined`, which fails the
// check and forces one re-creation. That is the safe direction: re-creating a
// user costs a few minutes, whereas trusting a phantom one fails much later at a
// dropdown search with nothing readable to explain why.
function usersMatchEnvironment(entry, baseUrl = process.env.BASE_URL) {
  return !!entry && entry.baseUrl === baseUrl;
}

// Returns { CI: entry, EE: entry, ... } or throws with a message that says
// exactly which check failed and what to do about it. Used by every stage that
// logs in as a created user, so they cannot drift in how strict they are.
function resolveSmokeUsers(profile, roleKeys, { baseUrl = process.env.BASE_URL } = {}) {
  const recorded = loadLastCreatedUsers();
  const users = {};
  const problems = [];

  for (const roleKey of roleKeys) {
    const prefix = profile.users.prefixes[roleKey];
    if (!prefix) {
      problems.push(`${roleKey}: profile "${profile.key}" defines no prefix for this role`);
      continue;
    }
    const entry = recorded[prefix];
    if (!entry) {
      problems.push(`${roleKey} (prefix "${prefix}"): no user recorded at all`);
      continue;
    }
    if (entry.profileKey !== profile.key) {
      problems.push(
        `${roleKey} (prefix "${prefix}"): recorded for profile "${entry.profileKey}", not "${profile.key}"`
      );
      continue;
    }
    if (!usersMatchEnvironment(entry, baseUrl)) {
      problems.push(
        `${roleKey} (prefix "${prefix}"): user "${entry.name}" was recorded against ` +
        `${entry.baseUrl || '(no environment recorded — created before this was tracked)'}, ` +
        `but this run targets ${baseUrl}`
      );
      continue;
    }
    users[roleKey] = entry;
  }

  if (problems.length) {
    throw new Error(
      `Cannot resolve the smoke users for profile "${profile.key}" on ${baseUrl}:\n` +
      problems.map((p) => `  - ${p}`).join('\n') +
      `\n\nRun stage 1 against THIS deployment first:\n` +
      `  SMOKE_RECREATE_USERS=1 npx playwright test --project=smoke-${profile.key.replace('-e2e', '')}-users --workers=1\n` +
      `(SMOKE_RECREATE_USERS=1 is what forces a new batch instead of reusing a recorded one.)`
    );
  }

  return users;
}

module.exports = { resolveSmokeUsers, usersMatchEnvironment };
