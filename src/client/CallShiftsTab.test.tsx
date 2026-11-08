// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createInitialState } from "../server/sampleData";
import { CallShiftsTab } from "./App";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 10, 8, 23, 30));
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function openCall() {
  act(() => root.render(<CallShiftsTab state={createInitialState()} token="test"
    isAdmin={false} canBuildCall={false} onMutate={vi.fn()} />));
}

it("opens to the current month on every visit, even with an older saved calendar month", () => {
  localStorage.setItem("coverageCalendarMonth", "2026-10");
  openCall();
  const selectedMonth = () => container.querySelector<HTMLInputElement>('[aria-label="Call month"]')!.value;
  expect(selectedMonth()).toBe("2026-11");
  act(() => container.querySelector<HTMLButtonElement>('[title="Next month"]')!.click());
  expect(selectedMonth()).toBe("2026-12");
  act(() => root.render(null));
  openCall();
  expect(selectedMonth()).toBe("2026-11");
  expect(localStorage.getItem("coverageCalendarMonth")).toBe("2026-10");
});

it("grays out only dates before today, including dates from the previous month", () => {
  openCall();
  const card = (date: string) => container.querySelector(`[aria-label="Attending coverage for ${date}"]`)!.closest(".call-day-card")!;
  expect(card("2026-10-31").classList.contains("past")).toBe(true);
  expect(card("2026-11-07").classList.contains("past")).toBe(true);
  expect(card("2026-11-08").matches(".today:not(.past)")).toBe(true);
  expect(card("2026-11-13").classList.contains("past")).toBe(false);

  for (const view of ["night", "weekly"]) {
    act(() => container.querySelector<HTMLButtonElement>(`[aria-controls="attending-${view}-schedule"]`)!.click());
    expect(container.querySelectorAll(".attending-calendar-day.past")).toHaveLength(7);
    expect(container.querySelector(".attending-calendar-day.today:not(.past) > header")?.textContent).toBe("8");
  }
});
