import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateCallSchedule,
  generateCallSchedule,
  getAvailablePoolResidents,
  getCallBuilderBlock,
  getCallBuilderDates,
  getCallBuilderSlots,
  getCallBuilderResidentsForPosition,
  getCallBuilderWeekendAnchor,
  getCallOffRequest,
  getCallPositionForResident,
  getCallUnits,
  getFairnessTargetRange,
  isCrossBlockSaturday,
  isEgsChief,
  isEgsMidlevel,
  isHardEligibleForCallAssignment,
  isResidentForcedOff,
  isNrvChief,
  isNrvMidlevel,
  isRegularPoolResidentForState,
  isTraumaChief,
  isVacationAdjacent,
  normalizeService
} from "../shared/callBuilder";
import { parseLocalDate } from "../shared/date";
import { compareCallOffRequestPrecedence, getCallOffRequestSeniority } from "../shared/callOffRequests";
import { getRotationForDate, normalizeRotationServiceToServiceLine } from "../shared/rotations";
import {
  CALL_POSITIONS,
  CallBuilderAssignment,
  CallBuilderConstraint,
  CallBuilderEvaluation,
  CallBuilderSolverSummary,
  CallPosition,
  PlannerState
} from "../shared/types";

const SOLVER_TIME_LIMIT_SECONDS = 3;
const SOLVER_PROCESS_TIMEOUT_MS = 6_000;

interface SolveOptions {
  lockedAssignments?: CallBuilderAssignment[];
  baselineAssignments?: CallBuilderAssignment[];
  builderConstraints?: CallBuilderConstraint[];
}

interface WorkerResult {
  status: "optimal" | "feasible" | "infeasible" | "unknown";
  optimalityProven: boolean;
  engineVersion: string;
  durationMs: number;
  objectives: CallBuilderSolverSummary["objectives"];
  assignments: CallBuilderAssignment[];
  conflicts: string[];
  error?: string;
}

export class CallBuilderInfeasibleError extends Error {
  constructor(readonly conflicts: string[]) {
    super(conflicts.join(" ") || "The configured hard constraints cannot all be satisfied.");
    this.name = "CallBuilderInfeasibleError";
  }
}

export async function solveCallSchedule(
  state: PlannerState,
  blockNumber: number,
  options: SolveOptions = {}
): Promise<CallBuilderEvaluation> {
  const started = performance.now();
  if (process.env.CALL_BUILDER_SOLVER_ENABLED === "false") {
    return fallbackEvaluation(state, blockNumber, options.builderConstraints ?? [], started, "The constraint solver is disabled by configuration.");
  }

  try {
    const workerResult = await runSolverWorker(buildSolverProblem(state, blockNumber, options));
    if (workerResult.status === "infeasible") throw new CallBuilderInfeasibleError(workerResult.conflicts);
    if (workerResult.error || !workerResult.assignments.length) {
      throw new Error(workerResult.error || "The solver returned no assignments");
    }
    const evaluation = evaluateCallSchedule(state, blockNumber, workerResult.assignments, options.builderConstraints);
    if (evaluation.hardViolationCount > 0) {
      throw new Error(`The solver result failed independent validation with ${evaluation.hardViolationCount} blocker(s)`);
    }
    return {
      ...evaluation,
      solverSummary: {
        engine: "cp-sat",
        engineVersion: workerResult.engineVersion,
        status: workerResult.status === "optimal" ? "optimal" : "feasible",
        optimalityProven: workerResult.optimalityProven,
        durationMs: workerResult.durationMs,
        objectives: workerResult.objectives,
        message: workerResult.optimalityProven
          ? "The hierarchy was optimized and proven optimal."
          : "The best feasible schedule found within the time limit is shown; optimality was not proven."
      }
    };
  } catch (error) {
    if (error instanceof CallBuilderInfeasibleError) throw error;
    const reason = error instanceof Error ? error.message : "unknown solver error";
    return fallbackEvaluation(state, blockNumber, options.builderConstraints ?? [], started, `Constraint solver unavailable: ${reason}`);
  }
}

function fallbackEvaluation(
  state: PlannerState,
  blockNumber: number,
  builderConstraints: CallBuilderConstraint[],
  started: number,
  reason: string
): CallBuilderEvaluation {
  const fallback = generateCallSchedule(state, blockNumber, builderConstraints);
  return {
    ...fallback,
    solverSummary: {
      engine: "heuristic",
      engineVersion: "call-builder-heuristic-v2",
      status: "fallback",
      optimalityProven: false,
      durationMs: Math.round(performance.now() - started),
      objectives: [],
      message: reason
    }
  };
}

export function buildSolverProblem(state: PlannerState, blockNumber: number, options: SolveOptions = {}) {
  const block = getCallBuilderBlock(blockNumber);
  if (!block) throw new Error(`Unknown rotation block ${blockNumber}`);
  const slots = getCallBuilderSlots(blockNumber)
    .filter((slot) => slot.callPosition === "senior")
    .map((slot) => ({
      id: callShiftSlotKey(slot.date, slot.shift),
      date: slot.date,
      shift: slot.shift ?? "regular",
      weekend: getCallBuilderWeekendAnchor(slot.date),
      units: getCallUnits(slot.date, slot.shift),
      ordinal: calendarOrdinal(slot.date)
    }));
  const builderConstraints = sanitizeBuilderConstraints(options.builderConstraints, blockNumber);
  validateBuilderConstraints(state, builderConstraints, options.lockedAssignments ?? []);
  const historicalUnits = getHistoricalCallUnits(state, block.startDate);
  const residents = CALL_POSITIONS.flatMap((position) => {
    const target = getFairnessTargetRange(state, blockNumber, position);
    return getCallBuilderResidentsForPosition(state, position).map((resident) => {
      const eligibleSlotIds = slots
        .filter((slot) => isHardEligibleForCallAssignment(resident, slot.date).eligible)
        .filter((slot) => !isResidentForcedOff(builderConstraints, resident.id, slot.date))
        .map((slot) => slot.id);
      const dateValues = [...new Set(slots.map((item) => item.date))];
      return {
        id: resident.id,
        position,
        regularPool: isRegularPoolResidentForState(state, resident, blockNumber),
        targetMinUnits: target.min,
        targetMaxUnits: target.max,
        historicalUnits: historicalUnits.get(resident.id) ?? 0,
        eligibleSlotIds,
        egsChiefSlotIds: slots.filter((slot) => isEgsChief(resident, slot.date)).map((slot) => slot.id),
        egsMidlevelSlotIds: slots.filter((slot) => isEgsMidlevel(resident, slot.date)).map((slot) => slot.id),
        traumaChiefSlotIds: slots.filter((slot) => slot.shift === "regular" && isTraumaChief(resident, slot.date)).map((slot) => slot.id),
        nrv: dateValues.some((date) => isNrvChief(resident, date) || isNrvMidlevel(resident, date)),
        vacationAdjacentDates: dateValues.filter((date) => isVacationAdjacent(resident, date)),
        crossBlockSaturdayDates: dateValues.filter((date) => isCrossBlockSaturday(state, blockNumber, resident.id, date)),
        serviceByDate: Object.fromEntries(dateValues.map((date) => {
          const rawService = getRotationForDate(resident, date)?.service ?? resident.serviceTags[0] ?? "";
          const service = normalizeRotationServiceToServiceLine(rawService) ?? normalizeService(rawService);
          return [date, service];
        })),
        tieBreakBySlot: Object.fromEntries(slots.map((slot) => [slot.id, stableTieBreak(blockNumber, slot.id, resident.id)]))
      };
    });
  });
  const callOffRequestHierarchy = buildCallOffRequestHierarchy(
    state,
    block.startDate,
    block.endDate,
    slots.map((slot) => slot.date),
    new Set(residents.map((resident) => resident.id))
  );
  return {
    version: 1,
    blockNumber,
    timeLimitSeconds: readTimeLimit(),
    randomSeed: 37,
    slots,
    residents,
    callOffRequestHierarchy,
    lockedAssignments: sanitizeAssignments(options.lockedAssignments, blockNumber),
    baselineAssignments: sanitizeAssignments(options.baselineAssignments, blockNumber),
    requiredAssignments: builderConstraints
      .filter((constraint) => constraint.kind === "required-call")
      .flatMap((constraint) => {
        const resident = state.residents.find((candidate) => candidate.id === constraint.residentId);
        const callPosition = resident && getCallPositionForResident(resident);
        return callPosition ? [{
          date: constraint.date,
          callPosition,
          residentId: constraint.residentId,
          ...(constraint.shift === "holiday-day" ? { shift: constraint.shift } : {})
        }] : [];
      })
  };
}

function buildCallOffRequestHierarchy(
  state: PlannerState,
  blockStart: string,
  blockEnd: string,
  slotDates: string[],
  eligibleResidentIds: ReadonlySet<string>
) {
  const residentsById = new Map(state.residents.map((resident) => [resident.id, resident]));
  const uniqueSlotDates = [...new Set(slotDates)];
  const rankedRequests = state.callOffRequests
    .filter((request) => request.date >= blockStart && request.date <= blockEnd)
    .filter((request) => eligibleResidentIds.has(request.residentId))
    .sort((left, right) => compareCallOffRequestPrecedence(left, right, residentsById));

  return Object.fromEntries((["priority", "secondary"] as const).map((priority) => {
    const tiers = new Map<string, {
      key: string;
      label: string;
      rank: number;
      requests: Array<{ residentId: string; dates: string[]; createdAt: string; timestampWeight: number }>;
    }>();
    const requests = rankedRequests.filter((request) => request.priority === priority);
    for (const request of requests) {
      const resident = residentsById.get(request.residentId);
      if (!resident) continue;
      const seniority = getCallOffRequestSeniority(resident.trainingLevel);
      const dates = uniqueSlotDates.filter((date) => request.scope === "day"
        ? date === request.date
        : getCallBuilderWeekendAnchor(date) === getCallBuilderWeekendAnchor(request.date));
      if (dates.length === 0) continue;
      const tier = tiers.get(seniority.key) ?? { ...seniority, requests: [] };
      tier.requests.push({ residentId: request.residentId, dates, createdAt: request.createdAt, timestampWeight: 0 });
      tiers.set(seniority.key, tier);
    }
    const orderedTiers = [...tiers.values()].sort((left, right) => left.rank - right.rank);
    for (const tier of orderedTiers) {
      tier.requests.forEach((request, index) => {
        request.timestampWeight = tier.requests.length - index;
      });
    }
    return [priority, orderedTiers];
  }));
}

function sanitizeBuilderConstraints(
  constraints: CallBuilderConstraint[] | undefined,
  blockNumber: number
): CallBuilderConstraint[] {
  const expectedDates = new Set(getCallBuilderDates(blockNumber));
  return (constraints ?? []).filter((constraint) =>
    Boolean(constraint?.id && constraint.residentId)
    && (constraint.kind === "off" || constraint.kind === "required-call")
    && (constraint.scope === "day" || constraint.scope === "weekend")
    && (constraint.shift === undefined || constraint.shift === "regular" || constraint.shift === "holiday-day")
    && expectedDates.has(constraint.date)
  );
}

function validateBuilderConstraints(
  state: PlannerState,
  constraints: CallBuilderConstraint[],
  lockedAssignments: CallBuilderAssignment[]
) {
  const conflicts: string[] = [];
  const requiredBySlot = new Map<string, CallBuilderConstraint>();
  for (const constraint of constraints) {
    const resident = state.residents.find((candidate) => candidate.id === constraint.residentId);
    if (!resident) {
      conflicts.push(`Builder requirement references unknown resident ${constraint.residentId}.`);
      continue;
    }
    if (constraint.kind !== "required-call") continue;
    const callPosition = getCallPositionForResident(resident);
    if (!callPosition) {
      conflicts.push(`${resident.name} does not have a resident call position.`);
      continue;
    }
    const eligibility = isHardEligibleForCallAssignment(resident, constraint.date);
    if (!eligibility.eligible) {
      conflicts.push(`${resident.name} cannot be required on ${constraint.date}: ${eligibility.reason}.`);
    }
    if (isResidentForcedOff(constraints, resident.id, constraint.date)) {
      conflicts.push(`${resident.name} is both required on call and required off on ${constraint.date}.`);
    }
    const slotKey = `${constraint.date}:${constraint.shift ?? "regular"}:${callPosition}`;
    const existing = requiredBySlot.get(slotKey);
    if (existing && existing.residentId !== constraint.residentId) {
      const other = state.residents.find((candidate) => candidate.id === existing.residentId);
      conflicts.push(`${resident.name} and ${other?.name ?? existing.residentId} are both required for the ${callPosition} slot on ${constraint.date}.`);
    }
    requiredBySlot.set(slotKey, constraint);
  }
  for (const locked of lockedAssignments) {
    const required = requiredBySlot.get(`${locked.date}:${locked.shift ?? "regular"}:${locked.callPosition}`);
    if (required && required.residentId !== locked.residentId) {
      conflicts.push(`The locked ${locked.callPosition} assignment on ${locked.date} conflicts with a required-call rule.`);
    }
    if (isResidentForcedOff(constraints, locked.residentId, locked.date)) {
      conflicts.push(`A locked assignment on ${locked.date} conflicts with a required-off rule.`);
    }
  }
  const requiredByResident = new Map<string, string[]>();
  for (const constraint of constraints.filter((item) => item.kind === "required-call")) {
    const residentDates = requiredByResident.get(constraint.residentId) ?? [];
    residentDates.push(constraint.date);
    requiredByResident.set(constraint.residentId, residentDates);
  }
  for (const [residentId, residentDates] of requiredByResident) {
    const sorted = [...new Set(residentDates)].sort();
    for (let index = 1; index < sorted.length; index += 1) {
      if (Math.abs(calendarOrdinal(sorted[index]) - calendarOrdinal(sorted[index - 1])) !== 1) continue;
      const resident = state.residents.find((candidate) => candidate.id === residentId);
      conflicts.push(`${resident?.name ?? residentId} cannot be required on consecutive days ${sorted[index - 1]} and ${sorted[index]}.`);
    }
  }
  if (conflicts.length) throw new CallBuilderInfeasibleError([...new Set(conflicts)]);
}

function sanitizeAssignments(assignments: CallBuilderAssignment[] | undefined, blockNumber: number) {
  const expectedSlots = new Set(getCallBuilderSlots(blockNumber).map((slot) => `${slot.date}:${slot.shift ?? "regular"}:${slot.callPosition}`));
  const seenSlots = new Set<string>();
  return (assignments ?? []).filter((assignment) => {
    const key = `${assignment.date}:${assignment.shift ?? "regular"}:${assignment.callPosition}`;
    if (!expectedSlots.has(key) || !CALL_POSITIONS.includes(assignment.callPosition) || seenSlots.has(key)) return false;
    seenSlots.add(key);
    return Boolean(assignment.residentId);
  });
}

function getHistoricalCallUnits(state: PlannerState, beforeDate: string): Map<string, number> {
  const assignmentsBySlot = new Map<string, Pick<CallBuilderAssignment, "residentId" | "date" | "shift">>();
  for (const entry of state.coverageEntries) {
    if (entry.kind !== "call" || !entry.residentId || !entry.callPosition || entry.date >= beforeDate) continue;
    assignmentsBySlot.set(`${entry.date}:regular:${entry.callPosition}`, { residentId: entry.residentId, date: entry.date });
  }
  const priorMainDrafts = state.callScheduleDrafts
    .filter((draft) => draft.isMain && draft.assignments.some((assignment) => assignment.date < beforeDate))
    .sort((left, right) => left.blockNumber - right.blockNumber);
  for (const draft of priorMainDrafts) {
    for (const assignment of draft.assignments) {
      if (assignment.date >= beforeDate) continue;
      const key = `${assignment.date}:${assignment.shift ?? "regular"}:${assignment.callPosition}`;
      if (!assignmentsBySlot.has(key)) assignmentsBySlot.set(key, assignment);
    }
  }
  const totals = new Map<string, number>();
  for (const assignment of assignmentsBySlot.values()) {
    totals.set(assignment.residentId, (totals.get(assignment.residentId) ?? 0) + getCallUnits(assignment.date, assignment.shift));
  }
  return totals;
}

function stableTieBreak(blockNumber: number, date: string, residentId: string): number {
  const digest = createHash("sha256").update(`${blockNumber}:${date}:${residentId}`).digest("hex");
  return Number.parseInt(digest.slice(0, 8), 16) % 997;
}

function callShiftSlotKey(date: string, shift: CallBuilderAssignment["shift"]): string {
  return `${date}:${shift === "holiday-day" ? "holiday-day" : "regular"}`;
}

function calendarOrdinal(date: string): number {
  const parsed = parseLocalDate(date);
  return Math.floor(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()) / 86_400_000);
}

function readTimeLimit(): number {
  const configured = Number(process.env.CALL_BUILDER_SOLVER_TIME_SECONDS ?? SOLVER_TIME_LIMIT_SECONDS);
  if (!Number.isFinite(configured)) return SOLVER_TIME_LIMIT_SECONDS;
  return Math.max(0.5, Math.min(15, configured));
}

async function runSolverWorker(problem: ReturnType<typeof buildSolverProblem>): Promise<WorkerResult> {
  const python = resolvePythonExecutable();
  const script = path.resolve(process.cwd(), "src/server/call_solver.py");
  return await new Promise<WorkerResult>((resolve, reject) => {
    const child = spawn(python, [script], { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("solver process timed out"));
    }, SOLVER_PROCESS_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      try {
        const parsed = JSON.parse(stdout.trim()) as WorkerResult;
        if (parsed.error) throw new Error(parsed.error);
        if (code !== 0) throw new Error(stderr.trim() || `solver exited with code ${code}`);
        resolve(parsed);
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid solver response"));
      }
    });
    child.stdin.end(JSON.stringify(problem));
  });
}

function resolvePythonExecutable(): string {
  if (process.env.CALL_BUILDER_PYTHON) return process.env.CALL_BUILDER_PYTHON;
  const local = path.resolve(process.cwd(), ".local/call-builder-venv/bin/python");
  return fs.existsSync(local) ? local : "python3";
}

export function describeScheduleChanges(
  state: PlannerState,
  before: CallBuilderAssignment[],
  after: CallBuilderAssignment[]
): string {
  const residents = new Map(state.residents.map((resident) => [resident.id, resident.name]));
  const beforeBySlot = new Map(before.map((assignment) => [`${assignment.date}:${assignment.shift ?? "regular"}:${assignment.callPosition}`, assignment]));
  const changes = after.filter((assignment) => {
    const previous = beforeBySlot.get(`${assignment.date}:${assignment.shift ?? "regular"}:${assignment.callPosition}`);
    return previous?.residentId !== assignment.residentId;
  });
  if (changes.length === 0) return "The current draft already matches the best schedule found.";
  const first = changes[0];
  const previous = beforeBySlot.get(`${first.date}:${first.shift ?? "regular"}:${first.callPosition}`);
  const firstDescription = `${first.date} ${first.shift === "holiday-day" ? "holiday day" : "regular call"}: ${residents.get(previous?.residentId ?? "") ?? "unassigned"} → ${residents.get(first.residentId) ?? first.residentId}`;
  return changes.length === 1 ? firstDescription : `${changes.length} coordinated changes, beginning with ${firstDescription}`;
}

export function getPositionPoolSize(state: PlannerState, blockNumber: number, position: CallPosition): number {
  return getAvailablePoolResidents(state, blockNumber, position).length;
}
