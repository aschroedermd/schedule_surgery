import { Attending, AttendingBlock, ClinicSession, PlannerState, Resident, SERVICE_LINES, ServiceLine } from "./types";
import { getResidentServiceTagsForDate, normalizeRotationServiceToServiceLine } from "./rotations";

export const DEFAULT_SERVICE_LINE: ServiceLine = "Davies";
export const ENDOSCOPY_SERVICE_LINE: ServiceLine = "ENDO";

export function isServiceLine(value: string | undefined): value is ServiceLine {
  return Boolean(value && SERVICE_LINES.includes(value as ServiceLine));
}

export function toKnownServiceLine(value: string | undefined): ServiceLine | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return normalizeRotationServiceToServiceLine(trimmed) ?? (isServiceLine(trimmed) ? trimmed : undefined);
}

export function normalizeServiceLine(value: string | undefined): ServiceLine {
  return toKnownServiceLine(value) ?? DEFAULT_SERVICE_LINE;
}

export function servicesMatch(candidate: string | undefined, selectedService: string | undefined): boolean {
  if (!selectedService) return true;
  return candidate?.trim().toLowerCase() === selectedService.trim().toLowerCase();
}

export function isResidentOnService(
  resident: Pick<Resident, "serviceTags" | "rotationSchedule">,
  service: string,
  date?: string
): boolean {
  return getResidentServiceTagsForDate(resident, date).some((tag) => servicesMatch(tag, service));
}

export function sortResidentsForService(residents: Resident[], selectedService: string, date?: string): Resident[] {
  return [...residents].sort((a, b) => {
    const serviceDelta = Number(isResidentOnService(b, selectedService, date)) - Number(isResidentOnService(a, selectedService, date));
    if (serviceDelta !== 0) return serviceDelta;
    return a.name.localeCompare(b.name);
  });
}

export function isGeneralOrPlasticSurgeryResident(
  resident: Pick<Resident, "rosterKind" | "sourceProgram" | "sourceProgramAbbreviation">
): boolean {
  if (resident.rosterKind === "primary") return true;

  const sourceProgram = `${resident.sourceProgramAbbreviation ?? ""} ${resident.sourceProgram ?? ""}`
    .toLowerCase()
    .replace(/[^a-z]/g, "");
  if (sourceProgram.includes("plsx") || sourceProgram.includes("plasticsurgery")) return true;

  if (resident.rosterKind === "off-service") return false;
  return !resident.sourceProgram && !resident.sourceProgramAbbreviation;
}

export function getStateServiceLines(state: PlannerState): string[] {
  return [...SERVICE_LINES];
}

export function getAttendingsForService(attendings: Attending[], selectedService: string): Attending[] {
  return attendings.filter((attending) => servicesMatch(attending.service, selectedService));
}

export function clinicMatchesService(clinic: ClinicSession, selectedService: string): boolean {
  if (servicesMatch(selectedService, ENDOSCOPY_SERVICE_LINE)) {
    return isEndoscopyText(clinic.service) || isEndoscopyText(clinic.location);
  }
  return servicesMatch(clinic.service, selectedService);
}

/**
 * ENDO is a virtual service: its blocks continue to belong to their attending's
 * source service and are surfaced here by their schedule labels.
 */
export function isEndoscopyBlock(
  state: Pick<PlannerState, "cases">,
  block: Pick<AttendingBlock, "id" | "notes">
): boolean {
  if (isEndoscopyText(block.notes)) return true;
  return state.cases.some(
    (surgeryCase) =>
      surgeryCase.blockId === block.id &&
      [surgeryCase.procedureLabel, surgeryCase.notes, ...surgeryCase.tags].some(isEndoscopyText)
  );
}

export function isEndoscopyText(value: string | undefined): boolean {
  return /\b(?:endo|endoscop(?:e|es|ic|ies|y))\b/i.test(value ?? "");
}
