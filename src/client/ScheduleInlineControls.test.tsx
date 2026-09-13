// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardTab } from "./App";
import { createInitialState } from "../server/sampleData";
import { buildWeekSchedule, makeAssignment } from "../shared/scheduler";
import { createEntity, deleteEntity, moveCase, updateEntity } from "./api";
import type { PlannerState } from "../shared/types";

vi.mock("./api", async importOriginal => ({ ...await importOriginal<typeof import("./api")>(),
  createEntity: vi.fn(), deleteEntity: vi.fn(), moveCase: vi.fn(), updateEntity: vi.fn()
}));
let root: Root;
let container: HTMLDivElement;
let state: PlannerState;
beforeEach(() => {
  vi.clearAllMocks();
  state = createInitialState();
  state.assignments = [makeAssignment("case", "case_chen_whipple", "res_chief", "admin", false)];
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  vi.mocked(createEntity).mockResolvedValue(state);
  vi.mocked(deleteEntity).mockResolvedValue(state);
  vi.mocked(updateEntity).mockResolvedValue(state);
  vi.mocked(moveCase).mockResolvedValue(state);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });
function render(edit: boolean, editableAttendingId?: string) {
  act(() => root.render(<BoardTab state={state} schedule={buildWeekSchedule(state, "week_current", "Davies")}
    token="test" selectedService="Davies" canEdit={edit && !editableAttendingId} canMedicalStudentSelfAssign={false}
    showScheduleEditor={edit} editableAttendingId={editableAttendingId} onMutate={async action => { await action(); }} onCopied={() => {}} />));
}
function button(name: string, scope: ParentNode = container) {
  const result = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(button => button.getAttribute("aria-label") === name || button.textContent === name);
  if (!result) throw new Error(`Missing button: ${name}`);
  return result;
}
async function click(name: string, scope?: ParentNode) { await act(async () => button(name, scope).click()); }
function fill(input: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function submit(form: HTMLFormElement) { await act(async () => { form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); }); }

describe("inline schedule editing", () => {
  it("shows names without assignment or schedule controls in View and removes open forms when leaving Edit", async () => {
    render(false);
    expect(container.querySelector(".assignment-summary")?.textContent).toBeTruthy();
    expect(container.querySelector("select, .schedule-edit-actions, .schedule-day-add")).toBeNull();
    render(true);
    expect(container.querySelector(".assignment-select")).not.toBeNull();
    await click("Edit Whipple");
    expect(container.querySelector('form[aria-label="Edit case"]')).not.toBeNull();
    render(false);
    expect(container.querySelector("select, .schedule-inline-form, .schedule-edit-actions")).toBeNull();
  });

  it.each(["Clinic", "OR block", "Endoscopy block"])("adds %s from the selected day", async kind => {
    render(true); await click("Add block"); await click(kind);
    const form = container.querySelector<HTMLFormElement>(".schedule-inline-form")!;
    await submit(form);
    expect(createEntity).toHaveBeenCalledWith("test", kind === "Clinic" ? "clinicSessions" : "attendingBlocks",
      expect.objectContaining({ date: state.weeks[0].startDate, weekId: "week_current", attendingId: "att_chen",
        ...(kind === "Endoscopy block" ? { notes: "Endoscopy" } : {}) }));
    expect(container.querySelector(".schedule-inline-form")).toBeNull();
  });

  it("adds a named case with a start time and duration, then edits an existing case", async () => {
    render(true); await click("Add case");
    let form = container.querySelector<HTMLFormElement>('form[aria-label="Add case"]')!;
    fill(form.querySelector("input")!, "Hernia repair");
    fill(form.querySelector('input[type="time"]')!, "15:30");
    fill(form.querySelector('input[type="number"]')!, "60");
    await submit(form);
    expect(createEntity).toHaveBeenCalledWith("test", "cases", expect.objectContaining({ procedureLabel: "Hernia repair", durationMinutes: 60, startTimeOverride: "15:30", order: 2 }));
    await click("Edit Whipple");
    form = container.querySelector<HTMLFormElement>('form[aria-label="Edit case"]')!;
    fill(form.querySelector("input")!, "Updated procedure");
    await submit(form);
    expect(updateEntity).toHaveBeenCalledWith("test", "cases", "case_chen_whipple", expect.objectContaining({ procedureLabel: "Updated procedure" }));
  });

  it("uses one request to move a case and disables the boundary arrows", async () => {
    render(true);
    expect(button("Move Whipple up").disabled).toBe(true);
    expect(button("Move Laparoscopic cholecystectomy down").disabled).toBe(true);
    await click("Move Whipple down");
    expect(moveCase).toHaveBeenCalledExactlyOnceWith("test", "case_chen_whipple", "down");
  });

  it("requires an inline confirmation before deleting cases and blocks", async () => {
    render(true); await click("Delete Whipple");
    expect(deleteEntity).not.toHaveBeenCalled();
    await click("Cancel", container.querySelector(".schedule-delete-confirm")!);
    expect(deleteEntity).not.toHaveBeenCalled();
    const blockDelete = container.querySelector<HTMLButtonElement>('.block-edit-actions button[aria-label^="Delete"]')!;
    await act(async () => blockDelete.click());
    await click("Delete", container.querySelector(".schedule-delete-confirm")!);
    expect(deleteEntity).toHaveBeenCalledExactlyOnceWith("test", "attendingBlocks", "block_chen_mon");
  });

  it("keeps the case draft open after a failed save", async () => {
    vi.mocked(updateEntity).mockRejectedValue(new Error("Offline"));
    act(() => root.render(<BoardTab state={state} schedule={buildWeekSchedule(state, "week_current", "Davies")}
      token="test" selectedService="Davies" canEdit canMedicalStudentSelfAssign={false} showScheduleEditor
      onMutate={async action => { try { await action(); } catch {} }} onCopied={() => {}} />));
    await click("Edit Whipple");
    await submit(container.querySelector<HTMLFormElement>('form[aria-label="Edit case"]')!);
    expect(container.querySelector('form[aria-label="Edit case"]')).not.toBeNull();
  });

  it("lets attendings edit their own cases without enabling assignment pickers", async () => {
    render(true, "att_chen");
    expect(button("Edit Whipple")).toBeDefined();
    expect(container.querySelector(".assignment-select")).toBeNull();
    await click("Add block");
    expect(container.querySelector(".schedule-add-options")?.textContent).not.toContain("Clinic");
  });
});
