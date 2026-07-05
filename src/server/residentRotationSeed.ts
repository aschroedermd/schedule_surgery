import { buildResidentUsername } from "../shared/id";
import { ROTATION_BLOCK_DATES } from "../shared/rotations";
import { Resident, ResidentRosterKind, TrainingLevel } from "../shared/types";

interface RotationRowSeed {
  startBlock: number;
  endBlock: number;
  service: string;
  startDate?: string;
  endDate?: string;
}

interface ResidentRotationSeed {
  id: string;
  name?: string;
  aliases?: string[];
  trainingLevel: TrainingLevel;
  color: string;
  rosterKind?: ResidentRosterKind;
  sourceProgram?: string;
  sourceProgramAbbreviation?: string;
  accountEligible?: boolean;
  tags?: string[];
  trainingInterests: string[];
  rows: RotationRowSeed[];
  seedMigrationBlockNumbers?: number[];
}

export const RESIDENT_ROTATION_SEED: ResidentRotationSeed[] = [
  {
    id: "res_fellow",
    name: "Adedayo Adeleke",
    trainingLevel: "PGY1",
    color: "#2f78c4",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Davies" },
      { startBlock: 2, endBlock: 2, service: "Ferrara" },
      { startBlock: 3, endBlock: 3, service: "Anesthesia" },
      { startBlock: 4, endBlock: 4, service: "Ped Surg" },
      { startBlock: 5, endBlock: 5, service: "Berry" },
      { startBlock: 6, endBlock: 6, service: "Fogel" },
      { startBlock: 7, endBlock: 7, service: "Gilbert" },
      { startBlock: 8, endBlock: 8, service: "NFloat" },
      { startBlock: 9, endBlock: 9, service: "Ped Surg" },
      { startBlock: 10, endBlock: 10, service: "SCC-days" },
      { startBlock: 11, endBlock: 11, service: "Ferrara" },
      { startBlock: 12, endBlock: 12, service: "NFloat" },
      { startBlock: 13, endBlock: 13, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_blue",
    name: "Christian Blue",
    trainingLevel: "PGY2",
    color: "#d5ad37",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "SCC Night" },
      { startBlock: 2, endBlock: 2, service: "Endoscopy" },
      { startBlock: 3, endBlock: 3, service: "NFloat" },
      { startBlock: 4, endBlock: 4, service: "NFloat" },
      { startBlock: 5, endBlock: 5, service: "NRV" },
      { startBlock: 6, endBlock: 6, service: "Breast" },
      { startBlock: 7, endBlock: 7, service: "Fogel" },
      { startBlock: 8, endBlock: 8, service: "SCC Night" },
      { startBlock: 9, endBlock: 9, service: "Ferrara" },
      { startBlock: 10, endBlock: 10, service: "Breast" },
      { startBlock: 11, endBlock: 11, service: "NRV" },
      { startBlock: 12, endBlock: 12, service: "NRV" },
      { startBlock: 13, endBlock: 13, service: "Davies" }
    ]
  },
  {
    id: "res_bradley",
    name: "Jessica Bradley",
    trainingLevel: "PGY3",
    color: "#7e63c9",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Ferrara" },
      { startBlock: 2, endBlock: 2, service: "NRV" },
      { startBlock: 3, endBlock: 3, service: "SCC-days" },
      { startBlock: 4, endBlock: 4, service: "Davies" },
      { startBlock: 5, endBlock: 5, service: "Ped Surg" },
      { startBlock: 6, endBlock: 6, service: "Keeley Vasc" },
      { startBlock: 7, endBlock: 7, service: "NRV" },
      { startBlock: 8, endBlock: 8, service: "SCC-days" },
      { startBlock: 9, endBlock: 9, service: "Davies" },
      { startBlock: 10, endBlock: 10, service: "Ped Surg" },
      { startBlock: 11, endBlock: 11, service: "Berry" },
      { startBlock: 12, endBlock: 12, service: "NRV" },
      { startBlock: 13, endBlock: 13, service: "SCC-days" }
    ]
  },
  {
    id: "res_calderon_garcia",
    name: "Kristian Calderon Garcia",
    trainingLevel: "PGY3",
    color: "#2f8c89",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NRV" },
      { startBlock: 2, endBlock: 2, service: "SCC-days" },
      { startBlock: 3, endBlock: 3, service: "Transplant" },
      { startBlock: 4, endBlock: 4, service: "Ped Surg" },
      { startBlock: 5, endBlock: 5, service: "Ferrara" },
      { startBlock: 6, endBlock: 6, service: "NRV" },
      { startBlock: 7, endBlock: 7, service: "SCC-days" },
      { startBlock: 8, endBlock: 8, service: "Davies" },
      { startBlock: 9, endBlock: 9, service: "Ped Surg" },
      { startBlock: 10, endBlock: 10, service: "Keeley Vasc" },
      { startBlock: 11, endBlock: 11, service: "NRV" },
      { startBlock: 12, endBlock: 12, service: "SCC-days" },
      { startBlock: 13, endBlock: 13, service: "Berry" }
    ]
  },
  {
    id: "res_offservice",
    name: "Thien Cao",
    aliases: ["T-Cao", "T Cao", "Thein Cao"],
    trainingLevel: "PGY2",
    color: "#f37d6e",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Davies" },
      { startBlock: 2, endBlock: 2, service: "Berry" },
      { startBlock: 3, endBlock: 3, service: "Endoscopy" },
      { startBlock: 4, endBlock: 4, service: "NRV" },
      { startBlock: 5, endBlock: 5, service: "NFloat" },
      { startBlock: 6, endBlock: 6, service: "NFloat" },
      { startBlock: 7, endBlock: 7, service: "Breast" },
      { startBlock: 8, endBlock: 8, service: "Ferrara" },
      { startBlock: 9, endBlock: 9, service: "NRV" },
      { startBlock: 10, endBlock: 10, service: "NRV" },
      { startBlock: 11, endBlock: 11, service: "SCC Night" },
      { startBlock: 12, endBlock: 12, service: "SCC Night" },
      { startBlock: 13, endBlock: 13, service: "Ferrara" }
    ]
  },
  {
    id: "res_colwell",
    name: "Carter Colwell",
    trainingLevel: "PGY4",
    color: "#4f7d46",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Keeley Vasc" },
      { startBlock: 2, endBlock: 2, service: "Keeley Vasc" },
      { startBlock: 3, endBlock: 3, service: "NFloat" },
      { startBlock: 4, endBlock: 4, service: "NFloat" },
      { startBlock: 5, endBlock: 5, service: "Gilbert" },
      { startBlock: 6, endBlock: 6, service: "Gilbert" },
      { startBlock: 7, endBlock: 7, service: "Davies" },
      { startBlock: 8, endBlock: 8, service: "Breast" },
      { startBlock: 9, endBlock: 9, service: "Head & Neck" },
      { startBlock: 10, endBlock: 10, service: "Thoracic" },
      { startBlock: 11, endBlock: 11, service: "Keeley Vasc" },
      { startBlock: 12, endBlock: 12, service: "NRV" },
      { startBlock: 13, endBlock: 13, service: "NFloat" }
    ]
  },
  {
    id: "res_daniels",
    name: "Megan Daniels",
    trainingLevel: "PGY1",
    color: "#b84a62",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Ferrara" },
      { startBlock: 2, endBlock: 2, service: "Plastic Surgery" },
      { startBlock: 3, endBlock: 3, service: "Ped Surg" },
      { startBlock: 4, endBlock: 4, service: "Davies" },
      { startBlock: 5, endBlock: 5, service: "Ferrara" },
      { startBlock: 6, endBlock: 6, service: "Berry" },
      { startBlock: 7, endBlock: 7, service: "NFloat" },
      { startBlock: 8, endBlock: 8, service: "Ferrara" },
      { startBlock: 9, endBlock: 9, service: "SCC-days" },
      { startBlock: 10, endBlock: 10, service: "Ferrara" },
      { startBlock: 11, endBlock: 11, service: "NFloat" },
      { startBlock: 12, endBlock: 12, service: "Davies" },
      { startBlock: 13, endBlock: 13, service: "Gilbert" }
    ]
  },
  {
    id: "res_den_besten",
    name: "Zachary den Besten",
    trainingLevel: "PGY5",
    color: "#8b5a3c",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Berry" },
      { startBlock: 2, endBlock: 2, service: "Berry" },
      { startBlock: 3, endBlock: 3, service: "Fogel" },
      { startBlock: 4, endBlock: 4, service: "Fogel" },
      { startBlock: 5, endBlock: 5, service: "Keeley Vasc" },
      { startBlock: 6, endBlock: 6, service: "Keeley Vasc" },
      { startBlock: 7, endBlock: 7, service: "Ferrara" },
      { startBlock: 8, endBlock: 8, service: "Ferrara" },
      { startBlock: 9, endBlock: 9, service: "NRV" },
      { startBlock: 10, endBlock: 10, service: "NRV" },
      { startBlock: 11, endBlock: 11, service: "Davies" },
      { startBlock: 12, endBlock: 12, service: "Davies" },
      { startBlock: 13, endBlock: 13, service: "Berry" }
    ]
  },
  {
    id: "res_dewyer",
    name: "Alyssa DeWyer",
    trainingLevel: "PGY4",
    color: "#5f7fb8",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NFloat" },
      { startBlock: 2, endBlock: 2, service: "NFloat" },
      { startBlock: 3, endBlock: 3, service: "Keeley Vasc" },
      { startBlock: 4, endBlock: 4, service: "Keeley Vasc" },
      { startBlock: 5, endBlock: 5, service: "Breast" },
      { startBlock: 6, endBlock: 6, service: "Head & Neck" },
      { startBlock: 7, endBlock: 7, service: "Thoracic" },
      { startBlock: 8, endBlock: 8, service: "Fogel" },
      { startBlock: 9, endBlock: 9, service: "Gilbert" },
      { startBlock: 10, endBlock: 10, service: "Gilbert" },
      { startBlock: 11, endBlock: 11, service: "NFloat" },
      { startBlock: 12, endBlock: 12, service: "Keeley Vasc" },
      { startBlock: 13, endBlock: 13, service: "NRV" }
    ]
  },
  {
    id: "res_doran",
    name: "Marisa Doran",
    trainingLevel: "PGY5",
    color: "#bf6d9e",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Ferrara" },
      { startBlock: 2, endBlock: 2, service: "Ferrara" },
      { startBlock: 3, endBlock: 3, service: "NRV" },
      { startBlock: 4, endBlock: 4, service: "NRV" },
      { startBlock: 5, endBlock: 5, service: "Davies" },
      { startBlock: 6, endBlock: 6, service: "Davies" },
      { startBlock: 7, endBlock: 7, service: "Berry" },
      { startBlock: 8, endBlock: 8, service: "Berry" },
      { startBlock: 9, endBlock: 9, service: "Fogel" },
      { startBlock: 10, endBlock: 10, service: "Fogel" },
      { startBlock: 11, endBlock: 11, service: "Keeley Vasc" },
      { startBlock: 12, endBlock: 12, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_greenberg",
    name: "Sally Greenberg",
    trainingLevel: "PGY1",
    color: "#3f8f62",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Gilbert" },
      { startBlock: 2, endBlock: 2, service: "NFloat" },
      { startBlock: 3, endBlock: 3, service: "Davies" },
      { startBlock: 4, endBlock: 4, service: "Ferrara" },
      { startBlock: 5, endBlock: 5, service: "Keeley Vasc" },
      { startBlock: 6, endBlock: 6, service: "SCC-days" },
      { startBlock: 7, endBlock: 7, service: "Fogel" },
      { startBlock: 8, endBlock: 8, service: "Ferrara" },
      { startBlock: 9, endBlock: 9, service: "Endoscopy" },
      { startBlock: 10, endBlock: 10, service: "Berry" },
      { startBlock: 11, endBlock: 11, service: "Research" },
      { startBlock: 12, endBlock: 12, service: "NFloat" },
      { startBlock: 13, endBlock: 13, service: "Ped Surg" }
    ]
  },
  {
    id: "res_keys",
    name: "Taylor Keys",
    trainingLevel: "PGY1",
    color: "#9b6a44",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Keeley Vasc", startDate: "2026-07-01", endDate: "2026-07-18" },
      { startBlock: 2, endBlock: 2, service: "Fogel" },
      { startBlock: 3, endBlock: 3, service: "Ferrara" },
      { startBlock: 4, endBlock: 4, service: "Fogel" },
      { startBlock: 5, endBlock: 5, service: "Davies" },
      { startBlock: 6, endBlock: 6, service: "Ped Surg" },
      { startBlock: 7, endBlock: 7, service: "Ferrara" },
      { startBlock: 8, endBlock: 8, service: "Gilbert" },
      { startBlock: 9, endBlock: 9, service: "NFloat" },
      { startBlock: 10, endBlock: 10, service: "Keeley Vasc" },
      { startBlock: 11, endBlock: 11, service: "SCC-days" },
      { startBlock: 12, endBlock: 12, service: "Ferrara" },
      { startBlock: 13, endBlock: 13, service: "Ferrara" }
    ]
  },
  {
    id: "res_klosinski",
    name: "Paul Klosinski",
    trainingLevel: "PGY5",
    color: "#d36b5c",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NRV" },
      { startBlock: 2, endBlock: 2, service: "NFloat" },
      { startBlock: 3, endBlock: 3, service: "Davies" },
      { startBlock: 4, endBlock: 4, service: "Davies" },
      { startBlock: 5, endBlock: 5, service: "Berry" },
      { startBlock: 6, endBlock: 6, service: "Berry" },
      { startBlock: 7, endBlock: 7, service: "Fogel" },
      { startBlock: 8, endBlock: 8, service: "Fogel" },
      { startBlock: 9, endBlock: 9, service: "Keeley Vasc" },
      { startBlock: 10, endBlock: 10, service: "Keeley Vasc" },
      { startBlock: 11, endBlock: 11, service: "Ferrara" },
      { startBlock: 13, endBlock: 13, service: "NRV" }
    ]
  },
  {
    id: "res_maghsoudi",
    name: "Taneen Maghsoudi",
    trainingLevel: "PGY5",
    color: "#c89af7",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Fogel" },
      { startBlock: 2, endBlock: 2, service: "Fogel" },
      { startBlock: 3, endBlock: 3, service: "Keeley Vasc" },
      { startBlock: 4, endBlock: 4, service: "Keeley Vasc" },
      { startBlock: 5, endBlock: 5, service: "Ferrara" },
      { startBlock: 6, endBlock: 6, service: "Ferrara" },
      { startBlock: 7, endBlock: 7, service: "NRV" },
      { startBlock: 8, endBlock: 8, service: "NRV" },
      { startBlock: 9, endBlock: 9, service: "Davies" },
      { startBlock: 10, endBlock: 10, service: "Davies" },
      { startBlock: 11, endBlock: 11, service: "Berry" },
      { startBlock: 12, endBlock: 12, service: "Berry" },
      { startBlock: 13, endBlock: 13, service: "Fogel" }
    ]
  },
  {
    id: "res_mawussi",
    name: "Yao Mawussi",
    trainingLevel: "PGY1",
    color: "#e65245",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Fogel" },
      { startBlock: 2, endBlock: 2, service: "Anesthesia" },
      { startBlock: 3, endBlock: 3, service: "NFloat" },
      { startBlock: 4, endBlock: 4, service: "Ferrara" },
      { startBlock: 5, endBlock: 5, service: "Fogel" },
      { startBlock: 6, endBlock: 6, service: "Ferrara" },
      { startBlock: 7, endBlock: 7, service: "Ped Surg" },
      { startBlock: 8, endBlock: 8, service: "Davies" },
      { startBlock: 9, endBlock: 9, service: "Gilbert" },
      { startBlock: 10, endBlock: 10, service: "NFloat" },
      { startBlock: 11, endBlock: 11, service: "Fogel" },
      { startBlock: 12, endBlock: 12, service: "SCC-days" },
      { startBlock: 13, endBlock: 13, service: "Berry" }
    ]
  },
  {
    id: "res_mohamed",
    name: "Aleem Mohamed",
    trainingLevel: "PGY3",
    color: "#64748b",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Ped Surg" },
      { startBlock: 2, endBlock: 2, service: "Ferrara" },
      { startBlock: 3, endBlock: 3, service: "NRV" },
      { startBlock: 4, endBlock: 4, service: "SCC-days" },
      { startBlock: 5, endBlock: 5, service: "Davies" },
      { startBlock: 6, endBlock: 6, service: "Ped Surg" },
      { startBlock: 7, endBlock: 7, service: "Berry" },
      { startBlock: 8, endBlock: 8, service: "NRV" },
      { startBlock: 9, endBlock: 9, service: "SCC-days" },
      { startBlock: 10, endBlock: 10, service: "VCU Burn" },
      { startBlock: 11, endBlock: 11, service: "Ped Surg" },
      { startBlock: 12, endBlock: 12, service: "Keeley Vasc" },
      { startBlock: 13, endBlock: 13, service: "NRV" }
    ]
  },
  {
    id: "res_moore",
    name: "Jayden Moore",
    trainingLevel: "PGY1",
    color: "#2f78c4",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "SCC-days" },
      { startBlock: 2, endBlock: 2, service: "Gilbert" },
      { startBlock: 3, endBlock: 3, service: "Ferrara" },
      { startBlock: 4, endBlock: 4, service: "NFloat" },
      { startBlock: 5, endBlock: 5, service: "Ped Surg" },
      { startBlock: 6, endBlock: 6, service: "Davies" },
      { startBlock: 7, endBlock: 7, service: "Berry" },
      { startBlock: 8, endBlock: 8, service: "Keeley Vasc" },
      { startBlock: 9, endBlock: 9, service: "Ferrara" },
      { startBlock: 10, endBlock: 10, service: "Endoscopy" },
      { startBlock: 11, endBlock: 11, service: "Research" },
      { startBlock: 12, endBlock: 12, service: "Fogel" },
      { startBlock: 13, endBlock: 13, service: "NFloat" }
    ]
  },
  {
    id: "res_nde",
    name: "Martin Nde",
    trainingLevel: "PGY5",
    color: "#d5ad37",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Keeley Vasc" },
      { startBlock: 2, endBlock: 2, service: "Keeley Vasc" },
      { startBlock: 3, endBlock: 3, service: "Ferrara" },
      { startBlock: 4, endBlock: 4, service: "Ferrara" },
      { startBlock: 5, endBlock: 5, service: "NRV" },
      { startBlock: 6, endBlock: 6, service: "NRV" },
      { startBlock: 7, endBlock: 7, service: "Davies" },
      { startBlock: 8, endBlock: 8, service: "Davies" },
      { startBlock: 9, endBlock: 9, service: "Berry" },
      { startBlock: 10, endBlock: 10, service: "Berry" },
      { startBlock: 11, endBlock: 11, service: "Fogel" },
      { startBlock: 12, endBlock: 12, service: "Fogel" },
      { startBlock: 13, endBlock: 13, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_necessary",
    name: "Christina Necessary",
    trainingLevel: "PGY1",
    color: "#7e63c9",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NFloat" },
      { startBlock: 2, endBlock: 2, service: "SCC-days" },
      { startBlock: 3, endBlock: 3, service: "Gilbert" },
      { startBlock: 4, endBlock: 4, service: "Endoscopy" },
      { startBlock: 5, endBlock: 5, service: "Ferrara" },
      { startBlock: 6, endBlock: 6, service: "Keeley Vasc" },
      { startBlock: 7, endBlock: 7, service: "Davies" },
      { startBlock: 8, endBlock: 8, service: "Berry" },
      { startBlock: 9, endBlock: 9, service: "Fogel" },
      { startBlock: 10, endBlock: 10, service: "Ferrara" },
      { startBlock: 11, endBlock: 11, service: "Research" },
      { startBlock: 12, endBlock: 12, service: "Ped Surg" },
      { startBlock: 13, endBlock: 13, service: "Fogel" }
    ]
  },
  {
    id: "res_roberson",
    name: "Hannah Roberson",
    trainingLevel: "PGY4",
    color: "#2f8c89",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NRV" },
      { startBlock: 2, endBlock: 2, service: "Breast" },
      { startBlock: 3, endBlock: 3, service: "Gilbert" },
      { startBlock: 4, endBlock: 4, service: "Gilbert" },
      { startBlock: 5, endBlock: 5, service: "Thoracic" },
      { startBlock: 6, endBlock: 6, service: "Davies" },
      { startBlock: 7, endBlock: 7, service: "NFloat" },
      { startBlock: 8, endBlock: 8, service: "NFloat" },
      { startBlock: 9, endBlock: 9, service: "Keeley Vasc" },
      { startBlock: 10, endBlock: 10, service: "Keeley Vasc" },
      { startBlock: 11, endBlock: 11, service: "Gilbert" },
      { startBlock: 12, endBlock: 12, service: "Head & Neck" },
      { startBlock: 13, endBlock: 13, service: "Davies" }
    ]
  },
  {
    id: "res_rodgers",
    name: "Jeffrey Rodgers",
    trainingLevel: "PGY2",
    color: "#f37d6e",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Breast" },
      { startBlock: 2, endBlock: 2, service: "NRV" },
      { startBlock: 3, endBlock: 3, service: "SCC Night" },
      { startBlock: 4, endBlock: 4, service: "Davies" },
      { startBlock: 5, endBlock: 5, service: "Berry" },
      { startBlock: 6, endBlock: 6, service: "Ferrara" },
      { startBlock: 7, endBlock: 7, service: "NRV" },
      { startBlock: 8, endBlock: 8, service: "Endoscopy" },
      { startBlock: 9, endBlock: 9, service: "NFloat" },
      { startBlock: 10, endBlock: 10, service: "NFloat" },
      { startBlock: 11, endBlock: 11, service: "Ferrara" },
      { startBlock: 12, endBlock: 12, service: "Berry" },
      { startBlock: 13, endBlock: 13, service: "SCC Night" }
    ]
  },
  {
    id: "res_scarbro",
    name: "Molly Scarbro",
    trainingLevel: "PGY4",
    color: "#4f7d46",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Berry" },
      { startBlock: 2, endBlock: 2, service: "Head & Neck" },
      { startBlock: 3, endBlock: 3, service: "Breast" },
      { startBlock: 4, endBlock: 4, service: "NRV" },
      { startBlock: 5, endBlock: 5, service: "Keeley Vasc" },
      { startBlock: 6, endBlock: 6, service: "Keeley Vasc" },
      { startBlock: 7, endBlock: 7, service: "Gilbert" },
      { startBlock: 8, endBlock: 8, service: "Gilbert" },
      { startBlock: 9, endBlock: 9, service: "NFloat" },
      { startBlock: 10, endBlock: 10, service: "NFloat" },
      { startBlock: 11, endBlock: 11, service: "Thoracic" },
      { startBlock: 12, endBlock: 12, service: "Gilbert" },
      { startBlock: 13, endBlock: 13, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_chief",
    name: "Andrew Schroeder",
    trainingLevel: "PGY5",
    color: "#b84a62",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Davies" },
      { startBlock: 2, endBlock: 2, service: "Davies" },
      { startBlock: 3, endBlock: 3, service: "Berry" },
      { startBlock: 4, endBlock: 4, service: "Berry" },
      { startBlock: 5, endBlock: 5, service: "Fogel" },
      { startBlock: 6, endBlock: 6, service: "Fogel" },
      { startBlock: 7, endBlock: 7, service: "Keeley Vasc" },
      { startBlock: 8, endBlock: 8, service: "Keeley Vasc" },
      { startBlock: 9, endBlock: 9, service: "Ferrara" },
      { startBlock: 10, endBlock: 10, service: "Ferrara" },
      { startBlock: 11, endBlock: 11, service: "NRV" },
      { startBlock: 12, endBlock: 12, service: "NRV" },
      { startBlock: 13, endBlock: 13, service: "Davies" }
    ]
  },
  {
    id: "res_shank",
    name: "Nina Shank",
    trainingLevel: "PGY1",
    color: "#8b5a3c",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Berry" },
      { startBlock: 2, endBlock: 2, service: "Ferrara" },
      { startBlock: 3, endBlock: 3, service: "SCC-days" },
      { startBlock: 4, endBlock: 4, service: "Gilbert" },
      { startBlock: 5, endBlock: 5, service: "Davies" },
      { startBlock: 6, endBlock: 6, service: "Ferrara" },
      { startBlock: 7, endBlock: 7, service: "Keeley Vasc" },
      { startBlock: 8, endBlock: 8, service: "Ped Surg" },
      { startBlock: 9, endBlock: 9, service: "Davies" },
      { startBlock: 10, endBlock: 10, service: "Fogel" },
      { startBlock: 11, endBlock: 11, service: "Research" },
      { startBlock: 12, endBlock: 12, service: "Endoscopy" },
      { startBlock: 13, endBlock: 13, service: "Ferrara" }
    ]
  },
  {
    id: "res_shigley",
    name: "Nathan Shigley",
    trainingLevel: "PGY1",
    color: "#5f7fb8",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Ferrara" },
      { startBlock: 2, endBlock: 2, service: "Ped Surg" },
      { startBlock: 3, endBlock: 3, service: "Berry" },
      { startBlock: 4, endBlock: 4, service: "SCC-days" },
      { startBlock: 5, endBlock: 5, service: "Gilbert" },
      { startBlock: 6, endBlock: 6, service: "NFloat" },
      { startBlock: 7, endBlock: 7, service: "Ferrara" },
      { startBlock: 8, endBlock: 8, service: "Fogel" },
      { startBlock: 9, endBlock: 9, service: "Keeley Vasc" },
      { startBlock: 10, endBlock: 10, service: "Davies" },
      { startBlock: 11, endBlock: 11, service: "Research" },
      { startBlock: 12, endBlock: 12, service: "Ferrara" },
      { startBlock: 13, endBlock: 13, service: "Endoscopy" }
    ]
  },
  {
    id: "res_somaiah",
    name: "Prarthana Somaiah",
    trainingLevel: "PGY2",
    color: "#bf6d9e",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NFloat" },
      { startBlock: 2, endBlock: 2, service: "Davies" },
      { startBlock: 3, endBlock: 3, service: "NRV" },
      { startBlock: 4, endBlock: 4, service: "Fogel" },
      { startBlock: 5, endBlock: 5, service: "SCC Night" },
      { startBlock: 6, endBlock: 6, service: "Endoscopy" },
      { startBlock: 7, endBlock: 7, service: "Ferrara" },
      { startBlock: 8, endBlock: 8, service: "NRV" },
      { startBlock: 9, endBlock: 9, service: "Berry" },
      { startBlock: 10, endBlock: 10, service: "Davies" },
      { startBlock: 11, endBlock: 11, service: "NFloat" },
      { startBlock: 12, endBlock: 12, service: "Ferrara" },
      { startBlock: 13, endBlock: 13, service: "Berry" }
    ]
  },
  {
    id: "res_swaak",
    name: "Amanda Swaak",
    trainingLevel: "PGY3",
    color: "#3f8f62",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Davies" },
      { startBlock: 2, endBlock: 2, service: "Ped Surg" },
      { startBlock: 3, endBlock: 3, service: "Ferrara" },
      { startBlock: 4, endBlock: 4, service: "Berry" },
      { startBlock: 5, endBlock: 5, service: "SCC-days" },
      { startBlock: 6, endBlock: 6, service: "VCU Burn" },
      { startBlock: 7, endBlock: 7, service: "Ped Surg" },
      { startBlock: 8, endBlock: 8, service: "Keeley Vasc" },
      { startBlock: 9, endBlock: 9, service: "NRV" },
      { startBlock: 10, endBlock: 10, service: "SCC-days" },
      { startBlock: 11, endBlock: 11, service: "Davies" },
      { startBlock: 12, endBlock: 12, service: "Ped Surg" },
      { startBlock: 13, endBlock: 13, service: "Davies" }
    ]
  },
  {
    id: "res_thorpe",
    name: "Courtney Thorpe",
    trainingLevel: "PGY2",
    color: "#9b6a44",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NRV" },
      { startBlock: 2, endBlock: 2, service: "SCC Night" },
      { startBlock: 3, endBlock: 3, service: "Davies" },
      { startBlock: 4, endBlock: 4, service: "SCC Night" },
      { startBlock: 5, endBlock: 5, service: "Endoscopy" },
      { startBlock: 6, endBlock: 6, service: "NRV" },
      { startBlock: 7, endBlock: 7, service: "NFloat" },
      { startBlock: 8, endBlock: 8, service: "NFloat" },
      { startBlock: 9, endBlock: 9, service: "Fogel" },
      { startBlock: 10, endBlock: 10, service: "Ferrara" },
      { startBlock: 11, endBlock: 11, service: "Breast" },
      { startBlock: 12, endBlock: 12, service: "Davies" },
      { startBlock: 13, endBlock: 13, service: "NRV" }
    ]
  },
  {
    id: "res_williams",
    name: "Maria Williams",
    trainingLevel: "PGY4",
    color: "#d36b5c",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Gilbert" },
      { startBlock: 2, endBlock: 2, service: "Gilbert" },
      { startBlock: 3, endBlock: 3, service: "Thoracic" },
      { startBlock: 4, endBlock: 4, service: "Davies" },
      { startBlock: 5, endBlock: 5, service: "NFloat" },
      { startBlock: 6, endBlock: 6, service: "NFloat" },
      { startBlock: 7, endBlock: 7, service: "Keeley Vasc" },
      { startBlock: 8, endBlock: 8, service: "Keeley Vasc" },
      { startBlock: 9, endBlock: 9, service: "Breast" },
      { startBlock: 10, endBlock: 10, service: "Head & Neck" },
      { startBlock: 11, endBlock: 11, service: "NRV" },
      { startBlock: 12, endBlock: 12, service: "NFloat" },
      { startBlock: 13, endBlock: 13, service: "Gilbert" }
    ]
  },
  {
    id: "res_zheng",
    name: "Allison Zheng",
    trainingLevel: "PGY3",
    color: "#c89af7",
    rosterKind: "primary",
    sourceProgram: "General Surgery",
    tags: ["rotation-roster"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "SCC-days" },
      { startBlock: 2, endBlock: 2, service: "Davies" },
      { startBlock: 3, endBlock: 3, service: "Ped Surg" },
      { startBlock: 4, endBlock: 4, service: "Ferrara" },
      { startBlock: 5, endBlock: 5, service: "NRV" },
      { startBlock: 6, endBlock: 6, service: "SCC-days" },
      { startBlock: 7, endBlock: 7, service: "Keeley Vasc" },
      { startBlock: 8, endBlock: 8, service: "Ped Surg" },
      { startBlock: 9, endBlock: 9, service: "Transplant" },
      { startBlock: 10, endBlock: 10, service: "NRV" },
      { startBlock: 11, endBlock: 11, service: "SCC-days" },
      { startBlock: 12, endBlock: 12, service: "Davies" },
      { startBlock: 13, endBlock: 13, service: "Ped Surg" }
    ]
  },
  {
    id: "res_external_nasreen_ahmed",
    name: "Nasreen Ahmed",
    trainingLevel: "PGY1",
    color: "#e65245",
    rosterKind: "off-service",
    sourceProgram: "Pediatrics",
    sourceProgramAbbreviation: "Peds",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "Anesthesia", startDate: "2027-03-29", endDate: "2027-04-11" }
    ]
  },
  {
    id: "res_external_alayna_arnholt",
    name: "Alayna Arnholt",
    trainingLevel: "PGY1",
    color: "#64748b",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "Gilbert" },
      { startBlock: 7, endBlock: 7, service: "Anesthesia", startDate: "2026-12-21", endDate: "2027-01-10" }
    ]
  },
  {
    id: "res_external_jonathan_axford",
    name: "Jonathan Axford",
    trainingLevel: "PGY1",
    color: "#2f78c4",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 7, endBlock: 7, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_azraa_ayesha",
    name: "Azraa Ayesha",
    trainingLevel: "PGY1",
    color: "#d5ad37",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 3, endBlock: 3, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_sara_azher",
    name: "Sara Azher",
    trainingLevel: "PGY1",
    color: "#7e63c9",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_navid_barakzai",
    name: "Navid Barakzai",
    trainingLevel: "PGY1",
    color: "#2f8c89",
    rosterKind: "off-service",
    sourceProgram: "Dentistry",
    sourceProgramAbbreviation: "Dent",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "Anesthesia", startDate: "2027-03-15", endDate: "2027-03-28" }
    ]
  },
  {
    id: "res_external_philip_bishop",
    name: "Philip Bishop",
    trainingLevel: "PGY1",
    color: "#f37d6e",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 9, endBlock: 9, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_hannah_brown",
    name: "Hannah Brown",
    trainingLevel: "PGY1",
    color: "#4f7d46",
    rosterKind: "off-service",
    sourceProgram: "Plastic Surgery",
    sourceProgramAbbreviation: "Pl Sx",
    tags: ["rotation-roster","off-service"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Ped Surg" },
      { startBlock: 2, endBlock: 2, service: "Keeley Vasc" },
      { startBlock: 4, endBlock: 4, service: "Berry" },
      { startBlock: 6, endBlock: 6, service: "Ferrara" },
      { startBlock: 7, endBlock: 7, service: "SCC-days" },
      { startBlock: 8, endBlock: 8, service: "Davies" },
      { startBlock: 10, endBlock: 10, service: "Gilbert" },
      { startBlock: 11, endBlock: 11, service: "Ferrara" },
      { startBlock: 12, endBlock: 12, service: "Berry" },
      { startBlock: 13, endBlock: 13, service: "NFloat" }
    ]
  },
  {
    id: "res_external_beatrice_byrne",
    name: "Beatrice Byrne",
    trainingLevel: "PGY1",
    color: "#b84a62",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 7, endBlock: 7, service: "SCC-days" },
      { startBlock: 11, endBlock: 11, service: "SCC Night", startDate: "2027-04-12", endDate: "2027-04-19" }
    ]
  },
  {
    id: "res_external_robert_craig_clark",
    name: "Robert Craig Clark",
    trainingLevel: "PGY1",
    color: "#8b5a3c",
    rosterKind: "off-service",
    sourceProgram: "Plastic Surgery",
    sourceProgramAbbreviation: "Pl Sx",
    tags: ["rotation-roster","off-service"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 4, endBlock: 4, service: "Transplant" },
      { startBlock: 12, endBlock: 12, service: "Breast" }
    ]
  },
  {
    id: "res_external_stephanie_coleman",
    name: "Stephanie Coleman",
    trainingLevel: "PGY1",
    color: "#5f7fb8",
    rosterKind: "off-service",
    sourceProgram: "Podiatric Medicine and Surgery",
    sourceProgramAbbreviation: "PMSR",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "Anesthesia", startDate: "2026-11-23", endDate: "2026-12-06" },
      { startBlock: 9, endBlock: 9, service: "Ferrara" }
    ]
  },
  {
    id: "res_external_ryan_corlett",
    name: "Ryan Corlett",
    trainingLevel: "PGY1",
    color: "#bf6d9e",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_jacob_davis",
    name: "Jacob Davis",
    trainingLevel: "PGY1",
    color: "#3f8f62",
    rosterKind: "off-service",
    sourceProgram: "Internal Medicine",
    sourceProgramAbbreviation: "IM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "Anesthesia", startDate: "2027-03-29", endDate: "2027-04-11" }
    ]
  },
  {
    id: "res_external_amira_elsabagh",
    name: "Amira Elsabagh",
    trainingLevel: "Fellow",
    color: "#9b6a44",
    rosterKind: "off-service",
    sourceProgram: "Pulmonary Medicine Fellowship",
    sourceProgramAbbreviation: "PulMedFel",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 7, endBlock: 7, service: "Anesthesia", startDate: "2027-01-04", endDate: "2027-01-17" }
    ]
  },
  {
    id: "res_external_danielle_emery",
    name: "Danielle Emery",
    trainingLevel: "PGY1",
    color: "#d36b5c",
    rosterKind: "off-service",
    sourceProgram: "Podiatric Medicine and Surgery",
    sourceProgramAbbreviation: "PMSR",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 2, endBlock: 2, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_external_andrew_fletcher",
    name: "Andrew Fletcher",
    trainingLevel: "PGY1",
    color: "#c89af7",
    rosterKind: "off-service",
    sourceProgram: "Internal Medicine",
    sourceProgramAbbreviation: "IM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 12, endBlock: 12, service: "Anesthesia", startDate: "2027-05-10", endDate: "2027-05-23" }
    ]
  },
  {
    id: "res_external_jose_flores_gonzalez",
    name: "Jose Flores Gonzalez",
    trainingLevel: "Fellow",
    color: "#e65245",
    rosterKind: "off-service",
    sourceProgram: "Pulmonary Medicine Fellowship",
    sourceProgramAbbreviation: "PulMedFel",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 3, endBlock: 3, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_henry_flynn",
    name: "Henry Flynn",
    trainingLevel: "PGY1",
    color: "#64748b",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 8, endBlock: 8, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_elizabeth_gienger",
    name: "Elizabeth Gienger",
    trainingLevel: "PGY1",
    color: "#2f78c4",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 2, endBlock: 2, service: "Anesthesia", startDate: "2026-08-03", endDate: "2026-08-23" },
      { startBlock: 13, endBlock: 13, service: "Gilbert" }
    ]
  },
  {
    id: "res_external_jennifer_goldman",
    name: "Jennifer Goldman",
    trainingLevel: "PGY1",
    color: "#d5ad37",
    rosterKind: "off-service",
    sourceProgram: "Plastic Surgery",
    sourceProgramAbbreviation: "Pl Sx",
    tags: ["rotation-roster","off-service"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Gilbert" },
      { startBlock: 2, endBlock: 2, service: "SCC-days" },
      { startBlock: 3, endBlock: 3, service: "Fogel" },
      { startBlock: 4, endBlock: 4, service: "Keeley Vasc" },
      { startBlock: 5, endBlock: 5, service: "NFloat" },
      { startBlock: 7, endBlock: 7, service: "Ferrara" },
      { startBlock: 9, endBlock: 9, service: "Berry" },
      { startBlock: 10, endBlock: 10, service: "Ped Surg" },
      { startBlock: 12, endBlock: 12, service: "Keeley Vasc" },
      { startBlock: 13, endBlock: 13, service: "Ferrara" }
    ]
  },
  {
    id: "res_external_iraa_guleria",
    name: "Iraa Guleria",
    trainingLevel: "PGY1",
    color: "#7e63c9",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 5, endBlock: 5, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_syed_hissam_haider",
    name: "Syed Hissam Haider",
    trainingLevel: "Fellow",
    color: "#2f8c89",
    rosterKind: "off-service",
    sourceProgram: "Critical Care Medicine",
    sourceProgramAbbreviation: "CCM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 8, endBlock: 8, service: "Anesthesia", startDate: "2027-02-01", endDate: "2027-02-14" },
      { startBlock: 12, endBlock: 12, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_tareck_haykal",
    name: "Tareck Haykal",
    trainingLevel: "PGY1",
    color: "#f37d6e",
    rosterKind: "off-service",
    sourceProgram: "Plastic Surgery",
    sourceProgramAbbreviation: "Pl Sx",
    tags: ["rotation-roster","off-service"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 2, endBlock: 2, service: "NFloat", startDate: "2026-08-03", endDate: "2026-08-16" },
      { startBlock: 3, endBlock: 3, service: "Keeley Vasc" },
      { startBlock: 7, endBlock: 7, service: "Anesthesia" },
      { startBlock: 13, endBlock: 13, service: "Breast" }
    ]
  },
  {
    id: "res_external_anna_haymov",
    name: "Anna Haymov",
    trainingLevel: "PGY1",
    color: "#4f7d46",
    rosterKind: "off-service",
    sourceProgram: "Neurosurgery",
    sourceProgramAbbreviation: "NEUROSURG",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "SCC-days" },
      { startBlock: 13, endBlock: 13, service: "Anesthesia" }
    ]
  },
  {
    id: "res_external_meagan_johnson",
    name: "Meagan Johnson",
    trainingLevel: "PGY1",
    color: "#b84a62",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 1, endBlock: 1, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_rhiana_jones",
    name: "Rhiana Jones",
    trainingLevel: "PGY1",
    color: "#8b5a3c",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 2, endBlock: 2, service: "Gilbert" },
      { startBlock: 3, endBlock: 3, service: "Anesthesia", startDate: "2026-08-31", endDate: "2026-09-20" }
    ]
  },
  {
    id: "res_external_malika_kaderali",
    name: "Malika Kaderali",
    trainingLevel: "PGY1",
    color: "#5f7fb8",
    rosterKind: "off-service",
    sourceProgram: "Podiatric Medicine and Surgery",
    sourceProgramAbbreviation: "PMSR",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_external_kylee_karczewski",
    name: "Kylee Karczewski",
    trainingLevel: "PGY1",
    color: "#bf6d9e",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 3, endBlock: 3, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_julia_kawas",
    name: "Julia Kawas",
    trainingLevel: "PGY1",
    color: "#3f8f62",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 2, endBlock: 2, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_gregory_king",
    name: "Gregory King",
    trainingLevel: "PGY1",
    color: "#9b6a44",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 4, endBlock: 4, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_kevin_kurtz",
    name: "Kevin Kurtz",
    trainingLevel: "PGY1",
    color: "#d36b5c",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 11, endBlock: 11, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_david_lee",
    name: "David Lee",
    trainingLevel: "PGY1",
    color: "#c89af7",
    rosterKind: "off-service",
    sourceProgram: "Dentistry",
    sourceProgramAbbreviation: "Dent",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 5, endBlock: 5, service: "Anesthesia", startDate: "2026-11-02", endDate: "2026-11-15" }
    ]
  },
  {
    id: "res_external_nicholas_leonard",
    name: "Nicholas Leonard",
    trainingLevel: "PGY1",
    color: "#e65245",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 7, endBlock: 7, service: "Gilbert" },
      { startBlock: 8, endBlock: 8, service: "Anesthesia", startDate: "2027-01-18", endDate: "2027-02-07" }
    ]
  },
  {
    id: "res_external_paige_lilley",
    name: "Paige Lilley",
    trainingLevel: "PGY1",
    color: "#64748b",
    rosterKind: "off-service",
    sourceProgram: "Dentistry",
    sourceProgramAbbreviation: "Dent",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "Anesthesia", startDate: "2026-11-30", endDate: "2026-12-13" }
    ]
  },
  {
    id: "res_external_joseph_litsey",
    name: "Joseph Litsey",
    trainingLevel: "PGY1",
    color: "#2f78c4",
    rosterKind: "off-service",
    sourceProgram: "Podiatric Medicine and Surgery",
    sourceProgramAbbreviation: "PMSR",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "Ferrara" },
      { startBlock: 13, endBlock: 13, service: "Anesthesia", startDate: "2027-06-07", endDate: "2027-06-20" }
    ]
  },
  {
    id: "res_external_phoebe_livingston",
    name: "Phoebe Livingston",
    trainingLevel: "PGY1",
    color: "#d5ad37",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "Gilbert" },
      { startBlock: 11, endBlock: 11, service: "Anesthesia", startDate: "2027-04-12", endDate: "2027-05-02" }
    ]
  },
  {
    id: "res_external_amanda_mahoney",
    name: "Amanda Mahoney",
    trainingLevel: "Fellow",
    color: "#7e63c9",
    rosterKind: "off-service",
    sourceProgram: "Pulmonary Medicine Fellowship",
    sourceProgramAbbreviation: "PulMedFel",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "Anesthesia", startDate: "2026-12-07", endDate: "2026-12-20" }
    ]
  },
  {
    id: "res_external_sahith_mandala",
    name: "Sahith Mandala",
    trainingLevel: "PGY1",
    color: "#2f8c89",
    rosterKind: "off-service",
    sourceProgram: "Plastic Surgery",
    sourceProgramAbbreviation: "Pl Sx",
    tags: ["rotation-roster","off-service"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 4, endBlock: 4, service: "Breast" },
      { startBlock: 6, endBlock: 6, service: "Transplant" }
    ]
  },
  {
    id: "res_external_vincy_mathew",
    name: "Vincy Mathew",
    trainingLevel: "PGY1",
    color: "#f37d6e",
    rosterKind: "off-service",
    sourceProgram: "Neurosurgery",
    sourceProgramAbbreviation: "NEUROSURG",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 4, endBlock: 4, service: "Anesthesia" },
      { startBlock: 12, endBlock: 12, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_kane_miller",
    name: "Kane Miller",
    trainingLevel: "PGY1",
    color: "#4f7d46",
    rosterKind: "off-service",
    sourceProgram: "Dentistry",
    sourceProgramAbbreviation: "Dent",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 8, endBlock: 8, service: "Anesthesia", startDate: "2027-01-18", endDate: "2027-01-31" }
    ]
  },
  {
    id: "res_external_ahmed_samir_mirza",
    name: "Ahmed Samir Mirza",
    trainingLevel: "Fellow",
    color: "#b84a62",
    rosterKind: "off-service",
    sourceProgram: "Pulmonary Medicine Fellowship",
    sourceProgramAbbreviation: "PulMedFel",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 11, endBlock: 11, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_abigail_mistretta",
    name: "Abigail Mistretta",
    trainingLevel: "PGY1",
    color: "#8b5a3c",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 8, endBlock: 8, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_lucas_moran",
    name: "Lucas Moran",
    trainingLevel: "PGY1",
    color: "#5f7fb8",
    rosterKind: "off-service",
    sourceProgram: "Podiatric Medicine and Surgery",
    sourceProgramAbbreviation: "PMSR",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 13, endBlock: 13, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_external_austin_murray",
    name: "Austin Murray",
    trainingLevel: "PGY1",
    color: "#bf6d9e",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 8, endBlock: 8, service: "Gilbert" },
      { startBlock: 9, endBlock: 9, service: "Anesthesia", startDate: "2027-02-15", endDate: "2027-03-07" }
    ]
  },
  {
    id: "res_external_jacob_nelson",
    name: "Jacob Nelson",
    trainingLevel: "PGY1",
    color: "#3f8f62",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 4, endBlock: 4, service: "Gilbert" },
      { startBlock: 5, endBlock: 5, service: "Anesthesia", startDate: "2026-10-26", endDate: "2026-11-15" }
    ]
  },
  {
    id: "res_external_alyse_oxenford",
    name: "Alyse Oxenford",
    trainingLevel: "PGY1",
    color: "#9b6a44",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 12, endBlock: 12, service: "Gilbert" },
      { startBlock: 13, endBlock: 13, service: "Anesthesia", startDate: "2027-06-07", endDate: "2027-06-27" }
    ]
  },
  {
    id: "res_external_matias_palmisano",
    name: "Matias Palmisano",
    trainingLevel: "PGY1",
    color: "#d36b5c",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "Anesthesia", startDate: "2026-11-23", endDate: "2026-12-13" },
      { startBlock: 11, endBlock: 11, service: "Gilbert" }
    ]
  },
  {
    id: "res_external_han_park",
    name: "Han Park",
    trainingLevel: "PGY1",
    color: "#c89af7",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 9, endBlock: 9, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_seth_pekoe",
    name: "Seth Pekoe",
    trainingLevel: "PGY1",
    color: "#e65245",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 9, endBlock: 9, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_conlan_pierce",
    name: "Conlan Pierce",
    trainingLevel: "Fellow",
    color: "#64748b",
    rosterKind: "off-service",
    sourceProgram: "Surgical Critical Care",
    sourceProgramAbbreviation: "SCC",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 12, endBlock: 12, service: "Ferrara" }
    ]
  },
  {
    id: "res_external_nathanael_pilar",
    name: "Nathanael Pilar",
    trainingLevel: "PGY1",
    color: "#2f78c4",
    rosterKind: "off-service",
    sourceProgram: "Internal Medicine",
    sourceProgramAbbreviation: "IM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 9, endBlock: 9, service: "Anesthesia", startDate: "2027-02-22", endDate: "2027-03-14" },
      { startBlock: 10, endBlock: 10, service: "Anesthesia", startDate: "2027-03-15", endDate: "2027-03-21" }
    ]
  },
  {
    id: "res_external_brendan_podszus",
    name: "Brendan Podszus",
    trainingLevel: "PGY1",
    color: "#d5ad37",
    rosterKind: "off-service",
    sourceProgram: "Plastic Surgery",
    sourceProgramAbbreviation: "Pl Sx",
    tags: ["rotation-roster","off-service"],
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 2, endBlock: 2, service: "NFloat", startDate: "2026-08-17", endDate: "2026-08-30" },
      { startBlock: 5, endBlock: 5, service: "Keeley Vasc" },
      { startBlock: 9, endBlock: 9, service: "Breast" },
      { startBlock: 11, endBlock: 11, service: "Anesthesia" }
    ]
  },
  {
    id: "res_external_brandon_prentice",
    name: "Brandon Prentice",
    trainingLevel: "PGY1",
    color: "#7e63c9",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 13, endBlock: 13, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_zain_qazi",
    name: "Zain Qazi",
    trainingLevel: "Fellow",
    color: "#2f8c89",
    rosterKind: "off-service",
    sourceProgram: "Pulmonary Medicine Fellowship",
    sourceProgramAbbreviation: "PulMedFel",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 9, endBlock: 9, service: "Anesthesia", startDate: "2027-02-15", endDate: "2027-02-28" }
    ]
  },
  {
    id: "res_external_jasraj_raghuwanshi",
    name: "Jasraj Raghuwanshi",
    trainingLevel: "PGY1",
    color: "#f37d6e",
    rosterKind: "off-service",
    sourceProgram: "Orthopaedics",
    sourceProgramAbbreviation: "Orthopaedics",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "Gilbert" },
      { startBlock: 7, endBlock: 7, service: "SCC-days" },
      { startBlock: 9, endBlock: 9, service: "Keeley Vasc" },
      { startBlock: 11, endBlock: 11, service: "Ped Surg" }
    ]
  },
  {
    id: "res_external_sai_sri_harsha_rallabhandi",
    name: "Sai Sri Harsha Rallabhandi",
    trainingLevel: "Fellow",
    color: "#4f7d46",
    rosterKind: "off-service",
    sourceProgram: "Pulmonary Medicine Fellowship",
    sourceProgramAbbreviation: "PulMedFel",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_anthony_rezcallah",
    name: "Anthony Rezcallah",
    trainingLevel: "Fellow",
    color: "#b84a62",
    rosterKind: "off-service",
    sourceProgram: "Surgical Critical Care",
    sourceProgramAbbreviation: "SCC",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 11, endBlock: 11, service: "Gilbert" },
      { startBlock: 13, endBlock: 13, service: "Ferrara" }
    ]
  },
  {
    id: "res_external_kaehler_roth",
    name: "Kaehler Roth",
    trainingLevel: "Fellow",
    color: "#8b5a3c",
    rosterKind: "off-service",
    sourceProgram: "Pulmonary Medicine Fellowship",
    sourceProgramAbbreviation: "PulMedFel",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_kaylin_ryan",
    name: "Kaylin Ryan",
    trainingLevel: "PGY1",
    color: "#5f7fb8",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_richard_santiago",
    name: "Richard Santiago",
    trainingLevel: "PGY1",
    color: "#bf6d9e",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 10, endBlock: 10, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_bidhan_shah",
    name: "Bidhan Shah",
    trainingLevel: "Fellow",
    color: "#3f8f62",
    rosterKind: "off-service",
    sourceProgram: "Pulmonary Medicine Fellowship",
    sourceProgramAbbreviation: "PulMedFel",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 9, endBlock: 9, service: "Anesthesia", startDate: "2027-03-01", endDate: "2027-03-14" }
    ]
  },
  {
    id: "res_external_beruk_sherif",
    name: "Beruk Sherif",
    trainingLevel: "PGY1",
    color: "#9b6a44",
    rosterKind: "off-service",
    sourceProgram: "Orthopaedics",
    sourceProgramAbbreviation: "Orthopaedics",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Gilbert" },
      { startBlock: 3, endBlock: 3, service: "Keeley Vasc" },
      { startBlock: 8, endBlock: 8, service: "SCC-days" },
      { startBlock: 12, endBlock: 12, service: "Ped Surg" }
    ]
  },
  {
    id: "res_external_sukrut_sonty",
    name: "Sukrut Sonty",
    trainingLevel: "PGY1",
    color: "#d36b5c",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 4, endBlock: 4, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_senah_stephens",
    name: "Senah Stephens",
    trainingLevel: "PGY1",
    color: "#c89af7",
    rosterKind: "off-service",
    sourceProgram: "Orthopaedics",
    sourceProgramAbbreviation: "Orthopaedics",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 5, endBlock: 5, service: "SCC-days" },
      { startBlock: 11, endBlock: 11, service: "Keeley Vasc" },
      { startBlock: 12, endBlock: 12, service: "Gilbert" },
      { startBlock: 13, endBlock: 13, service: "Ped Surg" }
    ]
  },
  {
    id: "res_external_keith_stoltzfus",
    name: "Keith Stoltzfus",
    trainingLevel: "Fellow",
    color: "#e65245",
    rosterKind: "off-service",
    sourceProgram: "Critical Care Medicine",
    sourceProgramAbbreviation: "CCM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 7, endBlock: 7, service: "SCC-days" },
      { startBlock: 11, endBlock: 11, service: "Anesthesia", startDate: "2027-04-26", endDate: "2027-05-09" }
    ]
  },
  {
    id: "res_external_constance_sullivan",
    name: "Constance Sullivan",
    trainingLevel: "PGY1",
    color: "#64748b",
    rosterKind: "off-service",
    sourceProgram: "Orthopaedics",
    sourceProgramAbbreviation: "Orthopaedics",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Keeley Vasc" },
      { startBlock: 2, endBlock: 2, service: "Ped Surg" },
      { startBlock: 6, endBlock: 6, service: "SCC-days" },
      { startBlock: 11, endBlock: 11, service: "Gilbert" }
    ]
  },
  {
    id: "res_external_greta_tautkus",
    name: "Greta Tautkus",
    trainingLevel: "PGY1",
    color: "#2f78c4",
    rosterKind: "off-service",
    sourceProgram: "Podiatric Medicine and Surgery",
    sourceProgramAbbreviation: "PMSR",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 5, endBlock: 5, service: "Anesthesia", startDate: "2026-10-26", endDate: "2026-11-08" },
      { startBlock: 12, endBlock: 12, service: "Ferrara" }
    ]
  },
  {
    id: "res_external_paige_titak",
    name: "Paige Titak",
    trainingLevel: "PGY1",
    color: "#d5ad37",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 3, endBlock: 3, service: "Gilbert" },
      { startBlock: 4, endBlock: 4, service: "Anesthesia", startDate: "2026-09-28", endDate: "2026-10-18" }
    ]
  },
  {
    id: "res_external_madison_vargo",
    name: "Madison Vargo",
    trainingLevel: "PGY1",
    color: "#7e63c9",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "SCC-days" }
    ]
  },
  {
    id: "res_external_spencer_warden",
    name: "Spencer Warden",
    trainingLevel: "PGY1",
    color: "#2f8c89",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 5, endBlock: 5, service: "Gilbert" }
    ]
  },
  {
    id: "res_external_matthew_widmer",
    name: "Matthew Widmer",
    trainingLevel: "PGY1",
    color: "#f37d6e",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 6, endBlock: 6, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_hunter_williams",
    name: "Hunter Williams",
    trainingLevel: "PGY1",
    color: "#4f7d46",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 7, endBlock: 7, service: "SCC Night" }
    ]
  },
  {
    id: "res_external_nicholas_wright",
    name: "Nicholas Wright",
    trainingLevel: "PGY1",
    color: "#b84a62",
    rosterKind: "off-service",
    sourceProgram: "Emergency Medicine",
    sourceProgramAbbreviation: "EM",
    accountEligible: false,
    tags: ["rotation-roster","off-service"],
    trainingInterests: [],
    rows: [
      { startBlock: 9, endBlock: 9, service: "Gilbert" },
      { startBlock: 10, endBlock: 10, service: "Anesthesia", startDate: "2027-03-15", endDate: "2027-04-04" }
    ]
  }
];

export const RESIDENT_USER_SEEDS = RESIDENT_ROTATION_SEED.flatMap((resident, index) => {
  if (resident.accountEligible === false) return [];
  return [
    {
      username: getSeedUsername(resident, index),
      displayName: resident.name ?? getPlaceholderName(index),
      legacyUsername: getPlaceholderUsername(index),
      legacyDisplayName: getPlaceholderName(index)
    }
  ];
});

export function createRotationResidents(): Resident[] {
  return RESIDENT_ROTATION_SEED.map((resident, index) => {
    const accountEligible = resident.accountEligible !== false;
    return {
      id: resident.id,
      username: accountEligible ? getSeedUsername(resident, index) : undefined,
      name: resident.name ?? getPlaceholderName(index),
      aliases: resident.aliases ?? [],
      trainingLevel: resident.trainingLevel,
      serviceTags: [],
      rosterKind: resident.rosterKind ?? "primary",
      sourceProgram: resident.sourceProgram,
      sourceProgramAbbreviation: resident.sourceProgramAbbreviation,
      accountEligible,
      color: resident.color,
      tags: resident.tags ?? ["rotation-roster"],
      trainingInterests: resident.trainingInterests,
      unavailable: [],
      rotationSchedule: buildRotationSchedule(resident.id, resident.rows)
    };
  });
}

export function getRotationResidentMatchNames(residentId: string): string[] {
  const seedIndex = RESIDENT_ROTATION_SEED.findIndex((resident) => resident.id === residentId);
  if (seedIndex === -1) return [];
  const seed = RESIDENT_ROTATION_SEED[seedIndex];
  return [getPlaceholderName(seedIndex), seed.name, ...(seed.aliases ?? [])].filter((value): value is string => Boolean(value));
}

export function getSeedMigrationBlockNumbers(residentId: string): number[] {
  return RESIDENT_ROTATION_SEED.find((resident) => resident.id === residentId)?.seedMigrationBlockNumbers ?? [];
}

export function buildRotationSchedule(residentId: string, rows: RotationRowSeed[]): Resident["rotationSchedule"] {
  return rows.flatMap((row) =>
    ROTATION_BLOCK_DATES
      .filter((block) => row.startBlock <= block.blockNumber && block.blockNumber <= row.endBlock)
      .map((block) => ({
        id: `rot_${residentId.replace(/^res_/, "")}_${block.blockNumber}`,
        blockNumber: block.blockNumber,
        startDate: row.startDate ?? block.startDate,
        endDate: row.endDate ?? block.endDate,
        service: row.service
      }))
  );
}

function getPlaceholderName(index: number): string {
  return `Resident ${String(index + 1).padStart(2, "0")}`;
}

function getPlaceholderUsername(index: number): string {
  return `resident${String(index + 1).padStart(2, "0")}`;
}

function getSeedUsername(resident: ResidentRotationSeed, index: number): string {
  return resident.name ? buildResidentUsername(resident.name) || getPlaceholderUsername(index) : getPlaceholderUsername(index);
}
