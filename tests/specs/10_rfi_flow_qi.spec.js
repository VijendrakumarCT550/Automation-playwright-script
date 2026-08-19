const { test } = require("@playwright/test");
const { loginAsRole } = require("../utils/helpers");
const { runQITurn } = require("../utils/rfi-flow-turns");

test.describe.configure({ mode: "serial" });

// Actual approve/reject logic lives in tests/utils/rfi-flow-turns.js
// (runQITurn), shared with 21_rfi_flow_single_session.spec.js — this file is
// now just: log in once, run one QI turn (every TC currently pending for
// QI), done.
test("QI: approve/reject every RFI whose next step is mine", async ({ page }) => {
  test.setTimeout(45 * 60 * 1000);
  await loginAsRole(page, "QI");
  await runQITurn(page);
});
