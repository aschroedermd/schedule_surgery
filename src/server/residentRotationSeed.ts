import { ROTATION_BLOCK_DATES } from "../shared/rotations";
import { Resident, TrainingLevel } from "../shared/types";

interface RotationRowSeed {
  startBlock: number;
  endBlock: number;
  service: string;
}

interface ResidentRotationSeed {
  id: string;
  name?: string;
  aliases?: string[];
  trainingLevel: TrainingLevel;
  color: string;
  trainingInterests: string[];
  rows: RotationRowSeed[];
  seedMigrationBlockNumbers?: number[];
}

export const RESIDENT_ROTATION_SEED: ResidentRotationSeed[] = [
  {
    id: "res_fellow",
    name: "Nicole Broden",
    trainingLevel: "Fellow",
    color: "#c89af7",
    trainingInterests: ["bariatrics", "fellow-priority", "foregut"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "Davies" },
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
    ],
    seedMigrationBlockNumbers: [1, 2]
  },
  {
    id: "res_blue",
    trainingLevel: "PGY2",
    color: "#d5ad37",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "SCC Night" },
      { startBlock: 2, endBlock: 2, service: "Endoscopy" },
      { startBlock: 3, endBlock: 4, service: "NFloat" },
      { startBlock: 5, endBlock: 5, service: "NRV" },
      { startBlock: 6, endBlock: 6, service: "Breast" },
      { startBlock: 7, endBlock: 7, service: "Fogel" },
      { startBlock: 8, endBlock: 8, service: "SCC Night" },
      { startBlock: 9, endBlock: 9, service: "Ferrara" },
      { startBlock: 10, endBlock: 10, service: "Breast" },
      { startBlock: 11, endBlock: 12, service: "NRV" },
      { startBlock: 13, endBlock: 13, service: "Davies" }
    ]
  },
  {
    id: "res_bradley",
    trainingLevel: "PGY3",
    color: "#7e63c9",
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
    trainingLevel: "PGY3",
    color: "#2f8c89",
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
    name: "Thein Cao",
    aliases: ["T-Cao", "T Cao"],
    trainingLevel: "PGY2",
    color: "#f37d6e",
    trainingInterests: ["general surgery", "clinic"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Davies" },
      { startBlock: 2, endBlock: 2, service: "Berry" },
      { startBlock: 3, endBlock: 3, service: "Endoscopy" },
      { startBlock: 4, endBlock: 4, service: "NRV" },
      { startBlock: 5, endBlock: 6, service: "NFloat" },
      { startBlock: 7, endBlock: 7, service: "Breast" },
      { startBlock: 8, endBlock: 8, service: "Ferrara" },
      { startBlock: 9, endBlock: 10, service: "NRV" },
      { startBlock: 11, endBlock: 12, service: "SCC Night" },
      { startBlock: 13, endBlock: 13, service: "Ferrara" }
    ],
    seedMigrationBlockNumbers: [1]
  },
  {
    id: "res_colwell",
    trainingLevel: "PGY4",
    color: "#4f7d46",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "Keeley Vasc" },
      { startBlock: 3, endBlock: 4, service: "NFloat" },
      { startBlock: 5, endBlock: 6, service: "Gilbert" },
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
    trainingLevel: "PGY1",
    color: "#b84a62",
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
    id: "res_dewyer",
    trainingLevel: "PGY4",
    color: "#8b5a3c",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "NFloat" },
      { startBlock: 3, endBlock: 4, service: "Keeley Vasc" },
      { startBlock: 5, endBlock: 5, service: "Breast" },
      { startBlock: 6, endBlock: 6, service: "Head & Neck" },
      { startBlock: 7, endBlock: 7, service: "Thoracic" },
      { startBlock: 8, endBlock: 8, service: "Fogel" },
      { startBlock: 9, endBlock: 10, service: "Gilbert" },
      { startBlock: 11, endBlock: 11, service: "NFloat" },
      { startBlock: 12, endBlock: 12, service: "Keeley Vasc" },
      { startBlock: 13, endBlock: 13, service: "NRV" }
    ]
  },
  {
    id: "res_doran",
    trainingLevel: "PGY5",
    color: "#5f7fb8",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "Ferrara" },
      { startBlock: 3, endBlock: 4, service: "NRV" },
      { startBlock: 5, endBlock: 6, service: "Davies" },
      { startBlock: 7, endBlock: 8, service: "Berry" },
      { startBlock: 9, endBlock: 10, service: "Fogel" },
      { startBlock: 11, endBlock: 12, service: "Keeley Vasc" },
      { startBlock: 13, endBlock: 13, service: "Not listed in source grid" }
    ]
  },
  {
    id: "res_greenberg",
    trainingLevel: "PGY1",
    color: "#bf6d9e",
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
    trainingLevel: "PGY1",
    color: "#3f8f62",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Keeley Vasc (7/1-7/18); Plastic Surgery (7/19-8/2)" },
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
      { startBlock: 12, endBlock: 13, service: "Ferrara" }
    ]
  },
  {
    id: "res_klosinski",
    trainingLevel: "PGY5",
    color: "#9b6a44",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NRV" },
      { startBlock: 2, endBlock: 2, service: "NFloat" },
      { startBlock: 3, endBlock: 4, service: "Davies" },
      { startBlock: 5, endBlock: 6, service: "Berry" },
      { startBlock: 7, endBlock: 8, service: "Fogel" },
      { startBlock: 9, endBlock: 10, service: "Keeley Vasc" },
      { startBlock: 11, endBlock: 11, service: "Ferrara" },
      { startBlock: 12, endBlock: 12, service: "NRV" },
      { startBlock: 13, endBlock: 13, service: "Not listed in source grid" }
    ]
  },
  {
    id: "res_maghsoudi",
    trainingLevel: "PGY5",
    color: "#d36b5c",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "Fogel" },
      { startBlock: 3, endBlock: 4, service: "Keeley Vasc" },
      { startBlock: 5, endBlock: 6, service: "Ferrara" },
      { startBlock: 7, endBlock: 8, service: "NRV" },
      { startBlock: 9, endBlock: 10, service: "Davies" },
      { startBlock: 11, endBlock: 12, service: "Berry" },
      { startBlock: 13, endBlock: 13, service: "Fogel" }
    ]
  },
  {
    id: "res_mawussi",
    trainingLevel: "PGY1",
    color: "#d5ad37",
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
    trainingLevel: "PGY3",
    color: "#7e63c9",
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
    trainingLevel: "PGY1",
    color: "#2f8c89",
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
    trainingLevel: "PGY5",
    color: "#2f78c4",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "Keeley Vasc" },
      { startBlock: 3, endBlock: 4, service: "Ferrara" },
      { startBlock: 5, endBlock: 6, service: "NRV" },
      { startBlock: 7, endBlock: 8, service: "Davies" },
      { startBlock: 9, endBlock: 10, service: "Berry" },
      { startBlock: 11, endBlock: 12, service: "Fogel" },
      { startBlock: 13, endBlock: 13, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_necessary",
    trainingLevel: "PGY1",
    color: "#4f7d46",
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
    trainingLevel: "PGY4",
    color: "#b84a62",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NRV" },
      { startBlock: 2, endBlock: 2, service: "Breast" },
      { startBlock: 3, endBlock: 4, service: "Gilbert" },
      { startBlock: 5, endBlock: 5, service: "Thoracic" },
      { startBlock: 6, endBlock: 6, service: "Davies" },
      { startBlock: 7, endBlock: 8, service: "NFloat" },
      { startBlock: 9, endBlock: 10, service: "Keeley Vasc" },
      { startBlock: 11, endBlock: 11, service: "Gilbert" },
      { startBlock: 12, endBlock: 12, service: "Head & Neck" },
      { startBlock: 13, endBlock: 13, service: "Davies" }
    ]
  },
  {
    id: "res_rodgers",
    trainingLevel: "PGY2",
    color: "#8b5a3c",
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
      { startBlock: 9, endBlock: 10, service: "NFloat" },
      { startBlock: 11, endBlock: 11, service: "Ferrara" },
      { startBlock: 12, endBlock: 12, service: "Berry" },
      { startBlock: 13, endBlock: 13, service: "SCC Night" }
    ]
  },
  {
    id: "res_scarbro",
    trainingLevel: "PGY4",
    color: "#5f7fb8",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "Berry" },
      { startBlock: 2, endBlock: 2, service: "Head & Neck" },
      { startBlock: 3, endBlock: 3, service: "Breast" },
      { startBlock: 4, endBlock: 4, service: "NRV" },
      { startBlock: 5, endBlock: 6, service: "Keeley Vasc" },
      { startBlock: 7, endBlock: 8, service: "Gilbert" },
      { startBlock: 9, endBlock: 10, service: "NFloat" },
      { startBlock: 11, endBlock: 11, service: "Thoracic" },
      { startBlock: 12, endBlock: 12, service: "Gilbert" },
      { startBlock: 13, endBlock: 13, service: "Keeley Vasc" }
    ]
  },
  {
    id: "res_chief",
    trainingLevel: "PGY5",
    color: "#f4cf55",
    trainingInterests: ["HPB", "chief-level", "complex open"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "Davies" },
      { startBlock: 3, endBlock: 4, service: "Berry" },
      { startBlock: 5, endBlock: 6, service: "Fogel" },
      { startBlock: 7, endBlock: 8, service: "Keeley Vasc" },
      { startBlock: 9, endBlock: 10, service: "Ferrara" },
      { startBlock: 11, endBlock: 12, service: "NRV" },
      { startBlock: 13, endBlock: 13, service: "Davies" }
    ]
  },
  {
    id: "res_shank",
    trainingLevel: "PGY1",
    color: "#3f8f62",
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
    trainingLevel: "PGY1",
    color: "#9b6a44",
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
    trainingLevel: "PGY2",
    color: "#d36b5c",
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
    trainingLevel: "PGY3",
    color: "#e65245",
    trainingInterests: ["general surgery", "abdominal wall", "clinic"],
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
    trainingLevel: "PGY2",
    color: "#7e63c9",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 1, service: "NRV" },
      { startBlock: 2, endBlock: 2, service: "SCC Night" },
      { startBlock: 3, endBlock: 3, service: "Davies" },
      { startBlock: 4, endBlock: 4, service: "SCC Night" },
      { startBlock: 5, endBlock: 5, service: "Endoscopy" },
      { startBlock: 6, endBlock: 6, service: "NRV" },
      { startBlock: 7, endBlock: 8, service: "NFloat" },
      { startBlock: 9, endBlock: 9, service: "Fogel" },
      { startBlock: 10, endBlock: 10, service: "Ferrara" },
      { startBlock: 11, endBlock: 11, service: "Breast" },
      { startBlock: 12, endBlock: 12, service: "Davies" },
      { startBlock: 13, endBlock: 13, service: "NRV" }
    ]
  },
  {
    id: "res_williams",
    trainingLevel: "PGY4",
    color: "#2f8c89",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "Gilbert" },
      { startBlock: 3, endBlock: 3, service: "Thoracic" },
      { startBlock: 4, endBlock: 4, service: "Davies" },
      { startBlock: 5, endBlock: 6, service: "NFloat" },
      { startBlock: 7, endBlock: 8, service: "Keeley Vasc" },
      { startBlock: 9, endBlock: 9, service: "Breast" },
      { startBlock: 10, endBlock: 10, service: "Head & Neck" },
      { startBlock: 11, endBlock: 11, service: "NRV" },
      { startBlock: 12, endBlock: 12, service: "NFloat" },
      { startBlock: 13, endBlock: 13, service: "Gilbert" }
    ]
  },
  {
    id: "res_zheng",
    trainingLevel: "PGY3",
    color: "#2f78c4",
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
    id: "res_den_besten",
    trainingLevel: "PGY5",
    color: "#4f7d46",
    trainingInterests: ["general surgery"],
    rows: [
      { startBlock: 1, endBlock: 2, service: "Berry" },
      { startBlock: 3, endBlock: 4, service: "Fogel" },
      { startBlock: 5, endBlock: 6, service: "Keeley Vasc" },
      { startBlock: 7, endBlock: 8, service: "Ferrara" },
      { startBlock: 9, endBlock: 10, service: "NRV" },
      { startBlock: 11, endBlock: 12, service: "Davies" },
      { startBlock: 13, endBlock: 13, service: "Berry" }
    ]
  }
];

export const RESIDENT_USER_SEEDS = RESIDENT_ROTATION_SEED.map((resident, index) => ({
  username: getPlaceholderUsername(index),
  displayName: getPlaceholderName(index)
}));

export function createRotationResidents(): Resident[] {
  return RESIDENT_ROTATION_SEED.map((resident, index) => ({
    id: resident.id,
    username: getPlaceholderUsername(index),
    name: resident.name ?? getPlaceholderName(index),
    aliases: resident.aliases ?? [],
    trainingLevel: resident.trainingLevel,
    serviceTags: [],
    color: resident.color,
    tags: ["rotation-roster"],
    trainingInterests: resident.trainingInterests,
    unavailable: [],
    rotationSchedule: buildRotationSchedule(resident.id, resident.rows)
  }));
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
        startDate: block.startDate,
        endDate: block.endDate,
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
