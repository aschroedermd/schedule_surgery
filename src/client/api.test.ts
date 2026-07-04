import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchState } from "./api";

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
});
