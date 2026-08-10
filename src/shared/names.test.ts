import { describe, expect, it } from "vitest";
import { comparePersonNames, getPersonSurnameSortKey } from "./names";

describe("person-name ordering", () => {
  it("orders full names by surname and then display name", () => {
    const names = ["Zoe Adams", "Amy Clark", "Robert Clark", "Ben Young"];
    expect(names.sort(comparePersonNames)).toEqual(["Zoe Adams", "Amy Clark", "Robert Clark", "Ben Young"]);
  });

  it("keeps common surname particles with the surname", () => {
    expect(getPersonSurnameSortKey("Zachary den Besten")).toBe("den besten");
    expect(getPersonSurnameSortKey("Ana van der Meer")).toBe("van der meer");
  });

  it("ignores titles, suffixes, and credential text", () => {
    expect(getPersonSurnameSortKey("Dr. Jane Smith Jr.")).toBe("smith");
    expect(getPersonSurnameSortKey("Bethany Nichols, NP - EGS")).toBe("nichols");
    expect(getPersonSurnameSortKey("Smith, Jane")).toBe("smith");
  });
});
