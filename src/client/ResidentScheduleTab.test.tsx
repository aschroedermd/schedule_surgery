// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResidentScheduleTab } from "./App";
import { createInitialState } from "../server/sampleData";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it("lets viewers browse resident blocks and absences without edit controls", () => {
  const state = createInitialState();
  const resident = state.residents[0];
  resident.rotationSchedule = [{ id: "rotation-test", blockNumber: 1, startDate: "2026-07-01", endDate: "2026-08-02", service: "Davies" }];
  resident.vacation = [{ id: "vac-test", startDate: "2026-07-06", endDate: "2026-07-07" }];
  resident.unavailable = [{ id: "off-test", date: "2026-07-08", label: "Conference" }];
  const onMutate = vi.fn();
  act(() => root.render(<ResidentScheduleTab state={state} token="viewer" disabled={true} onMutate={onMutate} />));
  const select = container.querySelector("select")!;
  act(() => { select.value = "1"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(container.querySelector(".block-schedule-panel")?.textContent).toContain("Davies");
  expect(container.querySelector(".vacation-line")?.textContent).toContain("VAC");
  expect(container.querySelector(".time-off-line")?.textContent).toContain("Conference");
  expect(container.querySelector(".resident-lineup-panel")).toBeNull();
  expect(container.querySelectorAll("input, button")).toHaveLength(0);
  expect(container.querySelectorAll("select")).toHaveLength(1);
  act(() => { select.value = "2"; select.dispatchEvent(new Event("change", { bubbles: true })); });
  expect(container.querySelector(".eyebrow")?.textContent).toBe("Block 2");
  expect(onMutate).not.toHaveBeenCalled();
});

it("preserves editing for advanced editors and removes it when access is revoked", () => {
  const props = { state: createInitialState(), token: "editor", onMutate: vi.fn() };
  act(() => root.render(<ResidentScheduleTab {...props} disabled={false} />));
  expect(container.querySelector(".resident-lineup-panel")).not.toBeNull();
  expect(container.textContent).toContain("Save vacation");
  expect(container.textContent).toContain("Save time off");
  act(() => root.render(<ResidentScheduleTab {...props} disabled={true} />));
  expect(container.querySelector(".resident-lineup-panel")).toBeNull();
  expect(container.querySelector(".block-schedule-panel")).not.toBeNull();
});
