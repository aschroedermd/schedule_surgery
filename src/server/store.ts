import { Pool } from "pg";
import { normalizeServiceLine, toKnownServiceLine } from "../shared/services";
import { Attending, ClinicSession, PlannerState, Resident } from "../shared/types";
import { createInitialState, createSeedCoverageEntries } from "./sampleData";
import { createRotationResidents } from "./residentRotationSeed";

export interface StateStore {
  load(): Promise<PlannerState>;
  save(state: PlannerState): Promise<void>;
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

  async save(state: PlannerState): Promise<void> {
    this.state = normalizePlannerState(state);
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
    const result = await this.pool.query<{ data: PlannerState }>("select data from planner_state where id = $1", ["main"]);
    const data = result.rows[0]?.data;
    if (!data) {
      const initial = createInitialState();
      await this.save(initial);
      return initial;
    }
    return normalizePlannerState(data);
  }

  async save(state: PlannerState): Promise<void> {
    await this.ensureInitialized();
    const normalized = normalizePlannerState(state);
    await this.pool.query(
      `insert into planner_state (id, data, updated_at)
       values ($1, $2, now())
       on conflict (id)
       do update set data = excluded.data, updated_at = now()`,
      ["main", normalized]
    );
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
        updated_at timestamptz not null default now()
      )
    `);
    this.initialized = true;
  }
}

export function createDefaultStore(): StateStore {
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://planner:planner@localhost:5432/surgery_schedule";
  if (databaseUrl === "memory") {
    return new MemoryStateStore();
  }
  return new PostgresStateStore(databaseUrl);
}

export function normalizePlannerState(state: PlannerState): PlannerState {
  const partial = state as Partial<PlannerState>;
  const hospitals = partial.hospitals ?? [];
  const residents = normalizeResidents(partial.residents ?? []);
  return {
    ...state,
    hospitals,
    attendings: normalizeAttendings(partial.attendings ?? []),
    residents: mergeRotationSeedIfNeeded(residents),
    clinicSessions: normalizeClinicSessions(partial.clinicSessions ?? []),
    coverageEntries: partial.coverageEntries ?? createSeedCoverageEntries(),
    coverageRequests: partial.coverageRequests ?? []
  };
}

function normalizeResidents(residents: Resident[]): Resident[] {
  return residents.map(normalizeResident);
}

function normalizeResident(resident: Resident): Resident {
  const legacy = resident as Resident & { serviceStatus?: "on-service" | "off-service" };
  return {
    ...resident,
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
