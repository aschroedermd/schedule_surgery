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

  it("treats attending call as shared General Surgery coverage instead of filtering by service", async () => {
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
                      arguments: JSON.stringify({
                        start_date: "2026-08-01",
                        end_date: "2026-08-31",
                        attending_name: "Doctor Harnois"
                      })
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
        choices: [{ message: { role: "assistant", content: "Dr. Harnois is on General Surgery call twice in August." } }]
      });
    }) as typeof fetch;

    const state = createInitialState();
    state.attendings.push({
      id: "att_harnois",
      name: "Dr. Harnois",
      service: "Berry",
      priority: 4,
      defaultHospitalId: "hosp_main"
    });
    state.coverageEntries.push(
      {
        id: "call_att_harnois_1",
        date: "2026-08-01",
        kind: "attending-call",
        dayAttendingId: "att_harnois",
        nightAttendingId: "att_harnois",
        serviceLine: "Berry",
        note: "",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      },
      {
        id: "call_att_harnois_2",
        date: "2026-08-09",
        kind: "attending-call",
        dayAttendingId: "att_harnois",
        nightAttendingId: "att_harnois",
        serviceLine: "Berry",
        note: "",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      }
    );

    const result = await answerScheduleQuestion(
      [{ role: "user", content: "How many times is Doctor Harnois on call during August?" }],
      {
        state,
        user,
        serviceLine: "Davies",
        now: new Date("2026-07-28T16:00:00Z")
      },
      fetcher
    );

    expect(result.message).toBe("Dr. Harnois is on General Surgery call twice in August.");
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatchObject({
      model: "deepseek/deepseek-v4-flash",
      models: ["google/gemma-3-27b-it"]
    });
    expect(JSON.stringify(requests[0].messages)).toContain("Christian Blue");
    expect(JSON.stringify(requests[0].messages)).toContain("Current resident service context: Davies");
    expect(JSON.stringify(requests[0].messages)).toContain("General Surgery call schedule");

    const toolMessage = (requests[1].messages as Array<{ role: string; content: string }>).find(
      (message) => message.role === "tool"
    );
    expect(JSON.parse(toolMessage!.content)).toMatchObject({
      schedule: "General Surgery call",
      service_scope: "All General Surgery services",
      attending_filter: "Doctor Harnois",
      matching_shift_count: 2,
      shifts: [
        { date: "2026-08-01", attending: { all_day: "Dr. Harnois" } },
        { date: "2026-08-09", attending: { all_day: "Dr. Harnois" } }
      ]
    });

    const callTool = (requests[0].tools as Array<{ function: { name: string; parameters: { properties: Record<string, unknown> } } }>).find(
      (tool) => tool.function.name === "get_call_schedule"
    );
    expect(callTool?.function.parameters.properties).toHaveProperty("attending_name");
    expect(callTool?.function.parameters.properties).not.toHaveProperty("service");
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
