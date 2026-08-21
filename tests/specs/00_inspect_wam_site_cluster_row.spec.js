const { test } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const { loadLastCreatedUsers } = require('../utils/user-counter-utils');
const WAMPage = require('../pages/WAMPage');

// THROWAWAY inspector — Site Admin's and Cluster Admin's WAM row
// comboboxes timed out (30s) waiting for [role="combobox"] inside their
// row, and the user watching live confirmed the dropdown never even
// opened. User's hypothesis: these rows allow MULTIPLE simultaneous
// assignees (unlike single-select Work Area rows) and may have
// accumulated many names across past test runs — this inspector dumps
// the row's actual current state (screenshot + full untruncated HTML,
// not a truncated slice like a past investigation mistakenly used)
// BEFORE ever attempting to click anything, so we have real evidence
// instead of guessing. Delete once captured in code comments, matching
// this repo's 00_inspect_*.spec.js convention.
test('INSPECT: Site Admin and Cluster Admin WAM row state before clicking', async ({ browser }) => {
  test.setTimeout(15 * 60 * 1000);
  const t0 = Date.now();
  const log = (msg) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)}s] ${msg}`);

  const { context, page, dashboard } = await adminFreshLogin(browser);
  const shot = async (label) => {
    const path = `test-results/wam-row-inspect-${label}.png`;
    await page.screenshot({ path, fullPage: true }).catch((e) => log(`screenshot failed: ${e.message}`));
    log(`screenshot -> ${path}`);
  };

  const lastCreated = loadLastCreatedUsers();
  const sad = lastCreated['SAD'];
  const cad = lastCreated['CAD'];
  log(`SAD user = ${sad ? sad.name : '(none recorded)'}`);
  log(`CAD user = ${cad ? cad.name : '(none recorded)'}`);

  const wam = new WAMPage(page);
  await wam.goto(dashboard);

  // ---- Site Admin row (Site "Khavda") ----
  log('opening Add Details for Site Admin / Cluster Gujarat-Khavda');
  await wam.openAddDetails();
  await wam.fillAssignmentFilters({ role: 'Site Admin', cluster: ['Gujarat', 'Khavda'] });
  await shot('01-site-admin-filters-filled');

  const siteRow = wam.getWorkAreaRow('Khavda');
  const siteRowCount = await siteRow.count();
  log(`Site Admin: "Khavda" row count in DOM = ${siteRowCount}`);
  if (siteRowCount > 0) {
    const rowHtml = await siteRow.first().innerHTML().catch((e) => `ERROR: ${e.message}`);
    log(`Site Admin: "Khavda" row full HTML (length ${rowHtml.length}):`);
    console.log(rowHtml);

    const combo = siteRow.locator('[role="combobox"]');
    const comboCount = await combo.count();
    log(`Site Admin: combobox count inside row = ${comboCount}`);
    if (comboCount > 0) {
      const comboText = await combo.first().innerText().catch((e) => `ERROR: ${e.message}`);
      log(`Site Admin: combobox current text = ${JSON.stringify(comboText)}`);
      log('Site Admin: attempting click on combobox now...');
      await combo.first().click({ timeout: 10000 }).then(
        () => log('Site Admin: click succeeded'),
        (e) => log(`Site Admin: click FAILED — ${e.message}`)
      );
      await shot('02-site-admin-after-click-attempt');
    }
  } else {
    log('Site Admin: row for "Khavda" did not render at all — dumping whole dialog HTML');
    const dialogHtml = await wam.dialog.innerHTML().catch((e) => `ERROR: ${e.message}`);
    console.log(dialogHtml);
  }

  await wam.closeDialog();

  // ---- Cluster Admin row (Cluster "Gujarat") ----
  log('opening Add Details for Cluster Admin');
  await wam.openAddDetails();
  await wam.fillAssignmentFilters({ role: 'Cluster Admin' });
  await shot('03-cluster-admin-filters-filled');

  const clusterRow = wam.getWorkAreaRow('Gujarat');
  const clusterRowCount = await clusterRow.count();
  log(`Cluster Admin: "Gujarat" row count in DOM = ${clusterRowCount}`);
  if (clusterRowCount > 0) {
    const rowHtml = await clusterRow.first().innerHTML().catch((e) => `ERROR: ${e.message}`);
    log(`Cluster Admin: "Gujarat" row full HTML (length ${rowHtml.length}):`);
    console.log(rowHtml);

    const combo = clusterRow.locator('[role="combobox"]');
    const comboCount = await combo.count();
    log(`Cluster Admin: combobox count inside row = ${comboCount}`);
    if (comboCount > 0) {
      const comboText = await combo.first().innerText().catch((e) => `ERROR: ${e.message}`);
      log(`Cluster Admin: combobox current text = ${JSON.stringify(comboText)}`);
      log('Cluster Admin: attempting click on combobox now...');
      await combo.first().click({ timeout: 10000 }).then(
        () => log('Cluster Admin: click succeeded'),
        (e) => log(`Cluster Admin: click FAILED — ${e.message}`)
      );
      await shot('04-cluster-admin-after-click-attempt');
    }
  } else {
    log('Cluster Admin: row for "Gujarat" did not render at all — dumping whole dialog HTML');
    const dialogHtml = await wam.dialog.innerHTML().catch((e) => `ERROR: ${e.message}`);
    console.log(dialogHtml);
  }

  await wam.closeDialog();
  await context.close();
  log('DONE');
});
