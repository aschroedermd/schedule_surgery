import { Pool } from "pg";
import { normalizeServiceLine } from "../shared/services";
import { Attending, ClinicSession, PlannerState, Resident } from "../shared/types";
import { createInitialState, createSeedCoverageEntries } from "./sampleData";

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
  return {
    ...state,
    hospitals,
    attendings: normalizeAttendings(partial.attendings ?? [], hospitals[0]?.id),
    residents: normalizeResidents(partial.residents ?? []),
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
    serviceTags: normalizeServiceTags(resident.serviceTags, legacy.serviceStatus),
    tags: resident.tags ?? [],
    trainingInterests: resident.trainingInterests ?? [],
    unavailable: resident.unavailable ?? []
  };
}

function normalizeServiceTags(serviceTags: string[] | undefined, legacyStatus?: "on-service" | "off-service"): string[] {
  if (serviceTags?.length) return uniqueTrimmed(serviceTags);
  return legacyStatus === "off-service" ? [] : ["Davies"];
}

function normalizeAttendings(attendings: Attending[], defaultHospitalId?: string): Attending[] {
  const migrated = attendings.map((attending) => {
    const service = normalizeLegacyService(attending.service);
    return { ...attending, service };
  });

  if (!migrated.some((attending) => attending.id === "att_nussbaum" || attending.name.toLowerCase().includes("nussbaum"))) {
    migrated.push({
      id: "att_nussbaum",
      name: "Dr. Nussbaum",
      service: "Berry",
      priority: 3,
      defaultHospitalId
    });
  }

  return migrated;
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

function uniqueTrimmed(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
