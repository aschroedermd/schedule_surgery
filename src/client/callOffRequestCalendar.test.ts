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
});
