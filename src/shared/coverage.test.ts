import { describe, expect, it } from "vitest";
import {
  hasWeekendCoverage,
  isCoverageKindAllowedOnDate,
  isWeekendCoverageRequired
} from "./coverage";
import { CoverageEntry } from "./types";

const baseEntry: CoverageEntry = {
  id: "cover_test",
  date: "2026-07-04",
  kind: "call",
  residentId: "res_schroeder",
  note: "",
  createdAt: "2026-06-27T14:36:21.000Z",
  updatedAt: "2026-06-27T14:36:21.000Z"
};

describe("coverage calendar rules", () => {
  it("requires Saturday and Sunday coverage by call or rounding", () => {
    expect(isWeekendCoverageRequired("2026-07-04")).toBe(true);
    expect(isWeekendCoverageRequired("2026-07-05")).toBe(true);
    expect(isWeekendCoverageRequired("2026-07-06")).toBe(false);

    expect(hasWeekendCoverage([], "2026-07-04")).toBe(false);
    expect(hasWeekendCoverage([baseEntry], "2026-07-04")).toBe(true);
    expect(hasWeekendCoverage([{ ...baseEntry, kind: "rounding" }], "2026-07-04")).toBe(true);
  });

  it("limits call and rounding assignment days", () => {
    expect(isCoverageKindAllowedOnDate("call", "2026-07-03")).toBe(true);
    expect(isCoverageKindAllowedOnDate("call", "2026-07-04")).toBe(true);
    expect(isCoverageKindAllowedOnDate("call", "2026-07-05")).toBe(true);
    expect(isCoverageKindAllowedOnDate("call", "2026-07-06")).toBe(false);

    expect(isCoverageKindAllowedOnDate("rounding", "2026-07-04")).toBe(true);
    expect(isCoverageKindAllowedOnDate("rounding", "2026-07-05")).toBe(true);
    expect(isCoverageKindAllowedOnDate("rounding", "2026-07-03")).toBe(false);
  });
});
