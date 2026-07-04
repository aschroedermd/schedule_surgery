import { describe, expect, it } from "vitest";
import {
  callCreatesPostCallDay,
  hasServiceRoundingCoverage,
  hasWeekendCoverage,
  isCoverageKindAllowedOnDate,
  isWeekendCoverageRequired
} from "./coverage";
import { CoverageEntry, Resident } from "./types";

const baseEntry: CoverageEntry = {
  id: "cover_test",
  date: "2026-07-04",
  kind: "call",
  residentId: "res_schroeder",
  note: "",
  createdAt: "2026-06-27T14:36:21.000Z",
  updatedAt: "2026-06-27T14:36:21.000Z"
};

const residents: Resident[] = [
  {
    id: "res_davies",
    name: "Davies Resident",
    trainingLevel: "PGY3",
    serviceTags: ["Davies"],
    tags: [],
    trainingInterests: [],
    unavailable: []
  },
  {
    id: "res_berry",
    name: "Berry Resident",
    trainingLevel: "PGY3",
    serviceTags: ["Berry"],
    tags: [],
    trainingInterests: [],
    unavailable: []
  }
];

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

  it("only treats Friday and Saturday call as creating a post-call next day", () => {
    expect(callCreatesPostCallDay("2026-07-03")).toBe(true);
    expect(callCreatesPostCallDay("2026-07-04")).toBe(true);
    expect(callCreatesPostCallDay("2026-07-05")).toBe(false);
  });

  it("covers a service when its resident is on call or explicitly rounding", () => {
    const entries: CoverageEntry[] = [
      { ...baseEntry, id: "cover_davies_call", residentId: "res_davies", kind: "call" },
      { ...baseEntry, id: "cover_berry_round", residentId: "res_berry", kind: "rounding" }
    ];

    expect(hasServiceRoundingCoverage(entries, residents, "2026-07-04", "Davies")).toBe(true);
    expect(hasServiceRoundingCoverage(entries, residents, "2026-07-04", "Berry")).toBe(true);
    expect(hasServiceRoundingCoverage(entries, residents, "2026-07-04", "ICU")).toBe(false);
  });
});
