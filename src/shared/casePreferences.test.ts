import { describe, expect, it } from "vitest";
import { casePreferencesAccess, resolveCasePreferences, rudderowExample } from "./casePreferences";
describe("case-specific preference resolution", () => {
  it("replaces entry and removes the closure item including every alternative", () => {
    const card = rudderowExample();
    const primary = resolveCasePreferences(card, []);
    expect(primary.rows.find((row) => row.id === "closure")?.preferences).toHaveLength(2);
    const adjusted = resolveCasePreferences(card, ["bypass"]);
    expect(adjusted.rows.find((row) => row.id === "entry")).toMatchObject({ status: "replaced", preferences: ["12 mm Hasson port"] });
    expect(adjusted.rows.find((row) => row.id === "closure")?.status).toBe("removed");
    expect(adjusted.rows.find((row) => row.id === "scope")?.status).toBe("unchanged");
    expect(resolveCasePreferences(card, []).rows.find((row) => row.id === "entry")?.preferences[0]).toContain("OptiView");
  });
  it("flags overlapping changes independent of selection order", () => {
    const card = rudderowExample();
    card.contingencies.push({ id: "bmi", name: "BMI over 50", conditions: [], changes: [{ id: "veress", action: "replace", itemId: "entry", preferences: ["Veress needle"], quantity: 1, notes: "" }] });
    for (const ids of [["bypass", "bmi"], ["bmi", "bypass"]]) {
      const result = resolveCasePreferences(card, ids);
      expect(result.conflicts.map((row) => row.id)).toEqual(["entry"]);
      expect(result.conflicts[0].preferences).toEqual(["12 mm OptiView trocar"]);
    }
  });
  it("adds equipment only while its own contingency is selected", () => {
    const card = rudderowExample();
    card.contingencies[0].changes.push({ id: "extra", action: "add", item: { id: "extra-item", category: "other", quantity: 2, preferences: ["Extra equipment", "Backup equipment"], notes: "" } });
    expect(resolveCasePreferences(card, ["bypass"]).rows.find((row) => row.id === "extra-item")).toMatchObject({ status: "added", quantity: 2 });
    expect(resolveCasePreferences(card, []).rows.find((row) => row.id === "extra-item")).toBeUndefined();
  });
  it("defaults existing users to no access and gives admins edit access", () => {
    expect(casePreferencesAccess({ role: "resident" })).toBe("none");
    expect(casePreferencesAccess({ role: "admin", casePreferencesAccess: "none" })).toBe("edit");
  });
});

import { casePreferenceLibrary, casePreferenceTemplate, matchesCasePreferenceQuery, type CasePreferenceCard } from "./casePreferences";
function savedCard(id: string, isDefault = false, surgeonName = "Dr. John Rudderow"): CasePreferenceCard {
  return { ...rudderowExample(), id, isDefault, surgeonName: isDefault ? "" : surgeonName, revision: 1, updatedAt: "2026-10-13T12:00:00Z", updatedBy: "admin" };
}
it("falls back to procedure defaults for roster surgeons and gives custom cards priority", () => {
  const fallback = savedCard("default", true);
  const custom = savedCard("custom");
  const library = casePreferenceLibrary([fallback, custom], ["John Rudderow", "Dr. Other Surgeon"]);
  expect(library.filter((entry) => entry.card.surgeonName.includes("Rudderow"))).toHaveLength(1);
  expect(library.find((entry) => entry.card.surgeonName.includes("Rudderow"))?.source.id).toBe("custom");
  const other = library.find((entry) => entry.card.surgeonName === "Dr. Other Surgeon")!;
  expect(other.inherited).toBe(true);
  expect(other.card.isDefault).toBe(true);
  expect(other.source.id).toBe("default");
  expect(casePreferenceLibrary([fallback], ["John Rudderow"]).find((entry) => entry.inherited)?.source.id).toBe("default");
});
it("keeps fallback cards linked to the latest default instead of making copies", () => {
  const fallback = savedCard("default", true);
  const before = casePreferenceLibrary([fallback], ["Dr. Other Surgeon"]);
  const after = casePreferenceLibrary([{ ...fallback, items: [{ ...fallback.items[0], preferences: ["Updated tray"] }] }], ["Dr. Other Surgeon"]);
  expect(before.find((entry) => entry.inherited)?.key).toBe(after.find((entry) => entry.inherited)?.key);
  expect(after.find((entry) => entry.inherited)?.card.items[0].preferences).toEqual(["Updated tray"]);
});
it("builds empty, open, and laparoscopic templates with editable closure and trocar groups", () => {
  expect(casePreferenceTemplate("empty").items).toEqual([]);
  expect(casePreferenceTemplate("open").items.some((item) => item.group === "Closure")).toBe(true);
  expect(casePreferenceTemplate("laparoscopic").items.map((item) => item.category)).toContain("scope");
  expect(casePreferenceTemplate("laparoscopic").items.some((item) => item.group === "Laparoscopic trocars")).toBe(true);
});
it("finds a card using the procedure and surgeon in either order", () => {
  expect(matchesCasePreferenceQuery(rudderowExample(), "appendectomy Rudderow")).toBe(true);
  expect(matchesCasePreferenceQuery(rudderowExample(), "Rudderow cholecystectomy")).toBe(false);
});
