// Checkpoint/checklist reference data for the Activity Dependency chain
// spec (29_rfi_activity_dependency.spec.js), sourced from
// tests/fixtures/Activity Master and Checklist Mapping_Solar (1).xlsx
// (sheet "Activity-Checklist_06.05.2026", rows 6-20) and confirmed live
// against the real Inspection Checkpoint / Inspection Checklist dropdowns
// (00_inspect_rfi_dependency_checkpoints.spec.js for Piling - MMS;
// 00_inspect_rfi_piling_activities.spec.js for the other two).
//
// Scope: only the first THREE checkpoints of each Piling activity's
// five-checkpoint sequence — Pre Pour Inspection - Pile -> Pre Pour
// Inspection - Pile Cap -> Post Pour Inspection. These three have a clean,
// linear "Preceding Inspection Checkpoint" (spreadsheet column S) and
// exactly ONE Inspection Checklist option each. The remaining two
// (Epoxy Coating, Routine Testing) are deliberately OUT of scope for now:
// - Epoxy Coating's own "Preceding Inspection Checkpoint" is "-" (none
//   listed) in the spreadsheet — its dependency (if any) isn't confirmed.
// - Routine Testing's checklist dropdown renders something clearly
//   non-standard live (it lists checkpoint names, not checklist options —
//   confirmed via 00_inspect_rfi_dependency_checkpoints.spec.js), and the
//   spreadsheet separately notes it as "No Checklist; only testing report
//   to be uploaded" — a UI pattern this suite doesn't support yet.
// Both would need their own dedicated investigation before being added
// here — not silently assumed to follow the same linear-chain pattern.
//
// Same Work Location/Package/Sub-Package as the rest of the suite's
// Piling - MMS data (RFI_DATA in rfi-flow-turns.js) — the spreadsheet
// confirms this context is identical across all three Piling activities,
// only Activity/Sub-Activity differ. Work Area is DELIBERATELY different
// from RFI_DATA's BL02 (under constant churn from the tracked 9-TC
// regression + ad-hoc integrity specs, 08-10/21/23/24, all targeting that
// exact same checkpoint).
//
// BL05 was tried first and hit a real, confirmed-live snag: a Work
// Section already used for one checkpoint of an activity can disappear
// from a DIFFERENT checkpoint's own Work Section list too (screenshot
// evidence — option cleanly skipped, not a rendering artifact; survived a
// fresh relogin, so not the session/cookie "stale Work Section" glitch
// either). App owner confirmed live: this Work Area already had RFIs
// raised against some of its Work Sections from unrelated prior testing —
// a purely random pick can collide with those. BL09 is a block/Work Area
// confirmed to have NO RFIs raised against it yet, sidestepping the
// problem entirely rather than needing to verify availability across all
// three checkpoints before every run.
const COMMON = {
  workLocation: 'A-06c',
  workArea: 'BL09',
  package: 'Civil',
  subPackage: 'Piling (MMS, Inverter, LT Cable Hangers)',
};

// Identical checkpoint/checklist names across all three activities
// (spreadsheet rows 6-8, 11-13, 16-18 are byte-identical in columns
// O/R apart from the Activity/Sub-Activity columns).
const CHECKPOINTS = [
  { name: 'Pre Pour Inspection - Pile', checklist: 'Micro Pile Checklist' },
  { name: 'Pre Pour Inspection - Pile Cap', checklist: 'Micro Pile Cap Checklist' },
  { name: 'Post Pour Inspection', checklist: 'Post Pour Check' },
];

const PILING_ACTIVITY_CHAINS = [
  {
    label: 'Piling - MMS',
    ...COMMON,
    activity: 'Piling - MMS',
    subActivity: 'Piling - MMS',
    checkpoints: CHECKPOINTS,
  },
  {
    label: 'Piling - Inverter',
    ...COMMON,
    activity: 'Piling - Inverter',
    subActivity: 'Piling - Inverter',
    checkpoints: CHECKPOINTS,
  },
  {
    label: 'Piling - LT Cable Hanger System',
    ...COMMON,
    activity: 'Piling - LT Cable Hanger System',
    subActivity: 'Piling - LT Cable Hanger System',
    checkpoints: CHECKPOINTS,
  },
];

// "IDT Civil & Structural" / Sub-Activity "IDT Civil & Structural - Cable
// Rack" — confirmed live (00_inspect_rfi_idt_civil_structural.spec.js)
// and via the spreadsheet (rows 38-40, checkpoint codes A.2.3.1-3) to have
// the EXACT SAME 3-checkpoint chain and checklist names as the Piling
// activities above (byte-identical: "Pre Pour Inspection - Pile" ->
// "Pre Pour Inspection - Pile Cap" -> "Post Pour Inspection", checklists
// "C_14_1 Micro Pile Checklist" / "C_14_2 Micro Pile Cap Checklist" /
// "C_8_Post Pour Check", stripped of their code prefixes to match the
// live dropdown text — the "Min. Unit of RFI" column is "Block" here
// though, not "Per Table"/"Per Inverter", which is WHY its Work Section
// behaves differently (see below). Nested under the SAME sub-package as
// the Piling activities, just with the longer combined name
// "Piling (MMS, Inverter, LT Cable Hangers) + IDT Civil & Structural" —
// COMMON's shorter "Piling (MMS, Inverter, LT Cable Hangers)" string
// still matches it fine (selectOption() does a substring filter).
//
// Its Work Section granularity is at the whole WORK AREA level — exactly
// ONE Work Section option, literally the Work Area's own name (confirmed
// live: selecting Work Area "BL09" makes "BL09" the only Work Section
// option). That single option gets permanently consumed by a mere
// selection (same bug as the Piling activities — confirmed live via
// 00_inspect_rfi_cancel_confirm_releases_section.spec.js: even Cancel +
// confirming the resulting popup did not release it), so the
// throwaway-Work-SECTION strategy above doesn't apply — there's nothing
// else to sacrifice within one Work Area. Instead this uses TWO Work
// AREAS: `throwawayWorkArea` (BL09 — already known to have some
// consumed-but-harmless history from investigation) sacrificed for every
// blocked-attempt check, and `realWorkArea` (BL10 — a different, as-yet
// untouched-by-this-activity Work Area) for the real chain. See
// runDependencyChainForScarceWorkSectionActivity() in rfi-dependency-flow.js.
const SCARCE_WORK_SECTION_COMMON = {
  workLocation: 'A-06c',
  package: 'Civil',
  subPackage: 'Piling (MMS, Inverter, LT Cable Hangers) + IDT Civil & Structural',
  activity: 'IDT Civil & Structural',
  // Same throwaway/real Work Area pair reused across every scarce-Work-
  // Section chain below — safe because consumption is scoped per
  // (Activity/Sub-Activity/Checkpoint/Work Section), so a different
  // Sub-Activity's checkpoints are untouched by another's history in the
  // same Work Area (confirmed live: BL09/BL10 already carry history from
  // "Cable Rack" but "HT / LT Platform" got a clean, unconsumed
  // "Pre Pour Inspection - Pile" + BL10 combo).
  throwawayWorkArea: 'BL09',
  realWorkArea: 'BL10',
};

// Sub-Activity "IDT Civil & Structural - Cable Rack" — confirmed live
// (00_inspect_rfi_idt_civil_structural.spec.js) and via the spreadsheet
// (rows 38-40, checkpoint codes A.2.3.1-3) to have the EXACT SAME
// 3-checkpoint chain and checklist names as the Piling activities above
// (byte-identical: "Pre Pour Inspection - Pile" -> "Pre Pour Inspection -
// Pile Cap" -> "Post Pour Inspection", checklists "C_14_1 Micro Pile
// Checklist" / "C_14_2 Micro Pile Cap Checklist" / "C_8_Post Pour Check",
// stripped of their code prefixes to match the live dropdown text).
const IDT_CIVIL_STRUCTURAL_CABLE_RACK_CHAIN = {
  ...SCARCE_WORK_SECTION_COMMON,
  label: 'IDT Civil & Structural - Cable Rack',
  subActivity: 'IDT Civil & Structural - Cable Rack',
  checkpoints: CHECKPOINTS,
};

// Sub-Activity "IDT Civil - HT / LT Platform" — a DIFFERENT, longer
// 6-checkpoint chain per the spreadsheet (rows 21-26, codes B1.1.1-6),
// not the same 3 as Cable Rack past checkpoint 2. Its first two
// checkpoints' checklist column (R) reads as a CONDITIONAL choice ("If
// Open Foundation: ... / If Micropiling Foundation: ...") — but confirmed
// live (00_inspect_rfi_idt_ht_lt_platform.spec.js) that only ONE checklist
// option ever renders in the actual dropdown (this environment/instance
// consistently resolves to the "Micropiling Foundation" checklists) — so
// despite the spreadsheet's conditional text, there's no real "pick any
// one of several" UI choice to exercise here after all. Scoped to the
// first 3 of its 6 checkpoints, matching the same "clean, unconditional,
// single-checklist, linearly-dependent" selection principle used
// elsewhere in this file — checkpoint 3 here is "Pre Pour Inspection for
// Column & Slab - Cast-in-Situ" / "Pour Card" (NOT "Post Pour Inspection"
// — confirmed via the spreadsheet's S column, row 23's Preceding =
// B1.1.2, i.e. still directly depends on checkpoint 2 / Pile Cap).
const IDT_CIVIL_HT_LT_PLATFORM_CHECKPOINTS = [
  { name: 'Pre Pour Inspection - Pile', checklist: 'Micro Pile Checklist' },
  { name: 'Pre Pour Inspection - Pile Cap', checklist: 'Micro Pile Cap Checklist' },
  { name: 'Pre Pour Inspection for Column & Slab - Cast-in-Situ', checklist: 'Pour Card' },
];

const IDT_CIVIL_HT_LT_PLATFORM_CHAIN = {
  ...SCARCE_WORK_SECTION_COMMON,
  label: 'IDT Civil - HT / LT Platform',
  subActivity: 'IDT Civil - HT / LT Platform',
  checkpoints: IDT_CIVIL_HT_LT_PLATFORM_CHECKPOINTS,
};

const SCARCE_WORK_SECTION_CHAINS = [
  IDT_CIVIL_STRUCTURAL_CABLE_RACK_CHAIN,
  IDT_CIVIL_HT_LT_PLATFORM_CHAIN,
];

module.exports = {
  PILING_ACTIVITY_CHAINS,
  CHECKPOINTS,
  IDT_CIVIL_STRUCTURAL_CABLE_RACK_CHAIN,
  IDT_CIVIL_HT_LT_PLATFORM_CHAIN,
  SCARCE_WORK_SECTION_CHAINS,
};
