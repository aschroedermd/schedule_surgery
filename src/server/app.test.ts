import request from "supertest";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createInitialState } from "./sampleData";
import { MemoryStateStore, normalizePlannerState } from "./store";
import { ServicePrivilege } from "../shared/types";

async function loginAs(username: string) {
  const app = createApp(new MemoryStateStore(createInitialState()));
  const password = username === "admin" ? "admin-dev-password" : "Schroeder1";
  const token = await loginOnApp(app, username, password);
  return { app, token };
}

async function loginOnApp(app: ReturnType<typeof createApp>, username: string, password = "Schroeder1") {
  const response = await request(app).post("/api/auth/login").send({ username, password }).expect(200);
  const token = response.body.token as string;
  if (response.body.mustChangePassword) {
    await request(app)
      .patch("/api/me/password")
      .set("authorization", `Bearer ${token}`)
      .send({ currentPassword: password, nextPassword: `${password}-${username}` })
      .expect(200);
  }
  return token;
}

async function grantPrivilege(app: ReturnType<typeof createApp>, adminToken: string, username: string, service: string, privilege: ServicePrivilege) {
  await request(app)
    .patch(`/api/users/${username}`)
    .set("authorization", `Bearer ${adminToken}`)
    .send({ pin: "9480", servicePrivileges: { [service]: privilege } })
    .expect(200);
}

describe("planner API", () => {
  beforeEach(() => {
    process.env.USER_STORE_PATH = path.join(os.tmpdir(), `planner-users-${crypto.randomUUID()}.json`);
    process.env.ADMIN_PASSWORD = "admin-dev-password";
    process.env.APP_SECRET = "test-secret";
    process.env.ADMIN_API_KEY = "test-admin-api-key";
    process.env.VIEWER_API_KEY = "test-viewer-api-key";
  });

  it("allows admin writes and blocks view-only users", async () => {
    const admin = await loginAs("admin");
    await request(admin.app)
      .post("/api/entities/hospitals")
      .set("authorization", `Bearer ${admin.token}`)
      .send({ id: "hosp_test", name: "Test Hospital", shortName: "TH", color: "#333333" })
      .expect(201);

    const guest = await loginAs("guest");
    await request(guest.app)
      .post("/api/entities/hospitals")
      .set("authorization", `Bearer ${guest.token}`)
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

  it("seeds user accounts and lets admin manage privileges behind the users pin", async () => {
    const { app, token } = await loginAs("admin");

    await request(app).get("/api/users?pin=1111").set("authorization", `Bearer ${token}`).expect(403);
    const usersResponse = await request(app).get("/api/users?pin=9480").set("authorization", `Bearer ${token}`).expect(200);

    expect(usersResponse.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: "guest", role: "viewer" }),
        expect.objectContaining({ username: "aswaak", role: "viewer" }),
        expect.objectContaining({ username: "tcao", role: "viewer" }),
        expect.objectContaining({ username: "cblue", role: "viewer" }),
        expect.objectContaining({ username: "admin", role: "admin" })
      ])
    );
    const residentLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "cblue", password: "Schroeder1" })
      .expect(200);
    expect(residentLogin.body).toEqual(
      expect.objectContaining({
        username: "cblue",
        displayName: "Christian Blue",
        role: "viewer",
        mustChangePassword: false,
        servicePrivileges: expect.objectContaining({ Davies: "view", ICU: "view" })
      })
    );

    const createResponse = await request(app)
      .post("/api/users")
      .set("authorization", `Bearer ${token}`)
      .send({ pin: "9480", username: "jsmith", servicePrivileges: { Berry: "request" } })
      .expect(201);
    expect(createResponse.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);
    expect(createResponse.body.user).toEqual(
      expect.objectContaining({
        username: "jsmith",
        mustChangePassword: true,
        servicePrivileges: expect.objectContaining({ Berry: "request", Davies: "view" })
      })
    );

    const bulkResponse = await request(app)
      .post("/api/users/bulk")
      .set("authorization", `Bearer ${token}`)
      .send({
        pin: "9480",
        users: [
          { username: "bulkone", displayName: "Bulk One", servicePrivileges: { Davies: "request" } },
          { username: "bulktwo", displayName: "Bulk Two", servicePrivileges: { Fogel: "edit" } }
        ]
      })
      .expect(201);
    expect(bulkResponse.body.created).toHaveLength(2);
    expect(bulkResponse.body.created).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          user: expect.objectContaining({ username: "bulkone", displayName: "Bulk One" }),
          temporaryPassword: expect.stringMatching(/^[A-Za-z0-9]{14}$/)
        }),
        expect.objectContaining({
          user: expect.objectContaining({ username: "bulktwo", displayName: "Bulk Two" }),
          temporaryPassword: expect.stringMatching(/^[A-Za-z0-9]{14}$/)
        })
      ])
    );

    const jsmithLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "jsmith", password: createResponse.body.temporaryPassword })
      .expect(200);
    expect(jsmithLogin.body).toEqual(
      expect.objectContaining({
        mustChangePassword: true,
        servicePrivileges: expect.objectContaining({ Berry: "request" })
      })
    );

    await request(app)
      .patch("/api/users/tcao")
      .set("authorization", `Bearer ${token}`)
      .send({ pin: "9480", servicePrivileges: { Berry: "edit" } })
      .expect(200);
    const resetResponse = await request(app)
      .patch("/api/users/tcao/password?pin=9480")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(resetResponse.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);

    const tcaoLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "tcao", password: resetResponse.body.temporaryPassword })
      .expect(200);

    expect(tcaoLogin.body).toEqual(
      expect.objectContaining({
        mustChangePassword: true,
        servicePrivileges: expect.objectContaining({ Berry: "edit", Davies: "view" })
      })
    );
    await request(app)
      .get("/api/state")
      .set("authorization", `Bearer ${tcaoLogin.body.token}`)
      .expect(403);
    const changeResponse = await request(app)
      .patch("/api/me/password")
      .set("authorization", `Bearer ${tcaoLogin.body.token}`)
      .send({ currentPassword: resetResponse.body.temporaryPassword, nextPassword: "new-pass" })
      .expect(200);
    expect(changeResponse.body.mustChangePassword).toBe(false);
  });

  it("serves the seeded July call calendar from the imported PDF", async () => {
    const { app, token } = await loginAs("admin");

    const response = await request(app).get("/api/state").set("authorization", `Bearer ${token}`).expect(200);

    expect(response.body.residents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "res_chief",
          name: "Andrew Schroeder",
          trainingLevel: "PGY5",
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 1, service: "Davies" })])
        }),
        expect.objectContaining({
          id: "res_fellow",
          name: "Adedayo Adeleke",
          trainingLevel: "PGY1",
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 1, service: "Davies" })])
        }),
        expect.objectContaining({
          id: "res_swaak",
          name: "Amanda Swaak",
          trainingLevel: "PGY3",
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 8, service: "Keeley Vasc" })])
        }),
        expect.objectContaining({
          id: "res_blue",
          name: "Christian Blue",
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 1, service: "SCC Night" })])
        })
      ])
    );
    expect(response.body.residents).toHaveLength(30);
    expect(response.body.attendings).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "att_nussbaum", name: "Dr. Nussbaum", service: "Berry" })])
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

  it("keeps existing OR coverage data instead of injecting demo OR schedule data", () => {
    const base = createInitialState();
    const normalized = normalizePlannerState({
      ...base,
      attendings: [{ id: "att_real", name: "Dr. Real", service: "Davies", priority: 1, defaultHospitalId: "hosp_main" }],
      attendingBlocks: [],
      cases: [],
      clinicSessions: [],
      coverageEntries: []
    });

    expect(normalized.attendings).toEqual([
      expect.objectContaining({ id: "att_real", name: "Dr. Real", service: "Davies" })
    ]);
    expect(normalized.attendings).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "att_chen" }),
        expect.objectContaining({ id: "att_patel" }),
        expect.objectContaining({ id: "att_morris" }),
        expect.objectContaining({ id: "att_nussbaum" })
      ])
    );
    expect(normalized.attendingBlocks).toEqual([]);
    expect(normalized.cases).toEqual([]);
    expect(normalized.clinicSessions).toEqual([]);
  });

  it("does not resurrect or canonicalize seeded residents after roster edits", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .delete("/api/entities/residents/res_swaak")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    await request(app)
      .patch("/api/entities/residents/res_chief")
      .set("authorization", `Bearer ${token}`)
      .send({ name: "Edited Resident", trainingLevel: "PGY4", serviceTags: ["Berry"] })
      .expect(200);

    const response = await request(app).get("/api/state").set("authorization", `Bearer ${token}`).expect(200);

    expect(response.body.residents).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "res_swaak" })])
    );
    expect(response.body.residents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "res_chief",
          name: "Edited Resident",
          trainingLevel: "PGY4",
          serviceTags: ["Berry"]
        })
      ])
    );
  });

  it("lets admins update a resident rotation name while keeping block dates", async () => {
    const { app, token } = await loginAs("admin");
    const stateResponse = await request(app).get("/api/state").set("authorization", `Bearer ${token}`).expect(200);
    const adeleke = stateResponse.body.residents.find((resident: { id: string }) => resident.id === "res_fellow");
    const nextSchedule = adeleke.rotationSchedule.map((rotation: { blockNumber: number }) =>
      rotation.blockNumber === 3 ? { ...rotation, service: "Davies" } : rotation
    );

    const updateResponse = await request(app)
      .patch("/api/entities/residents/res_fellow")
      .set("authorization", `Bearer ${token}`)
      .send({ rotationSchedule: nextSchedule })
      .expect(200);
    const updated = updateResponse.body.residents.find((resident: { id: string }) => resident.id === "res_fellow");

    expect(updated.rotationSchedule).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          blockNumber: 3,
          startDate: "2026-08-31",
          endDate: "2026-09-27",
          service: "Davies"
        })
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

  it("routes request-privileged calendar edits through editor-approved requests", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const adminLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "admin", password: "admin-dev-password" })
      .expect(200);
    const adminToken = adminLogin.body.token as string;
    await grantPrivilege(app, adminToken, "aswaak", "Davies", "request");
    await grantPrivilege(app, adminToken, "aschroeder", "Davies", "edit");
    const requesterToken = await loginOnApp(app, "aswaak");
    const editorToken = await loginOnApp(app, "aschroeder");

    await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${requesterToken}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_fellow", note: "", serviceLine: "Davies" })
      .expect(403);

    const requestResponse = await request(app)
      .post("/api/coverage-requests")
      .set("authorization", `Bearer ${requesterToken}`)
      .send({
        serviceLine: "Davies",
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
    expect(requestResponse.body.coverageRequests[0]).toEqual(
      expect.objectContaining({ status: "pending", requesterUsername: "aswaak", serviceLine: "Davies" })
    );

    const requesterState = await request(app).get("/api/state").set("authorization", `Bearer ${requesterToken}`).expect(200);
    expect(requesterState.body.coverageRequests).toHaveLength(1);

    const approvalResponse = await request(app)
      .post(`/api/coverage-requests/${requestId}/approve`)
      .set("authorization", `Bearer ${editorToken}`)
      .expect(200);

    expect(approvalResponse.body.coverageEntries).toEqual(
      expect.arrayContaining([expect.objectContaining({ date: "2026-07-03", kind: "call", residentId: "res_fellow" })])
    );
    expect(approvalResponse.body.coverageRequests.find((item: { id: string }) => item.id === requestId)).toEqual(
      expect.objectContaining({ status: "approved" })
    );
  });

  it("lets a service editor claim an uncovered case and records the claim", async () => {
    const admin = await loginAs("admin");
    await grantPrivilege(admin.app, admin.token, "aswaak", "Davies", "edit");
    const token = await loginOnApp(admin.app, "aswaak");

    const claimResponse = await request(admin.app)
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

  it("filters weekly schedule responses by selected service line", async () => {
    const { app, token } = await loginAs("admin");

    const daviesResponse = await request(app)
      .get("/api/weeks/week_current/schedule?service=Davies")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    const berryResponse = await request(app)
      .get("/api/weeks/week_current/schedule?service=Berry")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(daviesResponse.body.days.flatMap((day: { blocks: unknown[] }) => day.blocks)).toHaveLength(3);
    expect(berryResponse.body.days.flatMap((day: { blocks: unknown[] }) => day.blocks)).toHaveLength(0);
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
