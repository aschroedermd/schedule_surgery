import { describe, expect, it } from "vitest";
import { compareCallOffRequestPrecedence, getCallOffRequestSeniority } from "./callOffRequests";
import type { CallOffRequest, Resident } from "./types";

function request(id: string, residentId: string, priority: CallOffRequest["priority"], createdAt: string): CallOffRequest {
  return {
    id,
    residentId,
    requesterUsername: residentId,
    requesterName: residentId,
    date: "2026-09-05",
    scope: "weekend",
    priority,
    createdAt,
    updatedAt: createdAt
  };
}

describe("call-off request precedence", () => {
  it("groups PGY-4/5 above PGY-2/3 above PGY-1", () => {
    expect((["PGY5", "PGY4"] as const).map((level) => getCallOffRequestSeniority(level).rank)).toEqual([0, 0]);
    expect((["PGY3", "PGY2"] as const).map((level) => getCallOffRequestSeniority(level).rank)).toEqual([1, 1]);
    expect(getCallOffRequestSeniority("PGY1").rank).toBe(2);
  });

  it("orders each request tier by seniority before timestamp", () => {
    const residents = new Map<string, Pick<Resident, "trainingLevel">>([
      ["junior-early", { trainingLevel: "PGY1" }],
      ["senior-late", { trainingLevel: "PGY4" }],
      ["mid-early", { trainingLevel: "PGY2" }],
      ["mid-late", { trainingLevel: "PGY3" }]
    ]);
    const requests = [
      request("junior", "junior-early", "priority", "2026-07-01T00:00:00.000Z"),
      request("mid-late", "mid-late", "priority", "2026-07-04T00:00:00.000Z"),
      request("senior", "senior-late", "priority", "2026-07-05T00:00:00.000Z"),
      request("mid-early", "mid-early", "priority", "2026-07-02T00:00:00.000Z")
    ];

    expect(requests.sort((left, right) => compareCallOffRequestPrecedence(left, right, residents)).map((item) => item.id)).toEqual([
      "senior",
      "mid-early",
      "mid-late",
      "junior"
    ]);
  });
});
