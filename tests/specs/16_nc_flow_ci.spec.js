const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { runCITurn } = require('../utils/nc-flow-turns');

test.describe.configure({ mode: 'serial' });

// Actual respond/resubmit/backfill logic lives in tests/utils/nc-flow-turns.js
// (runCITurn), shared with 22_nc_flow_single_session.spec.js — this file is
// now just: log in once, run one CI turn (every TC currently pending for
// CI), done.
test('CI: submit response / resubmit for every NC whose next step is mine', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  await loginAsRole(page, 'CI');
  await runCITurn(page);
});
