const fs = require('fs');
const path = require('path');
const { drsEnv, drsSuperAdmin } = require('../../config/drs-environments');

// Shared DRS UI plumbing: login, the Ark/Zag combobox handling DRS needs, and
// the screenshot + ARIA dumper. Used by the READ-ONLY exploration specs
// (tests/drs/inspection/, which also install the write guard below) and by the
// setup stages (tests/drs/setup/, which write and so never install it).

// The project the exploration reads (app owner, 2026-09-26): "AGEL Hybrid
// Merchant_292 (Solar)" on drs-uat, Gujarat → Khavda → S05b, 69 Work Areas.
// Chosen because it survives redeployments — the earlier "Pulse synce vije"
// is a sync-test project that will be deleted. Override with
// DRS_EXPLORE_PROJECT_ID.
const EXPLORE_PROJECT_ID = process.env.DRS_EXPLORE_PROJECT_ID || '765d49bf-bbb0-48a3-91d5-1636cba9d615';

// THE WRITE GUARD. Aborts and records any fetch/XHR to the DRS host that is
// not a GET, a login (/auth/) or DRS's read shape (POST /api/v1/query/<TABLE>).
async function installWriteGuard(context, env, blocked) {
  await context.route('**/*', async (route) => {
    const req = route.request();
    const u = req.url();
    const isApi = ['fetch', 'xhr'].includes(req.resourceType());
    const allowed = req.method() === 'GET' || /\/auth\//i.test(u) || /\/api\/v1\/query\//i.test(u);
    if (isApi && u.startsWith(env.baseUrl) && !allowed) {
      blocked.push(`${req.method()} ${u}`);
      return route.abort();
    }
    return route.continue();
  });
}

async function loginSuperAdmin(page, env) {
  const { email, password } = drsSuperAdmin();
  await page.goto(`${env.baseUrl}/login`);
  const emailBox = page.getByTestId('login-email');
  await emailBox.waitFor({ state: 'visible', timeout: 60000 });
  await emailBox.fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(/\/projects/, { timeout: 120000 });
}

// Screenshot + ARIA snapshot of the current page, numbered in call order.
function makeDumper(page, outDir, summary) {
  let step = 0;
  fs.mkdirSync(outDir, { recursive: true });
  return async function dump(name, extra = {}) {
    step += 1;
    const base = path.join(outDir, `${String(step).padStart(2, '0')}-${name}`);
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${base}.png`, fullPage: true }).catch(() => {});
    const aria = await page.locator('body').ariaSnapshot({ timeout: 15000 })
      .catch((e) => `ariaSnapshot failed: ${e.message}`);
    fs.writeFileSync(`${base}.aria.txt`, `URL: ${page.url()}\n\n${aria}`);
    summary.screens.push({ step, name, url: page.url(), ...extra });
    console.log(`  [${step}] ${name} -> ${page.url()}`);
  };
}

// DRS comboboxes open from a "Toggle suggestions" button, not the input
// (round 1: clicking the input listed nothing). The button is either the
// combobox's ancestor (SO Configuration) or its sibling in the field group
// (Add Project), so both are tried, then ArrowDown as a last resort.
async function openCombobox(page, combo) {
  await combo.evaluate((el) => {
    const sel = 'button[aria-label="Toggle suggestions"]';
    const btn = el.closest(sel)
      || (el.parentElement && el.parentElement.querySelector(sel))
      || (el.closest('[role="group"]') && el.closest('[role="group"]').querySelector(sel));
    if (btn) btn.click();
  }).catch(() => {});
  await page.waitForTimeout(700);
  if (!(await page.getByRole('option').first().isVisible().catch(() => false))) {
    await combo.click({ timeout: 5000 }).catch(() => {});
    await page.keyboard.press('ArrowDown').catch(() => {});
    await page.waitForTimeout(700);
  }
}

async function visibleOptions(page, limit = 80) {
  const texts = await page.locator('[role="option"]:visible').allInnerTexts().catch(() => []);
  return texts.map((t) => t.trim()).filter(Boolean).slice(0, limit);
}

// Lists a combobox's options WITHOUT choosing one.
async function listOptions(page, combo) {
  await openCombobox(page, combo);
  const options = await visibleOptions(page);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(300);
  return options;
}

// Chooses an option in a FILTER combobox (UI state only — the write guard
// still stands behind it). Returns whether it was found.
async function chooseOption(page, combo, text) {
  await openCombobox(page, combo);
  // VISIBLE options only, matched on exact text. DRS keeps closed listboxes'
  // options in the DOM (DRS team), and two open-able lists can share a label
  // (Category and Construction By both offer "EPC"), so a page-wide
  // getByRole('option').first() can land on a hidden option of another field.
  const escaped = String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const option = page.locator('[role="option"]:visible')
    .filter({ hasText: new RegExp(`^\\s*${escaped}\\s*$`) }).first();
  if (!(await option.isVisible().catch(() => false))) {
    await page.keyboard.press('Escape').catch(() => {});
    return false;
  }
  await option.click();
  await page.waitForTimeout(1200);
  return true;
}

module.exports = {
  EXPLORE_PROJECT_ID, drsEnv, installWriteGuard, loginSuperAdmin, makeDumper,
  openCombobox, visibleOptions, listOptions, chooseOption,
};
