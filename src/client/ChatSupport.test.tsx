// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatTab } from "./ChatTab";
import * as api from "./api";
import type { SupportConversation } from "../shared/support";

vi.mock("./api", async importOriginal => ({
  ...await importOriginal<typeof import("./api")>(),
  fetchChatQuota: vi.fn(), fetchVoiceQuota: vi.fn(), updateSupportPresence: vi.fn(),
  fetchSupportConversation: vi.fn(), clearSupportConversation: vi.fn(), streamChatMessage: vi.fn(), synthesizeChatSpeech: vi.fn()
}));
let root: Root;
let container: HTMLDivElement;
let snapshot: SupportConversation;
const quota = { used: 0, remaining: 20, limit: 20, warningThreshold: 5, unlimited: false };
const props = { token: "session-token", displayName: "Resident", isAdmin: false, showDiagnosticErrors: false, serviceLine: "Davies", plannerVersion: 1, onOpenPlanner: vi.fn() };
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  snapshot = { id: "account-one", username: "resident", displayName: "Resident", messages: [], revision: 0, humanJoined: false, busy: false, active: true };
  vi.mocked(api.fetchChatQuota).mockResolvedValue(quota);
  vi.mocked(api.fetchVoiceQuota).mockResolvedValue({ used: 0, remaining: 12, limit: 12, unlimited: false });
  vi.mocked(api.updateSupportPresence).mockImplementation(async () => snapshot);
  vi.mocked(api.fetchSupportConversation).mockImplementation(async () => snapshot);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount()); container.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); vi.unstubAllGlobals();
});

describe("quiet support handoff in chat", () => {
  it("clears saved history and starts the next turn with fresh context", async () => {
    snapshot = { ...snapshot, revision: 2, messages: [
      { id: "old-user", role: "user", content: "Old question", createdAt: new Date().toISOString() },
      { id: "old-reply", role: "assistant", content: "Old answer", createdAt: new Date().toISOString() }
    ] };
    vi.mocked(api.clearSupportConversation).mockImplementationOnce(async () => {
      snapshot = { ...snapshot, revision: 3, messages: [] };
      return snapshot;
    });
    await act(async () => root.render(<ChatTab {...props} />));
    await act(async () => container.querySelector<HTMLButtonElement>(".chat-clear-button")!.click());
    expect(api.clearSupportConversation).toHaveBeenCalledWith(props.token, 2);
    expect(container.textContent).not.toContain("Old question");
    expect(container.textContent).not.toContain("Old answer");
    expect(container.textContent).toContain("Hi Resident, how can I help?");
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(container.textContent).not.toContain("Old answer");
    vi.mocked(api.streamChatMessage).mockImplementationOnce(async (_token, messages, _service, _handlers, _signal, _voice, _preset, turn) => {
      expect(messages).toEqual([{ role: "user", content: "Fresh question" }]);
      expect(turn).toMatchObject({ revision: 3, content: "Fresh question" });
      return { ...quota, message: "Fresh answer", model: "test", checkedAt: "now", dataUpdatedAt: "now", stateVersion: 1, lookups: [] };
    });
    const input = container.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Fresh question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector(".chat-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(api.streamChatMessage).toHaveBeenCalledTimes(1);
  });

  it("preserves the conversation when clearing fails and disables clearing for busy conversations", async () => {
    snapshot = { ...snapshot, revision: 1, messages: [
      { id: "old-user", role: "user", content: "Saved question", createdAt: new Date().toISOString() }
    ] };
    vi.mocked(api.clearSupportConversation).mockRejectedValueOnce(new Error("Unavailable"));
    await act(async () => root.render(<ChatTab {...props} />));
    await act(async () => container.querySelector<HTMLButtonElement>(".chat-clear-button")!.click());
    expect(container.textContent).toContain("Saved question");
    expect(container.textContent).toContain("Chat couldn't be cleared");
    snapshot = { ...snapshot, busy: true };
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(container.querySelector<HTMLButtonElement>(".chat-clear-button")!.disabled).toBe(true);
  });

  it("ignores an older presence response arriving after chat is cleared", async () => {
    snapshot = { ...snapshot, revision: 1, messages: [
      { id: "old-user", role: "user", content: "Old question", createdAt: new Date().toISOString() }
    ] };
    await act(async () => root.render(<ChatTab {...props} />));
    const oldSnapshot = snapshot;
    let resolvePresence!: (value: SupportConversation) => void;
    vi.mocked(api.updateSupportPresence).mockImplementationOnce(() => new Promise(resolve => { resolvePresence = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    vi.mocked(api.clearSupportConversation).mockImplementationOnce(async () => {
      snapshot = { ...snapshot, revision: 2, messages: [] };
      return snapshot;
    });
    await act(async () => container.querySelector<HTMLButtonElement>(".chat-clear-button")!.click());
    await act(async () => resolvePresence(oldSnapshot));
    expect(container.textContent).not.toContain("Old question");
    expect(container.textContent).toContain("Hi Resident, how can I help?");
  });

  it.each(["human", "ai"] as const)("keeps randomized waiting messages for the %s response path", async responder => {
    snapshot = { ...snapshot, humanJoined: responder === "human" };
    let handlers!: Parameters<typeof api.streamChatMessage>[3];
    let finish!: () => void;
    vi.mocked(api.streamChatMessage).mockImplementationOnce(async (_token, _messages, _service, callbacks, _signal, _voice, _preset, turn) => {
      handlers = callbacks;
      await new Promise<void>(resolve => { finish = resolve; });
      snapshot = { ...snapshot, revision: 2, messages: [
        { id: turn!.messageId, role: "user", content: "Question", createdAt: new Date().toISOString() },
        { id: "reply-id", role: "assistant", content: "Assistant reply", responder, createdAt: new Date().toISOString() }
      ] };
      return { ...quota, message: "Assistant reply", model: "test", checkedAt: "now", dataUpdatedAt: "now", stateVersion: 1, lookups: [], responder, messageId: "reply-id", revision: 2 };
    });
    await act(async () => root.render(<ChatTab {...props} />));
    const input = container.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector(".chat-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    const initialMessage = container.querySelector(".chat-response-progress .chat-bubble")!.textContent;
    expect(initialMessage).toMatch(/…$/);
    expect(initialMessage).not.toMatch(/human|support|preparing a reply/i);
    await act(async () => {
      handlers.onMeta?.({ ...quota, responder, checkedAt: "now", dataUpdatedAt: "now", stateVersion: 1 });
      handlers.onResponder?.(responder);
    });
    expect(container.querySelector(".chat-response-progress .chat-bubble")!.textContent).toBe(initialMessage);
    expect(container.querySelector(".chat-thinking")!.getAttribute("aria-label")).toBe("Assistant is checking the schedule");
    await act(async () => { await vi.advanceTimersByTimeAsync(8000); });
    expect(container.querySelector(".chat-response-progress .chat-bubble")!.textContent).toMatch(/^(Almost there|Okay, almost got it|Just wrapping that up|One more moment|Finishing the check|Nearly ready|I’m almost done|Just a few more seconds)…$/);
    await act(async () => { handlers.onResponder?.(responder === "human" ? "ai" : "human"); });
    expect(container.querySelector(".chat-response-progress .chat-bubble")!.textContent).not.toBe(initialMessage);
    await act(async () => { handlers.onDelta("Assistant reply"); finish(); });
    expect(container.querySelector(".chat-response-status")).toBeNull();
    expect(container.querySelector(".chat-support-attribution")).toBeNull();
    expect(container.querySelector(".chat-response-footer")!.textContent).toContain("Checked");
  });

  it("restores admin-agent history with the same assistant presentation", async () => {
    snapshot = { ...snapshot, humanJoined: true, revision: 2, messages: [
      { id: "user-one", role: "user", content: "Question", createdAt: new Date().toISOString() },
      { id: "reply-one", role: "assistant", content: "Assistant answer", responder: "human", createdAt: new Date().toISOString() }
    ] };
    await act(async () => root.render(<ChatTab {...props} />));
    expect(container.querySelector(".chat-support-presence")?.textContent).toBe("");
    expect(container.querySelector(".chat-support-attribution")).toBeNull();
    expect(container.textContent).toContain("Assistant answer");
    expect(container.querySelector('[role="dialog"], [role="alert"]')).toBeNull();
    snapshot = { ...snapshot, humanJoined: false };
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(container.querySelector(".chat-support-presence")?.textContent).toBe("");
    expect(container.textContent).toContain("Assistant answer");
    expect(container.querySelector(".chat-support-attribution")).toBeNull();
  });

  it("reports presence only while the assistant tab is active and the document is visible", async () => {
    await act(async () => root.render(<ChatTab {...props} active />));
    expect(api.updateSupportPresence).toHaveBeenLastCalledWith("session-token", expect.any(String), true, "Davies");
    await act(async () => root.render(<ChatTab {...props} active={false} />));
    expect(api.updateSupportPresence).toHaveBeenLastCalledWith("session-token", expect.any(String), false, "Davies");
    await act(async () => root.render(<ChatTab {...props} active />));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(api.updateSupportPresence).toHaveBeenLastCalledWith("session-token", expect.any(String), false, "Davies");
  });

  it("streams an admin-agent reply without attribution and invokes the existing spoken-response path once", async () => {
    snapshot = { ...snapshot, humanJoined: true };
    await act(async () => root.render(<ChatTab {...props} />));
    const toggle = container.querySelector<HTMLButtonElement>(".chat-voice-mode-button")!;
    await act(async () => toggle.click());
    vi.mocked(api.synthesizeChatSpeech).mockRejectedValueOnce(new Error("Test audio unavailable"));
    vi.mocked(api.streamChatMessage).mockImplementationOnce(async (_token, _messages, _service, handlers, _signal, voiceMode, _preset, turn) => {
      expect(voiceMode).toBe(true); expect(turn).toMatchObject({ revision: 0, content: "Question" });
      handlers.onMeta?.({ ...quota, responder: "human", checkedAt: "now", dataUpdatedAt: "now", stateVersion: 1 });
      handlers.onDelta("Assistant "); handlers.onDelta("reply");
      snapshot = { ...snapshot, revision: 2, messages: [
        { id: turn!.messageId, role: "user", content: "Question", createdAt: new Date().toISOString() },
        { id: "reply-id", role: "assistant", content: "Assistant reply", responder: "human", createdAt: new Date().toISOString() }
      ] };
      return { ...quota, message: "Assistant reply", model: "human-support", checkedAt: "now", dataUpdatedAt: "now", stateVersion: 1, lookups: [], responder: "human", messageId: "reply-id", revision: 2 };
    });
    const input = container.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector(".chat-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(api.synthesizeChatSpeech).toHaveBeenCalledTimes(1);
    expect(api.synthesizeChatSpeech).toHaveBeenCalledWith("session-token", "Assistant reply", 1);
    expect(container.querySelectorAll(".chat-support-attribution")).toHaveLength(0);
    expect(container.querySelectorAll(".chat-message.assistant")).toHaveLength(2); // Welcome and persisted reply.
    expect(container.textContent).toContain("Assistant reply");
  });
});
