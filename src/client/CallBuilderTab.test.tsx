import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createInitialState } from "../server/sampleData";
import { CallBuilderTab } from "./CallBuilderTab";

describe("Call Builder screen", () => {
  it("shows every scheduling input category before a schedule has been built", () => {
    const markup = renderToStaticMarkup(
      <CallBuilderTab
        state={createInitialState(new Date("2026-09-01T12:00:00"))}
        token="builder-token"
        username="builder"
        onMutate={async () => {}}
      />
    );

    expect(markup).toContain("Scheduling inputs");
    expect(markup).toContain("Call-off requests");
    expect(markup).toContain("Vacations");
    expect(markup).toContain("Approved unavailable");
    expect(markup).toContain("Rotation unavailable");
    expect(markup).toContain("Weekday holiday day shifts");
    expect(markup.indexOf("Scheduling inputs")).toBeLessThan(markup.indexOf("Ready to build"));
  });

  it("offers resident-specific must-call and must-be-off rules", () => {
    const markup = renderToStaticMarkup(
      <CallBuilderTab
        state={createInitialState(new Date("2026-09-01T12:00:00"))}
        token="builder-token"
        username="builder"
        onMutate={async () => {}}
      />
    );

    expect(markup).toContain("Resident-specific rules");
    expect(markup).toContain("Must be off");
    expect(markup).toContain("Must be on call");
    expect(markup).toContain("Labor Day daytime (12h)");
  });
});
