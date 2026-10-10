// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ResidentPicker } from "./ResidentPicker";
import { createInitialState } from "../server/sampleData";
let root: Root;
let container: HTMLDivElement;
const onSelect = vi.fn();
beforeEach(() => {
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  onSelect.mockReset();
  const residents = createInitialState().residents.slice(0, 2).map((resident, index) => ({ ...resident,
    id: String(index), name: index ? "Zoe Team" : "Alex Other", serviceTags: [index ? "ENDO" : "Berry"], rotationSchedule: [] }));
  act(() => root.render(<ResidentPicker residents={residents} service="ENDO" value="1" date="2026-10-10" label="Zoe Team" onSelect={onSelect} />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
function open() { act(() => container.querySelector<HTMLButtonElement>("button")!.click()); }
it("groups the endoscopy team first and marks the current resident", async () => {
  open();
  const choices = document.querySelectorAll<HTMLButtonElement>(".resident-picker-option");
  expect(choices[0].textContent).toContain("Zoe Team");
  expect(choices[0].getAttribute("aria-pressed")).toBe("true");
  expect(choices[1].textContent).toContain("Alex Other");
  await act(async () => choices[1].click());
  expect(onSelect).toHaveBeenCalledWith("0", expect.any(Function));
});
it("searches names, shows empty results, and restores focus on Escape", () => {
  open();
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  const fill = (value: string) => act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  fill("alex");
  expect(document.querySelectorAll(".resident-picker-option")).toHaveLength(1);
  expect(document.querySelector(".resident-picker-option")?.textContent).toContain("Alex Other");
  fill("nobody");
  expect(document.querySelector('[role="status"]')?.textContent).toContain("No residents found");
  act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.activeElement).toBe(container.querySelector("button"));
});
it("supports arrow navigation and keeps failed saves open", async () => {
  onSelect.mockImplementation(async () => {}); // onMutate handles errors without invoking close.
  open();
  const input = document.querySelector<HTMLInputElement>('input[type="search"]')!;
  act(() => { input.focus(); input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
  expect(document.activeElement?.textContent).toContain("Zoe Team");
  await act(async () => (document.activeElement as HTMLButtonElement).click());
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
it("clears the assignment and closes only when the save succeeds", async () => {
  onSelect.mockImplementation(async (_id, close) => close());
  open();
  await act(async () => document.querySelector<HTMLButtonElement>(".resident-picker-panel footer button")!.click());
  expect(onSelect).toHaveBeenCalledWith("", expect.any(Function));
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("shows a save error inside the dialog and allows retry", async () => {
  onSelect.mockRejectedValueOnce(new Error("Offline"));
  open();
  await act(async () => document.querySelector<HTMLButtonElement>(".resident-picker-option")!.click());
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Could not save");
  expect(document.querySelector<HTMLButtonElement>(".resident-picker-option")!.disabled).toBe(false);
  onSelect.mockImplementationOnce(async (_id, close) => close());
  await act(async () => document.querySelector<HTMLButtonElement>(".resident-picker-option")!.click());
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("inspects a resident’s schedule without saving and flags overlapping coverage", async () => {
  const state = createInitialState();
  const resident = state.residents[0];
  state.assignments = [{ id: "assignment", kind: "block", targetId: "block_patel_mon", residentId: resident.id, locked: false, source: "admin", createdAt: "", updatedAt: "" }];
  act(() => root.render(<ResidentPicker state={state} kind="block" targetId="block_chen_mon" residents={[resident]} service="Davies" label="Unassigned" onSelect={onSelect} />));
  open();
  expect(document.querySelector(".resident-picker-target")?.textContent).toContain("Dr. Chen");
  expect(document.querySelector(".resident-workload")?.textContent).toContain("overlapping assignment");
  await act(async () => document.querySelector<HTMLButtonElement>(".resident-inspect")!.click());
  expect(document.querySelector(".resident-mobile-detail")?.textContent).toContain("Gastric bypass");
  expect(onSelect).not.toHaveBeenCalled();
});
