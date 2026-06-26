import request from "supertest";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createInitialState } from "./sampleData";
import { MemoryStateStore } from "./store";

async function loginAs(role: "admin" | "viewer") {
  const app = createApp(new MemoryStateStore(createInitialState()));
  const password = role === "admin" ? "admin-dev-password" : "viewer-dev-password";
  const response = await request(app).post("/api/auth/login").send({ role, password }).expect(200);
  return { app, token: response.body.token as string };
}

describe("planner API", () => {
  beforeEach(() => {
    process.env.ADMIN_PASSWORD = "admin-dev-password";
    process.env.VIEWER_PASSWORD = "viewer-dev-password";
    process.env.APP_SECRET = "test-secret";
    process.env.ADMIN_API_KEY = "test-admin-api-key";
    process.env.VIEWER_API_KEY = "test-viewer-api-key";
  });

  it("allows admin writes and blocks viewer writes", async () => {
    const admin = await loginAs("admin");
    await request(admin.app)
      .post("/api/entities/hospitals")
      .set("authorization", `Bearer ${admin.token}`)
      .send({ id: "hosp_test", name: "Test Hospital", shortName: "TH", color: "#333333" })
      .expect(201);

    const viewer = await loginAs("viewer");
    await request(viewer.app)
      .post("/api/entities/hospitals")
      .set("authorization", `Bearer ${viewer.token}`)
      .send({ id: "hosp_denied", name: "Denied", shortName: "DN", color: "#333333" })
      .expect(403);
  });

  it("supports API key auth for tools", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));

    await request(app).get("/api/state").set("x-api-key", "test-viewer-api-key").expect(200);
    await request(app)
      .post("/api/entities/hospitals")
      .set("x-api-key", "test-viewer-api-key")
      .send({ id: "hosp_denied", name: "Denied", shortName: "DN", color: "#333333" })
      .expect(403);
    await request(app)
      .post("/api/entities/hospitals")
      .set("x-api-key", "test-admin-api-key")
      .send({ id: "hosp_api", name: "API Hospital", shortName: "API", color: "#333333" })
      .expect(201);
  });

  it("serves OpenAPI JSON for external clients and MCP builders", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));

    const response = await request(app).get("/api/openapi.json").expect(200);

    expect(response.body.openapi).toBe("3.1.0");
    expect(response.body.components.securitySchemes.ApiKeyAuth.name).toBe("X-API-Key");
    expect(response.body.paths["/api/entities/{collection}"].post).toBeDefined();
    expect(response.body.paths["/api/assignments"].post).toBeDefined();
  });

  it("lets a viewer claim an uncovered case and records the claim", async () => {
    const { app, token } = await loginAs("viewer");

    const claimResponse = await request(app)
      .post("/api/claims")
      .set("authorization", `Bearer ${token}`)
      .send({ scope: "case", targetId: "case_patel_bypass", residentId: "res_fellow" })
      .expect(201);

    expect(claimResponse.body.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "case",
          targetId: "case_patel_bypass",
          residentId: "res_fellow",
          source: "viewer-claim"
        })
      ])
    );
    expect(claimResponse.body.activityEvents[0]).toEqual(
      expect.objectContaining({
        actorRole: "viewer",
        action: "claimed coverage"
      })
    );
  });

  it("generates the requested uncovered case message format", async () => {
    const { app, token } = await loginAs("admin");

    const response = await request(app)
      .get("/api/weeks/week_current/uncovered-message")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(response.body.message).toContain("Uncovered cases for");
    expect(response.body.message).toContain("around");
    expect(response.body.message).toContain("Dr.");
  });

  it("promotes individual case assignments to a block assignment without retaining same-block case assignments", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: "res_chief" })
      .expect(201);
    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_chole", residentId: "res_chief" })
      .expect(201);
    const blockResponse = await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "block", targetId: "block_chen_mon", residentId: "res_chief" })
      .expect(201);

    expect(blockResponse.body.assignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "block",
          targetId: "block_chen_mon",
          residentId: "res_chief"
        })
      ])
    );
    const lingeringCaseAssignments = blockResponse.body.assignments.filter(
      (assignment: { kind: string; targetId: string }) =>
        assignment.kind === "case" && ["case_chen_whipple", "case_chen_chole"].includes(assignment.targetId)
    );
    expect(lingeringCaseAssignments).toEqual([]);
  });
});
