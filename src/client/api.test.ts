import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchState, streamChatMessage, synthesizeChatSpeech } from "./api";

describe("client API requests", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports empty successful responses without leaking the raw JSON parser error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 200 })));

    await expect(fetchState("token")).rejects.toThrow("Empty response from /api/state");
  });

  it("reports empty failed responses by status", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 500 })));

    await expect(fetchState("token")).rejects.toThrow("Request failed: 500");
  });

  it("delivers streamed assistant deltas and completion metadata", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          [
            JSON.stringify({
              type: "meta",
              used: 1,
              remaining: 19,
              limit: 20,
              warningThreshold: 5,
              checkedAt: "2026-07-29T15:00:00.000Z",
              dataUpdatedAt: "2026-07-29T14:59:00.000Z",
              stateVersion: 7
            }),
            JSON.stringify({ type: "delta", delta: "Checking…" }),
            JSON.stringify({ type: "reset" }),
            JSON.stringify({ type: "delta", delta: "On call: " }),
            JSON.stringify({ type: "delta", delta: "Dr. Blue" }),
            JSON.stringify({
              type: "complete",
              message: "On call: Dr. Blue",
              model: "test-model",
              used: 1,
              remaining: 19,
              limit: 20,
              warningThreshold: 5,
              checkedAt: "2026-07-29T15:00:00.000Z",
              dataUpdatedAt: "2026-07-29T14:59:00.000Z",
              stateVersion: 7,
              lookups: []
            }),
            ""
          ].join("\n"),
          { headers: { "content-type": "application/x-ndjson" } }
        )
      )
    );
    const deltas: string[] = [];
    let resets = 0;

    const response = await streamChatMessage(
      "token",
      [{ role: "user", content: "Who is on call?" }],
      "Davies",
      {
        onDelta: (delta) => deltas.push(delta),
        onReset: () => {
          resets += 1;
        }
      }
    );

    expect(deltas).toEqual(["Checking…", "On call: ", "Dr. Blue"]);
    expect(resets).toBe(1);
    expect(response).toMatchObject({ message: "On call: Dr. Blue", stateVersion: 7, remaining: 19 });
  });

  it("returns generated speech and its daily allowance from response headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({ input: "You are on call Saturday.", voicePreset: 1 });
        return new Response(new Uint8Array([73, 68, 51]), {
          headers: {
            "content-type": "audio/mpeg",
            "x-voice-used": "5",
            "x-voice-remaining": "0",
            "x-voice-limit": "5",
            "x-voice-unlimited": "false"
          }
        });
      })
    );

    const result = await synthesizeChatSpeech("token", "You are on call Saturday.", 1);

    expect(result.audio.type).toBe("audio/mpeg");
    expect(result.quota).toEqual({ used: 5, remaining: 0, limit: 5, unlimited: false });
  });
});
