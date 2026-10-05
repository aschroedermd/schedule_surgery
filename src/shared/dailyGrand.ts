import { computeScheduledCases } from "./scheduler";
import { isEndoscopyBlock, isEndoscopyText } from "./services";
import type { Assignment, PlannerState } from "./types";

export interface GrandCoverage {
  id: string;
  label: string;
  residentNames: string[];
}

export interface GrandEntry {
  id: string;
  surgeon: string;
  service: string;
  location: string;
  group: string;
  kind: "OR" | "Endoscopy" | "Clinic";
  startTime: string;
  endTime?: string;
  calculatedEnd?: boolean;
  coverage: GrandCoverage[];
}

export function buildDailyGrandView(state: PlannerState, date: string): GrandEntry[] {
  const names = (assignments: Assignment[]) => [...new Set(assignments.map(assignment =>
    state.residents.find(resident => resident.id === assignment.residentId)?.name ?? "Unknown resident"
  ))];
  const groupFor = (location: string) => {
    const code = location.trim().toUpperCase();
    if (/\bCCAS[CE]\b/.test(code)) return "CCASE";
    if (/\bRMH\b/.test(code)) return "RMH";
    if (/\bFMH\b/.test(code)) return "FMH";
    return location || "Other locations";
  };
  const blocks = state.attendingBlocks.filter(block => block.date === date);
  // ENDO is a virtual projection of these same blocks. Read the source once,
  // without concatenating schedules filtered by service.
  const cases = [...new Set(blocks.map(block => block.weekId))]
    .flatMap(weekId => computeScheduledCases(state, weekId)).filter(item => item.date === date);
  const entries: GrandEntry[] = blocks.map(block => {
    const attending = state.attendings.find(item => item.id === block.attendingId)!;
    const hospital = state.hospitals.find(item => item.id === block.hospitalId)!;
    const blockCases = cases.filter(item => item.blockId === block.id).sort((a, b) => a.order - b.order);
    const endoscopy = isEndoscopyBlock(state, block);
    const endTime = blockCases.length ? blockCases.reduce((last, item) => item.endMinutes > last.endMinutes ? item : last).endTime : undefined;
    return {
      id: block.id, surgeon: attending.name, service: attending.service,
      location: hospital.shortName, group: groupFor(hospital.shortName),
      kind: endoscopy ? "Endoscopy" : "OR", startTime: block.firstCaseStartTime,
      endTime: endoscopy ? endTime : undefined, calculatedEnd: endoscopy && Boolean(endTime),
      coverage: blockCases.length ? blockCases.map(item => ({ id: item.id, label: item.procedureLabel, residentNames: names(item.assignments) }))
        : [{ id: block.id, label: "No cases listed", residentNames: names(state.assignments.filter(item => item.kind === "block" && item.targetId === block.id)) }]
    };
  });
  for (const clinic of state.clinicSessions.filter(item => item.date === date)) {
    const hospital = state.hospitals.find(item => item.id === clinic.hospitalId);
    const endoscopy = isEndoscopyText(clinic.service) || isEndoscopyText(clinic.location);
    entries.push({
      id: clinic.id, surgeon: state.attendings.find(item => item.id === clinic.attendingId)?.name ?? "Surgeon not specified",
      service: clinic.service, location: clinic.location || hospital?.shortName || "Clinic",
      group: endoscopy ? groupFor(hospital?.shortName ?? clinic.location) : "Clinic",
      kind: endoscopy ? "Endoscopy" : "Clinic", startTime: clinic.startTime, endTime: clinic.endTime,
      coverage: [{ id: clinic.id, label: endoscopy ? "Endoscopy block" : "Clinic block", residentNames: names(state.assignments.filter(item => item.kind === "clinic" && item.targetId === clinic.id)) }]
    });
  }
  return entries.sort((a, b) => a.startTime.localeCompare(b.startTime) || a.surgeon.localeCompare(b.surgeon));
}
