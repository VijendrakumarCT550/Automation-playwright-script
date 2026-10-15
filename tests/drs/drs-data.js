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

  // D2 — the app owner's own SPV on drs-uat (2026-09-26: "use VIJESPV that I
  // created"). Verified to exist, never created.
  spv: 'VIJESPV',

  // D3 — docs/drs-pulse-integration.md §4: a dedicated Site under the existing
  // Rajasthan cluster, so our hierarchy never mixes with Test Site's.
  cluster: 'Rajasthan',
  site: 'AUTOMATION SITE',

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
  // version ("EA - Piling - MMS — Solar · All sites v2 — VER-ALL-V2" ...). Each
  // version gets its OWN Work Area with its own Work Sections; the BL areas stay on
  // `catalogOptionLabel`, because the Pulse integration suites run on BL ground only
  // (tests/integration/drs-profile.js filters /^BL\d+$/).
  // The AUTOMATION SITE versions are made + locked by
  // tests/drs-setting/catalog_site_versions.spec.js - run it first. A version must be
  // LOCKED to be pinned (catalog guide 11.2).
  versionAreas: [
    { name: 'VER-ALL-V2', version: 'All sites v2', sections: 60 },
    { name: 'VER-SITE-V1', version: 'AUTOMATION SITE v1', sections: 60 },
    { name: 'VER-SITE-V2', version: 'AUTOMATION SITE v2', sections: 60 },
  ],
};

// The version label a Work Area is pinned to: its versionAreas entry, else the
// default ("All sites v1").
module.exports.versionFor = (workArea) => {
  const v = module.exports.versionAreas.find((a) => a.name === workArea);
  return v ? v.version : module.exports.catalogOptionLabel;
};

// The distinct versions a run's Work Areas are pinned to, default first:
// ["All sites v1", "All sites v2", "AUTOMATION SITE v1", "AUTOMATION SITE v2"].
module.exports.runVersions = (workAreas) => [...new Set(workAreas.map(module.exports.versionFor))];

// ONE SO LINE PER CATALOG VERSION (app owner, 2026-10-15; docs/drs-catalog-versions-
// and-so-lines.md §8). A WMC covers ONE version (DRS refuses a WMC over Work Areas on
// different versions), so each line is mapped to one version's sub-activities only.
// Line i -> number (i+1)*10, service item (i+1)*10.
module.exports.soLinesFor = (workAreas) => module.exports.runVersions(workAreas).map((version, i) => ({
  lineNumber: (i + 1) * 10, serviceItemNo: (i + 1) * 10, quantity: 100, actualQty: 100, priceUnit: 1, uom: 'EA', version,
}));
