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
  fetchSupportConversation: vi.fn(), streamChatMessage: vi.fn(), synthesizeChatSpeech: vi.fn()
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
  it("restores human history without a join indicator, popup, or alert", async () => {
    snapshot = { ...snapshot, humanJoined: true, revision: 2, messages: [
      { id: "user-one", role: "user", content: "Question", createdAt: new Date().toISOString() },
      { id: "reply-one", role: "assistant", content: "Human answer", responder: "human", createdAt: new Date().toISOString() }
    ] };
    await act(async () => root.render(<ChatTab {...props} />));
    expect(container.querySelector(".chat-support-presence")?.textContent).toBe("");
    expect(container.querySelector(".chat-support-attribution")?.textContent).toBe("Human support");
    expect(container.textContent).toContain("Human answer");
    expect(container.querySelector('[role="dialog"], [role="alert"]')).toBeNull();
    snapshot = { ...snapshot, humanJoined: false };
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(container.querySelector(".chat-support-presence")?.textContent).toBe("");
    expect(container.textContent).toContain("Human answer");
    expect(container.querySelector(".chat-support-attribution")).not.toBeNull();
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

  it("streams a human reply with attribution and invokes the existing spoken-response path once", async () => {
    snapshot = { ...snapshot, humanJoined: true };
    await act(async () => root.render(<ChatTab {...props} />));
    const toggle = container.querySelector<HTMLButtonElement>(".chat-voice-mode-button")!;
    await act(async () => toggle.click());
    vi.mocked(api.synthesizeChatSpeech).mockRejectedValueOnce(new Error("Test audio unavailable"));
    vi.mocked(api.streamChatMessage).mockImplementationOnce(async (_token, _messages, _service, handlers, _signal, voiceMode, _preset, turn) => {
      expect(voiceMode).toBe(true); expect(turn).toMatchObject({ revision: 0, content: "Question" });
      handlers.onMeta?.({ ...quota, responder: "human", checkedAt: "now", dataUpdatedAt: "now", stateVersion: 1 });
      handlers.onDelta("Human "); handlers.onDelta("reply");
      snapshot = { ...snapshot, revision: 2, messages: [
        { id: turn!.messageId, role: "user", content: "Question", createdAt: new Date().toISOString() },
        { id: "reply-id", role: "assistant", content: "Human reply", responder: "human", createdAt: new Date().toISOString() }
      ] };
      return { ...quota, message: "Human reply", model: "human-support", checkedAt: "now", dataUpdatedAt: "now", stateVersion: 1, lookups: [], responder: "human", messageId: "reply-id", revision: 2 };
    });
    const input = container.querySelector<HTMLTextAreaElement>(".chat-composer textarea")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Question");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { container.querySelector(".chat-composer")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(api.synthesizeChatSpeech).toHaveBeenCalledTimes(1);
    expect(api.synthesizeChatSpeech).toHaveBeenCalledWith("session-token", "Human reply", 1);
    expect(container.querySelectorAll(".chat-support-attribution")).toHaveLength(1);
    expect(container.querySelectorAll(".chat-message.assistant")).toHaveLength(2); // Welcome and persisted reply.
    expect(container.textContent).toContain("Human reply");
  });
});
