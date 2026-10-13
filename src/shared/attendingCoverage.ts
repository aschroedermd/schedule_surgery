import { addDays, parseLocalDate } from "./date";
import {
  ATTENDING_COVERAGE_LINES,
  AttendingCoverageAssignment,
  AttendingCoverageLine,
  AttendingCoverageShift
} from "./types";

export const INDEPENDENT_CALL_LINES = ["Practice", "Vascular", "Pediatrics", "NRV"] as const;

export type IndependentCallLine = (typeof INDEPENDENT_CALL_LINES)[number];
export type IndependentCallPeriod = "day" | "night";

export const INDEPENDENT_CALL_LABELS: Record<IndependentCallLine, string> = {
  Practice: "PR",
  Vascular: "V",
  Pediatrics: "PEDS",
  NRV: "NRV"
};

export interface ResolvedIndependentCallCoverage {
  assignment: AttendingCoverageAssignment;
  effectiveShift?: AttendingCoverageShift;
  inheritedFromDay: boolean;
  inheritedFromWeekend: boolean;
  weekend: boolean;
}

export function isIndependentCallLine(line: AttendingCoverageLine): line is IndependentCallLine {
  return INDEPENDENT_CALL_LINES.some((candidate) => candidate === line);
}

/**
 * Resolves effective Practice, Vascular, Pediatrics, or NRV primary call.
 * Weekend assignments are anchored on Friday and cover through Monday at 06:00;
 * NRV begins Friday morning while the other independent lines begin Friday night.
 * On every date, a missing night assignment inherits effective day coverage.
 * Missing Friday-Sunday rows inherit within that weekend.
 */
export function resolveIndependentCallCoverage(
  assignments: AttendingCoverageAssignment[],
  line: IndependentCallLine,
  date: string,
  period: IndependentCallPeriod
): ResolvedIndependentCallCoverage | undefined {
  const primary = assignments.filter((assignment) => assignment.line === line && assignment.role === "primary");
  const exact = primary.find((assignment) => assignment.date === date && assignment.shift === period);
  if (exact) return resolved(exact, { effectiveShift: period });

  const allDay = primary.find((assignment) => assignment.date === date && assignment.shift === "24h");
  if (allDay) return resolved(allDay, { effectiveShift: period });

  if (period === "night") {
    const day = primary.find((assignment) => assignment.date === date && assignment.shift === "day");
    if (day?.startTime) return undefined;
    if (day) return resolved(day, { inheritedFromDay: true, effectiveShift: period });

    // The same-day night fallback also applies when that day's effective day
    // surgeon was inherited from another day in the same weekend.
    const effectiveDay = resolveIndependentCallCoverage(assignments, line, date, "day");
    if (effectiveDay?.assignment.startTime) return undefined;
    if (effectiveDay) return { ...effectiveDay, inheritedFromDay: true, effectiveShift: period };
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
      .map((candidateDate) => primary.find((assignment) => assignment.date === candidateDate && assignment.shift === shift && !assignment.startTime))
      .find((assignment): assignment is AttendingCoverageAssignment => Boolean(assignment));
    if (nearby) return resolved(nearby, { inheritedFromWeekend: true, effectiveShift: period });
  }

  // Preserve the original Friday-anchored weekend row as a shorthand fallback.
  // Exact or inherited daily rows above always take precedence.
  const weekendStart = weekendDates[0];
  const weekendAssignment = primary.find(
    (assignment) => assignment.date === weekendStart && assignment.shift === "weekend"
  );
  const weekday = parseLocalDate(date).getDay();
  if (weekendAssignment && !weekendAssignment.startTime && (line === "NRV" || period === "night" || weekday === 0 || weekday === 6)) {
    return resolved(weekendAssignment, { inheritedFromWeekend: date !== weekendStart, effectiveShift: period });
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
  return coverage && !coverage.assignment.startTime ? { ...coverage, inheritedFromWeekend: coverage.assignment.date !== sunday } : undefined;
}

export const COVERAGE_TIME_ZONE = "America/New_York";
export const COVERAGE_LABELS: Record<AttendingCoverageLine, string> = {
  ACS: "ACS Night", Practice: "Practice / Bariatric", Vascular: "Vascular — CCVS & AC",
  Pediatrics: "Pediatric Surgery", EGS: "EGS Day", Trauma: "Trauma Day", SCC: "Critical Care",
  SecondCall: "2nd Call Backup", Breast: "Breast Surgery", Foregut: "Foregut Call",
  FMH: "FMH — Franklin Memorial", RBH: "RBH — Rockbridge", NRV: "NRV"
};
export const PRIORITY_COVERAGE_LINES: AttendingCoverageLine[] = ["ACS", "Practice", "Vascular", "Pediatrics"];
export const COVERAGE_DISPLAY_LINES: AttendingCoverageLine[] = [...PRIORITY_COVERAGE_LINES, "EGS", "Trauma", "SCC", "SecondCall", "Breast", "Foregut", "FMH", "RBH", "NRV"];
export const COVERAGE_ALIASES: Record<string, AttendingCoverageLine> = {
  Elective: "Practice", "Practice/Bariatric": "Practice", "CCVS & AC": "Vascular",
  "Ped Surg": "Pediatrics", "Pediatric Surgery": "Pediatrics", "Critical Care": "SCC",
  CFMH: "FMH", "Franklin Memorial": "FMH", "CFMH / Franklin Memorial": "FMH",
  CRBH: "RBH", Rockbridge: "RBH", "CRBH / Rockbridge": "RBH",
  "2nd Call Backup": "SecondCall", "Breast Surgery": "Breast", "Foregut Call": "Foregut",
  "EGS Day": "EGS", "Trauma Day": "Trauma", "ACS Night": "ACS",
  "Unassigned – Night": "ACS", "Unassigned - Night": "ACS", "Trauma Night": "ACS",
  "EGS Night": "ACS", "SCC Night": "ACS", "EGS/Trauma shared overnight coverage": "ACS"
};
const labelKey = (value: string) => value.toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, "").trim();
export function normalizeCoverageLine(value: unknown): AttendingCoverageLine | undefined {
  if (typeof value !== "string") return undefined;
  return ATTENDING_COVERAGE_LINES.find(line => labelKey(line) === labelKey(value)) ??
    Object.entries(COVERAGE_ALIASES).find(([alias]) => labelKey(alias) === labelKey(value))?.[1];
}

export const COVERAGE_RULES = {
  timeZone: COVERAGE_TIME_ZONE,
  dateOwnership: "date is the local start date, including nights ending the following date",
  explicitTimes: "Supply startTime, endTime (HH:mm), and endDate together. Timed rows never inherit into other periods or dates. Omit all three when hours are unknown.",
  daylightSaving: "Local boundaries use New York DST. Nonexistent or ambiguous local times are rejected; use an unambiguous boundary.",
  defaults: "Untimed rows retain day/night/24h labels without invented hours. Practice, Vascular, Pediatrics and NRV retain night-from-day and nearest-weekend-day fallback. Friday weekend shorthand ends Monday 06:00; starts Friday 17:00, or Friday morning for NRV (exact morning hour unspecified).",
  backup: "SecondCall is a dedicated independent 2nd Call Backup category, with role backup; no primary line is inferred. Existing line-scoped backup rows remain supported; QGenda-owned ACS backup blocks a competing dedicated SecondCall row until its source mapping is reconciled."
};
export function coverageCatalog() {
  return { categories: COVERAGE_DISPLAY_LINES.map(line => ({ id: line, label: COVERAGE_LABELS[line],
    aliases: Object.entries(COVERAGE_ALIASES).filter(([, canonical]) => canonical === line).map(([alias]) => alias),
    defaultDisplayPriority: PRIORITY_COVERAGE_LINES.includes(line) ? PRIORITY_COVERAGE_LINES.indexOf(line) + 1 : null,
    shifts: line === "ACS" ? ["day", "night", "24h"] : isIndependentCallLine(line) ? ["day", "night", "24h", "weekend"] : ["day", "night", "24h"],
    roles: line === "SecondCall" ? ["backup"] : ["primary", "backup"],
    shiftsByRole: {
      primary: line === "SecondCall" ? [] : line === "ACS" ? ["night"] : ["EGS", "Trauma", "SCC"].includes(line) ? ["day", "24h"] : isIndependentCallLine(line) ? ["day", "night", "24h", "weekend"] : ["day", "night", "24h"],
      backup: isIndependentCallLine(line) ? ["day", "night", "24h", "weekend"] : ["day", "night", "24h"]
    }
  })), rules: COVERAGE_RULES };
}

const localFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: COVERAGE_TIME_ZONE,
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
/** Match both possible NY offsets, rejecting DST gaps and repeated local minutes. */
export function coverageLocalInstant(date: string, time: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Invalid coverage date/time");
  const local = `${date}T${time}:00.000Z`;
  const wall = Date.parse(local);
  if (!Number.isFinite(wall) || new Date(wall).toISOString() !== local) throw new Error("Invalid coverage date/time");
  const matches = [4, 5].map(offset => new Date(wall + offset * 3600000)).filter(instant => {
    const parts = Object.fromEntries(localFormatter.formatToParts(instant).map(part => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}` === `${date}T${time}`;
  });
  if (matches.length !== 1) throw new Error("Coverage boundary is ambiguous or nonexistent in America/New_York (DST); choose an unambiguous time");
  return matches[0].toISOString();
}
export function coverageBoundaries(row: Pick<AttendingCoverageAssignment, "date" | "startTime" | "endTime" | "endDate">) {
  if (row.startTime == null && row.endTime == null && row.endDate == null) return undefined;
  if (!row.startTime || !row.endTime || !row.endDate) throw new Error("Supply startTime, endTime and endDate together");
  if (row.endDate < row.date || row.endDate > addDays(row.date, 3)) throw new Error("Coverage endDate must be within three days of date");
  const startsAt = coverageLocalInstant(row.date, row.startTime);
  const endsAt = coverageLocalInstant(row.endDate, row.endTime);
  if (endsAt <= startsAt) throw new Error("Coverage end must be after start");
  return { startsAt, endsAt, timeZone: COVERAGE_TIME_ZONE };
}

export function resolveCoverageRows(assignments: AttendingCoverageAssignment[], line: AttendingCoverageLine, date: string) {
  const direct = assignments.filter(row => row.date === date && row.line === line);
  const rows: ResolvedIndependentCallCoverage[] = direct.map(assignment => ({ assignment, effectiveShift: assignment.shift, inheritedFromDay: false, inheritedFromWeekend: false, weekend: assignment.shift === "weekend" }));
  if (isIndependentCallLine(line)) {
    for (const period of ["day", "night"] as const) {
      const effective = resolveIndependentCallCoverage(assignments, line, date, period);
      if (effective && !rows.some(row => row.assignment.id === effective.assignment.id && !effective.inheritedFromDay && !effective.inheritedFromWeekend)) rows.push(effective);
    }
  }
  return rows;
}
