import { describe, expect, it } from "vitest";
import { applyDictationReplacements } from "./dictationReplacements";

describe("applyDictationReplacements", () => {
  it("corrects dictation aliases case-insensitively", () => {
    expect(applyDictationReplacements("Bauer asked for a lap cole with a jay pee drain.")).toBe(
      "Bower asked for a laparoscopic cholecystectomy with a JP drain."
    );
  });

  it("prefers longer, overlapping aliases", () => {
    expect(applyDictationReplacements("Check the common bowel duck after the lap coli cystectomy.")).toBe(
      "Check the common bile duct after the laparoscopic cholecystectomy."
    );
  });

  it("does not replace aliases embedded within other words", () => {
    expect(applyDictationReplacements("The surgicality score and fashionista note are unchanged.")).toBe(
      "The surgicality score and fashionista note are unchanged."
    );
  });

  it("handles punctuation and preserves it", () => {
    expect(applyDictationReplacements("Coker maneuver; x-lap, then GDA.")).toBe(
      "Kocher maneuver; ex lap, then GDA."
    );
  });
});
