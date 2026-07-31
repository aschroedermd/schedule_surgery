import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "./sampleData";
import { answerScheduleQuestion, streamScheduleQuestion, transcribeScheduleAudio } from "./chat";
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

async function captureSystemPrompt(question: string, state = createInitialState()): Promise<string> {
  let systemPrompt = "";
  const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as {
      messages: Array<{ role: string; content: string }>;
    };
    systemPrompt = body.messages.find((message) => message.role === "system")?.content ?? "";
    return Response.json({
      model: "deepseek/deepseek-v4-flash",
      choices: [{ message: { role: "assistant", content: "Answered from fast context." } }]
    });
  }) as typeof fetch;
  await answerScheduleQuestion(
    [{ role: "user", content: question }],
    { state, user, serviceLine: "Davies", now: new Date("2026-07-31T16:00:00Z") },
    fetcher
  );
  return systemPrompt;
}

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
    expect(JSON.stringify(requests[0].messages)).toContain("FAST_CALL_SCHEDULE");
    expect(JSON.stringify(requests[0].messages)).toContain("Dr. Harnois");
    expect(JSON.stringify(requests[0].messages)).toContain("respond immediately from it without making a tool call");

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

  it("injects a detailed service-and-date-sorted case summary for case questions", async () => {
    const prompt = await captureSystemPrompt("Which cases are scheduled this week?");

    expect(prompt).toContain('<FAST_CASE_SCHEDULE cases="4" order="service,date,time" requested_range="2026-07-27..2026-08-02"');
    expect(prompt).toContain("service=Davies");
    expect(prompt).toContain("procedure=Whipple");
    expect(prompt).toContain("duration_min=360");
    expect(prompt).toContain("residents=uncovered");
    expect(prompt).not.toContain("<FAST_CALL_SCHEDULE");
  });

  it("injects vacations, off entries, and unavailable dates for absence questions", async () => {
    const state = createInitialState();
    state.residents[0].vacation = [
      { id: "vac_fast_context", startDate: "2026-08-10", endDate: "2026-08-14" }
    ];

    const prompt = await captureSystemPrompt("Who is off or on vacation?", state);

    expect(prompt).toContain("<FAST_ABSENCE_SCHEDULE");
    expect(prompt).toContain("type=vacation");
    expect(prompt).toContain("start=2026-08-10");
    expect(prompt).toContain("type=off");
    expect(prompt).toContain("reason=paternity");
    expect(prompt).toContain("type=unavailable");
  });

  it("injects clinic, rounding, and uncovered coverage summaries for matching questions", async () => {
    const clinicPrompt = await captureSystemPrompt("What clinic and procedure sessions are scheduled?");
    expect(clinicPrompt).toContain('<FAST_CLINIC_SCHEDULE sessions="2"');
    expect(clinicPrompt).toContain("location=University Hospital Clinic");
    expect(clinicPrompt).toContain("residents=uncovered");

    const roundingPrompt = await captureSystemPrompt("Who is rounding this weekend?");
    expect(roundingPrompt).toContain('<FAST_ROUNDING_SCHEDULE entries="1" requested_range="2026-08-01..2026-08-02"');
    expect(roundingPrompt).toContain("resident=Andrew Schroeder");

    const gapsPrompt = await captureSystemPrompt("Where are the uncovered coverage gaps this week?");
    expect(gapsPrompt).toContain("<FAST_COVERAGE_GAPS");
    expect(gapsPrompt).toContain("type=OR case");
    expect(gapsPrompt).toContain("type=clinic");
  });

  it("injects linked-user, named-person, availability, and rotation summaries", async () => {
    const state = createInitialState();
    state.residents[0].username = user.username;
    state.assignments.push({
      id: "assignment_fast_person",
      kind: "case",
      targetId: "case_chen_whipple",
      residentId: state.residents[0].id,
      locked: false,
      source: "admin",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z"
    });

    const myPrompt = await captureSystemPrompt("What is my schedule this week?", state);
    expect(myPrompt).toContain('<FAST_MY_SCHEDULE people="Adedayo Adeleke"');
    expect(myPrompt).toContain("work=Whipple");

    const personPrompt = await captureSystemPrompt("What is Dr. Chen doing this week?", state);
    expect(personPrompt).toContain('<FAST_PERSON_SCHEDULE people="Dr. Chen"');
    expect(personPrompt).toContain("type=OR attending");

    const availabilityPrompt = await captureSystemPrompt("Is Adeleke available to cover this week?", state);
    expect(availabilityPrompt).toContain('<FAST_AVAILABILITY people="Adedayo Adeleke"');

    const rotationPrompt = await captureSystemPrompt("What rotation is Adeleke on in August?", state);
    expect(rotationPrompt).toContain("<FAST_ROTATIONS");
    expect(rotationPrompt).toContain("resident=Adedayo Adeleke");
  });

  it("narrows fast context by month and hospital and includes pending trade requests", async () => {
    const state = createInitialState();
    state.coverageRequests.push({
      id: "request_fast_trade",
      requestType: "resident-trade",
      action: "update",
      status: "pending",
      requesterResidentId: state.residents[0].id,
      targetResidentId: state.residents[1].id,
      requesterName: state.residents[0].name,
      message: "Swap weekend coverage",
      createdAt: "2026-07-30T00:00:00.000Z",
      updatedAt: "2026-07-30T00:00:00.000Z"
    });

    const hospitalPrompt = await captureSystemPrompt("What surgery is at WCH this week?", state);
    expect(hospitalPrompt).toContain("hospital=WCH");
    expect(hospitalPrompt).not.toContain("hospital=UH");

    const augustPrompt = await captureSystemPrompt("Who is on call in August?", state);
    expect(augustPrompt).toContain('requested_range="2026-08-01..2026-08-31"');
    expect(augustPrompt).not.toContain("date=2026-07-31");

    const requestPrompt = await captureSystemPrompt("Are there any pending trade requests?", state);
    expect(requestPrompt).toContain('<FAST_PENDING_REQUESTS entries="1"');
    expect(requestPrompt).toContain("message=Swap weekend coverage");
  });

  it("uses word boundaries so callback, Casey, and office do not trigger fast schedule context", async () => {
    const prompt = await captureSystemPrompt("Can you callback Casey at the office?");

    expect(prompt).toContain("No fast schedule context was triggered");
    expect(prompt).not.toContain("<FAST_CALL_SCHEDULE");
    expect(prompt).not.toContain("<FAST_CASE_SCHEDULE");
    expect(prompt).not.toContain("<FAST_ABSENCE_SCHEDULE");
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

  it("streams answer text and returns the schedule version it checked", async () => {
    const deltas: string[] = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ stream: true });
      return new Response(
        [
          `data: ${JSON.stringify({
            model: "deepseek/deepseek-v4-flash",
            choices: [{ delta: { content: "You are on " } }]
          })}`,
          `data: ${JSON.stringify({
            choices: [{ delta: { content: "call Saturday." } }]
          })}`,
          "data: [DONE]",
          ""
        ].join("\n"),
        { headers: { "content-type": "text/event-stream" } }
      );
    }) as typeof fetch;
    const state = createInitialState();

    const result = await streamScheduleQuestion(
      [{ role: "user", content: "Am I on call Saturday?" }],
      { state, user, serviceLine: "Davies", now: new Date("2026-07-28T16:00:00Z") },
      (delta) => deltas.push(delta),
      fetcher
    );

    expect(deltas).toEqual(["You are on ", "call Saturday."]);
    expect(result).toMatchObject({
      message: "You are on call Saturday.",
      model: "deepseek/deepseek-v4-flash",
      checkedAt: "2026-07-28T16:00:00.000Z",
      dataUpdatedAt: state.updatedAt,
      stateVersion: state.version,
      lookups: []
    });
  });

  it("recovers when the model streams a preamble before requesting a schedule tool", async () => {
    const deltas: string[] = [];
    let resets = 0;
    let requestNumber = 0;
    const fetcher = vi.fn(async () => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return new Response(
          [
            `data: ${JSON.stringify({
              model: "deepseek/deepseek-v4-flash",
              choices: [{ delta: { content: "Let me check that." } }]
            })}`,
            `data: ${JSON.stringify({
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: "call_mixed",
                    function: {
                      name: "get_call_schedule",
                      arguments: JSON.stringify({ start_date: "2026-07-01", end_date: "2026-07-31" })
                    }
                  }]
                }
              }]
            })}`,
            "data: [DONE]",
            ""
          ].join("\n"),
          { headers: { "content-type": "text/event-stream" } }
        );
      }
      return new Response(
        [
          `data: ${JSON.stringify({
            model: "deepseek/deepseek-v4-flash",
            choices: [{ delta: { content: "Dr. Collins is on call twice." } }]
          })}`,
          "data: [DONE]",
          ""
        ].join("\n"),
        { headers: { "content-type": "text/event-stream" } }
      );
    }) as typeof fetch;
    const state = createInitialState();

    const result = await streamScheduleQuestion(
      [{ role: "user", content: "Who is on call with Dr. Collins over the next few months?" }],
      { state, user, serviceLine: "Davies", now: new Date("2026-07-28T16:00:00Z") },
      (delta) => deltas.push(delta),
      fetcher,
      undefined,
      () => {
        resets += 1;
      }
    );

    expect(resets).toBe(1);
    expect(deltas).toEqual(["Let me check that.", "Dr. Collins is on call twice."]);
    expect(result.message).toBe("Dr. Collins is on call twice.");
    expect(result.lookups).toHaveLength(1);
    expect(result.lookups[0].tool).toBe("get_call_schedule");
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
