const { test, expect } = require('@playwright/test');
const { adminFreshLogin } = require('../utils/helpers');
const { nextBatchNumber, generateUserIdentity, recordLastCreatedUser } = require('../utils/user-counter-utils');
const UserManagementPage = require('../pages/UserManagementPage');

// Prefixes as specified by the user. "Management User" (a real option in
// the UserRole dropdown) is intentionally excluded — no prefix was given
// for it. "Admin" collided with Site Admin's given prefix "SAD"; confirmed
// live that the UserRole dropdown has no separate "Super Admin" option (see
// UserManagementPage.js header comment), so "Admin" is just given its own
// prefix here rather than reusing SAD.
const VENDOR_CATEGORY = 'Service Contractor';
const VENDOR_NAME = 'M S CHOUHAN INFRAVENTURES'; // matches SO Mapping/WAM's confirmed vendor for this location

const ROLE_CONFIGS = [
  { prefix: 'EE',  role: 'Execution Engineer',  userType: 'AGEL' },
  { prefix: 'QI',  role: 'Quality Inspector',   userType: 'AGEL' },
  { prefix: 'EL',  role: 'Execution Lead',      userType: 'AGEL' },
  { prefix: 'QL',  role: 'Quality Lead',        userType: 'AGEL' },
  { prefix: 'PM',  role: 'Project Manager',     userType: 'AGEL' },
  { prefix: 'PAD', role: 'Plot Admin',          userType: 'AGEL' },
  { prefix: 'SAD', role: 'Site Admin',          userType: 'AGEL' },
  { prefix: 'CAD', role: 'Cluster Admin',       userType: 'AGEL' },
  { prefix: 'ADM', role: 'Admin',               userType: 'AGEL' },
  { prefix: 'CIC', role: 'Contractor Incharge', userType: 'VENDOR' },
  { prefix: 'CM',  role: 'Contractor Manager',  userType: 'VENDOR' },
];

// Serial mode is REQUIRED, not just nice-to-have: with fullyParallel:true
// and no worker cap outside CI, Playwright was splitting these 11 tests
// across multiple worker PROCESSES — and since test.beforeAll runs once
// PER WORKER (not once for the whole file), that meant nextBatchNumber()
// fired once per worker too, handing out several different batch numbers
// across one "batch" of 11 instead of the single shared number the naming
// scheme depends on (confirmed live: a run split across 6 workers produced
// numbers 32-37 instead of one number for all 11). Serial mode pins every
// test in this file to one worker, so beforeAll — and the single admin
// login/context it sets up — really does run only once.
test.describe.configure({ mode: 'serial' });

test.describe('Admin - User Management (create one user per role)', () => {
  let context, page, dashboard, batchNumber;

  test.beforeAll(async ({ browser }) => {
    ({ context, page, dashboard } = await adminFreshLogin(browser));
    // One number for the WHOLE batch, not per-user — user-specified: every
    // user created in this run shares the same numeric suffix, so a group
    // of 11 can be recognized as "created together." Only advances on the
    // NEXT run of this file, before it creates anything (regardless of
    // whether this run's roles all end up succeeding).
    batchNumber = nextBatchNumber();
    console.log(`User creation batch number: ${batchNumber}`);
  });

  test.afterAll(async () => {
    await context.close();
  });

  for (const { prefix, role, userType } of ROLE_CONFIGS) {
    test(`Admin can create a new ${role} user (${userType})`, async () => {
      const users = new UserManagementPage(page);
      await users.goto(dashboard);
      await users.openAddUserDialog();

      await users.selectUserType(userType);
      if (userType === 'VENDOR') {
        await users.selectVendorCategory(VENDOR_CATEGORY);
        await users.selectVendor(VENDOR_NAME);
      }
      await users.selectUserRole(role);

      // Location cascade is dynamic per role (some roles ask for all of
      // Cluster/Sites/Project type/Work Locations, some for none, some a
      // partial prefix — confirmed inconsistent even for the SAME role
      // across sessions) — fillLocationCascade() fills only whichever of
      // these is actually visible right now, matching Gujarat/Khavda/
      // A-06c to stay consistent with the WAM/SO Mapping automation
      // already run against this same location.
      const picked = await users.fillLocationCascade();

      const identity = generateUserIdentity(prefix, batchNumber);
      await users.fillIdentity(identity);

      const toastText = await users.submit();
      expect(toastText, `Expected a success toast after creating ${role} "${identity.name}"`).toMatch(/success/i);

      const found = await users.waitForUserSearchResult(identity.name);
      expect(found, `Newly created user "${identity.name}" should be findable via search afterward`).toBe(true);

      // So a later spec (e.g. WAM assignment) can always find "whichever
      // user was created last for this role" without hardcoding names.
      recordLastCreatedUser(prefix, { ...identity, role, userType });

      console.log(
        `Created ${role} (${userType}) "${identity.name}" <${identity.email}> ${identity.phone} — ` +
        `fields: ${JSON.stringify(picked)}`
      );
    });
  }
});
