/**
 * DOM INSPECTOR — NOT a test. Nothing asserts a behaviour; everything is
 * REPORTED. It never submits a reassignment, so it mutates nothing.
 *
 * PHASE 0 of docs/reassignment-scenarios.md. Four questions, one run:
 *
 *   1. CAN THE REASSIGNER ROLES EVEN LOG IN? Family R needs Contractor
 *      Manager, Execution Lead, Quality Lead and Project Manager accounts. The
 *      generated smoke users exist for all four on qa — but CISLcliUser151 (a
 *      VENDOR user) failed to authenticate there on 2026-09-15 with no app
 *      message at all, so this cannot be assumed. If these logins fail, the
 *      whole permission matrix has to be built on freshly created users
 *      instead, and it is far cheaper to learn that here than halfway through
 *      writing the spec.
 *
 *   2. WHAT DOES "Select Assignee Type" OFFER, PER ROLE? The rules say
 *      CM -> CI, EL -> EE, QL -> QI, PM -> EE+QI, Admin -> all three. The open
 *      question is HOW that is enforced: does the dropdown enumerate only the
 *      permitted types, or list all three and refuse on submit? The negative
 *      half is what matters — a Quality Lead being offered CI would mean a
 *      lead can re-route contractor work.
 *
 *   3. WHAT IS IN THE "Assign to" LIST? Eligibility is driven by the
 *      candidate's Add User work location + project type, NOT by WAM (app
 *      owner). This dumps the real list so §2's fleet can be designed against
 *      what the app actually offers rather than against the rule as stated.
 *
 *   4. IS AN APPROVED RFI REASSIGNABLE AT ALL? The rule is "only RFIs not yet
 *      approved, NCs not yet closed". Discovery item B1: is the icon absent,
 *      present-but-disabled, or present-and-fails-on-submit?
 *
 * Usage:
 *   $env:PULSE_ENV="qa"
 *   npx playwright test tests/specs/inspection/00_inspect_reassign_permissions.spec.js --project=chromium --workers=1 --headed
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { loginAsFlowUser } = require('../../utils/helpers');
const { BasePage } = require('../../pages/BasePage');
const ReassignPage = require('../../pages/ReassignPage');

test.describe.configure({ mode: 'serial' });

const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const OUT = path.join('test-results', 'reassign-permissions');

// The reassigner roles from the app owner's "Reassignment Rules by Role"
// screen, with what each is expected to be offered. Expectations are recorded
// here so the dump can be read against them — NOT asserted, since this run's
// job is to find out how the rule is enforced, not to police it.
const REASSIGNERS = [
  { key: 'RA_CM', role: 'Contractor Manager', expects: ['Contractor In-Charge'] },
  { key: 'RA_EL', role: 'Execution Lead', expects: ['Execution Engineer'] },
  { key: 'RA_QL', role: 'Quality Lead', expects: ['Quality Inspector'] },
  { key: 'RA_PM', role: 'Project Manager', expects: ['Execution Engineer', 'Quality Inspector'] },
];

const RFI_PENDING_OTHERS = '/my-tasks/rfi/list/pending-with-others';
const RFI_APPROVED = '/my-tasks/rfi/list/approved';

let context, page;
const findings = [];

function note(msg) {
  console.log(`  ${msg}`);
  findings.push(msg);
}

function firstLine(err) {
  return String((err && err.message) || err || '').split(/\r?\n/)[0];
}

function write(name, data) {
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, name),
    typeof data === 'string' ? data : JSON.stringify(data, null, 2)
  );
}

// The purpose-built reassignment fleet (tests/specs/40_reassign_fleet_setup.spec.js),
// NOT the smoke chain's users — those are a different fleet with a different
// job, and the generated `…User151` accounts are refused by this deployment's
// auth anyway (401, measured 2026-09-16).
//
// WAM STATE MATTERS TO HOW THIS RUN READS. As built on 2026-09-16:
//   RA_EL, RA_QL  — mapped on A-06c / Civil (work-area rows BL01..BL08)
//   RA_PM         — mapped on A-06c (work-LOCATION rows; the "one level down" rule)
//   RA_CM         — NOT MAPPED: WAM offers no rows at all for Contractor Manager
//                   at A-06c/Civil. So if the CM can still see and reassign
//                   records here, WAM is not a prerequisite for reassigning —
//                   which is worth knowing in its own right.
function fleetUsers() {
  const { fleetFor } = require('../../utils/reassign-fleet');
  return fleetFor();
}

// The assignee-type dropdown's options, read by actually opening it. Both
// selects' option text nodes exist in the DOM whether open or closed (see
// ReassignPage.getEligibleAssigneeNames), so reading them unopened would risk
// picking up the other dropdown's options too.
async function listAssigneeTypeOptions(reassign) {
  const listbox = await new BasePage(page).openDropdown(reassign.assigneeTypeDropdown);
  const names = (await listbox.locator('[data-part="item-text"]').allInnerTexts())
    .map((n) => n.trim()).filter(Boolean);
  await page.keyboard.press('Escape');
  await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
  return names;
}

// EVERY combobox in the dialog, with its label and its options.
//
// WHY THIS EXISTS. ReassignPage targets the assignee-type dropdown as
// `dialog.locator('[role="combobox"]').first()`, because for Admin it is the
// only combobox present before a type is picked. That assumption BROKE on
// 2026-09-16: for Execution Lead and Quality Lead, `.first()` returned people's
// names — the same names Admin lists under "Execution Engineer" — which means
// those roles render NO type dropdown at all (one permitted type, so the app
// evidently pre-selects it) and the first combobox IS "Assign to".
//
// Reading `.first()` and calling the result "the assignee types" would have
// reported a permission leak that does not exist. Enumerating every combobox
// with its label is what tells "there is no type dropdown for this role" apart
// from "the type dropdown offers the wrong things" — and only the second is a
// defect.
async function dumpDialogComboboxes(reassign) {
  const boxes = reassign.dialog.locator('[role="combobox"]');
  const count = await boxes.count();
  const out = [];

  for (let i = 0; i < count; i += 1) {
    const box = boxes.nth(i);
    const entry = { index: i, label: null, options: [] };

    // The label is whatever text the app associates with it; several of this
    // app's dropdowns have broken label associations, so fall back to the
    // field-root's own text.
    entry.label = (await box.getAttribute('aria-label').catch(() => null))
      || (await box.locator('xpath=ancestor::*[@data-scope="field" or @data-scope="select"][1]')
        .innerText().catch(() => ''))
        .replace(/\s+/g, ' ').trim().slice(0, 60)
      || null;

    try {
      const listbox = await new BasePage(page).openDropdown(box);
      entry.options = (await listbox.locator('[data-part="item-text"]').allInnerTexts())
        .map((n) => n.trim()).filter(Boolean);
      await page.keyboard.press('Escape');
      await listbox.waitFor({ state: 'hidden', timeout: 3000 }).catch(() => {});
    } catch (err) {
      entry.error = firstLine(err);
    }
    out.push(entry);
  }
  return { count, boxes: out };
}

// Opens the reassign modal on the first row of whatever list is on screen and
// returns the ReassignPage bound to it, or null with a reported reason.
async function openModalOnFirstRow(label) {
  const reassign = new ReassignPage(page);
  try {
    await reassign.waitForGrid();
  } catch (err) {
    note(`${label}: no grid on ${page.url()} — ${firstLine(err)}`);
    return null;
  }

  const row = reassign.getFirstRow();
  const rowId = await reassign.getRowId(row).catch(() => null);
  if (!rowId) {
    note(`${label}: the list is empty (no rows to open a modal on)`);
    return null;
  }

  try {
    await reassign.openReassign(row);
    note(`${label}: opened the Reassign User modal on ${rowId}`);
    return { reassign, rowId };
  } catch (err) {
    note(`${label}: could NOT open the reassign modal on ${rowId} — ${firstLine(err)}`);
    return null;
  }
}

async function closeModal(reassign) {
  await reassign.closeButton.click({ timeout: 5000 }).catch(() => {});
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(500);
}

test.beforeAll(async ({ browser }) => {
  expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
  expect(process.env.ADMIN_EMAIL, 'ADMIN_EMAIL must be set in .env').toBeTruthy();

  context = await browser.newContext({
    permissions: ['geolocation', 'camera'],
    geolocation: { latitude: 23.0225, longitude: 72.5714 },
  });
  page = await context.newPage();

  console.log(`\n=== Reassignment permissions recon on ${process.env.BASE_URL} ===\n`);
});

test.afterAll(async () => {
  console.log('');
  console.log('--- Phase 0 findings ---');
  for (const f of findings) console.log(`  ${f}`);
  write('findings.json', findings);
  if (context) await context.close();
});

// ---------------------------------------------------------------------------
test('1. can the four reassigner roles log in at all?', async () => {
  test.setTimeout(25 * 60 * 1000);

  const users = fleetUsers();
  const results = {};

  for (const { key, role } of REASSIGNERS) {
    const user = users[key];
    if (!user) {
      note(`${role} (${key}): NO USER RECORDED for this deployment`);
      results[key] = { role, status: 'no user recorded' };
      continue;
    }

    const ok = await loginAsFlowUser(page, user.email, PASSWORD)
      .then(() => true).catch(() => false);
    note(`${role} (${user.email}): login ${ok ? 'OK' : 'FAILED'}`);
    results[key] = { role, email: user.email, status: ok ? 'ok' : 'failed' };
  }

  write('01-login-viability.json', results);

  // Reported, not asserted — a failing login here is a FINDING (it decides
  // whether Family R can use these accounts), not a broken test.
  const usable = Object.values(results).filter((r) => r.status === 'ok').length;
  note(`reassigner accounts usable: ${usable} / ${REASSIGNERS.length}`);
});

// ---------------------------------------------------------------------------
test('2. Admin: what does the modal offer, and who is eligible?', async () => {
  test.setTimeout(25 * 60 * 1000);

  await loginAsFlowUser(page, process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD, {
    navigateToMyTasks: false,
  });

  await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
  await page.waitForLoadState('networkidle').catch(() => {});

  const opened = await openModalOnFirstRow('Admin / RFI pending-with-others');
  if (!opened) return;
  const { reassign, rowId } = opened;

  const types = await listAssigneeTypeOptions(reassign).catch((e) => {
    note(`Admin: could not read assignee types — ${firstLine(e)}`);
    return [];
  });
  note(`Admin "Select Assignee Type" offers: ${JSON.stringify(types)}`);

  // Pick the first offered type and dump who the app considers eligible. This
  // is the list §2's fleet has to be designed against.
  const dump = { rowId, types, perType: {} };
  for (const type of types) {
    try {
      await reassign.selectAssigneeType(type);
      const current = await reassign.getCurrentAssigneeName().catch(() => null);
      const eligible = await reassign.getEligibleAssigneeNames().catch(() => []);
      dump.perType[type] = { current, eligible };
      note(`  type "${type}": current="${current}", ${eligible.length} eligible ${JSON.stringify(eligible.slice(0, 8))}`);
    } catch (err) {
      dump.perType[type] = { error: firstLine(err) };
      note(`  type "${type}": FAILED — ${firstLine(err)}`);
    }
  }

  write('02-admin-modal.json', dump);
  await page.screenshot({ path: path.join(OUT, '02-admin-modal.png'), fullPage: true });

  // Deliberately NOT submitting — this run mutates nothing.
  await closeModal(reassign);
  note('Admin: modal closed without submitting (this recon mutates nothing)');
});

// ---------------------------------------------------------------------------
test('3. is an APPROVED RFI reassignable? (discovery item B1)', async () => {
  test.setTimeout(20 * 60 * 1000);

  await page.goto(`${process.env.BASE_URL}${RFI_APPROVED}`);
  await page.waitForLoadState('networkidle').catch(() => {});
  note(`approved list URL resolved to: ${page.url()}`);

  const reassign = new ReassignPage(page);
  const hasGrid = await reassign.waitForGrid().then(() => true).catch(() => false);
  if (!hasGrid) {
    note('approved list: no grid rendered — the URL guess may be wrong (see the screenshot)');
    await page.screenshot({ path: path.join(OUT, '03-approved-list.png'), fullPage: true });
    return;
  }

  const row = reassign.getFirstRow();
  const rowId = await reassign.getRowId(row).catch(() => null);
  if (!rowId) {
    note('approved list: no rows to inspect');
    return;
  }

  // Scroll the Actions column into view and count what it offers. A pending row
  // has two icon buttons (eye = view, replace = reassign); the question is
  // whether an approved row has one or two.
  await reassign.scrollGridToEnd().catch(() => {});
  const replaceIcons = await page.locator('svg.lucide-replace').count().catch(() => 0);
  const eyeIcons = await page.locator('svg.lucide-eye').count().catch(() => 0);
  note(`approved list (${rowId}): reassign icons on the page = ${replaceIcons}, view icons = ${eyeIcons}`);
  note(replaceIcons === 0
    ? 'so an approved RFI appears to expose NO reassign control at all'
    : 'reassign icons ARE present on approved rows — the refusal must happen later');

  write('03-approved-list.json', { url: page.url(), rowId, replaceIcons, eyeIcons });
  await page.screenshot({ path: path.join(OUT, '03-approved-list.png'), fullPage: true });
});

// ---------------------------------------------------------------------------
test('4. per reassigner role: what does "Select Assignee Type" offer?', async () => {
  test.setTimeout(40 * 60 * 1000);

  const users = fleetUsers();
  const perRole = {};

  for (const { key, role, expects } of REASSIGNERS) {
    const user = users[key];
    if (!user) continue;

    const loggedIn = await loginAsFlowUser(page, user.email, PASSWORD)
      .then(() => true).catch((e) => { note(`${role}: login failed — ${firstLine(e)}`); return false; });
    if (!loggedIn) { perRole[role] = { status: 'login failed' }; continue; }

    await page.goto(`${process.env.BASE_URL}${RFI_PENDING_OTHERS}`);
    await page.waitForLoadState('networkidle').catch(() => {});

    const opened = await openModalOnFirstRow(`${role} / RFI pending-with-others`);
    if (!opened) { perRole[role] = { status: 'no modal (empty list or no permission)' }; continue; }

    // Enumerate EVERY combobox rather than assuming the first is the type
    // picker — see dumpDialogComboboxes for what that assumption cost.
    const dump = await dumpDialogComboboxes(opened.reassign).catch((e) => {
      note(`${role}: could not enumerate the dialog's dropdowns — ${firstLine(e)}`);
      return { count: 0, boxes: [] };
    });

    note(`${role}: the dialog has ${dump.count} dropdown(s)`);
    for (const box of dump.boxes) {
      note(`    [${box.index}] label=${JSON.stringify(box.label)} ` +
        `options(${box.options.length})=${JSON.stringify(box.options.slice(0, 6))}` +
        `${box.error ? ` ERROR ${box.error}` : ''}`);
    }

    // A combobox is the TYPE picker only if its options are role names. Anything
    // else (people's names) is the "Assign to" list, and a role that renders
    // only that one has no type choice to make.
    const ROLE_WORDS = /contractor incharge|contractor in-charge|execution engineer|quality inspector/i;
    const typeBox = dump.boxes.find((b) => b.options.some((o) => ROLE_WORDS.test(o)));
    const offered = typeBox ? typeBox.options : [];

    if (!typeBox) {
      note(`${role}: NO assignee-type dropdown — the app offers no type choice, ` +
        `consistent with a role permitted exactly one type (${expects.join(', ')})`);
    } else {
      const unexpected = offered.filter((t) => !expects.some((e) => t.includes(e)));
      const missing = expects.filter((e) => !offered.some((t) => t.includes(e)));
      note(`${role}: type dropdown offers ${JSON.stringify(offered)} — expected ${JSON.stringify(expects)}` +
        `${unexpected.length ? ` | UNEXPECTED: ${JSON.stringify(unexpected)}` : ''}` +
        `${missing.length ? ` | MISSING: ${JSON.stringify(missing)}` : ''}`);
    }

    perRole[role] = {
      email: user.email,
      dropdownCount: dump.count,
      dropdowns: dump.boxes,
      typeDropdownPresent: !!typeBox,
      offered,
      expected: expects,
    };
    await closeModal(opened.reassign);
  }

  write('04-assignee-types-per-role.json', perRole);

  // The only hard assertion in the file, and it is about the RUN, not the app:
  // a recon that observed nothing at all must not report success.
  expect(findings.length, 'the recon should have produced findings').toBeGreaterThan(0);
});
