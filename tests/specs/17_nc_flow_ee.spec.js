const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { runEETurn } = require('../utils/nc-flow-turns');

test.describe.configure({ mode: 'serial' });

// Actual approve/reject logic lives in tests/utils/nc-flow-turns.js
// (runEETurn), shared with 22_nc_flow_single_session.spec.js — this file is
// now just: log in once, run one EE turn (every TC currently pending for
// EE), done.
test('EE: approve/reject every NC whose next step is mine', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  await loginAsRole(page, 'EE');
  await runEETurn(page);
});
