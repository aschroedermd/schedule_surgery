// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CalendarTab } from "./CoverageCalendar";
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
