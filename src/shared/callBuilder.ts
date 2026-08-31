import { isResidentCallEligible } from "./coverage";
import { addDays, parseLocalDate } from "./date";
import { comparePersonNames } from "./names";
import { getRotationForBlock, getRotationForDate, ROTATION_BLOCK_DATES } from "./rotations";
import { normalizeRotationServiceToServiceLine } from "./rotations";
import {
  CALL_POSITIONS,
  CallBuilderAssignment,
  CallBuilderEvaluation,
  CallBuilderIssue,
  CallBuilderIssueSeverity,
  CallBuilderResidentLoad,
  CallBuilderRule,
  CallBuilderSuggestion,
  CallPosition,
  PlannerState,
  Resident
} from "./types";

const TARGET_CALL_UNITS = 2;
const HARD_VIOLATION_PENALTY = 1_000_000;
const NO_CALL_FAIRNESS_PENALTY = 15_000;

interface EvaluationAccumulator {
  issues: CallBuilderIssue[];
  penalty: number;
  issueKeys: Set<string>;
}

interface HardEligibility {
  eligible: boolean;
  reason?: string;
  rule?: CallBuilderRule;
}

export const CALL_BUILDER_GOALS = [
  "Fairness: each available regular call-pool resident should receive one Saturday or two Friday/Sunday shifts, with absolutely no call on consecutive days.",
  "EGS chiefs take Sunday call only.",
  "EGS mid-level residents do not take Saturdays or share a call weekend with the EGS chief.",
  "Trauma chiefs take Friday call only, with a goal of two nonconsecutive Fridays.",
  "Approved unavailable time is protected.",
  "Priority call-off requests are protected when possible.",
  "A resident should not call twice in the same weekend.",
  "Avoid the weekends before and immediately after vacation weeks.",
  "Separate residents on the same service across weekends when possible.",
  "Avoid Saturdays at both a prior block's end and the new block's start.",
  "Secondary call-off requests are protected when possible."
] as const;

export function getCallBuilderBlock(blockNumber: number) {
  return ROTATION_BLOCK_DATES.find((block) => block.blockNumber === blockNumber);
}

export function getCallBuilderDates(blockNumber: number): string[] {
  const block = getCallBuilderBlock(blockNumber);
  if (!block) return [];
  const dates: string[] = [];
  for (let date: string = block.startDate; date <= block.endDate; date = addDays(date, 1)) {
    const weekday = parseLocalDate(date).getDay();
    if (weekday === 5 || weekday === 6 || weekday === 0) dates.push(date);
  }
  return dates;
}

export function getCallBuilderWeekendAnchor(date: string): string {
  const weekday = parseLocalDate(date).getDay();
  if (weekday === 6) return addDays(date, -1);
  if (weekday === 0) return addDays(date, -2);
  return date;
}

export function getCallPositionForResident(resident: Pick<Resident, "trainingLevel">): CallPosition | undefined {
  if (resident.trainingLevel === "PGY4" || resident.trainingLevel === "PGY5") return "senior";
  if (resident.trainingLevel === "PGY2" || resident.trainingLevel === "PGY3") return "mid-level";
  if (resident.trainingLevel === "PGY1") return "intern";
  return undefined;
}

export function getCallBuilderResidentsForPosition(state: PlannerState, callPosition: CallPosition): Resident[] {
  return state.residents
    .filter((resident) => isBaseCallPoolResident(resident) && getCallPositionForResident(resident) === callPosition)
    .sort((left, right) => comparePersonNames(left.name, right.name));
}

export function generateCallSchedule(state: PlannerState, blockNumber: number): CallBuilderEvaluation {
  const slots = getExpectedSlots(blockNumber).sort(compareBuildSlotPriority);
  let assignments: CallBuilderAssignment[] = [];

  for (const slot of slots) {
    const candidates = getCallBuilderResidentsForPosition(state, slot.callPosition)
      .filter((resident) => isHardEligibleForCallAssignment(resident, slot.date).eligible)
      .filter((resident) => !assignments.some((assignment) => assignment.date === slot.date && assignment.residentId === resident.id))
      .map((resident) => ({ resident, cost: getCandidateCost(state, blockNumber, assignments, slot, resident) }))
      .sort((left, right) => left.cost - right.cost || comparePersonNames(left.resident.name, right.resident.name));
    const resident = candidates[0]?.resident;
    if (resident) assignments.push({ ...slot, residentId: resident.id });
  }

  assignments = optimizeAssignments(state, blockNumber, assignments);
  return {
    ...evaluateCallSchedule(state, blockNumber, assignments),
    solverSummary: {
      engine: "heuristic",
      engineVersion: "call-builder-heuristic-v2",
      status: "fallback",
      optimalityProven: false,
      durationMs: 0,
      objectives: [],
      message: "The local constraint solver was unavailable, so the deterministic fallback was used."
    }
  };
}

export function evaluateCallSchedule(
  state: PlannerState,
  blockNumber: number,
  assignments: CallBuilderAssignment[]
): CallBuilderEvaluation {
  const accumulator: EvaluationAccumulator = { issues: [], penalty: 0, issueKeys: new Set() };
  const block = getCallBuilderBlock(blockNumber);
  const expectedSlots = getExpectedSlots(blockNumber);
  const expectedKeys = new Set(expectedSlots.map(assignmentSlotKey));
  const residentsById = new Map(state.residents.map((resident) => [resident.id, resident]));
  const slotCounts = new Map<string, number>();

  if (!block) {
    addIssue(accumulator, "error", "coverage", `Unknown rotation block ${blockNumber}`, HARD_VIOLATION_PENALTY);
  }

  for (const assignment of assignments) {
    const key = assignmentSlotKey(assignment);
    slotCounts.set(key, (slotCounts.get(key) ?? 0) + 1);
    if (!expectedKeys.has(key)) {
      addIssue(
        accumulator,
        "error",
        "coverage",
        `${assignment.date} ${formatPosition(assignment.callPosition)} is outside this block's call slots.`,
        HARD_VIOLATION_PENALTY,
        assignment.date,
        [assignment.residentId],
        `extra:${key}:${assignment.residentId}`
      );
    }

    const resident = residentsById.get(assignment.residentId);
    if (!resident) {
      addIssue(
        accumulator,
        "error",
        "coverage",
        `Unknown resident ${assignment.residentId} is assigned on ${assignment.date}.`,
        HARD_VIOLATION_PENALTY,
        assignment.date,
        [assignment.residentId]
      );
      continue;
    }

    const expectedPosition = getCallPositionForResident(resident);
    if (expectedPosition !== assignment.callPosition) {
      addIssue(
        accumulator,
        "error",
        "coverage",
        `${resident.name} cannot fill the ${formatPosition(assignment.callPosition)} position.`,
        HARD_VIOLATION_PENALTY,
        assignment.date,
        [resident.id],
        `position:${key}:${resident.id}`
      );
    }

    const hardEligibility = isHardEligibleForCallAssignment(resident, assignment.date);
    if (!hardEligibility.eligible) {
      addIssue(
        accumulator,
        "error",
        hardEligibility.rule ?? "coverage",
        `${resident.name} cannot take call on ${assignment.date}: ${hardEligibility.reason}.`,
        HARD_VIOLATION_PENALTY,
        assignment.date,
        [resident.id],
        `ineligible:${assignment.date}:${resident.id}`
      );
    }
  }

  for (const slot of expectedSlots) {
    const count = slotCounts.get(assignmentSlotKey(slot)) ?? 0;
    if (count === 0) {
      addIssue(
        accumulator,
        "error",
        "coverage",
        `${slot.date} is missing its ${formatPosition(slot.callPosition)} resident.`,
        HARD_VIOLATION_PENALTY,
        slot.date,
        undefined,
        `missing:${assignmentSlotKey(slot)}`
      );
    } else if (count > 1) {
      addIssue(
        accumulator,
        "error",
        "coverage",
        `${slot.date} has ${count} residents in the ${formatPosition(slot.callPosition)} position.`,
        HARD_VIOLATION_PENALTY,
        slot.date,
        undefined,
        `duplicate-slot:${assignmentSlotKey(slot)}`
      );
    }
  }

  for (const date of getCallBuilderDates(blockNumber)) {
    const dateAssignments = assignments.filter((assignment) => assignment.date === date);
    const residentCounts = new Map<string, number>();
    for (const assignment of dateAssignments) {
      residentCounts.set(assignment.residentId, (residentCounts.get(assignment.residentId) ?? 0) + 1);
    }
    for (const [residentId, count] of residentCounts) {
      if (count <= 1) continue;
      const resident = residentsById.get(residentId);
      addIssue(
        accumulator,
        "error",
        "coverage",
        `${resident?.name ?? residentId} is assigned to ${count} positions on ${date}.`,
        HARD_VIOLATION_PENALTY,
        date,
        [residentId],
        `duplicate-resident:${date}:${residentId}`
      );
    }
  }

  const residentLoads = buildResidentLoads(state, blockNumber, assignments);
  const regularLoads = residentLoads.filter((load) => load.regularPool);
  let totalFairnessDelta = 0;
  for (const load of regularLoads) {
    const delta = load.units < load.targetMinUnits
      ? load.targetMinUnits - load.units
      : load.units > load.targetMaxUnits
        ? load.units - load.targetMaxUnits
        : 0;
    totalFairnessDelta += delta;
    if (delta === 0) continue;
    const description = load.units === 0
      ? `${load.residentName} is in the regular ${formatPosition(load.callPosition)} pool but has no call assignment.`
      : `${load.residentName} has ${load.units} call unit${load.units === 1 ? "" : "s"}; the achievable target is ${formatTargetRange(load.targetMinUnits, load.targetMaxUnits)}.`;
    addIssue(
      accumulator,
      "warning",
      "fairness",
      description,
      delta * 12_000 + (load.units === 0 ? NO_CALL_FAIRNESS_PENALTY : 0),
      undefined,
      [load.residentId],
      `fairness:${load.residentId}`
    );
  }

  evaluateAssignmentPreferences(state, blockNumber, assignments, residentsById, accumulator);
  evaluateResidentSpacing(assignments, residentsById, accumulator);
  evaluateWeekendServiceSeparation(state, assignments, residentsById, accumulator);
  evaluateEgsPairings(assignments, residentsById, accumulator);
  evaluateTraumaChiefTargets(state, blockNumber, assignments, residentsById, accumulator);

  const fairnessDenominator = Math.max(1, regularLoads.reduce((total, load) => total + load.targetMinUnits, 0));
  const fairnessPercent = Math.max(0, Math.round(100 - (totalFairnessDelta / fairnessDenominator) * 100));
  const hardViolationCount = accumulator.issues.filter((issue) => issue.severity === "error").length;
  const warningCount = accumulator.issues.filter((issue) => issue.severity === "warning").length;
  const softPenalty = accumulator.penalty - hardViolationCount * HARD_VIOLATION_PENALTY;
  const qualityScore = Math.max(0, Math.round(100 - hardViolationCount * 20 - Math.min(80, softPenalty / 3_000)));

  return {
    blockNumber,
    assignments: sortAssignments(assignments),
    issues: sortIssues(accumulator.issues),
    residentLoads,
    hardViolationCount,
    warningCount,
    fairnessPercent,
    qualityScore,
    penalty: accumulator.penalty
  };
}

export function suggestCallScheduleMoves(
  state: PlannerState,
  blockNumber: number,
  assignments: CallBuilderAssignment[],
  limit = 5
): CallBuilderSuggestion[] {
  const current = evaluateCallSchedule(state, blockNumber, assignments);
  const candidates: CallBuilderSuggestion[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < assignments.length; index += 1) {
    const assignment = assignments[index];
    const currentResident = state.residents.find((resident) => resident.id === assignment.residentId);
    for (const resident of getCallBuilderResidentsForPosition(state, assignment.callPosition)) {
      if (resident.id === assignment.residentId || !isHardEligibleForCallAssignment(resident, assignment.date).eligible) continue;
      if (assignments.some((item, itemIndex) => itemIndex !== index && item.date === assignment.date && item.residentId === resident.id)) continue;
      const next = assignments.map((item, itemIndex) => itemIndex === index ? { ...item, residentId: resident.id } : item);
      addSuggestion(
        candidates,
        seen,
        current,
        evaluateCallSchedule(state, blockNumber, next),
        `${resident.name} replaces ${currentResident?.name ?? assignment.residentId} on ${assignment.date}`
      );
    }
  }

  for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex += 1) {
      const left = assignments[leftIndex];
      const right = assignments[rightIndex];
      if (left.callPosition !== right.callPosition || left.residentId === right.residentId) continue;
      const leftResident = state.residents.find((resident) => resident.id === left.residentId);
      const rightResident = state.residents.find((resident) => resident.id === right.residentId);
      if (!leftResident || !rightResident) continue;
      if (!isHardEligibleForCallAssignment(leftResident, right.date).eligible || !isHardEligibleForCallAssignment(rightResident, left.date).eligible) continue;
      const next = assignments.map((item, itemIndex) => {
        if (itemIndex === leftIndex) return { ...item, residentId: right.residentId };
        if (itemIndex === rightIndex) return { ...item, residentId: left.residentId };
        return item;
      });
      addSuggestion(
        candidates,
        seen,
        current,
        evaluateCallSchedule(state, blockNumber, next),
        `Swap ${leftResident.name} (${left.date}) with ${rightResident.name} (${right.date})`
      );
    }
  }

  return candidates
    .sort((left, right) => right.improvement - left.improvement || left.description.localeCompare(right.description))
    .slice(0, Math.max(0, limit));
}

function optimizeAssignments(
  state: PlannerState,
  blockNumber: number,
  initialAssignments: CallBuilderAssignment[]
): CallBuilderAssignment[] {
  let assignments = initialAssignments;
  let evaluation = evaluateCallSchedule(state, blockNumber, assignments);

  for (let pass = 0; pass < 2; pass += 1) {
    let bestAssignments: CallBuilderAssignment[] | undefined;
    let bestEvaluation = evaluation;

    for (let index = 0; index < assignments.length; index += 1) {
      const assignment = assignments[index];
      for (const resident of getCallBuilderResidentsForPosition(state, assignment.callPosition)) {
        if (resident.id === assignment.residentId || !isHardEligibleForCallAssignment(resident, assignment.date).eligible) continue;
        if (assignments.some((item, itemIndex) => itemIndex !== index && item.date === assignment.date && item.residentId === resident.id)) continue;
        const candidate = assignments.map((item, itemIndex) => itemIndex === index ? { ...item, residentId: resident.id } : item);
        const candidateEvaluation = evaluateCallSchedule(state, blockNumber, candidate);
        if (candidateEvaluation.penalty < bestEvaluation.penalty) {
          bestAssignments = candidate;
          bestEvaluation = candidateEvaluation;
        }
      }
    }

    for (let leftIndex = 0; leftIndex < assignments.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < assignments.length; rightIndex += 1) {
        const left = assignments[leftIndex];
        const right = assignments[rightIndex];
        if (left.callPosition !== right.callPosition || left.residentId === right.residentId) continue;
        const leftResident = state.residents.find((resident) => resident.id === left.residentId);
        const rightResident = state.residents.find((resident) => resident.id === right.residentId);
        if (!leftResident || !rightResident) continue;
        if (!isHardEligibleForCallAssignment(leftResident, right.date).eligible || !isHardEligibleForCallAssignment(rightResident, left.date).eligible) continue;
        const candidate = assignments.map((item, itemIndex) => {
          if (itemIndex === leftIndex) return { ...item, residentId: right.residentId };
          if (itemIndex === rightIndex) return { ...item, residentId: left.residentId };
          return item;
        });
        const candidateEvaluation = evaluateCallSchedule(state, blockNumber, candidate);
        if (candidateEvaluation.penalty < bestEvaluation.penalty) {
          bestAssignments = candidate;
          bestEvaluation = candidateEvaluation;
        }
      }
    }

    if (!bestAssignments) break;
    assignments = bestAssignments;
    evaluation = bestEvaluation;
  }

  return assignments;
}

function getExpectedSlots(blockNumber: number): Array<Omit<CallBuilderAssignment, "residentId">> {
  return getCallBuilderDates(blockNumber).flatMap((date) =>
    CALL_POSITIONS.map((callPosition) => ({ date, callPosition }))
  );
}

function compareBuildSlotPriority(
  left: Omit<CallBuilderAssignment, "residentId">,
  right: Omit<CallBuilderAssignment, "residentId">
): number {
  const priority = (slot: Omit<CallBuilderAssignment, "residentId">) => {
    const weekday = parseLocalDate(slot.date).getDay();
    if (slot.callPosition === "senior" && weekday === 5) return 0;
    if (slot.callPosition === "senior" && weekday === 0) return 1;
    if (slot.callPosition === "mid-level" && weekday === 5) return 2;
    if (slot.callPosition === "mid-level" && weekday === 0) return 3;
    if (slot.callPosition === "intern" && weekday === 6) return 4;
    if (weekday === 6) return 5;
    return 6;
  };
  return priority(left) - priority(right) || left.date.localeCompare(right.date) || CALL_POSITIONS.indexOf(left.callPosition) - CALL_POSITIONS.indexOf(right.callPosition);
}

function getCandidateCost(
  state: PlannerState,
  blockNumber: number,
  assignments: CallBuilderAssignment[],
  slot: Omit<CallBuilderAssignment, "residentId">,
  resident: Resident
): number {
  const unitsBefore = assignments
    .filter((assignment) => assignment.residentId === resident.id)
    .reduce((total, assignment) => total + getCallUnits(assignment.date), 0);
  const unitsAfter = unitsBefore + getCallUnits(slot.date);
  let cost = (Math.abs(unitsAfter - TARGET_CALL_UNITS) - Math.abs(unitsBefore - TARGET_CALL_UNITS)) * 12_000;
  if (unitsBefore === 0 && unitsAfter > 0) cost -= NO_CALL_FAIRNESS_PENALTY;
  if (unitsAfter > TARGET_CALL_UNITS) cost += (unitsAfter - TARGET_CALL_UNITS) * 20_000;

  const service = getResidentService(resident, slot.date);
  const weekendAnchor = getCallBuilderWeekendAnchor(slot.date);
  const weekday = parseLocalDate(slot.date).getDay();
  const sameWeekend = assignments.filter((assignment) => getCallBuilderWeekendAnchor(assignment.date) === weekendAnchor);
  const residentWeekendAssignments = sameWeekend.filter((assignment) => assignment.residentId === resident.id);
  if (residentWeekendAssignments.some((assignment) => Math.abs(daysBetween(assignment.date, slot.date)) === 1)) {
    cost += HARD_VIOLATION_PENALTY;
  } else if (residentWeekendAssignments.length > 0) {
    cost += 2_500;
  }
  const sameServiceCount = sameWeekend.filter((assignment) => {
    const assignedResident = state.residents.find((candidate) => candidate.id === assignment.residentId);
    return assignedResident && assignedResident.id !== resident.id && normalizeService(getResidentService(assignedResident, assignment.date)) === normalizeService(service);
  }).length;
  cost += sameServiceCount * 700;

  if (isEgsChief(resident, slot.date)) cost += weekday === 0 ? -5_000 : 9_000;
  if (isEgsMidlevel(resident, slot.date)) {
    if (weekday === 6) cost += 8_000;
    if (sameWeekend.some((assignment) => {
      const assignedResident = state.residents.find((candidate) => candidate.id === assignment.residentId);
      return assignedResident && isEgsChief(assignedResident, assignment.date);
    })) cost += 6_000;
  }
  if (isTraumaChief(resident, slot.date)) {
    if (weekday !== 5) cost += 7_000;
    else {
      const traumaFridays = assignments
        .filter((assignment) => assignment.residentId === resident.id && parseLocalDate(assignment.date).getDay() === 5)
        .map((assignment) => assignment.date);
      cost += traumaFridays.length < 2 ? -4_000 : 3_000;
      if (traumaFridays.some((date) => Math.abs(daysBetween(date, slot.date)) === 7)) cost += 3_500;
    }
  }

  const request = getCallOffRequest(state, resident.id, slot.date);
  if (request?.priority === "priority") cost += 3_500;
  if (request?.priority === "secondary") cost += 300;
  if (isVacationAdjacent(resident, slot.date)) cost += 1_400;
  if (isCrossBlockSaturday(state, blockNumber, resident.id, slot.date)) cost += 500;

  if (isNrvMidlevel(resident, slot.date)) cost += regularPoolCapacityCoversBlock(state, blockNumber, "mid-level") ? 6_000 : 800;
  if (isNrvChief(resident, slot.date)) cost += regularPoolCapacityCoversBlock(state, blockNumber, "senior", resident.id) ? 1_800 : 300;
  return cost;
}

function evaluateResidentSpacing(
  assignments: CallBuilderAssignment[],
  residentsById: Map<string, Resident>,
  accumulator: EvaluationAccumulator
) {
  const assignmentsByResident = new Map<string, CallBuilderAssignment[]>();
  for (const assignment of assignments) {
    const residentAssignments = assignmentsByResident.get(assignment.residentId) ?? [];
    residentAssignments.push(assignment);
    assignmentsByResident.set(assignment.residentId, residentAssignments);
  }

  for (const [residentId, residentAssignments] of assignmentsByResident) {
    const resident = residentsById.get(residentId);
    const uniqueDates = [...new Set(residentAssignments.map((assignment) => assignment.date))].sort();
    for (let index = 1; index < uniqueDates.length; index += 1) {
      if (daysBetween(uniqueDates[index - 1], uniqueDates[index]) !== 1) continue;
      addIssue(
        accumulator,
        "error",
        "consecutive-days",
        `${resident?.name ?? residentId} is assigned on consecutive days (${uniqueDates[index - 1]} and ${uniqueDates[index]}).`,
        HARD_VIOLATION_PENALTY,
        uniqueDates[index],
        [residentId],
        `consecutive-days:${residentId}:${uniqueDates[index - 1]}:${uniqueDates[index]}`
      );
    }

    const datesByWeekend = new Map<string, Set<string>>();
    for (const date of uniqueDates) {
      const anchor = getCallBuilderWeekendAnchor(date);
      const weekendDates = datesByWeekend.get(anchor) ?? new Set<string>();
      weekendDates.add(date);
      datesByWeekend.set(anchor, weekendDates);
    }
    for (const [anchor, weekendDates] of datesByWeekend) {
      if (weekendDates.size <= 1) continue;
      addIssue(
        accumulator,
        "warning",
        "same-weekend",
        `${resident?.name ?? residentId} is assigned more than once during the weekend of ${anchor}.`,
        2_500,
        anchor,
        [residentId],
        `same-weekend:${residentId}:${anchor}`
      );
    }
  }
}

function evaluateAssignmentPreferences(
  state: PlannerState,
  blockNumber: number,
  assignments: CallBuilderAssignment[],
  residentsById: Map<string, Resident>,
  accumulator: EvaluationAccumulator
) {
  for (const assignment of assignments) {
    const resident = residentsById.get(assignment.residentId);
    if (!resident) continue;
    const request = getCallOffRequest(state, resident.id, assignment.date);
    if (request?.priority === "priority") {
      addIssue(accumulator, "warning", "priority-request", `${resident.name}'s priority ${request.scope === "weekend" ? "weekend" : "day"} off request is not honored.`, 3_500, assignment.date, [resident.id]);
    }
    if (request?.priority === "secondary") {
      addIssue(accumulator, "info", "secondary-request", `${resident.name}'s secondary ${request.scope === "weekend" ? "weekend" : "day"} off request is not honored.`, 300, assignment.date, [resident.id]);
    }
    if (isVacationAdjacent(resident, assignment.date)) {
      addIssue(accumulator, "warning", "vacation", `${resident.name} is assigned on the weekend immediately before or after vacation.`, 1_400, assignment.date, [resident.id]);
    }
    if (isCrossBlockSaturday(state, blockNumber, resident.id, assignment.date)) {
      addIssue(accumulator, "warning", "cross-block-saturday", `${resident.name} has Saturday call at the prior block's end and this block's start.`, 500, assignment.date, [resident.id]);
    }
    if (isNrvMidlevel(resident, assignment.date) && regularPoolCapacityCoversBlock(state, blockNumber, "mid-level")) {
      addIssue(accumulator, "warning", "nrv-pool", `${resident.name}, an NRV mid-level resident, is used even though the regular pool can cover the block.`, 4_000, assignment.date, [resident.id]);
    }
    if (isNrvChief(resident, assignment.date) && regularPoolCapacityCoversBlock(state, blockNumber, "senior", resident.id)) {
      addIssue(accumulator, "info", "nrv-pool", `${resident.name}, the NRV chief, is used while other senior pool capacity is available.`, 800, assignment.date, [resident.id]);
    }
  }
}

function evaluateWeekendServiceSeparation(
  state: PlannerState,
  assignments: CallBuilderAssignment[],
  residentsById: Map<string, Resident>,
  accumulator: EvaluationAccumulator
) {
  const anchors = [...new Set(assignments.map((assignment) => getCallBuilderWeekendAnchor(assignment.date)))];
  for (const anchor of anchors) {
    const residentsByService = new Map<string, Set<string>>();
    for (const assignment of assignments.filter((item) => getCallBuilderWeekendAnchor(item.date) === anchor)) {
      const resident = residentsById.get(assignment.residentId);
      if (!resident) continue;
      const service = getResidentService(resident, assignment.date);
      const key = normalizeService(service);
      if (!key) continue;
      const residentIds = residentsByService.get(key) ?? new Set<string>();
      residentIds.add(resident.id);
      residentsByService.set(key, residentIds);
    }
    for (const residentIds of residentsByService.values()) {
      if (residentIds.size <= 1) continue;
      const ids = [...residentIds];
      const names = ids.map((id) => residentsById.get(id)?.name ?? id);
      const service = getResidentService(residentsById.get(ids[0])!, anchor);
      addIssue(
        accumulator,
        "warning",
        "same-service",
        `${names.join(" and ")} are both on ${service || "the same service"} and call the weekend of ${anchor}.`,
        Math.max(1, ids.length - 1) * 600,
        anchor,
        ids,
        `same-service:${anchor}:${normalizeService(service)}`
      );
    }
  }
}

function evaluateEgsPairings(
  assignments: CallBuilderAssignment[],
  residentsById: Map<string, Resident>,
  accumulator: EvaluationAccumulator
) {
  const anchors = [...new Set(assignments.map((assignment) => getCallBuilderWeekendAnchor(assignment.date)))];
  for (const anchor of anchors) {
    const weekendAssignments = assignments.filter((assignment) => getCallBuilderWeekendAnchor(assignment.date) === anchor);
    const chiefs = weekendAssignments.filter((assignment) => {
      const resident = residentsById.get(assignment.residentId);
      return resident && isEgsChief(resident, assignment.date);
    });
    const midlevels = weekendAssignments.filter((assignment) => {
      const resident = residentsById.get(assignment.residentId);
      return resident && isEgsMidlevel(resident, assignment.date);
    });
    if (!chiefs.length || !midlevels.length) continue;
    const ids = [...new Set([...chiefs, ...midlevels].map((assignment) => assignment.residentId))];
    addIssue(
      accumulator,
      "error",
      "egs-midlevel",
      `The EGS chief and EGS mid-level resident are both on call the weekend of ${anchor}.`,
      HARD_VIOLATION_PENALTY,
      anchor,
      ids,
      `egs-pair:${anchor}`
    );
  }
}

function evaluateTraumaChiefTargets(
  state: PlannerState,
  blockNumber: number,
  assignments: CallBuilderAssignment[],
  residentsById: Map<string, Resident>,
  accumulator: EvaluationAccumulator
) {
  const traumaChiefs = getRegularPoolResidents(state, blockNumber, "senior").filter((resident) => {
    const block = getCallBuilderBlock(blockNumber);
    return Boolean(block && isTraumaService(getRotationForBlock(resident, blockNumber)?.service ?? ""));
  });
  for (const resident of traumaChiefs) {
    const fridayDates = assignments
      .filter((assignment) => assignment.residentId === resident.id && parseLocalDate(assignment.date).getDay() === 5)
      .map((assignment) => assignment.date)
      .sort();
    if (fridayDates.length !== 2) {
      addIssue(
        accumulator,
        "warning",
        "trauma-chief",
        `${resident.name}, the Trauma chief, has ${fridayDates.length} Friday call${fridayDates.length === 1 ? "" : "s"}; the goal is two.`,
        Math.abs(fridayDates.length - 2) * 4_000,
        undefined,
        [resident.id],
        `trauma-count:${resident.id}`
      );
    }
    for (let index = 1; index < fridayDates.length; index += 1) {
      if (daysBetween(fridayDates[index - 1], fridayDates[index]) !== 7) continue;
      addIssue(
        accumulator,
        "warning",
        "trauma-chief",
        `${resident.name}'s Trauma-chief Fridays are back to back.`,
        2_500,
        fridayDates[index],
        [resident.id],
        `trauma-consecutive:${resident.id}:${fridayDates[index]}`
      );
    }
  }
}

function buildResidentLoads(
  state: PlannerState,
  blockNumber: number,
  assignments: CallBuilderAssignment[]
): CallBuilderResidentLoad[] {
  const targets = buildFairnessTargetRanges(state, blockNumber);
  return CALL_POSITIONS.flatMap((callPosition) => {
    const residents = getAvailablePoolResidents(state, blockNumber, callPosition);
    return residents.map((resident) => {
      const residentAssignments = assignments.filter((assignment) => assignment.residentId === resident.id);
      const service = getRotationForBlock(resident, blockNumber)?.service ?? "Not listed";
      const regularPool = isRegularPoolResidentForState(state, resident, blockNumber);
      const target = targets.get(callPosition) ?? { min: 0, max: 0 };
      return {
        residentId: resident.id,
        residentName: resident.name,
        callPosition,
        service,
        units: residentAssignments.reduce((total, assignment) => total + getCallUnits(assignment.date), 0),
        shiftCount: residentAssignments.length,
        targetUnits: regularPool ? TARGET_CALL_UNITS : 0,
        targetMinUnits: regularPool ? target.min : 0,
        targetMaxUnits: regularPool ? target.max : 0,
        regularPool
      };
    });
  }).sort((left, right) => CALL_POSITIONS.indexOf(left.callPosition) - CALL_POSITIONS.indexOf(right.callPosition) || comparePersonNames(left.residentName, right.residentName));
}

export function getAvailablePoolResidents(state: PlannerState, blockNumber: number, callPosition: CallPosition): Resident[] {
  const dates = getCallBuilderDates(blockNumber);
  return getCallBuilderResidentsForPosition(state, callPosition)
    .filter((resident) => Boolean(getRotationForBlock(resident, blockNumber)))
    .filter((resident) => dates.some((date) => isHardEligibleForCallAssignment(resident, date).eligible));
}

export function getRegularPoolResidents(state: PlannerState, blockNumber: number, callPosition: CallPosition): Resident[] {
  return getAvailablePoolResidents(state, blockNumber, callPosition)
    .filter((resident) => isRegularPoolResidentForState(state, resident, blockNumber));
}

export function isRegularPoolResidentForState(state: PlannerState, resident: Resident, blockNumber: number): boolean {
  const rotation = getRotationForBlock(resident, blockNumber);
  if (!rotation || isRestrictedRotation(rotation.service)) return false;
  const position = getCallPositionForResident(resident);
  if (position === "mid-level" && isNrvService(rotation.service)) return false;
  if (position === "senior" && isNrvService(rotation.service)) {
    const requiredUnits = getCallBuilderDates(blockNumber).reduce((total, date) => total + getCallUnits(date), 0);
    const nonNrvSeniorCount = getAvailablePoolResidents(state, blockNumber, "senior")
      .filter((candidate) => !isNrvService(getRotationForBlock(candidate, blockNumber)?.service ?? ""))
      .length;
    return nonNrvSeniorCount * TARGET_CALL_UNITS < requiredUnits;
  }
  return true;
}

function regularPoolCapacityCoversBlock(
  state: PlannerState,
  blockNumber: number,
  callPosition: CallPosition,
  excludedResidentId?: string
): boolean {
  const requiredUnits = getCallBuilderDates(blockNumber).reduce((total, date) => total + getCallUnits(date), 0);
  const regularResidents = getRegularPoolResidents(state, blockNumber, callPosition)
    .filter((resident) => resident.id !== excludedResidentId);
  return regularResidents.length * TARGET_CALL_UNITS >= requiredUnits;
}

export function getFairnessTargetRange(
  state: PlannerState,
  blockNumber: number,
  callPosition: CallPosition
): { min: number; max: number; desiredRegularUnits: number } {
  const regularResidents = getRegularPoolResidents(state, blockNumber, callPosition);
  if (regularResidents.length === 0) return { min: 0, max: 0, desiredRegularUnits: 0 };
  const availableResidents = getAvailablePoolResidents(state, blockNumber, callPosition);
  const hasReserve = availableResidents.some((resident) => !regularResidents.some((regular) => regular.id === resident.id));
  const requiredUnits = getCallBuilderDates(blockNumber).reduce((total, date) => total + getCallUnits(date), 0);
  const desiredRegularUnits = hasReserve
    ? Math.min(requiredUnits, regularResidents.length * TARGET_CALL_UNITS)
    : requiredUnits;
  return {
    min: Math.floor(desiredRegularUnits / regularResidents.length),
    max: Math.ceil(desiredRegularUnits / regularResidents.length),
    desiredRegularUnits
  };
}

function buildFairnessTargetRanges(state: PlannerState, blockNumber: number) {
  return new Map(CALL_POSITIONS.map((position) => [position, getFairnessTargetRange(state, blockNumber, position)]));
}

function isBaseCallPoolResident(resident: Resident): boolean {
  return resident.rosterKind === "primary" && isResidentCallEligible(resident) && Boolean(getCallPositionForResident(resident));
}

export function isHardEligibleForDate(resident: Resident, date: string): HardEligibility {
  if (!isBaseCallPoolResident(resident)) return { eligible: false, reason: "not in the resident call pool", rule: "coverage" };
  const rotation = getRotationForDate(resident, date);
  if (!rotation) return { eligible: false, reason: "no rotation is listed for this date", rule: "coverage" };
  if (isRestrictedRotation(rotation.service)) {
    return { eligible: false, reason: `${rotation.service} residents are protected from call`, rule: "approved-unavailable" };
  }
  const unavailable = resident.unavailable.find((block) => block.date <= date && (block.endDate ?? block.date) >= date);
  if (unavailable) {
    return { eligible: false, reason: unavailable.label || "approved unavailable time", rule: "approved-unavailable" };
  }
  return { eligible: true };
}

export function isHardEligibleForCallAssignment(resident: Resident, date: string): HardEligibility {
  const base = isHardEligibleForDate(resident, date);
  if (!base.eligible) return base;
  const weekday = parseLocalDate(date).getDay();
  if (isEgsChief(resident, date) && weekday !== 0) {
    return { eligible: false, reason: "EGS chiefs take Sunday call only", rule: "egs-chief" };
  }
  if (isEgsMidlevel(resident, date) && weekday === 6) {
    return { eligible: false, reason: "EGS mid-level residents do not take Saturday call", rule: "egs-midlevel" };
  }
  if (isTraumaChief(resident, date) && weekday !== 5) {
    return { eligible: false, reason: "Trauma chiefs take Friday call only", rule: "trauma-chief" };
  }
  return { eligible: true };
}

function isRestrictedRotation(service: string): boolean {
  const normalized = normalizeService(service);
  return normalized.includes("scc") || normalized.includes("critical care") || normalized.includes("transplant") || normalized.includes("burn") || normalized.includes("nfloat") || normalized.includes("night float");
}

function getResidentService(resident: Resident, date: string): string {
  return getRotationForDate(resident, date)?.service ?? resident.serviceTags[0] ?? "Not listed";
}

export function normalizeService(service: string): string {
  return service.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isEgsService(service: string): boolean {
  return normalizeRotationServiceToServiceLine(service) === "Ferrara" || /\begs\b/.test(normalizeService(service));
}

function isTraumaService(service: string): boolean {
  return normalizeRotationServiceToServiceLine(service) === "Gilbert" || normalizeService(service).includes("trauma");
}

function isNrvService(service: string): boolean {
  return normalizeRotationServiceToServiceLine(service) === "NRV";
}

export function isEgsChief(resident: Resident, date: string): boolean {
  return getCallPositionForResident(resident) === "senior" && isEgsService(getResidentService(resident, date));
}

export function isEgsMidlevel(resident: Resident, date: string): boolean {
  return getCallPositionForResident(resident) === "mid-level" && isEgsService(getResidentService(resident, date));
}

export function isTraumaChief(resident: Resident, date: string): boolean {
  return getCallPositionForResident(resident) === "senior" && isTraumaService(getResidentService(resident, date));
}

export function isNrvChief(resident: Resident, date: string): boolean {
  return getCallPositionForResident(resident) === "senior" && isNrvService(getResidentService(resident, date));
}

export function isNrvMidlevel(resident: Resident, date: string): boolean {
  return getCallPositionForResident(resident) === "mid-level" && isNrvService(getResidentService(resident, date));
}

export function getCallOffRequest(state: PlannerState, residentId: string, date: string) {
  const requests = state.callOffRequests ?? [];
  return requests
    .filter((request) => request.residentId === residentId)
    .filter((request) => request.scope === "day" ? request.date === date : getCallBuilderWeekendAnchor(request.date) === getCallBuilderWeekendAnchor(date))
    .sort((left, right) => Number(left.priority === "priority") - Number(right.priority === "priority"))
    .at(-1);
}

export function isVacationAdjacent(resident: Resident, date: string): boolean {
  const anchor = getCallBuilderWeekendAnchor(date);
  return (resident.vacation ?? []).some((vacation) => anchor >= addDays(vacation.startDate, -3) && anchor <= vacation.endDate);
}

export function isCrossBlockSaturday(
  state: PlannerState,
  blockNumber: number,
  residentId: string,
  date: string
): boolean {
  if (parseLocalDate(date).getDay() !== 6) return false;
  const firstSaturday = getCallBuilderDates(blockNumber).find((candidate) => parseLocalDate(candidate).getDay() === 6);
  if (!firstSaturday || date !== firstSaturday) return false;
  const priorSaturday = addDays(date, -7);
  const previousMainDraftHasSaturday = state.callScheduleDrafts.some((draft) =>
    draft.isMain
    && draft.blockNumber < blockNumber
    && draft.assignments.some((assignment) => assignment.date === priorSaturday && assignment.residentId === residentId)
  );
  return previousMainDraftHasSaturday
    || state.coverageEntries.some((entry) => entry.kind === "call" && entry.date === priorSaturday && entry.residentId === residentId);
}

export function getCallUnits(date: string): number {
  return parseLocalDate(date).getDay() === 6 ? 2 : 1;
}

function daysBetween(left: string, right: string): number {
  return Math.round((parseLocalDate(right).getTime() - parseLocalDate(left).getTime()) / (24 * 60 * 60 * 1000));
}

function assignmentSlotKey(assignment: Pick<CallBuilderAssignment, "date" | "callPosition">): string {
  return `${assignment.date}:${assignment.callPosition}`;
}

function addIssue(
  accumulator: EvaluationAccumulator,
  severity: CallBuilderIssueSeverity,
  rule: CallBuilderRule,
  message: string,
  penalty: number,
  date?: string,
  residentIds?: string[],
  explicitKey?: string
) {
  const key = explicitKey ?? `${severity}:${rule}:${date ?? ""}:${(residentIds ?? []).join(",")}:${message}`;
  if (accumulator.issueKeys.has(key)) return;
  accumulator.issueKeys.add(key);
  accumulator.issues.push({ id: key, severity, rule, message, date, residentIds });
  accumulator.penalty += penalty;
}

function addSuggestion(
  suggestions: CallBuilderSuggestion[],
  seen: Set<string>,
  current: CallBuilderEvaluation,
  candidate: CallBuilderEvaluation,
  description: string
) {
  const improvement = current.penalty - candidate.penalty;
  if (improvement <= 0 || candidate.hardViolationCount > current.hardViolationCount) return;
  const key = candidate.assignments.map((assignment) => `${assignmentSlotKey(assignment)}:${assignment.residentId}`).join("|");
  if (seen.has(key)) return;
  seen.add(key);
  suggestions.push({
    id: `move:${suggestions.length + 1}:${key}`,
    description,
    improvement,
    assignments: candidate.assignments
  });
}

function sortAssignments(assignments: CallBuilderAssignment[]): CallBuilderAssignment[] {
  return [...assignments].sort((left, right) => left.date.localeCompare(right.date) || CALL_POSITIONS.indexOf(left.callPosition) - CALL_POSITIONS.indexOf(right.callPosition));
}

function sortIssues(issues: CallBuilderIssue[]): CallBuilderIssue[] {
  const severityRank: Record<CallBuilderIssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  const ruleRank: Record<CallBuilderRule, number> = {
    coverage: 0,
    fairness: 1,
    "consecutive-days": 1,
    "egs-chief": 2,
    "egs-midlevel": 3,
    "trauma-chief": 4,
    "approved-unavailable": 5,
    "priority-request": 6,
    "same-weekend": 7,
    vacation: 8,
    "same-service": 9,
    "cross-block-saturday": 10,
    "secondary-request": 11,
    "nrv-pool": 12
  };
  return [...issues].sort((left, right) =>
    severityRank[left.severity] - severityRank[right.severity]
    || ruleRank[left.rule] - ruleRank[right.rule]
    || (left.date ?? "").localeCompare(right.date ?? "")
    || left.message.localeCompare(right.message)
  );
}

function formatPosition(position: CallPosition): string {
  return position === "mid-level" ? "mid-level" : position;
}

function formatTargetRange(min: number, max: number): string {
  if (min === max) return `${min} call unit${min === 1 ? "" : "s"}`;
  return `${min}–${max} call units`;
}
