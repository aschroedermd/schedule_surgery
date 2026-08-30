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

  it("enforces the dedicated privilege, stores resident requests, and publishes a valid draft", async () => {
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

    const published = await request(app)
      .post("/api/call-builder/publish")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ blockNumber: 3, assignments: generated.body.assignments })
      .expect(200);
    const blockCall = published.body.coverageEntries.filter(
      (entry: { kind: string; date: string }) => entry.kind === "call" && entry.date >= "2026-08-31" && entry.date <= "2026-09-27"
    );
    expect(blockCall).toHaveLength(36);
    expect(blockCall.every((entry: { note: string }) => entry.note === "Call Builder · Block 3")).toBe(true);
  }, 30_000);

  it("rejects weekday preferences and incomplete drafts", async () => {
    const app = createApp(new MemoryStateStore(createInitialState(new Date("2026-08-30T12:00:00"))));
    const adminToken = await login(app, "admin", "call-builder-admin-password");
    const residentToken = await login(app, "cblue", RESIDENT_PASSWORD);

    await request(app)
      .post("/api/call-off-requests")
      .set("authorization", `Bearer ${residentToken}`)
      .send({ date: "2026-09-02", scope: "day", priority: "secondary" })
      .expect(400);

    await request(app)
      .post("/api/call-builder/publish")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ blockNumber: 3, assignments: [] })
      .expect(400);
  });
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
