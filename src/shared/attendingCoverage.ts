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
  inheritedFromWeekend: boolean;
  weekend: boolean;
}

export function isIndependentCallLine(line: AttendingCoverageLine): line is IndependentCallLine {
  return INDEPENDENT_CALL_LINES.some((candidate) => candidate === line);
}

/**
 * Resolves the effective Practice, Vascular, or Pediatrics primary call assignment.
 * Weekend assignments are anchored on Friday and cover Friday night through Monday
 * at 06:00. On every date, a missing night assignment inherits effective day
 * coverage. Missing Friday-Sunday rows inherit within that weekend.
 */
export function resolveIndependentCallCoverage(
  assignments: AttendingCoverageAssignment[],
  line: IndependentCallLine,
  date: string,
  period: IndependentCallPeriod
): ResolvedIndependentCallCoverage | undefined {
  const primary = assignments.filter((assignment) => assignment.line === line && assignment.role === "primary");
  const exact = primary.find((assignment) => assignment.date === date && assignment.shift === period);
  if (exact) return resolved(exact);

  const allDay = primary.find((assignment) => assignment.date === date && assignment.shift === "24h");
  if (allDay) return resolved(allDay);

  if (period === "night") {
    const day = primary.find((assignment) => assignment.date === date && assignment.shift === "day");
    if (day) return resolved(day, { inheritedFromDay: true });

    // The same-day night fallback also applies when that day's effective day
    // surgeon was inherited from another day in the same weekend.
    const effectiveDay = resolveIndependentCallCoverage(assignments, line, date, "day");
    if (effectiveDay) return { ...effectiveDay, inheritedFromDay: true };
  }

  const weekendDates = getWeekendDates(date);
  if (!weekendDates) return undefined;
  const otherDates = weekendDates
    .filter((candidate) => candidate !== date)
    .sort((left, right) => {
      const distance = Math.abs(parseLocalDate(left).getTime() - parseLocalDate(date).getTime()) -
        Math.abs(parseLocalDate(right).getTime() - parseLocalDate(date).getTime());
      return distance || left.localeCompare(right);
    });
  const candidateShifts = period === "day" ? ["day", "24h"] : ["night", "24h"];
  for (const shift of candidateShifts) {
    const nearby = otherDates
      .map((candidateDate) => primary.find((assignment) => assignment.date === candidateDate && assignment.shift === shift))
      .find((assignment): assignment is AttendingCoverageAssignment => Boolean(assignment));
    if (nearby) return resolved(nearby, { inheritedFromWeekend: true });
  }

  // Preserve the original Friday-anchored weekend row as a shorthand fallback.
  // Exact or inherited daily rows above always take precedence.
  const weekendStart = weekendDates[0];
  const weekendAssignment = primary.find(
    (assignment) => assignment.date === weekendStart && assignment.shift === "weekend"
  );
  const weekday = parseLocalDate(date).getDay();
  if (weekendAssignment && (period === "night" || weekday === 0 || weekday === 6)) {
    return resolved(weekendAssignment, { inheritedFromWeekend: date !== weekendStart });
  }

  return undefined;
}

function resolved(
  assignment: AttendingCoverageAssignment,
  overrides: Partial<Omit<ResolvedIndependentCallCoverage, "assignment">> = {}
): ResolvedIndependentCallCoverage {
  return {
    assignment,
    inheritedFromDay: false,
    inheritedFromWeekend: false,
    weekend: assignment.shift === "weekend",
    ...overrides
  };
}

export function getActiveWeekendStart(date: string): string | undefined {
  const weekday = parseLocalDate(date).getDay();
  if (weekday === 5) return date;
  if (weekday === 6) return addDays(date, -1);
  if (weekday === 0) return addDays(date, -2);
  return undefined;
}

function getWeekendDates(date: string): [string, string, string] | undefined {
  const friday = getActiveWeekendStart(date);
  return friday ? [friday, addDays(friday, 1), addDays(friday, 2)] : undefined;
}

/** Returns the prior Friday weekend assignment that remains active until 06:00 Monday. */
export function resolveIndependentMondayEarlyMorningCoverage(
  assignments: AttendingCoverageAssignment[],
  line: IndependentCallLine,
  date: string
): ResolvedIndependentCallCoverage | undefined {
  if (parseLocalDate(date).getDay() !== 1) return undefined;
  const sunday = addDays(date, -1);
  const coverage = resolveIndependentCallCoverage(assignments, line, sunday, "night");
  return coverage ? { ...coverage, inheritedFromWeekend: coverage.assignment.date !== sunday } : undefined;
}
