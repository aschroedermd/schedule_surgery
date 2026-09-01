import { describe, expect, it } from "vitest";
import type { CallOffRequest } from "../shared/types";
import {
  getCallOffRequestDates,
  getCallOffRequestResidentIdsByDate,
  groupCallOffRequestsByResident
} from "./callOffRequestCalendar";

const block = { startDate: "2026-09-01", endDate: "2026-09-28" };

function request(
  id: string,
  residentId: string,
  date: string,
  scope: CallOffRequest["scope"] = "weekend",
  priority: CallOffRequest["priority"] = "priority"
): CallOffRequest {
  return {
    id,
    residentId,
    requesterUsername: residentId,
    requesterName: residentId,
    date,
    scope,
    priority,
    createdAt: "2026-08-01T12:00:00.000Z",
    updatedAt: "2026-08-01T12:00:00.000Z"
  };
}

describe("off-call request calendar", () => {
  it("expands whole-weekend requests across Friday, Saturday, and Sunday", () => {
    expect(getCallOffRequestDates(request("one", "resident-a", "2026-09-04"), block)).toEqual([
      "2026-09-04",
      "2026-09-05",
      "2026-09-06"
    ]);
  });

  it("counts unique residents on each requested date", () => {
    const requests = [
      request("one", "resident-a", "2026-09-04"),
      request("two", "resident-b", "2026-09-05"),
      request("three", "resident-c", "2026-09-06"),
      request("duplicate-tier", "resident-a", "2026-09-04", "weekend", "secondary")
    ];

    const residentsByDate = getCallOffRequestResidentIdsByDate(requests, block);

    expect(residentsByDate["2026-09-04"]).toHaveLength(3);
    expect(residentsByDate["2026-09-05"]).toHaveLength(3);
    expect(residentsByDate["2026-09-06"]).toHaveLength(3);
  });

  it("groups only in-block requests under alphabetized resident names", () => {
    const grouped = groupCallOffRequestsByResident(
      [
        request("zeta", "resident-z", "2026-09-11"),
        request("alpha", "resident-a", "2026-09-04"),
        request("outside", "resident-o", "2026-10-02")
      ],
      [
        { id: "resident-z", name: "Taylor Zebra" },
        { id: "resident-a", name: "Jamie Adams" },
        { id: "resident-o", name: "Morgan Outside" }
      ],
      block
    );

    expect(grouped.map((group) => group.residentName)).toEqual(["Jamie Adams", "Taylor Zebra"]);
  });

  it("orders residents by seniority and then request timestamp", () => {
    const early = request("early-mid", "resident-mid-early", "2026-09-04");
    const late = request("late-mid", "resident-mid-late", "2026-09-04");
    early.createdAt = "2026-07-01T12:00:00.000Z";
    late.createdAt = "2026-07-02T12:00:00.000Z";
    const grouped = groupCallOffRequestsByResident(
      [
        request("intern", "resident-intern", "2026-09-04"),
        late,
        request("senior", "resident-senior", "2026-09-04"),
        early
      ],
      [
        { id: "resident-intern", name: "Intern", trainingLevel: "PGY1" },
        { id: "resident-mid-late", name: "Later Mid", trainingLevel: "PGY3" },
        { id: "resident-senior", name: "Senior", trainingLevel: "PGY4" },
        { id: "resident-mid-early", name: "Earlier Mid", trainingLevel: "PGY2" }
      ],
      block
    );

    expect(grouped.map((group) => group.residentId)).toEqual([
      "resident-senior",
      "resident-mid-early",
      "resident-mid-late",
      "resident-intern"
    ]);
  });
});
