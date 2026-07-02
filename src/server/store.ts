import { Pool } from "pg";
import { normalizeServiceLine, toKnownServiceLine } from "../shared/services";
import { Attending, ClinicSession, PlannerState, Resident } from "../shared/types";
import { createInitialState, createSeedCoverageEntries } from "./sampleData";
import { createRotationResidents } from "./residentRotationSeed";

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
    const result = await this.pool.query<{ data: PlannerState; version: string; updated_at: Date }>(
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
    const result = await this.pool.query<{ version: string; updated_at: Date }>(
      `update planner_state
       set data = $2, version = version + 1, updated_at = now()
       where id = $1 and version = $3
       returning version, updated_at`,
      ["main", stripStateMeta(normalized), expectedVersion]
    );
    const row = result.rows[0];
    if (!row) {
      const current = await this.pool.query<{ version: string }>("select version from planner_state where id = $1", ["main"]);
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
    const result = await this.pool.query<{ version: string; updated_at: Date }>(
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
    activityEvents: partial.activityEvents ?? []
  };
  return removeDanglingReferences(base);
}

function normalizeResidents(residents: Resident[]): Resident[] {
  return residents.map(normalizeResident);
}

function normalizeResident(resident: Resident): Resident {
  const legacy = resident as Resident & { serviceStatus?: "on-service" | "off-service" };
  return {
    ...resident,
    username: normalizeOptionalUsername(resident.username),
    emoji: normalizeResidentEmoji(resident.emoji),
    serviceTags: normalizeServiceTags(resident.serviceTags, legacy.serviceStatus, resident.rotationSchedule),
    tags: resident.tags ?? [],
    trainingInterests: resident.trainingInterests ?? [],
    unavailable: resident.unavailable ?? [],
    rotationSchedule: normalizeRotationSchedule(resident.rotationSchedule)
  };
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

function mergeRotationSeedIfNeeded(residents: Resident[]): Resident[] {
  if (residents.some((resident) => resident.rotationSchedule?.length)) return residents;

  const seededResidents = createRotationResidents().map(normalizeResident);
  const seedById = new Map(seededResidents.map((resident) => [resident.id, resident]));
  const seedByName = new Map(seededResidents.map((resident) => [normalizeName(resident.name), resident]));
  const mergedSeedIds = new Set<string>();

  const mergedResidents = residents.map((resident) => {
    const seeded = seedById.get(resident.id) ?? seedByName.get(normalizeName(resident.name));
    if (!seeded) return resident;
    mergedSeedIds.add(seeded.id);
    return {
      ...seeded,
      id: resident.id,
      username: resident.username ?? seeded.username,
      emoji: resident.emoji ?? seeded.emoji,
      color: resident.color ?? seeded.color,
      tags: resident.tags.length ? resident.tags : seeded.tags,
      trainingInterests: resident.trainingInterests.length ? resident.trainingInterests : seeded.trainingInterests,
      unavailable: resident.unavailable.length ? resident.unavailable : seeded.unavailable
    };
  });

  return [
    ...mergedResidents,
    ...seededResidents.filter((seeded) => !mergedSeedIds.has(seeded.id) && !mergedResidents.some((resident) => normalizeName(resident.name) === normalizeName(seeded.name)))
  ];
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
      if (request.entryId && !state.coverageEntries.some((entry) => entry.id === request.entryId)) return false;
      return true;
    })
  };
}
