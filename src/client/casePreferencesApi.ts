import type { CasePreferenceCard, CasePreferenceInput } from "../shared/casePreferences";
async function request<T>(token: string, path = "", method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(`/api/case-preferences${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Unable to load or save case preferences");
  }
  return response.status === 204 ? undefined as T : response.json();
}
export async function fetchCasePreferenceCards(token: string) { return (await request<{ cards: CasePreferenceCard[] }>(token)).cards; }
export async function saveCasePreferenceCard(token: string, card: CasePreferenceInput, revision?: number) {
  return (await request<{ card: CasePreferenceCard }>(token, card.id ? `/${encodeURIComponent(card.id)}` : "", card.id ? "PUT" : "POST", { card, expectedRevision: revision })).card;
}
export function deleteCasePreferenceCard(token: string, card: CasePreferenceCard) { return request<void>(token, `/${encodeURIComponent(card.id)}`, "DELETE", { expectedRevision: card.revision }); }
