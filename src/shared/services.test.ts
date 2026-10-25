import { describe, expect, it } from "vitest";
import { isGeneralOrPlasticSurgeryResident, isResidentOnService, isResidentSuggestedForService, toKnownServiceLine } from "./services";

describe("resident program filtering", () => {
  it("includes primary General Surgery residents", () => {
    expect(isGeneralOrPlasticSurgeryResident({ rosterKind: "primary" })).toBe(true);
    expect(isGeneralOrPlasticSurgeryResident({ rosterKind: "off-service", sourceProgram: "General Surgery" })).toBe(true);
  });

  it("includes Plastic Surgery rotators", () => {
    expect(
      isGeneralOrPlasticSurgeryResident({
        rosterKind: "off-service",
        sourceProgram: "Plastic Surgery",
        sourceProgramAbbreviation: "Pl Sx"
      })
    ).toBe(true);
  });

  it("excludes ER and other off-service residents", () => {
    expect(
      isGeneralOrPlasticSurgeryResident({
        rosterKind: "off-service",
        sourceProgram: "Emergency Medicine",
        sourceProgramAbbreviation: "EM"
      })
    ).toBe(false);
    expect(
      isGeneralOrPlasticSurgeryResident({
        rosterKind: "off-service",
        sourceProgram: "Internal Medicine",
        sourceProgramAbbreviation: "IM"
      })
    ).toBe(false);
  });
});

describe("Breast service designation", () => {
  it("does not suggest a legacy team in a gap in the dated rotation schedule", () => {
    const resident = {
      serviceTags: ["Davies"],
      rotationSchedule: [{ id: "berry", blockNumber: 4, startDate: "2026-09-28", endDate: "2026-10-25", service: "Berry" }]
    };
    expect(isResidentOnService(resident, "Davies", "2026-10-26")).toBe(false);
    expect(isResidentOnService(resident, "Berry", "2026-10-25")).toBe(true);
  });

  it("keeps a block team but excludes a dated ED rotation from suggestions", () => {
    const resident = {
      serviceTags: [],
      rotationSchedule: [{ id: "berry", blockNumber: 5, startDate: "2026-10-26", endDate: "2026-11-22", service: "Berry" }],
      unavailable: [{ id: "ed", date: "2026-10-26", endDate: "2026-11-08", label: "ED Rotation" }]
    };
    expect(isResidentOnService(resident, "Berry", "2026-10-26")).toBe(true);
    expect(isResidentSuggestedForService(resident, "Berry", "2026-10-26")).toBe(false);
    expect(isResidentSuggestedForService(resident, "Berry", "2026-11-08")).toBe(false);
    expect(isResidentSuggestedForService(resident, "Berry", "2026-11-09")).toBe(true);
  });
  it("recognizes Breast rotations without placing residents on Fogel for OR/clinic work", () => {
    const resident = {
      serviceTags: ["Fogel"],
      rotationSchedule: [{ id: "rotation_breast", blockNumber: 4, startDate: "2026-09-28", endDate: "2026-10-25", service: "Breast" }]
    };
    expect(toKnownServiceLine("Breast")).toBe("Breast");
    expect(toKnownServiceLine("Breast Surgery")).toBe("Breast");
    expect(isResidentOnService(resident, "Breast", "2026-10-04")).toBe(true);
    expect(isResidentOnService(resident, "Fogel", "2026-10-04")).toBe(false);
  });
});
