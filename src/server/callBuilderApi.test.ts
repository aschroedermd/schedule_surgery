import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createInitialState } from "./sampleData";
import { MemoryStateStore } from "./store";

const RESIDENT_PASSWORD = "resident-call-builder-password";

describe("call builder API", () => {
  beforeEach(() => {
    process.env.USER_STORE_PATH = path.join(os.tmpdir(), `call-builder-users-${crypto.randomUUID()}.json`);
    process.env.ADMIN_PASSWORD = "call-builder-admin-password";
    process.env.SEED_USER_PASSWORD = RESIDENT_PASSWORD;
    process.env.APP_SECRET = "call-builder-test-secret";
  });

  it("shares timestamped drafts, keeps one main draft, and enforces creator-only deletion", async () => {
    const store = new MemoryStateStore(createInitialState(new Date("2026-08-30T12:00:00")));
    const app = createApp(store);
    const adminToken = await login(app, "admin", "call-builder-admin-password");
    const residentToken = await login(app, "cblue", RESIDENT_PASSWORD);

    await request(app)
      .post("/api/call-builder/generate")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ blockNumber: 3 })
      .expect(403);

    const requestResponse = await request(app)
      .post("/api/call-off-requests")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ date: "2026-09-05", scope: "weekend", priority: "priority", reason: "Family event" })
      .expect(201);
    expect(requestResponse.body.callOffRequests).toEqual([
      expect.objectContaining({ residentId: "res_blue", date: "2026-09-05", priority: "priority" })
    ]);

    await request(app)
      .patch("/api/users/cblue")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ canBuildCall: true })
      .expect(200)
      .expect(({ body }) => expect(body.user.canBuildCall).toBe(true));

    const generated = await request(app)
      .post("/api/call-builder/generate")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ blockNumber: 3 })
      .expect(200);
    expect(generated.body).toEqual(expect.objectContaining({ hardViolationCount: 0, blockNumber: 3 }));
    expect(generated.body.assignments).toHaveLength(36);
    expect(generated.body.solverSummary).toEqual(expect.objectContaining({
      engine: expect.stringMatching(/cp-sat|heuristic/),
      status: expect.stringMatching(/optimal|feasible|fallback/)
    }));

    const suggested = await request(app)
      .post("/api/call-builder/suggest")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ blockNumber: 3, assignments: generated.body.assignments.slice(1) })
      .expect(200);
    expect(suggested.body).toEqual([
      expect.objectContaining({ assignments: expect.arrayContaining(generated.body.assignments.slice(0, 1)) })
    ]);

    const coverageBefore = (await store.load()).coverageEntries;
    const firstSaved = await request(app)
      .post("/api/call-builder/drafts")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ blockNumber: 3, assignments: generated.body.assignments, solverSummary: generated.body.solverSummary })
      .expect(201);
    const firstDraft = firstSaved.body.callScheduleDrafts[0];
    expect(firstDraft).toEqual(expect.objectContaining({
      blockNumber: 3,
      createdByUsername: "cblue",
      createdByName: "Christian Blue",
      isMain: false,
      assignments: expect.any(Array),
      solverSummary: expect.objectContaining({ engine: expect.stringMatching(/cp-sat|heuristic/) }),
      evaluationSnapshot: expect.objectContaining({ hardViolationCount: 0 })
    }));
    expect(firstDraft.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(firstSaved.body.coverageEntries).toEqual(coverageBefore);

    const secondSaved = await request(app)
      .post("/api/call-builder/drafts")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ blockNumber: 3, assignments: generated.body.assignments.slice(1) })
      .expect(201);
    const secondDraft = secondSaved.body.callScheduleDrafts.find((draft: { id: string }) => draft.id !== firstDraft.id);
    expect(secondDraft.assignments).toHaveLength(35);

    await request(app)
      .patch(`/api/call-builder/drafts/${firstDraft.id}`)
      .set("authorization", `Bearer ${adminToken}`)
      .send({ isMain: true })
      .expect(200)
      .expect(({ body }) => expect(body.callScheduleDrafts.find((draft: { id: string }) => draft.id === firstDraft.id).isMain).toBe(true));

    const mainChanged = await request(app)
      .patch(`/api/call-builder/drafts/${secondDraft.id}`)
      .set("authorization", `Bearer ${residentToken}`)
      .send({ isMain: true })
      .expect(200);
    expect(mainChanged.body.callScheduleDrafts.filter((draft: { blockNumber: number; isMain: boolean }) => draft.blockNumber === 3 && draft.isMain)).toEqual([
      expect.objectContaining({ id: secondDraft.id })
    ]);

    await request(app)
      .delete(`/api/call-builder/drafts/${firstDraft.id}`)
      .set("authorization", `Bearer ${adminToken}`)
      .expect(403);
    const deleted = await request(app)
      .delete(`/api/call-builder/drafts/${firstDraft.id}`)
      .set("authorization", `Bearer ${residentToken}`)
      .expect(200);
    expect(deleted.body.callScheduleDrafts.some((draft: { id: string }) => draft.id === firstDraft.id)).toBe(false);

    const nonBuilderToken = await login(app, "tcao", RESIDENT_PASSWORD);
    const nonBuilderState = await request(app)
      .get("/api/state")
      .set("authorization", `Bearer ${nonBuilderToken}`)
      .expect(200);
    expect(nonBuilderState.body.callScheduleDrafts).toEqual([]);
    await request(app)
      .post("/api/call-builder/drafts")
      .set("authorization", `Bearer ${nonBuilderToken}`)
      .send({ blockNumber: 3, assignments: generated.body.assignments })
      .expect(403);
  }, 60_000);

  it("rejects weekday preferences and empty drafts while allowing work-in-progress drafts", async () => {
    const app = createApp(new MemoryStateStore(createInitialState(new Date("2026-08-30T12:00:00"))));
    const adminToken = await login(app, "admin", "call-builder-admin-password");
    const residentToken = await login(app, "cblue", RESIDENT_PASSWORD);

    await request(app)
      .post("/api/call-off-requests")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ date: "2026-09-02", scope: "day", priority: "secondary" })
      .expect(400);

    await request(app)
      .post("/api/call-builder/drafts")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ blockNumber: 3, assignments: [] })
      .expect(400);

    const generated = await request(app)
      .post("/api/call-builder/generate")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ blockNumber: 3 })
      .expect(200);
    const workInProgress = await request(app)
      .post("/api/call-builder/drafts")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ blockNumber: 3, assignments: generated.body.assignments.slice(0, 1) })
      .expect(201);
    expect(workInProgress.body.callScheduleDrafts[0].assignments).toHaveLength(1);
  }, 30_000);

  it("accepts, enforces, and saves draft-specific builder requirements", async () => {
    const app = createApp(new MemoryStateStore(createInitialState(new Date("2026-08-30T12:00:00"))));
    const adminToken = await login(app, "admin", "call-builder-admin-password");
    const builderConstraints = [
      { id: "andrew_off", kind: "off", residentId: "res_chief", date: "2026-09-12", scope: "weekend" },
      { id: "nathan_required", kind: "required-call", residentId: "res_shigley", date: "2026-09-19", scope: "day" }
    ];
    const generated = await request(app)
      .post("/api/call-builder/generate")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ blockNumber: 3, builderConstraints })
      .expect(200);

    expect(generated.body.assignments).toContainEqual({ date: "2026-09-19", callPosition: "intern", residentId: "res_shigley" });
    expect(generated.body.assignments.some((assignment: { date: string; residentId: string }) =>
      assignment.residentId === "res_chief"
      && assignment.date >= "2026-09-11"
      && assignment.date <= "2026-09-13"
    )).toBe(false);

    const saved = await request(app)
      .post("/api/call-builder/drafts")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ blockNumber: 3, assignments: generated.body.assignments, builderConstraints })
      .expect(201);
    expect(saved.body.callScheduleDrafts[0].builderConstraints).toEqual(builderConstraints);

    await request(app)
      .post("/api/call-builder/generate")
      .set("authorization", `Bearer ${adminToken}`)
      .send({
        blockNumber: 3,
        builderConstraints: [{ id: "weekday", kind: "off", residentId: "res_chief", date: "2026-09-09", scope: "day" }]
      })
      .expect(400);
  }, 30_000);
});

async function login(app: ReturnType<typeof createApp>, username: string, password: string): Promise<string> {
  const response = await request(app).post("/api/auth/login").send({ username, password }).expect(200);
  if (!response.body.mustChangePassword) return response.body.token as string;
  const changed = await request(app)
    .patch("/api/me/password")
    .set("authorization", `Bearer ${response.body.token}`)
    .send({ currentPassword: password, nextPassword: `${password}-${username}` })
    .expect(200);
  return changed.body.token as string;
}
