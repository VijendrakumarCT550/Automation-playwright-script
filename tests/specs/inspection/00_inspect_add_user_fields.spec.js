/**
 * DOM INSPECTOR — NOT a test. Opens the Add User dialog and reports which
 * fields each role actually renders, and what they offer. Creates nothing.
 *
 * TWO FLEET MEMBERS ARE BLOCKED ON FACTS ONLY THIS DIALOG CAN GIVE
 * (docs/reassignment-scenarios.md §2, the DEFERRED list):
 *
 *   CI-G — "a CI from a DIFFERENT vendor must not be offered when reassigning".
 *          Building it needs a second vendor to exist at all. So: what does the
 *          Vendor dropdown offer besides M S CHOUHAN INFRAVENTURES?
 *
 *   EE-B — "a user provisioned for Solar AND Wind". Building it needs the
 *          Project Type field to exist AND accept two picks. The Contractor
 *          Manager created on 2026-09-16 rendered NO Project Type field at all
 *          (the cascade went Cluster -> Site -> Work Locations), so whether
 *          AGEL roles get one is unknown — and if they do not, EE-B is not
 *          constructible and should be dropped from the doc rather than left
 *          as a phantom scenario.
 *
 * Both were briefly put to the app owner as questions. They should not have
 * been: the dialog answers them directly, and asking a person for something a
 * two-minute look can settle wastes their time.
 *
 * Usage:
 *   $env:PULSE_ENV="qa"
 *   npx playwright test tests/specs/inspection/00_inspect_add_user_fields.spec.js --project=chromium --workers=1
 */
const { test } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser } = require('../../utils/helpers');
const { getProfile } = require('../../config/projects');
const { BasePage } = require('../../pages/BasePage');
const UserManagementPage = require('../../pages/UserManagementPage');

const OUT = path.join('test-results', 'add-user-fields');

// One VENDOR role and one AGEL role — the two shapes the fleet needs.
const ROLES = [
  { role: 'Contractor Incharge', userType: 'VENDOR' },
  { role: 'Execution Engineer', userType: 'AGEL' },
];

function firstLine(err) {
  return String((err && err.message) || err || '').split(/\r?\n/)[0];
}

// Reads a dropdown's options without committing to a choice.
async function optionsOf(page, locator, label) {
  if (!(await locator.isVisible({ timeout: 1500 }).catch(() => false))) {
    return { label, present: false, options: [] };
  }
  try {
    const listbox = await new BasePage(page).openDropdown(locator);
    const options = (await listbox.locator('[data-part="item-text"]').allInnerTexts())
      .map((t) => t.trim()).filter(Boolean);
    await page.keyboard.press('Escape');
    await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    return { label, present: true, options };
  } catch (err) {
    return { label, present: true, options: [], error: firstLine(err) };
  }
}

test('Which fields does Add User render per role, and what do they offer?', async ({ page }) => {
  test.setTimeout(20 * 60 * 1000);
  fs.mkdirSync(OUT, { recursive: true });

  const profile = getProfile('solar-e2e');
  const report = {};

  const dashboard = await loginAsFlowUser(
    page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, { navigateToMyTasks: false }
  );

  const users = new UserManagementPage(page);
  await users.goto(dashboard);

  for (const { role, userType } of ROLES) {
    console.log(`\n=== ${role} (${userType}) ===`);
    const entry = { userType, fields: [] };

    await users.openAddUserDialog();
    await users.selectUserType(userType);

    if (userType === 'VENDOR') {
      // THE VENDOR LIST — this is CI-G's answer.
      const cat = await optionsOf(page, users.vendorCategoryDropdown, 'Vendor Category');
      entry.fields.push(cat);
      console.log(`  Vendor Category present=${cat.present} options=${JSON.stringify(cat.options)}`);

      await users.selectVendorCategory(profile.vendor.category).catch((e) =>
        console.log(`  (could not select vendor category: ${firstLine(e)})`));

      const vendors = await optionsOf(page, users.vendorDropdown, 'Vendor');
      entry.fields.push(vendors);
      console.log(`  Vendor present=${vendors.present} count=${vendors.options.length}`);
      console.log(`    ${JSON.stringify(vendors.options.slice(0, 20))}`);
      entry.vendorCount = vendors.options.length;
      entry.otherVendors = vendors.options.filter((v) => !v.includes('CHOUHAN'));

      await users.selectVendor(profile.vendor.name).catch(() => {});
    }

    await users.selectUserRole(role).catch((e) =>
      console.log(`  (could not select role: ${firstLine(e)})`));

    // THE CASCADE — which of these four actually render for this role?
    for (const [locator, label] of [
      [users.clusterDropdown, 'Cluster'],
      [users.sitesDropdown, 'Sites'],
      [users.projectTypeDropdown, 'Project type'],
      [users.workLocationsDropdown, 'Work Locations'],
    ]) {
      const f = await optionsOf(page, locator, label);
      entry.fields.push(f);
      console.log(`  ${label.padEnd(15)} present=${String(f.present).padEnd(5)} ` +
        `options=${f.options.length ? JSON.stringify(f.options.slice(0, 8)) : '[]'}` +
        `${f.error ? ` ERROR ${f.error}` : ''}`);
    }

    // PROJECT TYPE IS EE-B's ANSWER: present at all, and multi-select?
    const pt = entry.fields.find((f) => f.label === 'Project type');
    entry.projectTypePresent = !!(pt && pt.present);
    console.log(`  => Project type field present for ${role}: ${entry.projectTypePresent}`);

    report[role] = entry;

    await page.screenshot({
      path: path.join(OUT, `${role.replace(/[^a-z0-9]+/gi, '-')}.png`), fullPage: true,
    });
    await users.closeAnyOpenListbox().catch(() => {});
    await users.closeAnyOpenDialog().catch(() => {});
    await page.waitForTimeout(500);
  }

  fs.writeFileSync(path.join(OUT, 'fields.json'), JSON.stringify(report, null, 2));

  console.log('\n--- ANSWERS ---');
  const ci = report['Contractor Incharge'] || {};
  const ee = report['Execution Engineer'] || {};
  console.log(`  CI-G (second vendor): ${ci.otherVendors && ci.otherVendors.length
    ? `BUILDABLE — ${ci.otherVendors.length} other vendor(s), e.g. ${JSON.stringify(ci.otherVendors.slice(0, 3))}`
    : 'NOT buildable — no vendor other than CHOUHAN is offered'}`);
  console.log(`  EE-B (solar + wind) : ${ee.projectTypePresent
    ? 'Project type IS rendered for the AGEL role — check the options above for WIND'
    : 'NOT buildable — no Project type field for this role, so a user cannot be scoped to two project types'}`);
  console.log(`\n  artefacts in ${OUT}\n`);
});
