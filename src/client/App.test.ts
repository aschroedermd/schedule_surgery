import { describe, expect, it } from "vitest";
import { canEditScheduleForSelectedService, getNavigationTabs, type Tab } from "./navigation";

function tabIds(tabs: ReadonlyArray<readonly [Tab, string]>): string[] {
  return tabs.map(([tab]) => tab);
}

describe("planner navigation", () => {
  it("keeps admin setup tabs reachable without a separate schedule editor tab", () => {
    const tabs = getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 2, isAdmin: true });

    expect(tabIds(tabs)).toEqual(
      expect.arrayContaining(["roster", "defaults", "users"])
    );
    expect(tabIds(tabs)).not.toContain("entry");
  });

  it("hides admin setup tabs from non-admin users", () => {
    const tabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: false });

    expect(tabIds(tabs)).not.toEqual(
      expect.arrayContaining(["roster", "defaults", "users"])
    );
  });

  it("shows schedule editing only to admins or selected-service editors", () => {
    expect(canEditScheduleForSelectedService(true, "view")).toBe(true);
    expect(canEditScheduleForSelectedService(false, "edit")).toBe(true);
    expect(canEditScheduleForSelectedService(false, "request")).toBe(false);
    expect(canEditScheduleForSelectedService(false, "view")).toBe(false);
  });
});
