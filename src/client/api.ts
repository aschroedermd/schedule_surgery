import {
  ClaimRequest,
  CollectionName,
  CoverageChangeRequest,
  CoverageEntry,
  PlannerState,
  Role,
  WeekSchedule
} from "../shared/types";

export interface Session {
  token: string;
  role: Role;
}

export async function login(role: Role, password: string): Promise<Session> {
  return request<Session>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ role, password })
  });
}

export async function fetchState(token: string): Promise<PlannerState> {
  return request<PlannerState>("/api/state", { token });
}

export async function fetchSchedule(token: string, weekId: string): Promise<WeekSchedule> {
  return request<WeekSchedule>(`/api/weeks/${weekId}/schedule`, { token });
}

export async function runSuggestion(token: string, weekId: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/weeks/${weekId}/suggest`, {
    method: "POST",
    token
  });
}

export async function createEntity<T>(token: string, collection: CollectionName, entity: T): Promise<PlannerState> {
  return request<PlannerState>(`/api/entities/${collection}`, {
    method: "POST",
    token,
    body: JSON.stringify(entity)
  });
}

export async function updateEntity<T>(token: string, collection: CollectionName, id: string, patch: Partial<T>): Promise<PlannerState> {
  return request<PlannerState>(`/api/entities/${collection}/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(patch)
  });
}

export async function deleteEntity(token: string, collection: CollectionName, id: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/entities/${collection}/${id}`, {
    method: "DELETE",
    token
  });
}

export async function createAssignment(
  token: string,
  payload: { kind: "case" | "block" | "clinic"; targetId: string; residentId: string; locked?: boolean }
): Promise<PlannerState> {
  return request<PlannerState>("/api/assignments", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function updateAssignment(token: string, id: string, patch: Record<string, unknown>): Promise<PlannerState> {
  return request<PlannerState>(`/api/assignments/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(patch)
  });
}

export async function deleteAssignment(token: string, id: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/assignments/${id}`, {
    method: "DELETE",
    token
  });
}

export async function createCoverageEntry(token: string, entry: Partial<CoverageEntry>): Promise<PlannerState> {
  return request<PlannerState>("/api/coverage-entries", {
    method: "POST",
    token,
    body: JSON.stringify(entry)
  });
}

export async function updateCoverageEntry(token: string, id: string, patch: Partial<CoverageEntry>): Promise<PlannerState> {
  return request<PlannerState>(`/api/coverage-entries/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(patch)
  });
}

export async function deleteCoverageEntry(token: string, id: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/coverage-entries/${id}`, {
    method: "DELETE",
    token
  });
}

export async function submitCoverageRequest(token: string, payload: Partial<CoverageChangeRequest>): Promise<PlannerState> {
  return request<PlannerState>("/api/coverage-requests", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function approveCoverageRequest(token: string, id: string, adminNote?: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/coverage-requests/${id}/approve`, {
    method: "POST",
    token,
    body: JSON.stringify({ adminNote })
  });
}

export async function denyCoverageRequest(token: string, id: string, adminNote?: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/coverage-requests/${id}/deny`, {
    method: "POST",
    token,
    body: JSON.stringify({ adminNote })
  });
}

export async function claimCoverage(token: string, claim: ClaimRequest): Promise<PlannerState> {
  return request<PlannerState>("/api/claims", {
    method: "POST",
    token,
    body: JSON.stringify(claim)
  });
}

export async function getUncoveredMessage(token: string, weekId: string, date?: string): Promise<string> {
  const query = date ? `?date=${encodeURIComponent(date)}` : "";
  const result = await request<{ message: string }>(`/api/weeks/${weekId}/uncovered-message${query}`, { token });
  return result.message;
}

async function request<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => undefined)) as { error?: string } | undefined;
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}
