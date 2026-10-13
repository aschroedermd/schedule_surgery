// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BoardPrintout } from "./App";
import { createInitialState } from "../server/sampleData";
import { buildWeekSchedule, makeAssignment } from "../shared/scheduler";

describe("weekly OR / clinic printout", () => {
  it.each([true, false])("keeps all days in one row (weekdayOnly=%s)", weekdayOnly => {
    const state = createInitialState(new Date(2026, 9, 12));
    state.settings.weekdayOnly = weekdayOnly;
    const schedule = buildWeekSchedule(state, "week_current", "Davies");
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<BoardPrintout snapshot={{ state, schedule, serviceLine: "Davies", weekRange: "Oct 12–18" }} />);
    expect(container.querySelectorAll(".print-day")).toHaveLength(weekdayOnly ? 5 : 7);
    expect((container.querySelector(".print-board-days") as HTMLElement).style.gridTemplateColumns)
      .toBe(`repeat(${schedule.days.length}, minmax(0, 1fr))`);
    expect(container.querySelectorAll(".print-empty").length).toBeGreaterThan(0);
  });

  it("preserves long labels and multiple assignments in separate fields", () => {
    const state = createInitialState(new Date(2026, 9, 12));
    state.attendings[0].name = "Dr. Alexandra Montgomery-Worthington";
    state.residents[0].name = "Alexandra Montgomery-Worthington";
    state.residents[1].name = "Christopher Featherstonehaugh";
    state.cases[0].procedureLabel = "Pancreaticoduodenectomy with complex vascular reconstruction";
    state.assignments = state.residents.slice(0, 2).map(resident => makeAssignment("case", state.cases[0].id, resident.id, "admin", false));
    const schedule = buildWeekSchedule(state, "week_current", "Davies");
    const container = document.createElement("div");
    container.innerHTML = renderToStaticMarkup(<BoardPrintout snapshot={{ state, schedule, serviceLine: "Davies", weekRange: "Oct 12–16" }} />);
    expect(container.querySelector(".print-block-heading strong")?.textContent).toBe(state.attendings[0].name);
    const row = container.querySelector(".print-case-row")!;
    expect(row.children[1].textContent).toBe(state.cases[0].procedureLabel);
    expect(row.children[2].textContent).toBe("Montgomery-Worthington, Featherstonehaugh");
    expect(container.querySelector(".print-open")?.textContent).toBe("open");
    expect(container.querySelectorAll(".print-clinic")).toHaveLength(schedule.days.reduce((count, day) => count + day.clinics.length, 0));
  });
});
