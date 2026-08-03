import { describe, expect, it } from "vitest";
import {
  resolveIndependentCallCoverage,
  resolveIndependentMondayEarlyMorningCoverage
} from "./attendingCoverage";
import type { AttendingCoverageAssignment } from "./types";

describe("independent attending call resolution", () => {
  it("inherits the weekday day surgeon when no night exception is supplied", () => {
    const assignments = [coverage("weekday", "2026-08-03", "Practice", "day", "att_day")];

    const resolved = resolveIndependentCallCoverage(assignments, "Practice", "2026-08-03", "night");

    expect(resolved?.assignment.attendingId).toBe("att_day");
    expect(resolved?.inheritedFromDay).toBe(true);
  });

  it("uses an explicit weekday night surgeon instead of the day fallback", () => {
    const assignments = [
      coverage("day", "2026-08-03", "Vascular", "day", "att_day"),
      coverage("night", "2026-08-03", "Vascular", "night", "att_night")
    ];

    const resolved = resolveIndependentCallCoverage(assignments, "Vascular", "2026-08-03", "night");

    expect(resolved?.assignment.attendingId).toBe("att_night");
    expect(resolved?.inheritedFromDay).toBe(false);
  });

  it("expands a Friday weekend assignment across Friday night, Saturday, and Sunday", () => {
    const assignments = [coverage("weekend", "2026-08-07", "Pediatrics", "weekend", "att_weekend")];

    expect(resolveIndependentCallCoverage(assignments, "Pediatrics", "2026-08-07", "night")?.assignment.attendingId).toBe("att_weekend");
    expect(resolveIndependentCallCoverage(assignments, "Pediatrics", "2026-08-08", "day")?.assignment.attendingId).toBe("att_weekend");
    expect(resolveIndependentCallCoverage(assignments, "Pediatrics", "2026-08-09", "night")?.assignment.attendingId).toBe("att_weekend");
    expect(resolveIndependentCallCoverage(assignments, "Pediatrics", "2026-08-10", "day")).toBeUndefined();
    expect(resolveIndependentMondayEarlyMorningCoverage(assignments, "Pediatrics", "2026-08-10")?.assignment.attendingId).toBe("att_weekend");
    expect(resolveIndependentMondayEarlyMorningCoverage(assignments, "Pediatrics", "2026-08-11")).toBeUndefined();
  });
});

function coverage(
  id: string,
  date: string,
  line: AttendingCoverageAssignment["line"],
  shift: AttendingCoverageAssignment["shift"],
  attendingId: string
): AttendingCoverageAssignment {
  return {
    id,
    date,
    line,
    shift,
    role: "primary",
    attendingId,
    source: "api",
    note: "",
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z"
  };
}
