export type Role = "admin" | "viewer";

export type ServicePrivilege = "view" | "request" | "edit";

export type ServicePrivileges = Record<string, ServicePrivilege>;

export type ServiceStatus = "on-service" | "off-service";

export const SERVICE_LINES = ["ICU", "Gilbert", "Vascular", "Davies", "Berry", "Ferrara", "Fogel", "NRV", "Peds"] as const;

export type ServiceLine = (typeof SERVICE_LINES)[number];

export type TrainingLevel = "PGY1" | "PGY2" | "PGY3" | "PGY4" | "PGY5" | "Fellow";

export type ResidentRosterKind = "primary" | "off-service";

export type AssignmentKind = "case" | "block" | "clinic";

export type AssignmentSource = "admin" | "suggestion" | "viewer-claim";

export type CoverageKind = "call" | "rounding" | "off" | "note";

export const CALL_POSITIONS = ["senior", "mid-level", "intern"] as const;

export type CallPosition = (typeof CALL_POSITIONS)[number];

export type CoverageRequestAction = "create" | "update" | "delete";

export type CoverageRequestStatus = "pending" | "approved" | "denied";

export type CoverageRequestType = "calendar" | "resident-trade" | "resident-profile";

export type Priority = 1 | 2 | 3 | 4 | 5;

export interface Settings {
  splitBufferMinutes: number;
  turnoverMinutes: number;
  weekdayOnly: boolean;
}

export interface Hospital {
  id: string;
  name: string;
  shortName: string;
  color: string;
}

export interface Attending {
  id: string;
  name: string;
  service: string;
  priority: Priority;
  defaultHospitalId?: string;
}

export interface AvailabilityBlock {
  id: string;
  date: string;
  endDate?: string;
  startTime?: string;
  endTime?: string;
  label: string;
}

export interface ResidentRotationBlock {
  id: string;
  blockNumber: number;
  startDate: string;
  endDate: string;
  service: string;
}

export interface Resident {
  id: string;
  username?: string;
  name: string;
  aliases?: string[];
  emoji?: string;
  trainingLevel: TrainingLevel;
  rosterKind?: ResidentRosterKind;
  sourceProgram?: string;
  sourceProgramAbbreviation?: string;
  accountEligible?: boolean;
  serviceTags: string[];
  serviceStatus?: ServiceStatus;
  color?: string;
  tags: string[];
  trainingInterests: string[];
  unavailable: AvailabilityBlock[];
  rotationSchedule?: ResidentRotationBlock[];
}

export interface ProcedureDefault {
  id: string;
  label: string;
  durationMinutes: number;
  priority: Priority;
  tags: string[];
}

export interface Week {
  id: string;
  startDate: string;
  label: string;
}

export interface AttendingBlock {
  id: string;
  weekId: string;
  date: string;
  attendingId: string;
  hospitalId: string;
  firstCaseStartTime: string;
  notes: string;
}

export interface SurgeryCase {
  id: string;
  blockId: string;
  procedureLabel: string;
  durationMinutes: number;
  priority: Priority;
  tags: string[];
  notes: string;
  order: number;
}

export interface ClinicSession {
  id: string;
  weekId: string;
  date: string;
  startTime: string;
  endTime: string;
  attendingId?: string;
  service: string;
  location: string;
  hospitalId?: string;
  capacity: number;
  isProcedure: boolean;
}

export interface Assignment {
  id: string;
  kind: AssignmentKind;
  targetId: string;
  residentId: string;
  locked: boolean;
  source: AssignmentSource;
  createdAt: string;
  updatedAt: string;
}

export interface CoverageEntry {
  id: string;
  date: string;
  kind: CoverageKind;
  residentId?: string;
  serviceLine?: string;
  callPosition?: CallPosition;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface ResidentProfileChange {
  residentId: string;
  name?: string;
  aliases?: string[];
}

export interface CoverageChangeRequest {
  id: string;
  requestType?: CoverageRequestType;
  action: CoverageRequestAction;
  status: CoverageRequestStatus;
  entryId?: string;
  requestedEntry?: CoverageEntry;
  requesterResidentId?: string;
  targetResidentId?: string;
  requestedResidentProfile?: ResidentProfileChange;
  swapEntryId?: string;
  swapRequestedEntry?: CoverageEntry;
  serviceLine?: string;
  requesterUsername?: string;
  requesterName?: string;
  message: string;
  adminNote?: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface GoldStarAward {
  id: string;
  weekStartDate: string;
  giverResidentId?: string;
  recipientResidentId: string;
  createdAt: string;
  updatedAt: string;
}

export type ActivityEventType = "login" | "assignment" | "calendar" | "account" | "resident";

export interface ActivityEvent {
  id: string;
  createdAt: string;
  actorRole: Role;
  actorUsername?: string;
  actorName?: string;
  activityType: ActivityEventType;
  action: string;
  details: string;
  entityType?: string;
  entityId?: string;
}

export interface PlannerState {
  version: number;
  updatedAt: string;
  settings: Settings;
  hospitals: Hospital[];
  attendings: Attending[];
  residents: Resident[];
  procedureDefaults: ProcedureDefault[];
  weeks: Week[];
  attendingBlocks: AttendingBlock[];
  cases: SurgeryCase[];
  clinicSessions: ClinicSession[];
  assignments: Assignment[];
  coverageEntries: CoverageEntry[];
  coverageRequests: CoverageChangeRequest[];
  goldStarAwards: GoldStarAward[];
  activityEvents: ActivityEvent[];
}

export interface ScheduledCase extends SurgeryCase {
  date: string;
  startMinutes: number;
  endMinutes: number;
  startTime: string;
  endTime: string;
  attending: Attending;
  hospital: Hospital;
  block: AttendingBlock;
  assignment?: Assignment;
  assignments: Assignment[];
  warningMessages: string[];
}

export interface ScheduledBlock extends AttendingBlock {
  attending: Attending;
  hospital: Hospital;
  cases: ScheduledCase[];
  assignment?: Assignment;
  warningMessages: string[];
}

export interface ScheduledClinicSession extends ClinicSession {
  attending?: Attending;
  hospital?: Hospital;
  assignments: Assignment[];
  warningMessages: string[];
}

export interface DaySchedule {
  date: string;
  blocks: ScheduledBlock[];
  clinics: ScheduledClinicSession[];
  uncoveredCases: ScheduledCase[];
}

export interface WeekSchedule {
  week: Week;
  days: DaySchedule[];
}

export interface Warning {
  id: string;
  severity: "info" | "warning" | "danger";
  residentId?: string;
  assignmentId?: string;
  targetId?: string;
  message: string;
}

export interface UserSummary {
  username: string;
  displayName: string;
  role: Role;
  servicePrivileges: ServicePrivileges;
  createdAt: string;
  updatedAt: string;
  passwordUpdatedAt: string;
  mustChangePassword: boolean;
  temporaryPasswordExpiresAt?: string;
}

export interface SessionUser {
  username: string;
  displayName: string;
  role: Role;
  servicePrivileges: ServicePrivileges;
  passwordUpdatedAt: string;
  mustChangePassword: boolean;
  temporaryPasswordExpiresAt?: string;
}

export type CollectionName =
  | "hospitals"
  | "attendings"
  | "residents"
  | "procedureDefaults"
  | "weeks"
  | "attendingBlocks"
  | "cases"
  | "clinicSessions";

export interface EntityPayloadByCollection {
  hospitals: Hospital;
  attendings: Attending;
  residents: Resident;
  procedureDefaults: ProcedureDefault;
  weeks: Week;
  attendingBlocks: AttendingBlock;
  cases: SurgeryCase;
  clinicSessions: ClinicSession;
}

export interface ClaimRequest {
  scope: "case" | "block";
  targetId: string;
  residentId: string;
}
