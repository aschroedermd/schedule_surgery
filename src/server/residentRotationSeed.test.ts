import { describe, expect, it } from "vitest";
import { createRotationResidents } from "./residentRotationSeed";
import source from "./fixtures/residentSchedule20261024.json";
import { isResidentSuggestedForService } from "../shared/services";
import { getResidentTimeOff } from "../shared/availability";
import { createInitialState } from "./sampleData";
import { normalizePlannerState } from "./store";

describe("October 24 reviewed residency schedule", () => {
  it("includes the SCC fellows explicitly listed in the two block documents", () => {
    const residents = createRotationResidents();
    expect(residents.find(resident => resident.id === "res_external_anthony_rezcallah")?.rotationSchedule)
      .toContainEqual(expect.objectContaining({ blockNumber: 5, service: "SCC-days" }));
    expect(residents.find(resident => resident.id === "res_external_conlan_pierce")?.rotationSchedule)
      .toContainEqual(expect.objectContaining({ blockNumber: 6, service: "SCC-days" }));
  });
  it("preserves an intentional edit removing a seeded absence", () => {
    const state = createInitialState();
    state.residents = state.residents.map(resident => ({ ...resident, unavailable: [] }));
    const normalized = normalizePlannerState(state);
    expect(normalized.residents.find(resident => resident.id === "res_fellow")?.unavailable).toEqual([]);
  });
  it("matches every full-block primary rotation in the supplied annual grid", () => {
    const residents = createRotationResidents();
    for (const [id, row] of Object.entries(source.residents)) {
      const resident = residents.find(candidate => candidate.id === id)!;
      for (const [index, cell] of row.blocks.entries()) {
        const service = cell.split(/\nVAC/)[0];
        // The two split rotations are checked at their date boundaries below.
        if (service.includes("\n")) continue;
        expect(resident.rotationSchedule?.find(rotation => rotation.blockNumber === index + 1)?.service ?? "", `${row.name}, block ${index + 1}`).toBe(service);
      }
      expect(resident.vacation).toEqual(row.vacation);
    }
    expect(residents.some(resident => /broden/i.test(resident.name))).toBe(false);
  });

  it("keeps Adeleke on Berry with an inclusive ED detour through November 8", () => {
    const state = createInitialState();
    const adeleke = state.residents.find(resident => resident.id === "res_fellow")!;
    expect(adeleke.rotationSchedule?.find(rotation => rotation.blockNumber === 5)?.service).toBe("Berry");
    for (const date of ["2026-10-26", "2026-11-08"]) {
      expect(getResidentTimeOff(state, adeleke, date)?.description).toContain("ED Rotation");
      expect(isResidentSuggestedForService(adeleke, "Berry", date)).toBe(false);
    }
    expect(getResidentTimeOff(state, adeleke, "2026-11-09")).toBeUndefined();
    expect(isResidentSuggestedForService(adeleke, "Berry", "2026-11-09")).toBe(true);
  });

  it("keeps Klosinski available in Block 5 and honors Keys's first-block split", () => {
    const state = createInitialState();
    const klosinski = state.residents.find(resident => resident.id === "res_klosinski")!;
    expect(getResidentTimeOff(state, klosinski, "2026-10-26")).toBeUndefined();
    const keys = state.residents.find(resident => resident.id === "res_keys")!;
    expect(isResidentSuggestedForService(keys, "Vascular", "2026-07-18")).toBe(true);
    expect(isResidentSuggestedForService(keys, "Vascular", "2026-07-19")).toBe(false);
    expect(isResidentSuggestedForService(keys, "Vascular", "2026-08-02")).toBe(false);
    expect(isResidentSuggestedForService(keys, "Fogel", "2026-08-03")).toBe(true);
  });
});
