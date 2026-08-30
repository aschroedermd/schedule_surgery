import { addDays, formatDate, getMondayForDate } from "../shared/date";
import { CoverageEntry, DirectoryContact, PlannerState } from "../shared/types";
import { createRotationResidents } from "./residentRotationSeed";
import { createSeedWikiArticles } from "./wiki";

const seedCreatedAt = "2026-06-27T14:36:21.000Z";

export function createInitialState(today = new Date()): PlannerState {
  const monday = getMondayForDate(formatDate(today));

  return {
    version: 1,
    updatedAt: seedCreatedAt,
    settings: {
      splitBufferMinutes: 90,
      turnoverMinutes: 30,
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
    residents: createRotationResidents().map((resident) =>
      resident.id === "res_offservice"
        ? {
            ...resident,
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
        : resident
    ),
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
    attendingCoverageAssignments: [],
    qgendaSync: { enabled: false },
    coverageEntries: createSeedCoverageEntries(),
    callOffRequests: [],
    callScheduleDrafts: [],
    coverageRequests: [],
    contacts: createSeedContacts(),
    contactRequests: [],
    wikiArticles: createSeedWikiArticles(),
    wikiSources: [],
    wikiRevision: 1,
    wikiChanges: [],
    goldStarAwards: [],
    activityEvents: [
      {
        id: "evt_seed",
        createdAt: new Date().toISOString(),
        actorRole: "admin",
        actorUsername: "admin",
        actorName: "admin",
        activityType: "assignment",
        action: "created planner",
        details: "Started with no-PHI sample schedule data",
        entityType: "week",
        entityId: "week_current"
      }
    ]
  };
}

export function createSeedContacts(): DirectoryContact[] {
  const hospitalEntries: Array<[string, string, string]> = [
    ["Perioperative", "Pre-op", "(540) 981-8236"],
    ["Perioperative", "PACU", "(540) 981-7173"],
    ["ICU", "6 Mountain ICU", "(540) 981-2946"],
    ["ICU", "9 Mountain ICU", "(540) 981-2949"],
    ["ICU", "10 Mountain ICU", "(540) 981-2950"],
    ["Progressive Care Units (PCU)", "7 South PCU", "(540) 981-7286"],
    ["Progressive Care Units (PCU)", "9 Mountain PCU", "(540) 981-2939"],
    ["Progressive Care Units (PCU)", "10 Mountain PCU", "(540) 981-2940"],
    ["Inpatient Units", "4 West", "(540) 981-7203"],
    ["Inpatient Units", "9 West", "(540) 981-7394"],
    ["Inpatient Units", "10 West", "(540) 981-7240"],
    ["Inpatient Units", "11 West", "(540) 981-7166"],
    ["Inpatient Units", "12 West", "(540) 981-7386"],
    ["Inpatient Units", "Pediatrics – 11 South", "(540) 981-7989"],
    ["Ancillary Services", "Blood Bank", "(540) 981-7877"],
    ["Ancillary Services", "Lab – Microbiology", "(540) 981-8823"],
    ["Ancillary Services", "Lab – Hematology", "(540) 853-0617"],
    ["Ancillary Services", "Lab – General", "(800) 653-2205"],
    ["Ancillary Services", "Pharmacy", "(540) 981-7275"],
    ["Ancillary Services", "Radiology Front Desk", "(540) 981-7122"],
    ["Supply & Distribution", "Mini-Distribution", "(540) 981-7742"],
    ["Supply & Distribution", "RMH Warehouse", "(540) 224-3070"]
  ];
  const hospitalContacts = hospitalEntries.map(([category, name, phoneNumber], index): DirectoryContact => ({
    id: `contact_seed_${index + 1}`,
    name,
    phoneNumber,
    category,
    directoryType: "Hospital",
    organization: "Hospital Directory",
    createdAt: seedCreatedAt,
    updatedAt: seedCreatedAt,
    createdBy: "system"
  }));
  const residentEntries: Array<[string, string, string]> = [
    ["PGY-1", "Adedayo Adeleke", "5407599761"],
    ["PGY-1", "Megan Daniels", "8262535272"],
    ["PGY-1", "Sally Greenberg", "5406329980"],
    ["PGY-1", "Taylor Keys", "5407978216"],
    ["PGY-1", "Yao Mawussi", "5406829048"],
    ["PGY-1", "Jayden Moore", "5406762190"],
    ["PGY-1", "Christina Necessary", "5406767306"],
    ["PGY-1", "Nina Shank", "5407959593"],
    ["PGY-1", "Nathan Shigley", "8262533068"],
    ["PGY-2", "Christian Blue", "5405884355"],
    ["PGY-2", "Thien Cao", "5405819331"],
    ["PGY-2", "Jeffrey Rodgers", "5405898976"],
    ["PGY-2", "Prarthana Somaiah", "8262535382"],
    ["PGY-2", "Courtney Thorpe", "8262535380"],
    ["PGY-3", "Jessica Bradley", "5407699452"],
    ["PGY-3", "Kristian Calderon Garcia", "5406550876"],
    ["PGY-3", "Aleem Mohamed", "5405981188"],
    ["PGY-3", "Amanda Swaak", "5408558620"],
    ["PGY-3", "Allison Zheng", "5405899957"],
    ["PGY-4", "Carter Colwell", "5405974808"],
    ["PGY-4", "Alyssa DeWyer", "5405975410"],
    ["PGY-4", "Hannah Roberson", "5405975013"],
    ["PGY-4", "Molly Scarbro", "5405975270"],
    ["PGY-4", "Maria Williams", "5407699150"],
    ["PGY-5", "Zachary den Besten", "5407505730"],
    ["PGY-5", "Marisa Doran", "5405294551"],
    ["PGY-5", "Paul Klosinski", "5405295430"],
    ["PGY-5", "Taneen Maghsoudi", "5407509163"],
    ["PGY-5", "Martin Nde", "5405299745"],
    ["PGY-5", "Andrew Schroeder", "5402045505"]
  ];
  const residentContacts = residentEntries.map(([category, name, phoneNumber], index): DirectoryContact => ({
    id: `contact_resident_${index + 1}`,
    name,
    phoneNumber: formatSeedPhoneNumber(phoneNumber),
    category,
    directoryType: "Residents",
    organization: "Carilion Clinic General Surgery Residency",
    createdAt: seedCreatedAt,
    updatedAt: seedCreatedAt,
    createdBy: "system"
  }));
  const plasticSurgeryResidentEntries: Array<[string, string, string]> = [
    ["Plastic Surgery Residents", "Matthew Anderson", "566.8297"],
    ["Plastic Surgery Residents", "Will Travis", "566.8298"],
    ["Plastic Surgery Residents", "Kelsey Gray", "750.3642"],
    ["Plastic Surgery Residents", "Jennifer Hall", "750.3644"],
    ["Plastic Surgery Residents", "Joowon Choi", "682.6695"],
    ["Plastic Surgery Residents", "Patrick Dugom", "655.8133"],
    ["Plastic Surgery Residents", "Allyson Huttinger", "597.3627"],
    ["Plastic Surgery Residents", "Rachel Schwartz", "597.5804"],
    ["Plastic Surgery Residents", "Sahith Mandala", "597.4233"],
    ["Plastic Surgery Residents", "Robert Clark", "520.5041"],
    ["Plastic Surgery Residents", "Tareck Haykal", "826.253.4695"],
    ["Plastic Surgery Residents", "Brendan Podszus", "826.229.3146"]
  ];
  const plasticSurgeryResidentContacts = plasticSurgeryResidentEntries.map(
    ([category, name, phoneNumber], index): DirectoryContact => ({
      id: `contact_plastics_resident_${index + 1}`,
      name,
      phoneNumber: formatSeedPhoneNumber(phoneNumber),
      category,
      directoryType: "Residents",
      organization: "Carilion Clinic Plastic Surgery Residency",
      createdAt: seedCreatedAt,
      updatedAt: seedCreatedAt,
      createdBy: "system"
    })
  );
  const facultyAndStaffEntries: Array<[string, string, string, string[]?]> = [
    ["Faculty", "Farrell Adkins", "525.6963"],
    ["Faculty", "Stacie Adkins", "588.0429"],
    ["Faculty", "Eric Ambroz", "855.4714"],
    ["Faculty", "Kathryn Bass", "521.7146"],
    ["Faculty", "Curtis Bower", "520.5484"],
    ["Faculty", "Katie Love Bower", "759.1369"],
    ["Faculty", "Cody Bushman", "581.2841"],
    ["Faculty", "Bryan Collier", "597.0059"],
    ["Faculty", "Mike Collins", "240.3683"],
    ["Faculty", "Ben Cragun", "240.3585"],
    ["Faculty", "Caleb Cutherell", "397.5289"],
    ["Faculty", "Roxanne Davenport", "529.2104"],
    ["Faculty", "James Drougas", "580.1884"],
    ["Faculty", "Emily Faulks", "204.5844"],
    ["Faculty", "Ashley Gerrish", "613.0114"],
    ["Faculty", "Jake Gillen", "589.4208"],
    ["Faculty", "Elaina Graham", "613.7725"],
    ["Faculty", "Al Hagy", "520.7645"],
    ["Faculty", "Guy Katz", "682.6366"],
    ["Faculty", "Daniel Lollar", "521.0719"],
    ["Faculty", "T A Lucktong", "521.4982"],
    ["Faculty", "Kristin McCoy", "339.2485"],
    ["Faculty", "Kurtis Moyer", "676.7394"],
    ["Faculty", "Paul Nickerson", "988.2816"],
    ["Faculty", "Michael Nussbaum", "904.206.2414"],
    ["Faculty", "Charles Paget", "798.3569"],
    ["Faculty", "John Rudderow", "293.7321"],
    ["Faculty", "Sanjoy Saha", "674.2691"],
    ["Faculty", "David Salzberg", "855.0810"],
    ["Faculty", "Keith Stephenson", "230.1093"],
    ["Faculty", "Josh Stodghill", "566.8112"],
    ["Faculty", "Daniel Tershak", "354.2961"],
    ["Faculty", "James Thompson", "588.2377"],
    ["Faculty", "Terri-Ann Wattsman", "915.1557"],
    ["Faculty", "Sharon Williams", "266.2618"],
    ["ACS ACPs", "Sarah C. Mullins, NP - Surgical Critical Care", "759.2811"],
    ["ACS ACPs", "Sara Nicely, PA - Surgical Critical Care", "691.5933"],
    ["ACS ACPs", "Sherry Boone, NP - Surgical Critical Care", "312.3981"],
    ["ACS ACPs", "Marie Creech, PA", "521.4112"],
    ["ACS ACPs", "Samantha Hall, NP - Surgical Critical Care", "494.4940"],
    ["ACS ACPs", "Stephanie Wright, NP - Surgical Critical Care", "598.1331"],
    ["ACS ACPs", "Kathy Gill, NP - Surgical Critical Care", "541.9938"],
    ["ACS ACPs", "Lorrie Saville, NP - Trauma", "589-9236"],
    ["ACS ACPs", "Carly Moock, PA - Trauma", "525.9977"],
    ["ACS ACPs", "Mia Anglin, PA - EGS", "797.3690"],
    ["ACS ACPs", "Bethany Nichols, NP - EGS", "492.0649"],
    ["ACS ACPs", "Emma Perdue, PA - Trauma", "613.4358"],
    ["ACS ACPs", "Chelsea Frame Patterson, PA - Trauma", "494.7174"],
    ["ACS ACPs", "Kristina Dobson, PA - Trauma", "655.3806"],
    ["General Surgery ACPs", "Rachel Rich, PA - General Surgery CCR 3", "597.9739"],
    ["General Surgery ACPs", "Gail Arrington, NP - General Surgery CCR 3", "484.3394"],
    ["General Surgery ACPs", "Seyi White, NP - Breast", "728.0346"],
    ["General Surgery ACPs", "Amanda White, NP - Breast", "589.7519"],
    ["General Surgery ACPs", "Lesley Quesenberry, PA - Colorectal", "529.8251"],
    ["General Surgery ACPs", "Lauren Baker, NP - Bariatric", "526.1625"],
    ["General Surgery ACPs", "Samantha Wilkinson, NP - Bariatric", "761.8374"],
    ["Administrative Staff", "Caroline Benne - Program Manager, General Surgery Residency", "540.981.7441"],
    ["Administrative Staff", "Erica Minnix - Plastics Program Manager / MIS Fellowship", "981.7436", ["581.4627"]],
    ["Administrative Staff", "Meghan Brogan - Fellowship and Residency Program Supervisor", "853.0460", ["588.6273"]],
    ["Administrative Staff", "Laura Grace Kaufman - Administrative Coordinator, Trauma/Critical Care", "981.7434"],
    ["Administrative Staff", "Kathy Catron - Administrative Coordinator, Trauma/Critical Care", "988.6244"],
    ["Administrative Staff", "Elizabeth Ayers - Clinic Practice Director, General Surgery", "526.1241", ["632.9593"]],
    ["Administrative Staff", "Clinic Practice Manager, General Surgery", "526.1242", ["597.4174"]],
    ["Administrative Staff", "Healthcare Administrative Lead - General Surgery (CCR 3)", "526.1251"],
    ["Administrative Staff", "Anita Lewis - Department Secretary, General Surgery (CCR 3)", "526.1547"]
  ];
  const facultyAndStaffContacts = facultyAndStaffEntries.map(
    ([category, name, phoneNumber, alternatePhoneNumbers], index): DirectoryContact => ({
      id: `contact_faculty_staff_${index + 1}`,
      name,
      phoneNumber: formatSeedPhoneNumber(phoneNumber),
      alternatePhoneNumbers: alternatePhoneNumbers?.map(formatSeedPhoneNumber),
      category,
      directoryType: "Faculty & Staff",
      organization: "Carilion Clinic Department of Surgery",
      createdAt: seedCreatedAt,
      updatedAt: seedCreatedAt,
      createdBy: "system"
    })
  );
  return [
    ...hospitalContacts,
    ...residentContacts,
    ...plasticSurgeryResidentContacts,
    ...facultyAndStaffContacts
  ];
}

function formatSeedPhoneNumber(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length === 7) return `(540) ${digits.slice(0, 3)}-${digits.slice(3)}`;
  return digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
    : phoneNumber;
}

export function createSeedCoverageEntries(): CoverageEntry[] {
  return [
    seedCoverageEntry("cover_2026_07_01_adeleke_step3", "2026-07-01", "note", "res_fellow", "STEP 3"),
    seedCoverageEntry("cover_2026_07_02_adeleke_step3", "2026-07-02", "note", "res_fellow", "STEP 3"),
    seedCoverageEntry("cover_2026_07_04_schroeder_round", "2026-07-04", "rounding", "res_chief"),
    seedCoverageEntry("cover_2026_07_05_schroeder_call", "2026-07-05", "call", "res_chief", "", "senior"),
    seedCoverageEntry("cover_2026_07_09_cao_paternity", "2026-07-09", "off", "res_offservice", "paternity"),
    seedCoverageEntry("cover_2026_07_10_swaak_call", "2026-07-10", "call", "res_swaak", "", "mid-level"),
    seedCoverageEntry("cover_2026_07_11_adeleke_call", "2026-07-11", "call", "res_fellow", "", "senior"),
    seedCoverageEntry("cover_2026_07_12_adeleke_round", "2026-07-12", "rounding", "res_fellow"),
    seedCoverageEntry("cover_2026_07_17_schroeder_call", "2026-07-17", "call", "res_chief", "", "senior"),
    seedCoverageEntry("cover_2026_07_18_schroeder_round", "2026-07-18", "rounding", "res_chief"),
    seedCoverageEntry("cover_2026_07_19_schroeder_round", "2026-07-19", "rounding", "res_chief"),
    seedCoverageEntry("cover_2026_07_24_swaak_call", "2026-07-24", "call", "res_swaak", "", "mid-level"),
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
  note = "",
  callPosition?: CoverageEntry["callPosition"]
): CoverageEntry {
  return {
    id,
    date,
    kind,
    residentId,
    callPosition,
    note,
    createdAt: seedCreatedAt,
    updatedAt: seedCreatedAt
  };
}
