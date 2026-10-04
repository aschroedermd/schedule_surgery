/** Public, patient-free schedule import conventions shared by the HTML and JSON guides. */
export const AGENT_IMPORT_GUIDE = {
  serviceRouting: {
    aliases: {
      Barry: "Berry",
      "S. Adkins": "Stacie Adkins / Berry",
      "F. Adkins": "Farrell Adkins / Fogel",
      "Ashley Gerrish": "Davies"
    },
    commonAttendings: {
      Berry: ["Stacie Adkins", "John Hagy", "Michael Nussbaum", "Charles Paget", "John Rudderow", "Sanjoy Saha", "Daniel Tershak"],
      Davies: ["Curtis Bower", "Ashley Gerrish", "Guy Katz", "T. Lucktong", "Arnold Salzberg", "Sharon Williams"],
      Fogel: ["Terry Nickerson", "Farrell Adkins"]
    },
    rule: "For Berry, Davies, and Fogel, match a supplied surgeon to one of the listed candidates and then resolve exactly one existing attendings[] id with the expected live service. If no candidate matches, clarify; do not force a different surgeon into a service. These are name-resolution aids, not permission to rename or create roster records. Distinguish Curtis (C.) Bower from K. Bower; never match Bower by surname alone. Cases inherit service from their block's attending. Clinics must set service explicitly. Import only entries supplied by the source; an omitted attending may be away and has no implied cases."
  },
  durationDefaultsMinutes: {
    "lap chole": 90,
    "robotic chole": 90,
    "open inguinal": 60,
    "laparoscopic inguinal": 90,
    "open umbilical": 30,
    "soft tissue excision": 30,
    colectomy: 120,
    Whipple: 200,
    "rectal exam under anesthesia": 45,
    parathyroidectomy: 120,
    parathyroid: 120,
    "total thyroidectomy": 120,
    "Altmeier procedure": 120
  },
  durationPolicy: "Use the source's exact duration first, then the matching approved default above; this list supersedes older procedureDefaults values in state (including an older Whipple estimate of 360). Otherwise use 90 minutes as an explicit estimate and record 'Estimated duration: 90 minutes (general default)' in case notes. Mark a list-based default as an estimate in notes too. Do not label an estimate as a source duration. For a source endoscopy interval, enter one case with its exact interval duration and fixed startTimeOverride; do not split it into invented procedures.",
  locationPolicy: "Ordinary clinic location defaults to Riverside 3; Stacie Adkins clinic defaults to FMH. Resolve hospitalId from live hospitals[] when known. Endoscopy is a kind of session, not one fixed hospital: it may be at RMH, CCASC, or FMH. Use the source's site, with an Endo/Endoscopy location label; ask when the site is missing. 'OR location to confirm' requires clarification before creating an OR block; do not use attending.defaultHospitalId as a guess.",
  duplicateKeys: {
    block: "week/date + attendingId + hospitalId + firstCaseStartTime",
    case: "blockId + zero-based order + procedureLabel (identical procedures at different orders are distinct cases)",
    clinic: "date + attendingId + startTime + endTime"
  },
  correctionPolicy: "Read existing entries before every creation. Reuse or patch a matching record. 'Add this' adds only supplied entries; 'nothing scheduled' or an omitted surgeon never authorizes deleting existing entries. A replacement request needs separately confirmed scope and removal semantics before deletes.",
  retryPolicy: "Every successful planner mutation returns the full updated PlannerState with a new version; use that version as X-State-Version for the next write. On 409, refetch state and compare the intended entity before retrying. On timeout or interruption, read the target back first: the write may already have succeeded. Keep a per-entity progress journal of source row, matching key, id, request outcome, and verified version; resume from the journal without duplicating a partial import.",
  verificationPolicy: "Read both /api/weeks/{weekId}/schedule?service={service} and /api/weeks/{weekId}/warnings?service={service}. Compare supplied source counts, dates, attending IDs, hospital IDs, case order, clinic intervals, and exact endoscopy end times. Report uncovered work separately. Zero warnings does not prove completeness or resident coverage.",
  example: {
    note: "Illustrative IDs and dates only. Replace attendingId and hospitalId with IDs from the live state; never create a roster record to make an example work.",
    week: { id: "week_2026_10_05", startDate: "2026-10-05", label: "Oct 5–11, 2026" },
    block: { id: "block_2026_10_06_gerrish_rmh_0730", weekId: "week_2026_10_05", date: "2026-10-06", attendingId: "att_gerrish_FROM_STATE", hospitalId: "hosp_rmh_FROM_STATE", firstCaseStartTime: "07:30", notes: "" },
    cases: [
      { id: "case_2026_10_06_gerrish_chole_0", blockId: "block_2026_10_06_gerrish_rmh_0730", procedureLabel: "Lap chole", durationMinutes: 90, priority: 2, tags: [], notes: "Estimated duration: 90 minutes (lap chole default)", order: 0 },
      { id: "case_2026_10_06_gerrish_chole_1", blockId: "block_2026_10_06_gerrish_rmh_0730", procedureLabel: "Lap chole", durationMinutes: 90, priority: 2, tags: [], notes: "Estimated duration: 90 minutes (lap chole default)", order: 1 }
    ],
    clinic: { id: "clinic_2026_10_08_gerrish_1300", weekId: "week_2026_10_05", date: "2026-10-08", startTime: "13:00", endTime: "17:00", attendingId: "att_gerrish_FROM_STATE", service: "Davies", location: "Riverside 3", capacity: 1, isProcedure: false },
    endoscopyBlock: { id: "block_2026_10_07_katz_ccasc_0730", weekId: "week_2026_10_05", date: "2026-10-07", attendingId: "att_katz_FROM_STATE", hospitalId: "hosp_ccasc_FROM_STATE", firstCaseStartTime: "07:30", notes: "Endoscopy" },
    endoscopyCase: { id: "case_2026_10_07_katz_endo_0", blockId: "block_2026_10_07_katz_ccasc_0730", procedureLabel: "Endoscopy interval", durationMinutes: 120, startTimeOverride: "07:30", priority: 2, tags: ["endoscopy"], notes: "Source interval 07:30–09:30", order: 0 },
    mutationResponseExcerpt: { version: 43, updatedAt: "2026-10-04T15:00:00.000Z", settings: { turnoverMinutes: 30 }, weeks: ["..."], attendingBlocks: ["..."], cases: ["..."], clinicSessions: ["..."] }
  }
} as const;
