import { expect, it } from "vitest";
import { createInitialState } from "../server/sampleData";
import { matchingStudents } from "./students";
import { getResidentServiceTagsForDate } from "./rotations";
import { isResidentCallEligible } from "./coverage";
import type { Resident } from "./types";
const student: Resident = { ...createInitialState().residents[0], name: "Greg Smith", trainingLevel: "Student", serviceTags: ["Berry"], studentPlacements: [{ service: "Berry", startDate: "2026-10-13", endDate: "2026-11-02" }] };
it("matches existing student names without confusing residents or ignoring aliases", () => {
  expect(matchingStudents([student, { ...student, id: "resident", trainingLevel: "PGY1" }], " Greg  SMITH ")).toEqual([student]);
  expect(matchingStudents([{ ...student, aliases: ["Gregory Smith"] }], "Gregory Smith")).toHaveLength(1);
});
it("expires team placement inclusively without losing student identity or falling back to stale tags", () => {
  expect(getResidentServiceTagsForDate(student, "2026-10-12")).toEqual([]);
  expect(getResidentServiceTagsForDate(student, "2026-10-13")).toEqual(["Berry"]);
  expect(getResidentServiceTagsForDate(student, "2026-11-02")).toEqual(["Berry"]);
  expect(getResidentServiceTagsForDate(student, "2026-11-03")).toEqual([]);
  expect(isResidentCallEligible(student)).toBe(false);
});
