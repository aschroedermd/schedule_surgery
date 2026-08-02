import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { createInitialState } from "./sampleData";
import { MemoryStateStore, normalizePlannerState } from "./store";
import { addDays, getCurrentMonday } from "../shared/date";
import { ServicePrivilege } from "../shared/types";
import { MemoryChatSettingsStore } from "./chatSettingsStore";

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
    process.env.OPENAI_PRIMARY_MODEL = "gpt-5.6-luna";
    process.env.OPENAI_FALLBACK_MODELS = "gpt-5.6-terra";
  });

  it("allows generated speech blob URLs in the content security policy", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));

    const response = await request(app).get("/api/healthz").expect(200);

    expect(response.headers["content-security-policy"]).toContain("media-src 'self' blob:");
  });

  it("matches usernames without regard to case while keeping passwords case-sensitive", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));

    await request(app)
      .post("/api/auth/login")
      .send({ username: "CBLUE", password: TEST_SEED_USER_PASSWORD })
      .expect(200)
      .expect((response) => expect(response.body.username).toBe("cblue"));

    await request(app)
      .post("/api/auth/login")
      .send({ username: "cBlue", password: TEST_SEED_USER_PASSWORD.toUpperCase() })
      .expect(401);
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

    const userResponse = await request(app)
      .post("/api/users")
      .set("x-api-key", "test-admin-api-key")
      .send({
        username: "apiuser",
        accountType: "user",
        servicePrivileges: { Berry: "edit" }
      })
      .expect(201);
    expect(userResponse.body).toEqual(
      expect.objectContaining({
        temporaryPassword: "schroeder1",
        user: expect.objectContaining({
          username: "apiuser",
          role: "viewer",
          mustChangePassword: true,
          servicePrivileges: expect.objectContaining({ Berry: "edit" })
        })
      })
    );
    await request(app)
      .post("/api/auth/login")
      .send({ username: "apiuser", password: "schroeder1" })
      .expect(200);

    const attendingResponse = await request(app)
      .post("/api/users")
      .set("x-api-key", "test-admin-api-key")
      .send({
        username: "apiattending",
        accountType: "attending",
        attendingId: "att_chen",
        temporaryPassword: "TempAccount-2026",
        servicePrivileges: { Davies: "edit" }
      })
      .expect(201);
    expect(attendingResponse.body).toEqual(
      expect.objectContaining({
        temporaryPassword: "TempAccount-2026",
        user: expect.objectContaining({
          username: "apiattending",
          role: "attending",
          attendingId: "att_chen",
          servicePrivileges: expect.objectContaining({ Davies: "edit" })
        })
      })
    );

    await request(app)
      .post("/api/users")
      .set("x-api-key", "test-admin-api-key")
      .send({ username: "apiadmin", role: "admin" })
      .expect(403);
  });

  it("seeds contacts and supports requests, approval, delegated adds, and API adds", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    const viewerToken = await loginOnApp(app, "cblue");

    const seeded = await request(app)
      .get("/api/contacts")
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(200);
    expect(seeded.body.contacts).toHaveLength(129);
    expect(seeded.body.contacts).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "PACU", phoneNumber: "(540) 981-7173" })])
    );
    expect(seeded.body.contacts).toEqual(
      expect.arrayContaining([expect.objectContaining({
        name: "Andrew Schroeder",
        phoneNumber: "(540) 204-5505",
        directoryType: "Residents",
        category: "PGY-5"
      })])
    );
    expect(seeded.body.contacts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "David Salzberg",
        phoneNumber: "(540) 855-0810",
        directoryType: "Faculty & Staff",
        category: "Faculty"
      }),
      expect.objectContaining({
        name: "Matthew Anderson",
        phoneNumber: "(540) 566-8297",
        directoryType: "Residents",
        category: "Plastic Surgery Residents"
      }),
      expect.objectContaining({
        name: "Erica Minnix - Plastics Program Manager / MIS Fellowship",
        alternatePhoneNumbers: ["(540) 581-4627"]
      })
    ]));

    const requested = await request(app)
      .post("/api/contacts")
      .set("authorization", `Bearer ${viewerToken}`)
      .send({ name: "OR Control Desk", phoneNumber: "(540) 555-0101", category: "Perioperative" })
      .expect(201);
    expect(requested.headers["x-contact-disposition"]).toBe("requested");
    expect(requested.body.contacts).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "OR Control Desk" })]));
    expect(requested.body.contactRequests).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: "pending", requesterUsername: "cblue" })])
    );

    const adminState = await request(app)
      .get("/api/state")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    const requestId = adminState.body.contactRequests[0].id as string;
    await request(app)
      .post(`/api/contact-requests/${requestId}/approve`)
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.contacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: "OR Control Desk" })]));
      });

    const rejectedRequest = await request(app)
      .post("/api/contacts")
      .set("authorization", `Bearer ${viewerToken}`)
      .send({ name: "Obsolete Desk", phoneNumber: "(540) 555-0199", category: "Perioperative" })
      .expect(201);
    const rejectedRequestId = rejectedRequest.body.contactRequests.find(
      (item: { contact: { name: string } }) => item.contact.name === "Obsolete Desk"
    ).id as string;
    await request(app)
      .post(`/api/contact-requests/${rejectedRequestId}/reject`)
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200)
      .expect((response) => {
        expect(response.body.contactRequests).toEqual(
          expect.arrayContaining([expect.objectContaining({ id: rejectedRequestId, status: "rejected" })])
        );
        expect(response.body.contacts).not.toEqual(expect.arrayContaining([expect.objectContaining({ name: "Obsolete Desk" })]));
      });

    await request(app)
      .patch("/api/users/cblue")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ canAddContacts: true })
      .expect(200)
      .expect((response) => expect(response.body.user.canAddContacts).toBe(true));

    const delegated = await request(app)
      .post("/api/contacts")
      .set("authorization", `Bearer ${viewerToken}`)
      .send({ name: "Transfer Center", phoneNumber: "(540) 555-0102", category: "Ancillary Services" })
      .expect(201);
    expect(delegated.headers["x-contact-disposition"]).toBe("added");
    expect(delegated.body.contacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Transfer Center" })]));

    const apiAdded = await request(app)
      .post("/api/contacts")
      .set("x-api-key", "test-admin-api-key")
      .send({ name: "Bed Board", phoneNumber: "(540) 555-0103", category: "Inpatient Units" })
      .expect(201);
    expect(apiAdded.headers["x-contact-disposition"]).toBe("added");
    expect(apiAdded.body.contacts).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Bed Board" })]));
  });

  it("migrates legacy contacts and adds every seeded directory", () => {
    const base = createInitialState();
    const legacyHospitalContacts = base.contacts
      .filter((contact) => contact.directoryType === "Hospital")
      .map(({ directoryType: _directoryType, ...contact }) => contact);
    const normalized = normalizePlannerState({
      ...base,
      contacts: legacyHospitalContacts as typeof base.contacts
    });

    expect(normalized.contacts).toHaveLength(129);
    expect(normalized.contacts.find((contact) => contact.name === "PACU")?.directoryType).toBe("Hospital");
    expect(normalized.contacts.find((contact) => contact.name === "Adedayo Adeleke")).toMatchObject({
      phoneNumber: "(540) 759-9761",
      directoryType: "Residents",
      category: "PGY-1"
    });
    expect(normalized.contacts.find((contact) => contact.name === "David Salzberg")?.directoryType).toBe("Faculty & Staff");
  });

  it("serves the linked wiki to users and restricts wiki edits to admins", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    const viewerToken = await loginOnApp(app, "cblue");

    const search = await request(app)
      .get("/api/wiki?query=FMH%20coverage")
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(200);
    expect(search.body.articles).toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "hospital-fmh" })])
    );

    const article = await request(app)
      .get("/api/wiki/hospital-fmh")
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(200);
    expect(article.body).toEqual(
      expect.objectContaining({
        article: expect.objectContaining({ slug: "hospital-fmh" }),
        backlinks: expect.arrayContaining([expect.objectContaining({ slug: "hospitals" })])
      })
    );

    const newArticle = {
      slug: "workflow-test",
      title: "Test Workflow",
      summary: "Verified local test workflow.",
      body: "For patient care, use the verified local workflow or call the office at 540-555-0188.",
      category: "workflow",
      aliases: ["test workflow"],
      tags: ["workflow"],
      links: ["workflows"],
      owner: "Residency program",
      reviewedAt: "2026-08-01"
    };
    await request(app)
      .post("/api/wiki")
      .set("authorization", `Bearer ${viewerToken}`)
      .send(newArticle)
      .expect(403);
    await request(app)
      .post("/api/wiki")
      .set("authorization", `Bearer ${adminToken}`)
      .send(newArticle)
      .expect(201)
      .expect((response) => expect(response.body.article.slug).toBe("workflow-test"));
    await request(app)
      .post("/api/wiki")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ ...newArticle, slug: "workflow-private-draft", status: "draft" })
      .expect(201);
    await request(app)
      .get("/api/wiki/workflow-private-draft")
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(404);
    const viewerState = await request(app)
      .get("/api/state")
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(200);
    expect(viewerState.body.wikiArticles).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "workflow-private-draft" })])
    );
    expect(viewerState.body.wikiSources).toEqual([]);
    await request(app)
      .post("/api/wiki")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ ...newArticle, slug: "unsafe-wiki", body: "MRN: 1234567" })
      .expect(400);
    await request(app)
      .patch("/api/wiki/workflow-test")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ summary: "Updated verified workflow." })
      .expect(200)
      .expect((response) => expect(response.body.article.summary).toBe("Updated verified workflow."));
    await request(app)
      .delete("/api/wiki/workflow-test")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    await request(app)
      .get("/api/wiki/workflow-test")
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(404);
  });

  it("previews and transactionally syncs sourced clinical wiki knowledge", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    const viewerToken = await loginOnApp(app, "cblue");
    const exported = await request(app)
      .get("/api/wiki/export")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(exported.body).toEqual(expect.objectContaining({ formatVersion: 1, wikiRevision: 1 }));
    expect(exported.body.articles[0]).toEqual(expect.objectContaining({ status: "published", revision: 1 }));

    const source = {
      id: "src-nussbaum-review",
      title: "Dr. Nussbaum preference review",
      sourceType: "direct-review",
      author: "Dr. Nussbaum",
      capturedAt: "2026-08-01T12:00:00.000Z",
      effectiveDate: "2026-08-01",
      contentHash: "a".repeat(64)
    };
    const article = {
      slug: "attending-nussbaum-laparoscopic-cholecystectomy",
      title: "Dr. Nussbaum — Laparoscopic Cholecystectomy",
      summary: "Reviewed operative preferences for laparoscopic cholecystectomy.",
      body: "## Applicability\n\nReviewed local preference content.",
      category: "attending",
      status: "published",
      authority: "attending-preference",
      aliases: ["Nussbaum lap chole"],
      tags: ["operative-preference"],
      links: ["attendings"],
      sourceRefs: [{ sourceId: source.id, locator: "Port placement section" }],
      owner: "Dr. Nussbaum",
      reviewedBy: "Dr. Nussbaum",
      reviewedAt: "2026-08-01",
      reviewDueAt: "2027-08-01"
    };
    const syncPayload = { baseRevision: exported.body.wikiRevision, sources: [source], articles: [article] };
    const preview = await request(app)
      .post("/api/wiki/sync/preview")
      .set("authorization", `Bearer ${adminToken}`)
      .send(syncPayload)
      .expect(200);
    expect(preview.body).toEqual(expect.objectContaining({
      currentRevision: 1,
      summary: expect.objectContaining({ created: 2 }),
      validation: expect.objectContaining({ valid: true })
    }));

    const applied = await request(app)
      .post("/api/wiki/sync/apply")
      .set("authorization", `Bearer ${adminToken}`)
      .send(syncPayload)
      .expect(200);
    expect(applied.body).toEqual(expect.objectContaining({ applied: true, wikiRevision: 2 }));
    await request(app)
      .post("/api/wiki/sync/apply")
      .set("authorization", `Bearer ${adminToken}`)
      .send(syncPayload)
      .expect(409);

    const changes = await request(app)
      .get("/api/wiki/changes?after=1")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(changes.body.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ entity: "source", sourceId: source.id, revision: 2 }),
      expect.objectContaining({ entity: "article", slug: article.slug, revision: 2 })
    ]));
    await request(app)
      .get(`/api/wiki/${article.slug}`)
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(200)
      .expect((response) => expect(response.body.article.sourceRefs[0].sourceId).toBe(source.id));
  });

  it("lets the admin API key reset passwords and manage chat models", async () => {
    const chatSettingsStore = new MemoryChatSettingsStore();
    const app = createApp(new MemoryStateStore(createInitialState()), { chatSettingsStore });

    await request(app)
      .patch("/api/users/cblue/password")
      .set("x-api-key", "test-viewer-api-key")
      .send({ temporaryPassword: "DeniedReset-2026" })
      .expect(403);

    await request(app)
      .patch("/api/users/admin/password")
      .set("x-api-key", "test-admin-api-key")
      .send({ temporaryPassword: "NoPrivilegeEscalation-2026" })
      .expect(403);

    const chosenReset = await request(app)
      .patch("/api/users/cblue/password")
      .set("x-api-key", "test-admin-api-key")
      .send({ temporaryPassword: "TempReset-2026" })
      .expect(200);
    expect(chosenReset.body).toEqual(
      expect.objectContaining({
        temporaryPassword: "TempReset-2026",
        user: expect.objectContaining({ username: "cblue", mustChangePassword: true })
      })
    );
    expect(chosenReset.body).not.toHaveProperty("users");
    await request(app)
      .post("/api/auth/login")
      .send({ username: "cblue", password: "TempReset-2026" })
      .expect(200);

    const generatedReset = await request(app)
      .patch("/api/users/tcao/password")
      .set("x-api-key", "test-admin-api-key")
      .send({})
      .expect(200);
    expect(generatedReset.body.temporaryPassword).toMatch(/^[A-Za-z0-9]{14}$/);

    await request(app)
      .get("/api/admin/chat-settings")
      .set("x-api-key", "test-viewer-api-key")
      .expect(403);

    const updated = await request(app)
      .patch("/api/admin/chat-settings")
      .set("x-api-key", "test-admin-api-key")
      .send({
        chatProvider: "openrouter",
        primaryModel: "deepseek/deepseek-v4-flash-0731",
        fallbackModels: ["google/gemma-3-27b-it"],
        voiceModel: "fish-audio/s2-pro",
        voiceName: "Custom Narrator",
        elevenLabsModel: "eleven_flash_v2_5",
        elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"]
      })
      .expect(200);
    expect(updated.body).toEqual(
      expect.objectContaining({
        chatProvider: "openrouter",
        primaryModel: "deepseek/deepseek-v4-flash-0731",
        fallbackModels: ["google/gemma-3-27b-it"],
        transcriptionModel: "nvidia/parakeet-tdt-0.6b-v3",
        voiceModel: "fish-audio/s2-pro",
        voiceName: "Custom Narrator",
        elevenLabsModel: "eleven_flash_v2_5",
        elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"]
      })
    );

    await request(app)
      .patch("/api/admin/chat-settings")
      .set("x-api-key", "test-admin-api-key")
      .send({ primaryModel: "not-a-model-id" })
      .expect(400);

    const current = await request(app)
      .get("/api/admin/chat-settings")
      .set("x-api-key", "test-admin-api-key")
      .expect(200);
    expect(current.body.primaryModel).toBe("deepseek/deepseek-v4-flash-0731");

    const switchedProvider = await request(app)
      .patch("/api/admin/chat-settings")
      .set("x-api-key", "test-admin-api-key")
      .send({ chatProvider: "openai" })
      .expect(200);
    expect(switchedProvider.body).toMatchObject({
      chatProvider: "openai",
      primaryModel: "gpt-5.6-luna",
      fallbackModels: ["gpt-5.6-terra"]
    });
  });

  it("gives every user 12 spoken responses and lets the admin API change and reset a user's quota", async () => {
    const store = new MemoryStateStore(createInitialState());
    const app = createApp(store);
    const viewerToken = await loginOnApp(app, "cblue");
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");

    const viewerVoiceQuota = await request(app)
      .get("/api/chat/voice/quota")
      .set("authorization", `Bearer ${viewerToken}`)
      .expect(200);
    expect(viewerVoiceQuota.body).toEqual({ used: 0, remaining: 12, limit: 12, unlimited: false });

    const adminVoiceQuota = await request(app)
      .get("/api/chat/voice/quota")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(adminVoiceQuota.body).toEqual({ used: 0, remaining: 12, limit: 12, unlimited: false });

    const adminChatQuota = await request(app)
      .get("/api/chat/quota")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(adminChatQuota.body).toMatchObject({ used: 0, remaining: 20, limit: 20, unlimited: true });

    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    const previousElevenLabsKey = process.env.ELEVENLABS_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } }))
    );
    try {
      for (let use = 1; use <= 3; use += 1) {
        const speech = await request(app)
          .post("/api/chat/speech")
          .set("authorization", `Bearer ${viewerToken}`)
          .send({ input: `Spoken answer ${use}`, voicePreset: ((use - 1) % 4) + 1 })
          .expect(200);
        expect(speech.headers["x-voice-remaining"]).toBe(String(12 - use));
        expect(speech.headers["x-voice-preset"]).toBe(String(((use - 1) % 4) + 1));
      }

      const currentQuota = await request(app)
        .get("/api/admin/users/cblue/voice-quota")
        .set("x-api-key", "test-admin-api-key")
        .expect(200);
      expect(currentQuota.body).toMatchObject({ username: "cblue", used: 3, remaining: 9, limit: 12 });

      await request(app)
        .get("/api/admin/users/cblue/voice-quota")
        .set("x-api-key", "test-viewer-api-key")
        .expect(403);

      const loweredQuota = await request(app)
        .patch("/api/admin/users/cblue/voice-quota")
        .set("x-api-key", "test-admin-api-key")
        .send({ limit: 3 })
        .expect(200);
      expect(loweredQuota.body).toMatchObject({ used: 3, remaining: 0, limit: 3 });

      await request(app)
        .post("/api/chat/speech")
        .set("authorization", `Bearer ${viewerToken}`)
        .send({ input: "One too many", voicePreset: 4 })
        .expect(429)
        .expect(({ body }) => expect(body.error).toBe("Voice limit reached"));

      const resetQuota = await request(app)
        .patch("/api/admin/users/cblue/voice-quota")
        .set("x-api-key", "test-admin-api-key")
        .send({ limit: 7, resetUsed: true })
        .expect(200);
      expect(resetQuota.body).toMatchObject({ used: 0, remaining: 7, limit: 7 });

      await request(app)
        .get("/api/chat/voice/quota")
        .set("authorization", `Bearer ${viewerToken}`)
        .expect(200)
        .expect(({ body }) => expect(body).toEqual({ used: 0, remaining: 7, limit: 7, unlimited: false }));
    } finally {
      vi.unstubAllGlobals();
      if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
      if (previousElevenLabsKey === undefined) delete process.env.ELEVENLABS_API_KEY;
      else process.env.ELEVENLABS_API_KEY = previousElevenLabsKey;
    }
  });

  it("records login activity with user names and hides activity from non-admin state", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    const viewerToken = await loginOnApp(app, "cblue");

    const adminState = await request(app).get("/api/state").set("authorization", `Bearer ${adminToken}`).expect(200);
    expect(adminState.body.activityEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          activityType: "login",
          actorRole: "viewer",
          actorUsername: "cblue",
          actorName: "Christian Blue",
          action: "logged in"
        })
      ])
    );

    const viewerState = await request(app).get("/api/state").set("authorization", `Bearer ${viewerToken}`).expect(200);
    expect(viewerState.body.activityEvents).toEqual([]);
  });

  it("creates a case-assignable roster entry for medical-student accounts", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));

    const created = await request(app)
      .post("/api/users")
      .set("x-api-key", "test-admin-api-key")
      .send({
        username: "medstudent1",
        displayName: "Avery Student",
        accountType: "medical-student",
        temporaryPassword: "TempStudent-2026"
      })
      .expect(201);

    expect(created.body.user).toEqual(expect.objectContaining({ username: "medstudent1", role: "medical-student" }));

    const stateResponse = await request(app).get("/api/state").set("x-api-key", "test-admin-api-key").expect(200);
    const medicalStudent = stateResponse.body.residents.find((resident: { username?: string }) => resident.username === "medstudent1");
    expect(medicalStudent).toEqual(
      expect.objectContaining({ name: "Avery Student", trainingLevel: "Medical Student" })
    );

    await request(app)
      .post("/api/assignments")
      .set("x-api-key", "test-admin-api-key")
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: medicalStudent.id })
      .expect(201);

    await request(app)
      .post("/api/assignments")
      .set("x-api-key", "test-admin-api-key")
      .send({ kind: "block", targetId: "block_chen_mon", residentId: medicalStudent.id })
      .expect(400);

    const login = await request(app)
      .post("/api/auth/login")
      .send({ username: "medstudent1", password: "TempStudent-2026" })
      .expect(200);
    expect(login.body).toEqual(expect.objectContaining({ role: "medical-student" }));
  });

  it("lets linked residents award one weekly gold star without exposing other givers to viewers", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    const giverToken = await loginOnApp(app, "cblue");
    const viewerToken = await loginOnApp(app, "tcao");

    await request(app)
      .post("/api/gold-stars")
      .set("authorization", `Bearer ${giverToken}`)
      .send({ recipientResidentId: "res_blue" })
      .expect(400);

    const awardResponse = await request(app)
      .post("/api/gold-stars")
      .set("authorization", `Bearer ${giverToken}`)
      .send({ recipientResidentId: "res_fellow" })
      .expect(201);

    expect(awardResponse.body.goldStarAwards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          weekStartDate: getCurrentMonday(),
          giverResidentId: "res_blue",
          recipientResidentId: "res_fellow"
        })
      ])
    );

    await request(app)
      .post("/api/gold-stars")
      .set("authorization", `Bearer ${giverToken}`)
      .send({ recipientResidentId: "res_chief" })
      .expect(400);

    const viewerState = await request(app).get("/api/state").set("authorization", `Bearer ${viewerToken}`).expect(200);
    expect(viewerState.body.goldStarAwards[0]).toEqual(
      expect.objectContaining({
        weekStartDate: getCurrentMonday(),
        recipientResidentId: "res_fellow"
      })
    );
    expect(viewerState.body.goldStarAwards[0].giverResidentId).toBeUndefined();

    const adminState = await request(app).get("/api/state").set("authorization", `Bearer ${adminToken}`).expect(200);
    expect(adminState.body.goldStarAwards[0]).toEqual(
      expect.objectContaining({
        giverResidentId: "res_blue",
        recipientResidentId: "res_fellow"
      })
    );
    expect(adminState.body.activityEvents[0]).toEqual(
      expect.objectContaining({
        activityType: "resident",
        action: "awarded gold star"
      })
    );
  });

  it("lets a browser account without a resident or attending link award one weekly gold star", async () => {
    const { app, token: adminToken } = await loginAs("admin");
    await request(app)
      .post("/api/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({
        username: "facultyguest",
        displayName: "Faculty Guest",
        password: "faculty-guest-password"
      })
      .expect(201);

    const guestToken = await loginOnApp(app, "facultyguest", "faculty-guest-password");
    const awardResponse = await request(app)
      .post("/api/gold-stars")
      .set("authorization", `Bearer ${guestToken}`)
      .send({ recipientResidentId: "res_fellow" })
      .expect(201);

    expect(awardResponse.body.goldStarAwards[0]).toEqual(
      expect.objectContaining({
        giverUsername: "facultyguest",
        recipientResidentId: "res_fellow"
      })
    );
    expect(awardResponse.body.goldStarAwards[0]).not.toHaveProperty("giverResidentId");

    const reloadedState = await request(app).get("/api/state").set("authorization", `Bearer ${guestToken}`).expect(200);
    expect(reloadedState.body.goldStarAwards[0]).toEqual(
      expect.objectContaining({ giverUsername: "facultyguest", recipientResidentId: "res_fellow" })
    );

    await request(app)
      .post("/api/gold-stars")
      .set("authorization", `Bearer ${guestToken}`)
      .send({ recipientResidentId: "res_chief" })
      .expect(400);
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
    expect(createResponse.body.temporaryPassword).toBe("schroeder1");
    expect(createResponse.body.user).toEqual(
      expect.objectContaining({
        username: "jsmith",
        mustChangePassword: true,
        servicePrivileges: expect.objectContaining({ Berry: "request", Davies: "view" })
      })
    );

    const chosenTemporaryPassword = "Welcome-2026";
    const chosenPasswordResponse = await request(app)
      .post("/api/users")
      .set("authorization", `Bearer ${token}`)
      .send({ username: "tempuser", temporaryPassword: chosenTemporaryPassword })
      .expect(201);
    expect(chosenPasswordResponse.body).toEqual(
      expect.objectContaining({ temporaryPassword: chosenTemporaryPassword, user: expect.objectContaining({ mustChangePassword: true }) })
    );
    await request(app)
      .post("/api/auth/login")
      .send({ username: "tempuser", password: chosenTemporaryPassword })
      .expect(200);

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
          temporaryPassword: "schroeder1"
        }),
        expect.objectContaining({
          user: expect.objectContaining({ username: "bulktwo", displayName: "Bulk Two" }),
          temporaryPassword: "schroeder1"
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

  it("lets a temporary-password user skip the password change for the current session only", async () => {
    const { app, token: adminToken } = await loginAs("admin");
    const temporaryPassword = "Keep-This-Temporary-Password";
    await request(app)
      .post("/api/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ username: "skipuser", temporaryPassword })
      .expect(201);

    const firstLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "skipuser", password: temporaryPassword })
      .expect(200);
    expect(firstLogin.body.mustChangePassword).toBe(true);
    await request(app).get("/api/state").set("authorization", `Bearer ${firstLogin.body.token}`).expect(403);

    const skipResponse = await request(app)
      .post("/api/me/password/skip")
      .set("authorization", `Bearer ${firstLogin.body.token}`)
      .expect(200);
    await request(app).get("/api/session").set("authorization", `Bearer ${skipResponse.body.token}`).expect(200).expect((response) => {
      expect(response.body.mustChangePassword).toBe(false);
    });
    await request(app).get("/api/state").set("authorization", `Bearer ${skipResponse.body.token}`).expect(200);

    const secondLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "skipuser", password: temporaryPassword })
      .expect(200);
    expect(secondLogin.body.mustChangePassword).toBe(true);
    await request(app).get("/api/state").set("authorization", `Bearer ${secondLogin.body.token}`).expect(403);

    const changedPassword = "A-new-password-2026";
    await request(app)
      .patch("/api/me/password")
      .set("authorization", `Bearer ${secondLogin.body.token}`)
      .send({ currentPassword: temporaryPassword, nextPassword: changedPassword })
      .expect(200)
      .expect((response) => expect(response.body.mustChangePassword).toBe(false));

    const finalLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "skipuser", password: changedPassword })
      .expect(200);
    expect(finalLogin.body.mustChangePassword).toBe(false);
    await request(app).get("/api/state").set("authorization", `Bearer ${finalLogin.body.token}`).expect(200);
  });

  it("lets a linked attending manage only their own cases and award a resident star", async () => {
    const { app, token: adminToken } = await loginAs("admin");
    await request(app)
      .post("/api/users")
      .set("authorization", `Bearer ${adminToken}`)
      .send({
        username: "drchen",
        displayName: "Dr. Chen",
        role: "attending",
        attendingId: "att_chen",
        password: "attending-password"
      })
      .expect(201);

    const attendingLogin = await request(app)
      .post("/api/auth/login")
      .send({ username: "drchen", password: "attending-password" })
      .expect(200);
    expect(attendingLogin.body).toEqual(expect.objectContaining({ role: "attending", attendingId: "att_chen" }));
    const attendingToken = attendingLogin.body.token as string;

    await request(app)
      .patch("/api/entities/attendingBlocks/block_chen_mon")
      .set("authorization", `Bearer ${attendingToken}`)
      .send({ firstCaseStartTime: "08:00" })
      .expect(200);
    await request(app)
      .patch("/api/entities/cases/case_chen_whipple")
      .set("authorization", `Bearer ${attendingToken}`)
      .send({ durationMinutes: 150 })
      .expect(200);
    await request(app)
      .patch("/api/entities/cases/case_patel_bypass")
      .set("authorization", `Bearer ${attendingToken}`)
      .send({ durationMinutes: 150 })
      .expect(403);

    await request(app)
      .post("/api/gold-stars")
      .set("authorization", `Bearer ${attendingToken}`)
      .send({ recipientResidentId: "res_fellow" })
      .expect(201);
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
    const alayna = response.body.residents.find((resident: { id: string ;}) => resident.id === "res_external_alayna_arnholt");
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
    const adeleke = stateResponse.body.residents.find((resident: { id: string ;}) => resident.id === "res_fellow");
    const nextSchedule = adeleke.rotationSchedule.map((rotation: { blockNumber: number ;}) =>
      rotation.blockNumber === 3 ? { ...rotation, service: "Davies" } : rotation
    );

    const updateResponse = await request(app)
      .patch("/api/entities/residents/res_fellow")
      .set("authorization", `Bearer ${token}`)
      .send({ rotationSchedule: nextSchedule })
      .expect(200);
    const updated = updateResponse.body.residents.find((resident: { id: string ;}) => resident.id === "res_fellow");

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
    expect(response.body.paths["/api/wiki/export"].get).toBeDefined();
    expect(response.body.paths["/api/wiki/sync/preview"].post).toBeDefined();
    expect(response.body.paths["/api/wiki/sync/apply"].post).toBeDefined();
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
    expect(approvalResponse.body.coverageRequests.find((item: { id: string ;}) => item.id === requestId)).toEqual(
      expect.objectContaining({ status: "approved" })
    );
  });

  it("authorizes calendar mutations from the stored entry service instead of a client-supplied service", async () => {
    const state = createInitialState();
    state.coverageEntries.push({
      id: "berry_entry_auth_test",
      date: state.weeks[0].startDate,
      kind: "note",
      serviceLine: "Berry",
      note: "Berry staffing note",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z"
    });
    const store = new MemoryStateStore(state);
    const app = createApp(store);
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    await grantPrivilege(app, adminToken, "cblue", "Davies", "edit");
    const editorToken = await loginOnApp(app, "cblue");

    await request(app)
      .delete("/api/coverage-entries/berry_entry_auth_test?service=Davies")
      .set("authorization", `Bearer ${editorToken}`)
      .expect(403);

    expect((await store.load()).coverageEntries).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "berry_entry_auth_test", serviceLine: "Berry" })])
    );
  });

  it("previews and confirms direct assistant edits while routing request-only users through approval", async () => {
    const store = new MemoryStateStore(createInitialState());
    const chatSettingsStore = new MemoryChatSettingsStore({
      chatProvider: "openrouter",
      primaryModel: "deepseek/deepseek-v4-flash-0731",
      fallbackModels: [],
      transcriptionModel: "nvidia/parakeet-tdt-0.6b-v3",
      voiceModel: "fish-audio/s2.1-pro-free:free",
      voiceName: "David Attenborough Dramatic",
      elevenLabsModel: "eleven_multilingual_v2",
      elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"],
      updatedAt: null
    });
    const app = createApp(store, { chatSettingsStore });
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    await grantPrivilege(app, adminToken, "aschroeder", "Davies", "edit");
    await grantPrivilege(app, adminToken, "aswaak", "Davies", "request");
    const editorToken = await loginOnApp(app, "aschroeder");
    const requesterToken = await loginOnApp(app, "aswaak");
    let assistantArguments: Record<string, unknown> = {
      action_type: "case_coverage",
      operation: "create",
      date: null,
      target_date: null,
      service: null,
      resident_name: "Adedayo Adeleke",
      target_resident_name: null,
      attending_name: null,
      procedure: null,
      entry_kind: null,
      call_position: null,
      case_id: "case_chen_whipple",
      assignment_id: null,
      entry_id: null,
      request_id: null,
      requested_order: null,
      note: null
    };
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      model: "deepseek/deepseek-v4-flash-0731",
      choices: [{ message: { role: "assistant", content: null, tool_calls: [{
        id: "prepare_case_coverage",
        type: "function",
        function: {
          name: "prepare_schedule_action",
          arguments: JSON.stringify(assistantArguments)
        }
      }] } }]
    })));

    try {
      const directPreview = await request(app)
        .post("/api/chat")
        .set("authorization", `Bearer ${editorToken}`)
        .send({ serviceLine: "Davies", messages: [{ role: "user", content: "Put Adeleke on the Whipple" }] })
        .expect(200);
      expect(directPreview.body.interaction).toMatchObject({
        options: [expect.objectContaining({ label: "Confirm change" }), expect.objectContaining({ label: "Cancel" })]
      });
      const directToken = directPreview.body.interaction.actionToken as string;
      const directCommit = await request(app)
        .post(`/api/chat/actions/${encodeURIComponent(directToken)}/commit`)
        .set("authorization", `Bearer ${editorToken}`)
        .expect(200);
      expect(directCommit.body.message).toContain("Case coverage updated");
      await request(app)
        .post(`/api/chat/actions/${encodeURIComponent(directToken)}/commit`)
        .set("authorization", `Bearer ${editorToken}`)
        .expect(200);
      expect((await store.load()).assignments.filter((assignment) =>
        assignment.kind === "case" && assignment.targetId === "case_chen_whipple" && assignment.residentId === "res_fellow"
      )).toHaveLength(1);

      assistantArguments = { ...assistantArguments, resident_name: "Jessica Bradley" };
      const requestPreview = await request(app)
        .post("/api/chat")
        .set("authorization", `Bearer ${requesterToken}`)
        .send({ serviceLine: "Davies", messages: [{ role: "user", content: "Request Bradley for the Whipple" }] })
        .expect(200);
      expect(requestPreview.body.interaction.options[0].label).toBe("Submit request");
      const requestToken = requestPreview.body.interaction.actionToken as string;
      await request(app)
        .post(`/api/chat/actions/${encodeURIComponent(requestToken)}/commit`)
        .set("authorization", `Bearer ${requesterToken}`)
        .expect(200)
        .expect(({ body }) => expect(body.message).toContain("Request submitted"));

      const pending = (await store.load()).coverageRequests.find((item) => item.requestType === "assignment-change");
      expect(pending).toMatchObject({
        status: "pending",
        serviceLine: "Davies",
        requestedAssignmentChange: { kind: "case", targetId: "case_chen_whipple", residentId: "res_bradley" }
      });
      await request(app)
        .post(`/api/coverage-requests/${pending!.id}/approve`)
        .set("authorization", `Bearer ${editorToken}`)
        .expect(200);
      expect((await store.load()).assignments).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "case", targetId: "case_chen_whipple", residentId: "res_bradley" })
      ]));

      assistantArguments = {
        ...assistantArguments,
        action_type: "case_order",
        operation: "update",
        resident_name: null,
        case_id: "case_chen_whipple",
        requested_order: 2
      };
      const orderPreview = await request(app)
        .post("/api/chat")
        .set("authorization", `Bearer ${editorToken}`)
        .send({ serviceLine: "Davies", messages: [{ role: "user", content: "Move the Whipple to second" }] })
        .expect(200);
      await request(app)
        .post(`/api/chat/actions/${encodeURIComponent(orderPreview.body.interaction.actionToken)}/commit`)
        .set("authorization", `Bearer ${editorToken}`)
        .expect(200);
      expect((await store.load()).cases.find((surgeryCase) => surgeryCase.id === "case_chen_whipple")?.order).toBe(1);

      assistantArguments = {
        ...assistantArguments,
        action_type: "call_swap",
        operation: "swap",
        date: "2026-07-24",
        target_date: "2026-07-11",
        resident_name: null,
        target_resident_name: "Adedayo Adeleke",
        case_id: null
      };
      const tradePreview = await request(app)
        .post("/api/chat")
        .set("authorization", `Bearer ${requesterToken}`)
        .send({ serviceLine: "Davies", messages: [{ role: "user", content: "Swap my July 24 call with Adeleke's July 11 call" }] })
        .expect(200);
      expect(tradePreview.body.interaction.options[0].label).toBe("Submit request");
      await request(app)
        .post(`/api/chat/actions/${encodeURIComponent(tradePreview.body.interaction.actionToken)}/commit`)
        .set("authorization", `Bearer ${requesterToken}`)
        .expect(200);
      expect((await store.load()).coverageRequests).toEqual(expect.arrayContaining([
        expect.objectContaining({
          requestType: "resident-trade",
          requesterResidentId: "res_swaak",
          targetResidentId: "res_fellow",
          entryId: "cover_2026_07_24_swaak_call",
          swapEntryId: "cover_2026_07_11_adeleke_call",
          status: "pending"
        })
      ]));

      assistantArguments = {
        ...assistantArguments,
        action_type: "case_order",
        operation: "update",
        date: null,
        target_date: null,
        target_resident_name: null,
        case_id: "case_chen_whipple",
        requested_order: 1
      };
      const stalePreview = await request(app)
        .post("/api/chat")
        .set("authorization", `Bearer ${editorToken}`)
        .send({ serviceLine: "Davies", messages: [{ role: "user", content: "Move the Whipple back to first" }] })
        .expect(200);
      await request(app)
        .post("/api/entities/hospitals")
        .set("authorization", `Bearer ${adminToken}`)
        .send({ id: "hospital_action_conflict", name: "Action Conflict Hospital", shortName: "ACH", color: "#111111" })
        .expect(201);
      await request(app)
        .post(`/api/chat/actions/${encodeURIComponent(stalePreview.body.interaction.actionToken)}/commit`)
        .set("authorization", `Bearer ${editorToken}`)
        .expect(409)
        .expect(({ body }) => expect(body.error).toContain("schedule changed after this preview"));
    } finally {
      vi.unstubAllGlobals();
      if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    }
  });

  it("lets service editors manage OR and clinic schedule rows only for edited services", async () => {
    const { app, token: adminToken } = await loginAs("admin");
    await grantPrivilege(app, adminToken, "aschroeder", "Davies", "edit");
    const editorToken = await loginOnApp(app, "aschroeder");
    const viewerToken = await loginOnApp(app, "aswaak");

    const daviesBlock = {
      id: "block_editor_davies",
      weekId: "week_current",
      date: "2026-07-06",
      attendingId: "att_chen",
      hospitalId: "hosp_main",
      firstCaseStartTime: "07:30",
      notes: ""
    };

    await request(app)
      .post("/api/entities/attendingBlocks")
      .set("authorization", `Bearer ${viewerToken}`)
      .send(daviesBlock)
      .expect(403);

    await request(app)
      .post("/api/entities/attendingBlocks")
      .set("authorization", `Bearer ${editorToken}`)
      .send(daviesBlock)
      .expect(201);

    await request(app)
      .post("/api/entities/cases")
      .set("authorization", `Bearer ${editorToken}`)
      .send({
        id: "case_editor_davies",
        blockId: daviesBlock.id,
        procedureLabel: "Laparoscopic cholecystectomy",
        durationMinutes: 90,
        priority: 2,
        tags: ["general surgery"],
        notes: "",
        order: 0
      })
      .expect(201);

    await request(app)
      .post("/api/entities/clinicSessions")
      .set("authorization", `Bearer ${editorToken}`)
      .send({
        id: "clinic_editor_davies",
        weekId: "week_current",
        date: "2026-07-07",
        startTime: "13:00",
        endTime: "17:00",
        attendingId: "att_chen",
        service: "Davies",
        location: "University Hospital Clinic",
        hospitalId: "hosp_main",
        capacity: 1,
        isProcedure: true
      })
      .expect(201);

    const casePatch = await request(app)
      .patch("/api/entities/cases/case_editor_davies")
      .set("authorization", `Bearer ${editorToken}`)
      .send({ procedureLabel: "Updated lap chole", durationMinutes: 100 })
      .expect(200);
    expect(casePatch.body.cases).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "case_editor_davies", procedureLabel: "Updated lap chole", durationMinutes: 100 })])
    );

    await request(app)
      .patch("/api/entities/clinicSessions/clinic_editor_davies")
      .set("authorization", `Bearer ${editorToken}`)
      .send({ service: "Berry", attendingId: "att_nussbaum" })
      .expect(403);

    await request(app)
      .post("/api/entities/attendingBlocks")
      .set("authorization", `Bearer ${editorToken}`)
      .send({ ...daviesBlock, id: "block_editor_berry", attendingId: "att_nussbaum" })
      .expect(403);

    await request(app)
      .delete("/api/entities/cases/case_editor_davies")
      .set("authorization", `Bearer ${editorToken}`)
      .expect(200);
    await request(app)
      .delete("/api/entities/clinicSessions/clinic_editor_davies")
      .set("authorization", `Bearer ${editorToken}`)
      .expect(200);
    const deleteBlock = await request(app)
      .delete("/api/entities/attendingBlocks/block_editor_davies")
      .set("authorization", `Bearer ${editorToken}`)
      .expect(200);
    expect(deleteBlock.body.attendingBlocks.map((block: { id: string ;}) => block.id)).not.toContain(daviesBlock.id);
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

  it("stores one same-attending or split day/night attending call assignment per weekend date", async () => {
    const { app, token } = await loginAs("admin");

    const allDayResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-03",
        kind: "attending-call",
        dayAttendingId: "att_chen",
        nightAttendingId: "att_chen",
        serviceLine: "Davies"
      })
      .expect(201);

    const allDayEntry = allDayResponse.body.coverageEntries.find(
      (entry: { date: string; kind: string }) => entry.date === "2026-07-03" && entry.kind === "attending-call"
    );
    expect(allDayEntry).toEqual(
      expect.objectContaining({
        dayAttendingId: "att_chen",
        nightAttendingId: "att_chen"
      })
    );

    const splitResponse = await request(app)
      .patch(`/api/coverage-entries/${allDayEntry.id}`)
      .set("authorization", `Bearer ${token}`)
      .send({ nightAttendingId: "att_patel", serviceLine: "Davies" })
      .expect(200);
    expect(splitResponse.body.coverageEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: allDayEntry.id,
          dayAttendingId: "att_chen",
          nightAttendingId: "att_patel"
        })
      ])
    );

    const duplicateResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-03",
        kind: "attending-call",
        dayAttendingId: "att_morris",
        nightAttendingId: "att_morris",
        serviceLine: "Davies"
      })
      .expect(400);
    expect(duplicateResponse.body.error).toMatch(/already listed/i);

    const incompleteResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-04",
        kind: "attending-call",
        dayAttendingId: "att_chen",
        serviceLine: "Davies"
      })
      .expect(400);
    expect(incompleteResponse.body.error).toMatch(/requires both/i);

    await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-06",
        kind: "attending-call",
        dayAttendingId: "att_chen",
        nightAttendingId: "att_chen",
        serviceLine: "Davies"
      })
      .expect(400);
  });

  it("stores dedicated attending service, ACS call, and manual practice coverage", async () => {
    const { app, token } = await loginAs("admin");

    const egs = await request(app)
      .post("/api/attending-coverage")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-06", line: "EGS", shift: "day", role: "primary", attendingId: "att_chen", note: "" })
      .expect(201);
    expect(egs.body.attendingCoverageAssignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: "EGS", shift: "day", source: "manual" })])
    );

    await request(app)
      .post("/api/attending-coverage")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-06", line: "ACS", shift: "night", role: "primary", attendingId: "att_patel", note: "" })
      .expect(201);

    const practice = await request(app)
      .post("/api/attending-coverage")
      .set("x-api-key", "test-admin-api-key")
      .send({ date: "2026-07-10", line: "Practice", shift: "weekend", role: "primary", attendingId: "att_morris", note: "" })
      .expect(201);
    expect(practice.body.attendingCoverageAssignments).toEqual(
      expect.arrayContaining([expect.objectContaining({ line: "Practice", shift: "weekend", source: "api" })])
    );

    const duplicate = await request(app)
      .post("/api/attending-coverage")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-10", line: "Practice", shift: "weekend", role: "primary", attendingId: "att_chen", note: "" })
      .expect(409);
    expect(duplicate.body.error).toMatch(/already assigned/i);

    await request(app)
      .post("/api/attending-coverage")
      .set("authorization", `Bearer ${token}`)
      .send({ date: "2026-07-06", line: "EGS", shift: "night", role: "primary", attendingId: "att_chen", note: "" })
      .expect(400);
  });

  it("treats the minimally invasive fellow as case-covering staff and Practice weekend call, not resident call", async () => {
    const { app, token } = await loginAs("admin");
    const fellowResponse = await request(app)
      .post("/api/entities/residents")
      .set("authorization", `Bearer ${token}`)
      .send({
        id: "res_mi_fellow",
        name: "Minimally Invasive Fellow",
        trainingLevel: "PGY3",
        designation: "minimally-invasive-fellow",
        rosterKind: "primary",
        serviceTags: ["Berry"],
        tags: [],
        trainingInterests: ["minimally invasive surgery"],
        unavailable: []
      })
      .expect(201);

    expect(fellowResponse.body.residents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "res_mi_fellow",
        designation: "minimally-invasive-fellow",
        trainingLevel: "Fellow",
        rosterKind: "primary",
        serviceTags: ["Davies"],
        rotationSchedule: expect.arrayContaining([
          expect.objectContaining({ blockNumber: 1, service: "Davies" }),
          expect.objectContaining({ blockNumber: 13, service: "Davies" })
        ])
      })
    ]));

    await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${token}`)
      .send({ kind: "case", targetId: "case_chen_chole", residentId: "res_mi_fellow", locked: false })
      .expect(201);

    const residentCall = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-03",
        kind: "call",
        residentId: "res_mi_fellow",
        callPosition: "senior",
        note: "",
        serviceLine: "Davies"
      })
      .expect(400);
    expect(residentCall.body.error).toMatch(/not in the resident call pool/i);

    const wrongLine = await request(app)
      .post("/api/attending-coverage")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-03",
        line: "ACS",
        shift: "night",
        role: "primary",
        fellowResidentId: "res_mi_fellow",
        note: ""
      })
      .expect(400);
    expect(wrongLine.body.error).toMatch(/only primary Practice weekend call/i);

    const wrongStart = await request(app)
      .post("/api/attending-coverage")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-04",
        line: "Practice",
        shift: "weekend",
        role: "primary",
        fellowResidentId: "res_mi_fellow",
        note: ""
      })
      .expect(400);
    expect(wrongStart.body.error).toMatch(/must start on Friday/i);

    const practiceCall = await request(app)
      .post("/api/attending-coverage")
      .set("authorization", `Bearer ${token}`)
      .send({
        date: "2026-07-03",
        line: "Practice",
        shift: "weekend",
        role: "primary",
        fellowResidentId: "res_mi_fellow",
        note: ""
      })
      .expect(201);
    expect(practiceCall.body.attendingCoverageAssignments).toEqual(expect.arrayContaining([
      expect.objectContaining({
        line: "Practice",
        shift: "weekend",
        fellowResidentId: "res_mi_fellow"
      })
    ]));

    const calendar = await request(app)
      .get("/api/residents/res_mi_fellow/calendar.ics")
      .set("authorization", `Bearer ${token}`)
      .expect(200);
    expect(calendar.text).toContain("SUMMARY:Practice call");
    expect(calendar.text).toContain("DTSTART:20260703T170000");
    expect(calendar.text).toContain("DTEND:20260706T060000");
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

    expect(deleteResponse.body.coverageRequests.map((item: { id: string ;}) => item.id)).not.toContain(requestId);
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
    expect(requesterState.body.coverageRequests.map((item: { id: string ;}) => item.id)).toContain(tradeRequest.id);
    expect(targetState.body.coverageRequests.map((item: { id: string ;}) => item.id)).toContain(tradeRequest.id);
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
    expect(approvalResponse.body.coverageRequests.find((item: { id: string ;}) => item.id === tradeRequest.id)).toEqual(
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
    const broden = response.body.residents.find((resident: { id: string ;}) => resident.id === "res_fellow");

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
    expect(requesterState.body.coverageRequests.map((item: { id: string ;}) => item.id)).toContain(profileRequest.id);

    await request(app)
      .post(`/api/coverage-requests/${profileRequest.id}/approve`)
      .set("authorization", `Bearer ${requesterToken}`)
      .expect(403);

    const approvalResponse = await request(app)
      .post(`/api/coverage-requests/${profileRequest.id}/approve`)
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    const updatedResident = approvalResponse.body.residents.find((resident: { id: string ;}) => resident.id === "res_fellow");

    expect(updatedResident).toEqual(
      expect.objectContaining({
        name: "Dayo Adeleke",
        aliases: ["Adedayo Adeleke", "A Adeleke"]
      })
    );
    expect(approvalResponse.body.coverageRequests.find((item: { id: string ;}) => item.id === profileRequest.id)).toEqual(
      expect.objectContaining({ status: "approved" })
    );
  });

  it("routes non-admin vacation changes through admin approval and permits direct admin API updates", async () => {
    const app = createApp(new MemoryStateStore(createInitialState()));
    const requesterToken = await loginOnApp(app, "cblue");
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    const vacation = [{ id: "vac_fellow_august", startDate: "2026-08-10", endDate: "2026-08-14" }];

    const requestResponse = await request(app)
      .post("/api/coverage-requests")
      .set("authorization", `Bearer ${requesterToken}`)
      .send({
        requestType: "resident-vacation",
        action: "update",
        targetResidentId: "res_fellow",
        requestedResidentVacation: { residentId: "res_fellow", vacation },
        message: ""
      })
      .expect(201);

    const vacationRequest = requestResponse.body.coverageRequests[0];
    expect(vacationRequest).toEqual(
      expect.objectContaining({
        requestType: "resident-vacation",
        status: "pending",
        requesterUsername: "cblue",
        targetResidentId: "res_fellow",
        requestedResidentVacation: { residentId: "res_fellow", vacation }
      })
    );

    const requesterState = await request(app).get("/api/state").set("authorization", `Bearer ${requesterToken}`).expect(200);
    expect(requesterState.body.coverageRequests.map((item: { id: string ;}) => item.id)).toContain(vacationRequest.id);

    await request(app)
      .post(`/api/coverage-requests/${vacationRequest.id}/approve`)
      .set("authorization", `Bearer ${requesterToken}`)
      .expect(403);

    const approvalResponse = await request(app)
      .post(`/api/coverage-requests/${vacationRequest.id}/approve`)
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(approvalResponse.body.residents.find((resident: { id: string ;}) => resident.id === "res_fellow")).toEqual(
      expect.objectContaining({ vacation })
    );
    expect(approvalResponse.body.coverageRequests.find((item: { id: string ;}) => item.id === vacationRequest.id)).toEqual(
      expect.objectContaining({ status: "approved" })
    );

    const directVacation = [{ id: "vac_fellow_december", startDate: "2026-12-21", endDate: "2026-12-25" }];
    const directResponse = await request(app)
      .patch("/api/entities/residents/res_fellow")
      .set("x-api-key", "test-admin-api-key")
      .send({ vacation: directVacation })
      .expect(200);
    expect(directResponse.body.residents.find((resident: { id: string ;}) => resident.id === "res_fellow")).toEqual(
      expect.objectContaining({ vacation: directVacation })
    );

    await request(app)
      .patch("/api/entities/residents/res_fellow")
      .set("x-api-key", "test-admin-api-key")
      .send({ vacation: [{ id: "vac_bad", startDate: "2026-08-14", endDate: "2026-08-10" }] })
      .expect(400);
  });

  it("blocks case and rounding assignments for residents who are off or on vacation", async () => {
    const state = createInitialState();
    const app = createApp(new MemoryStateStore(state));
    const adminToken = await loginOnApp(app, "admin", "admin-dev-password");
    const caseDate = state.attendingBlocks.find((block) => block.id === "block_chen_mon")!.date;
    const roundingDate = addDays(caseDate, 5);

    await request(app)
      .patch("/api/entities/residents/res_chief")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ vacation: [{ id: "vac_chief_test", startDate: caseDate, endDate: caseDate }] })
      .expect(200);

    const caseResponse = await request(app)
      .post("/api/assignments")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ kind: "case", targetId: "case_chen_whipple", residentId: "res_chief" })
      .expect(400);
    expect(caseResponse.body.error).toMatch(/cannot be assigned to case.*on vacation/i);

    const icsResponse = await request(app)
      .get("/api/residents/res_chief/calendar.ics")
      .set("authorization", `Bearer ${adminToken}`)
      .expect(200);
    expect(icsResponse.text).toContain("SUMMARY:Vacation:");
    expect(icsResponse.text).toContain(`DTSTART;VALUE=DATE:${caseDate.replace(/-/g, "")}`);

    await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ date: roundingDate, kind: "off", residentId: "res_chief", note: "" })
      .expect(201);

    const roundingResponse = await request(app)
      .post("/api/coverage-entries")
      .set("authorization", `Bearer ${adminToken}`)
      .send({ date: roundingDate, kind: "rounding", residentId: "res_chief", serviceLine: "Davies", note: "" })
      .expect(400);
    expect(roundingResponse.body.error).toMatch(/cannot be assigned to rounding.*off on the calendar/i);
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

    expect(daviesResponse.body.days.flatMap((day: { blocks: unknown[] ;}) => day.blocks)).toHaveLength(3);
    expect(berryResponse.body.days.flatMap((day: { blocks: unknown[] ;}) => day.blocks)).toHaveLength(0);
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
      (assignment: { kind: string; targetId: string ;}) =>
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
      (assignment: { kind: string; targetId: string ;}) => assignment.kind === "case" && assignment.targetId === "case_chen_whipple"
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
      .flatMap((day: { blocks: { cases: unknown[] ;}[] ;}) => day.blocks)
      .flatMap((block: { cases: { id: string; assignments: { residentId: string ;}[] ;}[] ;}) => block.cases)
      .find((surgeryCase: { id: string ;}) => surgeryCase.id === "case_chen_whipple");
    expect(scheduledCase.assignments.map((assignment: { residentId: string ;}) => assignment.residentId)).toEqual(["res_chief", "res_fellow"]);

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
      .flatMap((day: { blocks: { cases: unknown[] ;}[] ;}) => day.blocks)
      .flatMap((block: { cases: { id: string; assignments: { residentId: string ;}[] ;}[] ;}) => block.cases)
      .find((surgeryCase: { id: string ;}) => surgeryCase.id === "case_chen_whipple");

    expect(scheduledCase.assignments.map((assignment: { residentId: string ;}) => assignment.residentId)).toEqual(["res_chief", "res_fellow"]);
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
    expect(nextSchedule.body.days.flatMap((day: { blocks: unknown[] ;}) => day.blocks)).toHaveLength(1);

    const deleteResponse = await request(app)
      .delete("/api/entities/weeks/week_next")
      .set("authorization", `Bearer ${token}`)
      .expect(200);

    expect(deleteResponse.body.weeks.map((week: { id: string ;}) => week.id)).toContain("week_current");
    expect(deleteResponse.body.weeks.map((week: { id: string ;}) => week.id)).not.toContain("week_next");
    expect(deleteResponse.body.attendingBlocks.map((block: { id: string ;}) => block.id)).not.toContain("block_next");
    expect(deleteResponse.body.cases.map((surgeryCase: { id: string ;}) => surgeryCase.id)).not.toContain("case_next");
    expect(deleteResponse.body.clinicSessions.map((clinic: { id: string ;}) => clinic.id)).not.toContain("clinic_next");
    expect(deleteResponse.body.assignments.map((assignment: { targetId: string ;}) => assignment.targetId)).not.toEqual(
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
