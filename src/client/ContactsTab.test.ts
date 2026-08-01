import { describe, expect, it } from "vitest";
import { splitContactNameAndTitle } from "./ContactsTab";
import { buildVCard } from "./vcard";

describe("contact card downloads", () => {
  it("builds an iPhone-compatible vCard with directory metadata", () => {
    const card = buildVCard({
      id: "contact_pacu",
      name: "PACU",
      phoneNumber: "(540) 981-7173",
      category: "Perioperative",
      directoryType: "Hospital",
      organization: "Hospital Directory",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });

    expect(card).toContain("BEGIN:VCARD\r\nVERSION:3.0");
    expect(card).toContain("FN:PACU");
    expect(card).toContain("ORG:Hospital Directory");
    expect(card).toContain("TEL;TYPE=WORK,VOICE:+15409817173");
    expect(card).toContain("CATEGORIES:Perioperative");
    expect(card).toContain("UID:contact_pacu@hospital-directory");
    expect(card).toMatch(/END:VCARD\r\n$/);
  });

  it("includes every listed number in a downloaded contact card", () => {
    const card = buildVCard({
      id: "contact_admin",
      name: "Clinic Practice Manager, General Surgery",
      phoneNumber: "(540) 526-1242",
      alternatePhoneNumbers: ["(540) 597-4174"],
      category: "Administrative Staff",
      directoryType: "Faculty & Staff",
      organization: "Carilion Clinic Department of Surgery",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-01T00:00:00.000Z"
    });

    expect(card).toContain("TEL;TYPE=WORK,VOICE:+15405261242");
    expect(card).toContain("TEL;TYPE=WORK,VOICE:+15405974174");
  });
});

describe("contact row labels", () => {
  it("moves credentials and roles onto a secondary line", () => {
    expect(splitContactNameAndTitle("Bethany Nichols, NP - EGS")).toEqual({
      name: "Bethany Nichols",
      title: "NP - EGS"
    });
    expect(splitContactNameAndTitle("Anita Lewis - Department Secretary, General Surgery (CCR 3)")).toEqual({
      name: "Anita Lewis",
      title: "Department Secretary, General Surgery (CCR 3)"
    });
  });

  it("keeps department and unit names intact", () => {
    expect(splitContactNameAndTitle("Clinic Practice Manager, General Surgery")).toEqual({
      name: "Clinic Practice Manager, General Surgery"
    });
  });
});
