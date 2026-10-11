import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SupportConversations } from "./supportConversations";

let directory: string;
let now: number;
let store: SupportConversations;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "support-test-"));
  now = Date.now(); store = new SupportConversations(directory, () => now);
  await store.presence("account-one", "browser-one", true, "resident", "Resident");
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });

describe("support ownership and history", () => {
  it("preserves both human and AI messages on disk while clearing live ownership on restart", async () => {
    await store.claim("account-one", "admin", "lease-one");
    const human = await store.begin("account-one", 0, "message-one", "Question");
    await store.reply("account-one", "admin", "lease-one", human.requestId, "Human answer");
    expect(await store.waitForReply("account-one", human.requestId, new AbortController().signal)).toBe("Human answer");
    await store.complete("account-one", human.requestId, { content: "Human answer", responder: "human" });
    await store.release("account-one", "admin", "lease-one");
    const ai = await store.begin("account-one", 2, "message-two", "Follow-up");
    expect(ai.human).toBe(false);
    expect(ai.messages.map(m => m.content)).toEqual(["Question", "Human answer", "Follow-up"]);
    await store.complete("account-one", ai.requestId, { content: "AI answer", responder: "ai" });
    const restored = await new SupportConversations(directory).snapshot("account-one");
    expect(restored.messages.map(m => m.content)).toEqual(["Question", "Human answer", "Follow-up", "AI answer"]);
    expect(restored.messages[1].responder).toBe("human");
    expect(restored.humanJoined).toBe(false);
    expect(restored.busy).toBe(false);
    expect(restored.active).toBe(false);
    expect((await store.snapshot("another-account")).messages).toEqual([]);
  });

  it("allows exactly one admin session to own a conversation", async () => {
    const claims = await Promise.allSettled([store.claim("account-one", "admin", "lease-one"), store.claim("account-one", "admin", "lease-two")]);
    expect(claims.filter(result => result.status === "fulfilled")).toHaveLength(1);
    await expect(store.release("account-one", "other-admin", "lease-one")).rejects.toMatchObject({ status: 409 });
    expect((await store.snapshot("account-one")).humanJoined).toBe(true);
  });

  it("waits for an AI response to finish before allowing takeover", async () => {
    const turn = await store.begin("account-one", 0, "message-one", "Question");
    await expect(store.claim("account-one", "admin", "lease-one")).rejects.toMatchObject({ status: 409 });
    await store.complete("account-one", turn.requestId, { content: "Answer", responder: "ai" });
    await store.claim("account-one", "admin", "lease-one");
    expect((await store.snapshot("account-one")).humanJoined).toBe(true);
  });

  it("returns a waiting question to AI on explicit release or expired admin heartbeat", async () => {
    for (const expired of [false, true]) {
      await store.presence("account-one", "browser-one", true, "resident", "Resident");
      await store.claim("account-one", "admin", "lease-one");
      const snapshot = await store.snapshot("account-one");
      const turn = await store.begin("account-one", snapshot.revision, `message-${expired}`, "Question");
      if (expired) {
        now += 31_000;
        await store.presence("account-one", "browser-one", true, "resident", "Resident");
      } else await store.release("account-one", "admin", "lease-one");
      expect(await store.waitForReply("account-one", turn.requestId, new AbortController().signal)).toBeUndefined();
      await store.cancel("account-one", turn.requestId);
    }
  });

  it("expires invisible users, respects multiple visible tabs, and prevents heartbeat resurrection", async () => {
    await store.presence("account-one", "browser-two", true, "resident", "Resident");
    await store.claim("account-one", "admin", "lease-one");
    await store.presence("account-one", "browser-one", false, "resident", "Resident");
    expect((await store.snapshot("account-one")).humanJoined).toBe(true);
    await store.presence("account-one", "browser-two", false, "resident", "Resident");
    expect((await store.snapshot("account-one")).humanJoined).toBe(false);
    await expect(store.heartbeat("account-one", "admin", "lease-one")).rejects.toMatchObject({ status: 409 });
    expect(await store.list()).toEqual([]);
  });

  it("rejects concurrent turns, stale history, duplicate messages, and late support replies", async () => {
    await store.claim("account-one", "admin", "lease-one");
    const turn = await store.begin("account-one", 0, "message-one", "Question");
    await expect(store.begin("account-one", 1, "message-two", "Other tab")).rejects.toMatchObject({ status: 409 });
    await store.cancel("account-one", turn.requestId);
    await expect(store.reply("account-one", "admin", "lease-one", turn.requestId, "Late answer")).rejects.toMatchObject({ status: 409 });
    await expect(store.begin("account-one", 0, "message-two", "Stale")).rejects.toMatchObject({ status: 409 });
    await expect(store.begin("account-one", 1, "message-one", "Duplicate")).rejects.toMatchObject({ status: 409 });
    expect((await store.snapshot("account-one")).messages.map(m => m.content)).toEqual(["Question"]);
  });

  it("aborts a waiting human response without hanging or losing the user message", async () => {
    await store.claim("account-one", "admin", "lease-one");
    const turn = await store.begin("account-one", 0, "message-one", "Question");
    const controller = new AbortController();
    const waiting = store.waitForReply("account-one", turn.requestId, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    await store.cancel("account-one", turn.requestId);
    expect((await store.snapshot("account-one")).busy).toBe(false);
    expect((await store.snapshot("account-one")).messages).toHaveLength(1);
  });

  it("records confirmations exactly once and marks the original choices answered", async () => {
    const turn = await store.begin("account-one", 0, "message-one", "Change schedule");
    await store.complete("account-one", turn.requestId, { content: "Confirm?", responder: "ai", interaction: { type: "single_choice", prompt: "Confirm?", actionToken: "action-token", options: [{ id: "confirm", label: "Confirm change" }, { id: "cancel", label: "Cancel" }] } });
    await store.recordAction("account-one", "action-token", "confirm", { message: "Changed" });
    await store.recordAction("account-one", "action-token", "confirm", { message: "Changed" });
    const snapshot = await store.snapshot("account-one");
    expect(snapshot.messages.map(m => m.content)).toEqual(["Change schedule", "Confirm?", "Confirm change", "Changed"]);
    expect(snapshot.messages[1].interactionAnswered).toBe(true);
  });
});
