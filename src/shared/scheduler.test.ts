import { describe, expect, it } from "vitest";
import {
  applySuggestion,
  collectWarnings,
  computeScheduledCases,
  formatClinicLabel,
  makeAssignment
} from "./scheduler";
import { createInitialState } from "../server/sampleData";
import { AttendingBlock, SurgeryCase } from "./types";

describe("scheduler core", () => {
  it("computes downstream case times from the attending block start and prior durations", () => {
    const state = createInitialState();
    const originalCases = computeScheduledCases(state, "week_current");
    expect(originalCases.find((surgeryCase) => surgeryCase.id === "case_chen_chole")?.startTime).toBe("13:30");

    const shortened = {
      ...state,
      cases: state.cases.map((surgeryCase) =>
        surgeryCase.id === "case_chen_whipple" ? { ...surgeryCase, durationMinutes: 120 } : surgeryCase
      )
    };
    const changedCases = computeScheduledCases(shortened, "week_current");
    expect(changedCases.find((surgeryCase) => surgeryCase.id === "case_chen_chole")?.startTime).toBe("09:30");
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

  it("warns for date-range availability blocks", () => {
    const state = createInitialState();
    const tCaoState = {
      ...state,
      residents: [
        ...state.residents,
        {
          id: "res_t_cao",
          name: "T-Cao",
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

    const warnings = collectWarnings(tCaoState, "week_test").map((warning) => warning.message);

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
