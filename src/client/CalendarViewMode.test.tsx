// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalendarTab } from "./CoverageCalendar";
import type { CoverageEntry, PlannerState, Resident } from "../shared/types";
import { createInitialState } from "../server/sampleData";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("coverageCalendarMonth", "2026-09");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
function renderCalendar(isAdmin: boolean, privilege: "view" | "request" = "view") {
  act(() => root.render(<CalendarTab state={createInitialState(new Date("2026-09-01T12:00:00"))}
    token="test" selectedService="Davies" serviceLines={["Davies"]} username="mode-test"
    isAdmin={isAdmin} servicePrivileges={{ Davies: privilege }} onMutate={async () => {}} />));
}
function mode(label: string) {
  return [...container.querySelectorAll<HTMLButtonElement>(".schedule-mode-tabs button")].find(button => button.textContent === label);
}
describe("Calendar view and editing access", () => {
  it("starts compact for admins and mounts editing controls only in Edit", () => {
    renderCalendar(true);
    expect(container.querySelector(".coverage-add-note-button")).toBeNull();
    expect(mode("View")?.getAttribute("aria-pressed")).toBe("true");
    act(() => mode("Edit")!.click());
    expect(container.querySelector(".coverage-add-note-button")).not.toBeNull();
    act(() => mode("View")!.click());
    expect(container.querySelector(".coverage-add-note-button")).toBeNull();
  });
  it("does not expose Edit to viewers", () => {
    renderCalendar(false);
    expect(mode("Edit")).toBeUndefined();
    expect(mode("Requests")).toBeUndefined();
    expect(container.querySelector(".coverage-add-note-button")).toBeNull();
  });
  it("keeps request-only users in a separate Requests mode", () => {
    renderCalendar(false, "request");
    expect(mode("Edit")).toBeUndefined();
    expect(mode("Requests")).toBeDefined();
    act(() => mode("Requests")!.click());
    expect(container.querySelector(".coverage-add-note-button")).not.toBeNull();
  });
});

function changeSelect(label: string, value: string) {
  const select = container.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
  act(() => { select.value = value; select.dispatchEvent(new Event("change", { bubbles: true })); });
}
function calendarDay(date: string) {
  return container.querySelector<HTMLElement>(`[data-date="${date}"]`)!;
}
function testResident(id: string, service: string, extra: Partial<Resident> = {}): Resident {
  return { id, name: id, trainingLevel: "PGY2", rosterKind: "primary", sourceProgram: "General Surgery",
    serviceTags: [service], tags: [], trainingInterests: [], unavailable: [],
    vacation: [{ id: `vac-${id}`, startDate: "2026-09-04", endDate: "2026-09-06" }], ...extra };
}
function testEntry(id: string, date: string, kind: CoverageEntry["kind"], residentId?: string, note = ""): CoverageEntry {
  return { id, date, kind, residentId, note, createdAt: "", updatedAt: "" };
}
function renderSplitCalendar(state: PlannerState) {
  act(() => root.render(<CalendarTab state={state} token="test" selectedService="Davies"
    serviceLines={["Davies", "Berry"]} username="split-test" isAdmin={true}
    servicePrivileges={{}} onMutate={async () => {}} />));
}
function splitCalendarState() {
  const state = createInitialState(new Date("2026-09-01T12:00:00"));
  state.residents = [testResident("Alice", "Davies"), testResident("Bob", "Berry"),
    testResident("Rotator", "Davies", { rosterKind: "off-service", sourceProgram: "Emergency Medicine" }),
    testResident("Plastic", "Davies", { sourceProgram: "Plastic Surgery" })];
  state.coverageEntries = [testEntry("event", "2026-09-04", "note", undefined, "Resident research conference"),
    testEntry("resident-event", "2026-09-04", "note", "Bob", "Teaching session"),
    testEntry("round", "2026-09-05", "rounding", "Alice"),
    testEntry("off", "2026-09-05", "off", "Bob", "Day off")];
  state.coverageRequests = [];
  return state;
}

describe("Main residency and service rounding calendars", () => {
  it("defaults to main, shows events and compact general surgery vacations across services", () => {
    localStorage.setItem("coverageCalendarServices:splittest:davies", '["Davies"]');
    renderSplitCalendar(splitCalendarState());
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Calendar view"]')?.value).toBe("main");
    expect(container.querySelector('[aria-label="Rounding service"]')).toBeNull();
    expect(calendarDay("2026-09-04").textContent).toContain("Resident research conference");
    expect(calendarDay("2026-09-04").textContent).toContain("Teaching session");
    expect(calendarDay("2026-09-04").textContent).toContain("Morbidity & mortality conference");
    const vacations = calendarDay("2026-09-04").querySelectorAll(".compact-vacation");
    expect(vacations).toHaveLength(2);
    expect([...vacations].map(row => row.textContent).join(" ")).toContain("Alice");
    expect([...vacations].map(row => row.textContent).join(" ")).toContain("Bob");
    expect(calendarDay("2026-09-05").querySelector(".calendar-rounder-summary")).toBeNull();
    expect(container.querySelector(".unassigned-flag")).toBeNull();
    expect(calendarDay("2026-09-07").querySelector(".compact-vacation")).toBeNull();
  });
  it("filters service absences and rounding, and keeps general events on main", () => {
    renderSplitCalendar(splitCalendarState());
    changeSelect("Calendar view", "service");
    expect(calendarDay("2026-09-05").textContent).toContain("Alice");
    expect(calendarDay("2026-09-04").textContent).toContain("Rotator");
    expect(calendarDay("2026-09-04").textContent).not.toContain("Bob");
    expect(calendarDay("2026-09-04").textContent).not.toContain("Resident research conference");
    expect(calendarDay("2026-09-04").textContent).not.toContain("Morbidity & mortality conference");
    expect(container.querySelector(".compact-vacation")).toBeNull();
    changeSelect("Rounding service", "Berry");
    expect(calendarDay("2026-09-05").textContent).toContain("Bob");
    expect(calendarDay("2026-09-05").textContent).toContain("Day off");
    expect(calendarDay("2026-09-05").textContent).toContain("No Berry rounder");
    expect(calendarDay("2026-09-05").textContent).not.toContain("Alice");
    changeSelect("Calendar view", "main");
    expect(calendarDay("2026-09-04").querySelectorAll(".compact-vacation")).toHaveLength(2);
  });
  it("uses the roster on each date across a service rotation boundary", () => {
    const state = splitCalendarState();
    state.residents = [testResident("Moving", "Davies", { rotationSchedule: [
      { id: "rotation-1", blockNumber: 1, startDate: "2026-09-01", endDate: "2026-09-04", service: "Davies" },
      { id: "rotation-2", blockNumber: 2, startDate: "2026-09-05", endDate: "2026-09-30", service: "Berry" }
    ] })];
    state.coverageEntries = [];
    renderSplitCalendar(state);
    changeSelect("Calendar view", "service");
    expect(calendarDay("2026-09-04").textContent).toContain("Moving");
    expect(calendarDay("2026-09-05").textContent).not.toContain("Moving");
    changeSelect("Rounding service", "Berry");
    expect(calendarDay("2026-09-04").textContent).not.toContain("Moving");
    expect(calendarDay("2026-09-05").textContent).toContain("Moving");
  });
  it("names on-service call rounders and includes unavailable days", () => {
    const state = splitCalendarState();
    state.residents = [testResident("Caller", "Davies", { vacation: [], unavailable: [
      { id: "leave", date: "2026-09-07", endDate: "2026-09-08", label: "Leave" }
    ] }), testResident("Other", "Berry", { vacation: [] })];
    state.coverageEntries = [testEntry("call", "2026-09-05", "call", "Caller"),
      testEntry("other-call", "2026-09-05", "call", "Other")];
    renderSplitCalendar(state);
    changeSelect("Calendar view", "service");
    expect(calendarDay("2026-09-05").textContent).toContain("Round · on callCaller");
    expect(calendarDay("2026-09-05").textContent).not.toContain("Other");
    expect(calendarDay("2026-09-05").querySelector(".unassigned-flag")).toBeNull();
    expect(calendarDay("2026-09-07").textContent).toContain("Leave");
    expect(calendarDay("2026-09-08").textContent).toContain("Leave");
    expect(calendarDay("2026-09-09").textContent).not.toContain("Leave");
  });
});


describe("Published conferences in the main calendar", () => {
  it("renders actual recurring details and meeting links only on main, and updates the default M&M without duplication", () => {
    const state = splitCalendarState();
    state.calendarEvents[0] = { ...state.calendarEvents[0], startTime: "07:00", endTime: "08:00", location: "Conference room", meetingUrl: "https://teams.microsoft.com/l/meetup-join/mm" };
    state.calendarEvents.push({ id: "journal", title: "Journal Club", date: "2026-09-02", startTime: "17:00",
      meetingUrl: "https://teams.microsoft.com/l/meetup-join/journal", recurrence: { frequency: "weekly", daysOfWeek: [3] }, createdAt: "", updatedAt: "" });
    renderSplitCalendar(state);
    expect(calendarDay("2026-09-04").querySelectorAll(".residency-calendar-event")).toHaveLength(1);
    expect(calendarDay("2026-09-04").textContent).toContain("07:00–08:00");
    expect(calendarDay("2026-09-04").textContent).toContain("Conference room");
    expect(calendarDay("2026-09-09").textContent).toContain("Journal Club");
    expect(calendarDay("2026-09-09").querySelector<HTMLAnchorElement>(".residency-calendar-event a")?.href).toBe("https://teams.microsoft.com/l/meetup-join/journal");
    changeSelect("Calendar view", "service");
    expect(container.querySelector(".residency-calendar-event")).toBeNull();
    state.calendarEvents = [];
    renderSplitCalendar(state);
    changeSelect("Calendar view", "main");
    expect(container.querySelector(".residency-calendar-event")).toBeNull();
  });
});
