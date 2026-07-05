import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { createInitialState } from "./sampleData";
import { MemoryStateStore, normalizePlannerState } from "./store";
import { ServicePrivilege } from "../shared/types";

const TEST_SEED_USER_PASSWORD = "resident-dev-password";

async function loginAs(username: string) {
  const app = createApp(new MemoryStateStore(createInitialState()));
  const password = username === "admin" ? "admin-dev-password" : TEST_SEED_USER_PASSWORD;
  const token = await loginOnApp(app, username, password);
  return { app, token };
}

async function loginOnApp(app: ReturnType<typeof createApp>, username: string, password = TEST_SEED_USER_PASSWORD) {
  const response = await request(app).post("/api/auth/login").send({ username, password }).expect(200);
  let token = response.body.token as string;
  if (response.body.mustChangePassword) {
    const changeResponse = await request(app)
      .patch("/api/me/password")
      .set("authorization", `Bearer ${token}`)
      .send({ currentPassword: password, nextPassword: `${password}-${username}` })
      .expect(200);
    token = changeResponse.body.token as string;
  }
  return token;
}

async function grantPrivilege(app: ReturnType<typeof createApp>, adminToken: string, username: string, service: string, privilege: ServicePrivilege) {
  await request(app)
    .patch(`/api/users/${username}`)
    .set("authorization", `Bearer ${adminToken}`)
    .send({ servicePrivileges: { [service]: privilege } })
    .expect(200);
}

describe("planner API", () => {
  beforeEach(() => {
    process.env.USER_STORE_PATH = path.join(os.tmpdir(), `planner-users-${crypto.randomUUID()}.json`);
    process.env.ADMIN_PASSWORD = "admin-dev-password";
    process.env.APP_SECRET = "test-secret";
    process.env.ADMIN_API_KEY = "test-admin-api-key";
    process.env.VIEWER_API_KEY = "test-viewer-api-key";
    process.env.SEED_USER_PASSWORD = TEST_SEED_USER_PASSWORD;
  });

  it("allows admin writes and blocks view-only users", async () => {
    const admin = await loginAs("admin");
    await request(admin.app)
      .post("/api/entities/hospitals")
      .set("authorization", `Bearer ${admin.token}`)
      .send({ id: "hosp_test", name: "Test Hospital", shortName: "TH", color: "#333333" })
      .expect(201);

    const viewer = await loginAs("cblue");
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

  it("seeds user accounts and lets admin manage privileges", async () => {
    const { app, token } = await loginAs("admin");

    const usersResponse = await request(app).get("/api/users").set("authorization", `Bearer ${token}`).expect(200);
    await request(app).get("/api/users").set("x-api-key", "test-admin-api-key").expect(403);

    expect(usersResponse.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ username: "aadeleke", role: "viewer" }),
        expect.objectContaining({ username: "cblue", role: "viewer" }),
        expect.objectContaining({ username: "tcao", role: "viewer" }),
        expect.objectContaining({ username: "hbrown", role: "viewer" }),
        expect.objectContaining({ username: "aswaak", role: "viewer" }),
        expect.objectContaining({ username: "admin", role: "admin" })
      ])
    );
    expect(usersResponse.body.users).not.toEqual(expect.arrayContaining([expect.objectContaining({ username: "aarnholt" })]));
    const residentLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "cblue", password: TEST_SEED_USER_PASSWORD })
      .expect(200);
    expect(residentLogin.body).toEqual(
      expect.objectContaining({
        username: "cblue",
        displayName: "Christian Blue",
        role: "viewer",
        mustChangePassword: true,
        servicePrivileges: expect.objectContaining({ Davies: "view", ICU: "view" })
      })
    );
    const viewerToken = await loginOnApp(app, "cblue");
    await request(app).get("/api/users").set("authorization", `Bearer ${viewerToken}`).expect(403);

    const createResponse = await request(app)
      .post("/api/users")
      .set("authorization", `Bearer ${token}`)
      .send({ username: "jsmith", servicePrivileges: { Berry: "request" } })
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
      .send({ servicePrivileges: { Berry: "edit" } })
      .expect(200);
    const resetResponse = await request(app)
      .patch("/api/users/tcao/password")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(resetResponse.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);

    const residentLoginAfterReset = await request(app)
      .post("/api/auth/login")
      .send({ username: "tcao", password: resetResponse.body.temporaryPassword })
      .expect(200);

    expect(residentLoginAfterReset.body).toEqual(
      expect.objectContaining({
        mustChangePassword: true,
        servicePrivileges: expect.objectContaining({ Berry: "edit", Davies: "view" })
      })
    );
    await request(app)
      .get("/api/state")
      .set("authorization", `Bearer ${residentLoginAfterReset.body.token}`)
      .expect(403);
    const changeResponse = await request(app)
      .patch("/api/me/password")
      .set("authorization", `Bearer ${residentLoginAfterReset.body.token}`)
      .send({ currentPassword: resetResponse.body.temporaryPassword, nextPassword: "new-pass" })
      .expect(200);
    expect(changeResponse.body.mustChangePassword).toBe(false);
  });

  it("migrates legacy placeholder resident usernames to name-based seeded usernames", async () => {
    const userStorePath = process.env.USER_STORE_PATH as string;
    const now = "2026-07-01T12:00:00.000Z";
    await fs.mkdir(path.dirname(userStorePath), { recursive: true });
    await fs.writeFile(
      userStorePath,
      JSON.stringify({
        version: 1,
        users: [
          {
            username: "resident01",
            displayName: "Resident 01",
            role: "viewer",
            servicePrivileges: { Davies: "request" },
            passwordHash: { algorithm: "scrypt", salt: "legacy", key: "legacy" },
            createdAt: now,
            updatedAt: now,
            passwordUpdatedAt: now,
            mustChangePassword: false
          }
        ]
      })
    );
    const { app, token } = await loginAs("admin");

    const usersResponse = await request(app).get("/api/users").set("authorization", `Bearer ${token}`).expect(200);

    expect(usersResponse.body.users).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          username: "aadeleke",
          displayName: "Adedayo Adeleke",
          servicePrivileges: expect.objectContaining({ Davies: "request" })
        })
      ])
    );
    expect(usersResponse.body.users).not.toEqual(expect.arrayContaining([expect.objectContaining({ username: "resident01" })]));
  });

  it("serves the seeded July call calendar from the MedHub rotation export", async () => {
    const { app, token } = await loginAs("admin");

    const response = await request(app).get("/api/state").set("authorization", `Bearer ${token}`).expect(200);

    expect(response.body.residents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "res_chief",
          name: "Andrew Schroeder",
          username: "aschroeder",
          trainingLevel: "PGY5",
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 1, service: "Davies" })])
        }),
        expect.objectContaining({
          id: "res_fellow",
          name: "Adedayo Adeleke",
          username: "aadeleke",
          trainingLevel: "PGY1",
          rotationSchedule: expect.arrayContaining([
            expect.objectContaining({ blockNumber: 1, service: "Davies" }),
            expect.objectContaining({ blockNumber: 2, service: "Ferrara" })
          ])
        }),
        expect.objectContaining({
          id: "res_offservice",
          name: "Thien Cao",
          username: "tcao",
          trainingLevel: "PGY2",
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 1, service: "Davies" })])
        }),
        expect.objectContaining({
          id: "res_swaak",
          name: "Amanda Swaak",
          username: "aswaak",
          trainingLevel: "PGY3",
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 8, service: "Keeley Vasc" })])
        }),
        expect.objectContaining({
          id: "res_blue",
          name: "Christian Blue",
          username: "cblue",
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 1, service: "SCC Night" })])
        }),
        expect.objectContaining({
          id: "res_external_hannah_brown",
          name: "Hannah Brown",
          username: "hbrown",
          rosterKind: "off-service",
          sourceProgramAbbreviation: "Pl Sx",
          accountEligible: true,
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 8, service: "Davies" })])
        }),
        expect.objectContaining({
          id: "res_external_alayna_arnholt",
          name: "Alayna Arnholt",
          rosterKind: "off-service",
          sourceProgramAbbreviation: "EM",
          accountEligible: false,
          rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 6, service: "Gilbert" })])
        })
      ])
    );
    const alayna = response.body.residents.find((resident: { id: string }) => resident.id === "res_external_alayna_arnholt");
    expect(alayna.username).toBeUndefined();
    expect(response.body.residents).toHaveLength(103);
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

  it("matches T-Cao to Thien Cao when adding rotation schedule data", () => {
    const base = createInitialState();
    const normalized = normalizePlannerState({
      ...base,
      residents: [
        {
          id: "res_legacy_tcao",
          username: "tcao",
          name: "T-Cao",
          trainingLevel: "PGY2",
          serviceTags: [],
          tags: [],
          trainingInterests: [],
          unavailable: []
        }
      ],
      coverageEntries: []
    });

    const cao = normalized.residents.find((resident) => resident.id === "res_legacy_tcao");

    expect(cao).toEqual(
      expect.objectContaining({
        name: "Thien Cao",
        trainingLevel: "PGY2",
        rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 1, service: "Davies" })])
      })
    );
    expect(normalized.residents.filter((resident) => resident.name === "Thien Cao")).toHaveLength(1);
  });

  it("adds off-service rotators to legacy rotation states only once", () => {
    const base = createInitialState();
    const legacyPrimaryResidents = base.residents.filter((resident) => resident.rosterKind !== "off-service");
    const migrated = normalizePlannerState({ ...base, residents: legacyPrimaryResidents });

    expect(migrated.residents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "res_external_hannah_brown", accountEligible: true, sourceProgramAbbreviation: "Pl Sx" }),
        expect.objectContaining({ id: "res_external_alayna_arnholt", accountEligible: false, sourceProgramAbbreviation: "EM" })
      ])
    );

    const afterDelete = normalizePlannerState({
      ...migrated,
      residents: migrated.residents.filter((resident) => resident.id !== "res_external_hannah_brown")
    });

    expect(afterDelete.residents).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "res_external_hannah_brown" })])
    );
    expect(afterDelete.residents).toHaveLength(102);
  });

  it("derives resident usernames from first initial and last name", () => {
    const base = createInitialState();
    const normalized = normalizePlannerState({
      ...base,
      residents: [
        {
          id: "res_andrew_schroeder",
          username: "resident99",
          name: "Andrew Schroeder",
          trainingLevel: "PGY5",
          serviceTags: [],
          tags: [],
          trainingInterests: [],
          unavailable: []
        },
        {
          id: "res_amanda_swaak",
          name: "Amanda Swaak",
          trainingLevel: "PGY4",
          serviceTags: [],
          tags: [],
          trainingInterests: [],
          unavailable: []
        },
        {
          id: "res_custom",
          username: "nightchief",
          name: "Custom Username",
          trainingLevel: "PGY5",
          serviceTags: [],
          tags: [],
          trainingInterests: [],
          unavailable: []
        }
      ],
      coverageEntries: []
    });

    expect(normalized.residents.find((resident) => resident.id === "res_andrew_schroeder")?.username).toBe("aschroeder");
    expect(normalized.residents.find((resident) => resident.id === "res_amanda_swaak")?.username).toBe("aswaak");
    expect(normalized.residents.find((resident) => resident.id === "res_custom")?.username).toBe("nightchief");
  });

  it("repairs current seeded resident schedule rows without resurrecting deleted residents", () => {
    const base = createInitialState();
    const legacyResidents = base.residents
      .filter((resident) => resident.id !== "res_swaak")
      .map((resident) => {
        if (resident.id === "res_offservice") return { ...resident, name: "T-Cao" };
        if (resident.id === "res_fellow") {
          return {
            ...resident,
            name: "Resident 01",
            trainingLevel: "PGY1" as const,
            rotationSchedule: resident.rotationSchedule?.map((rotation) =>
              rotation.blockNumber === 2 ? { ...rotation, service: "Ferrara" } : rotation
            )
          };
        }
        return resident;
      });
    const normalized = normalizePlannerState({ ...base, residents: legacyResidents });

    const cao = normalized.residents.find((resident) => resident.id === "res_offservice");
    const broden = normalized.residents.find((resident) => resident.id === "res_fellow");

    expect(normalized.residents).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "res_swaak" })]));
    expect(cao).toEqual(
      expect.objectContaining({
        name: "Thien Cao",
        rotationSchedule: expect.arrayContaining([expect.objectContaining({ blockNumber: 1, service: "Davies" })])
      })
    );
    expect(broden).toEqual(
      expect.objectContaining({
        name: "Adedayo Adeleke",
        trainingLevel: "PGY1",
        rotationSchedule: expect.arrayContaining([
          expect.objectContaining({ blockNumber: 1, service: "Davies" }),
          expect.objectContaining({ blockNumber: 2, service: "Ferrara" })
        ])
      })
    );
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
      .send({ date: "2026-07-03", kind: "call", residentId: "res_fellow", callPosition: "senior", note: "", serviceLine: "Davies" })
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
          callPosition: "senior",
          note: ""
        },
        message: "Can this resident cover this call?"
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

  it("keeps multiple same-day call entries for the shared call team", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_fellow", callPosition: "senior", note: "", serviceLine: "Davies" })
      .expect(201);

    const response = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_chief", callPosition: "mid-level", note: "", serviceLine: "Davies" })
      .expect(201);

    expect(response.body.coverageEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-07-03", kind: "call", residentId: "res_fellow" }),
        expect.objectContaining({ date: "2026-07-03", kind: "call", residentId: "res_chief" })
      ])
    );
  });

  it("keeps surgery call entries resident-only and capped at three plus one SCC/ICU resident", async () => {
    const { app, token } = await loginAs("admin");

    const invalidNoteResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-03",
        kind: "call",
        residentId: "res_chief",
        note: "Night team chief; Block 1 FINAL 6.25.2026",
        serviceLine: "Davies"
      })
      .expect(400);
    expect(invalidNoteResponse.body.error).toMatch(/only accept resident assignments/i);

    const missingPositionResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_chief", note: "", serviceLine: "Davies" })
      .expect(400);
    expect(missingPositionResponse.body.error).toMatch(/require callPosition/i);

    for (const [residentId, callPosition] of [
      ["res_fellow", "senior"],
      ["res_chief", "mid-level"],
      ["res_swaak", "intern"]
    ] as const) {
      await request(app)
        .post("/api/coverage-entries")
        .set("authorization", `Bearer ${token}`)
        .send({ date: "2026-07-03", kind: "call", residentId, callPosition, note: "", serviceLine: "Davies" })
        .expect(201);
    }

    const sccResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_blue", note: "icu", serviceLine: "Davies" })
      .expect(201);

    expect(sccResponse.body.coverageEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ date: "2026-07-03", kind: "call", residentId: "res_blue", note: "ICU" })
      ])
    );

    const duplicateResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_chief", callPosition: "mid-level", note: "", serviceLine: "Davies" })
      .expect(400);
    expect(duplicateResponse.body.error).toMatch(/already listed for call/i);

    const duplicatePositionResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_bradley", callPosition: "senior", note: "", serviceLine: "Davies" })
      .expect(400);
    expect(duplicatePositionResponse.body.error).toMatch(/already has a senior resident/i);

    const secondSccResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_somaiah", note: "SCC", serviceLine: "Davies" })
      .expect(400);
    expect(secondSccResponse.body.error).toMatch(/SCC\/ICU call can include at most 1 resident/i);
  });

  it("preserves the target service for off-service rounding entries", async () => {
    const { app, token } = await loginAs("admin");

    const response = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-04", kind: "rounding", residentId: "res_blue", serviceLine: "Davies", note: "" })
      .expect(201);

    expect(response.body.coverageEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          date: "2026-07-04",
          kind: "rounding",
          residentId: "res_blue",
          serviceLine: "Davies"
        })
      ])
    );
  });

  it("lets admins remove accidental coverage requests from the request log", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    await grantPrivilege(app, adminToken, "aswaak", "Davies", "request");
    await grantPrivilege(app, adminToken, "aschroeder", "Davies", "edit");
    const requesterToken = await loginOnApp(app, "aswaak");
    const editorToken = await loginOnApp(app, "aschroeder");

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
          callPosition: "senior",
          note: ""
        },
        message: "Duplicate request"
      })
      .expect(201);
    const requestId = requestResponse.body.coverageRequests[0].id;

    await request(app)
      .delete(`/api/coverage-requests/${requestId}`)
      .set("authorization", `Bearer ${requesterToken}`)
      .expect(403);
    await request(app)
      .delete(`/api/coverage-requests/${requestId}`)
      .set("authorization", `Bearer ${editorToken}`)
      .expect(403);

    const deleteResponse = await request(app)
      .delete(`/api/coverage-requests/${requestId}`)
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);

    expect(deleteResponse.body.coverageRequests.map((item: { id: string }) => item.id)).not.toContain(requestId);
    expect(deleteResponse.body.activityEvents[0]).toEqual(
      expect.objectContaining({
        actorRole: "admin",
        action: "removed coverage request",
        entityType: "coverageRequest",
        entityId: requestId
      })
    );
  });

  it("lets linked residents request and accept call trades with each other", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const requesterToken = await loginOnApp(app, "aschroeder");
    const targetToken = await loginOnApp(app, "aadeleke");
    const unrelatedToken = await loginOnApp(app, "cblue");

    const requestResponse = await request(app)
      .post("/api/coverage-requests")
      .set("authorization", `Bearer ${requesterToken}`)
      .send({
        serviceLine: "Davies",
        requestType: "resident-trade",
        action: "update",
        entryId: "cover_2026_07_05_schroeder_call",
        targetResidentId: "res_fellow",
        swapEntryId: "cover_2026_07_11_adeleke_call",
        message: "Can we swap?"
      })
      .expect(201);

    const tradeRequest = requestResponse.body.coverageRequests[0];
    expect(tradeRequest).toEqual(
      expect.objectContaining({
        requestType: "resident-trade",
        status: "pending",
        requesterUsername: "aschroeder",
        requesterResidentId: "res_chief",
        targetResidentId: "res_fellow",
        swapEntryId: "cover_2026_07_11_adeleke_call"
      })
    );
    expect(tradeRequest.requestedEntry).toEqual(expect.objectContaining({ residentId: "res_fellow" }));
    expect(tradeRequest.swapRequestedEntry).toEqual(expect.objectContaining({ residentId: "res_chief" }));
    expect(requestResponse.body.coverageEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cover_2026_07_05_schroeder_call", residentId: "res_chief" }),
        expect.objectContaining({ id: "cover_2026_07_11_adeleke_call", residentId: "res_fellow" })
      ])
    );

    const requesterState = await request(app).get("/api/state").set("authorization", `Bearer ${requesterToken}`).expect(200);
    const targetState = await request(app).get("/api/state").set("authorization", `Bearer ${targetToken}`).expect(200);
    const unrelatedState = await request(app).get("/api/state").set("authorization", `Bearer ${unrelatedToken}`).expect(200);
    expect(requesterState.body.coverageRequests.map((item: { id: string }) => item.id)).toContain(tradeRequest.id);
    expect(targetState.body.coverageRequests.map((item: { id: string }) => item.id)).toContain(tradeRequest.id);
    expect(unrelatedState.body.coverageRequests).toEqual([]);

    const approvalResponse = await request(app)
      .post(`/api/coverage-requests/${tradeRequest.id}/approve`)
      .set("authorization", `Bearer ${targetToken}`)
      .expect(200);

    expect(approvalResponse.body.coverageEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cover_2026_07_05_schroeder_call", residentId: "res_fellow" }),
        expect.objectContaining({ id: "cover_2026_07_11_adeleke_call", residentId: "res_chief" })
      ])
    );
    expect(approvalResponse.body.coverageRequests.find((item: { id: string }) => item.id === tradeRequest.id)).toEqual(
      expect.objectContaining({ status: "approved" })
    );
  });

  it("lets admins edit resident aliases directly", async () => {
    const { app, token } = await loginAs("admin");

    const response = await request(app)
      .patch("/api/entities/residents/res_fellow")
      .set("authorization", `Bearer ${token}`)
      .send({ aliases: ["Dayo", " A Adeleke ", "Dayo"] })
      .expect(200);
    const broden = response.body.residents.find((resident: { id: string }) => resident.id === "res_fellow");

    expect(broden).toEqual(expect.objectContaining({ aliases: ["Dayo", "A Adeleke"] }));
  });

  it("routes linked resident profile changes through admin approval", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const requesterToken = await loginOnApp(app, "aadeleke");
    const otherResidentToken = await loginOnApp(app, "cblue");
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");

    await request(app)
      .post("/api/coverage-requests")
      .set("authorization", `Bearer ${otherResidentToken}`)
      .send({
        requestType: "resident-profile",
        action: "update",
        targetResidentId: "res_fellow",
        requestedResidentProfile: {
          residentId: "res_fellow",
          name: "Other Person",
          aliases: ["Other"]
        }
      })
      .expect(403);

    const requestResponse = await request(app)
      .post("/api/coverage-requests")
      .set("authorization", `Bearer ${requesterToken}`)
      .send({
        requestType: "resident-profile",
        action: "update",
        targetResidentId: "res_fellow",
        requestedResidentProfile: {
          residentId: "res_fellow",
          name: "Dayo Adeleke",
          aliases: ["Adedayo Adeleke", "A Adeleke"]
        },
        message: "Preferred display name"
      })
      .expect(201);

    const profileRequest = requestResponse.body.coverageRequests[0];
    expect(profileRequest).toEqual(
      expect.objectContaining({
        requestType: "resident-profile",
        status: "pending",
        requesterUsername: "aadeleke",
        requesterResidentId: "res_fellow",
        targetResidentId: "res_fellow",
        requestedResidentProfile: expect.objectContaining({
          residentId: "res_fellow",
          name: "Dayo Adeleke",
          aliases: ["Adedayo Adeleke", "A Adeleke"]
        })
      })
    );

    const requesterState = await request(app).get("/api/state").set("authorization", `Bearer ${requesterToken}`).expect(200);
    expect(requesterState.body.coverageRequests.map((item: { id: string }) => item.id)).toContain(profileRequest.id);

    await request(app)
      .post(`/api/coverage-requests/${profileRequest.id}/approve`)
      .set("authorization", `Bearer ${requesterToken}`)
      .expect(403);

    const approvalResponse = await request(app)
      .post(`/api/coverage-requests/${profileRequest.id}/approve`)
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    const updatedResident = approvalResponse.body.residents.find((resident: { id: string }) => resident.id === "res_fellow");

    expect(updatedResident).toEqual(
      expect.objectContaining({
        name: "Dayo Adeleke",
        aliases: ["Adedayo Adeleke", "A Adeleke"]
      })
    );
    expect(approvalResponse.body.coverageRequests.find((item: { id: string }) => item.id === profileRequest.id)).toEqual(
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

  it("allows multiple different residents to be assigned to the same case", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: "res_chief" })
      .expect(201);
    const secondResponse = await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: "res_fellow" })
      .expect(201);

    const caseAssignments = secondResponse.body.assignments.filter(
      (assignment: { kind: string; targetId: string }) => assignment.kind === "case" && assignment.targetId === "case_chen_whipple"
    );
    expect(caseAssignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ residentId: "res_chief" }),
        expect.objectContaining({ residentId: "res_fellow" })
      ])
    );

    const scheduleResponse = await request(app)
      .get("/api/weeks/week_current/schedule")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    const scheduledCase = scheduleResponse.body.days
      .flatMap((day: { blocks: { cases: unknown[] }[] }) => day.blocks)
      .flatMap((block: { cases: { id: string; assignments: { residentId: string }[] }[] }) => block.cases)
      .find((surgeryCase: { id: string }) => surgeryCase.id === "case_chen_whipple");
    expect(scheduledCase.assignments.map((assignment: { residentId: string }) => assignment.residentId)).toEqual(["res_chief", "res_fellow"]);

    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: "res_fellow" })
      .expect(400);
  });

  it("keeps inherited block coverage when adding a second resident to one case", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "block", targetId: "block_chen_mon", residentId: "res_chief" })
      .expect(201);
    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: "res_fellow" })
      .expect(201);

    const scheduleResponse = await request(app)
      .get("/api/weeks/week_current/schedule")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    const scheduledCase = scheduleResponse.body.days
      .flatMap((day: { blocks: { cases: unknown[] }[] }) => day.blocks)
      .flatMap((block: { cases: { id: string; assignments: { residentId: string }[] }[] }) => block.cases)
      .find((surgeryCase: { id: string }) => surgeryCase.id === "case_chen_whipple");

    expect(scheduledCase.assignments.map((assignment: { residentId: string }) => assignment.residentId)).toEqual(["res_chief", "res_fellow"]);
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

  it("rejects stale optimistic concurrency versions", async () => {
    const { app, token } = await loginAs("admin");
    const stateResponse = await request(app).get("/api/state").set("authorization", `Bearer ${token}`).expect(200);
    const version = String(stateResponse.body.version);

    await request(app)
      .post("/api/entities/hospitals")
      .set("authorization", `Bearer ${token}`)
      .set("x-state-version", version)
      .send({ id: "hosp_first", name: "First Hospital", shortName: "FH", color: "#333333" })
      .expect(201);

    const staleResponse = await request(app)
      .post("/api/entities/hospitals")
      .set("authorization", `Bearer ${token}`)
      .set("x-state-version", version)
      .send({ id: "hosp_stale", name: "Stale Hospital", shortName: "SH", color: "#333333" })
      .expect(409);

    expect(staleResponse.body.currentVersion).toBeGreaterThan(Number(version));
  });

  it("cascades resident deletes out of assignments and coverage entries", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: "res_fellow" })
      .expect(201);
    await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-03", kind: "call", residentId: "res_fellow", callPosition: "senior", note: "", serviceLine: "Davies" })
      .expect(201);

    const deleteResponse = await request(app)
      .delete("/api/entities/residents/res_fellow")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(deleteResponse.body.assignments).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ residentId: "res_fellow" })])
    );
    expect(deleteResponse.body.coverageEntries).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ residentId: "res_fellow" })])
    );
  });

  it("rejects assignments for unknown residents", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: "res_missing" })
      .expect(400);
  });

  it("blocks obvious PHI-like text in scheduler write fields", async () => {
    const { app, token } = await loginAs("admin");

    await request(app)
      .post("/api/entities/cases")
      .set("authorization", `Bearer ${token}`)
      .send({
        id: "case_phi",
        blockId: "block_chen_mon",
        procedureLabel: "Patient John Doe appendectomy",
        durationMinutes: 90,
        priority: 2,
        tags: [],
        notes: "",
        order: 9
      })
      .expect(400);
  });
});
