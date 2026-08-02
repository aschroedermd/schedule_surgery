import { describe, expect, it } from "vitest";
import { canSeeDiagnosticErrors, presentActionError, presentBackgroundError } from "./errorPresentation";

describe("error presentation", () => {
  it("shows diagnostic detail only to admins and the aschroeder account", () => {
    expect(canSeeDiagnosticErrors({ role: "admin", username: "admin" })).toBe(true);
    expect(canSeeDiagnosticErrors({ role: "viewer", username: "Aschroeder" })).toBe(true);
    expect(canSeeDiagnosticErrors({ role: "viewer", username: "resident01" })).toBe(false);
  });

  it("uses actionable copy instead of internal errors for regular users", () => {
    const error = new SyntaxError("Unexpected end of JSON input");
    expect(presentActionError(error, "Please try again.", false)).toBe("Please try again.");
    expect(presentActionError(error, "Please try again.", true)).toBe("Unexpected end of JSON input");
  });

  it("preserves intentional client-error messages that tell a user what to correct", () => {
    const error = Object.assign(new Error("Daily limit reached. Try again tomorrow."), { status: 429 });
    expect(presentActionError(error, "Please try again.", false)).toBe("Daily limit reached. Try again tomorrow.");
  });

  it("keeps background failures quiet for regular users", () => {
    const error = new Error("database connection reset");
    expect(presentBackgroundError(error, false)).toBeUndefined();
    expect(presentBackgroundError(error, true)).toBe("database connection reset");
  });
});
