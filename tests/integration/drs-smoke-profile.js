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
  if (requestedKey && requestedKey !== base.key) {
    throw new Error(`DRS smoke profile "${requestedKey}" asked for, but the newest ready DRS ` +
      `project is "${base.key}". Set DRS_PROJECT_TAG to pin an older project.`);
  }
  if (cached && cached.key === base.key) return cached;

  const p = base.drs.project;
  const blocks = p.workAreas.filter((wa) => /^BL\d+$/i.test(wa));
  const need = 13;
  if (blocks.length < need) {
    throw new Error(`${p.name} has ${blocks.length} BL work areas; the full smoke chain needs ${need} ` +
      '(run `DRS_WORK_AREAS=13 npm run drs:setup`).');
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

module.exports = { buildDrsSmokeProfile, currentDrsSmokeKey };
