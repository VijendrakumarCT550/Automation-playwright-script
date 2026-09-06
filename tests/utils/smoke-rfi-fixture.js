const { expect } = require('@playwright/test');

// Builds the RFI create-form data the smoke feature stages (SM23, SM24, SM25)
// need, from profile.rfi, with the WORK AREA overridden per stage.
//
// WHY THE OVERRIDE IS THE WHOLE POINT. profile.rfi is pinned to the flow's own
// area (BL03 for solar) because that is what SM05 walks. The creation stages
// must NOT create there: every RFI permanently consumes a
// (checkpoint, work section) pair, and SM05's tracked 9-TC sequence expects to
// find free ones. So each creation stage takes the same proven activity /
// checkpoint / checklist combination and points it at its own ground from
// profile.featureGround.
//
// Reusing profile.rfi's activity data rather than inventing new values is
// deliberate: that combination (Piling - MMS / Pre Pour Inspection - Pile /
// Micro Pile Checklist) is the one SM05 has passed 9/9 with on this band, so a
// failure in a creation stage is about creation and not about guessed dropdown
// values.
//
// NOTE ON SM08: it has its own inlined copy of this construction. Deliberately
// left alone — it is live-verified, and de-duplicating a working file for
// tidiness is how verified things break.
function resolveRfiFixture(profile, { workArea } = {}) {
  const rfi = profile.rfi;
  expect(
    rfi,
    `Profile "${profile.key}" has no rfi data — see tests/config/projects.js`
  ).toBeTruthy();
  expect(
    rfi.checkpointChain && rfi.checkpointChain.length,
    `Profile "${profile.key}" declares rfi.checkpointChain empty; there is no checkpoint to raise`
  ).toBeTruthy();

  const cp = rfi.checkpointChain[0];
  const baseData = {
    workLocation: rfi.workLocation,
    // The override. Falls back to the profile's own area only when a caller
    // passes nothing, which no feature stage does.
    workArea: workArea || rfi.workArea,
    package: rfi.package,
    subPackage: cp.subPackage || rfi.subPackage,
    activity: cp.activity || rfi.activity,
    subActivity: cp.subActivity,
    rfiQuantity: rfi.rfiQuantity,
    unit: rfi.unit,
    subContractor: rfi.subContractor,
  };

  return {
    baseData,
    checkpoint: { name: cp.checkpoint, checklist: cp.checklist },
    // The flat shape RFICreatePage.fillForm expects, for the stages that drive
    // the form directly rather than through createAndSubmitCheckpoint.
    formData: {
      ...baseData,
      inspectionCheckpoint: cp.checkpoint,
      inspectionChecklist: cp.checklist,
    },
  };
}

module.exports = { resolveRfiFixture };
