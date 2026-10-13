/** Source fixture is ONLY Monday October 12, 2026; surnames are deliberately not expanded. */
export const attendingCoverage20261012 = [
  { line: "EGS", name: "Williams", shift: "day", role: "primary" },
  { line: "Unassigned – Night", name: "Stodghill", shift: "night", role: "primary" },
  { line: "Practice/Bariatric", name: "Saha", shift: "day", role: "primary" },
  { line: "Trauma Day", name: "Faulks", shift: "day", role: "primary" },
  { line: "Trauma Night", name: "Stodghill", shift: "night", role: "primary" },
  { line: "2nd Call Backup", name: "Collier", shift: "day", role: "backup" },
  { line: "Critical Care", name: "Smith", shift: "day", role: "primary" },
  { line: "CRBH / Rockbridge", name: "Kelly", shift: "day", role: "primary" },
  { line: "CFMH / Franklin Memorial", name: "Tershak", shift: "day", role: "primary" },
  { line: "Pediatric Surgery", name: "Wattsman", shift: "day", role: "primary", startTime: "07:00", endTime: "17:00", endDate: "2026-10-12" },
  { line: "Pediatric Surgery", name: "Bass", shift: "night", role: "primary", startTime: "17:00", endTime: "07:00", endDate: "2026-10-13" },
  { line: "CCVS & AC", name: "Ambroz", shift: "day", role: "primary" },
  { line: "Breast Surgery", name: "Davenport", shift: "day", role: "primary" },
  { line: "Foregut Call", name: "Williams", shift: "day", role: "primary" }
] as const;
