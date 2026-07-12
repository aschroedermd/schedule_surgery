import { Pool } from "pg";
import { buildResidentUsername, isPlaceholderResidentUsername } from "../shared/id";
import { normalizeServiceLine, toKnownServiceLine } from "../shared/services";
import { ActivityEvent, ActivityEventType, Attending, ClinicSession, GoldStarAward, PlannerState, Resident } from "../shared/types";
import { createInitialState, createSeedCoverageEntries } from "./sampleData";
import { createRotationResidents, getRotationResidentMatchNames, getSeedMigrationBlockNumbers } from "./residentRotationSeed";

export class StateConflictError extends Error {
  constructor(
    message: string,
    readonly currentVersion: number
  ) {
    super(message);
    this.name = "StateConflictError";
  }
}

export interface SaveOptions {
  expectedVersion?: number;
}

export interface StateStore {
  load(): Promise<PlannerState>;
  save(state: PlannerState, options?: SaveOptions): Promise<PlannerState>;
}

export class MemoryStateStore implements StateStore {
  private state: PlannerState;

  constructor(initialState: PlannerState = createInitialState()) {
    this.state = normalizePlannerState(initialState);
  }

  async load(): Promise<PlannerState> {
    this.state = normalizePlannerState(this.state);
    return structuredClone(this.state);
  }

  async save(state: PlannerState, options: SaveOptions = {}): Promise<PlannerState> {
    this.state = normalizePlannerState(this.state);
    if (options.expectedVersion !== undefined && options.expectedVersion !== this.state.version) {
      throw new StateConflictError("Planner state changed; refresh and retry", this.state.version);
    }
    this.state = normalizePlannerState(state, {
      version: this.state.version + 1,
      updatedAt: new Date().toISOString()
    });
    return structuredClone(this.state);
  }
}

export class PostgresStateStore implements StateStore {
  private pool: Pool;
  private initialized = false;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async load(): Promise<PlannerState> {
    await this.ensureInitialized();
    const result = await this.pool.query<{ data: PlannerState; version: string; updated_at: Date ;}>(
      "select data, version, updated_at from planner_state where id = $1",
      ["main"]
    );
    const row = result.rows[0];
    if (!row?.data) {
      const initial = createInitialState();
      const inserted = await this.insertInitialState(initial);
      return inserted;
    }
    return normalizePlannerState(row.data, {
      version: Number(row.version),
      updatedAt: row.updated_at.toISOString()
    });
  }

  async save(state: PlannerState, options: SaveOptions = {}): Promise<PlannerState> {
    await this.ensureInitialized();
    const normalized = normalizePlannerState(state);
    const expectedVersion = options.expectedVersion ?? normalized.version;
    const result = await this.pool.query<{ version: string; updated_at: Date ;}>(
      `update planner_state
       set data = $2, version = version + 1, updated_at = now()
       where id = $1 and version = $3
       returning version, updated_at`,
      ["main", stripStateMeta(normalized), expectedVersion]
    );
    const row = result.rows[0];
    if (!row) {
      const current = await this.pool.query<{ version: string ;}>("select version from planner_state where id = $1", ["main"]);
      const currentVersion = Number(current.rows[0]?.version ?? 0);
      throw new StateConflictError("Planner state changed; refresh and retry", currentVersion);
    }
    return normalizePlannerState(normalized, {
      version: Number(row.version),
      updatedAt: row.updated_at.toISOString()
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.pool.query(`
      create table if not exists planner_state (
        id text primary key,
        data jsonb not null,
        version bigint not null default 1,
        updated_at timestamptz not null default now()
      )
    `);
    await this.pool.query("alter table planner_state add column if not exists version bigint not null default 1");
    this.initialized = true;
  }

  private async insertInitialState(state: PlannerState): Promise<PlannerState> {
    const normalized = normalizePlannerState(state, {
      version: 1,
      updatedAt: new Date().toISOString()
    });
    const result = await this.pool.query<{ version: string; updated_at: Date ;}>(
      `insert into planner_state (id, data, version, updated_at)
       values ($1, $2, 1, now())
       on conflict (id) do nothing
       returning version, updated_at`,
      ["main", stripStateMeta(normalized)]
    );
    if (result.rows[0]) {
      return normalizePlannerState(normalized, {
        version: Number(result.rows[0].version),
        updatedAt: result.rows[0].updated_at.toISOString()
      });
    }
    return this.load();
  }
}

export function createDefaultStore(): StateStore {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://planner:planner@localhost:5432/surgery_schedule";
  if (databaseUrl === "memory") {
    return new MemoryStateStore();
  }
  return new PostgresStateStore(databaseUrl);
}

export function normalizePlannerState(
  state: PlannerState | Partial<PlannerState>,
  meta: Partial<Pick<PlannerState, "version" | "updatedAt">> = {}
): PlannerState {
  const partial = state as Partial<PlannerState>;
  const hospitals = partial.hospitals ?? [];
  const residents = normalizeResidents(partial.residents ?? []);
  const base: PlannerState = {
    ...(state as PlannerState),
    version: meta.version ?? readVersion(partial.version),
    updatedAt: meta.updatedAt ?? partial.updatedAt ?? new Date().toISOString(),
    settings: {
      splitBufferMinutes: partial.settings?.splitBufferMinutes ?? 90,
      turnoverMinutes: partial.settings?.turnoverMinutes ?? 30,
      weekdayOnly: partial.settings?.weekdayOnly ?? true
    },
    hospitals,
    attendings: normalizeAttendings(partial.attendings ?? []),
    residents: mergeRotationSeedIfNeeded(residents),
    procedureDefaults: partial.procedureDefaults ?? [],
    weeks: partial.weeks ?? [],
    attendingBlocks: partial.attendingBlocks ?? [],
    cases: partial.cases ?? [],
    clinicSessions: normalizeClinicSessions(partial.clinicSessions ?? []),
    assignments: partial.assignments ?? [],
    coverageEntries: partial.coverageEntries ?? createSeedCoverageEntries(),
    coverageRequests: partial.coverageRequests ?? [],
    goldStarAwards: normalizeGoldStarAwards(partial.goldStarAwards ?? []),
    activityEvents: normalizeActivityEvents(partial.activityEvents ?? [])
  };
  return removeDanglingReferences(base);
}

function normalizeActivityEvents(activityEvents: ActivityEvent[]): ActivityEvent[] {
  return activityEvents.map((event) => ({
    ...event,
    activityType: normalizeActivityEventType(event.activityType, event),
    actorUsername: normalizeOptionalString(event.actorUsername),
    actorName: normalizeOptionalString(event.actorName)
  }));
}

function normalizeActivityEventType(value: unknown, event: Partial<ActivityEvent>): ActivityEventType {
  if (value === "login" || value === "assignment" || value === "calendar" || value === "account" || value === "resident") return value;
  const action = event.action?.toLowerCase() ?? "";
  const entityType = event.entityType?.toLowerCase() ?? "";
  if (action.includes("login") || action.includes("logged in")) return "login";
  if (action.includes("account") || action.includes("password") || action.includes("profile") || entityType === "user") return "account";
  if (action.includes("resident") || action.includes("star") || entityType === "goldstaraward") return "resident";
  if (action.includes("calendar") || action.includes("call trade") || entityType === "coverageentry" || entityType === "coveragerequest") {
    return "calendar";
  }
  return "assignment";
}

function normalizeGoldStarAwards(goldStarAwards: GoldStarAward[]): GoldStarAward[] {
  return goldStarAwards
    .map((award) => {
      const createdAt = normalizeOptionalString(award.createdAt) ?? new Date().toISOString();
      return {
        ...award,
        id: normalizeOptionalString(award.id) ?? "star_legacy",
        weekStartDate: normalizeOptionalString(award.weekStartDate) ?? "",
        giverResidentId: normalizeOptionalString(award.giverResidentId),
        giverUsername: normalizeOptionalString(award.giverUsername),
        recipientResidentId: normalizeOptionalString(award.recipientResidentId) ?? "",
        createdAt,
        updatedAt: normalizeOptionalString(award.updatedAt) ?? createdAt
      };
    })
    .filter((award) => award.weekStartDate && award.recipientResidentId);
}

function normalizeResidents(residents: Resident[]): Resident[] {
  return residents.map(normalizeResident);
}

function normalizeResident(resident: Resident): Resident {
  const legacy = resident as Resident & { serviceStatus?: "on-service" | "off-service" ;};
  const sourceProgramAbbreviation = normalizeOptionalString(resident.sourceProgramAbbreviation);
  const sourceProgram = normalizeOptionalString(resident.sourceProgram);
  const tags = resident.tags ?? [];
  const rosterKind = normalizeResidentRosterKind(resident, sourceProgramAbbreviation, tags);
  const accountEligible = normalizeResidentAccountEligible(resident, rosterKind);
  return {
    ...resident,
    username: normalizeResidentUsername(resident, accountEligible),
    aliases: normalizeResidentAliases(resident.aliases),
    emoji: normalizeResidentEmoji(resident.emoji),
    rosterKind,
    sourceProgram,
    sourceProgramAbbreviation,
    accountEligible,
    serviceTags: normalizeServiceTags(resident.serviceTags, legacy.serviceStatus, resident.rotationSchedule),
    tags,
    trainingInterests: resident.trainingInterests ?? [],
    unavailable: resident.unavailable ?? [],
    vacation: normalizeVacationBlocks(resident.vacation),
    rotationSchedule: normalizeRotationSchedule(resident.rotationSchedule)
  };
}

function normalizeResidentUsername(resident: Resident, accountEligible: boolean): string | undefined {
  if (!accountEligible) return undefined;
  const normalized = normalizeOptionalUsername(resident.username);
  const derived = shouldDeriveResidentUsername(resident.name) ? buildResidentUsername(resident.name) : undefined;
  if (derived && (!normalized || isPlaceholderResidentUsername(normalized))) return derived;
  return normalized;
}

function normalizeResidentRosterKind(
  resident: Resident,
  sourceProgramAbbreviation: string | undefined,
  tags: string[]
): Resident["rosterKind"] {
  const rosterKind = resident.rosterKind;
  if (rosterKind === "primary" || rosterKind === "off-service") return rosterKind;
  if (tags.some((tag) => tag.trim().toLowerCase() === "off-service")) return "off-service";
  if (resident.accountEligible === false) return "off-service";
  return sourceProgramAbbreviation ? "off-service" : "primary";
}

function normalizeResidentAccountEligible(resident: Resident, rosterKind: Resident["rosterKind"]): boolean {
  if (typeof resident.accountEligible === "boolean") return resident.accountEligible;
  if (resident.username) return true;
  return rosterKind !== "off-service";
}

function shouldDeriveResidentUsername(name: string): boolean {
  return !/^Resident\s+\d+$/i.test(name.trim());
}

function normalizeResidentAliases(aliases: string[] | undefined): string[] {
  return [...new Set((aliases ?? []).map((alias) => alias.trim()).filter(Boolean))];
}

function normalizeServiceTags(
  serviceTags: string[] | undefined,
  legacyStatus?: "on-service" | "off-service",
  rotationSchedule?: Resident["rotationSchedule"]
): string[] {
  if (serviceTags?.length) return uniqueKnownServiceLines(serviceTags);
  if (rotationSchedule?.length) return [];
  return legacyStatus === "off-service" ? [] : ["Davies"];
}

function normalizeRotationSchedule(rotationSchedule: Resident["rotationSchedule"]): Resident["rotationSchedule"] {
  if (!Array.isArray(rotationSchedule)) return undefined;
  return rotationSchedule
    .filter((rotation) => rotation && Number.isFinite(rotation.blockNumber) && rotation.startDate && rotation.endDate)
    .map((rotation) => ({
      id: rotation.id || `rot_${rotation.blockNumber}`,
      blockNumber: rotation.blockNumber,
      startDate: rotation.startDate,
      endDate: rotation.endDate,
      service: rotation.service?.trim() || "Not listed in source grid"
    }))
    .sort((a, b) => a.blockNumber - b.blockNumber);
}

function normalizeVacationBlocks(vacation: Resident["vacation"]): NonNullable<Resident["vacation"]> {
  if (!Array.isArray(vacation)) return [];
  const ids = new Set<string>();
  const normalized = vacation.flatMap((block, index) => {
    if (!block || typeof block !== "object") return [];
    const startDate = typeof block.startDate === "string" ? block.startDate : "";
    const endDate = typeof block.endDate === "string" ? block.endDate : startDate;
    if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) return [];
    const suppliedId = typeof block.id === "string" ? block.id.trim() : "";
    const id = suppliedId || `vac_${startDate}_${endDate}_${index + 1}`;
    if (ids.has(id)) return [];
    ids.add(id);
    return [{ id, startDate, endDate }];
  });
  return normalized.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function mergeRotationSeedIfNeeded(residents: Resident[]): Resident[] {
  const seededResidents = createRotationResidents().map(normalizeResident);
  const seedById = new Map(seededResidents.map((resident) => [resident.id, resident]));
  const seedByName = new Map<string, Resident>();
  for (const seeded of seededResidents) {
    for (const name of getRotationResidentMatchNames(seeded.id)) {
      seedByName.set(normalizeName(name), seeded);
    }
  }
  const hasExistingRotationSchedules = residents.some((resident) => resident.rotationSchedule?.length);
  const hasOffServiceSeedBatch = residents.some(
    (resident) =>
      resident.rosterKind === "off-service" ||
      Boolean(resident.sourceProgramAbbreviation) ||
      resident.tags.includes("off-service")
  );
  const mergedSeedIds = new Set<string>();

  const mergedResidents = residents.map((resident) => {
    const seeded = seedById.get(resident.id) ?? seedByName.get(normalizeName(resident.name));
    if (!seeded) return resident;
    mergedSeedIds.add(seeded.id);
    return mergeSeededResident(resident, seeded, hasExistingRotationSchedules);
  });

  if (hasExistingRotationSchedules) {
    if (hasOffServiceSeedBatch) return mergedResidents;
    return [
      ...mergedResidents,
      ...seededResidents.filter(
        (seeded) =>
          seeded.rosterKind === "off-service" &&
          !mergedSeedIds.has(seeded.id) &&
          !mergedResidents.some((resident) => normalizeName(resident.name) === normalizeName(seeded.name))
      )
    ];
  }

  return [
    ...mergedResidents,
    ...seededResidents.filter((seeded) => !mergedSeedIds.has(seeded.id) && !mergedResidents.some((resident) => normalizeName(resident.name) === normalizeName(seeded.name)))
  ];
}

function mergeSeededResident(resident: Resident, seeded: Resident, hasExistingRotationSchedules: boolean): Resident {
  const seedMatchNames = new Set(getRotationResidentMatchNames(seeded.id).map(normalizeName));
  const shouldUseSeedIdentity = seedMatchNames.has(normalizeName(resident.name));
  const hasResidentSchedule = Boolean(resident.rotationSchedule?.length);
  return {
    ...seeded,
    id: resident.id,
    username: resident.username && !isPlaceholderResidentUsername(resident.username) ? resident.username : seeded.username,
    name: shouldUseSeedIdentity ? seeded.name : resident.name,
    aliases: resident.aliases?.length ? resident.aliases : seeded.aliases ?? [],
    trainingLevel: shouldUseSeedIdentity ? seeded.trainingLevel : resident.trainingLevel,
    rosterKind: resident.rosterKind ?? seeded.rosterKind,
    sourceProgram: resident.sourceProgram ?? seeded.sourceProgram,
    sourceProgramAbbreviation: resident.sourceProgramAbbreviation ?? seeded.sourceProgramAbbreviation,
    accountEligible: typeof resident.accountEligible === "boolean" ? resident.accountEligible : seeded.accountEligible,
    serviceTags: resident.serviceTags.length ? resident.serviceTags : seeded.serviceTags,
    emoji: resident.emoji ?? seeded.emoji,
    color: resident.color ?? seeded.color,
    tags: resident.tags.length ? resident.tags : seeded.tags,
    trainingInterests: resident.trainingInterests.length ? resident.trainingInterests : seeded.trainingInterests,
    unavailable: resident.unavailable.length ? resident.unavailable : seeded.unavailable,
    vacation: resident.vacation,
    rotationSchedule:
      hasExistingRotationSchedules && hasResidentSchedule
        ? mergeSeedMigrationBlocks(resident.rotationSchedule, seeded)
        : seeded.rotationSchedule
  };
}

function mergeSeedMigrationBlocks(rotationSchedule: Resident["rotationSchedule"], seeded: Resident): Resident["rotationSchedule"] {
  const blockNumbers = getSeedMigrationBlockNumbers(seeded.id);
  if (!blockNumbers.length) return rotationSchedule;
  const blockNumberSet = new Set(blockNumbers);
  const seededByBlock = new Map((seeded.rotationSchedule ?? []).map((rotation) => [rotation.blockNumber, rotation]));
  const existingBlockNumbers = new Set((rotationSchedule ?? []).map((rotation) => rotation.blockNumber));
  return [
    ...(rotationSchedule ?? []).map((rotation) => {
      const seededRotation = blockNumberSet.has(rotation.blockNumber) ? seededByBlock.get(rotation.blockNumber) : undefined;
      return seededRotation ? { ...rotation, service: seededRotation.service } : rotation;
    }),
    ...blockNumbers
      .filter((blockNumber) => !existingBlockNumbers.has(blockNumber))
      .map((blockNumber) => seededByBlock.get(blockNumber))
      .filter((rotation): rotation is NonNullable<Resident["rotationSchedule"]>[number] => Boolean(rotation))
  ].sort((a, b) => a.blockNumber - b.blockNumber);
}

function normalizeAttendings(attendings: Attending[]): Attending[] {
  return attendings.map((attending) => {
    const service = normalizeLegacyService(attending.service);
    return { ...attending, service };
  });
}

function normalizeClinicSessions(clinicSessions: ClinicSession[]): ClinicSession[] {
  return clinicSessions.map((clinic) => ({
    ...clinic,
    service: normalizeLegacyService(clinic.service),
    isProcedure: Boolean(clinic.isProcedure)
  }));
}

function normalizeLegacyService(service: string | undefined): string {
  if (!service) return "Davies";
  return normalizeServiceLine(service);
}

function uniqueKnownServiceLines(values: string[]): string[] {
  const serviceLines: string[] = [];
  for (const value of values) {
    const serviceLine = toKnownServiceLine(value);
    if (serviceLine && !serviceLines.includes(serviceLine)) serviceLines.push(serviceLine);
  }
  return serviceLines;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

function stripStateMeta(state: PlannerState): Omit<PlannerState, "version" | "updatedAt"> {
  const { version: _version, updatedAt: _updatedAt, ...data } = state;
  return data;
}

function readVersion(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : 1;
}

function normalizeOptionalUsername(username: string | undefined): string | undefined {
  if (!username) return undefined;
  const trimmed = username.trim().toLowerCase();
  return /^[a-z0-9._-]{2,40}$/.test(trimmed) ? trimmed : undefined;
}

function normalizeResidentEmoji(emoji: string | undefined): string | undefined {
  const trimmed = emoji?.trim();
  if (!trimmed) return undefined;
  return Array.from(trimmed)[0];
}

function removeDanglingReferences(state: PlannerState): PlannerState {
  const residentIds = new Set(state.residents.map((resident) => resident.id));
  const attendingIds = new Set(state.attendings.map((attending) => attending.id));
  const hospitalIds = new Set(state.hospitals.map((hospital) => hospital.id));
  const weekIds = new Set(state.weeks.map((week) => week.id));
  const blockIds = new Set(
    state.attendingBlocks
      .filter((block) => weekIds.has(block.weekId) && attendingIds.has(block.attendingId) && hospitalIds.has(block.hospitalId))
      .map((block) => block.id)
  );
  const caseIds = new Set(state.cases.filter((surgeryCase) => blockIds.has(surgeryCase.blockId)).map((surgeryCase) => surgeryCase.id));
  const clinicIds = new Set(
    state.clinicSessions
      .filter(
        (clinic) =>
          weekIds.has(clinic.weekId) &&
          (!clinic.attendingId || attendingIds.has(clinic.attendingId)) &&
          (!clinic.hospitalId || hospitalIds.has(clinic.hospitalId))
      )
      .map((clinic) => clinic.id)
  );

  return {
    ...state,
    attendingBlocks: state.attendingBlocks.filter((block) => blockIds.has(block.id)),
    cases: state.cases.filter((surgeryCase) => caseIds.has(surgeryCase.id)),
    clinicSessions: state.clinicSessions.filter((clinic) => clinicIds.has(clinic.id)),
    assignments: state.assignments.filter((assignment) => {
      if (!residentIds.has(assignment.residentId)) return false;
      if (assignment.kind === "block") return blockIds.has(assignment.targetId);
      if (assignment.kind === "case") return caseIds.has(assignment.targetId);
      if (assignment.kind === "clinic") return clinicIds.has(assignment.targetId);
      return false;
    }),
    coverageEntries: state.coverageEntries.filter((entry) => !entry.residentId || residentIds.has(entry.residentId)),
    coverageRequests: state.coverageRequests.filter((request) => {
      const requestedResidentId = request.requestedEntry?.residentId;
      if (requestedResidentId && !residentIds.has(requestedResidentId)) return false;
      if (request.requesterResidentId && !residentIds.has(request.requesterResidentId)) return false;
      if (request.targetResidentId && !residentIds.has(request.targetResidentId)) return false;
      if (request.requestedResidentProfile?.residentId && !residentIds.has(request.requestedResidentProfile.residentId)) return false;
      if (request.entryId && !state.coverageEntries.some((entry) => entry.id === request.entryId)) return false;
      return true;
    }),
    goldStarAwards: state.goldStarAwards.filter(
      (award) =>
        Boolean(award.giverUsername || award.giverResidentId) &&
        residentIds.has(award.recipientResidentId) &&
        (!award.giverResidentId ||
          (residentIds.has(award.giverResidentId) && award.giverResidentId !== award.recipientResidentId))
    )
  };
}
