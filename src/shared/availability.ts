import { PlannerState, Resident } from "./types";

export interface ResidentTimeOff {
  kind: "off" | "unavailable" | "vacation";
  description: string;
}

export function getResidentTimeOff(state: PlannerState, resident: Resident, date: string): ResidentTimeOff | undefined {
  const vacation = resident.vacation?.find((block) => block.startDate <= date && date <= block.endDate);
  if (vacation) {
    return {
      kind: "vacation",
      description: `on vacation (${vacation.startDate} to ${vacation.endDate})`
    };
  }

  const calendarOff = state.coverageEntries.find(
    (entry) => entry.kind === "off" && entry.residentId === resident.id && entry.date === date
  );
  if (calendarOff) {
    return {
      kind: "off",
      description: `off on the calendar${calendarOff.note ? ` (${calendarOff.note})` : ""}`
    };
  }

  const unavailable = resident.unavailable.find(
    (block) =>
      !block.startTime &&
      !block.endTime &&
      block.date <= date &&
      date <= (block.endDate ?? block.date)
  );
  if (unavailable) {
    return {
      kind: "unavailable",
      description: `unavailable (${unavailable.label})`
    };
  }

  return undefined;
}

export function isResidentAvailableForWork(state: PlannerState, resident: Resident, date: string): boolean {
  return !getResidentTimeOff(state, resident, date);
}
