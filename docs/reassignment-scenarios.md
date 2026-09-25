# RFI / NC reassignment — rules, scenarios and test design

**Status: Families R and E automated and verified live — E on pulse-qa
(2026-09-16) and pulse-test (2026-09-20), R asserted on pulse-test (2026-09-20)
after the record pool unblocked its three single-type roles. The RFI and NC
record pools are built, and Families C, H, I, B, X and S all PASS on pulse-test
(2026-09-20). Reassignment does not strand a record, the hand-off is clean in
both directions, version and code survive it, and the WAM snapshot holds.
The NC side (R, H5, I, C) also passes — see 3g — and S3, the demap hazard,
passes too (3h): demapping a work area does not strand the records it carried.
REMAINING: B2 (a closed NC), S5, demapping a USER everywhere, and mobile
(G-19).**

Everything in §1 came from the app owner directly (2026-09-15/16) or from the
"Reassignment Rules by Role" screen they supplied. Everything marked
**DISCOVERY** is an open question to be answered by a recon run before it is
asserted — the same capture-first discipline that closed the linked-NC gap
(`rfi-business-logic.md` §10).

Existing coverage: `tests/specs/11_reassign_rfi_nc.spec.js` and its smoke
replica `SM14_reassign.spec.js`. Between them they cover **one scenario, twice**:
Admin reassigns CI, then EE, then QI on one pending RFI and one pending NC, and
asserts the grid column shows the new name. Page object: `ReassignPage.js`.

---

## 1. The rules, as confirmed

### 1.1 Who may reassign whom

| Reassigner | May reassign |
|---|---|
| Contractor Manager | Contractor In-Charge |
| Execution Lead | Execution Engineer |
| Quality Lead | Quality Inspector |
| Project Manager | Execution Engineer, Quality Inspector |
| Admin (any level) | CI, EE or QI, within jurisdiction |

Constraints that apply to every row:

* **Only for RFIs not yet approved, and NCs not yet closed.**
* **Must stay within the same work location and the same role** — a CI is
  replaced by another CI, never by an EE.
* **CI reassignment must stay within the same vendor.** (EE/QI are AGEL users
  and carry no vendor.)
* The **current, a future or a past** handler may all be reassigned — there is no
  requirement that it currently be that actor's turn.

### 1.2 Three independent sets — and why the feature exists at all

This is the model everything else follows from. A user is not in one state;
three separate things are true about them at once, and **the bugs live where
they disagree**.

| Set | Written by | Governs |
|---|---|---|
| **Provisioning** — work locations × project types | Add User | **Eligibility**: who appears in the "Assign to" list |
| **WAM** — work location × work area × package (× vendor for CI) | WAM screen | **Capability**: what the user can actually see and do |
| **The record's CI / EE / QI** | a **snapshot of WAM taken when the RFI/NC was created** | who carries the record right now |

Two consequences, both confirmed by the app owner, both load-bearing:

1. **Eligibility ignores WAM entirely.** The "Assign to" list is populated from
   the candidate's *Add User* work locations and project type. A freshly created
   user with **no WAM at all** ("init only") is a legitimate assignee. WAM is
   *not* a prerequisite for being assigned.

2. **THE RECORD'S ASSIGNEES ARE FROZEN AT CREATION.** They are snapshotted from
   the WAM of (work area, package, vendor) at the moment the RFI/NC is created.
   If WAM is later changed — remapped to someone else, or demapped entirely —
   **in-flight records keep their original users**. Nothing migrates
   retroactively. An admin or lead must **reassign explicitly** to move a record
   to a newly mapped user.

   *This is the reason the feature exists.* A regression that made WAM changes
   propagate retroactively would silently re-route live work; one that dropped
   the snapshot would orphan it.

3. **CAPABILITY DOES NOT REQUIRE WAM EITHER.** App owner, 2026-09-16:
   *"yes user can resubmit/review requests irrespective of their WAM being done
   or not."* So a reassigned user is expected to complete their step — CI's
   resubmit, EE/QI's review — whether or not they are mapped into the work area.

Put together, (1), (2) and (3) mean the app will let you assign a record to
someone with no mapping at all, **and that person is expected to be able to work
it**. That makes family **C** a VERIFICATION of a stated requirement rather than
an open question — and it is still the family most worth running, because CI's
resubmit goes through the create form's page-1 edit, whose dropdowns are
re-derived from WAM. If anything contradicts the rule, that is where it surfaces:
the record would have left its old assignee and the new one could not act, i.e.
a stranded record.

### 1.3 Other confirmed facts

* **Reassignment does not touch the version.** The version changes only when the
  CI resubmits a record. A version bump on reassignment would be a defect.
* **The hand-off is immediate.** The record disappears from the old assignee's
  queue and appears in the new assignee's, in *Pending with me* or *Pending with
  others* according to its current status.
* **No audit trail on the UI.** Every action and actor is written to the
  database's audit log, but nothing is exposed on screen — so there is nothing
  for a test to assert here, and no spec should be written for it.
* **Packages — USE `Civil` AND `Electrical` ONLY.** Wherever a scenario needs a
  package combination (a "different package" arm, a cross-package WAM), it must
  be drawn from those two and no others. **`Mechanical` is never to be used
  here**: it exists for the **wind** project type only (app owner, 2026-09-16).
  This applies to every family below and to the fleet in §2.
* **Ground**: any work location inside the **Khavda** site. Khavda carries 73
  work locations across solar / wind / bess / infra / pss, so `WTG-Khavda`
  (wind) sits in the same site as the solar locations — which is what makes the
  multi-project-type case (EE-B below) reachable without leaving Khavda.
* **Add User's Work Locations list is NOT filtered by Project type** — at least
  for Contractor Manager, where the app owner's screenshot (2026-09-16) shows
  `S05b, A-06c, WTG-Khavda` offered together, wind alongside solar. So a member's
  work-location set can be built directly and project type does not need to be
  reasoned about as a gate on it.
* **WAM is re-doable at will** (app owner): a mapping that lands wrong can simply
  be redone, so fleet setup need not treat a mis-map as unrecoverable.

---

## 2. The candidate fleet

The record under test is an **RFI on A-06c / BL01 / Civil / Solar**. For the CI
scenarios it is deliberately left **rejected and pending with CI**, because that
forces the new CI down the resubmit path — the create form's page-1 edit — which
is where a WAM mismatch would actually bite.

### 2.1 CI candidates (VENDOR type, same vendor as the record unless stated)

| id | Add User locations | WAM | What it probes |
|---|---|---|---|
| `CI-A` | A-06c | **none** (init only) | The app owner's "init is enough" claim, at its purest |
| `CI-B` | A-06c **and** S05b | **S05b / Electrical only**, with live Electrical RFIs of its own | **The headline case.** Eligible via A-06c, but every mapping it owns is in another location *and* another package |
| `CI-C` | A-06c, S05b | A-06c / Civil / BL01 | **Control arm** — must work end to end, or the other rows prove nothing |
| `CI-D` | A-06c | A-06c / **Electrical** | Right location, wrong package |
| `CI-E` | A-06c | A-06c / Civil / **BL07** | Right location and package, wrong work area |
| `CI-F` | **S05b only** | any | Negative — must **not** be eligible (same-work-location rule) |
| `CI-G` | A-06c, **different vendor** | any | Negative — must **not** be eligible (vendor rule) |

### 2.2 EE and QI candidates (AGEL type, no vendor — one set each)

| id | Add User | WAM | What it probes |
|---|---|---|---|
| `EE-A` | A-06c (solar) | none | Init-only baseline |
| `EE-B` | A-06c (solar) **and WTG-Khavda (wind)** | solar only | **Multi-project-type user.** Does a wind provisioning entry disturb a solar reassignment? |
| `EE-C` | A-06c, S05b | **S05b / Electrical only**; A-06c is init-only | Mapped in one location, init-only in the one that matters |
| `EE-D` | A-06c | A-06c / Civil / BL01 | Control arm |

`QI-A`…`QI-D` mirror these exactly.

---

## 2c. The record pool — records are created by a SETUP STAGE, not by the specs

App owner, 2026-09-20: *"create RFI by login users, don't wait — someone else
will feed; specs design should be such kind: all RFI are being created first,
then reassignment test starts"*, and then *"same applies for NC also — specs of
reassignment should start from NC creation first."*

So record creation is its own stage and the behaviour specs create nothing:

| file | raises | as | store |
|---|---|---|---|
| `42_reassign_rfi_records_setup.spec.js` | 7 RFIs | `CI_C` | `fixtures/reassign-records.json` |
| `43_reassign_nc_records_setup.spec.js` | 3 NCs | `QI_D` | same file, separate `nc` sub-object |

Definitions and the store API live in `tests/utils/reassign-records.js`; a
behaviour spec calls `claimRecord('rfi' | 'nc', key)` and gets a record or an
error naming the setup command to run.

**Why the split is worth having.** A spec that creates its own subject merges
two different reds: *"reassignment is broken"* and *"we could not build a record
today"*. Here the second fails in setup, alone, carrying the RFI/NC form's own
error.

**ORDER: RFIs FIRST, NCs SECOND.** A non-approved NC blocks RFI create for the
same (inspection checkpoint, work section) — rule R2a, asserted live by SM28.
Raising every RFI first keeps the NCs out of their way. A later run that needs to
ADD an RFI on this ground may be refused for that reason; that is the rule
working, not a defect.

**ONE RECORD PER PURPOSE, NEVER SHARED.** Families C, H, S and I each mutate what
they touch, a reassignment cannot be undone from the UI, and Family S rewrites
WAM — so a shared record would make one spec's starting state depend on whether
another ran.

**Built on pulse-test 2026-09-20** (A-06c / Civil / BL07, all consecutive, so
they are genuinely submitted records and not drafts):

| RFI | | NC | |
|---|---|---|---|
| `R_READ` | `RFI-A-06c-BL07-CIV-32` | `R_READ_NC` | `NC-A-06c-BL07-CIV-39` |
| `H_HANDOFF` | `-33` | `H_HANDOFF_NC` | `-40` |
| `C_CI_UNMAPPED` | `-34` | `C_QI_UNMAPPED_NC` | `-41` |
| `C_CI_FOREIGN` | `-35` | | |
| `C_EE_UNMAPPED` | `-36` | | |
| `S_SNAPSHOT` | `-37` | | |
| `I_INTEGRITY` | `-38` | | |

Every record carries the fleet's control arms (`CI_C` / `EE_D` / `QI_D`) as its
CI/EE/QI, snapshotted from BL07's WAM at creation. That is the point: Family C
then asks whether a DIFFERENT candidate can take one over and actually work it.

### Both halves recorded a placeholder as the code on the first pass

The same bug twice, wearing different clothes, and both were already solved
elsewhere in the suite — the cost of writing a new creation loop instead of
reusing the proven readers.

* **RFI's placeholder is the literal word DRAFT.** Four of seven recorded as
  `RFI-A-06c-BL07-CIV-DRAFT`: the code is assigned server-side a moment after
  submit, and the breadcrumb had not caught up. Fixed by reading through
  `getVisibleCodeFor` (dashboard-first re-read, which is what actually clears the
  stale state) and asserting the result is not a DRAFT.
* **NC's placeholder is THE LAST FOUR CHARACTERS OF THE RECORD'S UUID** —
  `NC-A-06c-BL07-CIV-9fbd`. It contains no "draft", so an `/draft/i` guard sails
  straight past it; the shape check (*a finalized code ends in its numeric
  counter*) is what catches it. Fixed by reusing `smoke-nc-turns.readNcCode`,
  which polls the id until the code finalizes — that file solved this on
  2026-09-03.

Both setups now **REPAIR rather than RE-RAISE**: an entry holding a placeholder
is a real record that lacked a code, so its code is re-read from the id. Raising
a replacement would have consumed a second Work Section and stranded the first —
the ground cost here is permanent.

### One incidental finding

**Defect Type is activity-scoped.** `Workmanship defect` — the value
`14_nc_create_qi` and `39_nc_bulk_create_qi` both use — is not offered for
`Piling - Robotic Docking System` on BL07; the page fell back to
`Anchor bolt damage` and said so. Irrelevant to reassignment, but it contradicts
the assumption baked into the NC data constants that defect types are global.

## 3. Scenario families

Each family states what it proves and what it would cost if the behaviour broke.
**Three probes are kept strictly separate** and never collapsed into one
assertion, because they can fail independently:

* **P1 Eligible** — does the candidate appear in "Assign to"?
* **P2 Hand-off** — does the record leave the old queue and arrive in the new one?
* **P3 Capable** — can the new assignee actually complete their step?

### Family R — who may reassign what

Log in as each reassigner role, open the modal on an eligible record, and read
what **"Select Assignee Type"** offers.

| id | Reassigner | Must offer | Must **not** offer |
|---|---|---|---|
| R1 | Contractor Manager | CI | EE, QI |
| R2 | Execution Lead | EE | CI, QI |
| R3 | Quality Lead | QI | CI, EE |
| R4 | Project Manager | EE, QI | CI |
| R5 | Admin | CI, EE, QI | — |

The **negative** half carries the value: a leak here lets a Quality Lead
re-route contractor work. Cheap to run — near read-only, one login per role.

Per the app owner, Admin needs only the light check already covered by spec 11
(the reassignment goes through and the grid name changes); the Cluster / Site /
Plot Admin jurisdiction tiers are **not** in scope for this pass.

### Family E — is the "Assign to" list correct?

| id | Assertion |
|---|---|
| E1 | Excludes the current assignee *(already covered by spec 11)* |
| E2 | `CI-A` (init only, no WAM) **is** listed — WAM is not a prerequisite |
| E3 | `CI-B`, `CI-D`, `CI-E` are listed — WAM in the wrong location / package / area does not disqualify |
| E4 | `CI-F` (other work location only) is **absent** |
| E5 | `CI-G` (different vendor) is **absent** |
| E6 | Only users of the matching role appear for the chosen type |
| E7 | `EE-B`'s wind provisioning does not exclude it from a solar record |
| E8 | The "nothing eligible" case is reported deliberately, not skipped past (SM14 currently just skips) |

### Family H — the hand-off

| id | Scenario |
|---|---|
| H1 | Reassign the **current** actor (RFI with EE, reassign EE): leaves old EE's *Pending with me*, appears in new EE's |
| H2 | Reassign a **future** actor (RFI with EE, reassign QI): takes effect when the record reaches QI |
| H3 | Reassign a **past** actor (RFI with QI, reassign CI): a later rejection must land on the **new** CI |
| H4 | The record lands in the correct tile — *Pending with me* vs *Pending with others* — per its status |
| H5 | NC equivalents of H1–H4 |

### Family C — capability after reassignment ← **the most important family**

**The expected outcome is now stated, not open** (§1.2 rule 3): a reassigned user
can resubmit or review **irrespective of WAM**. So every row below should PASS.
That does not make the family less worth running — it makes it a regression test
of an explicit requirement, and the one place a stranded record could appear.

This is where "eligible but unable" would show up.

| id | Candidate | Probe |
|---|---|---|
| C1 | `CI-C` (control) | Opens the rejected RFI, page-1 edit is fully populated, resubmits successfully |
| C2 | `CI-A` (no WAM) | **Can an unmapped CI resubmit at all?** Does page 1 reconstruct Work Location / Work Area / Package / Sub-Package / Activity / Work Section? |
| C3 | `CI-B` (WAM in S05b/Electrical) | Same probe, with every mapping pointing somewhere else. **DISCOVERY** — dropdowns are re-derived from WAM, so this may render a form that cannot describe its own RFI |
| C4 | `CI-D`, `CI-E` | Wrong package / wrong area |
| C5 | `EE-A`, `EE-C` | Does an unmapped or elsewhere-mapped EE see the record in *Pending with me*, open the review page, and approve? |
| C6 | `EE-B` | Does the wind entry change anything for a solar record? |

If any of C2–C6 cannot complete their step, **reassignment can strand a
record**: it has left the old assignee and the new one cannot act. That
finding, if it occurs, is the most valuable output of this whole effort, and it
must be reported with the exact screen state rather than inferred.

### Family S — WAM changes vs the frozen snapshot

Direct tests of §1.2(2).

| id | Scenario |
|---|---|
| S1 | RFI created with CI = X (from WAM). Remap the area to CI = Y. **The in-flight RFI still shows X and stays in X's queue.** |
| S2 | A **new** RFI created after that remap gets Y — proving the remap took effect and S1 is about the snapshot, not a failed remap |
| S3 | **Demap** the CI entirely, so nobody is mapped. The in-flight RFI still carries X, and X can still act on it |
| S4 | After the remap, reassign the old RFI X → Y explicitly. It moves — reassignment is the migration path WAM is not |
| S5 | EE / QI equivalents of S1–S4 |

S3 is the sharp one: if demapping strands in-flight records, that is a live
operational hazard, and it interacts with the existing WAM demapping specs
(`25_wam_demapping`, `27_wam_demapping_hierarchy`), which do not currently check
what happens to records the demapped user was carrying.

### Family B — when reassignment must be refused

| id | Scenario | Expected |
|---|---|---|
| B1 | Approved RFI | Not reassignable — **DISCOVERY**: is the icon absent, disabled, or does it error on submit? |
| B2 | Closed NC | Not reassignable |
| B3 | Draft RFI | **DISCOVERY** — unknown whether a draft is even reachable from these lists |

### Family I — integrity across the swap

| id | Assertion |
|---|---|
| I1 | **The version is unchanged.** Per the app owner it changes only on CI resubmission, so a bump here is a defect |
| I2 | Observations, remarks and attachments are unchanged |
| I3 | The RFI / NC code is unchanged |
| I4 | After reassigning CI, an NC raised later from that RFI goes to the **new** CI — **DISCOVERY** |

### Family X — edges

| id | Scenario |
|---|---|
| X1 | Cancel the modal → nothing changes |
| X2 | Reassign twice (A → B → C) → the last wins, and B no longer holds it |
| X3 | Mobile reassign — named explicitly as uncovered in gap **G-19** |

No audit-trail scenario: §1.3 confirms there is nothing on the UI to assert.

---

## 3a. Phase 0 findings (recon, pulse-qa, 2026-09-16)

`tests/specs/inspection/00_inspect_reassign_permissions.spec.js`, run against the
purpose-built fleet (§5). Read-only — it never submitted a reassignment.

### Confirmed

* **An approved RFI exposes NO reassign control.** The Approved list rendered
  16 view icons and **0** reassign icons. Discovery item **B1 answered**: the
  refusal is by absence of the control, not by a later error.
* **A reassigner with no WAM sees nothing to reassign.** The Contractor Manager
  — created and login-verified, but unmapped at the time — got an **empty**
  "Pending with others" list. Mapping gates visibility, so every reassigner in
  the fleet needs one.

* **THE VENDOR-SIDE ROLES NEED A SERVICE ORDER IN THEIR WAM FILTERS**, and
  without it WAM silently offers no rows at all rather than complaining. With
  `serviceOrder = "M S CHOUHAN INFRAVENTURES"` the Contractor Manager went from
  **0 rows to 38** for the identical location and package. `Contractor Incharge`
  is gated the same way, so this governs the entire CI candidate group, not one
  member. Encoded as `serviceOrderFor()` in `tests/utils/reassign-fleet.js`;
  the authority is `18_wam_hierarchy.spec.js`'s per-role filter table:

  | WAM granularity | roles |
  |---|---|
  | work **area** rows | Execution Engineer, Quality Inspector, Execution Lead, Quality Lead, **Contractor Incharge †**, **Contractor Manager †** |
  | work **location** rows | Project Manager, Plot Admin |
  | **site** rows | Site Admin |

  † require a Service Order before any row appears.
* **Admin's type list is exactly the three roles**: `Contractor Incharge`,
  `Execution Engineer`, `Quality Inspector`.
* **Single-type roles get NO type dropdown.** The modal adapts to the reassigner:

  | role | dropdowns | label | contents | vs §1.1 |
  |---|---|---|---|---|
  | Contractor Manager | 1 | `Select contractor` | people (6) | ✅ CI only |
  | Execution Lead | 1 | `Select engineer` | people (14) | ✅ EE only |
  | Quality Lead | 1 | `Select quality inspector` | people (7) | ✅ QI only |
  | Admin | 2 | type, then `Assign to` | types (3), then people | ✅ all three |
  | Project Manager | 1 | `Choose assignee to change` | **types** (2) | ❌ see below |

  The three single-type roles each offer exactly their own role's people, and
  the Contractor Manager's six names are **the same six** Admin lists under
  "Contractor Incharge" for that record. That mutual agreement is what makes the
  Project Manager row a genuine outlier rather than noise.

  So Family R's assertion must be **role-shaped**: for EL/QL, assert there is no
  type choice AND that the people offered are of the right role; only PM and
  Admin have a type list to check. A test that blindly reads
  `[role="combobox"].first()` reads PEOPLE for EL/QL and would report a
  permission leak that does not exist — that happened on the first pass here.

### CANDIDATE DEFECT — Project Manager's type list contradicts the rules

The rules say **Project Manager → Execution Engineer, Quality Inspector**. Live,
its `Choose assignee to change` dropdown offers:

```
["Contractor Incharge", "Execution Engineer"]
```

— i.e. **Contractor Incharge is offered** (a PM should not be able to re-route
contractor work) and **Quality Inspector is missing** (a PM should be able to
reassign QIs). Eligible QIs do exist for that record: Admin saw 7 for the same
RFI moments earlier, so this is not an empty-candidate-list artefact.

**Reported as a CANDIDATE, not a defect**, because one question is unresolved
and only the app owner can settle it: is the "Reassignment Rules by Role" screen
the specification the app should meet, or is the app's current behaviour the
intended rule? If the screen is authoritative this is a real authorisation
defect on both sides — one permission granted that should not be, one withheld
that should be.

Reproduced on two separate runs (2026-09-16), the second after the Contractor
Manager had been mapped, so it is not a fleet-state artefact.

Evidence: `test-results/reassign-permissions/04-assignee-types-per-role.json`.

## 3b. Family E results — VERIFIED LIVE 2026-09-16

`tests/specs/41_reassign_eligibility.spec.js`, 5/5 passed on pulse-qa against the
18-member fleet. **Read-only**: it opens the modal, reads the list and closes
without submitting, so it needs no ground and cannot strand a record.

**THE RULE IN §1.2 IS CONFIRMED — eligibility follows Add User provisioning, not
WAM.** Every candidate whose WAM disagrees with the record was still offered:

| member | provisioning vs WAM | offered? |
|---|---|---|
| `CI_A` | **no WAM at all** | ✅ |
| `CI_B` | mapped only in S05b / **Electrical** | ✅ |
| `CI_D` | right location, **wrong package** | ✅ |
| `CI_E` | right package, **wrong work area** | ✅ |
| `EE_B` | **solar + wind** provisioning | ✅ |
| `EE_C`, `QI_C` | mapped in S05b/Electrical, init-only in A-06c | ✅ |

And the two filters that DO apply both hold:

| member | why it must be excluded | absent? |
|---|---|---|
| `CI_F` | provisioned only in S05b — the same-work-location rule | ✅ |
| `CI_G` | vendor `SATYASARA ENERGY PVT LTD`, not the record's `M S CHOUHAN` | ✅ |

Also: the current assignee never appears in its own list (E1), and no candidate
appears under a role that is not their own (E6).

**Why the negative arms carry the weight.** The positive rows alone would pass
against any list that merely contains people. `CI_F` and `CI_G` are the ones that
prove a filter exists at all — they are provisioned identically to the others
except in the single dimension under test.

**What this does NOT yet show.** Being offered is not being able to work. `CI_A`
is assignable with no mapping whatsoever; whether it can then open the record and
complete a step is Family C, and it is the question this whole document is
pointed at.

## 3c. Reproduced on pulse-test — 2026-09-20

The fleet and Family E were rebuilt and re-run on **pulse-test**, and the
deployment agrees with pulse-qa on every point measured so far.

**The fleet builds identically.** All 18 members created, login-verified
(auth 200) and mapped, 0 failed — reassigners 4/4 in 4.3 min, candidates 14/14
in 15.3 min. The two qa-specific risks both turned out not to be
qa-specific: `A-06c` / Civil offers the same `BL01`–`BL08` band, and the
Contractor Manager's WAM needs (and accepts) the same
`M S CHOUHAN INFRAVENTURES` Service Order, going from 0 rows to 38 with it.
`reassign-fleet.json` keys the fleet per deployment, so the qa fleet was
untouched.

**Family E: 5/5, same verdict.** Read against `RFI-A-06c-BL01-CIV-27`, whose
CI/EE/QI are three ordinary non-fleet users. Every candidate whose WAM
disagrees with the record was offered — `CI_A` with no WAM at all included —
and the two filters that must apply did: `CI_F` (other work location) and
`CI_G` (other vendor) were both absent. So **§1.2 holds on two independent
deployments**, which is what turns it from a qa observation into a rule.

### Phase 0 recon re-run on pulse-test (2026-09-20)

`00_inspect_reassign_permissions.spec.js`, 4/4, 3.0 min. Read-only.

**THE PROJECT MANAGER ANOMALY REPRODUCES EXACTLY** — a fresh account, a fresh
fleet, a different deployment, and the identical list:

```
offers   ["Contractor Incharge", "Execution Engineer"]
expected ["Execution Engineer", "Quality Inspector"]
UNEXPECTED: ["Contractor Incharge"]   MISSING: ["Quality Inspector"]
```

That moves it off "possible qa data quirk" and onto **product behaviour on two
independent deployments**. It is still a CANDIDATE finding for the one reason
§3a gives: only the app owner can say whether the "Reassignment Rules by Role"
screen is the specification or a stale description of the app.

Also reproduced on test: Admin offers all three types; an **approved RFI shows 0
reassign icons** against 16 view icons (B1); all four reassigners log in.

**NEW — and it blocks the CM/EL/QL arms of Family R here.** All three saw an
**empty** "Pending with others" list on pulse-test, so no modal could be opened
as any of them. This is not a defect and not an account problem: they are mapped
to `A-06c/BL07`, and **every pending A-06c record on this deployment is on
`BL01`**. A reassigner sees only records in the area they are mapped to — the
same gating §3a recorded for an unmapped reassigner, one step further along.

Consequence: Family R's three single-type rows, and all of Family C, need **a
record on `A-06c/BL07`** — the record under test §2 always described. Two things
to settle when creating it:

* It permanently consumes a Work Section on BL07.
* Its CI/EE/QI will be `CI_C` / `EE_D` / `QI_D`, the fleet's own control arms,
  because they are what WAM holds for that area. Family E currently takes the
  first A-06c row it finds, so **pin Family E to the BL01 record first** — a
  BL07 record would otherwise become its subject, and three of its "must be
  offered" expectations would correctly invert to "absent: current assignee".

### The run cost two locator fixes, both the same bug

Neither was an app defect, and both were the kind that reports a false
*absence* — see `automation-coverage-and-gaps.md` §2b.

1. **Step 0 concluded the deployment had no A-06c record.** It searched
   `ReassignPage.listRowIds()`, which reads only the rows the grid currently has
   mounted and never scrolls vertically. pulse-test had **eleven** pending A-06c
   RFIs; they sat below the fold. The failure message said to go and raise an
   RFI — i.e. it invited us to write real records to a shared environment to fix
   a problem that did not exist.
2. **Opening the record then timed out** for exactly the same reason:
   `getRowById(id).waitFor({ state: 'visible' })` on a row below the fold waits
   out its timeout and blames the row.

Fixed on the page object, so the next spec inherits it:
**`collectAllRowIds()`** (step down the whole list; use whenever an id's
*absence* is the conclusion) and **`scrollToRowById(id)`** (scroll until the row
mounts, then throw with the scanned row count — "not found among 44 rows" is a
finding, a bare timeout is ambiguous). `listRowIds()` keeps its old meaning,
"pick a row to act on", so `11_reassign_rfi_nc.spec.js` and `SM14` — which act
on a row they just created at the top — are unaffected.

## 3d. Family R results — VERIFIED LIVE 2026-09-20

`tests/specs/44_reassign_permissions.spec.js`, 5 tests, 56s on pulse-test,
read against the pool's `R_READ` record (`RFI-A-06c-BL07-CIV-32`). **Read-only**:
every case opens the modal, reads it and closes without submitting.

Family R was unblocked by the record pool. Before it, Contractor Manager,
Execution Lead and Quality Lead all saw an EMPTY list — they are mapped to BL07
and every pending A-06c record lived on BL01 — so three of the five cases could
not be measured at all.

| reassigner | type dropdown | people offered | verdict |
|---|---|---|---|
| Contractor Manager | **none** | 12, incl. 4 fleet CIs | correct |
| Execution Lead | **none** | 13, incl. 3 fleet EEs | correct |
| Quality Lead | **none** | 10, incl. 2 fleet QIs | correct |
| Admin | all three types | — | correct |
| Project Manager | `["Contractor Incharge","Execution Engineer"]` | — | **DEFECT** |

**THE PERMISSION IS ENFORCED BY ABSENCE.** A role permitted exactly one assignee
type is not offered a type choice at all — the same shape as an approved RFI
exposing no reassign icon (B1). That is a stronger guarantee than refusing the
choice on submit, and it is what the three single-type cases assert first.

**The leak arm is the one with teeth.** Each single-type role is also asserted to
offer NO fleet member of either other role. Asserting only "its own role appears"
would pass against a list that simply contains everybody — and a Quality Lead who
can re-route contractor work is precisely the bug this family exists to catch.
The assertion runs through FLEET names because those members' roles are known by
construction; the other names in the list belong to users this suite did not
create and can make no claim about.

### The Project Manager case is encoded as `test.fail()`

It asserts the rule **as the "Reassignment Rules by Role" screen states it**, and
the app does not meet it. Measured identically four times now — pulse-qa twice
(2026-09-16) and pulse-test twice (2026-09-20), on fresh accounts and a fresh
fleet both times.

`test.fail()` rather than a skip or an inverted assertion, deliberately:

* a **skip** records nothing and rots quietly;
* **asserting today's behaviour** would bake the defect in as the expectation, so
  the day it is fixed the suite would go red and blame the fix;
* `test.fail()` says exactly what is true — the rule is known, the app does not
  meet it — and **if the test ever passes, the run goes red**, which is the
  signal that the app changed and this file needs its verdict updated.

It stays a CANDIDATE finding until the app owner settles the one question only
they can: is the rules screen the specification, or is the app's current
behaviour the intended rule? See section 3a.

## 3e. Family C results — VERIFIED LIVE 2026-09-20, AND IT PASSES

`tests/specs/45_reassign_capability.spec.js`, 3 tests, 7.7 min on pulse-test.
**REASSIGNMENT DOES NOT STRAND A RECORD.** Section 1.2 rule 3 holds: a
reassigned user can do the work irrespective of WAM.

| case | candidate | probe | result |
|---|---|---|---|
| C2 | `CI_A` — **no WAM at all** | resubmit `CIV-34` | **PASS** |
| C3 | `CI_B` — mapped only in S05b/**Electrical** | resubmit `CIV-35` | **PASS** |
| C5 | `EE_A` — init-only, no WAM | review+approve `CIV-36` | **PASS** |

Each case asserts three separate things, because each failing would be a
different bug: the record REACHES the new assignee's queue, the form CARRIES ITS
OWN DATA, and the step COMPLETES.

**The middle one is the finding.** On a resubmit, page 1 is re-derived for
whoever is logged in — so the question was whether it describes the RECORD or
the USER'S MAPPINGS. Both CI cases read back:

```
A-06c · BL07 · Civil · Piling (MMS, Inverter, LT Cable Hangers) ·
Piling - MMS · Pre Pour Inspection - Pile · Micro Pile Checklist
```

for users mapped nowhere near that ground. The form describes the record. Had it
derived from WAM, `CI_B` — whose every mapping is S05b/Electrical — would have
rendered a form that could not state its own RFI, and the record would have been
unmovable with no error shown anywhere.

Both CI cases reject from **page 1** on purpose: a checklist rejection LOCKS page
1 on the resubmit, which would hide exactly what is under test.

### What this cost, and what it teaches

**Eight runs.** Every failure was the harness disagreeing with the app, and the
app was right each time. Two of them were nearly reported to developers as
stranding bugs. Recorded here because the next family will meet the same traps:

| # | The harness did | The app was actually |
|---|---|---|
| 1 | waited for a **Resubmit button on `/view`**, reached by URL | correct — a rejected row's eye icon lands straight on `/re-submit`, so no such button is ever used. Reaching `/view` by URL gives the read-only page whose only action is Close |
| 2 | read a grid **before it finished filling** | correct — the record was there |
| 3 | scrolled for a row **from the bottom** after listing | correct — 7 records listed, then 0 located |
| 4 | asked to reassign a record **to the user who already held it** | correct — the current assignee is never offered in its own list (rule E1) |
| 5 | reused ONE browser context across five logins | correct — see below |

**(5) is the one worth carrying.** After a few login switches in one context,
`EE_D`'s "Pending with me" returned exactly ONE row — the record the previous
test had touched — while a brand-new context logged in as the SAME user returned
all SEVEN. Not a load race: five polled re-navigations read the same one row.
Not the standing login rule either: `loginAsFlowUser` already clears cookies and
localStorage, and a dashboard-first refresh did not shift it. And it is not only
a reading fault — the missing row cannot be CLICKED, so the session cannot do
the work at all.

**Fixed structurally: `actAs()` opens a fresh context per role switch.** A login
costs the same either way, and it removes every form of cross-login bleed from a
spec that signs in as five different people. The cause is NOT understood, and
the comment in the spec says so rather than pretending otherwise.

**The guard that stopped the false report stays.** When a queue says a record is
absent, `isInPendingWithMe` re-checks in a fresh context before believing it —
deliberately asymmetric, because a false "present" costs a confusing failure
later while a false "absent" reads as *"the record has left its old assignee and
nobody can act on it"*, which is the one conclusion this family must never get
wrong. It fired for real on `CIV-35`:

```
NOT seen in the running session (1 rows) but PRESENT in a fresh one (7 rows)
  — session artefact, not a strand
```

## 3f. Families H, I, B, X and S — VERIFIED LIVE 2026-09-20

Two specs, both green on their first run, on pulse-test.

### `46_reassign_handoff_integrity.spec.js` — 4 tests, 2.5 min

| id | asserted | result |
|---|---|---|
| X1 | cancelling the modal changes nothing | EE stayed `RAEED39533444` |
| H1 | the record LEAVES the old assignee and ARRIVES with the new | arrived with `RAEEC…`, left `RAEED…` |
| I1 | the VERSION does not move | stayed `v1` |
| I3 | the CODE does not move | unchanged |
| X2 | A → B → C: last wins, B releases it | intermediate holder released it |
| B1 | an APPROVED RFI exposes no reassign control | 0 reassign, 6 view controls |

**H1 is asserted in BOTH directions on purpose.** "Arrives with the new
assignee" alone passes for an app that copies the record to everyone; "leaves
the old one" alone passes for an app that merely drops it. The failure that
matters — two people each believing an inspection is theirs, or nobody holding
it — lives exactly where one half holds and the other does not.

**I1 is the sleeper.** The version is what tells a reviewer whether the work in
front of them is the work they last saw; a bump on reassignment would quietly
invalidate that, and nothing else in the suite would notice.

**X1 guards a specific misdesign**: if the modal applied on SELECTION rather
than on "Assign User", backing out of a misclick would silently re-route work.
It picks a name and then closes, which is what a user actually does.

**B1 counts the reassign controls AND the view controls.** Absence only means
something once the page is known to have rendered rows at all.

### `47_reassign_wam_snapshot.spec.js` — 3 tests, 1.9 min

**THE RULE THE FEATURE EXISTS FOR (section 1.2 item 2) HOLDS.**

| id | asserted | result |
|---|---|---|
| S1 | remap BL07's CI → the in-flight record keeps its original | `CIV-37` still `RACIC89385637` after the area moved to `RACID08389022` |
| S2 | a record created AFTER the remap carries the NEW CI | new `RFI-A-06c-BL07-CIV-39` carries `RACID08389022` |
| S4 | an explicit reassignment DOES move the old record | `RACIC…` → `RACID…` |

**S2 is what makes S1 mean anything.** Without it, S1 passes just as well when
the remap silently failed — the record would carry the old CI for the most
boring possible reason and the snapshot rule would be reported as proven. It
costs one Work Section and buys the difference between *"the snapshot held"* and
*"nothing happened"*.

**The spec rewrites WAM and puts it back**, with the restore in `afterAll` so it
runs however the test ends; a failed restore prints the exact row, filters and
Service Order to repair by hand. Confirmed live: `BL07 <- RACIC89385637`,
persistence re-checked after reopening the dialog.

### S3 (demap entirely) is deliberately NOT built yet

It is the sharpest case in the family — *if demapping strands in-flight records,
that is a live operational hazard* — and it is also the one that leaves the
ground BROKEN if a run dies mid-way: `BL07` with no Contractor Incharge at all,
inherited by every later spec and by the app owner's manual testing. It overlaps
`25_wam_demapping` / `27_wam_demapping_hierarchy`, neither of which checks what
happens to records the demapped user was carrying. Do it deliberately, with the
restore rehearsed, not appended to a passing file.

## 3g. The NC side — VERIFIED LIVE 2026-09-21

`tests/specs/48_reassign_nc.spec.js`, 3 tests, 1.7 min on pulse-test, green on
its first run. A SEPARATE FILE with its own routes and pool records, per the
standing rule that NC files never share code with RFI ones.

| id | asserted | result |
|---|---|---|
| R-NC | Admin may reassign all three roles on an NC | `["Contractor Incharge","Execution Engineer","Quality Inspector"]` |
| H5 | the NC LEAVES the old CI and ARRIVES with the new | `CIV-40`: arrived with `RACIA…`, left `RACIC…` |
| I1-NC | the version does not move | stayed `v1` |
| I3-NC | the code does not move | stayed `NC-A-06c-BL07-CIV-40` |
| C-NC | the new holder can ACT, not merely see | `CI_A` (no WAM anywhere) is offered **Submit** on `CIV-41` |

**Why this is not "the RFI tests with a different URL".** The two flows differ
exactly where reassignment touches them:

* **An NC is raised by the QI**, so a fresh NC's first holder is its
  **Contractor Incharge**, who must answer it — the CI hand-off is the one that
  matters first, the reverse of RFI.
* **An NC's code is stable even across a resubmit** (unlike an RFI's, which can
  change when work location / area / package change). So `I3-NC` is a sharper
  assertion than its RFI twin: a code change here has no benign explanation at
  all.
* **The NC grid is proved by its "NC ID" column header**, never by clicking the
  My Tasks tab. That click has silently failed three separate times in this
  project and every failure produced the same outcome — RFI rows read as NC
  rows. Reaching a queue in order to READ it is setup, so this navigates
  straight to the route and proves arrival.

**C-NC is the NC form of stranding**, and worth its own evidence rather than
inheriting Family C's: a contractor who can SEE a non-conformance but cannot
answer it leaves the NC open with nobody able to close it. It asserts an
actionable control exists on the record's own page, not merely a row in a list.

### Still open on the NC side

* **B2 — a CLOSED NC must not be reassignable.** Needs a closed NC; the pool has
  none, and closing one means driving a full NC cycle (CI response → EE → QI).
* **S5 — the NC equivalents of the snapshot family.** The RFI side (3f) proves
  the rule; the NC side inherits the same backend behaviour by construction, so
  this is lower value than B2.

## 3h. S3 — the demap hazard — VERIFIED LIVE 2026-09-21, AND IT IS NOT A HAZARD

`tests/specs/49_reassign_demap_hazard.spec.js`, 4 tests, 2.6 min on pulse-test.
**Demapping a work area does NOT strand the records it was carrying.**

This is the scenario the existing WAM demapping specs do not reach:
`25_wam_demapping` and `27_wam_demapping_hierarchy` both prove that clearing a
row PERSISTS — neither asks what became of the work the cleared user held.

| id | asserted | result |
|---|---|---|
| S3a | the area's Contractor Incharge can be cleared, and it sticks | `BL07` went from `RACIC89385637` to empty, re-read after a fresh reopen |
| S3b | the in-flight record still names its own CI | `CIV-37` still `RACID08389022` with **nobody** mapped to `BL07` |
| S3c | **a rejection still reaches that CI, who can still open the resubmit form** | reached them; page 1 read back `A-06c / BL07 / Civil / Piling - MMS` |
| S3d | the record is still reassignable — an admin has a way out | 12 candidates still offered |

**S3c is the whole test.** S3b alone would pass on an app that DISPLAYS a stale
name while routing the work nowhere; only pushing the record through a real
transition — EE rejects, does it land? — shows whether the route still exists.
And S3d guards the nastiest shape of the bug: an admin tidying up WAM locking
themselves out of the only mechanism for moving the work that tidy-up just
orphaned.

### What this run did NOT test, stated precisely

The record's CI was `RACID08389022` while the AREA was mapped to
`RACIC89385637` — a leftover from 3f's S4, which had reassigned `CIV-37`
explicitly. So what was cleared was the area's mapping (leaving **no CI mapped
to `BL07` at all**), not the mapping of the very user the record names.

That is the scenario as the app owner framed it — *"demap the CI entirely, so
nobody is mapped"* — and arguably its strongest form, since the record's holder
was not mapped to that area either way. **The variant still untested** is the
one where the record's own CI is demapped from EVERYWHERE, leaving that user
with no mappings at all while they still carry live work. Worth a follow-up; not
claimed by this run.

### Operational note

The spec leaves `A-06c/BL07` with no Contractor Incharge WHILE IT RUNS, so it is
a file of its own and can never be dragged in as a side effect of running
something else. The original value is captured before anything is cleared,
restored in `afterAll` however the run ends, and the restore is **verified by
reopening the dialog** — with a loud, copy-pasteable repair instruction printed
if it ever fails. Confirmed live: `RESTORED: BL07 Contractor Incharge =
"RACIC89385637"`.

## 4. Open questions (discovery items)

To be answered by the recon pass in §5, **before** anything asserts them:

1. Does an approved RFI / closed NC show the reassign icon at all?
2. Does the "Select Assignee Type" dropdown enumerate only the types a role may
   reassign, or does it list all three and refuse on submit?
3. What does CI's page-1 edit look like for a CI with no WAM, or WAM in another
   location/package? (Family C, the central unknown.)
4. Does demapping a user strand the records they carry?
5. Is the "Assign to" list filtered by vendor for CI on the server, the way it
   already excludes the current assignee?
6. Does a multi-project-type user behave differently from a single-type one?

---

## 5. Execution plan

**Phase 0 — recon (one run, no assertions).** Open the modal as each reassigner
role and dump the offered assignee types; dump an "Assign to" list and compare
it against users whose provisioning state is known; check an approved RFI's row
for the icon; capture CI's page-1 edit as an unmapped user. Artefacts under
`test-results/`, the way
`00_inspect_rfi_linked_nc_panel.spec.js` did it.

**Phase 1 — the fleet.** `tests/specs/40_reassign_fleet_setup.spec.js`, defined
in `tests/utils/reassign-fleet.js`, recorded in
`tests/fixtures/reassign-fleet.json` **keyed per deployment**. Idempotent:
members already recorded are skipped, and `REASSIGN_FLEET_REMAP=<keys>` re-applies
WAM for one whose mapping is wrong without creating a second account.

Built 2026-09-16 (group `reassigners`):

| member | role | WAM |
|---|---|---|
| `RA_EL` | Execution Lead | A-06c / Civil → `BL01` |
| `RA_QL` | Quality Lead | A-06c / Civil → `BL01` |
| `RA_PM` | Project Manager | A-06c (work-**location** row) |
| `RA_CM` | Contractor Manager | A-06c / Civil **+ Service Order** → `BL01` |

Two things this established, both of which the candidate group depends on:

* **A created user CAN log in** with `BULK_USER_DEFAULT_PASSWORD` (auth → 200),
  so the fleet is buildable. The older `…User151` smoke accounts that fail with
  401 were disabled or created under a different password — nothing to do with
  the login page, which is unchanged.
* **WAM row granularity is role-dependent** — the "one level down" rule, seen
  concretely: EL/QL are offered **work areas** (`BL01…BL08`), PM is offered
  **work locations** (81 of them), and Contractor Manager is offered **nothing**
  under a package filter. So a setup that takes `rows[0]` silently maps a PM to
  the wrong location — that happened here, and the store briefly recorded a
  mapping that did not exist. Members now record `wamApplied` and the actual row
  used, so the store cannot claim a mapping it does not have.

**Resolved 2026-09-16:** the Contractor Manager is mapped exactly like the other
work-area roles, once a **Service Order** is supplied. All four reassigners are
now built, login-verified and mapped.

**Phase 2 — specs, in this order** (cheapest and most damaging first):

| # | Family | Why this order |
|---|---|---|
| 1 | **R** — reassigner permissions | Near read-only, no fleet needed, catches the worst class of bug |
| 2 | **E** — eligibility matrix | Needs the fleet; answers the WAM-vs-provisioning question |
| 3 | **C** + **H** — capability and hand-off | The core of the feature; C is where a stranding bug would appear |
| 4 | **S** — WAM snapshot | Independent of the fleet; can run earlier if the fleet is delayed |
| 5 | **B**, **I**, **X** | Cheap once the harness exists |

**Ground cost.** Families C and S mutate WAM and leave reassigned records
behind. They must run on isolated ground, not on the RFI/NC flow areas — the
same rule that governs `featureGround` in `tests/config/projects.js`. S3
(demapping) is the most invasive and needs its own area plus a restore step.

---

## 6. Moving these specs into the smoke chain

The app owner's intent (2026-09-16) is that this feature's specs eventually live
in `tests/smoke/` and run as part of the one-shot chain. Four things follow from
that, and they are recorded now because two of them constrain decisions being
taken today.

### 6.1 The user naming format — settled, and smoke-safe

`RA<KEY><stamp>` — `RACIA78150031`, `RARACM20090635`. The `RA` prefix is
"reassignment"; `<KEY>` is the member key with separators stripped, so a member's
role in the matrix is readable off the name in the app's user list; `<stamp>` is
a time tail for uniqueness only.

**The prefix is load-bearing, not cosmetic.** `ensureSmokeUsers` self-heals the
smoke fleet by matching on NAME PREFIX, so a reassignment user named in the
repo's usual `<PREFIX><3 letters>User<n>` style (`CISLcliUser151`) would be
ADOPTED as a smoke flow user — silently changing what SM03 maps and what
SM05/SM06 log in as. `RA…` keeps the two fleets disjoint, and must keep doing so
after the move. Kept as-is by the app owner's decision; see `reassign-fleet.js`.

### 6.2 Ground — A-06c, by explicit exception (RESOLVED)

The fleet and its record under test live on **A-06c / BL07+**, and they stay
there after the move.

This is an explicit exception to a standing rule. `tests/config/projects.js` and
`app-owner-decisions-and-conventions.md` §4.1 both say the smoke chain must not
touch `A-06c` because it is the app owner's manual-testing ground — but the app
owner granted reassignment an exception on 2026-09-16: *"no issue for
reassignment u can use a06c"*. `BL07` onwards is the band they confirmed unused
in **both** `A-06c` and `S05b`.

**Do not re-base this onto S05b.** Beyond the exception being deliberate, S05b
has almost no room: `featureGround` already claims BL05 (ncCreate), BL06
(ncBlock), BL08–BL09 (wamSweep), BL10 (wamMutate), BL11 (rfiCreate), BL12–BL14
(rfiBulkAreas), and BL01–BL04 belong to the flows and the regression — leaving
BL07 as the only free area, where this feature needs **two** (one for the record
under test, one for the "right package, WRONG work area" arm, `CI-E`).

So when these specs join the chain they need a `featureGround.reassign` entry
pointing at **A-06c**, which will be the only smoke ground outside `S05b`. That
is worth a comment at the declaration, since it contradicts the surrounding
rule on its face.

### 6.3 What already suits a smoke chain

* **The setup spec is idempotent.** Members recorded for the deployment are
  skipped, so a chain re-run costs nothing and creates nothing.
* **The store is partitioned per deployment**, exactly like
  `last-created-users.json` — so pointing the chain at another environment
  neither reuses nor destroys this one's fleet.
* **A member is recorded as soon as it can log in**, with `wamApplied` tracked
  separately, so a mapping failure leaves a usable half-built member for a
  remap pass rather than an orphaned account.

### 6.4 Stage ordering, when it happens

Reassignment **consumes** records that are still pending, so it must run AFTER
the stages that create them — the same reasoning that already puts `SM14 reassign`
in the chain's serial epilogue. Families **C** and **S** additionally mutate WAM
and leave reassigned records behind, so they need isolated ground and, for the
demapping arm (S3), a restore step.
