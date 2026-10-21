const { test, expect } = require('@playwright/test');
const { loginAsFlowUser } = require('../utils/helpers');
const {
  attemptCheckpoint, createAndSubmitCheckpoint, fillPageOne, getVisibleCodeFor, approveAsRole, resetToMyTasks,
} = require('../utils/rfi-dependency-flow');
const RFIChecklistPage = require('../pages/RFIChecklistPage');
const ChecklistsConfiguratorPage = require('../drs-setting/ChecklistsConfiguratorPage');
const { drsEnv, loginSuperAdmin } = require('../drs/utils/drs-ui');
const {
  profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers, ciRoleFor,
} = require('../integration/drs-profile');
const { plan, onboardingOnly } = require('./pulse-plan');

// ===========================================================================
// OB04 — RFIs ON EVERY WORK AREA OF THE RUN'S PROJECT (onboarding suite,
// docs/drs-onboarding-suite.md §5; items from ./pulse-plan.js).
//
//   plain  CI raises -> EE approves -> QI approves (CIE for Electrical)
//   full   one sub-activity of a NEW code (PCxx / QCxx / PExx / QExx) with no
//          dependency: checkpoints a, b, c on one Work Section, each approved
//   chain  one sub-activity of our Civil P-code against its dependency plan:
//            a checkpoint that waits (deps) is BLOCKED before its predecessor
//            ("Missing an RFI for Dependent Inspection Point ..."), released once
//            the predecessor is approved, on the SAME Work Section;
//            a checkpoint that does not wait goes through with no predecessor -
//            for a round-2 inherited code that proves DRS's removal reached Pulse.
// Every RFI raised is approved by EE + QI. A checkpoint that binds one of OUR
// checklists must show, on Pulse's checklist page, exactly that checklist's
// questions as DRS holds them (texts + count; recorded by OB01, else read from
// the DRS Checklists Configurator).
// Blocked / no-predecessor attempts use a throwaway Work Section ('__random__'):
// selecting one consumes it for that checkpoint (rfi-dependency-flow.js header).
//
// Every item is recorded on the project (pulse.onboardingRfi) once it passes; a
// re-run skips passed items. Needs IN01 (users) and OB03 (WAM).
// Run (one project): DRS_PROJECT_TAG=<tag> PULSE_ENV=uat npx playwright test --project=onboarding tests/onboarding/OB04_pulse_rfi.spec.js --workers=1
// ===========================================================================

const profile = onboardingOnly(profileForSpec());
const PASSWORD = process.env.BULK_USER_DEFAULT_PASSWORD;
const VERSIONS = profile.unavailable ? [] : plan(profile.drs.project);
const BLOCK_TEXT = /Dependent Inspection Point/i;
const DRS = drsEnv();

// The questions one of our checklists holds in DRS: recorded by OB01 (catalog-round
// ensureChecklists), else read once from the DRS Checklists Configurator.
const questionCache = {};
async function expectedQuestions(browser, own) {
  if (own.questions && own.questions.length) return own.questions;
  if (questionCache[own.sfqp]) return questionCache[own.sfqp];
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1100 } });
  try {
    const page = await ctx.newPage();
    await loginSuperAdmin(page, DRS);
    const cl = new ChecklistsConfiguratorPage(page, DRS.baseUrl);
    await cl.goto();
    const got = await cl.read(own.name, own.sfqp);
    if (!got) throw new Error(`checklist ${own.name} (${own.sfqp}) not found in DRS`);
    questionCache[own.sfqp] = got.questions.map((q) => q.text);
    return questionCache[own.sfqp];
  } finally {
    await ctx.close();
  }
}

function baseFor(item) {
  return {
    workLocation: profile.drs.project.workLocation, workArea: item.workArea, package: item.pkg,
    subPackage: item.subPackage, activity: item.activity, subActivity: item.subActivity,
    rfiQuantity: null, unit: null, subContractor: null,
  };
}

const done = (id) => ((recordedPulse(profile).onboardingRfi || {})[id] || {}).status === 'passed';
// Merged into the CURRENT map inside the state lock: lanes run in parallel.
function record(id, patch) {
  recordPulse(profile, (cur) => {
    const all = cur.onboardingRfi || {};
    return { onboardingRfi: { ...all, [id]: { ...(all[id] || {}), ...patch, at: new Date().toISOString() } } };
  });
}

if (profile.unavailable) {
  test('OB04. RFIs on the run\'s Work Areas', () => requireAvailable(profile));
}

for (const { version, items } of VERSIONS) {
  test.describe(version, () => {
    // ONE VERSION = ONE LANE, in order (2026-10-21): Pulse numbers RFIs per Work
    // Area + package with a counter that is NOT safe under concurrent creates - two
    // lanes raising on the same WA at once got the SAME code (RFI-…-WA03-CIV-73 for
    // PC25.2.1 a and PC25.2.2 a). So a version's items (its WA's) never run side by
    // side; versions still run in parallel lanes. 'default', not 'serial': one
    // failure does not skip the rest.
    test.describe.configure({ mode: 'default' });
    for (const item of items) {
      const note = item.kind === 'chain' ? ` (${item.plan}: ${item.deps.length ? item.deps.map((d) => `${d}<-prev`).join(', ') : 'no dependency'})`
        : item.kind === 'full' ? ' (checkpoints a, b, c)' : '';
      test(`OB04. ${item.id}${note}`, async ({ browser }) => {
        requireAvailable(profile);
        test.setTimeout(90 * 60 * 1000);
        if (done(item.id)) { console.log(`  ${item.id}: passed earlier - skipped`); return; }
        expect(PASSWORD, 'BULK_USER_DEFAULT_PASSWORD must be set in .env').toBeTruthy();
        const CI = ciRoleFor(item.pkg);
        const users = drsUsers(profile, [CI, 'EE', 'QI']);
        for (const r of [CI, 'EE', 'QI']) expect(users[r], `${r} not recorded - run IN01 first`).toBeTruthy();
        const loginAs = (p, role) => loginAsFlowUser(p, users[role].email, PASSWORD);
        const base = baseFor(item);
        console.log(`  ${version}: ${base.workArea} / ${base.package} / ${base.subPackage} / ${base.activity} / ${base.subActivity}`);

        const context = await browser.newContext({ permissions: ['geolocation', 'camera'], geolocation: { latitude: 23.0225, longitude: 72.5714 } });
        const page = await context.newPage();
        const rfis = [];
        // One checkpoint on one of OUR checklists: Pulse must show exactly the
        // checklist's DRS questions (texts + count) before it is submitted.
        const submitOwn = async (cp, ws) => {
          const want = await expectedQuestions(browser, cp.own);
          const { rfiCreate, workSectionLabel } = await fillPageOne(page, base, { name: cp.name, checklist: cp.checklist }, ws);
          const outcome = await rfiCreate.clickProceedAndCheckOutcome();
          expect(outcome.proceeded, `"${cp.name}" should proceed but was blocked: "${outcome.toastText}"`).toBe(true);
          const checklist = new RFIChecklistPage(page);
          const filled = await checklist.fillAllObservations('OK - as per standard', true);
          const missing = [];
          for (const text of want) {
            if (!(await page.getByText(text, { exact: false }).first().isVisible().catch(() => false))) missing.push(text);
          }
          console.log(`    ${cp.name}: checklist ${cp.own.name} - ${filled} question input(s) in Pulse, ${want.length} in DRS${missing.length ? `, MISSING: ${JSON.stringify(missing)}` : ''}`);
          expect(missing, `${cp.name}: questions of ${cp.own.name} not shown in Pulse`).toEqual([]);
          expect(filled, `${cp.name}: Pulse shows ${filled} question inputs, DRS checklist ${cp.own.name} has ${want.length}`).toBe(want.length);
          await checklist.submitRFI();
          const m = page.url().match(/rfi\/([a-f0-9-]+)\/view/i);
          expect(m, `no RFI id after submitting "${cp.name}": ${page.url()}`).toBeTruthy();
          return { rfiId: m[1], workSectionLabel };
        };
        // Raise + submit one checkpoint; returns its visible code.
        const raise = async (cp, ws) => {
          const { rfiId, workSectionLabel } = cp.own ? await submitOwn(cp, ws) : await createAndSubmitCheckpoint(page, base, cp, ws);
          const code = await getVisibleCodeFor(page, rfiId);
          expect(code, `${cp.name}: no visible RFI code after submit`).toBeTruthy();
          rfis.push({ checkpoint: cp.name, code, workSection: workSectionLabel });
          console.log(`  ✓ ${code} ${cp.name} on ${workSectionLabel}`);
          await resetToMyTasks(page);
          return { code, ws: workSectionLabel };
        };
        const approve = async (code) => {
          await approveAsRole(page, 'EE', code, { loginAs });
          await approveAsRole(page, 'QI', code, { loginAs });
          console.log(`  ✓ ${code} approved by EE + QI`);
          await loginAs(page, CI);
        };
        const expectBlocked = async (cp, prev) => {
          const r = await attemptCheckpoint(page, base, cp, '__random__');
          console.log(`  ${cp.name} before ${prev.name}: ${r.proceeded ? 'PROCEEDED (wrong)' : 'blocked'} - "${r.toastText}" (throwaway ${r.workSectionLabel})`);
          expect(r.proceeded, `${cp.name} should be BLOCKED until ${prev.name} is approved`).toBe(false);
          expect(r.toastText || '', `${cp.name}: blocked, but not by the dependency rule`).toMatch(BLOCK_TEXT);
          await resetToMyTasks(page);
        };
        const expectFree = async (cp) => {
          const r = await (cp.own ? submitOwn(cp, '__random__') : createAndSubmitCheckpoint(page, base, cp, '__random__'))
            .catch((e) => { throw new Error(`${cp.name} has NO dependency in DRS but Pulse blocked it: ${e.message}`); });
          const code = await getVisibleCodeFor(page, r.rfiId);
          rfis.push({ checkpoint: cp.name, code, workSection: r.workSectionLabel, free: true });
          console.log(`  ✓ ${code} ${cp.name} went through with no predecessor (${r.workSectionLabel})`);
          await resetToMyTasks(page);
          return code;
        };

        try {
          await loginAs(page, CI);
          if (item.kind === 'plain') {
            const { code } = await raise({ name: item.checkpoint, checklist: item.checklist }, '__random__');
            await approve(code);
          } else if (item.kind === 'full') {
            // No dependency: a, b, c on one Work Section, each approved.
            const [a, b, c] = item.checkpoints;
            const ra = await raise(a, '__random__');
            await approve(ra.code);
            for (const cp of [b, c]) {
              const r = await raise(cp, ra.ws);
              await approve(r.code);
            }
          } else {
            const [a, b, c] = item.checkpoints;
            const waitsB = item.deps.includes('b');
            const waitsC = item.deps.includes('c');
            if (!waitsB && !waitsC) {
              // The removal proof: b and c go through with no predecessor; each approved.
              await approve(await expectFree(b));
              await approve(await expectFree(c));
            } else {
              if (waitsB) await expectBlocked(b, a);
              const ra = await raise(a, '__random__');
              if (waitsC) await expectBlocked(c, b);
              await approve(ra.code);
              const rb = await raise(b, ra.ws);
              await approve(rb.code);
              if (waitsC) {
                const rc = await raise(c, ra.ws);
                await approve(rc.code);
              } else {
                await approve(await expectFree(c));
              }
            }
          }
          record(item.id, { status: 'passed', version, rfis });
        } catch (err) {
          record(item.id, { status: 'failed', version, rfis, error: err.message.split('\n')[0].slice(0, 300) });
          throw err;
        } finally {
          await context.close();
        }
      });
    }
  });
}
