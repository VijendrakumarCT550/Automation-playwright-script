const { test } = require('@playwright/test');
const { loginAsRole } = require('../utils/helpers');
const { runQITurn } = require('../utils/nc-flow-turns');

test.describe.configure({ mode: 'serial' });

// Actual create/review logic lives in tests/utils/nc-flow-turns.js
// (runQITurn), shared with 22_nc_flow_single_session.spec.js — this file is
// now just: log in once, run one QI turn (every TC currently pending for
// QI, create or approve/reject), done.
test('QI: create pending TCs and review every NC whose next step is mine', async ({ page }) => {
  test.setTimeout(30 * 60 * 1000);
  await loginAsRole(page, 'QI');
  await runQITurn(page);
});
