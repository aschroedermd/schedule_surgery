// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { AttendingCoverageDetails } from "./AttendingCoverageDetails";
import { createInitialState } from "../server/sampleData";
import { COVERAGE_LABELS } from "../shared/attendingCoverage";
let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(() => { act(() => root.unmount()); container.remove(); });
it("shows only ACS night and practice even when empty and expands/collapses accessibly", () => {
  const state = createInitialState(); state.attendingCoverageAssignments = [];
  act(() => root.render(<AttendingCoverageDetails state={state} date="2026-10-12" />));
  expect([...container.querySelectorAll(".coverage-details-line > strong")].map(node => node.textContent)).toEqual(["ACS night:", "Practice:"]);
  expect(container.querySelectorAll(".coverage-unassigned")).toHaveLength(2);
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("Show all");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  act(() => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  for (const [line, label] of Object.entries(COVERAGE_LABELS)) {
    if (line !== "ACS" && line !== "Practice") expect(container.textContent).toContain(label);
  }
  act(() => button.click());
  expect(container.querySelectorAll(".coverage-details-line")).toHaveLength(2);
  expect(container.querySelector("time")).toBeNull();
  expect(container.querySelector("section")?.getAttribute("aria-label")).toBe("Attending coverage for 2026-10-12");
});
it("shows clinician names once without redundant shift, time, date, or source details", () => {
  const state = createInitialState();
  state.attendingCoverageAssignments = [
    { id: "p", date: "2026-10-12", line: "Practice", shift: "day", role: "primary", attendingId: state.attendings[0].id, source: "api", note: "", createdAt: "", updatedAt: "" },
    { id: "n", date: "2026-10-12", line: "Pediatrics", shift: "night", role: "primary", attendingId: state.attendings[1].id, source: "qgenda", note: "", createdAt: "", updatedAt: "", startTime: "17:00", endTime: "07:00", endDate: "2026-10-13" }
  ];
  act(() => root.render(<AttendingCoverageDetails state={state} date="2026-10-12" />));
  expect(container.querySelector(".coverage-details-line:nth-child(2)")?.textContent).toBe(`Practice: ${state.attendings[0].name}`);
  act(() => container.querySelector("button")!.click());
  expect(container.textContent).toContain(state.attendings[1].name);
  for (const detail of ["Inherited", "Assigned", "qgenda", "api", "17:00", "07:00", "New York", "2026-10-12", "2026-10-13"]) {
    expect(container.textContent).not.toContain(detail);
  }
});

it("keeps QGenda line-scoped backups out of compact mode and reveals them without changing their source category", () => {
  const state = createInitialState();
  state.attendings = [{ id: "stodghill", name: "Stodghill", service: "", priority: 3 }, { id: "collier", name: "Collier", service: "", priority: 3 }];
  state.attendingCoverageAssignments = [
    { id: "acs-night", date: "2026-10-12", line: "ACS", shift: "night", role: "primary", attendingId: "stodghill", source: "qgenda", note: "", createdAt: "", updatedAt: "" },
    { id: "acs-backup", date: "2026-10-12", line: "ACS", shift: "day", role: "backup", attendingId: "collier", source: "qgenda", note: "", createdAt: "", updatedAt: "" }
  ];
  act(() => root.render(<AttendingCoverageDetails state={state} date="2026-10-12" />));
  expect(container.textContent).toContain("Stodghill");
  expect(container.textContent).not.toContain("Collier");
  act(() => container.querySelector("button")!.click());
  expect(container.textContent).toContain("Collier");
  expect(container.textContent).toContain("Collier (backup)");
  expect(state.attendingCoverageAssignments[1].line).toBe("ACS");
});
