import { describe, expect, it } from "vitest";
import { createInitialState } from "../server/sampleData";
import {
  evaluateCallSchedule,
  generateCallSchedule,
  getCallBuilderDates,
  getCallPositionForResident
} from "./callBuilder";
import { parseLocalDate } from "./date";
import { getRotationForBlock } from "./rotations";

describe("resident call builder", () => {
  it("builds every block-three slot without violating protected eligibility", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const result = generateCallSchedule(state, 3);

    expect(result.assignments).toHaveLength(getCallBuilderDates(3).length * 3);
    expect(result.hardViolationCount).toBe(0);

    for (const assignment of result.assignments) {
      const resident = state.residents.find((candidate) => candidate.id === assignment.residentId)!;
      const service = getRotationForBlock(resident, 3)?.service.toLowerCase() ?? "";
      expect(getCallPositionForResident(resident)).toBe(assignment.callPosition);
      expect(service).not.toMatch(/scc|transplant|burn|nfloat|night float/);
    }
  });

  it("puts EGS chiefs on Sundays and Trauma chiefs on two separated Fridays", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const result = generateCallSchedule(state, 3);
    const egsChiefs = state.residents.filter((resident) => {
      const service = getRotationForBlock(resident, 3)?.service.toLowerCase() ?? "";
      return getCallPositionForResident(resident) === "senior" && /ferrara|egs/.test(service);
    });
    const traumaChiefs = state.residents.filter((resident) => {
      const service = getRotationForBlock(resident, 3)?.service.toLowerCase() ?? "";
      return getCallPositionForResident(resident) === "senior" && /gilbert|trauma/.test(service);
    });

    for (const chief of egsChiefs) {
      expect(result.assignments.filter((assignment) => assignment.residentId === chief.id).every((assignment) => parseLocalDate(assignment.date).getDay() === 0)).toBe(true);
    }
    for (const chief of traumaChiefs) {
      const dates = result.assignments.filter((assignment) => assignment.residentId === chief.id).map((assignment) => assignment.date).sort();
      expect(dates).toHaveLength(2);
      expect(dates.every((date) => parseLocalDate(date).getDay() === 5)).toBe(true);
      expect(parseLocalDate(dates[1]).getTime() - parseLocalDate(dates[0]).getTime()).toBeGreaterThan(7 * 24 * 60 * 60 * 1000);
    }
  });

  it("treats approved unavailable time as blocking and resident preferences as advisory", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const generated = generateCallSchedule(state, 3);
    const assignment = generated.assignments[0];
    const resident = state.residents.find((candidate) => candidate.id === assignment.residentId)!;
    resident.unavailable = [{ id: "approved_off", date: assignment.date, label: "approved program reason" }];
    state.callOffRequests = [{
      id: "request_priority",
      residentId: resident.id,
      requesterUsername: resident.username ?? "resident",
      requesterName: resident.name,
      date: assignment.date,
      scope: "day",
      priority: "priority",
      createdAt: "2026-08-01T12:00:00.000Z",
      updatedAt: "2026-08-01T12:00:00.000Z"
    }];

    const evaluation = evaluateCallSchedule(state, 3, generated.assignments);

    expect(evaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", rule: "approved-unavailable", residentIds: [resident.id] }),
      expect.objectContaining({ severity: "warning", rule: "priority-request", residentIds: [resident.id] })
    ]));
  });

  it("detects an incomplete manual draft before publishing", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const generated = generateCallSchedule(state, 3);
    const evaluation = evaluateCallSchedule(state, 3, generated.assignments.slice(1));

    expect(evaluation.hardViolationCount).toBeGreaterThan(0);
    expect(evaluation.issues.some((issue) => issue.rule === "coverage" && issue.message.includes("missing"))).toBe(true);
  });
});
