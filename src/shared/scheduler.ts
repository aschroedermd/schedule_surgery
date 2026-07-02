import {
  Assignment,
  Attending,
  AttendingBlock,
  ClaimRequest,
  ClinicSession,
  DaySchedule,
  Hospital,
  PlannerState,
  Resident,
  ScheduledBlock,
  ScheduledCase,
  ScheduledClinicSession,
  SurgeryCase,
  Warning,
  WeekSchedule
} from "./types";
import { addDays, getWeekDates, minutesToTime, timeToMinutes } from "./date";
import { createId } from "./id";
import { isResidentOnService, servicesMatch } from "./services";

interface Interval {
  assignment: Assignment;
  resident: Resident;
  date: string;
  start: number;
  end: number;
  hospitalId?: string;
  label: string;
  targetId: string;
}

type AssignmentTarget =
  | { kind: "case"; case: ScheduledCase }
  | { kind: "block"; block: ScheduledBlock }
  | { kind: "clinic"; clinic: ScheduledClinicSession };

export function buildWeekSchedule(state: PlannerState, weekId: string, serviceLine?: string): WeekSchedule {
  const week = requireWeek(state, weekId);

  const dates = getWeekDates(week.startDate, state.settings.weekdayOnly);
  const scheduledCases = computeScheduledCases(state, week.id, serviceLine);
  const blockAssignments = state.assignments.filter((assignment) => assignment.kind === "block");

  const blocks = state.attendingBlocks
    .filter((block) => block.weekId === week.id && blockMatchesService(state, block, serviceLine))
    .map<ScheduledBlock>((block) => {
      const attending = requireEntity(state.attendings, block.attendingId, "attending");
      const hospital = requireEntity(state.hospitals, block.hospitalId, "hospital");
      const cases = scheduledCases.filter((surgeryCase) => surgeryCase.blockId === block.id);
      const assignment = blockAssignments.find((candidate) => candidate.targetId === block.id);
      return {
        ...block,
        attending,
        hospital,
        cases,
        assignment,
        warningMessages: []
      };
    })
    .sort((a, b) => a.date.localeCompare(b.date) || timeToMinutes(a.firstCaseStartTime) - timeToMinutes(b.firstCaseStartTime));

  const clinics = state.clinicSessions
    .filter((clinic) => clinic.weekId === week.id && servicesMatch(clinic.service, serviceLine))
    .map<ScheduledClinicSession>((clinic) => ({
      ...clinic,
      attending: clinic.attendingId ? state.attendings.find((attending) => attending.id === clinic.attendingId) : undefined,
      hospital: clinic.hospitalId ? state.hospitals.find((hospital) => hospital.id === clinic.hospitalId) : undefined,
      assignments: state.assignments.filter((assignment) => assignment.kind === "clinic" && assignment.targetId === clinic.id),
      warningMessages: []
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || timeToMinutes(a.startTime) - timeToMinutes(b.startTime));

  const warnings = collectWarnings(state, week.id, serviceLine);
  const warningLookup = new Map<string, string[]>();
  for (const warning of warnings) {
    if (!warning.targetId) continue;
    const existing = warningLookup.get(warning.targetId) ?? [];
    existing.push(warning.message);
    warningLookup.set(warning.targetId, existing);
  }

  for (const block of blocks) {
    block.warningMessages = warningLookup.get(block.id) ?? [];
    block.cases = block.cases.map((surgeryCase) => ({
      ...surgeryCase,
      warningMessages: warningLookup.get(surgeryCase.id) ?? []
    }));
  }

  const clinicsWithWarnings = clinics.map((clinic) => ({
    ...clinic,
    warningMessages: warningLookup.get(clinic.id) ?? []
  }));

  return {
    week,
    days: dates.map<DaySchedule>((date) => {
      const dayBlocks = blocks.filter((block) => block.date === date);
      const dayClinics = clinicsWithWarnings.filter((clinic) => clinic.date === date);
      const uncoveredCases = dayBlocks.flatMap((block) => block.cases).filter((surgeryCase) => !surgeryCase.assignment);
      return {
        date,
        blocks: dayBlocks,
        clinics: dayClinics,
        uncoveredCases
      };
    })
  };
}

export function computeScheduledCases(state: PlannerState, weekId: string, serviceLine?: string): ScheduledCase[] {
  const blockAssignments = state.assignments.filter((assignment) => assignment.kind === "block");
  const caseAssignments = state.assignments.filter((assignment) => assignment.kind === "case");

  return state.attendingBlocks
    .filter((block) => block.weekId === weekId && blockMatchesService(state, block, serviceLine))
    .flatMap((block) => {
      const attending = requireEntity(state.attendings, block.attendingId, "attending");
      const hospital = requireEntity(state.hospitals, block.hospitalId, "hospital");
      const blockCases = state.cases
        .filter((surgeryCase) => surgeryCase.blockId === block.id)
        .sort((a, b) => a.order - b.order);
      let currentStart = timeToMinutes(block.firstCaseStartTime);
      const blockAssignment = blockAssignments.find((assignment) => assignment.targetId === block.id);

      return blockCases.map<ScheduledCase>((surgeryCase, index) => {
        const startMinutes = currentStart;
        const endMinutes = startMinutes + surgeryCase.durationMinutes;
        currentStart = endMinutes + (index < blockCases.length - 1 ? state.settings.turnoverMinutes : 0);
        const assignment = caseAssignments.find((candidate) => candidate.targetId === surgeryCase.id) ?? blockAssignment;
        return {
          ...surgeryCase,
          date: block.date,
          startMinutes,
          endMinutes,
          startTime: minutesToTime(startMinutes),
          endTime: minutesToTime(endMinutes),
          attending,
          hospital,
          block,
          assignment,
          warningMessages: []
        };
      });
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes || b.priority - a.priority);
}

export function collectWarnings(state: PlannerState, weekId: string, serviceLine?: string): Warning[] {
  const intervals = buildAssignmentIntervals(state, weekId, serviceLine);
  const warnings: Warning[] = [];

  for (const interval of intervals) {
    const calendarOffEntries = state.coverageEntries.filter(
      (entry) => entry.kind === "off" && entry.residentId === interval.resident.id && entry.date === interval.date
    );
    for (const entry of calendarOffEntries) {
      warnings.push({
        id: createId("warn"),
        severity: "danger",
        residentId: interval.resident.id,
        assignmentId: interval.assignment.id,
        targetId: interval.targetId,
        message: `${interval.resident.name} is off on the calendar${entry.note ? ` (${entry.note})` : ""}`
      });
    }

    const previousDay = addDays(interval.date, -1);
    const postCallEntry = state.coverageEntries.find(
      (entry) => entry.kind === "call" && entry.residentId === interval.resident.id && entry.date === previousDay
    );
    if (postCallEntry) {
      warnings.push({
        id: createId("warn"),
        severity: "warning",
        residentId: interval.resident.id,
        assignmentId: interval.assignment.id,
        targetId: interval.targetId,
        message: `${interval.resident.name} is post-call after ${previousDay}`
      });
    }

    for (const unavailable of interval.resident.unavailable.filter((block) => availabilityIncludesDate(block, interval.date))) {
      const offStart = unavailable.startTime ? timeToMinutes(unavailable.startTime) : 0;
      const offEnd = unavailable.endTime ? timeToMinutes(unavailable.endTime) : 24 * 60;
      if (intervalsOverlap(interval.start, interval.end, offStart, offEnd)) {
        warnings.push({
          id: createId("warn"),
          severity: unavailable.startTime ? "warning" : "danger",
          residentId: interval.resident.id,
          assignmentId: interval.assignment.id,
          targetId: interval.targetId,
          message: `${interval.resident.name} is unavailable (${unavailable.label})`
        });
      }
    }
  }

  const byResidentDay = groupBy(intervals, (interval) => `${interval.resident.id}:${interval.date}`);
  for (const residentIntervals of byResidentDay.values()) {
    const sorted = [...residentIntervals].sort((a, b) => a.start - b.start);
    for (let index = 0; index < sorted.length; index += 1) {
      const current = sorted[index];
      const next = sorted[index + 1];
      if (!next) continue;

      if (current.end > next.start) {
        warnings.push({
          id: createId("warn"),
          severity: "danger",
          residentId: current.resident.id,
          assignmentId: next.assignment.id,
          targetId: next.targetId,
          message: `${current.resident.name} has overlapping assignments: ${current.label} and ${next.label}`
        });
        continue;
      }

      const crossHospital = current.hospitalId && next.hospitalId && current.hospitalId !== next.hospitalId;
      const gap = next.start - current.end;
      if (crossHospital && gap < state.settings.splitBufferMinutes) {
        warnings.push({
          id: createId("warn"),
          severity: "warning",
          residentId: current.resident.id,
          assignmentId: next.assignment.id,
          targetId: next.targetId,
          message: `${current.resident.name} has ${gap} minutes between hospitals; target buffer is ${state.settings.splitBufferMinutes} minutes`
        });
      }
    }
  }

  for (const scheduledCase of computeScheduledCases(state, weekId, serviceLine)) {
    if (!scheduledCase.assignment) continue;
    const resident = state.residents.find((candidate) => candidate.id === scheduledCase.assignment?.residentId);
    if (!resident) continue;
    const levelWarning = getTrainingLevelWarning(resident, scheduledCase);
    if (levelWarning) {
      warnings.push({
        id: createId("warn"),
        severity: "info",
        residentId: resident.id,
        assignmentId: scheduledCase.assignment.id,
        targetId: scheduledCase.id,
        message: levelWarning
      });
    }
  }

  for (const warning of getArrangementWarnings(state, weekId, serviceLine)) {
    warnings.push(warning);
  }

  return warnings;
}

export function applySuggestion(
  state: PlannerState,
  weekId: string,
  actorRole: "admin" | "viewer" = "admin",
  serviceLine?: string
): PlannerState {
  const weekCases = computeScheduledCases(state, weekId, serviceLine);
  const caseIds = new Set(weekCases.map((surgeryCase) => surgeryCase.id));
  const clinicIds = new Set(
    state.clinicSessions
      .filter((clinic) => clinic.weekId === weekId && servicesMatch(clinic.service, serviceLine))
      .map((clinic) => clinic.id)
  );
  const preservedAssignments = state.assignments.filter((assignment) => {
    if (assignment.source !== "suggestion") return true;
    if (assignment.kind === "case" && caseIds.has(assignment.targetId)) return false;
    if (assignment.kind === "clinic" && clinicIds.has(assignment.targetId)) return false;
    return true;
  });

  let draft: PlannerState = {
    ...state,
    assignments: preservedAssignments
  };

  const casesToFill = computeScheduledCases(draft, weekId, serviceLine)
    .filter((surgeryCase) => !surgeryCase.assignment)
    .sort((a, b) => b.priority - a.priority || a.date.localeCompare(b.date) || a.startMinutes - b.startMinutes);

  for (const scheduledCase of casesToFill) {
    const resident = chooseResidentForTarget(draft, weekId, { kind: "case", case: scheduledCase }, serviceLine);
    if (!resident) continue;
    draft = {
      ...draft,
      assignments: [
        ...draft.assignments,
        makeAssignment("case", scheduledCase.id, resident.id, "suggestion", false)
      ]
    };
  }

  for (const clinic of state.clinicSessions.filter((candidate) => candidate.weekId === weekId && servicesMatch(candidate.service, serviceLine))) {
    const scheduledClinic = buildWeekSchedule(draft, weekId, serviceLine).days.flatMap((day) => day.clinics).find((candidate) => candidate.id === clinic.id);
    if (!scheduledClinic) continue;
    const remainingCapacity = Math.max(0, clinic.capacity - scheduledClinic.assignments.length);
    for (let count = 0; count < remainingCapacity; count += 1) {
      const resident = chooseResidentForTarget(draft, weekId, { kind: "clinic", clinic: scheduledClinic }, serviceLine);
      if (!resident) break;
      draft = {
        ...draft,
        assignments: [...draft.assignments, makeAssignment("clinic", clinic.id, resident.id, "suggestion", false)]
      };
    }
  }

  return addActivity(draft, actorRole, "suggested schedule", "Auto-suggestion refreshed unlocked OR and clinic assignments", "week", weekId);
}

export function applyClaim(state: PlannerState, claim: ClaimRequest): PlannerState {
  const source: Assignment["source"] = "viewer-claim";
  const kind = claim.scope === "block" ? "block" : "case";
  const nextAssignment = makeAssignment(kind, claim.targetId, claim.residentId, source, false);
  const nextState: PlannerState = {
    ...state,
    assignments: [
      ...state.assignments.filter((assignment) => !(assignment.kind === kind && assignment.targetId === claim.targetId)),
      nextAssignment
    ]
  };
  const residentName = state.residents.find((resident) => resident.id === claim.residentId)?.name ?? "Unknown resident";
  const targetLabel = describeTarget(nextState, kind, claim.targetId);
  return addActivity(nextState, "viewer", "claimed coverage", `${residentName} claimed ${targetLabel}`, kind, claim.targetId);
}

export function makeAssignment(
  kind: Assignment["kind"],
  targetId: string,
  residentId: string,
  source: Assignment["source"],
  locked: boolean
): Assignment {
  const now = new Date().toISOString();
  return {
    id: createId("asgn"),
    kind,
    targetId,
    residentId,
    locked,
    source,
    createdAt: now,
    updatedAt: now
  };
}

export function addActivity(
  state: PlannerState,
  actorRole: "admin" | "viewer",
  action: string,
  details: string,
  entityType?: string,
  entityId?: string
): PlannerState {
  return {
    ...state,
    activityEvents: [
      {
        id: createId("evt"),
        createdAt: new Date().toISOString(),
        actorRole,
        action,
        details,
        entityType,
        entityId
      },
      ...state.activityEvents
    ].slice(0, 200)
  };
}

export function buildUncoveredMessage(state: PlannerState, weekId: string, date?: string, serviceLine?: string): string {
  const schedule = buildWeekSchedule(state, weekId, serviceLine);
  const days = date ? schedule.days.filter((day) => day.date === date) : schedule.days;
  const lines = days
    .map((day) => {
      if (day.uncoveredCases.length === 0) {
        return "";
      }
      const grouped = groupBy(day.uncoveredCases, (surgeryCase) => surgeryCase.attending.id);
      const parts = [...grouped.values()].map((cases) => {
        const first = cases[0];
        const procedures = cases.map((surgeryCase) => surgeryCase.procedureLabel).join(", ");
        return `${first.attending.name} ${procedures} around ${first.startTime}`;
      });
      const label = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long" });
      return `Uncovered cases for ${label} are ${parts.join(" & ")}`;
    })
    .filter(Boolean);

  if (lines.length === 0) {
    return date ? "All cases are covered for this day." : "All cases are covered for the week.";
  }

  return lines.join("\n");
}

export function formatClinicLabel(
  clinic: Pick<ClinicSession, "service" | "isProcedure"> & { attending?: Pick<Attending, "name"> }
): string {
  const surgeonName = clinic.attending?.name?.trim() || clinic.service;
  return `${surgeonName} ${clinic.isProcedure ? "procedure clinic" : "clinic"}`;
}

export function buildAssignmentIntervals(state: PlannerState, weekId: string, serviceLine?: string): Interval[] {
  const schedule = buildWeekScheduleWithoutWarnings(state, weekId, serviceLine);
  const intervals: Interval[] = [];

  for (const day of schedule.days) {
    for (const block of day.blocks) {
      if (block.assignment && block.cases.length > 0) {
        const resident = state.residents.find((candidate) => candidate.id === block.assignment?.residentId);
        if (resident) {
          const blockCoveredRuns = getConsecutiveCaseRuns(
            block.cases.filter((scheduledCase) => scheduledCase.assignment?.id === block.assignment?.id)
          );
          for (const run of blockCoveredRuns) {
            intervals.push({
              assignment: block.assignment,
              resident,
              date: block.date,
              start: run[0].startMinutes,
              end: run[run.length - 1].endMinutes,
              hospitalId: block.hospitalId,
              label: `${block.attending.name} block`,
              targetId: block.id
            });
          }
        }
      }

      for (const scheduledCase of block.cases) {
        if (!scheduledCase.assignment || scheduledCase.assignment.kind === "block") continue;
        const resident = state.residents.find((candidate) => candidate.id === scheduledCase.assignment?.residentId);
        if (!resident) continue;
        intervals.push({
          assignment: scheduledCase.assignment,
          resident,
          date: scheduledCase.date,
          start: scheduledCase.startMinutes,
          end: scheduledCase.endMinutes,
          hospitalId: scheduledCase.hospital.id,
          label: `${scheduledCase.attending.name} ${scheduledCase.procedureLabel}`,
          targetId: scheduledCase.id
        });
      }
    }

    for (const clinic of day.clinics) {
      for (const assignment of clinic.assignments) {
        const resident = state.residents.find((candidate) => candidate.id === assignment.residentId);
        if (!resident) continue;
        intervals.push({
          assignment,
          resident,
          date: clinic.date,
          start: timeToMinutes(clinic.startTime),
          end: timeToMinutes(clinic.endTime),
          hospitalId: clinic.hospitalId,
          label: formatClinicLabel(clinic),
          targetId: clinic.id
        });
      }
    }
  }

  return intervals;
}

function buildWeekScheduleWithoutWarnings(state: PlannerState, weekId: string, serviceLine?: string): WeekSchedule {
  const week = requireWeek(state, weekId);
  const dates = getWeekDates(week.startDate, state.settings.weekdayOnly);
  const scheduledCases = computeScheduledCases(state, week.id, serviceLine);
  const blocks = state.attendingBlocks
    .filter((block) => block.weekId === week.id && blockMatchesService(state, block, serviceLine))
    .map<ScheduledBlock>((block) => {
      const attending = requireEntity(state.attendings, block.attendingId, "attending");
      const hospital = requireEntity(state.hospitals, block.hospitalId, "hospital");
      return {
        ...block,
        attending,
        hospital,
        cases: scheduledCases.filter((surgeryCase) => surgeryCase.blockId === block.id),
        assignment: state.assignments.find((assignment) => assignment.kind === "block" && assignment.targetId === block.id),
        warningMessages: []
      };
    });
  const clinics = state.clinicSessions
    .filter((clinic) => clinic.weekId === week.id && servicesMatch(clinic.service, serviceLine))
    .map<ScheduledClinicSession>((clinic) => ({
      ...clinic,
      attending: clinic.attendingId ? state.attendings.find((attending) => attending.id === clinic.attendingId) : undefined,
      hospital: clinic.hospitalId ? state.hospitals.find((hospital) => hospital.id === clinic.hospitalId) : undefined,
      assignments: state.assignments.filter((assignment) => assignment.kind === "clinic" && assignment.targetId === clinic.id),
      warningMessages: []
    }));

  return {
    week,
    days: dates.map((date) => {
      const dayBlocks = blocks.filter((block) => block.date === date);
      return {
        date,
        blocks: dayBlocks,
        clinics: clinics.filter((clinic) => clinic.date === date),
        uncoveredCases: dayBlocks.flatMap((block) => block.cases).filter((surgeryCase) => !surgeryCase.assignment)
      };
    })
  };
}

function chooseResidentForTarget(
  state: PlannerState,
  weekId: string,
  target: AssignmentTarget,
  serviceLine?: string
): Resident | undefined {
  const candidates = state.residents.map((resident) => {
    const simulated = {
      ...state,
      assignments: [
        ...state.assignments,
        makeAssignment(target.kind, getTargetId(target), resident.id, "suggestion", false)
      ]
    };
    const warnings = collectWarnings(simulated, weekId, serviceLine).filter((warning) => warning.residentId === resident.id);
    const blockingWarnings = warnings.filter((warning) => warning.severity !== "info");
    if (blockingWarnings.length > 0) return undefined;
    return {
      resident,
      score: scoreResidentForTarget(resident, target) - state.assignments.filter((assignment) => assignment.residentId === resident.id).length
    };
  });

  return candidates
    .filter((candidate): candidate is { resident: Resident; score: number } => Boolean(candidate))
    .sort((a, b) => b.score - a.score)[0]?.resident;
}

function scoreResidentForTarget(resident: Resident, target: AssignmentTarget): number {
  const targetService = getTargetService(target);
  const targetDate = getTargetDate(target);
  const serviceScore = targetService && isResidentOnService(resident, targetService, targetDate) ? 10 : 0;

  if (target.kind === "clinic") {
    return (serviceScore ? 10 : 4) + serviceScore;
  }

  const scheduledCase = target.kind === "case" ? target.case : target.block.cases[0];
  if (!scheduledCase) return 0;
  const caseTags = scheduledCase.tags.map((tag) => tag.toLowerCase());
  const interests = resident.trainingInterests.map((tag) => tag.toLowerCase());
  const tagMatches = caseTags.filter((tag) => interests.includes(tag)).length;
  const chiefFit = caseTags.includes("chief-level") && resident.trainingLevel === "PGY5" ? 8 : 0;
  const fellowFit = caseTags.includes("fellow-priority") && resident.trainingLevel === "Fellow" ? 8 : 0;
  return 20 + serviceScore + scheduledCase.priority * 4 + tagMatches * 6 + chiefFit + fellowFit;
}

function getTrainingLevelWarning(resident: Resident, scheduledCase: ScheduledCase): string | undefined {
  const caseTags = scheduledCase.tags.map((tag) => tag.toLowerCase());

  if (caseTags.includes("chief-level") && resident.trainingLevel !== "PGY5" && resident.trainingLevel !== "Fellow") {
    return `${scheduledCase.procedureLabel} is tagged chief-level; assigned resident is ${resident.trainingLevel}`;
  }

  if (caseTags.includes("fellow-priority") && resident.trainingLevel !== "Fellow") {
    return `${scheduledCase.procedureLabel} is tagged fellow-priority; assigned resident is ${resident.trainingLevel}`;
  }

  return undefined;
}

function getArrangementWarnings(state: PlannerState, weekId: string, serviceLine?: string): Warning[] {
  const scheduledCases = computeScheduledCases(state, weekId, serviceLine);
  const casesByDate = groupBy(scheduledCases, (scheduledCase) => scheduledCase.date);
  const warnings: Warning[] = [];

  for (const scheduledCase of scheduledCases) {
    if (!scheduledCase.assignment) continue;
    const resident = state.residents.find((candidate) => candidate.id === scheduledCase.assignment?.residentId);
    if (!resident) continue;
    const currentMatches = countTrainingInterestMatches(resident, scheduledCase);
    const betterSameDayCase = (casesByDate.get(scheduledCase.date) ?? []).some((candidate) => {
      if (candidate.id === scheduledCase.id) return false;
      if (candidate.assignment?.residentId === resident.id) return false;
      return countTrainingInterestMatches(resident, candidate) > currentMatches;
    });

    if (betterSameDayCase) {
      warnings.push({
        id: createId("warn"),
        severity: "info",
        residentId: resident.id,
        assignmentId: scheduledCase.assignment.id,
        targetId: scheduledCase.id,
        message: "check arrangement"
      });
    }
  }

  return warnings;
}

function countTrainingInterestMatches(resident: Resident, scheduledCase: ScheduledCase): number {
  const interests = new Set(resident.trainingInterests.map((tag) => tag.toLowerCase()));
  if (interests.size === 0) return 0;
  return scheduledCase.tags.filter((tag) => interests.has(tag.toLowerCase())).length;
}

function getTargetId(target: AssignmentTarget): string {
  if (target.kind === "case") return target.case.id;
  if (target.kind === "block") return target.block.id;
  return target.clinic.id;
}

function getTargetService(target: AssignmentTarget): string | undefined {
  if (target.kind === "clinic") return target.clinic.service;
  if (target.kind === "block") return target.block.attending.service;
  return target.case.attending.service;
}

function getTargetDate(target: AssignmentTarget): string {
  if (target.kind === "clinic") return target.clinic.date;
  if (target.kind === "block") return target.block.date;
  return target.case.date;
}

function blockMatchesService(state: PlannerState, block: AttendingBlock, serviceLine?: string): boolean {
  if (!serviceLine) return true;
  const attending = state.attendings.find((candidate) => candidate.id === block.attendingId);
  return servicesMatch(attending?.service, serviceLine);
}

function describeTarget(state: PlannerState, kind: Assignment["kind"], targetId: string): string {
  if (kind === "case") {
    const surgeryCase = state.cases.find((candidate) => candidate.id === targetId);
    const block = state.attendingBlocks.find((candidate) => candidate.id === surgeryCase?.blockId);
    const scheduledCase = block ? computeScheduledCases(state, block.weekId).find((candidate) => candidate.id === targetId) : undefined;
    return scheduledCase ? `${scheduledCase.attending.name} ${scheduledCase.procedureLabel}` : "case";
  }

  if (kind === "block") {
    const block = state.attendingBlocks.find((candidate) => candidate.id === targetId);
    const attending = state.attendings.find((candidate) => candidate.id === block?.attendingId);
    return attending ? `${attending.name} block` : "block";
  }

  return "clinic";
}

function requireWeek(state: PlannerState, weekId: string) {
  const week = state.weeks.find((candidate) => candidate.id === weekId);
  if (!week) {
    throw new Error(`Week not found: ${weekId}`);
  }
  return week;
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function getConsecutiveCaseRuns(cases: ScheduledCase[]): ScheduledCase[][] {
  const sortedCases = [...cases].sort((a, b) => a.order - b.order);
  const runs: ScheduledCase[][] = [];
  for (const scheduledCase of sortedCases) {
    const currentRun = runs[runs.length - 1];
    const previousCase = currentRun?.[currentRun.length - 1];
    if (!currentRun || !previousCase || previousCase.order + 1 !== scheduledCase.order) {
      runs.push([scheduledCase]);
    } else {
      currentRun.push(scheduledCase);
    }
  }
  return runs;
}

function availabilityIncludesDate(block: { date: string; endDate?: string }, date: string): boolean {
  if (block.endDate) {
    return block.date <= date && date <= block.endDate;
  }
  return block.date === date;
}

function requireEntity<T extends Attending | Hospital>(collection: T[], id: string, label: string): T {
  const entity = collection.find((candidate) => candidate.id === id);
  if (!entity) {
    throw new Error(`Missing ${label}: ${id}`);
  }
  return entity;
}

function groupBy<T>(items: T[], getKey: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = getKey(item);
    grouped.set(key, [...(grouped.get(key) ?? []), item]);
  }
  return grouped;
}
