export type Role = "admin" | "attending" | "viewer" | "medical-student";

export type ServicePrivilege = "view" | "request" | "edit";

export type ServicePrivileges = Record<string, ServicePrivilege>;

export type ServiceStatus = "on-service" | "off-service";

export const SERVICE_LINES = ["ICU", "Gilbert", "Vascular", "Davies", "Berry", "Ferrara", "Fogel", "NRV", "Peds", "ENDO"] as const;

export type ServiceLine = (typeof SERVICE_LINES)[number];

export type TrainingLevel = "PGY1" | "PGY2" | "PGY3" | "PGY4" | "PGY5" | "Fellow" | "Medical Student";

export type ResidentRosterKind = "primary" | "off-service";

export type ResidentDesignation = "resident" | "minimally-invasive-fellow";

export type AssignmentKind = "case" | "block" | "clinic";

export type AssignmentSource = "admin" | "suggestion" | "viewer-claim";

export type CoverageKind = "call" | "attending-call" | "rounding" | "off" | "note";

export const CALL_POSITIONS = ["senior", "mid-level", "intern"] as const;

export type CallPosition = (typeof CALL_POSITIONS)[number];

export type CoverageRequestAction = "create" | "update" | "delete";

export type CoverageRequestStatus = "pending" | "approved" | "denied";

export type CoverageRequestType =
  | "calendar"
  | "resident-trade"
  | "resident-profile"
  | "resident-vacation"
  | "assignment-change"
  | "case-order-change";

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
  aliases?: string[];
  email?: string;
  service: string;
  coverageLines?: AttendingCoverageLine[];
  qgendaStaffId?: string;
  priority: Priority;
  defaultHospitalId?: string;
}

export const ATTENDING_COVERAGE_LINES = ["EGS", "Trauma", "SCC", "ACS", "Practice", "Vascular", "Pediatrics"] as const;

export type AttendingCoverageLine = (typeof ATTENDING_COVERAGE_LINES)[number];

export type AttendingCoverageShift = "day" | "night" | "24h" | "weekend";

export type AttendingCoverageRole = "primary" | "backup";

export type AttendingCoverageSource = "manual" | "api" | "qgenda";

export interface AttendingCoverageAssignment {
  id: string;
  date: string;
  line: AttendingCoverageLine;
  shift: AttendingCoverageShift;
  role: AttendingCoverageRole;
  attendingId?: string;
  fellowResidentId?: string;
  source: AttendingCoverageSource;
  externalId?: string;
  externalModifiedAt?: string;
  note: string;
  createdAt: string;
  updatedAt: string;
}

export interface QgendaSyncStatus {
  enabled: boolean;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastError?: string;
  lastChangedCount?: number;
  lastImportedCount?: number;
  skippedCount?: number;
  windowStart?: string;
  windowEnd?: string;
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

export interface VacationBlock {
  id: string;
  startDate: string;
  endDate: string;
}

export interface Resident {
  id: string;
  username?: string;
  name: string;
  aliases?: string[];
  emoji?: string;
  trainingLevel: TrainingLevel;
  designation?: ResidentDesignation;
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
  vacation?: VacationBlock[];
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
  dayAttendingId?: string;
  nightAttendingId?: string;
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

export interface ResidentVacationChange {
  residentId: string;
  vacation: VacationBlock[];
}

export interface AssignmentChange {
  assignmentId?: string;
  kind: AssignmentKind;
  targetId: string;
  residentId?: string;
  locked?: boolean;
}

export interface CaseOrderChange {
  caseId: string;
  order: number;
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
  requestedResidentVacation?: ResidentVacationChange;
  requestedAssignmentChange?: AssignmentChange;
  requestedCaseOrderChange?: CaseOrderChange;
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
  giverUsername?: string;
  recipientResidentId: string;
  createdAt: string;
  updatedAt: string;
}

export type ActivityEventType = "login" | "assignment" | "calendar" | "account" | "resident" | "assistant" | "wiki";

export interface DirectoryContact {
  id: string;
  name: string;
  phoneNumber: string;
  alternatePhoneNumbers?: string[];
  aliases?: string[];
  category: string;
  directoryType: DirectoryContactType;
  facility?: HospitalContactFacility;
  building?: string;
  importance?: HospitalContactImportance;
  organization: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

export type DirectoryContactType = "Hospital" | "Residents" | "Faculty & Staff";

export const HOSPITAL_CONTACT_FACILITIES = ["RMH", "NRV", "FMH", "Giles", "Tazewell", "Rockbridge"] as const;

export type HospitalContactFacility = (typeof HOSPITAL_CONTACT_FACILITIES)[number];

export type HospitalContactImportance = "essential" | "extended";

export type ContactRequestStatus = "pending" | "approved" | "rejected";

export interface ContactRequest {
  id: string;
  contact: DirectoryContact;
  status: ContactRequestStatus;
  requesterUsername: string;
  requesterName: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  adminNote?: string;
}

export const WIKI_CATEGORIES = [
  "index",
  "program",
  "service",
  "hospital",
  "attending",
  "workflow",
  "clinical-reference"
] as const;

export type WikiCategory = (typeof WIKI_CATEGORIES)[number];

export const WIKI_STATUSES = ["draft", "review", "published", "archived"] as const;
export type WikiStatus = (typeof WIKI_STATUSES)[number];

export const WIKI_AUTHORITIES = [
  "program-reference",
  "institutional-policy",
  "attending-preference",
  "workflow",
  "educational-template"
] as const;
export type WikiAuthority = (typeof WIKI_AUTHORITIES)[number];

export const WIKI_ARTICLE_KINDS = [
  "index",
  "program-reference",
  "service-guide",
  "hospital-guide",
  "attending-profile",
  "workflow",
  "operative-preference",
  "perioperative-protocol",
  "institutional-policy",
  "educational-reference",
  "note-template",
  "clinical-reference"
] as const;

export type WikiArticleKind = (typeof WIKI_ARTICLE_KINDS)[number];

export const WIKI_CLINICAL_PHASES = [
  "clinic",
  "preoperative",
  "intraoperative",
  "post-anesthesia",
  "inpatient",
  "discharge",
  "follow-up",
  "administrative"
] as const;

export type WikiClinicalPhase = (typeof WIKI_CLINICAL_PHASES)[number];

export const WIKI_RELATIONSHIP_TYPES = [
  "belongs-to",
  "variant-of",
  "shared-preference",
  "supplements",
  "governed-by",
  "overrides",
  "uses-workflow",
  "related",
  "see-also"
] as const;

export type WikiRelationshipType = (typeof WIKI_RELATIONSHIP_TYPES)[number];

export interface WikiArticleScope {
  services: string[];
  attendings: string[];
  procedures: string[];
  hospitals: string[];
  phases: WikiClinicalPhase[];
  patientPopulations: string[];
}

export interface WikiArticleRelationship {
  type: WikiRelationshipType;
  target: string;
  note?: string;
}

export const WIKI_SOURCE_TYPES = [
  "direct-review",
  "interview",
  "preference-card",
  "policy",
  "email",
  "document",
  "educational-note"
] as const;
export type WikiSourceType = (typeof WIKI_SOURCE_TYPES)[number];

export interface WikiSourceReference {
  sourceId: string;
  locator?: string;
  supports?: string;
}

export interface WikiSource {
  id: string;
  title: string;
  sourceType: WikiSourceType;
  author?: string;
  origin?: string;
  capturedAt: string;
  effectiveDate?: string;
  contentHash: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface WikiArticle {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  category: WikiCategory;
  /** Structured semantic kind. Optional only for backward-compatible legacy articles. */
  kind?: WikiArticleKind;
  /** Explicit clinical/operational applicability. Empty values mean the scope has not yet been migrated. */
  scope?: WikiArticleScope;
  /** Typed graph edges; targets are also mirrored into links for legacy traversal. */
  relationships?: WikiArticleRelationship[];
  /** Descriptive audience labels, not an access-control mechanism. */
  audience?: string[];
  aliases: string[];
  tags: string[];
  links: string[];
  status: WikiStatus;
  authority: WikiAuthority;
  revision: number;
  contentHash: string;
  sourceRefs: WikiSourceReference[];
  owner?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  reviewDueAt?: string;
  supersedes?: string[];
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface WikiChangeEvent {
  revision: number;
  entity: "article" | "source";
  operation: "create" | "update" | "delete";
  key: string;
  slug?: string;
  sourceId?: string;
  articleRevision?: number;
  contentHash?: string;
  changedAt: string;
  changedBy?: string;
}

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
  attendingCoverageAssignments: AttendingCoverageAssignment[];
  qgendaSync: QgendaSyncStatus;
  coverageEntries: CoverageEntry[];
  coverageRequests: CoverageChangeRequest[];
  contacts: DirectoryContact[];
  contactRequests: ContactRequest[];
  wikiArticles: WikiArticle[];
  wikiSources: WikiSource[];
  wikiRevision: number;
  wikiChanges: WikiChangeEvent[];
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
  attendingId?: string;
  servicePrivileges: ServicePrivileges;
  canAddContacts: boolean;
  voiceDailyLimit: number;
  preferredVoicePreset?: 1 | 2 | 3 | 4 | 5;
  createdAt: string;
  updatedAt: string;
  passwordUpdatedAt: string;
  mustChangePassword: boolean;
}

export interface SessionUser {
  username: string;
  displayName: string;
  role: Role;
  attendingId?: string;
  servicePrivileges: ServicePrivileges;
  canAddContacts: boolean;
  preferredVoicePreset?: 1 | 2 | 3 | 4 | 5;
  passwordUpdatedAt: string;
  mustChangePassword: boolean;
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
