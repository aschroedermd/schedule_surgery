import { describe, expect, it } from "vitest";
import { isGeneralOrPlasticSurgeryResident } from "./services";

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
