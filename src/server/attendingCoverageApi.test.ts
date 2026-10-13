import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createInitialState } from "./sampleData";
import { MemoryStateStore } from "./store";
import { attendingCoverage20261012 } from "../shared/fixtures/attendingCoverage20261012";
import { coverageCatalog, normalizeCoverageLine } from "../shared/attendingCoverage";

beforeEach(() => {
  process.env.ADMIN_API_KEY = "coverage-admin";
  process.env.VIEWER_API_KEY = "coverage-viewer";
});
function setup() {
  const state = createInitialState(new Date("2026-10-12T12:00:00Z"));
  state.attendingCoverageAssignments = [];
  state.attendings = [...new Set(attendingCoverage20261012.map(row => row.name))].map(name => ({ id: name.toLowerCase(), name, aliases: [`Dr. ${name}`], service: "", priority: 3 as const }));
  const store = new MemoryStateStore(state);
  return { store, app: createApp(store) };
}
const ranged = "/api/attending-coverage?startDate=2026-10-12&endDate=2026-10-13";
const base = { date: "2026-10-12", line: "Pediatrics", shift: "day", role: "primary", attendingId: "wattsman" };

describe("full attending-call agent API", () => {
  it("discovers the same category contract from API, OpenAPI and guide", async () => {
    const { app } = setup();
    const response = await request(app).get("/api/attending-coverage/categories").set("X-API-Key", "coverage-viewer").expect(200);
    expect(response.body).toEqual(coverageCatalog());
    const guide = await request(app).get("/api/agent-guide").expect(200);
    expect(guide.body.attendingCoverage.categories).toEqual(response.body.categories);
    const openapi = await request(app).get("/api/openapi.json").expect(200);
    expect(openapi.body.components.schemas.AttendingCoverageInput.properties.line.enum).toContain("SecondCall");
    expect(openapi.body.components.schemas.AttendingCoverageInput.properties).toHaveProperty("endDate");
    const page = await request(app).get("/agent").expect(200);
    expect(page.text.toLowerCase()).toContain("change in qgenda");
  });

  it("imports and freshly verifies every October 12 source row with one shared ACS night and explicit pediatric overnight", async () => {
    const { app, store } = setup();
    let version = (await store.load()).version;
    for (const row of attendingCoverage20261012) {
      const { name, ...fields } = row;
      const response = await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-admin").set("X-State-Version", String(version))
        .send({ ...fields, date: "2026-10-12", attendingId: name.toLowerCase() }).expect(row.line === "Trauma Night" ? 200 : 201);
      version = response.body.version;
      const verify = await request(app).get(ranged).set("X-API-Key", "coverage-viewer").expect(200);
      expect(verify.body.assignments).toEqual(expect.arrayContaining([expect.objectContaining({ line: normalizeCoverageLine(row.line), attendingId: name.toLowerCase() })]));
    }
    const read = await request(app).get(ranged).set("X-API-Key", "coverage-viewer").expect(200);
    expect(read.body.assignments).toHaveLength(13);
    expect(read.body.assignments.filter((row: { line: string }) => row.line === "ACS")).toHaveLength(1);
    const night = read.body.assignments.find((row: { attendingId: string }) => row.attendingId === "bass");
    expect(night).toMatchObject({ date: "2026-10-12", startTime: "17:00", endDate: "2026-10-13", endTime: "07:00", startsAt: "2026-10-12T21:00:00.000Z", endsAt: "2026-10-13T11:00:00.000Z" });
    expect(read.body.effectiveCoverage.find((row: { date: string; line: string }) => row.date === "2026-10-13" && row.line === "Pediatrics").carryIn).toEqual([expect.objectContaining({ attendingId: "bass", source: "api", inherited: false })]);
    expect(read.body.assignments.filter((row: { startTime?: string }) => row.startTime)).toHaveLength(2);
    expect(read.body.effectiveCoverage.find((row: { date: string; line: string }) => row.date === "2026-10-13" && row.line === "Practice").status).toBe("unassigned");
  });

  it("preserves untimed inheritance while timed days never generate night or weekend fallback", async () => {
    const { app } = setup();
    await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-admin").send({ ...base, startTime: "07:00", endTime: "17:00", endDate: base.date }).expect(201);
    const timed = await request(app).get(ranged).set("X-API-Key", "coverage-viewer").expect(200);
    expect(timed.body.effectiveCoverage.find((row: { date: string; line: string }) => row.date === base.date && row.line === "Pediatrics").night).toBeUndefined();
    const rowId = timed.body.assignments[0].id;
    await request(app).patch(`/api/attending-coverage/${rowId}`).set("X-API-Key", "coverage-admin").send({ startTime: null, endTime: null, endDate: null }).expect(200);
    const untimed = await request(app).get(ranged).set("X-API-Key", "coverage-viewer").expect(200);
    expect(untimed.body.effectiveCoverage.find((row: { date: string; line: string }) => row.date === base.date && row.line === "Pediatrics").night).toMatchObject({ inheritedFromDay: true, inherited: true, source: "api" });
  });

  it("blocks viewer writes, stale versions, duplicate ids, changed duplicate slots and QGenda edits", async () => {
    const { app, store } = setup();
    const initial = await store.load();
    await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-viewer").send(base).expect(403);
    await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-admin").set("X-State-Version", String(initial.version)).send({ ...base, id: "stable" }).expect(201);
    await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-admin").set("X-State-Version", String(initial.version)).send(base).expect(409);
    await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-admin").send({ ...base, attendingId: "bass" }).expect(409);
    await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-admin").send({ ...base, line: "Breast", id: "stable" }).expect(409);
    const current = await store.load();
    current.attendingCoverageAssignments[0].source = "qgenda";
    current.attendingCoverageAssignments.push({ ...current.attendingCoverageAssignments[0], id: "legacy-backup", line: "ACS", role: "backup", shift: "day", attendingId: "collier" });
    await store.save(current);
    for (const operation of [request(app).patch("/api/attending-coverage/stable").send({ attendingId: "bass" }), request(app).delete("/api/attending-coverage/stable"), request(app).post("/api/attending-coverage").send(base), request(app).post("/api/attending-coverage").send({ ...base, shift: "24h" }), request(app).post("/api/attending-coverage").send({ ...base, line: "SecondCall", role: "backup", attendingId: "collier" })]) {
      const response = await operation.set("X-API-Key", "coverage-admin").expect(409);
      expect(response.body.error).toMatch(/change in QGenda, then sync/i);
    }
  });

  it("validates timings and dedicated backup role, and creates call-only attendings without service or login", async () => {
    const { app, store } = setup();
    for (const timing of [{ startTime: "17:00" }, { startTime: "07:00", endTime: "06:00", endDate: base.date }, { startTime: "99:00", endTime: "17:00", endDate: base.date }]) {
      await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-admin").send({ ...base, ...timing }).expect(400);
    }
    await request(app).post("/api/attending-coverage").set("X-API-Key", "coverage-admin").send({ ...base, line: "SecondCall" }).expect(400);
    await request(app).post("/api/entities/attendings").set("X-API-Key", "coverage-admin").send({ id: "call-only", name: "Test Surgeon", coverageLines: ["CFMH"] }).expect(201);
    expect((await store.load()).attendings.find(person => person.id === "call-only")).toMatchObject({ service: "", coverageLines: ["FMH"] });
    await request(app).post("/api/entities/attendings").set("X-API-Key", "coverage-admin").send({ id: "duplicate", name: "Dr. Kelly" }).expect(409);
  });
});
