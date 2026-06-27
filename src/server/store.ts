import { Pool } from "pg";
import { PlannerState, Resident } from "../shared/types";
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
  return {
    ...state,
    residents: normalizeResidents(state.residents ?? []),
    coverageEntries: partial.coverageEntries ?? createSeedCoverageEntries(),
    coverageRequests: partial.coverageRequests ?? []
  };
}

function normalizeResidents(residents: Resident[]): Resident[] {
  const migrated = residents.map((resident) => {
    if (resident.id === "res_chief" && resident.name === "Chief Resident") {
      return { ...resident, name: "Schroeder", color: "#f4cf55" };
    }
    if (resident.id === "res_fellow" && resident.name === "MIS Fellow") {
      return { ...resident, name: "Adeleke", color: "#c89af7" };
    }
    if (resident.id === "res_offservice" && resident.name === "Off-Service Resident") {
      return { ...resident, name: "Cao", color: "#f37d6e" };
    }
    if (resident.id === "res_chief" && !resident.color) return { ...resident, color: "#f4cf55" };
    if (resident.id === "res_fellow" && !resident.color) return { ...resident, color: "#c89af7" };
    if (resident.id === "res_offservice" && !resident.color) return { ...resident, color: "#f37d6e" };
    return resident;
  });

  if (migrated.some((resident) => resident.id === "res_swaak")) {
    return migrated;
  }

  return [
    ...migrated,
    {
      id: "res_swaak",
      name: "Swaak",
      trainingLevel: "PGY4",
      serviceStatus: "on-service",
      color: "#e65245",
      tags: ["home"],
      trainingInterests: ["general surgery", "abdominal wall", "clinic"],
      unavailable: []
    }
  ];
}
