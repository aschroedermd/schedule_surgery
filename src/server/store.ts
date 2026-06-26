import { Pool } from "pg";
import { PlannerState } from "../shared/types";
import { createInitialState } from "./sampleData";

export interface StateStore {
  load(): Promise<PlannerState>;
  save(state: PlannerState): Promise<void>;
}

export class MemoryStateStore implements StateStore {
  private state: PlannerState;

  constructor(initialState: PlannerState = createInitialState()) {
    this.state = initialState;
  }

  async load(): Promise<PlannerState> {
    return structuredClone(this.state);
  }

  async save(state: PlannerState): Promise<void> {
    this.state = structuredClone(state);
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
    return data;
  }

  async save(state: PlannerState): Promise<void> {
    await this.ensureInitialized();
    await this.pool.query(
      `insert into planner_state (id, data, updated_at)
       values ($1, $2, now())
       on conflict (id)
       do update set data = excluded.data, updated_at = now()`,
      ["main", state]
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
