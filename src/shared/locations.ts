export const OR_LOCATIONS = ["RMH", "CCASC", "FMH", "Rockbridge"] as const;

/** Display aliases consistently without changing stored hospital IDs. */
export function normalizeOrLocation(location: string): string {
  if (/\b(?:CCAS[CE]|RCH|community)\b/i.test(location)) return "CCASC";
  if (/\bRMH\b/i.test(location)) return "RMH";
  if (/\bFMH\b/i.test(location)) return "FMH";
  if (/\bRockbridge\b/i.test(location)) return "Rockbridge";
  return location.trim();
}

export function normalizeClinicLocation(location: string): string {
  if (/\bCCR\s*3\b|\bRiverside(?:\s*3)?\b/i.test(location)) return "Riverside 3";
  return location.trim();
}
