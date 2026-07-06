import type { ServicePrivilege } from "../shared/types";

export type Tab = "board" | "my" | "calendar" | "call" | "schedule" | "requests" | "roster" | "defaults" | "activity" | "users" | "account";
export type NavigationTab = readonly [Tab, string];

export function getNavigationTabs({
  canUseRequests,
  pendingCoverageRequestCount,
  isAdmin
}: {
  canUseRequests: boolean;
  pendingCoverageRequestCount: number;
  isAdmin: boolean;
}): NavigationTab[] {
  return [
    ["board", "OR / Clinic 🔪"],
    ["my", "My Schedule ☁️"],
    ["calendar", "Calendar 🗓️"],
    ["call", "CALL 📟"],
    ["schedule", "Blocks ⏹️"],
    ...(canUseRequests ? [["requests", pendingCoverageRequestCount > 0 ? `Requests 📤 (${pendingCoverageRequestCount})` : "Requests 📤"]] as const : []),
    ...(isAdmin ? [["roster", "Residents"], ["defaults", "Setup"], ["users", "Users"]] as const : []),
    ["activity", "Activity 🛒"],
    ["account", "Account 🛠️"]
  ];
}

export function canEditScheduleForSelectedService(isAdmin: boolean, selectedPrivilege: ServicePrivilege): boolean {
  return isAdmin || selectedPrivilege === "edit";
}
