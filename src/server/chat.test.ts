import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialState } from "./sampleData";
import { answerScheduleQuestion, refreshScheduleLookups, streamScheduleQuestion, synthesizeScheduleSpeech, transcribeScheduleAudio } from "./chat";
import { MemoryStateStore } from "./store";
import { SessionUser } from "../shared/types";

const user: SessionUser = {
  username: "cblue",
  displayName: "Christian Blue",
  role: "viewer",
  servicePrivileges: { Davies: "view" },
  canAddContacts: false,
  passwordUpdatedAt: new Date(0).toISOString(),
  mustChangePassword: false
};

const openAISettings = {
  chatProvider: "openai" as const,
  primaryModel: "gpt-5.6-luna",
  fallbackModels: ["gpt-5.6-terra"],
  transcriptionModel: "nvidia/parakeet-tdt-0.6b-v3",
  voiceModel: "fish-audio/s2.1-pro-free:free",
  voiceName: "David Attenborough Dramatic",
  elevenLabsModel: "eleven_multilingual_v2",
  elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"] as [string, string, string]
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
    process.env.CHAT_PROVIDER = "openrouter";
    process.env.OPENAI_API_KEY = "test-openai-key";
    process.env.OPENROUTER_API_KEY = "test-openrouter-key";
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    process.env.CHAT_QUOTA_TIME_ZONE = "America/New_York";
  });

  it("injects the authoritative contact directory for phone-number questions", async () => {
    const prompt = await captureSystemPrompt("What is the Lab Hematology phone number?");

    expect(prompt).toContain("The Contacts directory is authoritative for hospital, resident, faculty, ACP, and administrative staff phone numbers");
    expect(prompt).toContain('<FAST_CONTACT_DIRECTORY contacts="129" authoritative="true">');
    expect(prompt).toContain("name=Lab – Hematology|phone=(540) 853-0617|directory_type=Hospital|category=Ancillary Services");
    expect(prompt).toContain("name=PACU|phone=(540) 981-7173|directory_type=Hospital|category=Perioperative");
    expect(prompt).toContain("name=Andrew Schroeder|phone=(540) 204-5505|directory_type=Residents|category=PGY-5");
    expect(prompt).toContain("name=David Salzberg|phone=(540) 855-0810|directory_type=Faculty & Staff|category=Faculty");
    expect(prompt).toContain("name=Matthew Anderson|phone=(540) 566-8297|directory_type=Residents|category=Plastic Surgery Residents");
  });

  it("lets the model search persisted contacts and returns formatted numbers", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return Response.json({
          model: "deepseek/deepseek-v4-flash",
          choices: [{
            message: {
              role: "assistant",
              content: null,
              tool_calls: [{
                id: "contact_1",
                type: "function",
                function: { name: "search_contacts", arguments: JSON.stringify({ query: "PACU" }) }
              }]
            }
          }]
        });
      }
      return Response.json({
        model: "deepseek/deepseek-v4-flash",
        choices: [{ message: { role: "assistant", content: "PACU is (540) 981-7173." } }]
      });
    }) as typeof fetch;

    const result = await answerScheduleQuestion(
      [{ role: "user", content: "How do I reach PACU?" }],
      { state: createInitialState(), user, serviceLine: "Davies" },
      fetcher
    );

    expect(result.message).toBe("PACU is (540) 981-7173.");
    expect(result.lookups).toEqual([expect.objectContaining({
      tool: "search_contacts",
      arguments: { query: "PACU" },
      result: {
        query: "PACU",
        match_count: 1,
        matches: [{
          name: "PACU",
          phone_number: "(540) 981-7173",
          directory_type: "Hospital",
          category: "Perioperative",
          organization: "Hospital Directory"
        }]
      }
    })]);
    const tools = requests[0].tools as Array<{ function: { name: string; description: string } }>;
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({ function: expect.objectContaining({ name: "search_contacts" }) })
    ]));
  });

  it("searches contacts by category and partial multi-word names", () => {
    const context = { state: createInitialState(), user, serviceLine: "Davies" };
    const [icuLookup, mountainLookup] = refreshScheduleLookups(
      [
        { tool: "search_contacts", arguments: { query: "ICU" } },
        { tool: "search_contacts", arguments: { query: "9 Mountain" } }
      ],
      context
    );

    expect(icuLookup.result).toMatchObject({ match_count: 3 });
    expect((icuLookup.result as { matches: Array<{ name: string }> }).matches.map((contact) => contact.name)).toEqual([
      "10 Mountain ICU",
      "6 Mountain ICU",
      "9 Mountain ICU"
    ]);
    expect(mountainLookup.result).toMatchObject({ match_count: 2 });
    expect((mountainLookup.result as { matches: Array<{ name: string }> }).matches.map((contact) => contact.name)).toEqual([
      "9 Mountain ICU",
      "9 Mountain PCU"
    ]);
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
    expect(JSON.stringify(requests[0].messages)).toContain("Resident call is shared across General Surgery services");
    expect(JSON.stringify(requests[0].messages)).toContain("FAST_CALL_SCHEDULE");
    expect(JSON.stringify(requests[0].messages)).toContain("Dr. Harnois");
    expect(JSON.stringify(requests[0].messages)).toContain("Use fast context when sufficient");

    const toolMessage = (requests[1].messages as Array<{ role: string; content: string }>).find(
      (message) => message.role === "tool"
    );
    expect(JSON.parse(toolMessage!.content)).toMatchObject({
      schedule: "General Surgery call",
      service_scope: "All General Surgery services",
      resident_coverage_model: {
        night_float: "Three-person resident team every Sunday-Thursday night",
        friday: "Separate three-person resident team Friday night",
        saturday: "Separate three-person resident team Saturday day and night",
        sunday: "Separate three-person resident team Sunday day; night float returns Sunday night"
      },
      attending_coverage_model: "Separate schedule with one surgery attending each night; not a resident-style team",
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

  it("uses the configured primary and fallback OpenRouter models", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "deepseek/deepseek-v4-flash-0731",
        models: ["anthropic/claude-sonnet-4", "google/gemma-3-27b-it"]
      });
      return Response.json({
        model: "deepseek/deepseek-v4-flash-0731",
        choices: [{ message: { role: "assistant", content: "Configured model answered." } }]
      });
    }) as typeof fetch;

    const result = await answerScheduleQuestion(
      [{ role: "user", content: "Who is on call?" }],
      { state: createInitialState(), user, serviceLine: "Davies" },
      fetcher,
      {
        chatProvider: "openrouter",
        primaryModel: "deepseek/deepseek-v4-flash-0731",
        fallbackModels: ["anthropic/claude-sonnet-4", "google/gemma-3-27b-it"],
        transcriptionModel: "nvidia/parakeet-tdt-0.6b-v3",
        voiceModel: "fish-audio/s2.1-pro-free:free",
        voiceName: "David Attenborough Dramatic",
        elevenLabsModel: "eleven_multilingual_v2",
        elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"]
      }
    );

    expect(result.model).toBe("deepseek/deepseek-v4-flash-0731");
  });

  it("uses OpenAI Responses and falls back from Luna to Terra", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://api.openai.com/v1/responses");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-openai-key");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return Response.json({ error: { message: "Primary model is temporarily busy" } }, { status: 429 });
      }
      return Response.json({
        model: "gpt-5.6-terra",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "Terra answered." }] }]
      });
    }) as typeof fetch;

    const result = await answerScheduleQuestion(
      [{ role: "user", content: "Who is on call?" }],
      { state: createInitialState(), user, serviceLine: "Davies" },
      fetcher,
      openAISettings
    );

    expect(requests.map((request) => request.model)).toEqual(["gpt-5.6-luna", "gpt-5.6-terra"]);
    expect(requests[0]).toMatchObject({
      store: false,
      max_output_tokens: 1100,
      include: ["reasoning.encrypted_content"]
    });
    expect(requests[0].input).toEqual(expect.arrayContaining([expect.objectContaining({ role: "developer" })]));
    expect(requests[0].tools).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "function", name: "get_call_schedule" })])
    );
    expect(result).toMatchObject({ message: "Terra answered.", model: "gpt-5.6-terra" });
  });

  it("replays OpenAI response items and tool outputs across lookup rounds", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const reasoningItem = { type: "reasoning", id: "reasoning_1", encrypted_content: "encrypted" };
    const functionCall = {
      type: "function_call",
      id: "fc_1",
      call_id: "call_1",
      name: "get_call_schedule",
      arguments: JSON.stringify({ start_date: "2026-08-01", end_date: "2026-08-02" })
    };
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      requests.push(body);
      if (requests.length === 1) {
        return Response.json({ model: "gpt-5.6-luna", output: [reasoningItem, functionCall] });
      }
      return Response.json({
        model: "gpt-5.6-luna",
        output_text: "The call schedule is ready.",
        output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "The call schedule is ready." }] }]
      });
    }) as typeof fetch;

    const result = await answerScheduleQuestion(
      [{ role: "user", content: "Who is on call this weekend?" }],
      { state: createInitialState(), user, serviceLine: "Davies" },
      fetcher,
      openAISettings
    );

    expect(requests).toHaveLength(2);
    expect(requests[1].input).toEqual(
      expect.arrayContaining([
        reasoningItem,
        functionCall,
        expect.objectContaining({ type: "function_call_output", call_id: "call_1" })
      ])
    );
    expect(result.message).toBe("The call schedule is ready.");
    expect(result.lookups).toHaveLength(1);
  });

  it("streams OpenAI Responses API text", async () => {
    const deltas: string[] = [];
    const messageItem = {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "Luna answered." }]
    };
    const fetcher = vi.fn(async () => new Response(
      [
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "Luna " })}`,
        `data: ${JSON.stringify({ type: "response.output_text.delta", delta: "answered." })}`,
        `data: ${JSON.stringify({ type: "response.output_item.done", item: messageItem })}`,
        `data: ${JSON.stringify({ type: "response.completed", response: { model: "gpt-5.6-luna", output: [messageItem] } })}`,
        "data: [DONE]",
        ""
      ].join("\n"),
      { headers: { "content-type": "text/event-stream" } }
    )) as typeof fetch;

    const result = await streamScheduleQuestion(
      [{ role: "user", content: "Who is on call?" }],
      { state: createInitialState(), user, serviceLine: "Davies" },
      (delta) => deltas.push(delta),
      fetcher,
      undefined,
      () => undefined,
      openAISettings
    );

    expect(deltas).toEqual(["Luna ", "answered."]);
    expect(result).toMatchObject({ message: "Luna answered.", model: "gpt-5.6-luna" });
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

  it("distinguishes resident teams from attending call and supplies the signed-in resident's teammates", async () => {
    const state = createInitialState();
    const currentResident = state.residents.find((resident) => resident.username === user.username)!;
    const teammates = state.residents.filter((resident) => resident.id !== currentResident.id).slice(0, 2);
    const createdAt = "2026-08-01T00:00:00.000Z";
    state.coverageEntries.push(
      {
        id: "call_team_current",
        date: "2026-09-04",
        kind: "call",
        residentId: currentResident.id,
        callPosition: "senior",
        note: "",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "call_team_mid",
        date: "2026-09-04",
        kind: "call",
        residentId: teammates[0].id,
        callPosition: "mid-level",
        note: "",
        createdAt,
        updatedAt: createdAt
      },
      {
        id: "call_team_intern",
        date: "2026-09-04",
        kind: "call",
        residentId: teammates[1].id,
        callPosition: "intern",
        note: "",
        createdAt,
        updatedAt: createdAt
      }
    );

    const prompt = await captureSystemPrompt(
      "Can you provide the names of all the residents that I'm on call with in September 2026?",
      state
    );

    expect(prompt).toContain("Resident call and attending call are separate schedules");
    expect(prompt).toContain("Night float covers 5 p.m. Sunday through Friday morning");
    expect(prompt).toContain("Attending night call is one attending");
    expect(prompt).toContain("Practice, Vascular, and Pediatrics belong on the Call tab");
    expect(prompt).toContain('<FAST_MY_RESIDENT_CALL_TEAMS linked="true"');
    expect(prompt).toContain("shift=Friday night resident call");
    expect(prompt).toContain(`teammates=${teammates.map((resident) => resident.name).join(", ")}`);
    expect(prompt).toContain("shift=night float (Sunday-Thursday night)");
    expect(prompt).toContain("unique_teammates=");
    for (const teammate of teammates) expect(prompt).toContain(teammate.name);
  });

  it("uses word boundaries so callback, Casey, and office do not trigger fast schedule context", async () => {
    const prompt = await captureSystemPrompt("Can you callback Casey at the office?");

    expect(prompt).toContain("No fast schedule context was triggered");
    expect(prompt).not.toContain("<FAST_CALL_SCHEDULE");
    expect(prompt).not.toContain("<FAST_CASE_SCHEDULE");
    expect(prompt).not.toContain("<FAST_ABSENCE_SCHEDULE");
  });

  it("teaches local coverage rules and injects linked wiki context", async () => {
    const prompt = await captureSystemPrompt("Who could cover an uncovered FMH case after Saturday call?");

    expect(prompt).toContain("Friday callers are post-call Saturday and Saturday callers are post-call Sunday");
    expect(prompt).toContain("Davies, Fogel/Colorectal, Breast, Berry, or Endoscopy");
    expect(prompt).toContain("Ferrara/EGS is busy");
    expect(prompt).toContain("Omit endoscopy and FMH from general coverage-gap answers unless explicitly requested");
    expect(prompt).toContain('<WIKI_ARTICLE slug="hospital-fmh"');
    expect(prompt).toContain('<WIKI_ARTICLE slug="or-coverage"');
  });

  it("returns a validated single-choice interaction when the model asks a clarification", async () => {
    const fetcher = vi.fn(async () => Response.json({
      model: "deepseek/deepseek-v4-flash",
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "question_1",
            type: "function",
            function: {
              name: "ask_user_question",
              arguments: JSON.stringify({
                prompt: "Which call schedule do you mean?",
                options: [
                  { id: "resident", label: "Resident call", description: "Three-person resident team" },
                  { id: "attending", label: "Attending call", description: "Attending coverage" }
                ]
              })
            }
          }]
        }
      }]
    })) as typeof fetch;

    const answer = await answerScheduleQuestion(
      [{ role: "user", content: "Who is on call?" }],
      { state: createInitialState(), user, serviceLine: "Davies", now: new Date("2026-08-01T12:00:00Z") },
      fetcher
    );

    expect(answer.message).toBe("Which call schedule do you mean?");
    expect(answer.interaction).toEqual({
      type: "single_choice",
      prompt: "Which call schedule do you mean?",
      options: [
        { id: "resident", label: "Resident call", description: "Three-person resident team" },
        { id: "attending", label: "Attending call", description: "Attending coverage" }
      ]
    });
    expect(answer.lookups).toEqual([]);
    expect(fetcher).toHaveBeenCalledOnce();
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

  it("uses Fish Audio S2.1 Pro with the requested dramatic voice", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/audio/speech");
      expect(JSON.parse(String(init?.body))).toEqual({
        model: "fish-audio/s2.1-pro-free:free",
        input: "You are on call Saturday.",
        voice: "David Attenborough Dramatic",
        response_format: "mp3"
      });
      return new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } });
    }) as typeof fetch;

    const result = await synthesizeScheduleSpeech("You are on call Saturday.", 4, fetcher);

    expect(result.contentType).toBe("audio/mpeg");
    expect([...result.audio]).toEqual([73, 68, 51]);
  });

  it("uses the configured speech model and voice", async () => {
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        model: "fish-audio/s2-pro",
        voice: "Custom Narrator"
      });
      return new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } });
    }) as typeof fetch;

    await synthesizeScheduleSpeech("A concise answer.", 4, fetcher, {
      chatProvider: "openrouter",
      primaryModel: "deepseek/deepseek-v4-flash",
      fallbackModels: ["google/gemma-3-27b-it"],
      transcriptionModel: "nvidia/parakeet-tdt-0.6b-v3",
      voiceModel: "fish-audio/s2-pro",
      voiceName: "Custom Narrator",
      elevenLabsModel: "eleven_multilingual_v2",
      elevenLabsVoiceIds: ["kSvMZug5ZFM9sKGpLAei", "dWAnId3mzfl4fTszwtOG", "0rEo3eAjssGDUCXHYENf"]
    });
  });

  it("uses ElevenLabs for presets 1 through 3", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe(
        "https://api.elevenlabs.io/v1/text-to-speech/dWAnId3mzfl4fTszwtOG?output_format=mp3_44100_128"
      );
      expect(new Headers(init?.headers).get("xi-api-key")).toBe("test-elevenlabs-key");
      expect(JSON.parse(String(init?.body))).toEqual({
        text: "A concise answer.",
        model_id: "eleven_multilingual_v2"
      });
      return new Response(new Uint8Array([73, 68, 51]), { headers: { "content-type": "audio/mpeg" } });
    }) as typeof fetch;

    await synthesizeScheduleSpeech("A concise answer.", 2, fetcher);
  });

  it("instructs voice-mode answers to be short spoken dialogue without visual formatting", async () => {
    let systemPrompt = "";
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      systemPrompt = body.messages.find((message) => message.role === "system")?.content ?? "";
      return Response.json({
        model: "deepseek/deepseek-v4-flash",
        choices: [{ message: { role: "assistant", content: "You are on call Saturday." } }]
      });
    }) as typeof fetch;

    await answerScheduleQuestion(
      [{ role: "user", content: "Am I on call Saturday?" }],
      { state: createInitialState(), user, serviceLine: "Davies", voiceMode: true },
      fetcher
    );

    expect(systemPrompt).toContain("Voice mode is enabled");
    expect(systemPrompt).toContain("one to three short sentences");
    expect(systemPrompt).toContain("Do not use Markdown, tables, bullets, headings, figures");
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

  it("allows exactly 3 spoken responses per user and date", async () => {
    const store = new MemoryStateStore(createInitialState());
    for (let requestNumber = 1; requestNumber <= 3; requestNumber += 1) {
      await expect(store.consumeVoiceQuota("cblue", "2026-07-28", 3)).resolves.toMatchObject({
        allowed: true,
        used: requestNumber,
        remaining: 3 - requestNumber
      });
    }
    await expect(store.consumeVoiceQuota("cblue", "2026-07-28", 3)).resolves.toEqual({
      allowed: false,
      used: 3,
      remaining: 0
    });
    await expect(store.getVoiceQuota("cblue", "2026-07-29", 3)).resolves.toEqual({ used: 0, remaining: 3 });
  });
});
