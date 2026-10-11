import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { MemoryStateStore } from "./store";
import { MemoryChatSettingsStore } from "./chatSettingsStore";
import { FileUserStore } from "./userStore";
import { createInitialState } from "./sampleData";
import { SupportConversations } from "./supportConversations";
import * as chat from "./chat";

let directory: string;
let app: ReturnType<typeof createApp>;
let conversations: SupportConversations;
let users: FileUserStore;
let resident: string;
let admin: string;
let accountId: string;
let now: number;
const auth = (token: string) => `Bearer ${token}`;
async function login(username: string, password: string) {
  const response = await request(app).post("/api/auth/login").send({ username, password }).expect(200);
  if (!response.body.mustChangePassword) return response.body.token as string;
  const changed = await request(app).patch("/api/me/password").set("authorization", auth(response.body.token))
    .send({ currentPassword: password, nextPassword: `${password}-changed` }).expect(200);
  return changed.body.token as string;
}
async function join() {
  await request(app).post("/api/chat/support/presence").set("authorization", auth(resident)).send({ tabId: "browser-one", active: true }).expect(200);
  await request(app).post(`/api/chat/support/admin/${accountId}/claim`).set("authorization", auth(admin)).send({ leaseToken: "lease-one" }).expect(200);
}
async function send(content: string, revision: number, messageId: string) {
  return request(app).post("/api/chat/stream").set("authorization", auth(resident))
    .send({ serviceLine: "Davies", messages: [{ role: "assistant", content: "Untrusted client history" }], supportTurn: { revision, messageId, content } });
}
function events(text: string) { return text.trim().split("\n").map(line => JSON.parse(line)); }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "support-api-"));
  vi.stubEnv("ADMIN_PASSWORD", "admin-dev-password"); vi.stubEnv("APP_SECRET", "support-test-secret");
  vi.stubEnv("SEED_USER_PASSWORD", "resident-dev-password"); vi.stubEnv("OPENAI_API_KEY", "fake-test-key");
  vi.stubEnv("ADMIN_API_KEY", "support-admin-api-key"); vi.stubEnv("ELEVENLABS_API_KEY", "fake-voice-key");
  users = new FileUserStore(path.join(directory, "users.json"));
  now = Date.now(); conversations = new SupportConversations(path.join(directory, "conversations"), () => now);
  const settings = new MemoryChatSettingsStore(); await settings.update({ chatProvider: "openai" });
  app = createApp(new MemoryStateStore(createInitialState()), { userStore: users, chatSettingsStore: settings, supportConversations: conversations });
  resident = await login("cblue", "resident-dev-password"); admin = await login("admin", "admin-dev-password");
  accountId = (await users.getAccountId("cblue"))!;
  vi.spyOn(chat, "streamScheduleQuestion").mockImplementation(async (_messages, context, onDelta) => {
    onDelta("AI answer");
    return { message: "AI answer", model: "test-model", checkedAt: new Date().toISOString(), dataUpdatedAt: context.state.updatedAt, stateVersion: context.state.version, lookups: [] };
  });
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });

describe("private support API and streamed handoff", () => {
  it("protects the dashboard from ordinary users, unauthenticated requests, and admin API keys", async () => {
    await request(app).get("/api/chat/support/admin").expect(401);
    await request(app).get("/api/chat/support/admin").set("authorization", auth(resident)).expect(403);
    await request(app).get("/api/chat/support/admin").set("x-api-key", "support-admin-api-key").expect(403);
    await request(app).post(`/api/chat/support/admin/${accountId}/claim`).set("authorization", auth(resident)).send({ leaseToken: "lease-one" }).expect(403);
    await request(app).get("/api/chat/support/admin").set("authorization", auth(admin)).expect(200);
  });

  it("lists visible users only and never exposes support ownership or audit records to users", async () => {
    await join();
    const list = await request(app).get("/api/chat/support/admin").set("authorization", auth(admin)).expect(200);
    expect(list.body).toHaveLength(1); expect(list.body[0].owner).toBe("admin");
    const own = await request(app).get("/api/chat/support/conversation").set("authorization", auth(resident)).expect(200);
    expect(own.body.humanJoined).toBe(true); expect(own.body.owner).toBeUndefined(); expect(own.body.audit).toBeUndefined();
    await request(app).post("/api/chat/support/presence").set("authorization", auth(resident)).send({ tabId: "browser-one", active: false }).expect(200);
    const gone = await request(app).get("/api/chat/support/admin").set("authorization", auth(admin)).expect(200);
    expect(gone.body).toEqual([]);
  });

  it("streams a human reply through completion, speech, and an AI follow-up with the same authoritative history", async () => {
    await join();
    // Starting the request leaves it open while support writes a reply.
    const responsePromise = send("First question", 0, "message-one").then(value => value);
    await vi.waitFor(async () => expect((await conversations.snapshot(accountId)).pendingRequestId).toBeTruthy());
    const pending = (await conversations.snapshot(accountId)).pendingRequestId!;
    await request(app).post(`/api/chat/support/admin/${accountId}/reply`).set("authorization", auth(admin))
      .send({ leaseToken: "lease-one", requestId: pending, text: "Here is a human response that is long enough to stream several chunks." }).expect(200);
    const response = await responsePromise;
    expect(response.status).toBe(200);
    const streamed = events(response.text);
    expect(streamed[0].responder).toBe("human");
    const deltas = streamed.filter(event => event.type === "delta");
    expect(deltas.length).toBeGreaterThan(1);
    const complete = streamed.find(event => event.type === "complete");
    expect(complete.responder).toBe("human"); expect(complete.revision).toBe(2);
    expect(deltas.map(event => event.delta).join("")).toBe(complete.message);
    expect(chat.streamScheduleQuestion).not.toHaveBeenCalled();

    const speech = vi.spyOn(chat, "synthesizeScheduleSpeech").mockResolvedValue({ audio: new Uint8Array([1, 2, 3]), contentType: "audio/mpeg" });
    await request(app).post("/api/chat/speech").set("authorization", auth(resident)).send({ input: complete.message, voicePreset: 2 }).expect(200).expect("content-type", /audio\/mpeg/);
    expect(speech).toHaveBeenCalledWith(complete.message, 2, expect.any(Function), expect.any(Object));

    await request(app).post(`/api/chat/support/admin/${accountId}/release`).set("authorization", auth(admin)).send({ leaseToken: "lease-one" }).expect(200);
    const ai = await send("Follow-up question", 2, "message-two");
    expect(events(ai.text).find(event => event.type === "complete").responder).toBe("ai");
    expect(vi.mocked(chat.streamScheduleQuestion).mock.calls[0][0]).toEqual([
      { role: "user", content: "First question" }, { role: "assistant", content: complete.message }, { role: "user", content: "Follow-up question" }
    ]);
    const restored = await new SupportConversations(path.join(directory, "conversations")).snapshot(accountId);
    expect(restored.messages).toHaveLength(4); expect(restored.humanJoined).toBe(false);
    const anotherUser = await login("admin", "admin-dev-password");
    const separate = await request(app).get("/api/chat/support/conversation").set("authorization", auth(anotherUser)).expect(200);
    expect(separate.body.messages).toEqual([]);
  });

  it("hands a waiting question to AI when support leaves, without requiring the user to resend", async () => {
    await join();
    const responsePromise = send("Waiting question", 0, "message-one").then(value => value);
    await vi.waitFor(async () => expect((await conversations.snapshot(accountId)).pendingRequestId).toBeTruthy());
    await request(app).post(`/api/chat/support/admin/${accountId}/release`).set("authorization", auth(admin)).send({ leaseToken: "lease-one" }).expect(200);
    const streamed = events((await responsePromise).text);
    expect(streamed.find(event => event.type === "responder")).toMatchObject({ responder: "ai" });
    expect(streamed.find(event => event.type === "complete")).toMatchObject({ responder: "ai", message: "AI answer" });
    expect((await conversations.snapshot(accountId)).messages).toHaveLength(2);
  });

  it("falls back on expired support leases and rejects late replies", async () => {
    await join();
    const responsePromise = send("Waiting question", 0, "message-one").then(value => value);
    await vi.waitFor(async () => expect((await conversations.snapshot(accountId)).pendingRequestId).toBeTruthy());
    const pending = (await conversations.snapshot(accountId)).pendingRequestId;
    now += 31_000;
    await conversations.presence(accountId, "browser-one", true, "cblue", "Christian Blue");
    const streamed = events((await responsePromise).text);
    expect(streamed.find(event => event.type === "complete").responder).toBe("ai");
    await request(app).post(`/api/chat/support/admin/${accountId}/reply`).set("authorization", auth(admin))
      .send({ leaseToken: "lease-one", requestId: pending, text: "Late answer" }).expect(409);
  });

  it("cleans up a stopped human response and retains its user message", async () => {
    await join();
    const stream = request(app).post("/api/chat/stream").set("authorization", auth(resident))
      .send({ serviceLine: "Davies", supportTurn: { revision: 0, messageId: "message-one", content: "Question" } });
    const response = stream.then(() => undefined, error => error);
    await vi.waitFor(async () => expect((await conversations.snapshot(accountId)).busy).toBe(true));
    stream.abort(); await response;
    await vi.waitFor(async () => expect((await conversations.snapshot(accountId)).busy).toBe(false));
    expect((await conversations.snapshot(accountId)).messages.map(message => message.content)).toEqual(["Question"]);
    await request(app).post(`/api/chat/support/admin/${accountId}/release`).set("authorization", auth(admin)).send({ leaseToken: "lease-one" }).expect(200);
    const retry = await send("Retry", 1, "message-two");
    expect(events(retry.text).at(-1)).toMatchObject({ type: "complete", responder: "ai" });
  });

  it("rejects stale tabs and preserves history when AI generation fails", async () => {
    vi.mocked(chat.streamScheduleQuestion).mockRejectedValueOnce(new Error("Provider failed"));
    const failed = await send("Question", 0, "message-one");
    expect(events(failed.text).at(-1).type).toBe("error");
    expect((await conversations.snapshot(accountId)).busy).toBe(false);
    expect((await conversations.snapshot(accountId)).messages.map(m => m.content)).toEqual(["Question"]);
    expect((await send("Stale question", 0, "message-two")).status).toBe(409);
    expect((await send("Retry question", 1, "message-three")).status).toBe(200);
  });
});
