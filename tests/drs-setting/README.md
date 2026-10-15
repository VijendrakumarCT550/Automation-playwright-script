# DRS Setting → Package Configurator

Catalog-setup specs for the DRS **Packages Configurator**
(`/appSettings/packagesConfigurator?projectType=solar`).

**Status 2026-10-01: `package_configurator_electrical_hierarchy.spec.js` is written but has NOT run
against the live app yet** — it was built from the runbook. The app owner fixes a
DRS issue before the first **build**; the read-only **verify** mode can run any time
and is also how the locators get proven.

This folder is a sibling of `tests/drs/` (the DRS *project* setup D01–D06) on
purpose: that suite builds a project on top of a catalog; this one builds the
catalog itself. Keep them separate.

## Read first

- [`RUNBOOK.md`](RUNBOOK.md) — the app owner's step-by-step runbook (copied from
  `Downloads/DRS_Packages_Configurator_Hierarchy_Runbook_2 final revision.md`,
  2026-09-30). Sections 2 and 6 *are* the spec; section 8 has locators, 18
  gotchas, a data model and a skeleton.
- `docs/drs-pulse-integration.md` — how the DRS setup suite uses the catalog.

## How catalog versions work (this is why D6 pins "All sites v1")

A catalog version belongs to a **project type + a site scope**.

| Scope | Version labels | Notes |
|---|---|---|
| All sites (`__type_wide__`) | `All sites v4 — locked`, `v3 — draft`, … | the type-wide catalog |
| A specific site (Khavda, Mandvi, …) | `Khavda v1 — draft` | made with **New draft** while the site is selected; it is a **copy of the current All-sites catalog** |
| A site with no catalog of its own | shows the `All sites …` versions, read-only | our `AUTOMATION SITE` is this case |

So the Work Area "Catalog version" dropdown on a project offers `All sites v4 / v3 /
v2 / v1` for `AUTOMATION SITE`, and D6 pins **`All sites v1`** (app owner,
2026-10-01). A pin can never be undone.

## Catalog facts that drive these specs (2026-10-15)

From the DRS catalog guide (Azure wiki *Catalog Versions*, 2026-10-09; PDF copy in
Downloads) and from live runs:

- **New draft copies the version you SELECT**, not the newest locked one (the guide's
  4.6 says newest; live 2026-10-15 the AUTOMATION SITE v1 draft made with *All sites
  v1* selected matched v1, not v5). A new draft lists its sub-packages in a new
  order (positions are recomputed), so copies are compared by the *set* of names.
- **One open draft per chain** (project type + site). A second New draft is refused.
- **Lock is permanent** — no unlock, no delete. Lock version → "Lock <label>
  permanently?" → **Lock permanently**. The server refuses a lock on: no rows, a
  dependency loop or a dependency outside the version, a sub-package with no project
  type, a sub-activity with no Min Unit. A sub-activity with no inspection points is
  only an *advisory* (second button) — never accepted by these specs.
- **A sub-package Letter is one or two letters A–Z.** Digits are refused (guide 6.4).
- Two sub-packages may share a NAME — which is why our codes carry a counter.
- Only **locked** versions can be pinned to a Work Area or chosen in SO Configuration.
- A pin can be **changed** while no work depends on the Work Area (guide 11.3); it can
  never be cleared. Do not pin a *site* version through the CSV import's catalog column
  (bug 16944) — use the form.

## Naming: `<P|Q><C|E><NN>` codes + a counter

Each build adds two sub-packages per package, coded **`P` / `Q` + package letter +
2-digit counter**: Civil `PC01`, `QC01`; Electrical `PE01`, `QE01`; the next build
`PC02`, `QC02` / `PE02`, `QE02` … Node names follow the code: `PC01 Sub Package`,
`PC01.1 Activity`, `PC01.1.1 Sub Activity`, `PC01.1.1 Checkpoint a`.

- The counter lives in `tests/fixtures/drs/catalog-counter.json` (per DRS env, per
  package; `pc-counter.js`). A build **reserves** its number before creating anything,
  and the next number is one past the higher of the file and the codes already in the
  live tree — so a draft copied from a version that carries `PC01` gets `PC02`.
- The code is the sub-package **Name/Code** only. The Letter cannot hold a digit, so
  the app's own letter (and the serials under it) are kept.
- The runbook's historic single letters (P…U) are still accepted for **verify**.

## The specs

| File | Role |
|---|---|
| `pc-data.js` | run matrix, checklist labels, `buildTree(L)`, codes (`codesFor`), run/package/mode selection (no app access) |
| `pc-counter.js` | the code counter (reserve before build) |
| `PackagesConfiguratorPage.js` | selects, tree, forms; `newDraftFrom` / `openDraft` / `lockVersion`; idempotent `ensure*` build steps; read-only `verifyLetter` — every tree method takes the package |
| `package_configurator_electrical_hierarchy.spec.js` | one test per matrix row (Solar × All sites / Khavda / Mandvi); `PC_PACKAGES=Civil,Electrical`, `PC_LETTERS=next` |
| `catalog_site_versions.spec.js` | **AUTOMATION SITE v1** (draft from All sites v1) and **v2** (draft from site v1): build the next codes under Civil **and** Electrical, verify, **lock**. Resumable; state in `drs-setup.json` → `catalogs` |

### `catalog_site_versions.spec.js`

```powershell
npx playwright test --project=drs-setting tests/drs-setting/catalog_site_versions.spec.js --workers=1
$env:CATALOG_STEPS="S1"   # one step only;  $env:CATALOG_SITE="AUTOMATION SITE" (default)
```

- S1: select *All sites v1* → New draft → check the draft is a copy of v1 (not of the
  newest locked) → reserve codes → build PC/QC + PE/QE → verify all 4 × 19 nodes and
  48 checklists → lock → reload and verify the locked version.
- S2: same from *AUTOMATION SITE v1*; first proves S1's codes came along in the copy,
  then builds the next counter.
- Every step is written to the state file the moment the server accepts it; a rerun
  resumes the same draft with the same codes. A version the spec did not record stops
  the run.
- Then the DRS project chain (`tests/drs/setup`, `npm run drs:setup`) pins its
  `VER-*` Work Areas to these versions (see `tests/drs/drs-data.js` `versionAreas`).

Per letter: 1 sub-package + 2 activities + 4 sub-activities + 12 inspection points =
**19 nodes**, each checkpoint bound to its checklist (a → Micro Pile, b → Micro Pile
Cap, c → Post Pour Check; exact labels use an em dash).

### Modes (`PC_MODE`, read from `.env`)

- **`verify` (default, read-only):** opens the newest version for the site (draft or
  locked) and checks all 19 nodes and every checklist. The DRS write guard is
  installed, so a stray click cannot write.
- **`build`:** selects (or creates, via *New draft*) the site's **draft**, then creates
  what is missing, node by node, then verifies. Idempotent — every step expands the
  parent first and checks the node (runbook gotcha 11). Needs an open draft.
- Never clicks **Reset / Discard / Delete**. **Lock** only in `catalog_site_versions.spec.js`
  (app owner, 2026-10-15), after a full verify.

### Running it

```powershell
npm run drs:catalog                                     # verify the whole matrix
$env:PC_RUNS="2"; npm run drs:catalog                   # one row
$env:PC_SITE="Khavda"; $env:PC_LETTERS="V,W"; $env:PC_MODE="build"; npm run drs:catalog   # build NEW letters
```

For a build use **`PC_LETTERS=next`** (the package's next counter codes) or name
fresh codes explicitly (`PC03,QC03`). Set the
variables in `.env` instead of the shell if you prefer; the DRS host and login come
from `DRS_ENV`, `DRS_*_URL` and `DRS_SUPER_ADMIN_*` as for the `drs` project.

### Caveats

- **Verify ran live 2026-10-01: 3/3 pass, 0 writes.** P,Q are in *All sites v4 — locked*, R,S only in
  *Khavda v1 — locked* (Khavda v2–v4 do not carry them), T,U in the *Mandvi v1 — draft* — each with 19/19
  nodes and every checklist. Verify therefore searches a site's versions, newest first, for the one
  holding the letters.
- **Build mode is untested** — it is written from the runbook and waits for the DRS fix.
- The `drs-setting` Playwright project owns this folder; `chromium` ignores it.
