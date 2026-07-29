import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "./sampleData";
import { answerScheduleQuestion, transcribeScheduleAudio } from "./chat";
import { MemoryStateStore } from "./store";
import { SessionUser } from "../shared/types";

const user: SessionUser = {
  username: "cblue",
  displayName: "Christian Blue",
  role: "viewer",
  servicePrivileges: { Davies: "view" },
  passwordUpdatedAt: new Date(0).toISOString(),
  mustChangePassword: false
};

describe("schedule assistant", () => {
  beforeEach(() => {
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.CHAT_QUOTA_TIME_ZONE = "America/New_York";
  });

  it("sends identity and service context, configures fallback, and completes tool calls", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return Response.json({
          model: "deepseek/deepseek-v4-flash",
          choices: [
            {
              message: {
                role: "assistant",
                content: null,
                tool_calls: [
                  {
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "get_call_schedule",
                      arguments: JSON.stringify({ start_date: "2026-07-28", end_date: "2026-07-30" })
                    }
                  }
                ]
              }
            }
          ]
        });
      }
      return Response.json({
        model: "deepseek/deepseek-v4-flash",
        choices: [{ message: { role: "assistant", content: "I checked the Davies call schedule." } }]
      });
    }) as typeof fetch;

    const result = await answerScheduleQuestion(
      [{ role: "user", content: "Who is on call?" }],
      {
        state: createInitialState(),
        user,
        serviceLine: "Davies",
        now: new Date("2026-07-28T16:00:00Z")
      },
      fetcher
    );

    expect(result.message).toBe("I checked the Davies call schedule.");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      models: ["google/gemma-3-27b-it"]
    });
    expect(JSON.stringify(requests[0].messages)).toContain("Christian Blue");
    expect(JSON.stringify(requests[0].messages)).toContain("Current service: Davies");
    expect(JSON.stringify(requests[1].messages)).toContain('"role":"tool"');
  });

  it("uses the Parakeet transcription endpoint payload", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/transcriptions");
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "nvidia/parakeet-tdt-0.6b-v3",
        input_audio: { data: "d2F2", format: "wav" }
      });
      return Response.json({ text: "Who is on call tomorrow?" });
    }) as typeof fetch;

    await expect(transcribeScheduleAudio({ data: "d2F2", format: "wav" }, fetcher)).resolves.toBe(
      "Who is on call tomorrow?"
    );
  });
});

describe("daily chat quota", () => {
  it("allows exactly 20 requests per user and date", async () => {
    const store = new MemoryStateStore(createInitialState());
    for (let requestNumber = 1; requestNumber <= 20; requestNumber += 1) {
      await expect(store.consumeChatQuota("cblue", "2026-07-28", 20)).resolves.toMatchObject({
        allowed: true,
        used: requestNumber,
        remaining: 20 - requestNumber
      });
    }
    await expect(store.consumeChatQuota("cblue", "2026-07-28", 20)).resolves.toEqual({
      allowed: false,
      used: 20,
      remaining: 0
    });
    await expect(store.getChatQuota("cblue", "2026-07-29", 20)).resolves.toEqual({ used: 0, remaining: 20 });
  });
});
