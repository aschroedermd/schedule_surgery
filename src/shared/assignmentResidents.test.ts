import { describe, expect, it } from "vitest";
import { getAssignmentService, isOperativeResident } from "./services";
import { createInitialState } from "../server/sampleData";
describe("assignment residents", () => {
  it.each(["Emergency Medicine", "Pulmonary Medicine Fellowship", "Critical Care Medicine", "Internal Medicine"])("excludes %s even on a primary roster", sourceProgram => {
    expect(isOperativeResident({ sourceProgram, rosterKind: "primary" })).toBe(false);
  });
  it.each(["General Surgery", "Plastic Surgery", "Orthopaedics", "Podiatric Medicine and Surgery", "Pediatrics", "Neurosurgery", "Surgical Critical Care"])("includes %s rotators", sourceProgram => {
    expect(isOperativeResident({ sourceProgram, rosterKind: "off-service" })).toBe(true);
  });
  it("uses ENDO for a block and its cases regardless of the selected service", () => {
    const state = createInitialState();
    const block = state.attendingBlocks[0];
    block.notes = "Endoscopy";
    expect(getAssignmentService(state, "block", block.id, "Berry")).toBe("ENDO");
    const surgeryCase = state.cases.find(item => item.blockId === block.id)!;
    expect(getAssignmentService(state, "case", surgeryCase.id, "Berry")).toBe("ENDO");
    block.notes = "";
    expect(getAssignmentService(state, "block", block.id, "Berry")).toBe(state.attendings.find(item => item.id === block.attendingId)?.service);
  });
});
