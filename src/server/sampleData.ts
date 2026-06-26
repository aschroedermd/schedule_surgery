import { addDays, getCurrentMonday } from "../shared/date";
import { PlannerState } from "../shared/types";

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
      { id: "att_chen", name: "Dr. Chen", service: "HPB", priority: 5, defaultHospitalId: "hosp_main" },
      { id: "att_patel", name: "Dr. Patel", service: "Bariatrics", priority: 4, defaultHospitalId: "hosp_west" },
      { id: "att_morris", name: "Dr. Morris", service: "General Surgery", priority: 3, defaultHospitalId: "hosp_main" }
    ],
    residents: [
      {
        id: "res_chief",
        name: "Chief Resident",
        trainingLevel: "PGY5",
        serviceStatus: "on-service",
        tags: ["home"],
        trainingInterests: ["HPB", "chief-level", "complex open"],
        unavailable: []
      },
      {
        id: "res_fellow",
        name: "MIS Fellow",
        trainingLevel: "Fellow",
        serviceStatus: "on-service",
        tags: ["fellow"],
        trainingInterests: ["bariatrics", "fellow-priority", "foregut"],
        unavailable: []
      },
      {
        id: "res_offservice",
        name: "Off-Service Resident",
        trainingLevel: "PGY3",
        serviceStatus: "off-service",
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
        service: "HPB",
        location: "University Hospital Clinic",
        hospitalId: "hosp_main",
        capacity: 1
      },
      {
        id: "clinic_bari_wed",
        weekId: "week_current",
        date: addDays(monday, 2),
        startTime: "08:00",
        endTime: "12:00",
        attendingId: "att_patel",
        service: "Bariatrics",
        location: "West Campus Clinic",
        hospitalId: "hosp_west",
        capacity: 1
      }
    ],
    assignments: [],
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
