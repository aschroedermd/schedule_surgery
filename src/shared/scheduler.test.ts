import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  buildAssignmentIntervals,
  buildWeekSchedule,
  collectWarnings,
  computeScheduledCases,
  formatClinicLabel,
  makeAssignment
} from "./scheduler";
import { addDays } from "./date";
import { createInitialState } from "../server/sampleData";
import { AttendingBlock, CoverageEntry, SurgeryCase } from "./types";

describe("scheduler core", () => {
  it("computes downstream case times from the attending block start and prior durations", () => {
    const state = createInitialState();
    const originalCases = computeScheduledCases(state, "week_current");
    expect(originalCases.find((surgeryCase) => surgeryCase.id === "case_chen_chole")?.startTime).toBe("14:00");

    const shortened = {
      ...state,
      cases: state.cases.map((surgeryCase) =>
        surgeryCase.id === "case_chen_whipple" ? { ...surgeryCase, durationMinutes: 120 } : surgeryCase
      )
    };
    const changedCases = computeScheduledCases(shortened, "week_current");
    expect(changedCases.find((surgeryCase) => surgeryCase.id === "case_chen_chole")?.startTime).toBe("10:00");
  });

  it("warns but permits unavailable assignments and tight cross-hospital splits", () => {
    const state = createInitialState();
    const tuesday = state.attendingBlocks.find((block) => block.id === "block_morris_tue")!.date;
    const extraBlock: AttendingBlock = {
      id: "block_patel_tue",
      weekId: "week_current",
      date: tuesday,
      attendingId: "att_patel",
      hospitalId: "hosp_west",
      firstCaseStartTime: "10:45",
      notes: ""
    };
    const extraCase: SurgeryCase = {
      id: "case_patel_tue_bypass",
      blockId: extraBlock.id,
      procedureLabel: "Gastric bypass",
      durationMinutes: 120,
      priority: 4,
      tags: ["bariatrics", "fellow-priority"],
      notes: "",
      order: 0
    };
    const withAssignments = {
      ...state,
      attendingBlocks: [...state.attendingBlocks, extraBlock],
      cases: [...state.cases, extraCase],
      assignments: [
        makeAssignment("case", "case_morris_hernia", "res_chief", "admin", false),
        makeAssignment("case", "case_patel_tue_bypass", "res_chief", "admin", false),
        makeAssignment("case", "case_chen_whipple", "res_offservice", "admin", false)
      ]
    };

    const warnings = collectWarnings(withAssignments, "week_current").map((warning) => warning.message);
    expect(warnings.some((warning) => warning.includes("target buffer is 90 minutes"))).toBe(true);
    expect(warnings.some((warning) => warning.includes("chief-level"))).toBe(true);
  });

  it("preserves existing admin-locked assignments when suggestions are refreshed", () => {
    const state = {
      ...createInitialState(),
      assignments: [makeAssignment("case", "case_chen_whipple", "res_chief", "admin", true)]
    };

    const suggested = applySuggestion(state, "week_current");
    const locked = suggested.assignments.find((assignment) => assignment.targetId === "case_chen_whipple");

    expect(locked?.residentId).toBe("res_chief");
    expect(locked?.locked).toBe(true);
  });

  it("keeps assignable-only off-service rotators out of auto-suggestions", () => {
    const state = createInitialState();
    const emRotator = state.residents.find((resident) => resident.id === "res_external_alayna_arnholt")!;
    const plasticSurgeryRotator = state.residents.find((resident) => resident.id === "res_external_hannah_brown")!;

    const emOnly = applySuggestion({ ...state, residents: [emRotator], assignments: [] }, "week_current");
    const plasticSurgeryOnly = applySuggestion({ ...state, residents: [plasticSurgeryRotator], assignments: [] }, "week_current");

    expect(emOnly.assignments).toHaveLength(0);
    expect(plasticSurgeryOnly.assignments.some((assignment) => assignment.residentId === plasticSurgeryRotator.id)).toBe(true);
  });

  it("does not warn about overlap when a resident has both stale case and block assignments for the same block", () => {
    const state = {
      ...createInitialState(),
      assignments: [
        makeAssignment("case", "case_chen_whipple", "res_chief", "admin", false),
        makeAssignment("case", "case_chen_chole", "res_chief", "admin", false),
        makeAssignment("block", "block_chen_mon", "res_chief", "admin", false)
      ]
    };

    const warnings = collectWarnings(state, "week_current").map((warning) => warning.message);

    expect(warnings.some((warning) => warning.includes("overlapping assignments"))).toBe(false);
  });

  it("only treats overnight weekend call as post-call for next-day OR assignments", () => {
    const state = createInitialState();
    const monday = state.weeks.find((week) => week.id === "week_current")!.startDate;
    const sunday = addDays(monday, -1);
    const friday = addDays(monday, 4);
    const saturday = addDays(monday, 5);
    const nextSunday = addDays(monday, 6);
    const residentName = state.residents.find((resident) => resident.id === "res_chief")!.name;

    const callEntry = (date: string): CoverageEntry => ({
      id: `cover_${date}`,
      date,
      kind: "call",
      residentId: "res_chief",
      note: "",
      createdAt: "2026-06-27T14:36:21.000Z",
      updatedAt: "2026-06-27T14:36:21.000Z"
    });
    const weekendBlock = (id: string, date: string): AttendingBlock => ({
      id,
      weekId: "week_current",
      date,
      attendingId: "att_chen",
      hospitalId: "hosp_main",
      firstCaseStartTime: "07:30",
      notes: ""
    });
    const weekendCase = (id: string, blockId: string): SurgeryCase => ({
      id,
      blockId,
      procedureLabel: "Weekend case",
      durationMinutes: 90,
      priority: 1,
      tags: ["general surgery"],
      notes: "",
      order: 0
    });

    const sundayDayCallState = {
      ...state,
      coverageEntries: [callEntry(sunday)],
      assignments: [makeAssignment("case", "case_chen_whipple", "res_chief", "admin", false)]
    };

    expect(collectWarnings(sundayDayCallState, "week_current").map((warning) => warning.message)).not.toContain(
      `${residentName} is post-call after ${sunday}`
    );

    const fridayOvernightState = {
      ...state,
      settings: { ...state.settings, weekdayOnly: false },
      attendingBlocks: [...state.attendingBlocks, weekendBlock("block_weekend_sat", saturday)],
      cases: [...state.cases, weekendCase("case_weekend_sat", "block_weekend_sat")],
      coverageEntries: [callEntry(friday)],
      assignments: [makeAssignment("case", "case_weekend_sat", "res_chief", "admin", false)]
    };

    expect(collectWarnings(fridayOvernightState, "week_current").map((warning) => warning.message)).toContain(
      `${residentName} is post-call after ${friday}`
    );

    const saturdayOvernightState = {
      ...state,
      settings: { ...state.settings, weekdayOnly: false },
      attendingBlocks: [...state.attendingBlocks, weekendBlock("block_weekend_sun", nextSunday)],
      cases: [...state.cases, weekendCase("case_weekend_sun", "block_weekend_sun")],
      coverageEntries: [callEntry(saturday)],
      assignments: [makeAssignment("case", "case_weekend_sun", "res_chief", "admin", false)]
    };

    expect(collectWarnings(saturdayOvernightState, "week_current").map((warning) => warning.message)).toContain(
      `${residentName} is post-call after ${saturday}`
    );
  });

  it("supports multiple residents assigned directly to the same case", () => {
    const state = {
      ...createInitialState(),
      assignments: [
        makeAssignment("case", "case_chen_whipple", "res_chief", "admin", false),
        makeAssignment("case", "case_chen_whipple", "res_fellow", "admin", false)
      ]
    };

    const scheduledCase = computeScheduledCases(state, "week_current").find((surgeryCase) => surgeryCase.id === "case_chen_whipple");
    const uncoveredCases = buildWeekSchedule(state, "week_current").days.flatMap((day) => day.uncoveredCases);
    const caseIntervals = buildAssignmentIntervals(state, "week_current").filter((interval) => interval.targetId === "case_chen_whipple");

    expect(scheduledCase?.assignments.map((assignment) => assignment.residentId)).toEqual(["res_chief", "res_fellow"]);
    expect(scheduledCase?.assignment?.residentId).toBe("res_chief");
    expect(uncoveredCases.map((surgeryCase) => surgeryCase.id)).not.toContain("case_chen_whipple");
    expect(caseIntervals.map((interval) => interval.resident.id)).toEqual(["res_chief", "res_fellow"]);
  });

  it("keeps a block resident on the case when a second case resident is added", () => {
    const state = {
      ...createInitialState(),
      assignments: [
        makeAssignment("block", "block_chen_mon", "res_chief", "admin", false),
        makeAssignment("case", "case_chen_whipple", "res_fellow", "admin", false)
      ]
    };

    const scheduledCase = computeScheduledCases(state, "week_current").find((surgeryCase) => surgeryCase.id === "case_chen_whipple");

    expect(scheduledCase?.assignments.map((assignment) => assignment.residentId)).toEqual(["res_chief", "res_fellow"]);
    expect(scheduledCase?.assignment?.residentId).toBe("res_fellow");
  });

  it("warns for date-range availability blocks", () => {
    const state = createInitialState();
    const rangeUnavailableState = {
      ...state,
      residents: [
        ...state.residents,
        {
          id: "res_t_cao",
          name: "Resident Range",
          trainingLevel: "PGY2" as const,
          serviceTags: ["Davies"],
          tags: ["Davies"],
          trainingInterests: [],
          unavailable: [{ id: "off_after_july_8", date: "2026-07-09", endDate: "2026-12-31", label: "off after July 8" }]
        }
      ],
      weeks: [{ id: "week_test", startDate: "2026-07-06", label: "Week of Jul 6" }],
      attendingBlocks: [
        {
          id: "block_range_test",
          weekId: "week_test",
          date: "2026-07-10",
          attendingId: "att_morris",
          hospitalId: "hosp_main",
          firstCaseStartTime: "07:30",
          notes: ""
        }
      ],
      cases: [
        {
          id: "case_range_test",
          blockId: "block_range_test",
          procedureLabel: "Appendectomy",
          durationMinutes: 90,
          priority: 2 as const,
          tags: ["general surgery"],
          notes: "",
          order: 0
        }
      ],
      assignments: [makeAssignment("case", "case_range_test", "res_t_cao", "admin", false)]
    };

    const warnings = collectWarnings(rangeUnavailableState, "week_test").map((warning) => warning.message);

    expect(warnings.some((warning) => warning.includes("off after July 8"))).toBe(true);
  });

  it("does not warn for a plain training interest mismatch without a better same-day assignment", () => {
    const state = {
      ...createInitialState(),
      assignments: [makeAssignment("case", "case_morris_hernia", "res_chief", "admin", false)]
    };

    const warnings = collectWarnings(state, "week_current").map((warning) => warning.message);

    expect(warnings).not.toContain("check arrangement");
  });

  it("flags check arrangement when a resident has a better same-day interest fit", () => {
    const state = {
      ...createInitialState(),
      residents: createInitialState().residents.map((resident) =>
        resident.id === "res_chief" ? { ...resident, trainingInterests: ["HPB"] } : resident
      ),
      assignments: [
        makeAssignment("case", "case_chen_chole", "res_chief", "admin", false),
        makeAssignment("case", "case_chen_whipple", "res_fellow", "admin", false)
      ]
    };

    const warnings = collectWarnings(state, "week_current");
    const arrangementWarning = warnings.find(
      (warning) => warning.targetId === "case_chen_chole" && warning.residentId === "res_chief"
    );

    expect(arrangementWarning?.message).toBe("check arrangement");
  });

  it("filters weekly schedules by service line", () => {
    const state = createInitialState();

    const daviesSchedule = computeScheduledCases(state, "week_current", "Davies");
    const berrySchedule = computeScheduledCases(state, "week_current", "Berry");

    expect(daviesSchedule.map((surgeryCase) => surgeryCase.id)).toEqual(
      expect.arrayContaining(["case_chen_whipple", "case_patel_bypass", "case_morris_hernia"])
    );
    expect(berrySchedule).toEqual([]);
  });

  it("labels clinics by surgeon and procedure setting", () => {
    const state = createInitialState();
    const clinic = state.clinicSessions[0];
    const attending = state.attendings.find((candidate) => candidate.id === clinic.attendingId);

    expect(formatClinicLabel({ ...clinic, attending })).toBe("Dr. Chen clinic");
    expect(formatClinicLabel({ ...clinic, attending, isProcedure: true })).toBe("Dr. Chen procedure clinic");
    expect(formatClinicLabel({ ...clinic, attending: undefined, isProcedure: true })).toBe("Davies procedure clinic");
  });
});
