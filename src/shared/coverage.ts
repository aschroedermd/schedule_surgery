import { addDays, formatDate, parseLocalDate } from "./date";
import { CoverageEntry, CoverageKind, Resident } from "./types";
import { isResidentOnService } from "./services";

export function isCallDate(date: string): boolean {
  const day = parseLocalDate(date).getDay();
  return day === 5 || day === 6 || day === 0;
}

export function callCreatesPostCallDay(date: string): boolean {
  const day = parseLocalDate(date).getDay();
  return day === 5 || day === 6;
}

export function isRoundingDate(date: string): boolean {
  const day = parseLocalDate(date).getDay();
  return day === 6 || day === 0;
}

export function isWeekendCoverageRequired(date: string): boolean {
  return isRoundingDate(date);
}

export function isCoverageKindAllowedOnDate(kind: CoverageKind, date: string): boolean {
  if (kind === "call") return isCallDate(date);
  if (kind === "rounding") return isRoundingDate(date);
  return true;
}

export function getCoverageSlot(entries: CoverageEntry[], date: string, kind: "call" | "rounding"): CoverageEntry | undefined {
  return entries.find((entry) => entry.date === date && entry.kind === kind);
}

export function getCoverageEntries(entries: CoverageEntry[], date: string, kind: "call" | "rounding"): CoverageEntry[] {
  return entries.filter((entry) => entry.date === date && entry.kind === kind);
}

export function hasWeekendCoverage(entries: CoverageEntry[], date: string): boolean {
  return entries.some(
    (entry) =>
      entry.date === date &&
      Boolean(entry.residentId) &&
      (entry.kind === "call" || entry.kind === "rounding")
  );
}

export function hasServiceRoundingCoverage(
  entries: CoverageEntry[],
  residents: Resident[],
  date: string,
  serviceLine: string
): boolean {
  const residentsById = new Map(residents.map((resident) => [resident.id, resident]));
  return entries.some((entry) => {
    if (entry.date !== date || !entry.residentId) return false;
    if (entry.kind !== "call" && entry.kind !== "rounding") return false;
    const resident = residentsById.get(entry.residentId);
    return resident ? isResidentOnService(resident, serviceLine, date) : false;
  });
}

export function getMonthGridDates(month: string): string[] {
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const last = new Date(year, monthNumber, 0);
  const start = new Date(year, monthNumber - 1, 1 - first.getDay());
  const dayCount = Math.ceil((first.getDay() + last.getDate()) / 7) * 7;
  return Array.from({ length: dayCount }, (_, index) => addDays(formatDate(start), index));
}

export function getMonthFromDate(date: string): string {
  return date.slice(0, 7);
}

export function formatMonthLabel(month: string): string {
  return parseLocalDate(`${month}-01`).toLocaleDateString(undefined, {
    month: "long",
    year: "numeric"
  });
}

export function getResidentColor(resident?: Pick<Resident, "id" | "name" | "color">): string {
  if (resident?.color) return resident.color;

  const palette = ["#d36b5c", "#d5ad37", "#7e63c9", "#2f8c89", "#2f78c4", "#4f7d46", "#b84a62", "#8b5a3c"];
  const input = resident ? `${resident.id}:${resident.name}` : "unassigned";
  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) % palette.length;
  }
  return palette[hash];
}
