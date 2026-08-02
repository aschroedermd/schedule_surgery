import { describe, expect, it } from "vitest";
import {
  buildAllServiceMySchedule,
  getQuickEditHospitals,
  getAttendingNightScheduleForDate,
  getAttendingWeeklyScheduleForDate,
  normalizeQuickCaseDuration,
  shiftEndTime,
  shouldApplyScheduleLoad
} from "./App";
import type { AttendingCoverageAssignment, PlannerState } from "../shared/types";
import { createInitialState } from "../server/sampleData";
import {
  canEditScheduleForSelectedService,
  getNavigationTabs,
  isAdminNavigationTab,
  isMobilePrimaryTab,
  type Tab
} from "./navigation";

function tabIds(tabs: ReadonlyArray<readonly [Tab, string]>): string[] {
  return tabs.map(([tab]) => tab);
}

describe("planner navigation", () => {
  it("shows the Gold Star residents tab to all users", () => {
    const adminTabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: true });
    const userTabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: false });

    expect(adminTabs).toContainEqual(["residents", "Stars ✨"]);
    expect(userTabs).toContainEqual(["residents", "Stars ✨"]);
    expect(adminTabs).toContainEqual(["roster", "Roster"]);
  });

  it("puts the assistant first for every signed-in user", () => {
    const adminTabs = getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 1, isAdmin: true });
    const userTabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: false });

    expect(adminTabs[0]).toEqual(["chat", "Assistant ✦"]);
    expect(userTabs[0]).toEqual(["chat", "Assistant ✦"]);
  });

  it("keeps the residents tab second to last", () => {
    const adminTabIds = tabIds(getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 2, isAdmin: true }));
    const userTabIds = tabIds(getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 2, isAdmin: false }));

    expect(adminTabIds.at(-2)).toBe("residents");
    expect(userTabIds.at(-2)).toBe("residents");
  });

  it("keeps admin setup tabs reachable without a separate schedule editor tab", () => {
    const tabs = getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 2, isAdmin: true });

    expect(tabIds(tabs)).toEqual(
      expect.arrayContaining(["roster", "defaults", "users"])
    );
    expect(tabIds(tabs)).not.toContain("entry");
  });

  it("hides admin setup tabs from non-admin users", () => {
    const tabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: false });

    expect(tabIds(tabs)).not.toEqual(
      expect.arrayContaining(["roster", "defaults", "users", "activity"])
    );
  });

  it("keeps activity reachable for admins only", () => {
    const adminTabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: true });
    const userTabs = getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 1, isAdmin: false });

    expect(tabIds(adminTabs)).toContain("activity");
    expect(tabIds(userTabs)).not.toContain("activity");
  });

  it("keeps the responsive navigation groups presentation-only", () => {
    expect(["roster", "defaults", "users", "activity"].every((tab) => isAdminNavigationTab(tab as Tab))).toBe(true);
    expect(isAdminNavigationTab("account")).toBe(false);
    expect(["chat", "board", "my", "calendar"].every((tab) => isMobilePrimaryTab(tab as Tab))).toBe(true);
    expect(isMobilePrimaryTab("call")).toBe(false);
    expect(isMobilePrimaryTab("residents")).toBe(false);
  });

  it("shows schedule editing only to admins or selected-service editors", () => {
    expect(canEditScheduleForSelectedService(true, "view")).toBe(true);
    expect(canEditScheduleForSelectedService(false, "edit")).toBe(true);
    expect(canEditScheduleForSelectedService(false, "request")).toBe(false);
    expect(canEditScheduleForSelectedService(false, "view")).toBe(false);
  });
});

describe("My Schedule", () => {
  it("builds the resident week across every service instead of the selected service", () => {
    const state = createInitialState();
    state.attendingBlocks.push({
      id: "berry_my_schedule_block",
      weekId: state.weeks[0].id,
      date: state.weeks[0].startDate,
      attendingId: "att_nussbaum",
      hospitalId: "hosp_main",
      firstCaseStartTime: "12:00",
      notes: ""
    });
    state.cases.push({
      id: "berry_my_schedule_case",
      blockId: "berry_my_schedule_block",
      procedureLabel: "Berry add-on",
      durationMinutes: 60,
      priority: 2,
      tags: [],
      notes: "",
      order: 0
    });
    state.assignments.push({
      id: "berry_my_schedule_assignment",
      kind: "case",
      targetId: "berry_my_schedule_case",
      residentId: "res_blue",
      locked: false,
      source: "admin",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z"
    });

    const schedule = buildAllServiceMySchedule(state, state.weeks[0].id);

    expect(schedule.days.flatMap((day) => day.blocks).map((block) => block.id)).toContain("berry_my_schedule_block");
    expect(schedule.days.flatMap((day) => day.blocks).flatMap((block) => block.cases)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "berry_my_schedule_case",
          assignments: [expect.objectContaining({ residentId: "res_blue" })]
        })
      ])
    );
  });
});

describe("schedule load coordination", () => {
  it("rejects a Davies response after the resident default switches to Berry", () => {
    expect(shouldApplyScheduleLoad(1, 1, "Davies", "Berry")).toBe(false);
  });

  it("rejects an older response after a newer load starts", () => {
    expect(shouldApplyScheduleLoad(1, 2, "Berry", "Berry")).toBe(false);
    expect(shouldApplyScheduleLoad(2, 2, "Berry", "Berry")).toBe(true);
  });
});

describe("OR / clinic quick editing", () => {
  it("defaults a missing case duration to 90 minutes", () => {
    expect(normalizeQuickCaseDuration("")).toBe(90);
    expect(normalizeQuickCaseDuration(0)).toBe(90);
    expect(normalizeQuickCaseDuration(75)).toBe(75);
  });

  it("offers the configured RMH, CCASC, FMH, and NRV locations", () => {
    const hospitals = [
      { id: "other", name: "Other", shortName: "OTHER", color: "#000" },
      { id: "rmh", name: "RMH", shortName: "RMH", color: "#111" },
      { id: "ccasc", name: "CCASC", shortName: "CCASC", color: "#222" },
      { id: "fmh", name: "FMH", shortName: "FMH", color: "#333" },
      { id: "nrv", name: "NRV", shortName: "NRV", color: "#444" }
    ];

    expect(getQuickEditHospitals(hospitals, "rmh").map((hospital) => hospital.shortName)).toEqual(["RMH", "CCASC", "FMH", "NRV"]);
  });

  it("preserves clinic duration when its start time changes", () => {
    expect(shiftEndTime("13:00", "17:00", "14:30")).toBe("18:30");
  });
});

describe("attending call calendars", () => {
  it("uses consolidated ACS night coverage for both the night and weekly calendars", () => {
    const assignments: AttendingCoverageAssignment[] = [
      attendingCoverage("night", "ACS", "night", "primary", "att_night"),
      attendingCoverage("egs", "EGS", "day", "primary", "att_egs"),
      attendingCoverage("trauma", "Trauma", "day", "primary", "att_trauma"),
      attendingCoverage("scc", "SCC", "day", "primary", "att_scc"),
      attendingCoverage("backup", "ACS", "night", "backup", "att_backup")
    ];
    const state: PlannerState = createInitialState();
    state.attendings = [
      { id: "att_night", name: "Dr. Night", service: "Davies", priority: 3 },
      { id: "att_egs", name: "Dr. Egs", service: "Davies", priority: 3 },
      { id: "att_trauma", name: "Dr. Trauma", service: "Davies", priority: 3 },
      { id: "att_scc", name: "Dr. Scc", service: "Davies", priority: 3 },
      { id: "att_backup", name: "Dr. Backup", service: "Davies", priority: 3 }
    ];
    state.attendingCoverageAssignments = assignments;
    state.coverageEntries = [];

    expect(getAttendingNightScheduleForDate(state, "2026-08-07")?.displayName).toBe("Night");
    expect(getAttendingWeeklyScheduleForDate(state, "2026-08-07").map(({ label, displayName }) => [label, displayName])).toEqual([
      ["EGS", "Egs"],
      ["Trauma", "Trauma"],
      ["SCC", "Scc"],
      ["Night", "Night"],
      ["Backup-Night", "Backup"]
    ]);
  });
});

function attendingCoverage(
  id: string,
  line: AttendingCoverageAssignment["line"],
  shift: AttendingCoverageAssignment["shift"],
  role: AttendingCoverageAssignment["role"],
  attendingId: string
): AttendingCoverageAssignment {
  return {
    id,
    date: "2026-08-07",
    line,
    shift,
    role,
    attendingId,
    source: "qgenda",
    note: "",
    createdAt: "2026-08-01T03:00:00.000Z",
    updatedAt: "2026-08-01T03:00:00.000Z"
  };
}
