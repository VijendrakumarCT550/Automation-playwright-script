# DRS Packages Configurator: Sub-Package Hierarchy Runbook

This runbook rebuilds a four-level catalog tree (Sub-Package → Activity → Sub-Activity → Checkpoint/Inspection Point) under the **Electrical** package in the DRS Packages Configurator. You can follow it by hand, hand it to Claude, or turn it into a Playwright spec. It lists only the steps that are needed, with no exploration steps.

- **App:** DRS / Project Lifecycle Platform (Adani Renewables), UAT
- **Base URL:** `https://drs-uat.cfapps.ap11.hana.ondemand.com`
- **Page:** App Settings → Packages Configurator → `/appSettings/packagesConfigurator?projectType=solar`
- **User role used:** Super Admin
- **UI library:** Ark UI for selects, comboboxes and menus (they carry `data-scope` / `data-part` attributes). The **tree is a custom component**: plain `div[role=treeitem]` elements with `aria-label`, `aria-level` and `aria-expanded`.

---

## 0. How to use this runbook

**If you're Claude:** when the user shares this file and asks to rebuild the structure, do the following:
1. Ask the user to sign in to DRS in the browser. Never type the password yourself.
2. Confirm the run matrix (Section 1): which sites and letters. Ask if anything differs.
3. For each run, do Section 4 (open the site and get a draft), then Section 6 (build) for each letter, then Section 7 (verify).
4. Don't click Lock, Reset or Discard, and don't delete anything without the user's OK. The owner locks drafts manually after review.

**If you're writing a Playwright spec:** Sections 2 and 6 are the spec. Section 8 has the locators, gotchas, a data model and a skeleton.

---

## 1. Run matrix

Each row is one full run of Sections 4–6. Only the **letters** and the **site** change between runs. Everything else is the same.

| Run | Project Type | Site | Letter 1 | Letter 2 | Status |
|---|---|---|---|---|---|
| 1 | Solar | All sites | **P** | **Q** | Done (All sites v3, locked later by owner) |
| 2 | Solar | Khavda | **R** | **S** | Done (Khavda v1, locked later by owner) |
| 3 | Solar | Mandvi | **T** | **U** | Done (Mandvi v1 — draft, left open) |

In the rest of this document, `{L}` means the sub-package letter (P, Q, R, S, T or U).

---

## 2. Target node structure (per letter `{L}`)

### 2.0 How the source diagram maps to the app

The requirement came as a diagram with four colour-coded levels: Sub Package (pink) → Activity (cyan) → Sub-Activity (purple) → Checkpoint (green). Sub-packages `A` and `B` each have 2 activities, each activity has 2 sub-activities, and each sub-activity has 3 checkpoints (a, b, c). The same shape is rebuilt with new letters, and every node name spells out its level:

| Diagram level | Diagram label (for A) | App node type | App node Name (for `{L}`) | Example (L = P) |
|---|---|---|---|---|
| Sub Package | `A` | Sub-Package | `{L} Sub Package` | `P Sub Package` |
| Activity | `A.1`, `A.2` | Activity | `{L}.{a} Activity` | `P.1 Activity` |
| Sub-Activity | `A.1.1`, `A.1.2` … | Sub-Activity | `{L}.{a}.{s} Sub Activity` | `P.1.1 Sub Activity` |
| Checkpoint | `A.1.1 a/b/c` | Inspection Point | `{L}.{a}.{s} Checkpoint {c}` | `P.1.1 Checkpoint a` |

"Checkpoint" in the diagram is called **Inspection Point** in the app. Diagram letters A/B are replaced per run (P/Q, R/S, T/U), and the app's **Letter** field on the sub-package drives the serial prefix. Every checkpoint gets one checklist based on its letter: **a → Micro Pile**, **b → Micro Pile Cap**, **c → Post Pour Check** (table 2.2).

Parent package: **Electrical**. It already exists and is read-only ("Packages master managed upstream"). New sub-packages sit next to the existing seeded ones (A AC / LT Network, B DC Network, C HT Cabling) and don't change them.

```
Electrical                                   (existing package)
└── {L} Sub Package                          Sub-Package   Code={L}  Letter={L}
    ├── {L}.1 Activity                       Activity      Code={L}.1  Base UOM=Nos
    │   ├── {L}.1.1 Sub Activity             Sub-Activity  Code={L}.1.1  Min Unit=TABLE  UOM=PER UNIT
    │   │   ├── {L}.1.1 Checkpoint a         Inspection Point  → Micro Pile Checklist
    │   │   ├── {L}.1.1 Checkpoint b         Inspection Point  → Micro Pile Cap Checklist
    │   │   └── {L}.1.1 Checkpoint c         Inspection Point  → Post Pour Check
    │   └── {L}.1.2 Sub Activity
    │       ├── {L}.1.2 Checkpoint a / b / c (same as above)
    └── {L}.2 Activity
        ├── {L}.2.1 Sub Activity
        │   └── {L}.2.1 Checkpoint a / b / c
        └── {L}.2.2 Sub Activity
            └── {L}.2.2 Checkpoint a / b / c
```

Counts per letter: 1 sub-package, 2 activities, 4 sub-activities and 12 inspection points (19 nodes). With two letters per run that is **38 nodes** and **24 checklist bindings**.

### 2.1 Field values per level

| Level | Field | Value (template) | Example (L=P) |
|---|---|---|---|
| Sub-Package | Name* | `{L} Sub Package` | `P Sub Package` |
| | Code | `{L}` | `P` |
| | Project Type* | Solar (preset, leave it) | Solar |
| | Letter (edit form only) | `{L}` | `P` |
| Activity | Name* | `{L}.{a} Activity` | `P.1 Activity` |
| | Code* | `{L}.{a}` | `P.1` |
| | Base UOM* (free text) | `Nos` | `Nos` |
| Sub-Activity | Name* | `{L}.{a}.{s} Sub Activity` | `P.1.1 Sub Activity` |
| | Code | `{L}.{a}.{s}` | `P.1.1` |
| | Min Unit* (searchable combobox) | `TABLE` | `TABLE` |
| | UOM* (select) | `PER UNIT` | `PER UNIT` |
| Inspection Point | Inspection Point Name* | `{L}.{a}.{s} Checkpoint {c}` | `P.1.1 Checkpoint a` |
| | Type* (select) | `question` | `question` |
| | Variant | *(blank)* | |
| | Description* | `{L}.{a}.{s} checkpoint {c}` (lower-case "checkpoint") | `P.1.1 checkpoint a` |
| | Optional (switch) | OFF | OFF |
| | Checklist Required (switch) | **ON** | ON |
| | Checklist binding (after create) | see 2.2 | |

`{a}` ∈ {1, 2}, `{s}` ∈ {1, 2}, `{c}` ∈ {a, b, c}.

The **Serial** is read-only and set automatically from the tree position. For example, `P.1.1 Checkpoint a` gets Serial `P.1.1.1`, `b` gets `P.1.1.2` and `c` gets `P.1.1.3`.

### 2.2 Checklist binding per checkpoint

| Checkpoint | Search text | Exact option label to select |
|---|---|---|
| a | `Micro Pile Checklist` | `Micro Pile Checklist — RE/QA/SFQP/C/012` |
| b | `Micro Pile Cap` | `Micro Pile Cap Checklist — RE/QA/SFQP/C/012` |
| c | `Post Pour Check` | `Post Pour Check — RE/QA/SFQP/C/002` |

> The separator in the option label is an **em dash** (`—`, U+2014) with a space on each side. Several similar labels exist, such as "Post-Pour Checklist — RE/QA/SFQP/C/002", "Post Pour Check,FDD Test by Core Cutter Method" and "58_Post Pour Checklist". Always match the **exact full label**.

---

## 3. Prerequisites

1. Sign in to DRS. Use **Partner log in** (Email + Password) on `/login`. In Playwright, read credentials from environment variables (for example `DRS_USER` and `DRS_PASS`). Never hard-code them in the spec.
2. After login you land on `/projects`.

---

## 4. Open the configurator and get an editable draft

### 4.1 Navigate
Go to `/appSettings/packagesConfigurator?projectType=solar`.

The left panel has three selects, each a `button[role=combobox]`:

| Select | Accessible name | Options (`role=option`, `data-value`) |
|---|---|---|
| Project Type | `Project Type` | BESS `bess`, Infra `infra`, PSS `pss`, **Solar `solar`**, Transmission Line `transmission_line`, Wind `wind` |
| Site | `Site` | **All sites `__type_wide__`**, AUTOMATION SITE, Baiya, Bandha, **Khavda `e6e39247-c01c-4f80-8736-0b68fdaab5d4`**, Ludbay, **Mandvi `dfaa99fc-91d1-489f-86c9-0d170ddff9bf`**, Mundra |
| Catalog version | `Catalog version` | All sites: `v3 — draft`, `v2 — locked`… A specific site: `Khavda v1 — draft`, `All sites v4 — locked`… (data-value is an internal version id; match by label, and pick the one ending in `— draft` whose prefix is the site name) |

### 4.2 Select Project Type = Solar and the Site for the run
- Project Type: **Solar**
- Site: **All sites**, **Khavda** or **Mandvi** (from the run matrix)

Selecting a Site adds `&site=<site uuid>` to the URL, so you can also open a site directly:

| Site | Direct URL |
|---|---|
| All sites | `/appSettings/packagesConfigurator?projectType=solar` |
| Khavda | `/appSettings/packagesConfigurator?projectType=solar&site=e6e39247-c01c-4f80-8736-0b68fdaab5d4` |
| Mandvi | `/appSettings/packagesConfigurator?projectType=solar&site=dfaa99fc-91d1-489f-86c9-0d170ddff9bf` |

**How site catalogs work:**
- A site with no catalog of its own shows the "All sites" versions, labelled like `All sites v4 — locked` (read-only).
- Clicking **New draft** while a specific site is selected creates a **site-specific** draft, e.g. `Khavda v1 — draft` or `Mandvi v1 — draft`. It is a copy of the current All-sites catalog, so it already contains Electrical → A/B/C (and whatever else All-sites has).
- The draft's internal id appears as `&version=<id>` in the URL once selected (e.g. Khavda draft `version=6`, Mandvi draft `version=9` in this UAT run). These ids change every time a draft is created, so always pick the draft by its **label**, never by a hard-coded id.

### 4.3 Select or create a draft
1. Open **Catalog version**. If an option ending in `— draft` exists, select it and go to 4.4.
2. If only `— locked` versions exist, click **New draft** (`button` "New draft").
   - Success is silent: the draft is created (`POST /api/v1/master-data-versions/drafts` returns 2xx), but the dropdown may not show it until you **reload the page**.
   - If a draft already exists for this project type and site, a modal appears: *"A draft already exists for this project type and site, and only one may be open at a time…"* (API 409). Click **Close** and select the existing draft instead.
3. Reload the page, then open **Catalog version** and select the draft: `vN — draft` for All sites, or `<Site> vN — draft` for a site (e.g. `Mandvi v1 — draft`). The URL gains `&version=<id>`.

### 4.4 Confirm edit mode
In draft mode you see the buttons **New draft**, **Reset draft**, **Discard draft** and **Lock version**. A locked version instead shows *"Catalog version N is locked and cannot be edited."*

> **Do not** click Reset draft, Discard draft or Lock version during this procedure. Lock is permanent.

---

## 5. Tree and menu mechanics (applies to every create step)

- Every tree node is `[role=treeitem]` whose **accessible name (`aria-label`) = the node's Name** (e.g. `P.1 Activity`). Visually, the row also shows the serial in front (e.g. `P.1   P.1 Activity`), but the serial is **not** part of the accessible name.
- Each branch row starts with a chevron (the first `svg` in the row) that expands or collapses it. `aria-expanded` is `true`/`false` on branches and absent on leaves (inspection points).
- Every node has a kebab button whose accessible name is **`Add or delete <Node Name>`**. Clicking it opens a menu of `[role=menuitem]` entries:

| Node type | Menu items |
|---|---|
| Package (Electrical) | `Add Sub-Package` |
| Sub-Package | `Add Activity`, `Delete` |
| Activity | `Add Sub-Activity`, `Delete` |
| Sub-Activity | `Add Inspection Point`, `Delete` |

- Choosing an "Add …" item opens a **create form** in the right-hand **Details** tab (`[role=tabpanel]`) with **Cancel** / **Create** buttons.
- After **Create**, a toast appears (`"<Type> created"`). The new child appears under its parent (the parent auto-expands), and the right panel switches to the new node's **edit form** (buttons **Cancel** / **Save**).
- Clicking a node's label selects it and opens its edit form. On a **branch** node (sub-package, activity, sub-activity), clicking the label can also **toggle** it open or closed, so re-check `aria-expanded` afterwards if you need its children.

---

## 6. Build steps (for each letter `{L}` in the run, in order)

Do Letter 1 completely, then Letter 2. Work **depth-first** within a letter: finish each Inspection Point (including its checklist) before moving on.

### Step 6.1: Create the Sub-Package
1. Expand **Electrical** and click `Add or delete Electrical` → **Add Sub-Package**.
2. Fill in:
   - **Name** = `{L} Sub Package`
   - **Code** = `{L}`
   - **Project Type** = leave as `Solar`
3. Click **Create** and wait for the toast *"Sub-Package created"*.

### Step 6.2: Set the Sub-Package letter
The app assigns the next free letter automatically (in Run 1 the first new one became `D` and the next became `Q`). Always force the letter:

1. The edit form is now open (select the node `{L} Sub Package` if it isn't). It has **Name**, **Code**, **Project Type** and **Letter**.
2. If **Letter** ≠ `{L}`: clear it, type `{L}`, and click **Save**.
3. An inline confirmation appears: *"Renumber everything beneath this sub-package? Changing the letter from X to {L} rewrites the serial of every activity, sub-activity and inspection point beneath this sub-package."* Click **Change letter**.
4. Wait for the toast *"Letter changed to {L} — 0 inspection point(s) renumbered"*. In the tree the node now shows `{L}   {L} Sub Package`.

> Set the letter **before** adding children so every serial under it is created as `{L}.x.x.x` from the start.

### Step 6.3: Create the Activities (`{a}` = 1, then 2)
1. Click `Add or delete {L} Sub Package` → **Add Activity**.
2. Fill in:
   - **Name** = `{L}.{a} Activity`
   - **Code** = `{L}.{a}`
   - **Base UOM** = `Nos` (plain text input, required)
3. Click **Create** and wait for *"Activity created"*.

### Step 6.4: Create the Sub-Activities (`{s}` = 1, then 2, under each activity)
1. Click `Add or delete {L}.{a} Activity` → **Add Sub-Activity**.
2. Fill in:
   - **Name** = `{L}.{a}.{s} Sub Activity`
   - **Code** = `{L}.{a}.{s}`
   - **Min Unit**: a searchable combobox (`input[role=combobox]`, placeholder `Search Min Unit`). Type `TABLE` and click the option **TABLE**.
   - **UOM**: a select (`button[role=combobox]`, placeholder `Choose a unit`). Open it and click **PER UNIT**.
     - Options: KM, LOT, M, MT, NO, NOT APPLICABLE, PER UNIT, SET, SQM.
3. Click **Create** and wait for *"Sub-Activity created"*.

### Step 6.5: Create the Inspection Points (`{c}` = a, b, c, under each sub-activity)
1. Click `Add or delete {L}.{a}.{s} Sub Activity` → **Add Inspection Point**.
2. Fill in:
   - **Inspection Point Name** = `{L}.{a}.{s} Checkpoint {c}`
   - **Type**: a select (`button[role=combobox]`, placeholder `Choose a type`). Choose **question**.
   - **Variant**: leave blank.
   - **Description** = `{L}.{a}.{s} checkpoint {c}`
   - **Optional** switch: leave OFF.
   - **Checklist Required** switch (`checkbox` "Checklist Required"): turn **ON**.
3. Click **Create** and wait for *"Inspection Point created"*.
4. The edit form now also shows **Serial** (auto, e.g. `P.1.1.1`), a **"Must be completed first"** section (leave empty), and a **Checklists** section. The Checklists section shows the warning *"This inspection point is marked as requiring a checklist, but none is attached."*

### Step 6.6: Bind the checklist to the Inspection Point
Do this right after 6.5, with the new inspection point still selected.

1. Scroll to the **Checklists** section.
2. Click the combobox `Choose a checklist…` (`input[role=combobox]`) and type the **search text** from table 2.2.
3. Click the option whose text is **exactly** the full label from table 2.2.
4. The checklist appears as a chip marked **"not saved yet"**, and the footer shows *"1 unsaved change(s). Nothing is stored until you save."* with **Discard changes** / **Save checklists**.
5. Click **Save checklists**. The "not saved yet" badge and the warning go away, and the chip shows the checklist's short name (e.g. `Micro Pile Checklist`).

Repeat 6.5–6.6 for checkpoints a, b and c. Then repeat 6.4–6.6 for the next sub-activity, then 6.3–6.6 for the next activity, then 6.1–6.6 for Letter 2.

### 6.7 Full ordered action list (one letter)
```
Add Sub-Package  under "Electrical"            → "{L} Sub Package" (code {L}); set Letter={L} → Change letter
Add Activity     under "{L} Sub Package"       → "{L}.1 Activity" (code {L}.1, UOM Nos)
Add Sub-Activity under "{L}.1 Activity"        → "{L}.1.1 Sub Activity" (code {L}.1.1, TABLE, PER UNIT)
Add Insp. Point  under "{L}.1.1 Sub Activity"  → "{L}.1.1 Checkpoint a" → bind Micro Pile Checklist → Save checklists
Add Insp. Point  under "{L}.1.1 Sub Activity"  → "{L}.1.1 Checkpoint b" → bind Micro Pile Cap Checklist → Save checklists
Add Insp. Point  under "{L}.1.1 Sub Activity"  → "{L}.1.1 Checkpoint c" → bind Post Pour Check → Save checklists
Add Sub-Activity under "{L}.1 Activity"        → "{L}.1.2 Sub Activity" … checkpoints a/b/c as above
Add Activity     under "{L} Sub Package"       → "{L}.2 Activity"
Add Sub-Activity under "{L}.2 Activity"        → "{L}.2.1 Sub Activity" … checkpoints a/b/c
Add Sub-Activity under "{L}.2 Activity"        → "{L}.2.2 Sub Activity" … checkpoints a/b/c
```

---

## 7. Verification (after the run)

1. Reload `/appSettings/packagesConfigurator?projectType=solar` and re-select the same **Site** and the **draft** version.
2. Expand Electrical → `{L} Sub Package` and all descendants. The tree must read, in order:
   `{L} Sub Package, {L}.1 Activity, {L}.1.1 Sub Activity, {L}.1.1 Checkpoint a, {L}.1.1 Checkpoint b, {L}.1.1 Checkpoint c, {L}.1.2 Sub Activity, … , {L}.2.2 Checkpoint c`
   (19 nodes per letter).
3. Tree prefixes (serials) must be `{L}`, `{L}.1`, `{L}.1.1`, `{L}.1.1.1`, `{L}.1.1.2`, `{L}.1.1.3`, …
4. Open any checkpoint and check that Type = `question`, Checklist Required = ON, Description = `{L}.x.x checkpoint {c}`, and the Checklists section lists exactly one checklist matching table 2.2, with no "not saved yet" badge and no warning.
5. Leave the version as a **draft**. Locking is a separate, deliberate step done by the owner.

---

## 8. Automation notes and gotchas (Playwright)

### 8.1 Recommended locators
```ts
// selects in the left panel
page.getByRole('combobox', { name: 'Project Type' })
page.getByRole('combobox', { name: 'Site' })
page.getByRole('combobox', { name: 'Catalog version' })
page.getByRole('option', { name: /— draft$/ })

// tree
page.getByRole('treeitem', { name: 'P.1 Activity', exact: true })
page.getByRole('button',   { name: 'Add or delete P.1 Activity', exact: true })
page.getByRole('menuitem', { name: 'Add Sub-Activity' })

// form (scope to the Details panel)
const panel = page.getByRole('tabpanel');
panel.getByLabel('Name', { exact: true })
panel.getByLabel('Code', { exact: true })
panel.getByLabel('Base UOM')
panel.getByLabel('Letter')
panel.getByLabel('Inspection Point Name')
panel.getByLabel('Description')
panel.getByRole('checkbox', { name: 'Checklist Required' })
panel.getByPlaceholder('Search Min Unit')
panel.getByPlaceholder('Choose a checklist…')          // note: ends with the "…" character (U+2026)
panel.getByRole('button', { name: 'Create' })
panel.getByRole('button', { name: 'Save', exact: true })
panel.getByRole('button', { name: 'Change letter' })
panel.getByRole('button', { name: 'Save checklists' })
```

### 8.2 Gotchas seen during the manual run
1. **Option text contains a check mark.** Ark UI select items render a `✓` indicator inside the option, so an option's text can be `PER UNIT✓`. Match with a regex (`/^PER UNIT/`), with `data-value` (`[role=option][data-value="PER UNIT"]`), or by filtering to visible options. Hidden options for *other* selects (Project Type, Site, Version) are also in the DOM as `role=option`, so always filter to **visible** ones.
2. **Selects open on pointer-down.** Ark UI selects and menus react to `pointerdown`. A normal Playwright `click()` works. In raw DOM scripts, dispatch `pointerdown` → `pointerup` → `click`.
3. **Catalog version dropdown can be flaky.** Clicks sometimes seemed to toggle it open and shut. Wait until `aria-expanded="true"` on the combobox before clicking an option, and retry once if needed.
4. **The new draft doesn't appear until reload.** After **New draft**, reload the page before selecting the draft. A second click gives the "draft already exists" modal (HTTP 409), which is harmless: click **Close**.
5. **The sub-package letter is auto-assigned** (next free letter). Always check the Letter field and change it when needed. The change needs the extra **Change letter** confirmation.
6. **Tree re-renders after each create.** Wait for the toast and for the new `treeitem` to be visible before clicking the next `Add or delete …` button (a 1–2 s wait was needed).
7. **Checklist binding is a separate save.** The main **Save** button doesn't save checklists. Use **Save checklists**. The checklist combobox is only there *after* the inspection point is created.
8. **Checklist labels contain an em dash (`—`).** Use the exact string or a regex such as `/^Micro Pile Checklist — RE\/QA\/SFQP\/C\/012$/`. There are many near-duplicates (Post Pour Check vs Post-Pour Checklist vs Post Pour Check,FDD Test…).
9. **Required fields:** Sub-Package: Name, Project Type. Activity: Name, Code, Base UOM. Sub-Activity: Name, Min Unit, UOM. Inspection Point: Name, Type, Description.
10. **Existing seeded nodes** (A, B, C under Electrical) have empty Code/UOM. Don't touch them.
11. **Children are only in the DOM once their parent is expanded.** After a page reload the tree is collapsed. Before you check whether a node exists (to make a spec idempotent or re-runnable), expand its parent: click the chevron (the first `svg` inside the `treeitem`) and wait for `aria-expanded="true"`. Checking a collapsed parent makes existing children look missing and **creates duplicates**.
12. **Removing a node by mistake:** `Add or delete <Name>` → **Delete** → confirmation modal *"Delete Activity '<Name>'? This cannot be undone."* → **Confirm**. Only do this for nodes created in error in a draft.
13. **Keep the browser tab in the foreground.** When the page is hidden (window minimised or another tab in front), Chrome throttles timers heavily and a long run can stall for minutes. In Playwright, run headed or headless with the page in front (the default). Don't rely on `setTimeout`-based waits in injected page scripts. Prefer Playwright's own `expect(...).toBeVisible()` waits.
14. **Checkpoint Serial** comes from position, not name. If checkpoints are created out of order (c before b), the Serial shows that order. Create a → b → c in sequence.
15. **Draft buttons in site drafts** are the same as in All-sites: New draft / Reset draft / Discard draft / Lock version. Locking is left to the catalog owner and is **not** part of this procedure.
16. **Searchable comboboxes (Min Unit, Choose a checklist…) sometimes don't open on the first click.** If no option shows up after typing, clear the input, click the combobox's chevron button, and type again. Then assert the chosen value (Min Unit input = `TABLE`, the checklist chip is visible) before you click Create or Save checklists.
17. **Create forms can lag behind the menu.** After clicking an "Add …" menu item, wait until the Details panel shows the **Create** button (the new empty form) before filling fields. Otherwise you may type into the previous node's edit form.
18. **Locked versions still show details.** In a locked version you can open nodes read-only for verification. The "Must be completed first" section says *"Dependencies can only be changed on an open draft version."*

### 8.3 Data model for a data-driven spec
```ts
type Run = { site: 'All sites' | 'Khavda' | 'Mandvi'; letters: [string, string] };
const RUNS: Run[] = [
  { site: 'All sites', letters: ['P', 'Q'] },
  { site: 'Khavda',    letters: ['R', 'S'] },
  { site: 'Mandvi',    letters: ['T', 'U'] },
];
const CHECKLIST = {
  a: 'Micro Pile Checklist — RE/QA/SFQP/C/012',
  b: 'Micro Pile Cap Checklist — RE/QA/SFQP/C/012',
  c: 'Post Pour Check — RE/QA/SFQP/C/002',
} as const;

function buildTree(L: string) {
  return {
    name: `${L} Sub Package`, code: L, letter: L,
    activities: [1, 2].map(a => ({
      name: `${L}.${a} Activity`, code: `${L}.${a}`, baseUom: 'Nos',
      subActivities: [1, 2].map(s => ({
        name: `${L}.${a}.${s} Sub Activity`, code: `${L}.${a}.${s}`, minUnit: 'TABLE', uom: 'PER UNIT',
        checkpoints: (['a', 'b', 'c'] as const).map(c => ({
          name: `${L}.${a}.${s} Checkpoint ${c}`,
          description: `${L}.${a}.${s} checkpoint ${c}`,
          type: 'question', optional: false, checklistRequired: true,
          checklist: CHECKLIST[c],
        })),
      })),
    })),
  };
}
```

### 8.4 Spec skeleton (outline)
```ts
test.describe.serial('Packages Configurator – Electrical hierarchy', () => {
  for (const run of RUNS) {
    test(`Solar / ${run.site} – ${run.letters.join(',')}`, async ({ page }) => {
      await page.goto('/appSettings/packagesConfigurator?projectType=solar');
      await selectOption(page, 'Project Type', 'Solar');
      await selectOption(page, 'Site', run.site);
      await ensureDraft(page);                       // 4.3: select "— draft" or New draft → reload → select
      for (const L of run.letters) {
        const t = buildTree(L);
        await addChild(page, 'Electrical', 'Add Sub-Package', { Name: t.name, Code: t.code });
        await setLetter(page, t.name, L);             // 6.2 incl. "Change letter"
        for (const a of t.activities) {
          await addChild(page, t.name, 'Add Activity', { Name: a.name, Code: a.code, 'Base UOM': a.baseUom });
          for (const s of a.subActivities) {
            await addSubActivity(page, a.name, s);    // Min Unit TABLE, UOM PER UNIT
            for (const c of s.checkpoints) {
              await addInspectionPoint(page, s.name, c); // Type question, Checklist Required ON
              await bindChecklist(page, c.checklist);    // Save checklists
            }
          }
        }
      }
      await verifyTree(page, run.letters);            // Section 7
    });
  }
});
```

---

## 9. Run log

| Run | Site | Letters | Draft | Result |
|---|---|---|---|---|
| 1 | All sites | P, Q | All sites v3 (draft → locked by owner) | 38 nodes + 24 checklist bindings; verified after reload |
| 2 | Khavda | R, S | Khavda v1 (new site draft → locked by owner) | 38 nodes + 24 checklist bindings; verified in the locked version (tree order, names, checklists) |
| 3 | Mandvi | T, U | Mandvi v1 — draft (new site draft, not locked) | 38 nodes + 24 checklist bindings; verified after reload (tree order, letters, Min Unit/UOM, Type, Checklist Required, Description, checklists) |

Notes from the runs:
- Runs 2 and 3 were done exactly as Section 6 describes: nodes were created directly with their final names, and each checklist was bound right after its inspection point was created. Run 1 was built first with short names (P, P.1, P.1.1, P.1.1 a…) and renamed afterwards, but the end state is the same as Section 2.
- In the locked Khavda v1, `R.1.1 Checkpoint a` has one dependency ("Must be completed first") linked to `R.1.1 Checkpoint b`. This procedure doesn't add dependencies, so it was added separately before locking. Don't reproduce it unless asked.
- The Mandvi draft was copied from All sites v4, so it also shows the P and Q sub-packages from Run 1. That's expected: site drafts inherit the All-sites catalog.
- During Run 2, a re-run of the automation created one extra empty `R.1 Activity`, because its parent was collapsed and the existing node wasn't in the DOM. It was deleted (Delete → Confirm) before continuing. Gotcha 11 in Section 8.2 prevents this.
