import { describe, expect, it } from "vitest";
import { calendarEventOccursOn, createDefaultCalendarEvents } from "./calendarEvents";
import type { ResidencyCalendarEvent } from "./types";

function event(recurrence?: ResidencyCalendarEvent["recurrence"], date = "2026-10-09"): ResidencyCalendarEvent {
  return { id: "test", title: "Conference", date, recurrence, createdAt: "", updatedAt: "" };
}
describe("residency conference recurrence", () => {
  it("keeps one-off and weekly dates bounded and stable through DST", () => {
    expect(calendarEventOccursOn(event(), "2026-10-09")).toBe(true);
    expect(calendarEventOccursOn(event(), "2026-10-16")).toBe(false);
    const weekly = event({ frequency: "weekly", untilDate: "2026-11-06" });
    for (const date of ["2026-10-09", "2026-10-16", "2026-10-30", "2026-11-06"]) expect(calendarEventOccursOn(weekly, date)).toBe(true);
    for (const date of ["2026-10-02", "2026-10-10", "2026-11-13"]) expect(calendarEventOccursOn(weekly, date)).toBe(false);
  });
  it("anchors alternate-week recurrences to calendar weeks and supports multiple weekdays", () => {
    const fortnightly = event({ frequency: "weekly", interval: 2, daysOfWeek: [1, 5] });
    expect(calendarEventOccursOn(fortnightly, "2026-10-05")).toBe(false);
    expect(calendarEventOccursOn(fortnightly, "2026-10-12")).toBe(false);
    expect(calendarEventOccursOn(fortnightly, "2026-10-19")).toBe(true);
    expect(calendarEventOccursOn(fortnightly, "2026-10-23")).toBe(true);
  });
  it("supports nth and last weekdays of the month and interval boundaries", () => {
    const monthly = event({ frequency: "monthly", weekOfMonth: 2, daysOfWeek: [3] }, "2026-10-01");
    expect(calendarEventOccursOn(monthly, "2026-10-14")).toBe(true);
    expect(calendarEventOccursOn(monthly, "2026-10-07")).toBe(false);
    expect(calendarEventOccursOn(monthly, "2026-11-11")).toBe(true);
    const last = event({ frequency: "monthly", weekOfMonth: -1, daysOfWeek: [5], interval: 2 }, "2026-10-01");
    expect(calendarEventOccursOn(last, "2026-10-30")).toBe(true);
    expect(calendarEventOccursOn(last, "2026-11-27")).toBe(false);
    expect(calendarEventOccursOn(last, "2026-12-25")).toBe(true);
    expect(calendarEventOccursOn(last, "2026-12-18")).toBe(false);
  });
  it("skips months missing a same-number date instead of rolling into the next month", () => {
    const monthly = event({ frequency: "monthly" }, "2026-01-31");
    expect(calendarEventOccursOn(monthly, "2026-02-28")).toBe(false);
    expect(calendarEventOccursOn(monthly, "2026-03-03")).toBe(false);
    expect(calendarEventOccursOn(monthly, "2026-03-31")).toBe(true);
    expect(calendarEventOccursOn(createDefaultCalendarEvents()[0], "2026-10-09")).toBe(true);
  });
});
