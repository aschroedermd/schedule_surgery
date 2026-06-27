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

  it("serves the seeded July call calendar from the imported PDF", async () => {
    const { app, token } = await loginAs("admin");

    const response = await request(app).get("/api/state").set("authorization", `Bearer ${token}`).expect(200);

    expect(response.body.residents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "res_chief", name: "Schroeder", color: "#f4cf55" }),
        expect.objectContaining({ id: "res_fellow", name: "Adeleke", color: "#c89af7" }),
        expect.objectContaining({ id: "res_swaak", name: "Swaak", color: "#e65245" })
      ])
    );
    expect(response.body.coverageEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-07-04", kind: "rounding", residentId: "res_chief" }),
        expect.objectContaining({ date: "2026-07-05", kind: "call", residentId: "res_chief" }),
        expect.objectContaining({ date: "2026-07-11", kind: "call", residentId: "res_fellow" }),
        expect.objectContaining({ date: "2026-07-24", kind: "call", residentId: "res_swaak" }),
        expect.objectContaining({ date: "2026-07-31", kind: "off", residentId: "res_swaak", note: "conference" }),
        expect.objectContaining({ date: "2026-08-01", kind: "off", residentId: "res_swaak", note: "conference" })
      ])
    );
  });

  it("serves OpenAPI JSON for external clients and MCP builders", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));

    const response = await request(app).get("/api/openapi.json").expect(200);

    expect(response.body.openapi).toBe("3.1.0");
    expect(response.body.components.securitySchemes.ApiKeyAuth.name).toBe("X-API-Key");
    expect(response.body.paths["/api/entities/{collection}"].post).toBeDefined();
    expect(response.body.paths["/api/assignments"].post).toBeDefined();
  });

  it("routes viewer calendar edits through admin-approved requests", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const viewerLogin = await request(app)
      .post("/api/auth/login")
      .send({ role: "viewer", password: "viewer-dev-password" })
      .expect(200);
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ role: "admin", password: "admin-dev-password" })
      .expect(200);
    const viewerToken = viewerLogin.body.token as string;
    const adminToken = adminLogin.body.token as string;

    await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${viewerToken}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_fellow", note: "" })
      .expect(403);

    const requestResponse = await request(app)
      .post("/api/coverage-requests")
      .set("authorization", `Bearer ${viewerToken}`)
      .send({
        action: "create",
        requestedEntry: {
          date: "2026-07-03",
          kind: "call",
          residentId: "res_fellow",
          note: ""
        },
        message: "Can Adeleke cover this call?"
      })
      .expect(201);

    const requestId = requestResponse.body.coverageRequests[0].id;
    expect(requestResponse.body.coverageEntries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ date: "2026-07-03", kind: "call", residentId: "res_fellow" })])
    );
    expect(requestResponse.body.coverageRequests[0]).toEqual(expect.objectContaining({ status: "pending" }));

    const approvalResponse = await request(app)
      .post(`/api/coverage-requests/${requestId}/approve`)
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(approvalResponse.body.coverageEntries).toEqual(
      expect.arrayContaining([expect.objectContaining({ date: "2026-07-03", kind: "call", residentId: "res_fellow" })])
    );
    expect(approvalResponse.body.coverageRequests.find((item: { id: string }) => item.id === requestId)).toEqual(
      expect.objectContaining({ status: "approved" })
    );
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

  it("stores multiple weeks and cascades week deletes", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .post("/api/entities/weeks")
      .set("authorization", `Bearer ${token}`)
      .send({ id: "week_next", startDate: "2026-07-06", label: "Week of Jul 6, 2026" })
      .expect(201);
    await request(app)
      .post("/api/entities/attendingBlocks")
      .set("authorization", `Bearer ${token}`)
      .send({
        id: "block_next",
        weekId: "week_next",
        date: "2026-07-06",
        attendingId: "att_chen",
        hospitalId: "hosp_main",
        firstCaseStartTime: "07:30",
        notes: ""
      })
      .expect(201);
    await request(app)
      .post("/api/entities/cases")
      .set("authorization", `Bearer ${token}`)
      .send({
        id: "case_next",
        blockId: "block_next",
        procedureLabel: "Lap chole",
        durationMinutes: 90,
        priority: 2,
        tags: ["general surgery"],
        notes: "",
        order: 0
      })
      .expect(201);
    await request(app)
      .post("/api/entities/clinicSessions")
      .set("authorization", `Bearer ${token}`)
      .send({
        id: "clinic_next",
        weekId: "week_next",
        date: "2026-07-07",
        startTime: "13:00",
        endTime: "17:00",
        attendingId: "att_chen",
        service: "HPB",
        location: "University Hospital Clinic",
        hospitalId: "hosp_main",
        capacity: 1
      })
      .expect(201);
    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_next", residentId: "res_chief" })
      .expect(201);
    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "clinic", targetId: "clinic_next", residentId: "res_fellow" })
      .expect(201);

    const nextSchedule = await request(app)
      .get("/api/weeks/week_next/schedule")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(nextSchedule.body.days.flatMap((day: { blocks: unknown[] }) => day.blocks)).toHaveLength(1);

    const deleteResponse = await request(app)
      .delete("/api/entities/weeks/week_next")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(deleteResponse.body.weeks.map((week: { id: string }) => week.id)).toContain("week_current");
    expect(deleteResponse.body.weeks.map((week: { id: string }) => week.id)).not.toContain("week_next");
    expect(deleteResponse.body.attendingBlocks.map((block: { id: string }) => block.id)).not.toContain("block_next");
    expect(deleteResponse.body.cases.map((surgeryCase: { id: string }) => surgeryCase.id)).not.toContain("case_next");
    expect(deleteResponse.body.clinicSessions.map((clinic: { id: string }) => clinic.id)).not.toContain("clinic_next");
    expect(deleteResponse.body.assignments.map((assignment: { targetId: string }) => assignment.targetId)).not.toEqual(
      expect.arrayContaining(["case_next", "clinic_next"])
    );
  });
});
