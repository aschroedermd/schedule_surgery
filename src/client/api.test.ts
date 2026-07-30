import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchState, streamChatMessage } from "./api";

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

    const response = await streamChatMessage(
      "token",
      [{ role: "user", content: "Who is on call?" }],
      "Davies",
      { onDelta: (delta) => deltas.push(delta) }
    );

    expect(deltas).toEqual(["On call: ", "Dr. Blue"]);
    expect(response).toMatchObject({ message: "On call: Dr. Blue", stateVersion: 7, remaining: 19 });
  });
});
