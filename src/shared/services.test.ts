import { describe, expect, it } from "vitest";
import { isGeneralOrPlasticSurgeryResident, isResidentOnService, toKnownServiceLine } from "./services";

describe("resident program filtering", () => {
  it("includes primary General Surgery residents", () => {
    expect(isGeneralOrPlasticSurgeryResident({ rosterKind: "primary" })).toBe(true);
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
