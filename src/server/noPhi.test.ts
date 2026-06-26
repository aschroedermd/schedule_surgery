import { describe, expect, it } from "vitest";
import { createInitialState } from "./sampleData";

const forbidden = /\b(patient|mrn|dob|date of birth|medical record|identifier)\b/i;

describe("no-PHI sample data", () => {
  it("does not include patient identifiers or patient-specific fields", () => {
    const state = createInitialState();
    const hits: string[] = [];

    walk(state, [], hits);

    expect(hits).toEqual([]);
  });
});

function walk(value: unknown, path: string[], hits: string[]) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, [...path, String(index)], hits));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (forbidden.test(key)) {
        hits.push([...path, key].join("."));
      }
      walk(child, [...path, key], hits);
    }
    return;
  }

  if (typeof value === "string" && forbidden.test(value)) {
    hits.push(`${path.join(".")}=${value}`);
  }
}
