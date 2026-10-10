import { Attending, AttendingBlock, ClinicSession, PlannerState, Resident, SERVICE_LINES, ServiceLine } from "./types";
import { getResidentServiceTagsForDate, normalizeRotationServiceToServiceLine } from "./rotations";
import { comparePersonNames } from "./names";

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
    return comparePersonNames(a.name, b.name);
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

/** Assignment eligibility follows the home specialty, never the trauma rotation. */
export function isOperativeResident(resident: Pick<Resident, "rosterKind" | "sourceProgram" | "sourceProgramAbbreviation">): boolean {
  const program = (resident.sourceProgram ?? "").toLowerCase();
  const abbreviation = (resident.sourceProgramAbbreviation ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (/emergency medicine|pulmonary|internal medicine/.test(program) || ["em", "im", "ccm", "pulmedfel", "pccm"].includes(abbreviation)) return false;
  if (/critical care/.test(program) && !/surgical/.test(program)) return false;
  if (isGeneralOrPlasticSurgeryResident(resident)) return true;
  return /surgery|surgical|ortho|podiatr|pediatric|dentistry/.test(program) || ["pmsr", "peds", "dent", "scc", "neurosurg", "orthopaedics"].includes(abbreviation);
}

export function getAssignmentService(state: PlannerState, kind: "case" | "block" | "clinic", targetId: string, fallback: string): string {
  if (kind === "clinic") {
    const clinic = state.clinicSessions.find(item => item.id === targetId);
    return clinic ? (clinicMatchesService(clinic, ENDOSCOPY_SERVICE_LINE) ? ENDOSCOPY_SERVICE_LINE : clinic.service) : fallback;
  }
  const blockId = kind === "case" ? state.cases.find(item => item.id === targetId)?.blockId : targetId;
  const block = state.attendingBlocks.find(item => item.id === blockId);
  if (!block) return fallback;
  return isEndoscopyBlock(state, block) ? ENDOSCOPY_SERVICE_LINE : state.attendings.find(item => item.id === block.attendingId)?.service ?? fallback;
}
