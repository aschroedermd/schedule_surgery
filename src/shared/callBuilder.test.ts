import { describe, expect, it } from "vitest";
import { createInitialState } from "../server/sampleData";
import {
  CALL_BUILDER_GOALS,
  evaluateCallSchedule,
  generateCallSchedule,
  getCallBuilderDates,
  getCallBuilderWeekendAnchor,
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
    expect(result.residentLoads.filter((load) => load.regularPool).every((load) => load.units > 0)).toBe(true);
    expect(result.issues.some((issue) => issue.rule === "consecutive-days" || issue.rule === "same-weekend")).toBe(false);

    for (const assignment of result.assignments) {
      const resident = state.residents.find((candidate) => candidate.id === assignment.residentId)!;
      const service = getRotationForBlock(resident, 3)?.service.toLowerCase() ?? "";
      expect(getCallPositionForResident(resident)).toBe(assignment.callPosition);
      expect(service).not.toMatch(/scc|transplant|burn|nfloat|night float/);
    }

    for (const resident of state.residents) {
      const dates = result.assignments
        .filter((assignment) => assignment.residentId === resident.id)
        .map((assignment) => assignment.date)
        .sort();
      for (let index = 1; index < dates.length; index += 1) {
        expect(parseLocalDate(dates[index]).getTime() - parseLocalDate(dates[index - 1]).getTime()).not.toBe(24 * 60 * 60 * 1000);
      }
      expect(new Set(dates.map(getCallBuilderWeekendAnchor)).size).toBe(dates.length);
    }
  });

  it("publishes the revised hierarchy in the requested order", () => {
    expect(CALL_BUILDER_GOALS).toHaveLength(11);
    expect(CALL_BUILDER_GOALS[0]).toContain("absolutely no call on consecutive days");
    expect(CALL_BUILDER_GOALS[5]).toContain("Priority");
    expect(CALL_BUILDER_GOALS[6]).toContain("twice in the same weekend");
    expect(CALL_BUILDER_GOALS[7]).toContain("vacation");
    expect(CALL_BUILDER_GOALS[10]).toContain("Secondary");
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

  it("detects an incomplete manual draft for the live validity review", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const generated = generateCallSchedule(state, 3);
    const evaluation = evaluateCallSchedule(state, 3, generated.assignments.slice(1));

    expect(evaluation.hardViolationCount).toBeGreaterThan(0);
    expect(evaluation.issues.some((issue) => issue.rule === "coverage" && issue.message.includes("missing"))).toBe(true);
  });

  it("flags manual edits that violate build-specific requirements", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const generated = generateCallSchedule(state, 3);
    const assignment = generated.assignments.find((item) => item.residentId === "res_chief")!;
    const requiredDate = "2026-09-19";
    const assignedIntern = generated.assignments.find((item) => item.date === requiredDate && item.callPosition === "intern")!;
    const requiredResident = state.residents.find((resident) =>
      getCallPositionForResident(resident) === "intern" && resident.id !== assignedIntern.residentId
    )!;
    const constraints = [
      { id: "off", kind: "off" as const, residentId: assignment.residentId, date: assignment.date, scope: "day" as const },
      { id: "required", kind: "required-call" as const, residentId: requiredResident.id, date: requiredDate, scope: "day" as const }
    ];

    const evaluation = evaluateCallSchedule(state, 3, generated.assignments, constraints);

    expect(evaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", rule: "builder-constraint", residentIds: [assignment.residentId] }),
      expect.objectContaining({ severity: "error", rule: "builder-constraint", residentIds: [requiredResident.id] })
    ]));
  });

  it("blocks consecutive-day call and warns about a Friday-Sunday repeat", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const generated = generateCallSchedule(state, 3);
    const friday = getCallBuilderDates(3).find((date) => parseLocalDate(date).getDay() === 5)!;
    const saturday = getCallBuilderDates(3).find((date) => getCallBuilderWeekendAnchor(date) === friday && parseLocalDate(date).getDay() === 6)!;
    const sunday = getCallBuilderDates(3).find((date) => getCallBuilderWeekendAnchor(date) === friday && parseLocalDate(date).getDay() === 0)!;
    const fridayAssignment = generated.assignments.find((assignment) => assignment.date === friday && assignment.callPosition === "senior")!;

    const consecutiveDraft = generated.assignments.map((assignment) =>
      assignment.date === saturday && assignment.callPosition === fridayAssignment.callPosition
        ? { ...assignment, residentId: fridayAssignment.residentId }
        : assignment
    );
    const consecutiveEvaluation = evaluateCallSchedule(state, 3, consecutiveDraft);
    expect(consecutiveEvaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "error", rule: "consecutive-days", residentIds: [fridayAssignment.residentId] }),
      expect.objectContaining({ severity: "warning", rule: "same-weekend", residentIds: [fridayAssignment.residentId] })
    ]));

    const sameWeekendDraft = generated.assignments.map((assignment) =>
      assignment.date === sunday && assignment.callPosition === fridayAssignment.callPosition
        ? { ...assignment, residentId: fridayAssignment.residentId }
        : assignment
    );
    const sameWeekendEvaluation = evaluateCallSchedule(state, 3, sameWeekendDraft);
    expect(sameWeekendEvaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ severity: "warning", rule: "same-weekend", residentIds: [fridayAssignment.residentId] })
    ]));
    expect(sameWeekendEvaluation.issues.some((issue) => issue.rule === "consecutive-days" && issue.residentIds?.includes(fridayAssignment.residentId))).toBe(false);
  });

  it("checks the prior block main draft for back-to-back Saturdays", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const generated = generateCallSchedule(state, 3);
    const firstSaturday = getCallBuilderDates(3).find((date) => parseLocalDate(date).getDay() === 6)!;
    const saturdayAssignment = generated.assignments.find((assignment) => assignment.date === firstSaturday)!;
    const priorSaturday = new Date(parseLocalDate(firstSaturday).getTime() - 7 * 24 * 60 * 60 * 1000);
    const priorDate = `${priorSaturday.getFullYear()}-${String(priorSaturday.getMonth() + 1).padStart(2, "0")}-${String(priorSaturday.getDate()).padStart(2, "0")}`;
    state.callScheduleDrafts = [{
      id: "prior_main_draft",
      blockNumber: 2,
      assignments: [{ ...saturdayAssignment, date: priorDate }],
      createdByUsername: "builder",
      createdByName: "Call Builder",
      createdAt: "2026-08-20T12:00:00.000Z",
      isMain: true
    }];

    const evaluation = evaluateCallSchedule(state, 3, generated.assignments);
    expect(evaluation.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        rule: "cross-block-saturday",
        residentIds: [saturdayAssignment.residentId]
      })
    ]));
  });
});
