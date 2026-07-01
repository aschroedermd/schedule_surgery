import { addDays, getCurrentMonday } from "../shared/date";
import { CoverageEntry, PlannerState } from "../shared/types";

const seedCreatedAt = "2026-06-27T14:36:21.000Z";

export function createInitialState(): PlannerState {
  const monday = getCurrentMonday();

  return {
    settings: {
      splitBufferMinutes: 90,
      weekdayOnly: true
    },
    hospitals: [
      { id: "hosp_main", name: "University Hospital", shortName: "UH", color: "#2454a6" },
      { id: "hosp_west", name: "West Campus Hospital", shortName: "WCH", color: "#16856d" }
    ],
    attendings: [
      { id: "att_chen", name: "Dr. Chen", service: "Davies", priority: 5, defaultHospitalId: "hosp_main" },
      { id: "att_patel", name: "Dr. Patel", service: "Davies", priority: 4, defaultHospitalId: "hosp_west" },
      { id: "att_morris", name: "Dr. Morris", service: "Davies", priority: 3, defaultHospitalId: "hosp_main" },
      { id: "att_nussbaum", name: "Dr. Nussbaum", service: "Berry", priority: 3, defaultHospitalId: "hosp_main" }
    ],
    residents: [
      {
        id: "res_chief",
        name: "Andrew Schroeder",
        trainingLevel: "PGY5",
        serviceTags: ["Davies"],
        color: "#f4cf55",
        tags: ["home"],
        trainingInterests: ["HPB", "chief-level", "complex open"],
        unavailable: []
      },
      {
        id: "res_fellow",
        name: "Adedayo Adeleke",
        trainingLevel: "Fellow",
        serviceTags: ["Davies"],
        color: "#c89af7",
        tags: ["fellow"],
        trainingInterests: ["bariatrics", "fellow-priority", "foregut"],
        unavailable: []
      },
      {
        id: "res_offservice",
        name: "T-Cao",
        trainingLevel: "PGY3",
        serviceTags: ["Davies"],
        color: "#f37d6e",
        tags: ["available-for-requests"],
        trainingInterests: ["general surgery", "clinic"],
        unavailable: [
          {
            id: "off_conf",
            date: addDays(monday, 2),
            startTime: "12:00",
            endTime: "17:00",
            label: "conference"
          }
        ]
      },
      {
        id: "res_swaak",
        name: "Amanda Swaak",
        trainingLevel: "PGY4",
        serviceTags: ["Davies"],
        color: "#e65245",
        tags: ["home"],
        trainingInterests: ["general surgery", "abdominal wall", "clinic"],
        unavailable: []
      },
      {
        id: "res_broden",
        name: "Nicole Broden",
        trainingLevel: "PGY2",
        serviceTags: ["Davies"],
        color: "#55a6d9",
        tags: ["home"],
        trainingInterests: ["general surgery", "endoscopy", "clinic"],
        unavailable: []
      }
    ],
    procedureDefaults: [
      { id: "proc_whipple", label: "Whipple", durationMinutes: 360, priority: 5, tags: ["HPB", "chief-level", "complex open"] },
      { id: "proc_bypass", label: "Gastric bypass", durationMinutes: 180, priority: 4, tags: ["bariatrics", "fellow-priority"] },
      { id: "proc_chole", label: "Laparoscopic cholecystectomy", durationMinutes: 90, priority: 2, tags: ["general surgery"] },
      { id: "proc_hernia", label: "Ventral hernia repair", durationMinutes: 150, priority: 3, tags: ["general surgery", "abdominal wall"] }
    ],
    weeks: [
      {
        id: "week_current",
        startDate: monday,
        label: "Current Week"
      }
    ],
    attendingBlocks: [
      {
        id: "block_chen_mon",
        weekId: "week_current",
        date: monday,
        attendingId: "att_chen",
        hospitalId: "hosp_main",
        firstCaseStartTime: "07:30",
        notes: ""
      },
      {
        id: "block_patel_mon",
        weekId: "week_current",
        date: monday,
        attendingId: "att_patel",
        hospitalId: "hosp_west",
        firstCaseStartTime: "09:00",
        notes: ""
      },
      {
        id: "block_morris_tue",
        weekId: "week_current",
        date: addDays(monday, 1),
        attendingId: "att_morris",
        hospitalId: "hosp_main",
        firstCaseStartTime: "07:45",
        notes: ""
      }
    ],
    cases: [
      {
        id: "case_chen_whipple",
        blockId: "block_chen_mon",
        procedureLabel: "Whipple",
        durationMinutes: 360,
        priority: 5,
        tags: ["HPB", "chief-level", "complex open"],
        notes: "",
        order: 0
      },
      {
        id: "case_chen_chole",
        blockId: "block_chen_mon",
        procedureLabel: "Laparoscopic cholecystectomy",
        durationMinutes: 90,
        priority: 2,
        tags: ["general surgery"],
        notes: "",
        order: 1
      },
      {
        id: "case_patel_bypass",
        blockId: "block_patel_mon",
        procedureLabel: "Gastric bypass",
        durationMinutes: 180,
        priority: 4,
        tags: ["bariatrics", "fellow-priority"],
        notes: "",
        order: 0
      },
      {
        id: "case_morris_hernia",
        blockId: "block_morris_tue",
        procedureLabel: "Ventral hernia repair",
        durationMinutes: 150,
        priority: 3,
        tags: ["general surgery", "abdominal wall"],
        notes: "",
        order: 0
      }
    ],
    clinicSessions: [
      {
        id: "clinic_hpb_tue",
        weekId: "week_current",
        date: addDays(monday, 1),
        startTime: "13:00",
        endTime: "17:00",
        attendingId: "att_chen",
        service: "Davies",
        location: "University Hospital Clinic",
        hospitalId: "hosp_main",
        capacity: 1,
        isProcedure: false
      },
      {
        id: "clinic_bari_wed",
        weekId: "week_current",
        date: addDays(monday, 2),
        startTime: "08:00",
        endTime: "12:00",
        attendingId: "att_patel",
        service: "Davies",
        location: "West Campus Clinic",
        hospitalId: "hosp_west",
        capacity: 1,
        isProcedure: false
      }
    ],
    assignments: [],
    coverageEntries: createSeedCoverageEntries(),
    coverageRequests: [],
    activityEvents: [
      {
        id: "evt_seed",
        createdAt: new Date().toISOString(),
        actorRole: "admin",
        action: "created planner",
        details: "Started with no-PHI sample schedule data",
        entityType: "week",
        entityId: "week_current"
      }
    ]
  };
}

export function createSeedCoverageEntries(): CoverageEntry[] {
  return [
    seedCoverageEntry("cover_2026_07_01_adeleke_step3", "2026-07-01", "note", "res_fellow", "STEP 3"),
    seedCoverageEntry("cover_2026_07_02_adeleke_step3", "2026-07-02", "note", "res_fellow", "STEP 3"),
    seedCoverageEntry("cover_2026_07_04_schroeder_round", "2026-07-04", "rounding", "res_chief"),
    seedCoverageEntry("cover_2026_07_05_schroeder_call", "2026-07-05", "call", "res_chief"),
    seedCoverageEntry("cover_2026_07_09_cao_paternity", "2026-07-09", "off", "res_offservice", "paternity"),
    seedCoverageEntry("cover_2026_07_10_swaak_call", "2026-07-10", "call", "res_swaak"),
    seedCoverageEntry("cover_2026_07_11_adeleke_call", "2026-07-11", "call", "res_fellow"),
    seedCoverageEntry("cover_2026_07_12_adeleke_round", "2026-07-12", "rounding", "res_fellow"),
    seedCoverageEntry("cover_2026_07_17_schroeder_call", "2026-07-17", "call", "res_chief"),
    seedCoverageEntry("cover_2026_07_18_schroeder_round", "2026-07-18", "rounding", "res_chief"),
    seedCoverageEntry("cover_2026_07_19_schroeder_round", "2026-07-19", "rounding", "res_chief"),
    seedCoverageEntry("cover_2026_07_24_swaak_call", "2026-07-24", "call", "res_swaak"),
    seedCoverageEntry("cover_2026_07_25_swaak_round", "2026-07-25", "rounding", "res_swaak"),
    seedCoverageEntry("cover_2026_07_26_swaak_round", "2026-07-26", "rounding", "res_swaak"),
    seedCoverageEntry("cover_2026_07_31_swaak_conference", "2026-07-31", "off", "res_swaak", "conference"),
    seedCoverageEntry("cover_2026_08_01_swaak_conference", "2026-08-01", "off", "res_swaak", "conference"),
    seedCoverageEntry("cover_2026_08_01_schroeder_round", "2026-08-01", "rounding", "res_chief")
  ];
}

function seedCoverageEntry(
  id: string,
  date: string,
  kind: CoverageEntry["kind"],
  residentId: string,
  note = ""
): CoverageEntry {
  return {
    id,
    date,
    kind,
    residentId,
    note,
    createdAt: seedCreatedAt,
    updatedAt: seedCreatedAt
  };
}
