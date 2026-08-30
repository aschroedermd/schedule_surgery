import type { ServicePrivilege } from "../shared/types";

export type Tab = "chat" | "board" | "my" | "contacts" | "residents" | "calendar" | "call" | "call-builder" | "schedule" | "requests" | "roster" | "defaults" | "activity" | "users" | "account";
export type NavigationTab = readonly [Tab, string];

const ADMIN_NAVIGATION_TABS = new Set<Tab>(["roster", "defaults", "users", "activity"]);
const MOBILE_PRIMARY_TABS = new Set<Tab>(["chat", "board", "my", "calendar"]);

export function getNavigationTabs({
  canUseRequests,
  canBuildCall = false,
  pendingCoverageRequestCount,
  isAdmin
}: {
  canUseRequests: boolean;
  canBuildCall?: boolean;
  pendingCoverageRequestCount: number;
  isAdmin: boolean;
}): NavigationTab[] {
  return [
    ["chat", "Assistant ✦"],
    ["board", "OR / Clinic 🔪"],
    ["my", "My Schedule ☁️"],
    ["contacts", "Contacts ☎️"],
    ["calendar", "Calendar 🗓️"],
    ["call", "CALL 📟"],
    ...(canBuildCall || isAdmin ? [["call-builder", "Call Builder 🧩"]] as const : []),
    ["schedule", "Blocks ⏹️"],
    ...(canUseRequests ? [["requests", pendingCoverageRequestCount > 0 ? `Requests 📤 (${pendingCoverageRequestCount})` : "Requests 📤"]] as const : []),
    ...(isAdmin ? [["roster", "Roster"], ["defaults", "Setup"], ["users", "Users"], ["activity", "Activity 🛒"]] as const : []),
    ["residents", "✨⭐️"],
    ["account", "Account 🛠️"]
  ];
}

export function isAdminNavigationTab(tab: Tab): boolean {
  return ADMIN_NAVIGATION_TABS.has(tab);
}

export function isMobilePrimaryTab(tab: Tab): boolean {
  return MOBILE_PRIMARY_TABS.has(tab);
}

export function canEditScheduleForSelectedService(isAdmin: boolean, selectedPrivilege: ServicePrivilege): boolean {
  return isAdmin || selectedPrivilege === "edit";
}
