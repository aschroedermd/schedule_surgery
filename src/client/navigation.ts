import type { ServicePrivilege } from "../shared/types";

export type Tab = "chat" | "board" | "my" | "contacts" | "case-preferences" | "residents" | "calendar" | "call" | "call-builder" | "schedule" | "requests" | "roster" | "defaults" | "activity" | "users" | "interactions" | "account";
export type NavigationTab = readonly [Tab, string];

const ADMIN_NAVIGATION_TABS = new Set<Tab>(["roster", "defaults", "users", "activity", "interactions"]);
export function getInitialTab(search: string): Tab {
  return new URLSearchParams(search).get("section") === "account" ? "account" : "board";
}

export function getNavigationTabs({
  canUseRequests,
  canBuildCall = false,
  canUseCasePreferences = false,
  pendingCoverageRequestCount,
  isAdmin
}: {
  canUseRequests: boolean;
  canBuildCall?: boolean;
  canUseCasePreferences?: boolean;
  pendingCoverageRequestCount: number;
  isAdmin: boolean;
}): NavigationTab[] {
  return [
    ["board", "OR & Clinic 🔪"],
    ["chat", "Assistant ✦"],
    ["my", "My Schedule ☁️"],
    ["contacts", "Contacts ☎️"],
    ...(canUseCasePreferences || isAdmin ? [["case-preferences", "Case preferences"]] as const : []),
    ["calendar", "Calendar 🗓️"],
    ["call", "CALL 📟"],
    ...(canBuildCall || isAdmin ? [["call-builder", "Call Builder 🧩"]] as const : []),
    ["schedule", "Blocks ⏹️"],
    ...(canUseRequests ? [["requests", pendingCoverageRequestCount > 0 ? `Requests 📤 (${pendingCoverageRequestCount})` : "Requests 📤"]] as const : []),
    ...(isAdmin ? [["roster", "Roster"], ["defaults", "Setup"], ["users", "Users"], ["interactions", "User interactions"], ["activity", "Activity 🛒"]] as const : []),
    ["residents", "✨⭐️"],
    ["account", "Account 🛠️"]
  ];
}

export function isAdminNavigationTab(tab: Tab): boolean {
  return ADMIN_NAVIGATION_TABS.has(tab);
}

export function canEditScheduleForSelectedService(isAdmin: boolean, selectedPrivilege: ServicePrivilege): boolean {
  return isAdmin || selectedPrivilege === "edit";
}
