// Fixed master data for the DRS setup chain (docs/drs-pulse-integration.md).
// Created ONCE per DRS environment and reused — never per run.

module.exports = {
  // D1 — our own service contractor. Vendors have no edit and no delete, so
  // the name is the identity: found by name, created only if absent.
  vendor: {
    name: 'AUTOMATION SERVICE CONTRACTOR',
    // Dummy but format-valid GSTIN (app owner, 2026-09-26): 2-digit state code
    // (24 = Gujarat) + 10-char PAN + entity digit + 'Z' + check character.
    gst: '24AABCA1234F1Z5',
    // The code is generated once (99xxxx, a range no real vendor on drs-uat
    // uses) and then read back from the state file / the vendor list.
    codePrefix: '99',
  },

  // ONE VENDOR PER PACKAGE (app owner, 2026-10-15): Civil work goes to `vendor`
  // above, Electrical to its own contractor, each with its own SO (D04) and, in
  // Pulse, its own CI (EE and QI are shared across packages). Same find-or-create
  // rule as `vendor`. The GSTIN is format-valid with a correct check character
  // (DRS checks the format only: the Civil one's check character is not the
  // checksum's and was accepted).
  vendorElectrical: {
    name: 'AUTOMATION ELECTRICAL CONTRACTOR',
    gst: '24AABCA5678G1ZP',
    codePrefix: '99',
  },

  // D2 — the app owner's own SPV on drs-uat (2026-09-26: "use VIJESPV that I
  // created"). Verified to exist, never created.
  spv: 'VIJESPV',

  // D3 — docs/drs-pulse-integration.md §4: a dedicated Site under the existing
  // Rajasthan cluster, so our hierarchy never mixes with Test Site's.
  // RENAMED 2026-10-15 (app owner): "AUTOMATION SITE" -> "Automation Site 01".
  // A UAT redeploy deleted the first AUTOMATION SITE in DRS, but Pulse kept it (its
  // uuid never got the delete), so after D01 recreated it Pulse listed TWO
  // "AUTOMATION SITE"s. Renaming OUR site (same uuid, so its catalog chain and
  // projects stay) makes it distinct in Pulse. D01 renames a site still carrying a
  // `siteFormerNames` entry instead of creating a new one.
  cluster: 'Rajasthan',
  site: 'Automation Site 01',
  siteFormerNames: ['AUTOMATION SITE'],

  // D4 — project defaults (app owner: solar only for now).
  project: {
    type: 'Solar',
    category: 'Merchant',
    constructionBy: 'EPC',
  },

  // D7 — package catalog version (app owner: v1 keeps every Pulse package as is).
  // `catalogVersion` is what the tree BADGE reads ("v1"); `catalogOptionLabel` is
  // what the Catalog version DROPDOWN offers. Since 2026-10-01 the dropdown labels
  // are scoped - "All sites v4 / v3 / v2 / v1" - because a catalog version belongs
  // to a project type + a site scope (see tests/drs-setting).
  // Our AUTOMATION SITE has no catalog of its own, so it falls back to the
  // type-wide "All sites" ones; app owner: pin "All sites v1". A site with its
  // own catalog would list e.g. "Khavda v1" instead.
  catalogVersion: 'v1',
  catalogOptionLabel: 'All sites v1',

  // CATALOG-VERSION WORK AREAS (app owner, 2026-10-15). The project carries more
  // than one catalog version, so SO Configuration and SO Line Mapping get exercised
  // per version, and the line-mapping picker shows the same sub-activity once per
  // version ("EA - Piling - MMS — Solar · All sites v2 — BL03 AS-v2" ...). Each
  // version gets its OWN Work Area with its own Work Sections; the plain BL areas
  // stay on `catalogOptionLabel`, because the Pulse integration suites run on plain
  // BL ground only (tests/integration/drs-profile.js filters /^BL\d+$/).
  //
  // NAMING (app owner, 2026-10-15): "BL<nn> AS-v<n>" = All sites v<n>,
  // "BL<nn> S-v<n>" = <site> v<n> (AS = all sites, S = site version). <nn> continues
  // after the run's plain BL areas (D02), so with 2 BLs: BL03 AS-v2, BL04 S-v1,
  // BL05 S-v2. The NAME carries the version, so versionFor() reads it back from it.
  // Project AUTO-Solar-15102026-SNP still has the first names (VER-ALL-V2,
  // VER-SITE-V1, VER-SITE-V2) - kept readable through LEGACY_VERSION_AREAS.
  // The site versions are made + locked by tests/drs-setting/catalog_site_versions
  // .spec.js - run it first. A version must be LOCKED to be pinned (guide 11.2).
  versionAreas: [
    { tag: 'AS-v2', sections: 60 },
    { tag: 'S-v1', sections: 60 },
    { tag: 'S-v2', sections: 60 },
  ],
};

const LEGACY_VERSION_AREAS = { 'VER-ALL-V2': 'AS-v2', 'VER-SITE-V1': 'S-v1', 'VER-SITE-V2': 'S-v2' };
const VERSION_AREA_RE = /^BL\d+ (AS|S)-v(\d+)$/;

// "AS-v2" -> "All sites v2"; "S-v1" -> "<site> v1" (the site's CURRENT name).
function versionOfTag(tag) {
  const m = String(tag).match(/^(AS|S)-v(\d+)$/);
  if (!m) return null;
  return m[1] === 'AS' ? `All sites v${m[2]}` : `${module.exports.site} v${m[2]}`;
}

// The catalog-version tag of a Work Area name ("BL04 S-v1" -> "S-v1"), or null for
// a plain area.
function versionTagOf(workArea) {
  if (LEGACY_VERSION_AREAS[workArea]) return LEGACY_VERSION_AREAS[workArea];
  const m = String(workArea).match(VERSION_AREA_RE);
  return m ? `${m[1]}-v${m[2]}` : null;
}

// The Work Area names D02 gives the version areas when the run has `blCount` plain
// BLs: [{ name: 'BL03 AS-v2', sections: 60 }, ...].
//
// With `envRecord`, the SITE-version areas follow the catalog records instead of the
// fixed list: one "S-v<n>" area per LOCKED site version the catalog spec recorded
// (S1..S3 ... - each catalog run adds one, app owner 2026-10-15), so a new project
// always pins every site version, the newest included.
module.exports.versionAreaNames = (blCount, envRecord) => {
  let areas = module.exports.versionAreas;
  if (envRecord) {
    const chain = ((envRecord.catalogs || {})[module.exports.site]) || {};
    const siteTags = Object.values(chain).filter((c) => c.status === 'locked')
      .map((c) => (String(c.label).match(/ v(\d+)$/) || [])[1]).filter(Boolean)
      .map(Number).sort((a, b) => a - b).map((n) => ({ tag: `S-v${n}`, sections: 60 }));
    if (siteTags.length) areas = [...areas.filter((a) => !a.tag.startsWith('S-')), ...siteTags];
  }
  return areas.map((a, i) => ({ name: `BL${String(blCount + i + 1).padStart(2, '0')} ${a.tag}`, sections: a.sections }));
};

module.exports.isVersionArea = (workArea) => Boolean(versionTagOf(workArea));
module.exports.isSiteVersionArea = (workArea) => /^S-/.test(versionTagOf(workArea) || '');

// The version label a Work Area is pinned to: read from its name, else the
// default ("All sites v1").
module.exports.versionFor = (workArea) => {
  const tag = versionTagOf(workArea);
  return tag ? versionOfTag(tag) : module.exports.catalogOptionLabel;
};

// The sub-package codes a SITE catalog version carries for one package, from the
// catalog records tests/drs-setting/catalog_site_versions.spec.js wrote into the
// state file's env record (inherited first, then its own):
//   catalogCodes(env, 'Automation Site 01 v2', 'Civil') -> ['PC01', 'QC01', 'PC02', 'QC02']
// [] for a version we did not build (All sites v1/v2) or one not locked yet.
module.exports.catalogCodes = (envRecord, version, pkg) => {
  const chain = ((envRecord && envRecord.catalogs) || {})[module.exports.site] || {};
  const rec = Object.values(chain).find((c) => c.label === version && c.status === 'locked');
  if (!rec) return [];
  return [...((rec.inheritedCodes || {})[pkg] || []), ...((rec.codes || {})[pkg] || [])];
};

// The distinct versions a run's Work Areas are pinned to, default first:
// ["All sites v1", "All sites v2", "Automation Site 01 v1", "Automation Site 01 v2"].
module.exports.runVersions = (workAreas) => [...new Set(workAreas.map(module.exports.versionFor))];

// ---- SERVICE ORDERS AND THEIR LINES (app owner, 2026-10-15) ---------------------
// docs/drs-so-lines-and-service-codes.md (the shared reference).
//   R1 ONE SO PER PACKAGE: Civil -> `vendor`, Electrical -> `vendorElectrical`.
//   R2 ONE CATALOG VERSION PER LINE: a WMC covers one version.
//   R3 STANDARD sub-activities are grouped by their SERVICE CODE, as the BBU mapping
//      (Downloads/"PULSE RFI to BBU service code mapping - Solar v2 1.xlsx") says:
//      one line per (code, version), the code in the line's Activity Code.
//   R4 OUR OWN new sub-activities (PC0n/QC0n/PE0n/QE0n) go AT MOST 2 per line.
// Line numbers run 10, 20, 30 ... per SO.
module.exports.maxSubActivitiesPerLine = 2;
module.exports.SO_PACKAGES = ['Civil', 'Electrical'];

// R5 (app owner, 2026-10-15): the codes are mapped in the Service Configurator to
// the ALL SITES V1 catalog only, so a line carries the code (Activity Code) only for
// that version - there DRS auto-populates the group. Lines of other versions get the
// same grouping WITHOUT a code, and step 5 (D06) maps their sub-activities by hand.
// (A code on more than one line of the same SO is not auto-populated either.)
module.exports.SERVICE_CODE_VERSION = 'All sites v1';

// R3: the standard groups this chain maps (Mapping_08-07-26). `activities` are the
// SO Configuration rows (D05); `subActivities` the step-5 names (each standard
// activity has one sub-activity of the same name).
module.exports.SERVICE_CODE_GROUPS = [
  {
    code: '120021756', name: 'Piling (excluding Robot Piling)', package: 'Civil',
    search: 'Piling', // Service Configurator search term listing the whole group
    activities: ['Piling - MMS', 'Piling - Inverter', 'Piling - LT Cable Hanger System'],
    subActivities: ['Piling - MMS', 'Piling - Inverter', 'Piling - LT Cable Hanger System'],
  },
  {
    code: '120036457', name: 'Robot, docking, reverse station, dummy structure incl Piling', package: 'Civil',
    // The BBU workbook's "Installation of docking & reverse stations" is, in the DRS
    // catalog, activity "Robot Structure Installation" / sub-activity "Installation
    // of binders/clips, bridges, docking & reverse stations" (inspection round 17).
    activities: ['Piling - Robotic Docking System', 'Robot Structure Installation'],
    subActivities: ['Piling - Robotic Docking System', 'Installation of binders/clips, bridges, docking & reverse stations'],
  },
];

// R4: our catalog's own sub-activities for one version + package, in tree order
// ("PC01.1.1 Sub Activity" ...; tests/drs-setting/pc-data.js buildTree, the builder
// that created them).
module.exports.ownSubActivities = (envRecord, version, pkg) => {
  const { buildTree } = require('../drs-setting/pc-data');
  return module.exports.catalogCodes(envRecord, version, pkg)
    .flatMap((c) => buildTree(c).activities.flatMap((a) => a.subActivities.map((s) => s.name)));
};

// The SO plan for a run: { Civil: [line ...], Electrical: [line ...] }, a line =
// { lineNumber, serviceItemNo, quantity, actualQty, priceUnit, uom, version, package,
//   group (the service code a standard line is grouped by), serviceCode (only where
//   it goes in Activity Code - All sites v1), subActivities: [names] }.
// A package with nothing to map gets no SO.
module.exports.soPlan = (envRecord, workAreas) => {
  const plan = {};
  for (const pkg of module.exports.SO_PACKAGES) {
    const lines = [];
    const add = (version, extra) => {
      const n = (lines.length + 1) * 10;
      lines.push({ lineNumber: n, serviceItemNo: n, quantity: 100, actualQty: 100, priceUnit: 1, uom: 'EA', version, package: pkg, ...extra });
    };
    for (const version of module.exports.runVersions(workAreas)) {
      for (const g of module.exports.SERVICE_CODE_GROUPS.filter((x) => x.package === pkg)) {
        add(version, {
          group: g.code, subActivities: [...g.subActivities],
          ...(version === module.exports.SERVICE_CODE_VERSION ? { serviceCode: g.code } : {}),
        });
      }
      const own = module.exports.ownSubActivities(envRecord, version, pkg);
      for (let i = 0; i < own.length; i += module.exports.maxSubActivitiesPerLine) {
        add(version, { subActivities: own.slice(i, i + module.exports.maxSubActivitiesPerLine) });
      }
    }
    if (lines.length) plan[pkg] = lines;
  }
  return plan;
};

// Kept for projects made before 2026-10-15 15:00 (one SO, one line per version).
module.exports.soLinesFor = (workAreas) => module.exports.runVersions(workAreas).map((version, i) => ({
  lineNumber: (i + 1) * 10, serviceItemNo: (i + 1) * 10, quantity: 100, actualQty: 100, priceUnit: 1, uom: 'EA', version,
}));
