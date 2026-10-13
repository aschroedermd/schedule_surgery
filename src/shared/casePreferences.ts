import type { SessionUser } from "./types";

export type CasePreferencesAccess = "none" | "view" | "edit";
export const PREFERENCE_CATEGORIES = ["tray", "scope", "disposable", "other"] as const;
export type PreferenceCategory = typeof PREFERENCE_CATEGORIES[number];
export const PREFERENCE_CATEGORY_LABELS: Record<PreferenceCategory, string> = {
  tray: "Surgical trays", scope: "Scope", disposable: "Disposable instruments", other: "Other equipment"
};
export interface PreferenceItem {
  id: string;
  category: PreferenceCategory;
  group?: string;
  quantity: number;
  preferences: string[];
  notes: string;
}
export type PreferenceChange =
  | { id: string; action: "remove"; itemId: string }
  | { id: string; action: "replace"; itemId: string; preferences: string[]; quantity: number; notes: string }
  | { id: string; action: "add"; item: PreferenceItem };
export interface CaseContingency {
  id: string;
  name: string;
  conditions: string[];
  changes: PreferenceChange[];
}
export interface CasePreferenceCard {
  id: string;
  surgeonName: string;
  isDefault?: boolean;
  procedureName: string;
  notes: string;
  items: PreferenceItem[];
  contingencies: CaseContingency[];
  revision: number;
  updatedAt: string;
  updatedBy: string;
}
export type CasePreferenceInput = Omit<CasePreferenceCard, "revision" | "updatedAt" | "updatedBy">;
export function casePreferencesAccess(user: Pick<SessionUser, "role" | "casePreferencesAccess"> | undefined): CasePreferencesAccess {
  return user?.role === "admin" ? "edit" : user?.casePreferencesAccess ?? "none";
}
export function normalizeCasePreferencesAccess(value: unknown): CasePreferencesAccess {
  return value === "view" || value === "edit" ? value : "none";
}
export interface ResolvedPreferenceItem extends PreferenceItem {
  status: "unchanged" | "replaced" | "added" | "removed" | "conflict";
  original?: PreferenceItem;
  sources: string[];
}
// Selections are explicit, case-specific scenarios. Never infer patient facts.
// Overlapping changes have no implicit priority and must be resolved by the user.
export function resolveCasePreferences(card: CasePreferenceInput, selectedIds: string[]) {
  const selected = card.contingencies.filter((scenario) => selectedIds.includes(scenario.id));
  const rows: ResolvedPreferenceItem[] = card.items.map((item) => {
    const changes = selected.flatMap((scenario) => scenario.changes
      .filter((change) => change.action !== "add" && change.itemId === item.id)
      .map((change) => ({ change, source: scenario.name })));
    const sources = changes.map(({ source }) => source);
    if (changes.length > 1) return { ...item, status: "conflict", sources };
    const change = changes[0]?.change;
    if (!change || change.action === "add") return { ...item, status: "unchanged", sources: [] };
    if (change.action === "remove") return { ...item, status: "removed", original: item, sources };
    return { ...item, preferences: change.preferences, quantity: change.quantity, notes: change.notes, status: "replaced", original: item, sources };
  });
  for (const scenario of selected) for (const change of scenario.changes) {
    if (change.action === "add") rows.push({ ...change.item, status: "added", sources: [scenario.name] });
  }
  return { rows, conflicts: rows.filter((row) => row.status === "conflict") };
}

export function rudderowExample(): CasePreferenceInput {
  return {
    id: "", surgeonName: "Dr. John Rudderow", procedureName: "Laparoscopic appendectomy",
    notes: "Example supplied by the user. Review and confirm before saving for use.",
    items: [
      { id: "tray", category: "tray", quantity: 1, preferences: ["Laparoscopic tray"], notes: "" },
      { id: "scope", category: "scope", quantity: 1, preferences: ["5 mm, 30° scope"], notes: "" },
      { id: "entry", category: "disposable", group: "Laparoscopic trocars", quantity: 1, preferences: ["12 mm OptiView trocar"], notes: "" },
      { id: "balloon", category: "disposable", group: "Laparoscopic trocars", quantity: 1, preferences: ["5 mm balloon trocar"], notes: "" },
      { id: "optiview5", category: "disposable", group: "Laparoscopic trocars", quantity: 1, preferences: ["5 mm OptiView trocar"], notes: "" },
      { id: "energy", category: "disposable", quantity: 1, preferences: ["Maryland-tip LigaSure"], notes: "" },
      { id: "stapler", category: "disposable", quantity: 1, preferences: ["60 mm laparoscopic stapler with blue-load staple cartridge"], notes: "" },
      { id: "closure", category: "disposable", group: "Closure", quantity: 1, preferences: ["Carter Thompson suture passer with 0 Vicryl", "M-CLOSE with 0 Vicryl"], notes: "" },
      { id: "skin-suture", category: "disposable", group: "Closure", quantity: 1, preferences: ["4-0 Vicryl"], notes: "" },
      { id: "skin-glue", category: "disposable", group: "Closure", quantity: 1, preferences: ["Dermabond glue"], notes: "" }
    ],
    contingencies: [{ id: "bypass", name: "Roux-en-Y gastric bypass + BMI < 40", conditions: ["Roux-en-Y gastric bypass", "BMI less than 40"], changes: [
      { id: "port", action: "replace", itemId: "entry", quantity: 1, preferences: ["12 mm Hasson port"], notes: "" },
      { id: "no-closure", action: "remove", itemId: "closure" }
    ] }]
  };
}

export function preferenceNameKey(name: string): string {
  return name.trim().replace(/^dr\.?\s+/i, "").replace(/\s+/g, " ").toLowerCase();
}
export interface LibraryCaseCard {
  key: string;
  card: CasePreferenceCard;
  source: CasePreferenceCard;
  inherited: boolean;
}
export function casePreferenceLibrary(cards: CasePreferenceCard[], surgeons: string[]): LibraryCaseCard[] {
  const names = new Map<string, string>();
  for (const name of [...cards.filter((card) => !card.isDefault).map((card) => card.surgeonName), ...surgeons]) {
    if (name.trim() && !names.has(preferenceNameKey(name))) names.set(preferenceNameKey(name), name);
  }
  const library: LibraryCaseCard[] = cards.map((card) => ({ key: card.id, card: card.isDefault ? { ...card, surgeonName: "Procedure default" } : card, source: card, inherited: false }));
  for (const fallback of cards.filter((card) => card.isDefault)) for (const [key, name] of names) {
    if (cards.some((card) => !card.isDefault && preferenceNameKey(card.surgeonName) === key && preferenceNameKey(card.procedureName) === preferenceNameKey(fallback.procedureName))) continue;
    library.push({ key: `${fallback.id}::${key}`, card: { ...fallback, surgeonName: name }, source: fallback, inherited: true });
  }
  return library;
}
export function casePreferenceTemplate(kind: "empty" | "open" | "laparoscopic"): CasePreferenceInput {
  const item = (id: string, category: PreferenceCategory, name: string, group = ""): PreferenceItem => ({ id, category, group, quantity: 1, preferences: [name], notes: "" });
  return { id: "", surgeonName: "", procedureName: "", notes: "", contingencies: [], isDefault: false,
    items: kind === "empty" ? [] : kind === "open" ? [item("tray", "tray", "Open tray"), item("instrument", "disposable", ""), item("closure", "disposable", "", "Closure")] : [
      item("tray", "tray", "Laparoscopic tray"), item("scope", "scope", ""), item("trocar", "disposable", "", "Laparoscopic trocars"), item("closure", "disposable", "", "Closure")
    ] };
}

export function matchesCasePreferenceQuery(card: Pick<CasePreferenceInput, "surgeonName" | "procedureName">, query: string): boolean {
  const text = `${card.surgeonName} ${card.procedureName}`.toLowerCase();
  return query.toLowerCase().trim().split(/\s+/).every((word) => text.includes(word));
}
