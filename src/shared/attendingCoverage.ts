import { addDays, parseLocalDate } from "./date";
import {
  AttendingCoverageAssignment,
  AttendingCoverageLine
} from "./types";

export const INDEPENDENT_CALL_LINES = ["Practice", "Vascular", "Pediatrics"] as const;

export type IndependentCallLine = (typeof INDEPENDENT_CALL_LINES)[number];
export type IndependentCallPeriod = "day" | "night";

export interface ResolvedIndependentCallCoverage {
  assignment: AttendingCoverageAssignment;
  inheritedFromDay: boolean;
  weekend: boolean;
}

export function isIndependentCallLine(line: AttendingCoverageLine): line is IndependentCallLine {
  return INDEPENDENT_CALL_LINES.some((candidate) => candidate === line);
}

/**
 * Resolves the effective Practice, Vascular, or Pediatrics primary call assignment.
 * Weekend assignments are anchored on Friday and cover Friday night through Monday
 * at 06:00. On ordinary weekdays, a missing night assignment inherits the day
 * assignment so schedule senders only need to transmit exceptions.
 */
export function resolveIndependentCallCoverage(
  assignments: AttendingCoverageAssignment[],
  line: IndependentCallLine,
  date: string,
  period: IndependentCallPeriod
): ResolvedIndependentCallCoverage | undefined {
  const primary = assignments.filter((assignment) => assignment.line === line && assignment.role === "primary");
  const weekendStart = getActiveWeekendStart(date);
  const weekendAssignment = weekendStart
    ? primary.find((assignment) => assignment.date === weekendStart && assignment.shift === "weekend")
    : undefined;

  // Friday daytime remains the weekday day assignment. The weekend surgeon takes
  // over Friday night and covers both periods on Saturday and Sunday.
  const weekday = parseLocalDate(date).getDay();
  if (weekendAssignment && (period === "night" || weekday === 0 || weekday === 6)) {
    return { assignment: weekendAssignment, inheritedFromDay: false, weekend: true };
  }

  const exact = primary.find((assignment) => assignment.date === date && assignment.shift === period);
  if (exact) return { assignment: exact, inheritedFromDay: false, weekend: false };

  const allDay = primary.find((assignment) => assignment.date === date && assignment.shift === "24h");
  if (allDay) return { assignment: allDay, inheritedFromDay: false, weekend: false };

  if (period === "night") {
    const day = primary.find((assignment) => assignment.date === date && assignment.shift === "day");
    if (day) return { assignment: day, inheritedFromDay: true, weekend: false };
  }

  return undefined;
}

export function getActiveWeekendStart(date: string): string | undefined {
  const weekday = parseLocalDate(date).getDay();
  if (weekday === 5) return date;
  if (weekday === 6) return addDays(date, -1);
  if (weekday === 0) return addDays(date, -2);
  return undefined;
}

/** Returns the prior Friday weekend assignment that remains active until 06:00 Monday. */
export function resolveIndependentMondayEarlyMorningCoverage(
  assignments: AttendingCoverageAssignment[],
  line: IndependentCallLine,
  date: string
): ResolvedIndependentCallCoverage | undefined {
  if (parseLocalDate(date).getDay() !== 1) return undefined;
  const friday = addDays(date, -3);
  const assignment = assignments.find(
    (candidate) =>
      candidate.date === friday &&
      candidate.line === line &&
      candidate.shift === "weekend" &&
      candidate.role === "primary"
  );
  return assignment ? { assignment, inheritedFromDay: false, weekend: true } : undefined;
}
