import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialState } from "./sampleData";
import {
  CallBuilderInfeasibleError,
  buildSolverProblem,
  solveCallSchedule
} from "./callBuilderSolver";
import { getCallBuilderSlots, getCallBuilderWeekendAnchor, getCallPositionForResident } from "../shared/callBuilder";
import { parseLocalDate } from "../shared/date";

describe("call-off request solver hierarchy", () => {
  it("makes senior residents eligible for exceptional mid-level coverage", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const senior = buildSolverProblem(state, 3).residents.find((resident) => resident.position === "senior")!;

    expect(senior.eligiblePositions).toEqual(["senior", "mid-level"]);
  });

  it("ranks seniority groups before timestamps and earlier requests within a group", () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const callResidents = state.residents.filter((resident) => getCallPositionForResident(resident));
    const senior = callResidents.find((resident) => resident.trainingLevel === "PGY4" || resident.trainingLevel === "PGY5")!;
    const midlevels = callResidents.filter((resident) => resident.trainingLevel === "PGY2" || resident.trainingLevel === "PGY3").slice(0, 2);
    const intern = callResidents.find((resident) => resident.trainingLevel === "PGY1")!;
    expect(senior).toBeTruthy();
    expect(midlevels).toHaveLength(2);
    expect(intern).toBeTruthy();
    state.callOffRequests = [
      makeCallOffRequest("intern-early", intern.id, "2026-07-01T00:00:00.000Z"),
      makeCallOffRequest("mid-late", midlevels[1].id, "2026-07-03T00:00:00.000Z"),
      makeCallOffRequest("senior-late", senior.id, "2026-07-04T00:00:00.000Z"),
      makeCallOffRequest("mid-early", midlevels[0].id, "2026-07-02T00:00:00.000Z")
    ];

    const hierarchy = buildSolverProblem(state, 3).callOffRequestHierarchy.priority;

    expect(hierarchy.map((tier) => tier.key)).toEqual(["senior", "midlevel", "intern"]);
    expect(hierarchy[1].requests.map((request) => ({ residentId: request.residentId, timestampWeight: request.timestampWeight }))).toEqual([
      { residentId: midlevels[0].id, timestampWeight: 2 },
      { residentId: midlevels[1].id, timestampWeight: 1 }
    ]);
  });
});

function makeCallOffRequest(id: string, residentId: string, createdAt: string) {
  return {
    id,
    residentId,
    requesterUsername: residentId,
    requesterName: residentId,
    date: "2026-09-05",
    scope: "weekend" as const,
    priority: "priority" as const,
    createdAt,
    updatedAt: createdAt
  };
}

const localPython = path.resolve(process.cwd(), ".local/call-builder-venv/bin/python");
const solverAvailable = fs.existsSync(localPython);

describe.runIf(solverAvailable)("CP-SAT call builder", () => {
  it("proves a fair, valid block-three schedule without arbitrary search passes", async () => {
    process.env.CALL_BUILDER_SOLVER_TIME_SECONDS = "2.5";
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const started = performance.now();
    const result = await solveCallSchedule(state, 3);

    expect(result.solverSummary).toEqual(expect.objectContaining({
      engine: "cp-sat",
      status: "optimal",
      optimalityProven: true
    }));
    expect(result.assignments).toHaveLength(getCallBuilderSlots(3).length);
    expect(result.hardViolationCount).toBe(0);
    expect(result.fairnessPercent).toBeGreaterThanOrEqual(80);
    expect(result.solverSummary?.objectives.slice(0, 3)).toEqual([
      expect.objectContaining({ key: "fairness-participation", value: 0 }),
      expect.objectContaining({ key: "fairness-max-two-units" }),
      expect.objectContaining({ key: "senior-midlevel-coverage" })
    ]);
    expect(performance.now() - started).toBeLessThan(4_000);
  }, 10_000);

  it("accepts a locked PGY-4/5 resident in a mid-level call slot", async () => {
    process.env.CALL_BUILDER_SOLVER_TIME_SECONDS = "2";
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const problem = buildSolverProblem(state, 3);
    const senior = problem.residents.find((resident) => resident.position === "senior" && resident.eligibleSlotIds.length > 0)!;
    const slot = problem.slots.find((candidate) => candidate.id === senior.eligibleSlotIds[0])!;
    const locked = {
      date: slot.date,
      callPosition: "mid-level" as const,
      residentId: senior.id,
      ...(slot.shift === "holiday-day" ? { shift: slot.shift } : {})
    };

    const result = await solveCallSchedule(state, 3, { lockedAssignments: [locked] });

    expect(result.hardViolationCount).toBe(0);
    expect(result.assignments).toContainEqual(locked);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ rule: "senior-midlevel-coverage", residentIds: [senior.id] })
    ]));
  }, 10_000);

  it("handles a block spanning daylight-saving time and preserves manual locks", async () => {
    process.env.CALL_BUILDER_SOLVER_TIME_SECONDS = "2";
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const initial = await solveCallSchedule(state, 5);
    const locked = initial.assignments[0];
    const rebuilt = await solveCallSchedule(state, 5, {
      lockedAssignments: [locked],
      baselineAssignments: initial.assignments
    });

    expect(rebuilt.hardViolationCount).toBe(0);
    expect(rebuilt.assignments).toContainEqual(locked);
    expect(rebuilt.assignments).toHaveLength(getCallBuilderSlots(5).length);
  }, 10_000);

  it("reports contradictory consecutive-day locks as infeasible", async () => {
    process.env.CALL_BUILDER_SOLVER_TIME_SECONDS = "1";
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const problem = buildSolverProblem(state, 3);
    const friday = problem.slots.find((slot) => slot.shift === "regular" && parseLocalDate(slot.date).getDay() === 5)!;
    const saturday = problem.slots.find((slot) =>
      slot.weekend === getCallBuilderWeekendAnchor(friday.date)
      && parseLocalDate(slot.date).getDay() === 6
    )!;
    const resident = problem.residents.find((candidate) =>
      candidate.eligibleSlotIds.includes(friday.id)
      && candidate.eligibleSlotIds.includes(saturday.id)
    )!;

    await expect(solveCallSchedule(state, 3, {
      lockedAssignments: [
        { date: friday.date, callPosition: resident.position, residentId: resident.id },
        { date: saturday.date, callPosition: resident.position, residentId: resident.id }
      ]
    })).rejects.toBeInstanceOf(CallBuilderInfeasibleError);
  }, 10_000);

  it("enforces build-specific weekends off and required call dates", async () => {
    process.env.CALL_BUILDER_SOLVER_TIME_SECONDS = "2";
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    const result = await solveCallSchedule(state, 3, {
      builderConstraints: [
        { id: "andrew_off", kind: "off", residentId: "res_chief", date: "2026-09-12", scope: "weekend" },
        { id: "nathan_required", kind: "required-call", residentId: "res_shigley", date: "2026-09-19", scope: "day" }
      ]
    });

    expect(result.hardViolationCount).toBe(0);
    expect(result.assignments).toContainEqual({ date: "2026-09-19", callPosition: "intern", residentId: "res_shigley" });
    expect(result.assignments.some((assignment) =>
      assignment.residentId === "res_chief"
      && assignment.date >= "2026-09-11"
      && assignment.date <= "2026-09-13"
    )).toBe(false);
  }, 10_000);

  it("explains contradictory build-specific requirements", async () => {
    const state = createInitialState(new Date("2026-08-30T12:00:00"));
    await expect(solveCallSchedule(state, 3, {
      builderConstraints: [
        { id: "off", kind: "off", residentId: "res_shigley", date: "2026-09-19", scope: "day" },
        { id: "required", kind: "required-call", residentId: "res_shigley", date: "2026-09-19", scope: "day" }
      ]
    })).rejects.toThrow("both required on call and required off");
  });
});
