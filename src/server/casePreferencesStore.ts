import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { preferenceNameKey, PREFERENCE_CATEGORIES, type CasePreferenceCard, type CasePreferenceInput, type PreferenceItem, type PreferenceChange } from "../shared/casePreferences";
import { getDefaultUserStorePath } from "./userStore";

export class CasePreferenceError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export interface CasePreferencesStore {
  list(): Promise<CasePreferenceCard[]>;
  save(input: unknown, expectedRevision: unknown, username: string, id?: string): Promise<CasePreferenceCard>;
  delete(id: string, expectedRevision: unknown): Promise<void>;
}
export function validateCasePreference(input: unknown): CasePreferenceInput {
  const object = record(input);
  const items = array(object.items, "Items", 200).map(readItem);
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length) fail("Item IDs must be unique");
  const contingencies = array(object.contingencies, "Contingencies", 50).map((raw) => {
    const scenario = record(raw);
    const targets = new Set<string>();
    const changes: PreferenceChange[] = array(scenario.changes, "Changes", 200).map((rawChange) => {
      const change = record(rawChange);
      const id = required(change.id, "Change ID", 100);
      if (change.action === "add") {
        const item = readItem(change.item);
        if (ids.has(item.id)) fail("Added item IDs must be unique across the card");
        ids.add(item.id);
        return { id, action: "add", item };
      }
      if (change.action !== "replace" && change.action !== "remove") fail("Unknown contingency action");
      const itemId = required(change.itemId, "Target item", 100);
      if (!items.some((item) => item.id === itemId)) fail("Contingencies must target an existing base item");
      if (targets.has(itemId)) fail("A contingency can change an item only once");
      targets.add(itemId);
      if (change.action === "remove") return { id, action: "remove", itemId };
      return { id, action: "replace", itemId, preferences: preferences(change.preferences), quantity: quantity(change.quantity), notes: optional(change.notes) };
    });
    unique(changes.map((change) => change.id), "Change IDs");
    if (!changes.length) fail("Each contingency needs at least one change");
    return { id: required(scenario.id, "Contingency ID", 100), name: required(scenario.name, "Contingency name"),
      conditions: array(scenario.conditions, "Conditions", 20).filter((condition) => condition !== "").map((condition) => required(condition, "Condition")), changes };
  });
  unique(contingencies.map((scenario) => scenario.id), "Contingency IDs");
  if (!items.length) fail("Add at least one instrument or tray");
  return { id: optional(object.id, 100), isDefault: object.isDefault === true, surgeonName: object.isDefault === true ? "" : required(object.surgeonName, "Surgeon name"),
    procedureName: required(object.procedureName, "Procedure name"), notes: optional(object.notes), items, contingencies };
}
function fail(message: string): never { throw new CasePreferenceError(message); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected a card or item object");
  return value as Record<string, unknown>;
}
function array(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail(`${field} must be a list of at most ${max} entries`);
  return value;
}
function required(value: unknown, field: string, max = 500): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) fail(`${field} is required (maximum ${max} characters)`);
  return value.trim();
}
function optional(value: unknown, max = 3000): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string" || value.length > max) fail(`Text must be at most ${max} characters`);
  return value.trim();
}
function quantity(value: unknown): number {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 100) fail("Quantity must be between 1 and 100");
  return Number(value);
}
function preferences(value: unknown): string[] {
  const result = array(value, "Preferences", 20).map((name) => required(name, "Instrument preference"));
  if (!result.length) fail("A first preference is required");
  return result;
}
function readItem(value: unknown): PreferenceItem {
  const item = record(value);
  if (!PREFERENCE_CATEGORIES.includes(item.category as PreferenceItem["category"])) fail("Unknown item category");
  return { id: required(item.id, "Item ID", 100), category: item.category as PreferenceItem["category"], group: optional(item.group, 100), quantity: quantity(item.quantity), preferences: preferences(item.preferences), notes: optional(item.notes) };
}
function unique(ids: string[], label: string) { if (new Set(ids).size !== ids.length) fail(`${label} must be unique`); }

// Same persistent private directory as user accounts. Serialize read/modify/write,
// publish atomically, and reject stale edits rather than overwriting another user.
export class FileCasePreferencesStore implements CasePreferencesStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath = process.env.CASE_PREFERENCES_PATH || path.join(path.dirname(getDefaultUserStorePath()), "case-preferences.json")) {}
  async list(): Promise<CasePreferenceCard[]> {
    await this.queue;
    return this.read();
  }
  save(input: unknown, expectedRevision: unknown, username: string, id?: string) {
    return this.mutate(async (cards) => {
      const card = validateCasePreference(input);
      const existing = id ? cards.find((candidate) => candidate.id === id) : undefined;
      if (id && !existing) throw new CasePreferenceError("Case card not found", 404);
      if (existing && expectedRevision !== existing.revision) throw new CasePreferenceError("This card was changed by another editor. Your draft is preserved; reload the saved card before retrying.", 409);
      if (cards.some((candidate) => candidate.id !== id && Boolean(candidate.isDefault) === Boolean(card.isDefault) && (card.isDefault || preferenceNameKey(candidate.surgeonName) === preferenceNameKey(card.surgeonName)) && preferenceNameKey(candidate.procedureName) === preferenceNameKey(card.procedureName))) {
        throw new CasePreferenceError(card.isDefault ? "A default card already exists for this procedure" : "This surgeon already has a card for this procedure", 409);
      }
      const saved: CasePreferenceCard = { ...card, id: id ?? crypto.randomUUID(), revision: (existing?.revision ?? 0) + 1, updatedAt: new Date().toISOString(), updatedBy: username };
      if (existing) cards.splice(cards.indexOf(existing), 1, saved); else cards.push(saved);
      return saved;
    });
  }
  delete(id: string, expectedRevision: unknown): Promise<void> {
    return this.mutate(async (cards) => {
      const index = cards.findIndex((card) => card.id === id);
      if (index === -1) throw new CasePreferenceError("Case card not found", 404);
      if (cards[index].revision !== expectedRevision) throw new CasePreferenceError("This card changed. Reload before deleting.", 409);
      cards.splice(index, 1);
    });
  }
  private async read(): Promise<CasePreferenceCard[]> {
    try {
      const data = JSON.parse(await fs.readFile(this.filePath, "utf8"));
      if (data.version !== 1 || !Array.isArray(data.cards)) throw new Error("Invalid case preferences store");
      return data.cards;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }
  private mutate<T>(action: (cards: CasePreferenceCard[]) => Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      const cards = await this.read();
      const result = await action(cards);
      await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
      const temporaryPath = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporaryPath, JSON.stringify({ version: 1, cards }, null, 2) + "\n", { mode: 0o600 });
        await fs.rename(temporaryPath, this.filePath);
      } finally { await fs.unlink(temporaryPath).catch(() => undefined); }
      return result;
    });
    this.queue = pending.then(() => undefined, () => undefined);
    return pending;
  }
}
