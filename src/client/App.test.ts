import { describe, expect, it } from "vitest";
import {
  canEditScheduleForSelectedService,
  getNavigationTabs,
  isAdminNavigationTab,
  isMobilePrimaryTab,
  type Tab
} from "./navigation";

function tabIds(tabs: ReadonlyArray<readonly [Tab, string]>): string[] {
  return tabs.map(([tab]) => tab);
}

describe("planner navigation", () => {
  it("shows the Gold Star residents tab to all users", () => {
    const adminTabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: true });
    const userTabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: false });

    expect(adminTabs).toContainEqual(["residents", "Residents ✨"]);
    expect(userTabs).toContainEqual(["residents", "Residents ✨"]);
    expect(adminTabs).toContainEqual(["roster", "Roster"]);
  });

  it("keeps the residents tab second to last", () => {
    const adminTabIds = tabIds(getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 2, isAdmin: true }));
    const userTabIds = tabIds(getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 2, isAdmin: false }));

    expect(adminTabIds.at(-2)).toBe("residents");
    expect(userTabIds.at(-2)).toBe("residents");
  });

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
      expect.arrayContaining(["roster", "defaults", "users", "activity"])
    );
  });

  it("keeps activity reachable for admins only", () => {
    const adminTabs = getNavigationTabs({ canUseRequests: false, pendingCoverageRequestCount: 0, isAdmin: true });
    const userTabs = getNavigationTabs({ canUseRequests: true, pendingCoverageRequestCount: 1, isAdmin: false });

    expect(tabIds(adminTabs)).toContain("activity");
    expect(tabIds(userTabs)).not.toContain("activity");
  });

  it("keeps the responsive navigation groups presentation-only", () => {
    expect(["roster", "defaults", "users", "activity"].every((tab) => isAdminNavigationTab(tab as Tab))).toBe(true);
    expect(isAdminNavigationTab("account")).toBe(false);
    expect(["board", "my", "calendar", "call"].every((tab) => isMobilePrimaryTab(tab as Tab))).toBe(true);
    expect(isMobilePrimaryTab("residents")).toBe(false);
  });

  it("shows schedule editing only to admins or selected-service editors", () => {
    expect(canEditScheduleForSelectedService(true, "view")).toBe(true);
    expect(canEditScheduleForSelectedService(false, "edit")).toBe(true);
    expect(canEditScheduleForSelectedService(false, "request")).toBe(false);
    expect(canEditScheduleForSelectedService(false, "view")).toBe(false);
  });
});
