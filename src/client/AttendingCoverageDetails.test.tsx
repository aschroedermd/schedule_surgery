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
it("shows all four priority lines even when empty and expands/collapses accessibly", () => {
  const state = createInitialState(); state.attendingCoverageAssignments = [];
  act(() => root.render(<AttendingCoverageDetails state={state} date="2026-10-12" />));
  expect([...container.querySelectorAll(".coverage-details-line > strong")].map(node => node.textContent)).toEqual(["ACS Night", "Practice / Bariatric", "Vascular — CCVS & AC", "Pediatric Surgery"]);
  expect(container.querySelectorAll(".coverage-unassigned")).toHaveLength(4);
  const button = container.querySelector("button")!;
  expect(button.textContent).toBe("Show all coverage");
  expect(button.getAttribute("aria-expanded")).toBe("false");
  act(() => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  for (const label of Object.values(COVERAGE_LABELS)) expect(container.textContent).toContain(label);
  act(() => button.click());
  expect(container.querySelectorAll(".coverage-details-line")).toHaveLength(4);
  expect(container.querySelector("time")?.dateTime).toBe("2026-10-12");
});
it("distinguishes inherited and explicit assignments and shows overnight end date", () => {
  const state = createInitialState();
  state.attendingCoverageAssignments = [
    { id: "p", date: "2026-10-12", line: "Practice", shift: "day", role: "primary", attendingId: state.attendings[0].id, source: "api", note: "", createdAt: "", updatedAt: "" },
    { id: "n", date: "2026-10-12", line: "Pediatrics", shift: "night", role: "primary", attendingId: state.attendings[1].id, source: "qgenda", note: "", createdAt: "", updatedAt: "", startTime: "17:00", endTime: "07:00", endDate: "2026-10-13" }
  ];
  act(() => root.render(<AttendingCoverageDetails state={state} date="2026-10-12" />));
  expect(container.textContent).toContain("Inherited from day");
  expect(container.textContent).toContain("Assigned · qgenda");
  expect(container.textContent).toContain("17:00–07:00 (2026-10-13)");
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
  expect(container.textContent).toContain("day · backup");
  expect(state.attendingCoverageAssignments[1].line).toBe("ACS");
});
