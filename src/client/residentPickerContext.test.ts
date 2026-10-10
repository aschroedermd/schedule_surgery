import { describe, expect, it } from "vitest";
import { createInitialState } from "../server/sampleData";
import { makeAssignment } from "../shared/scheduler";
import { buildResidentPickerContext, getResidentPickerWorkload } from "./residentPickerContext";
describe("coverage picker context", () => {
  it("includes other surgeons, inherited block coverage and overlapping work", () => {
    const state = createInitialState();
    state.assignments = [makeAssignment("block", "block_patel_mon", "resident", "admin", false)];
    const context = buildResidentPickerContext(state, "block", "block_chen_mon")!;
    expect(context.title).toBe("Dr. Chen · block coverage");
    expect(context.targetActivities).toHaveLength(2);
    const workload = getResidentPickerWorkload(context, "resident");
    expect(workload.activities).toHaveLength(1);
    expect(workload.overlaps[0].surgeon).toBe("Dr. Patel");
    expect(workload.overlaps[0].title).toBe("Gastric bypass");
    const afternoon = buildResidentPickerContext(state, "case", "case_chen_chole")!;
    expect(getResidentPickerWorkload(afternoon, "resident").overlaps).toHaveLength(0);
  });
  it("does not double count direct and block coverage or treat target work as a conflict", () => {
    const state = createInitialState();
    state.assignments = [makeAssignment("block", "block_chen_mon", "resident", "admin", false), makeAssignment("case", "case_chen_whipple", "resident", "admin", false)];
    const context = buildResidentPickerContext(state, "block", "block_chen_mon")!;
    const workload = getResidentPickerWorkload(context, "resident");
    expect(workload.activities).toHaveLength(2);
    expect(workload.overlaps).toHaveLength(0);
    expect(context.activities.find(item => item.id === "case_chen_whipple")!.residentIds).toEqual(["resident"]);
  });
  it("includes clinics and does not invent end times for empty blocks", () => {
    const state = createInitialState();
    const block = state.attendingBlocks[0];
    state.cases = state.cases.filter(item => item.blockId !== block.id);
    state.clinicSessions[0].date = block.date;
    state.assignments = [makeAssignment("clinic", state.clinicSessions[0].id, "resident", "admin", false)];
    const context = buildResidentPickerContext(state, "block", block.id)!;
    expect(context.targetActivities[0].end).toBeUndefined();
    expect(context.targetActivities[0].time).toContain("end not listed");
    expect(getResidentPickerWorkload(context, "resident").activities).toHaveLength(1);
    expect(getResidentPickerWorkload(context, "resident").overlaps).toHaveLength(0);
  });
});
