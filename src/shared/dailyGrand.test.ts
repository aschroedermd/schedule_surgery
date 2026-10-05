import { describe, expect, it } from "vitest";
import { createInitialState } from "../server/sampleData";
import { addDays } from "./date";
import { buildDailyGrandView } from "./dailyGrand";
import { makeAssignment } from "./scheduler";

describe("daily grand schedule", () => {
  it("includes every service once, with endoscopy at its hospital and an inferred end", () => {
    const state = createInitialState();
    const date = state.weeks[0].startDate;
    state.hospitals[0].shortName = "RMH";
    state.hospitals[1].shortName = "CCASC";
    state.attendings[1].service = "Vascular";
    state.attendingBlocks[1].notes = "Endoscopy";
    const entries = buildDailyGrandView(state, date);
    expect(entries).toHaveLength(2);
    expect(entries.map(item => item.service)).toEqual(["Davies", "Vascular"]);
    expect(entries[0]).toMatchObject({ group: "RMH", kind: "OR", startTime: "07:30", endTime: undefined });
    expect(entries[1]).toMatchObject({ group: "CCASE", kind: "Endoscopy", calculatedEnd: true });
    expect(entries[1].endTime).toBeTruthy();
    expect(new Set(entries.flatMap(item => item.coverage.map(item => item.id))).size)
      .toBe(entries.flatMap(item => item.coverage).length);
  });

  it("shows inherited block coverage plus direct assignments while retaining uncovered cases", () => {
    const state = createInitialState();
    const [resident, second] = state.residents;
    state.assignments = [makeAssignment("block", "block_chen_mon", resident.id, "admin", false),
      makeAssignment("case", "case_chen_whipple", second.id, "admin", false)];
    const entries = buildDailyGrandView(state, state.weeks[0].startDate);
    expect(entries[0].coverage[0].residentNames).toEqual([resident.name, second.name]);
    expect(entries[0].coverage[1].residentNames).toEqual([resident.name]);
    expect(entries[1].coverage[0].residentNames).toEqual([]);
  });

  it("groups Riverside and FMH clinic together with their exact times and coverage", () => {
    const state = createInitialState();
    const date = state.weeks[0].startDate;
    state.clinicSessions = [
      { ...state.clinicSessions[0], date, location: "Riverside", startTime: "08:00", endTime: "12:00" },
      { ...state.clinicSessions[1], date, location: "FMH clinic", service: "Peds" }
    ];
    state.assignments = [makeAssignment("clinic", state.clinicSessions[0].id, state.residents[0].id, "admin", false)];
    const clinics = buildDailyGrandView(state, date).filter(item => item.kind === "Clinic");
    expect(clinics).toHaveLength(2);
    expect(clinics.every(item => item.group === "Clinic")).toBe(true);
    expect(clinics[0]).toMatchObject({ location: "Riverside", startTime: "08:00", endTime: "12:00" });
    expect(clinics[0].coverage[0].residentNames).toEqual([state.residents[0].name]);
  });

  it("includes weekends and empty blocks even when the week board shows weekdays only", () => {
    const state = createInitialState();
    const date = addDays(state.weeks[0].startDate, 5);
    state.attendingBlocks.push({ ...state.attendingBlocks[0], id: "weekend_endo", date, notes: "Endoscopy" });
    const [entry] = buildDailyGrandView(state, date);
    expect(entry).toMatchObject({ id: "weekend_endo", endTime: undefined, kind: "Endoscopy" });
    expect(entry.coverage).toEqual([{ id: "weekend_endo", label: "No cases listed", residentNames: [] }]);
    expect(buildDailyGrandView(state, addDays(date, 1))).toEqual([]);
  });
});
