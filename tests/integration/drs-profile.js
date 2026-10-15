const { environmentKey } = require('../config/environments');
const state = require('../drs/utils/drs-state');

// THE INTEGRATION PROFILE — a smoke-shaped profile (tests/config/projects.js)
// built from what the DRS setup chain recorded, so the existing Pulse helpers
// (createSmokeUser, ensureWorkAreaMapping, createAndSubmitCheckpoint, the NC
// page objects) run unchanged on OUR project. docs/drs-pulse-integration.md §9.
//
// Only the fields those helpers read are filled in; everything else a smoke
// profile carries (featureGround, lanes, viewports …) is deliberately absent.
//
// PAIRING GUARD (docs §2): the project must have been written by a DRS env
// declared as paired with this run's PULSE_ENV, or this throws by name —
// otherwise a drs-dev project would be looked for in a Pulse it never synced to,
// and every step would fail as "not found" for the wrong reason.

const DRS_ENV = String(process.env.DRS_ENV || 'uat').trim().toLowerCase();
const READY_STAGE = 'D8'; // SO Configuration — "ready for Pulse" (docs, Phase 1 as built)

// Role prefixes are integration-only so they can never collide with the smoke
// profiles' CISL/EESL/QISL or the batch spec's bare keys in last-created-users.
// PM / EL / QL added 2026-10-08: NC creation opened up to the Project Manager,
// Execution Lead and Quality Lead (alongside QI and EE), so the NC matrix needs
// one user of each. They are creators only — they carry no flow step.
// CIE added 2026-10-15: the Electrical package has its own vendor + SO (DRS D01/D04),
// so it has its own Contractor Incharge, a VENDOR user of the Electrical vendor.
// EE and QI are shared across packages (app owner).
const PREFIXES = { CI: 'CIDRS', CIE: 'CIEDRS', EE: 'EEDRS', QI: 'QIDRS', PM: 'PMDRS', EL: 'ELDRS', QL: 'QLDRS' };

function drsProject() {
  const env = state.envRecord(DRS_ENV);
  const tag = process.env.DRS_PROJECT_TAG;
  const projects = (env.projects || []).filter((p) => (p.stagesDone || []).includes(READY_STAGE));
  const project = tag ? projects.find((p) => p.tag === tag) : projects[projects.length - 1];
  if (!project) {
    throw new Error(
      `No DRS project ready for Pulse (stage ${READY_STAGE} done) on drs-${DRS_ENV}` +
      `${tag ? ` with tag ${tag}` : ''} — run \`npm run drs:setup\` first.`
    );
  }
  const pulseKey = environmentKey();
  if (!(project.pairedPulse || []).includes(pulseKey)) {
    throw new Error(
      `DRS project ${project.name} was made on drs-${DRS_ENV}, which syncs to pulse-` +
      `[${(project.pairedPulse || []).join(', ')}], but this run targets pulse-${pulseKey}. ` +
      'Set PULSE_ENV to a paired environment (tests/config/drs-environments.js).'
    );
  }
  return { env, project, pulseKey };
}

function drsIntegrationProfile() {
  const { env, project, pulseKey } = drsProject();
  const blocks = project.workAreas.filter((wa) => /^BL\d+$/i.test(wa));
  if (blocks.length < 2) {
    throw new Error(`${project.name} has ${blocks.length} BL work area(s); RFI and NC need one each`);
  }
  // Disjoint ground (docs §9, smoke rule R2): a non-approved NC blocks RFI on
  // the same (checkpoint, work section), so RFI and NC never share an area.
  //   BL01 / BL02 — the single-cycle proof (IN03 / IN04)
  //   BL03 + BL04 — the full 9-TC RFI matrix (IN05); solar is many sections
  //                 per area, so two areas is headroom, not a need
  //   BL05        — the full 4-TC NC matrix (IN06)
  //   BL06+       — free for feature specs
  // A project with fewer blocks (the first, 2-BL one) runs the matrices on the
  // cycle areas instead.
  const [rfiArea, ncArea] = blocks;
  const big = blocks.length >= 5;
  const matrix = {
    rfi: big ? [blocks[2], blocks[3]] : [rfiArea],
    nc: big ? [blocks[4]] : [ncArea],
  };
  const groundAreas = [...new Set([rfiArea, ncArea, ...matrix.rfi, ...matrix.nc])];
  const so = project.serviceOrder.number;
  // One vendor + SO per package (DRS D01/D04, 2026-10-15); older projects have the
  // Civil one only.
  const vendorEntry = (v, number) => v && number && {
    category: 'Service Contractor',
    name: v.name,
    serviceOrder: `${number} - ${v.name}`,
    serviceOrderCandidates: [`${number} - ${v.name}`, number],
  };
  const electricalSo = project.serviceOrders && project.serviceOrders.Electrical;
  const vendors = {
    Civil: vendorEntry(env.vendor, so),
    ...(electricalSo && env.vendorElectrical ? { Electrical: vendorEntry(env.vendorElectrical, electricalSo.number) } : {}),
  };

  return {
    // The tag is part of the key so every DRS project gets its OWN tracker
    // files (smoke-tracker names them by profile key) and never resumes another
    // project's half-run matrix.
    key: `drs-solar-${project.tag}`,
    workSectionGranularity: 'many-per-work-area',
    matrix,
    groundAreas,
    label: `DRS integration — ${project.name}`,
    tier: 'integration',
    projectType: 'SOLAR',
    cluster: [project.cluster],
    site: project.site,
    workLocations: [project.workLocation],
    packages: ['Civil'],
    // Pulse renders SOs as "<number> - <VENDOR>"; the bare number is the
    // fallback candidate (WAM's Service Order is an Ark combobox, substring).
    vendor: vendors.Civil,
    vendors,
    users: {
      source: 'created',
      order: ['CI', 'EE', 'QI', 'PM', 'EL', 'QL', ...(vendors.Electrical ? ['CIE'] : [])],
      // RFI/NC flow actors only. PM/EL/QL are NC creators, mapped by IN06's own
      // prerequisite (ensureWorkAreaMapping) rather than the chain's SM03.
      flowRoles: ['CI', 'EE', 'QI'],
      prefixes: PREFIXES,
      roles: {
        [PREFIXES.CI]: { role: 'Contractor Incharge', userType: 'VENDOR' },
        [PREFIXES.CIE]: { role: 'Contractor Incharge', userType: 'VENDOR' },
        [PREFIXES.EE]: { role: 'Execution Engineer', userType: 'AGEL' },
        [PREFIXES.QI]: { role: 'Quality Inspector', userType: 'AGEL' },
        [PREFIXES.PM]: { role: 'Project Manager', userType: 'AGEL' },
        [PREFIXES.EL]: { role: 'Execution Lead', userType: 'AGEL' },
        [PREFIXES.QL]: { role: 'Quality Lead', userType: 'AGEL' },
      },
    },
    // The proven solar Piling RFI combination (projects.js SOLAR_E2E.rfi), on
    // our Work Area. v1 keeps every Pulse package as-is (app owner), so the
    // checkpoint and checklist names are unchanged.
    rfi: {
      workLocation: project.workLocation,
      workArea: rfiArea,
      package: 'Civil',
      subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
      activity: 'Piling - MMS',
      workSection: null,
      rfiQuantity: null,
      unit: null,
      subContractor: null,
      checkpointChain: [{
        subActivity: 'Piling - MMS',
        checkpoint: 'Pre Pour Inspection - Pile',
        checklist: 'Micro Pile Checklist',
      }],
    },
    // The proven NC combination (projects.js SOLAR_E2E.nc) on our Work Area,
    // with our vendor.
    nc: {
      workLocation: project.workLocation,
      workArea: ncArea,
      vendorName: 'AUTOMATION SERVICE',
      package: 'Civil',
      activity: 'Piling - Robotic Docking System',
      subActivity: 'Piling - Robotic Docking System',
      workSectionCount: 2,
      ncQuantity: 2,
      unit: 'EA',
      defectType: '__first__',
      category: 'Critical',
      targetDateClosureDays: 14,
    },
    drs: { env: DRS_ENV, tag: project.tag, project, pulseKey },
  };
}

// The profile as one PACKAGE sees it: that package's vendor + SO (WAM's Service
// Order filter, a VENDOR user's vendor) and `packages: [pkg]` (WAM's Package
// filter). And the CI role key of that package: CI (Civil), CIE (Electrical).
function packageProfile(profile, pkg) {
  const vendor = (profile.vendors && profile.vendors[pkg]) || null;
  if (!vendor) throw new Error(`${profile.drs.project.name} has no ${pkg} vendor/SO - run DRS D01 + D04 (one SO per package)`);
  return { ...profile, packages: [pkg], vendor };
}
const ciRoleFor = (pkg) => (pkg === 'Electrical' ? 'CIE' : 'CI');

// For SPEC FILES: never throws at file-load time. Playwright loads every spec
// for `--list` or an unfiltered run, and a pairing/state error thrown during
// collection crashed the WHOLE suite's listing (caught 2026-09-26: a plain
// `npx playwright test --list` on PULSE_ENV=test died in IN06). Instead this
// returns a stub carrying `unavailable` — safe for test titles — and each test
// throws that reason when it actually runs.
function profileForSpec() {
  try {
    return drsIntegrationProfile();
  } catch (err) {
    const na = '(unavailable)';
    return {
      unavailable: err.message,
      key: 'drs-unavailable',
      groundAreas: [na], matrix: { rfi: [na], nc: [na] },
      rfi: { workArea: na }, nc: { workArea: na },
      drs: { project: { name: na } },
    };
  }
}

function requireAvailable(profile) {
  if (profile.unavailable) throw new Error(profile.unavailable);
}

// Records Pulse-side results on the DRS project, so one record holds the whole
// DRS → Pulse story of a project.
function recordPulse(profile, patch) {
  const current = (state.envRecord(profile.drs.env).projects || [])
    .find((p) => p.tag === profile.drs.tag) || {};
  const pulse = { ...(current.pulse || {}), env: profile.drs.pulseKey, ...patch };
  return state.upsertProject(profile.drs.env, profile.drs.tag, { pulse });
}

function recordedPulse(profile) {
  const p = (state.envRecord(profile.drs.env).projects || []).find((x) => x.tag === profile.drs.tag);
  return (p && p.pulse) || {};
}

// THE users every DRS integration stage acts as: the NEWEST batch recorded for
// this profile key on this Pulse deployment (tests/fixtures/last-created-users
// .json) — the same accounts the `smoke-drs-*` chain uses — falling back to the
// ones IN01 recorded on the DRS project.
//
// One user set, not two (2026-09-26): IN01 and the chain's SM01 had each made
// their own CI/EE/QI for the same project, and both suites WAM-map onto the same
// single-assignee rows (BL01, BL03, BL05), so each run evicted the other's
// CI/QI. Sharing the newest batch removes the tug-of-war.
function drsUsers(profile, roles = ['CI', 'EE', 'QI']) {
  const { inspectSmokeUsers } = require('../utils/smoke-users');
  const fromStore = (() => {
    try { return inspectSmokeUsers(profile, roles); } catch { return null; }
  })();
  const recorded = recordedPulse(profile).users || {};
  const out = {};
  for (const r of roles) {
    out[r] = (fromStore && fromStore.users && fromStore.users[r]) || recorded[r] || null;
  }
  return out;
}

module.exports = {
  drsIntegrationProfile, profileForSpec, requireAvailable, recordPulse, recordedPulse, drsUsers, PREFIXES,
  packageProfile, ciRoleFor,
};
