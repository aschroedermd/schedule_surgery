import { describe, expect, it } from "vitest";
import { addDays, getDefaultPlannerMonday, getMondayForDate } from "./date";

describe("date helpers", () => {
  it("finds the Monday for any date in a week", () => {
    expect(getMondayForDate("2026-07-06")).toBe("2026-07-06");
    expect(getMondayForDate("2026-07-08")).toBe("2026-07-06");
    expect(getMondayForDate("2026-07-12")).toBe("2026-07-06");
  });

  it("defaults the planner to next week on Saturday and Sunday", () => {
    expect(getDefaultPlannerMonday(new Date(2026, 6, 4))).toBe("2026-07-06");
    expect(getDefaultPlannerMonday(new Date(2026, 6, 5))).toBe("2026-07-06");
  });

  it("defaults the planner to the current week on weekdays", () => {
    expect(getDefaultPlannerMonday(new Date(2026, 6, 6))).toBe("2026-07-06");
    expect(getDefaultPlannerMonday(new Date(2026, 6, 10))).toBe("2026-07-06");
  });

  it("advances calendar dates across daylight-saving transitions", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-11-01", 1)).toBe("2026-11-02");
    expect(addDays("2027-03-14", 1)).toBe("2027-03-15");
    expect(addDays("2026-11-01", -1)).toBe("2026-10-31");
  });
});
