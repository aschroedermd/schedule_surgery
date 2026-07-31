import { describe, expect, it } from "vitest";
import { createInitialState } from "./sampleData";
import { mergePublishedSchedule } from "./qgenda";

describe("QGenda published schedule merge", () => {
  it("consolidates the three night tasks into one ACS call assignment", () => {
    const state = createInitialState();
    const items = [
      "288f61d6-90af-413b-88e1-befd6e4044b7",
      "923f2f6a-c740-4dcf-9043-970b41eb5729",
      "dd48d80c-216d-4601-bd87-8731107babd6"
    ].map((taskKey, index) => ({
      scheduleEntryKey: `night_${index}`,
      date: "2026-07-10",
      taskKey,
      staffMemberKey: "f515c57d-c0bd-4180-8eda-2550ae1ab96d"
    }));

    const result = mergePublishedSchedule(state, items, "2026-07-01", "2026-07-31", "2026-07-01T03:00:00.000Z");

    expect(result.importedCount).toBe(1);
    expect(result.skippedCount).toBe(0);
    expect(result.state.attendingCoverageAssignments).toEqual([
      expect.objectContaining({
        date: "2026-07-10",
        line: "ACS",
        shift: "night",
        role: "primary",
        source: "qgenda",
        attendingId: "att_nussbaum"
      })
    ]);
  });

  it("keeps manual-only practice coverage while replacing QGenda-managed slots", () => {
    const state = createInitialState();
    state.attendingCoverageAssignments = [
      {
        id: "manual_practice",
        date: "2026-07-10",
        line: "Practice",
        shift: "24h",
        role: "primary",
        attendingId: "att_chen",
        source: "manual",
        note: "",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      },
      {
        id: "manual_egs",
        date: "2026-07-10",
        line: "EGS",
        shift: "day",
        role: "primary",
        attendingId: "att_chen",
        source: "manual",
        note: "",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z"
      }
    ];

    const result = mergePublishedSchedule(
      state,
      [{
        scheduleEntryKey: "new_egs",
        date: "2026-07-10",
        taskKey: "f1a142ee-6324-48f0-8e83-79ed03af7018",
        staffMemberKey: "f515c57d-c0bd-4180-8eda-2550ae1ab96d"
      }],
      "2026-07-01",
      "2026-07-31"
    );

    expect(result.state.attendingCoverageAssignments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "manual_practice", line: "Practice", source: "manual" }),
        expect.objectContaining({ line: "EGS", source: "qgenda", attendingId: "att_nussbaum" })
      ])
    );
    expect(result.state.attendingCoverageAssignments).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: "manual_egs" })]));
  });

  it("rejects inconsistent EGS, Trauma, and SCC night attendings", () => {
    const state = createInitialState();
    expect(() => mergePublishedSchedule(
      state,
      [
        {
          scheduleEntryKey: "egs_night",
          date: "2026-07-10",
          taskKey: "288f61d6-90af-413b-88e1-befd6e4044b7",
          staffMemberKey: "f515c57d-c0bd-4180-8eda-2550ae1ab96d"
        },
        {
          scheduleEntryKey: "trauma_night",
          date: "2026-07-10",
          taskKey: "923f2f6a-c740-4dcf-9043-970b41eb5729",
          staffMemberKey: "78f97eb3-2652-43d9-bb3c-b5a09ba61449"
        }
      ],
      "2026-07-01",
      "2026-07-31"
    )).toThrow(/conflicting attendings/i);
  });

  it("preserves an unchanged imported assignment without mutating the input state", () => {
    const state = createInitialState();
    const originalAttending = state.attendings.find((attending) => attending.id === "att_nussbaum")!;
    state.attendingCoverageAssignments = [{
      id: "existing_qgenda_assignment",
      date: "2026-07-10",
      line: "EGS",
      shift: "day",
      role: "primary",
      attendingId: "att_nussbaum",
      source: "qgenda",
      externalId: "old_remote_id",
      note: "",
      createdAt: "2026-06-01T03:00:00.000Z",
      updatedAt: "2026-06-01T03:00:00.000Z"
    }];

    const result = mergePublishedSchedule(
      state,
      [{
        scheduleEntryKey: "new_remote_id",
        date: "2026-07-10",
        taskKey: "f1a142ee-6324-48f0-8e83-79ed03af7018",
        staffMemberKey: "f515c57d-c0bd-4180-8eda-2550ae1ab96d"
      }],
      "2026-07-01",
      "2026-07-31",
      "2026-07-01T03:00:00.000Z"
    );

    expect(result.changedCount).toBe(0);
    expect(result.state.attendingCoverageAssignments[0]).toEqual(state.attendingCoverageAssignments[0]);
    expect(result.state.attendings.find((attending) => attending.id === "att_nussbaum")).not.toBe(originalAttending);
  });
});
