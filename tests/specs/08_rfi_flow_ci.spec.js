const { test } = require("@playwright/test");
const { loginAsRole } = require("../utils/helpers");
const { runCITurn } = require("../utils/rfi-flow-turns");

test.describe.configure({ mode: "serial" });

// Actual create/resubmit/backfill logic lives in tests/utils/rfi-flow-turns.js
// (runCITurn), shared with 21_rfi_flow_single_session.spec.js — this file is
// now just: log in once, run one CI turn (every TC currently pending for CI,
// create or resubmit), done. Keeping both run paths on the exact same
// runCITurn means they can never silently drift apart.
test("CI: create pending TCs and resubmit rejected RFIs", async ({ page }) => {
  // Up to 9 RFI creations/resubmissions in one session — each is a multi-step
  // form fill + checklist submit (~2-3 min), well over the default 10min.
  test.setTimeout(60 * 60 * 1000);
  await loginAsRole(page, "CI");
  await runCITurn(page);
});
