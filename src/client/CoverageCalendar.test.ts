import { describe, expect, it } from "vitest";
import { getCalendarAttendingCallSummary } from "./CoverageCalendar";
import { createInitialState } from "../server/sampleData";
import type { AttendingCoverageAssignment } from "../shared/types";

describe("calendar attending call summary", () => {
  it("lists ACS, practice, pediatrics, vascular, and NRV in order without service labels", () => {
    const state = createInitialState();
    state.attendings = [
      { id: "acs", name: "Joshua Stodghill", service: "ACS", priority: 1 },
      { id: "practice", name: "Frances Adkins", service: "Practice", priority: 1 },
      { id: "peds-day", name: "Karen Bass", service: "Peds", priority: 1 },
      { id: "peds-night", name: "Thomas Wattsman", service: "Peds", priority: 1 },
      { id: "vascular", name: "Robert Swanson", service: "Vascular", priority: 1 }
    ];
    state.attendingCoverageAssignments = [
      coverage("acs", "ACS", "night", "acs"),
      coverage("practice", "Practice", "day", "practice"),
      coverage("peds-day", "Pediatrics", "day", "peds-day"),
      coverage("peds-night", "Pediatrics", "night", "peds-night"),
      coverage("vascular", "Vascular", "night", "vascular")
    ];

    expect(getCalendarAttendingCallSummary(state, "2026-08-07")).toBe(
      "J. Stodghill, F. Adkins, K. Bass/T. Wattsman, R. Swanson, —"
    );
  });
});

function coverage(
  id: string,
  line: AttendingCoverageAssignment["line"],
  shift: AttendingCoverageAssignment["shift"],
  attendingId: string
): AttendingCoverageAssignment {
  return {
    id,
    date: "2026-08-07",
    line,
    shift,
    role: "primary",
    attendingId,
    source: "qgenda",
    note: "",
    createdAt: "2026-08-01T03:00:00.000Z",
    updatedAt: "2026-08-01T03:00:00.000Z"
  };
}
