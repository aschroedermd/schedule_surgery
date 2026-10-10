import { computeScheduledCases } from "../shared/scheduler";
import { minutesToTime, timeToMinutes } from "../shared/date";
import type { PlannerState } from "../shared/types";

export interface PickerActivity {
  id: string; blockId?: string; title: string; surgeon: string; location: string;
  start: number; end?: number; time: string; residentIds: string[]; target: boolean;
}
export interface PickerContext {
  title: string; subtitle: string; activities: PickerActivity[]; targetActivities: PickerActivity[];
  residentNames: Record<string, string>;
}
export function buildResidentPickerContext(state: PlannerState, kind: "case" | "block" | "clinic", targetId: string): PickerContext | undefined {
  const targetCase = kind === "case" ? state.cases.find(item => item.id === targetId) : undefined;
  const block = state.attendingBlocks.find(item => item.id === (kind === "block" ? targetId : targetCase?.blockId));
  const clinic = kind === "clinic" ? state.clinicSessions.find(item => item.id === targetId) : undefined;
  const target = block ?? clinic;
  if (!target) return undefined;
  const activities: PickerActivity[] = computeScheduledCases(state, target.weekId).filter(item => item.date === target.date).map(item => ({
    id: item.id, blockId: item.blockId, title: item.procedureLabel, surgeon: item.attending.name,
    location: item.hospital.shortName, start: item.startMinutes, end: item.endMinutes,
    time: `${item.startTime}–${item.endTime}`, residentIds: item.assignments.map(assignment => assignment.residentId),
    target: kind === "case" ? item.id === targetId : kind === "block" && item.blockId === targetId
  }));
  for (const item of state.attendingBlocks.filter(item => item.date === target.date && !activities.some(activity => activity.blockId === item.id))) {
    activities.push({ id: item.id, blockId: item.id, title: "OR block · cases not yet listed", surgeon: state.attendings.find(attending => attending.id === item.attendingId)?.name ?? "Attending",
      location: state.hospitals.find(hospital => hospital.id === item.hospitalId)?.shortName ?? "", start: timeToMinutes(item.firstCaseStartTime), time: `${item.firstCaseStartTime} · end not listed`,
      residentIds: state.assignments.filter(assignment => assignment.kind === "block" && assignment.targetId === item.id).map(assignment => assignment.residentId), target: kind === "block" && item.id === targetId });
  }
  for (const item of state.clinicSessions.filter(item => item.date === target.date)) {
    activities.push({ id: item.id, title: `${item.service} clinic`, surgeon: state.attendings.find(attending => attending.id === item.attendingId)?.name ?? item.service,
      location: item.location, start: timeToMinutes(item.startTime), end: timeToMinutes(item.endTime), time: `${item.startTime}–${item.endTime}`,
      residentIds: state.assignments.filter(assignment => assignment.kind === "clinic" && assignment.targetId === item.id).map(assignment => assignment.residentId), target: kind === "clinic" && item.id === targetId });
  }
  activities.sort((a, b) => a.start - b.start || a.surgeon.localeCompare(b.surgeon));
  const surgeon = state.attendings.find(item => item.id === target.attendingId)?.name ?? clinic?.service ?? "Attending";
  const targetActivities = activities.filter(item => item.target);
  const timeLabel = targetActivities.length > 0 ? `${minutesToTime(Math.min(...targetActivities.map(item => item.start)))}–${targetActivities.every(item => item.end !== undefined) ? minutesToTime(Math.max(...targetActivities.map(item => item.end!))) : "end not listed"}` : "";
  return { title: targetCase?.procedureLabel ?? (clinic ? `${clinic.service} clinic` : `${surgeon} · block coverage`),
    subtitle: [targetCase || clinic ? surgeon : "All cases in this block", state.hospitals.find(item => item.id === target.hospitalId)?.shortName, timeLabel].filter(Boolean).join(" · "),
    activities, targetActivities, residentNames: Object.fromEntries(state.residents.map(item => [item.id, item.name])) };
}
export function getResidentPickerWorkload(context: PickerContext, residentId: string) {
  const activities = context.activities.filter(item => item.residentIds.includes(residentId));
  const otherActivities = activities.filter(item => !item.target);
  const overlaps = otherActivities.filter(item => context.targetActivities.some(target =>
    // Cases in the same block are expected when assigning block coverage.
    !(item.blockId && item.blockId === target.blockId) && item.end !== undefined && target.end !== undefined && item.start < target.end && target.start < item.end));
  return { activities, otherActivities, overlaps };
}
