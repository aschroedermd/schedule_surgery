import { Attending, ClinicSession, PlannerState, Resident, SERVICE_LINES, ServiceLine } from "./types";

export const DEFAULT_SERVICE_LINE: ServiceLine = "Davies";

export function isServiceLine(value: string | undefined): value is ServiceLine {
  return Boolean(value && SERVICE_LINES.includes(value as ServiceLine));
}

export function normalizeServiceLine(value: string | undefined): ServiceLine {
  const trimmed = value?.trim();
  return isServiceLine(trimmed) ? trimmed : DEFAULT_SERVICE_LINE;
}

export function servicesMatch(candidate: string | undefined, selectedService: string | undefined): boolean {
  if (!selectedService) return true;
  return candidate?.trim().toLowerCase() === selectedService.trim().toLowerCase();
}

export function isResidentOnService(resident: Pick<Resident, "serviceTags">, service: string): boolean {
  return resident.serviceTags.some((tag) => servicesMatch(tag, service));
}

export function sortResidentsForService(residents: Resident[], selectedService: string): Resident[] {
  return [...residents].sort((a, b) => {
    const serviceDelta = Number(isResidentOnService(b, selectedService)) - Number(isResidentOnService(a, selectedService));
    if (serviceDelta !== 0) return serviceDelta;
    return a.name.localeCompare(b.name);
  });
}

export function getStateServiceLines(state: PlannerState): string[] {
  const serviceLines = new Set<string>(SERVICE_LINES);
  for (const attending of state.attendings) addServiceLine(serviceLines, attending.service);
  for (const clinic of state.clinicSessions) addServiceLine(serviceLines, clinic.service);
  for (const resident of state.residents) {
    for (const serviceTag of resident.serviceTags) addServiceLine(serviceLines, serviceTag);
  }
  return [...serviceLines];
}

export function getAttendingsForService(attendings: Attending[], selectedService: string): Attending[] {
  return attendings.filter((attending) => servicesMatch(attending.service, selectedService));
}

export function clinicMatchesService(clinic: ClinicSession, selectedService: string): boolean {
  return servicesMatch(clinic.service, selectedService);
}

function addServiceLine(serviceLines: Set<string>, service: string | undefined) {
  const trimmed = service?.trim();
  if (trimmed) serviceLines.add(trimmed);
}
