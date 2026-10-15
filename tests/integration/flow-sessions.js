const { loginFreshUserSession } = require('../utils/helpers');

// One live session per role, logged in IN PARALLEL — the SM05/SM06 session
// model (one PWA load per role for the whole matrix instead of one per turn).
// allSettled, not all(): if one login fails, the ones that succeeded are still
// closed rather than leaked. Neutral plumbing — shared by the RFI and NC
// matrices without mixing their flow code.
async function loginFlowSessions(browser, users, roles, password, contextOptions = {}) {
  const results = await Promise.allSettled(
    roles.map((role) => loginFreshUserSession(browser, users[role].email, password, contextOptions))
  );
  const failures = results.map((r, i) => ({ role: roles[i], r })).filter(({ r }) => r.status === 'rejected');
  if (failures.length) {
    await Promise.all(results.filter((r) => r.status === 'fulfilled').map((r) => r.value.context.close().catch(() => {})));
    throw new Error('Login failed for: ' + failures
      .map((f) => `${f.role} (${String(f.r.reason && f.r.reason.message).split('\n')[0]})`).join('; '));
  }
  const sessions = {};
  roles.forEach((role, i) => { sessions[role] = results[i].value; });
  return {
    sessions,
    close: () => Promise.all(roles.map((role) => sessions[role].context.close().catch(() => {}))),
  };
}

module.exports = { loginFlowSessions };
