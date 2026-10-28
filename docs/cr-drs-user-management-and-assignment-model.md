# CR set: user management and WAM move to DRS; assignees are picked at creation

**Status:** recorded 2026-10-27, before any code change. This doc is the plan
for the update; nothing below has been explored live yet.

**Deployed on:** `drs-dev` and `pulse-qa`. Other environments (`pulse-dev`,
`pulse-test`, `drs-uat`) are assumed to still run the old model until stated
otherwise. That split matters for the suite (see §5.1).

---

## 1. The change requests (client side, as given)

| # | CR | Summary |
|---|---|---|
| CR1 | **User management** | User creation moves from PULSE to **DRS Common User Management**, for **all roles**: Admin, Cluster Admin, Site Admin, Plot Admin, PM, EL, QL, CM, EE, QI, CI. The app owner corrected an earlier assumption on 2026-10-27 that the admin tiers would stay in PULSE. |
| CR2 | **Work Area Mapping** | WAM stays mandatory, but it lives in DRS. Selecting a Work Location **includes every Work Area in it by default**; authorized users can **exclude** specific Work Areas. |
| CR3 | **Multiple users** | Several users of the **same role** can be mapped to the **same Work Area** within a Work Location. |
| CR4 | **Multiple roles** | One person can hold **several roles**, and operates under **one active role at a time**. |
| CR5 | **RFI/NC persona selection** | While creating the request, the creator selects all personas involved in the flow. |
| CR6 | **Stored assignment** | The selected assignees are **stored on the record**. They are not recalculated from the current mappings. |
| CR7 | **Reporting and migration** | Pending lists, dashboards, reports, assignment history and existing records must stay consistent with the new assignment model. |

---

## 2. Old model vs new model

| Area | Old (what the suite is built on) | New |
|---|---|---|
| Where users are created | PULSE `/users/list`, Add User dialog (`UserManagementPage`) | DRS Common User Management (the `auth-mgmt-<env>` app, which already hosts Vendors since 2026-10-01) |
| Where WAM is done | PULSE `/wam`, Add Details dialog, one row per Work Area, opt-in per row (`WAMPage`) | DRS. Picking a Work Location includes all its Work Areas, and you exclude the ones you don't want (opt-out) |
| Users per role per Work Area | CI, QI and EE rows hold **one** user, so a pick **evicts** the incumbent (§3.7 of the conventions doc). Multi-assignee rows are capped at 3 by the suite (§3.7a) | Many users of the same role can share a Work Area |
| Roles per person | One account = one role. It is baked into the name prefix (`CISL…`), the fixture key, the `.env` key (`CI_EMAIL`) and the session | One account, many roles, one active at a time |
| Who works on a record | Anyone mapped by WAM to the area/package (any mapped EE or QI sees it) | Exactly the users the creator picked, stored on the record |
| How the QI is chosen | Nobody picks one. EE approval just submits, and every QI mapped to the area/package gets the record | The creator picks it at creation. EE approval is unchanged |
| Effect of remapping on existing records | Already a snapshot (specs 47/49/54/55). A **new** record took the **current** WAM holder | Stored selection. A new record takes **whoever the creator picks** |

---

## 3. Impact on the suite, per CR

These are the main touch points, not a full list. The full inventory with line
numbers was gathered on 2026-10-27, and each implementation phase should re-grep
its own area before editing.

### CR1 — user creation in DRS, all roles

- **Becomes obsolete on the new model:** `tests/pages/UserManagementPage.js`
  (PULSE Add User) and `DashboardPage.navUsers`.
- **Single creation choke point:** `tests/utils/smoke-user-factory.js`
  `createSmokeUser`. Every created user goes through it, including
  `ensureSmokeUsers` self-heal (`tests/utils/smoke-users.js`), which roughly 25
  SM stages call. **Swapping this one function to a DRS implementation covers
  most of the suite.**
- **Specs that ARE user creation:** `specs/12_user_management`,
  `smoke/SM01_user_creation`, `smoke/SM10_user_management`,
  `specs/40_reassign_fleet_setup`, `integration/IN01_users` (also run by
  onboarding).
- **Add User checks inside other specs:** `online-role-regression.js` section
  "5. USERS" (Add User icon visibility per tier, PAD work-location
  jurisdiction), `specs/33_negative_authorisation` (Users route allow/deny), and
  seven `tests/specs/inspection/00_inspect_*` specs.
- **Fixtures:** `last-created-users.json` records a PULSE `baseUrl` per user, and
  that URL decides the user's environment (`user-counter-utils.js`). DRS-created
  users need the **PULSE** env they're for recorded, not the DRS host.
- **Reusable on the DRS side:** `tests/drs/pages/UserManagementVendorPage.js`
  already logs in to `auth-mgmt` (own host, own login, tabs Users · Roles ·
  Vendors) and has a find-or-create pattern. `tests/config/drs-environments.js`
  has `userManagementUrl`, but **`auth-mgmt-dev` is marked NOT VERIFIED**, and
  `drs-dev` is exactly where this CR landed.

### CR2 — WAM in DRS, include all and exclude some

- **Becomes obsolete on the new model:** `tests/pages/WAMPage.js` (whole
  per-row include model), `tests/utils/smoke-wam.js`, `DashboardPage.navWAM`.
- **Single prerequisite choke point:**
  `tests/utils/smoke-prereqs.js` `ensureWorkAreaMapping`. Twelve SM stages, the
  integration specs and `OB03` call it. Like CR1, re-implementing it against
  DRS covers most callers.
- **Specs that ARE WAM:** `specs/06, 07, 13, 18, 25, 26, 27, 28`,
  `smoke/SM03, SM04, SM11, SM12, SM13, SM19, SM20, SM21, SM22, SM27`,
  `onboarding/OB03_pulse_wam`.
- **Semantics flip:** "demap" (Clear value on a row) becomes "exclude", and
  "assign only the areas the chain names" (SM03) becomes "include the Work
  Location, then exclude the rest". A Work Area added to a Work Location later
  (for example `OS01` importing new areas) is **automatically included** for
  everyone mapped at that Work Location. That needs a dedicated check.
- **Ground allow-lists** in `tests/config/projects.js` (`smokeMappedWorkAreas`,
  `featureGround.*`) assume opt-in. Under opt-out they become the areas to
  *keep*, and everything else is excluded.

### CR3 — several users of the same role on one Work Area

- **Rules that go away:** single-assignee eviction (conventions §3.7,
  smoke-framework R3), the multi-assignee cap of 3 (`WAMPage.enforceRowCap`,
  §3.7a), and `multi:false` throughout `smoke-wam.js`, `smoke-prereqs.js`,
  `smoke-users.js` and the SM WAM stages.
- **Ground design that existed only to avoid eviction:** the solar band shift to
  BL03–BL06 (decision log 2026-09-03), `featureGround.wamSweep`/`wamMutate`,
  the isolation rules in `reassign-fleet.js`, and the single shared user set in
  `integration/drs-profile.js`. These can be simplified, **but only after the
  old-model environments stop being targets** (§5.1).
- **Specs whose setup assumes "one CI per area":** reassign `47`, `49`, `54`,
  `55`. States like "nobody mapped to the area" now need explicit setup.

### CR4 — one person, several roles, one active

- **Nothing in the suite switches roles today.** There is no role chooser in
  `LoginPage`, and every helper derives behaviour from a role passed in
  (`helpers.js` `loginAsRole`, `loginFreshRoleSession`, `loginAsFlowUser`: the
  PWA wait and the jump to My Tasks are both decided by role).
- **Role is baked into identity:** the fixture is keyed by prefix → one entry
  with one `role` (`last-created-users.json`, `resolveSmokeUsers`,
  `drs-profile.drsUsers`, `reassign-fleet.json`). `.env` has one account per
  role (`CI_EMAIL`, …). `smoke-prereqs.wamFiltersFor` reads the WAM role filter
  from `user.role`.
- **Per-role screen checks that assume one role per account:** `specs/31`,
  `SM17` (menu per tier), `online-roles/*` and `SM18`, `specs/33` (route
  matrix), `WAMPage`'s read-only own-role field.
- **New behaviour to test:** switching the active role changes the menu,
  pending list, dashboard and create rights. A record assigned to the user as
  EE must not show under their QI role (to confirm).

### CR5 — creator picks the workflow users, QI included

- **No assignee fields exist** in `RFICreatePage` or `NCCreatePage`.
  `NCCreatePage.vendorNameDropdown` is a vendor, not a workflow user.
- **Every creation call site** must pass assignees: `rfi-flow-turns.js`,
  `nc-flow-turns.js`, `smoke-rfi-turns.js`, `smoke-nc-turns.js`,
  `rfi-smoke-walk.js`, `rfi-dependency-flow.js`, `smoke-prereqs.createSeedRfi`/
  `createSeedNc`, `linked-nc-flow.js`, plus direct callers in specs 02, 03, 14,
  20, 24, 32, 39, 42, 43, 47, SM09, SM23–SM26, SM28, OB04, OB05, IN03, IN04,
  IN15, IN16. **Make the assignees part of the RFI/NC data block** (profile and
  `projects.js`), defaulting to the run's own CI/EE/QI. Then most call sites
  only need the data, not new code.
- **NC has five creators** (QI, EE, PM, EL, QL, conventions §3.8c). Each one now
  also picks assignees. Which roles an NC needs is still to be confirmed (§6).
- **Linked NC raised from an RFI review** (`RFIReviewPage.fillLinkedNc`): check
  whether it gets its own assignee fields.
- **EE approval:** the EE screen is unchanged; it never had a QI pick, and
  `RFIReviewPage.approve()` stays as it is. What's new is an assertion: after
  EE approval, the RFI is in the **chosen** QI's pending list and **not** in
  another QI's mapped to the same area.

### CR6 — assignees stored on the record

- The WAM demap/patch specs (`25–28`, `SM19–SM22`) only check that the WAM row
  persists. They don't break; they're where to add "remapping or excluding does
  not move existing records".
- **Specs that already assert the snapshot**: `47` S1, `49`, `54` S1, `55`. These
  stay valid, reframed as "stored selection".
- **Specs whose premise conflicts:** `47` S2 and `54` S2 ("a new record after
  the remap carries the NEW holder"). Under CR5/CR6, the new record carries
  whoever the creator picked. These need rewriting, not just re-running.
- **Reassign setup** `42`, `43`, `reassign-records.js` (`NC_CREATOR = 'QI_D'`)
  and the fleet arms in `reassign-fleet.js`: the records got the right
  assignees by being raised on a WAM cell. Now they get them by explicit
  selection.

### CR7 — pending lists, dashboards, reports, history, migration

- **Reassignment:** `ReassignPage` (eligible-assignee list), `reassign-*.js`,
  specs `11`, `SM14`, `40–55`. Eligibility came from Add User provisioning plus
  WAM (`reassignment-scenarios.md` §1.2). Re-derive it once both live in DRS.
- **Pending lists:** `rfi-nav.openFromPendingWithMe`, `nc-nav.js`,
  `MyTasksPage`, `reassign-rfi-ops.rfiQueueHas`, `online-role-regression.js`
  (Pending with others / Approved). Add a check that a record shows **only**
  for the chosen user, not for every same-role user on the area.
- **Dashboards:** `DashboardPage`, `DashboardFilterPage`, `SM15`, `SM16`,
  `SM17`, `SM29` (seeds by WAM scope), specs `04`, `19`, `31`, and the EL/QL
  WAM-scope exemption in `online-role-regression.js`. Decide whether counts
  follow stored assignment, mapping scope, or both (§6).
- **Reports:** `ReportsPage`, `online-role-regression.js` reports section, gap
  G-11.
- **Assignment history:** not covered by anything today.
- **Migration: no specs exist.** The nearest are `47` S4 and `54` S4 (an
  explicit reassign moves an old record). Records and mappings carried over from
  the PULSE model are untested.

---

## 4. Docs and rules this CR set makes stale

Update these when the matching code lands. Don't delete history; mark entries as
superseded, with the date.

| Doc | Sections |
|---|---|
| `app-owner-decisions-and-conventions.md` | §3.6 (per-tier role restriction and row granularity: re-measure on DRS), §3.7 (single-assignee eviction), §3.7a (row cap), decision log 2026-09-03 (band shift because of eviction) |
| `smoke-e2e-framework.md` | §3 stage map (SM01 users, SM03 WAM), R3 ground rule (WAM CI+QI evicts), §4 ground allocation, the 2026-09-09 users-file and self-heal section |
| `wam-crud-coverage.md`, `wam-hierarchy-business-logic.md` | whole files describe PULSE WAM |
| `rfi-business-logic.md` | §2 (WAM decides who sees the RFI), §8 (role hierarchy), §9 (tiles per role) |
| `reassignment-scenarios.md` | §1.2–§1.3 (eligibility from Add User, snapshot from WAM), §2 fleet tables, Family S, §3f, §3h |
| `work-region-hierarchy.md` | §2b (WAM decides participation), §8 |
| `drs-pulse-integration.md` | IN01 = PULSE Add User, §9 Phase 2 items 1–2, Round 6 (still the useful reference for `auth-mgmt`) |
| `drs-onboarding-suite.md` | §1 table (IN01, OB03), §4 |
| `automation-coverage-and-gaps.md` | G-13, G-19, G-27 (Add User), G-11 (reports); new gaps for multi-role, migration and assignment history |
| `mobile-view-rfi-flow.md` | the CI → EE → QI cycle description |

---

## 5. How to carry this through the suite

### 5.1 The environment split comes first

The CRs are live on `pulse-qa` + `drs-dev` only. The suite also targets
`pulse-dev`, `pulse-test` and `drs-uat`, and the conventions doc says specs
1–31 must keep working unchanged. So the change cannot be a straight swap.

**Proposal:** add an `assignmentModel: 'pulse-wam' | 'drs'` setting per
environment in `tests/config/environments.js`, and let the two choke points
dispatch on it:

- `createSmokeUser` → PULSE Add User, or DRS User Management;
- `ensureWorkAreaMapping` → PULSE WAM, or DRS WAM (include/exclude).

PULSE-only specs (12, SM01, SM10, the WAM specs) are skipped with a clear
reason on a `drs` environment instead of failing. When every environment has
moved, the PULSE branch and its rules (eviction, cap, ground bands) are retired
in one go.

### 5.2 Phases

| Phase | Work | Output |
|---|---|---|
| 0. Recon | Read-only inspection specs on `drs-dev` + `pulse-qa`: the DRS User Management Users tab (create form, roles, multi-role), DRS WAM (include/exclude UI and request), the RFI and NC create forms' new assignee fields, the EE approval screen, a role switcher after login, and a multi-role user's pending list. **Ask before multi-round exploration** (standing rule). | Findings appended to this doc, §7 |
| 1. Config | `assignmentModel` per environment; verify `auth-mgmt-dev`; confirm `pulse-qa` ↔ `drs-dev` pairing | `environments.js`, `drs-environments.js` |
| 2. Users in DRS | `DrsUserManagementPage` (Users tab, find-or-create); DRS branch of `createSmokeUser`; fixture records the PULSE env the user is for; multi-role entries (one person, a list of roles) | page object, factory, fixture shape v3 (back-compatible) |
| 3. WAM in DRS | `DrsWamPage` (Work Location include, Work Area exclude); DRS branch of `ensureWorkAreaMapping`; ground lists become keep-lists | page object, prereqs |
| 4. Assignees at creation | Assignee fields in `RFICreatePage` / `NCCreatePage` (plus linked NC if present); assignees in the RFI/NC data blocks, defaulting to the run's own users; all creation call sites pass them through | page objects, data blocks, flow helpers |
| 5. Active role | Role switch in `LoginPage` / helpers; `loginAs(user, role)`; offline/PWA handling decided by the active role | helpers |
| 6. New coverage (in `tests/specs/` first, then promoted to smoke) | (a) two same-role users on one area, record goes only to the chosen one; (b) after EE approval the RFI reaches only the QI the creator picked; (c) remap or exclude after creation doesn't move the record; (d) a new area added to the Work Location is auto-included; (e) multi-role user: per-role menu, pending list and dashboard; (f) pending/dashboard/report counts under the new model; (g) assignment history; (h) records created before the cut-over still route and report correctly | new specs |
| 7. Rework conflicting specs | 47 S2 and 54 S2; reassign setup 42/43 and fleet arms; reassignment eligibility | spec edits |
| 8. Docs | §4 table; mark superseded rules with the date | doc edits |

Phases 2–4 are what unblock everything else on `pulse-qa`. Without them, no
stage can create users or records there.

---

## 6. Open questions for the app owner

1. **Which roles does each request need?** RFI: CI, EE, QI? Does the CI creator
   pick themself, or is it implied? NC: which reviewers, and does it differ
   per creator (QI / EE / PM / EL / QL)?
2. **Is the assignee list filtered by mapping?** Can the creator only pick users
   mapped to that Work Area (with the role active)? What happens if a picked
   user is excluded or unmapped afterwards: does the record stay with them (CR6
   says yes), and can they still act on it?
3. **Linked NC from an RFI review:** does it get its own assignee fields?
4. **Multi-role login:** is the active role chosen at login, switched from a
   menu, or both? Does a pending list show records for the active role only?
5. **Which roles can exclude Work Areas** in DRS WAM ("authorized users")?
   Does the per-tier assign restriction (§3.6) still apply in DRS?
6. **Dashboards and reports:** do counts follow the stored assignee, the
   mapping scope, or both? For EL/QL/PM, who are not assignees on a record?
7. **Migration:** were existing records rewritten with stored assignees from
   the old WAM? Is there a cut-over date to pick "old records" by?
8. **Reassignment:** is it still in PULSE? Does its eligible list come from the
   DRS mapping?
9. **Other environments:** when do `pulse-dev`, `pulse-test` and `drs-uat` get
   this?
10. **Is the `.env` admin account** (`ADMIN_EMAIL`) also managed in DRS now, and
    is it the same login for both apps?

---

## 7. Findings log

*(Empty. Phase 0 recon results go here, dated, with the inspection spec that
produced them.)*
