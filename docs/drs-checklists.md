# DRS checklists in the catalog: test strategy

**Status, 2026-10-15: built and verified end to end.**
- **DRS:** Automation Site 01 v3 is locked with the six checklists and the dependencies (§6).
- **Pulse:** IN16 passed P1–P4 on both chains (§7).

**This is part of the SITE catalog build, not a separate stage** (app owner):
- `tests/drs-setting/catalog_site_versions.spec.js` builds the next **Automation Site 01** version exactly as before.
- **Only the build's Civil P-code (`PCxx`) changes; `QCxx` does not** (app owner):
  - the checkpoints of **`PCxx.2.1` and `PCxx.2.2`** get our six checklists (§2) instead of the standard ones;
  - **every** PCxx checkpoint gets the **a → b → c** dependency, in all four sub-activities (`.1.1`, `.1.2`, `.2.1`, `.2.2`), whatever checklist it carries.
- **Not affected:** `QCxx`, Electrical, and the All-sites hierarchy spec.

| Sub-activity | Checklists | Dependencies |
|---|---|---|
| PCxx.1.1 / PCxx.1.2 | standard (Micro Pile / Micro Pile Cap / Post Pour Check) | b after a, c after b |
| PCxx.2.1 | ours #1 / #2 / #3 | b after a, c after b |
| PCxx.2.2 | ours #4 / #5 / #6 | b after a, c after b |
| QCxx (all) | standard | none |

How the automation will create its own checklists in the DRS **Checklists Configurator**, bind them to the checkpoints of a new catalog version, add checkpoint dependencies, and prove all of it in Pulse.

Related: [`drs-catalog-versions-and-so-lines.md`](drs-catalog-versions-and-so-lines.md), [`drs-so-lines-and-service-codes.md`](drs-so-lines-and-service-codes.md), [`../tests/drs-setting/RUNBOOK.md`](../tests/drs-setting/RUNBOOK.md).

---

## 1. Checklists Configurator: what it does (explored read-only, drs-uat, 2026-10-15)

`App Settings → Checklists Configurator` (`/appSettings/checklistsConfigurator`).

**The list**
- 230 checklists, each card showing **name**, **SFQP number** and *"Used by N inspection point(s)"* (or *"Not attached to any inspection point"*).
- Search by name, serial or SFQP; filter by **Project Type** and **activity**.
- **Names repeat.** *Micro Pile Checklist* exists as `RE/QA/SFQP/C/012` (used by 313), `…-R1`, `…-R3` ("v1-->v2 fork of fork1") and `…-R5`. A checklist is identified by **name + SFQP**, never by name alone.

**One checklist**
- A header with SFQP, SERIAL and FORMAT; the counts *Questions N* and *Used by N*; the question list (number, text, answer type, required).
- **No in-place edit**, only *Fork to edit*.

**New checklist** (dialog)
- Fields: *Checklist name*, *SERIAL*, *SFQP*, *FORMAT*.
- **Questions:** at least one is required (until then *Create* is disabled). Each question row has:
  - *No.* (spin box);
  - *Question text*;
  - *Answer type*: **`Text`, `YesNo`, `Number`**;
  - a *Value required* checkbox (on by default);
  - *Remove*.

**Fork to edit** (dialog *Fork "<name>"*)
- From the screen: *"A checklist's questions cannot be edited in place. Forking creates a new checklist with a new SFQP number and your edited question set. Every inspection point currently attached to the original keeps pointing at the ORIGINAL — attach the fork wherever it should replace it, separately, on the Packages Configurator."*
- **Editable:** the name and every copied question (text, type, required, remove), plus *Add question*.
- **Saving:** the SFQP is assigned on save; the button is *Create fork*.

**Binding and dependencies** happen in the **Packages Configurator**, on a **draft** catalog version:
- **Checklist:** the inspection point's *Checklists* section, *Choose a checklist…*, then *Save checklists*.
- **Dependency:** *Must be completed first*, *Choose an inspection point…*, then *Save dependencies*. A loop is allowed in a draft but **blocks the lock**.

**Pulse today** (app owner): answer types are **not implemented yet** (work in progress). Pulse shows **every question as Text, and every question as mandatory**, whatever DRS says.

---

## 2. The six checklists

Created **inside the site catalog build step**, right before its trees are built, and named after the build's Civil P-code (`PCxx`, e.g. `PC03`). There are three **new / forked** checklists, and three **forks of those**. Only the build's Civil **P**-code binds them, on `PCxx.2.1` / `PCxx.2.2`; `QCxx` keeps the standard checklists.

| # | Name | Made as | Bound to |
|---|---|---|---|
| 1 | `AUTO PCxx Checklist 1` | **New** (our SERIAL / SFQP / FORMAT) | `PCxx.2.1 Checkpoint a` |
| 2 | `AUTO PCxx Checklist 2` | **Fork** of *Micro Pile Cap Checklist* (`…/C/012`) | `PCxx.2.1 Checkpoint b` |
| 3 | `AUTO PCxx Checklist 3` | **Fork** of *Post Pour Check* (`…/C/002`) | `PCxx.2.1 Checkpoint c` |
| 4 | `AUTO PCxx Checklist 4` | **Fork of #1** (fork of a new one) | `PCxx.2.2 Checkpoint a` |
| 5 | `AUTO PCxx Checklist 5` | **Fork of #2** (fork of a fork) | `PCxx.2.2 Checkpoint b` |
| 6 | `AUTO PCxx Checklist 6` | **Fork of #3** (fork of a fork) | `PCxx.2.2 Checkpoint c` |

Forks are one-to-one: 4 ← 1, 5 ← 2, 6 ← 3 (app owner).

`PCxx.1.1` and `PCxx.1.2` keep the standard checklists the catalog build uses today (a → Micro Pile, b → Micro Pile Cap, c → Post Pour Check). So one code carries both standard and our own checklists.

**Questions.** Every checklist carries six questions, *Question no 1* … *Question no 6*; a fork keeps its copied questions and adds them.

> **DRS bug (reported by the app owner, 2026-10-15):** creating a checklist that holds **Number** or **YesNo** questions, or a question with *Value required* **off**, answers **HTTP 500 "Internal server error"**. The DRS UI sends exactly the same `POST /api/v1/checklists` as the automation (captured live, inspection round 20). All-Text, all-required checklists are accepted.
>
> **Until it is fixed**, the build uses all six as **Text, required** (`pc-data.js` `SAFE_QUESTIONS`). The planned mix below is kept in code (`MIXED_QUESTIONS`); `CHECKLIST_QUESTION_MIX=1` switches it back on.

| Question | Answer type (planned mix) | Value required (planned mix) |
|---|---|---|
| Question no 1 | Text | yes |
| Question no 2 | Text | no |
| Question no 3 | Number | yes |
| Question no 4 | Number | no |
| Question no 5 | YesNo | yes |
| Question no 6 | YesNo | no |

**Header values** follow the real formats (app owner), in a 9xx range keyed by the build's counter. For PC03, #1 is SERIAL `C_93_1`, SFQP `RE/QA/SFQP/C/931`, FORMAT `QA-C/F-931`. A fork gets its SFQP from DRS.

Each fork makes one change, so the fork is distinguishable from its source: it adds a question **Question no 7 (fork of …)**.

**Checks in DRS** (after a reload):
- each checklist is listed with its question count, and every question with its type and required flag;
- each fork has a **new** SFQP; its source is unchanged, and the source's *Used by* count is unchanged.

**Permanence:** checklists cannot be deleted. Each one is recorded in the state file the moment it is created, and a re-run reuses it.

---

## 3. The site catalog build, with the checklists

`catalog_site_versions.spec.js` builds the **next Automation Site 01 version** as it always has. Today that is **v3**, drafted from v2. Each run continues the site chain (v4 from v3 …) with the next counter codes. **No All sites version is created.**

**One build step, in order:**
1. **New draft** from the newest locked site version, then the copy check.
2. **Reserve** the next codes: `PC03` / `QC03`, `PE03` / `QE03`.
3. **Create the six checklists** of §2 (new, fork, fork-of-fork), named after the build's Civil P-code, and record them with the version.
4. **Build the trees.** Electrical and QCxx are as today. PCxx binds `.1.x` to the standard checklists and `.2.1` / `.2.2` to checklists 1–6.
5. **Add the dependencies:** a → b → c in every PCxx sub-activity.
6. **Verify** every node, checklist binding and dependency, then **lock**.

**In the new PCxx code** (QCxx as before):
- checkpoints `.2.1` / `.2.2` a/b/c bound to checklists 1–6 (§2);
- `.1.x` bound to the standard checklists;
- **dependency chain a → b → c in every PCxx sub-activity** (all four): *b* must be completed after *a*, and *c* after *b*.

**Before the lock**, it checks every binding and every dependency, and that the version has no loop. The lock must not be refused.

**Then, as today:**
- a Work Area with no records is pinned to the new version. It can be a new Work Area added to an **existing** project, or an unused existing one; a new project is **not** needed (catalog visibility is filtered only by project type and, for a site version, by the Work Area's site). The verified run (§7) happened to use a fresh project's `BL06 S-v3`;
- SO Configuration and SO Line Mapping (our sub-activities 2 per line, one version per line);
- WAM for CI/EE/QI.

---

## 4. Pulse proof

| # | Check | How |
|---|---|---|
| P1 | **Dependency blocks** | Raising an RFI on `PCxx.2.1 Checkpoint b` before *a* is approved is **blocked**. |
| P2 | **Dependency releases** | After *a* is approved (CI → EE → QI), *b* can be raised; likewise *c* after *b*. |
| P3 | **Our checklist loads** | The RFI on each of the six checkpoints shows **its** checklist: all its questions, by text and count (a fork also has the copied questions and *Question no 7*). |
| P4 | **RFI is created and approved** | Each of those RFIs submits, gets a code, and is approved by EE and QI. |

**Not tested yet:** answer types and the required / optional behaviour. Pulse renders every question as mandatory Text for now (WIP). When Pulse supports them, add checks that Number / YesNo inputs render correctly and that only required questions block submit.

---

## 6. Verified live (drs-uat, 2026-10-15)

**The six checklists**, made inside the S3 build step, recorded under `catalogs["Automation Site 01"].S3.checklists`:

| # | Checklist | Made as | SFQP (assigned) | Questions |
|---|---|---|---|---|
| 1 | AUTO PC03 Checklist 1 | new | RE/QA/SFQP/C/931 | 6 |
| 2 | AUTO PC03 Checklist 2 | fork of Micro Pile Cap Checklist | RE/QA/SFQP/C/012-R8 | 17 (10 copied + 6 + fork mark) |
| 3 | AUTO PC03 Checklist 3 | fork of Post Pour Check | RE/QA/SFQP/C/002-R3 | 16 (9 + 6 + fork mark) |
| 4 | AUTO PC03 Checklist 4 | fork of #1 | RE/QA/SFQP/C/931-R1 | 7 |
| 5 | AUTO PC03 Checklist 5 | fork of #2 | RE/QA/SFQP/C/012-R9 | 18 |
| 6 | AUTO PC03 Checklist 6 | fork of #3 | RE/QA/SFQP/C/002-R4 | 17 |

**DRS assigns a fork the source SFQP plus `-R<n>`.**

**Automation Site 01 v3**, drafted from v2 and **locked**:
- **PC03:** `.2.1` / `.2.2` bound to checklists 1–6, `.1.x` to the standard ones, **a → b → c on all 12 checkpoints**.
- **QC03, PE03, QE03:** standard.
- **Checks:** every node, binding and dependency, before and after the lock, and on all 12 codes.

**Live findings fixed in the page objects:**
- **Checklist create:** answers HTTP 500 on Number / YesNo / not-required questions (§2 note, DRS bug reported).
- **Min Unit:** now a dropdown labelled *Min Unit\**, found by its label.
- **Dependencies:** the control is the combobox **"Add a preceding inspection point"**. Options read `<serial> — <name>  <path>`, e.g. *L.1.1.1 — PC03.1.1 Checkpoint a  PC03 Sub Package › PC03.1 Activity › PC03.1.1 Sub Activity*.
- **Long tree:** a row's menu opened off-screen, so the row is centred before its menu opens.

## 7. Verified in Pulse (pulse-uat, 2026-10-15)

`tests/integration/IN16_rfi_checklists_dependencies.spec.js`, 3/3 passed (11 min).

**Ground:**
- **Project:** AUTO-Solar-15102026-OVF, Work Area **BL06 S-v3** (pinned to Automation Site 01 v3).
- **Users:** IN01 batch 224 (CI `CIDRSwgkUser224`, EE `EEDRSkbiUser224`, QI `QIDRSoitUser224`), mapped by WAM on BL06 S-v3 (Civil).
- **Expected questions** were read live from the DRS Checklists Configurator: checklists 1–6 have 6 / 17 / 16 / 7 / 18 / 17 questions.

| Chain | Check | Result |
|---|---|---|
| PC03.2.1 | P1: b before a | **blocked**, *"Validation Error — Missing an RFI for Dependent Inspection Point: PC03.2.1 Checkpoint a of the Activity: PC03.2 Activity"* |
| | P3/P4: a (Checklist 1) | 6 questions in Pulse = 6 in DRS, all texts shown; **RFI-…-BL06 S-v3-CIV-0**, approved by EE + QI |
| | P1: c before b | **blocked** (missing RFI for Checkpoint b) |
| | P2/P3: b (Checklist 2) | released after a approved; 17 = 17; **CIV-1**, approved |
| | P2/P3: c (Checklist 3) | released after b approved; 16 = 16; **CIV-2**, approved |
| PC03.2.2 | P1: b before a, c before b | **blocked** both times |
| | a / b / c (Checklists 4 / 5 / 6) | 7 = 7, 18 = 18, 17 = 17; **CIV-3 / CIV-4 / CIV-5**, each approved by EE + QI |

**What it proves:**
- **Dependencies:** the a → b → c chain configured in the DRS catalog is enforced by Pulse.
- **Checklists:** each checkpoint loads **its own** bound checklist (new, fork, and fork of fork), with every question.
- **RFIs:** each one is created and approved.

The blocked attempts used throwaway work sections (R01-T01, R03-T09); each real chain shared one (R02-T07, R03-T05).

## 5. Order of work

1. `ChecklistsConfiguratorPage` (new / fork / read back) and the dependency step on `PackagesConfiguratorPage`.
2. Wire both into the site catalog build in `catalog_site_versions.spec.js` (steps 3 and 5 of §3), then run it: Automation Site 01 v3.
3. Pin a Work Area with no records to the new version: a new area in an existing project, or an unused one. (`npm run drs:setup` makes a fresh project with one area per locked site version; a convenience, not a requirement.)
4. Pulse: IN01 / IN15-style WAM, then the P1–P4 spec.
