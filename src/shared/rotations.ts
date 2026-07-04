import { formatDate } from "./date";
import { Resident, ResidentRotationBlock, SERVICE_LINES, ServiceLine, TrainingLevel } from "./types";

export const ROTATION_BLOCK_DATES = [
  { blockNumber: 1, startDate: "2026-07-01", endDate: "2026-08-02" },
  { blockNumber: 2, startDate: "2026-08-03", endDate: "2026-08-30" },
  { blockNumber: 3, startDate: "2026-08-31", endDate: "2026-09-27" },
  { blockNumber: 4, startDate: "2026-09-28", endDate: "2026-10-25" },
  { blockNumber: 5, startDate: "2026-10-26", endDate: "2026-11-22" },
  { blockNumber: 6, startDate: "2026-11-23", endDate: "2026-12-20" },
  { blockNumber: 7, startDate: "2026-12-21", endDate: "2027-01-17" },
  { blockNumber: 8, startDate: "2027-01-18", endDate: "2027-02-14" },
  { blockNumber: 9, startDate: "2027-02-15", endDate: "2027-03-14" },
  { blockNumber: 10, startDate: "2027-03-15", endDate: "2027-04-11" },
  { blockNumber: 11, startDate: "2027-04-12", endDate: "2027-05-09" },
  { blockNumber: 12, startDate: "2027-05-10", endDate: "2027-06-06" },
  { blockNumber: 13, startDate: "2027-06-07", endDate: "2027-06-30" }
] as const;

export function getTodayDate(): string {
  return formatDate(new Date());
}

export function getRotationBlockForDate(date: string): (typeof ROTATION_BLOCK_DATES)[number] | undefined {
  return ROTATION_BLOCK_DATES.find((block) => block.startDate <= date && date <= block.endDate);
}

export function getRotationForDate(
  resident: Pick<Resident, "rotationSchedule">,
  date: string
): ResidentRotationBlock | undefined {
  return resident.rotationSchedule?.find((rotation) => rotation.startDate <= date && date <= rotation.endDate);
}

export function getRotationForBlock(
  resident: Pick<Resident, "rotationSchedule">,
  blockNumber: number
): ResidentRotationBlock | undefined {
  return resident.rotationSchedule?.find((rotation) => rotation.blockNumber === blockNumber);
}

export function getResidentServiceTagsForDate(
  resident: Pick<Resident, "serviceTags" | "rotationSchedule">,
  date = getTodayDate()
): string[] {
  const rotation = getRotationForDate(resident, date);
  if (rotation) {
    const serviceLine = normalizeRotationServiceToServiceLine(rotation.service);
    return serviceLine ? [serviceLine] : [];
  }
  return normalizeServiceTagList(resident.serviceTags);
}

export function normalizeRotationServiceToServiceLine(value: string | undefined): ServiceLine | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;

  const exact = SERVICE_LINES.find((serviceLine) => serviceLine.toLowerCase() === trimmed.toLowerCase());
  if (exact) return exact;

  const lower = trimmed.toLowerCase();
  if (lower.includes("scc")) return "ICU";
  if (lower.includes("critical care")) return "ICU";
  if (lower.includes("gilbert")) return "Gilbert";
  if (lower.includes("keely") || lower.includes("keeley") || lower.includes("vasc")) return "Vascular";
  if (lower.includes("davies")) return "Davies";
  if (lower.includes("berry")) return "Berry";
  if (lower.includes("ferrara")) return "Ferrara";
  if (lower.includes("fogel")) return "Fogel";
  if (lower.includes("nrv")) return "NRV";
  if (lower.includes("ped surg") || lower.includes("pediatric")) return "Peds";
  return undefined;
}

export function getCalendarNightResidentsForDate(residents: Resident[], date: string): Resident[] {
  const nightFloat = residents.filter((resident) => getRotationForDate(resident, date)?.service === "NFloat");
  if (nightFloat.length >= 3) return sortResidentsByName(nightFloat).slice(0, 3);

  const sccNight = residents.filter((resident) => getRotationForDate(resident, date)?.service === "SCC Night");
  return sortResidentsByName([...nightFloat, ...sccNight]).slice(0, 3);
}

export function sortResidentsBySeniority<T extends Pick<Resident, "name" | "trainingLevel">>(residents: T[]): T[] {
  return [...residents].sort((a, b) => {
    const rankDelta = getTrainingLevelRank(b.trainingLevel) - getTrainingLevelRank(a.trainingLevel);
    if (rankDelta !== 0) return rankDelta;
    return a.name.localeCompare(b.name);
  });
}

export function getTrainingLevelRank(trainingLevel: TrainingLevel): number {
  const ranks: Record<TrainingLevel, number> = {
    Fellow: 6,
    PGY5: 5,
    PGY4: 4,
    PGY3: 3,
    PGY2: 2,
    PGY1: 1
  };
  return ranks[trainingLevel] ?? 0;
}

export function getResidentLastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length <= 1) return name.trim();
  return parts.slice(1).join(" ");
}

function normalizeServiceTagList(values: string[] | undefined): string[] {
  const tags = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalizeRotationServiceToServiceLine(value);
    if (normalized) tags.add(normalized);
  }
  return [...tags];
}

function sortResidentsByName(residents: Resident[]): Resident[] {
  return [...residents].sort((a, b) => a.name.localeCompare(b.name));
}
