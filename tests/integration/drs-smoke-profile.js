// THE DRS SMOKE PROFILE — the FULL smoke-chain profile (the shape of
// tests/config/projects.js SOLAR_E2E), built for the newest DRS project that is
// ready for Pulse. It lets every existing smoke stage (SM01–SM29) run UNCHANGED
// on DRS-created ground, as the `smoke-drs-*` projects in playwright.config.js.
// App owner, 2026-09-26: "add other specs also in integration folder and verify
// they all pass". The stages are reused rather than copied — 29 copies would
// drift from the originals the first time either side changed.
//
// SAME KEY as the integration profile (drs-profile.js): `drs-solar-<tag>`. That
// is what lets the chain reuse the CI/EE/QI that IN01 already created for this
// project — smoke-users.js only accepts a recorded user whose profileKey matches
// — and gives every DRS project its own tracker files.
//
// GROUND on a 13-block DRS project, mirroring solar-e2e's layout so no two
// stages share mutable ground:
//   BL01 / BL02   IN03 / IN04 single cycles (and BL01 is the 3rd bulk area)
//   BL03 / BL04   RFI flow desktop / mobile (SM05; IN05's matrix uses BL03)
//   BL05          NC flow + NC create (SM06, SM26; IN06)
//   BL06          NC-blocks-RFI (SM28) — leaves a non-approved NC by design
//   BL07          activity dependency chain (SM07)
//   BL08 / BL09   WAM sweep (SM11–SM13)
//   BL10          WAM patch/demap (SM19–SM22)
//   BL11          RFI create / bulk + dashboard seed (SM23, SM24, SM29)
//   BL12 / BL13 / BL01   multi-area bulk (SM25)

const { drsIntegrationProfile } = require('./drs-profile');

const ROLE_KEYS = ['CI', 'CM', 'EE', 'QI', 'EL', 'QL', 'PM', 'PAD', 'SAD', 'CAD'];
// Integration-only prefixes, so they can never collide with the smoke profiles'
// *SL/*SM users or the batch spec's bare keys. CI/EE/QI match drs-profile.js.
const PREFIX = (k) => `${k}DRS`;
const ROLES = {
  CI: { role: 'Contractor Incharge', userType: 'VENDOR' },
  CM: { role: 'Contractor Manager', userType: 'VENDOR' },
  EE: { role: 'Execution Engineer', userType: 'AGEL' },
  QI: { role: 'Quality Inspector', userType: 'AGEL' },
  EL: { role: 'Execution Lead', userType: 'AGEL' },
  QL: { role: 'Quality Lead', userType: 'AGEL' },
  PM: { role: 'Project Manager', userType: 'AGEL' },
  PAD: { role: 'Plot Admin', userType: 'AGEL' },
  SAD: { role: 'Site Admin', userType: 'AGEL' },
  CAD: { role: 'Cluster Admin', userType: 'AGEL' },
};

let cached = null;

function buildDrsSmokeProfile(requestedKey) {
  const base = drsIntegrationProfile(); // throws (by name) when unpaired / no project
  const vm = requestedKey && requestedKey.match(VERSION_KEY);
  if (vm && vm[1] === base.key) return buildVersionSmokeProfile(buildDrsSmokeProfile(base.key), vm[2]);
  if (requestedKey && requestedKey !== base.key) {
    throw new Error(`DRS smoke profile "${requestedKey}" asked for, but the newest ready DRS ` +
      `project is "${base.key}". Set DRS_PROJECT_TAG to pin an older project.`);
  }
  if (cached && cached.key === base.key) return cached;

  const p = base.drs.project;
  // An ONBOARDING project (tests/onboarding, 2026-10-21) carries 13 smoke areas
  // SM01..SM13 (TABLE + INVERTER, pinned to All sites v1) in place of BL blocks;
  // they take the BL slots one for one, so every stage runs unchanged.
  const onboarding = Boolean(p.onboardingRun);
  const blocks = p.workAreas.filter((wa) => (onboarding ? /^SM\d+$/ : /^BL\d+$/i).test(wa));
  const need = 13;
  if (blocks.length < need) {
    throw new Error(onboarding
      ? `${p.name} has ${blocks.length} SM smoke areas; the full smoke chain needs ${need} (re-run onboarding OB02 - it imports the missing areas).`
      : `${p.name} has ${blocks.length} BL work areas; the full smoke chain needs ${need} (run \`DRS_WORK_AREAS=13 npm run drs:setup\`).`);
  }
  const BL = (n) => blocks[n - 1];
  const wl = p.workLocation;

  cached = {
    key: base.key,
    label: `DRS smoke — ${p.name}`,
    tier: 'smoke',
    projectType: 'SOLAR',
    cluster: [p.cluster],
    site: p.site,
    workLocations: [wl],
    workAreas: [BL(3), BL(4), BL(5), BL(6), BL(7)],
    primaryWorkArea: BL(3),
    viewports: ['desktop', 'mobile'],
    flowWorkAreas: {
      rfi: { desktop: [BL(3)], mobile: [BL(4)] },
      nc: { desktop: [BL(5)], mobile: [BL(5)] },
    },
    demapWorkArea: BL(6),
    workSectionGranularity: 'many-per-work-area',
    throwawayWorkArea: null,
    packages: ['Civil'],
    vendor: { ...base.vendor },
    mapServiceOrderToAllActivities: true,
    users: {
      source: 'created',
      order: ROLE_KEYS,
      flowRoles: ['CI', 'CM', 'EE', 'QI'],
      hierarchyRoles: ['CAD', 'SAD', 'PAD', 'PM', 'EL', 'QL'],
      prefixes: Object.fromEntries(ROLE_KEYS.map((k) => [k, PREFIX(k)])),
      roles: Object.fromEntries(ROLE_KEYS.map((k) => [PREFIX(k), ROLES[k]])),
    },
    activityMasterFixture: null,

    // The proven solar Piling RFI combination (v1 = Pulse's packages unchanged).
    rfi: {
      workLocation: wl,
      workArea: BL(3),
      package: 'Civil',
      subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
      activity: 'Piling - MMS',
      workSection: null,
      rfiQuantity: null,
      unit: null,
      subContractor: null,
      observationValue: 'OK - as per standard (DRS smoke)',
      checkpointChain: [{
        code: 'A.1.1.1',
        subActivity: 'Piling - MMS',
        checkpoint: 'Pre Pour Inspection - Pile',
        checklist: 'Micro Pile Checklist',
      }],
    },
    nc: { ...base.nc, workArea: BL(5) },

    dependencyChain: {
      label: 'Piling - MMS (dependency check)',
      workLocation: wl,
      workArea: BL(7),
      package: 'Civil',
      subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
      activity: 'Piling - MMS',
      subActivity: 'Piling - MMS',
      checkpoints: [
        { name: 'Pre Pour Inspection - Pile', checklist: 'Micro Pile Checklist' },
        { name: 'Pre Pour Inspection - Pile Cap', checklist: 'Micro Pile Cap Checklist' },
        { name: 'Post Pour Inspection', checklist: 'Post Pour Check' },
      ],
    },

    ncBlock: {
      workLocation: wl,
      workArea: BL(6),
      package: 'Civil',
      subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
      activity: 'Piling - MMS',
      subActivity: 'Piling - MMS',
      checkpoint: 'Pre Pour Inspection - Pile',
      checklist: 'Micro Pile Checklist',
      vendorName: base.nc.vendorName,
      ncQuantity: 2,
      unit: 'EA',
      defectType: '__first__',
      category: 'Critical',
      targetDateClosureDays: 14,
      workSectionCount: 1,
      otherActivity: 'Piling - Robotic Docking System',
      otherSubActivity: 'Piling - Robotic Docking System',
    },

    featureGround: {
      wamSweep: [BL(8), BL(9)],
      wamMutate: BL(10),
      rfiCreate: BL(11),
      rfiBulkAreas: [BL(12), BL(13), BL(1)],
      ncBlock: BL(6),
      ncCreate: BL(5),
      dashboardSeed: BL(11),
    },

    drs: base.drs,
  };
  return cached;
}

// The key the config should build the `smoke-drs-*` chain for, or null when
// there is no paired, ready DRS project (then no DRS chain is emitted at all,
// and nothing else in the config is affected).
function currentDrsSmokeKey() {
  try {
    return buildDrsSmokeProfile().key;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// PER-CATALOG-VERSION SMOKE PROFILES (onboarding suite, app owner 2026-10-21:
// "smoke RFI and NC for all new catalog site and all site specific, not only
// v1"). An onboarding project carries, for each version other than All sites v1,
// 9 areas SM<nn>-01..09 pinned to it. A version profile is the project's smoke
// profile with:
//   key       `<project key>-v<nn>` - its OWN trackers (rfi-tracker.<key>...)
//   usersKey  the project key - the SAME users (smoke-users.js / -user-factory.js)
//   ground    its 9 areas, in the slots the RFI / NC stages read
//   rfi       the version's own Civil P-code: <P>.2.1 Sub Activity / Checkpoint a
//             (no dependency in any plan; on a site build it carries OUR checklist)
//   nc        <P>.2 Activity / <P>.2.2 Sub Activity
//   ncBlock   the rfi triple, other activity = the version's Q-code <Q>.1.1
//   dependencyChain  <P>.1.2 a -> b -> c, when the code's plan is "first"
//             (b<-a, c<-b); otherwise null and the dependency stage is not emitted
// The stages themselves are the smoke folder's, unchanged (VERSION_STAGE_IDS).
const VERSION_KEY = /^(drs-solar-.+)-v(\d{2})$/;
const VERSION_STAGE_IDS = ['users', 'wam', 'draft-autosave', 'rfi', 'nc', 'dependency', 'data-integrity',
  'rfi-create', 'rfi-bulk', 'rfi-bulk-multi', 'nc-create', 'nc-block'];

function versionCodes(project, version) {
  const state = require('../drs/utils/drs-state');
  const DATA = require('../drs/drs-data');
  const { catalogRecord } = require('../onboarding/pulse-plan');
  const env = state.envRecord(String(process.env.DRS_ENV || 'uat').toLowerCase());
  const rec = catalogRecord(env, version);
  const own = rec && rec.onboarding && rec.codes && rec.codes.Civil;
  const civil = own && own.length ? own : DATA.catalogCodes(env, version, 'Civil');
  const P = civil.filter((c) => c.startsWith('P')).pop();
  const Q = civil.filter((c) => c.startsWith('Q')).pop();
  const plan = rec && rec.codePlans && rec.codePlans[P];
  return { P, Q, plan };
}

function buildVersionSmokeProfile(base, nn) {
  const { buildTree, DEPENDENCY_PLANS } = require('../drs-setting/pc-data');
  const p = base.drs.project;
  const slots = p.workAreas.filter((wa) => new RegExp(`^SM${nn}-\\d{2}$`).test(wa)).sort();
  if (slots.length < 9) throw new Error(`${p.name}: version ${nn} has ${slots.length} of 9 smoke areas (SM${nn}-01..09) - re-run onboarding OB02`);
  const version = p.areaVersions[slots[0]];
  const { P, Q, plan } = versionCodes(p, version);
  if (!P || !Q) throw new Error(`${p.name}: ${version} has no Civil P / Q code recorded`);
  const deps = plan && plan.deps === 'first' ? DEPENDENCY_PLANS.first : null;
  const tree = buildTree(P, { ...(plan && plan.checklists ? { checklists: plan.checklists } : {}), ...(deps ? { dependencies: deps } : {}) });
  const act2 = tree.activities[1];
  const sub21 = act2.subActivities[0];
  const sub22 = act2.subActivities[1];
  const cpA = sub21.checkpoints[0];
  const sub12 = tree.activities[0].subActivities[1];
  const qTree = buildTree(Q);
  const S = (k) => slots[k - 1];
  const wl = p.workLocation;
  return {
    ...base,
    key: `${base.key}-v${nn}`,
    // OWN USERS per version (2026-10-21): the smoke flows keep ONE long session per
    // role, and with every version chain sharing the project's CI / EE / QI, one
    // chain's fresh login broke another chain's long-running session (R6: CI's
    // "Pending with me" never rendered for TC-04/05 on mobile, CI steps of the NC
    // flow timed out). Prefixes <role>DRSV<nn> - SM01 of the chain creates them,
    // SM03 maps them onto the version's areas - and the chains stay parallel.
    // EXCEPT the PM: its WAM row is the WORK LOCATION, one assignee for the whole
    // project, so every chain uses the project's PM (already mapped there by the
    // base chain; usersKeys.PM). SMOKEV keeps the PM out of the long NC flows
    // (SMOKE_NC_CREATORS=QI,EE,EL,QL, run-onboarding.js) so the shared session is
    // never long-running in two chains at once.
    users: {
      ...base.users,
      prefixes: Object.fromEntries(Object.entries(base.users.prefixes).map(([k, pre]) => [k, k === 'PM' ? pre : `${k}DRSV${nn}`])),
      roles: Object.fromEntries(Object.entries(base.users.prefixes).map(([k, pre]) => [k === 'PM' ? pre : `${k}DRSV${nn}`, base.users.roles[pre]])),
    },
    usersKeys: { PM: base.key },
    label: `DRS smoke ${version} — ${p.name}`,
    catalogVersion: version,
    workAreas: [S(1), S(2), S(3), S(4), S(5)],
    primaryWorkArea: S(1),
    flowWorkAreas: { rfi: { desktop: [S(1)], mobile: [S(2)] }, nc: { desktop: [S(3)], mobile: [S(3)] } },
    demapWorkArea: S(4),
    rfi: {
      ...base.rfi,
      workArea: S(1),
      subPackage: tree.name,
      activity: act2.name,
      checkpointChain: [{ code: cpA.name, subActivity: sub21.name, checkpoint: cpA.name, checklist: cpA.checklist.chip }],
    },
    nc: { ...base.nc, workArea: S(3), activity: act2.name, subActivity: sub22.name, unit: '__first__' },
    ncBlock: {
      ...base.ncBlock,
      workLocation: wl,
      workArea: S(4),
      subPackage: tree.name,
      activity: act2.name,
      subActivity: sub21.name,
      checkpoint: cpA.name,
      checklist: cpA.checklist.chip,
      unit: '__first__',
      otherActivity: qTree.activities[0].name,
      otherSubActivity: qTree.activities[0].subActivities[0].name,
    },
    dependencyChain: deps ? {
      label: `${sub12.name} (dependency check, ${version})`,
      workLocation: wl,
      workArea: S(5),
      package: 'Civil',
      subPackage: tree.name,
      activity: tree.activities[0].name,
      subActivity: sub12.name,
      checkpoints: sub12.checkpoints.map((c) => ({ name: c.name, checklist: c.checklist.chip })),
    } : null,
    // The version's OWN areas only - NOT a copy of the base's: SM03 maps the chain's
    // users onto every featureGround area, and the base's wamSweep / wamMutate
    // (SM08 / SM09 / SM10) put every version chain's CI on the SAME base areas
    // (live 2026-10-21: CIDRSV03 replaced CIDRSV02 on SM10). The version chains run
    // no WAM-sweep / mutate stage, so those point at the chain's own area.
    featureGround: {
      wamSweep: [],
      wamMutate: S(4),
      rfiCreate: S(6),
      rfiBulkAreas: [S(7), S(8), S(9)],
      ncBlock: S(4),
      ncCreate: S(3),
      dashboardSeed: S(6),
    },
  };
}

// The per-version smoke chains the config should emit for the project named by
// DRS_PROJECT_TAG: [{ chain: 'drsv<nn>', key, version, stageIds }], or [] when
// there is no onboarding project with version smoke areas (never throws).
function currentVersionSmokeChains() {
  try {
    const base = buildDrsSmokeProfile();
    const p = base.drs.project;
    if (!p.onboardingRun) return [];
    const nns = [...new Set(p.workAreas.map((wa) => (wa.match(/^SM(\d{2})-\d{2}$/) || [])[1]).filter(Boolean))].sort();
    // DRAFT AUTOSAVE goes in a chain of its own per version, run ONE AT A TIME
    // (`sequential`): Pulse keeps ONE RFI draft per user, and the version chains
    // share the project's CI - three chains drafting at once overwrote each other's
    // drafts (live 2026-10-21, R6: L1 "workLocation should survive the round trip"
    // in two of three parallel chains). Every other stage runs in parallel lanes.
    return nns.flatMap((nn) => {
      const prof = buildVersionSmokeProfile(base, nn);
      const common = { key: prof.key, version: prof.catalogVersion };
      return [
        { ...common, chain: `drsv${nn}`, sequential: false,
          stageIds: VERSION_STAGE_IDS.filter((id) => id !== 'draft-autosave' && (id !== 'dependency' || prof.dependencyChain)) },
        { ...common, chain: `drsv${nn}d`, sequential: true, stageIds: ['draft-autosave'] },
      ];
    });
  } catch {
    return [];
  }
}

module.exports = { buildDrsSmokeProfile, currentDrsSmokeKey, buildVersionSmokeProfile, currentVersionSmokeChains, VERSION_STAGE_IDS };
