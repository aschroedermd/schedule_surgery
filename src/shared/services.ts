import { Attending, ClinicSession, PlannerState, Resident, SERVICE_LINES, ServiceLine } from "./types";
import { getResidentServiceTagsForDate, normalizeRotationServiceToServiceLine } from "./rotations";

export const DEFAULT_SERVICE_LINE: ServiceLine = "Davies";

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

export function getStateServiceLines(state: PlannerState): string[] {
  return [...SERVICE_LINES];
}

export function getAttendingsForService(attendings: Attending[], selectedService: string): Attending[] {
  return attendings.filter((attending) => servicesMatch(attending.service, selectedService));
}

export function clinicMatchesService(clinic: ClinicSession, selectedService: string): boolean {
  return servicesMatch(clinic.service, selectedService);
}
