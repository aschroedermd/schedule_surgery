import {
  ClaimRequest,
  CollectionName,
  CoverageChangeRequest,
  CoverageEntry,
  PlannerState,
  Role,
  ServicePrivileges,
  SessionUser,
  UserSummary,
  WeekSchedule
} from "../shared/types";

export interface Session extends SessionUser {
  token: string;
}

export interface PasswordChangeResponse extends UserSummary {
  token: string;
}

export interface PasswordChangeSkipResponse {
  token: string;
}

export interface ChatQuota {
  used: number;
  remaining: number;
  limit: number;
  warningThreshold: number;
}

export interface ChatConversationMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatLookup {
  tool: string;
  arguments: Record<string, unknown>;
  result: unknown;
}

export interface ChatResponse extends ChatQuota {
  message: string;
  model: string;
  checkedAt: string;
  dataUpdatedAt: string;
  stateVersion: number;
  lookups: ChatLookup[];
}

export interface ChatStreamMeta extends ChatQuota {
  checkedAt: string;
  dataUpdatedAt: string;
  stateVersion: number;
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ConflictError extends Error {
  constructor(
    message = "Planner changed; refresh and retry",
    readonly currentVersion?: number
  ) {
    super(message);
    this.name = "ConflictError";
  }
}

let expectedStateVersion: number | undefined;

export function setExpectedStateVersion(version: number | undefined) {
  expectedStateVersion = version;
}

export interface UsersResponse {
  users: UserSummary[];
}

export interface PasswordResetResponse extends UsersResponse {
  user: UserSummary;
  temporaryPassword: string;
}

export interface UserCreationResult {
  user: UserSummary;
  temporaryPassword?: string;
}

export interface UserCreateResponse extends UsersResponse, UserCreationResult {}

export interface BulkUserCreateResponse extends UsersResponse {
  created: UserCreationResult[];
}

export async function login(username: string, password: string): Promise<Session> {
  return request<Session>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password })
  });
}

export async function skipPasswordChange(token: string): Promise<PasswordChangeSkipResponse> {
  return request<PasswordChangeSkipResponse>("/api/me/password/skip", {
    method: "POST",
    token
  });
}

export async function fetchSession(token: string): Promise<Omit<Session, "token">> {
  return request<Omit<Session, "token">>("/api/session", { token });
}

export async function fetchState(token: string): Promise<PlannerState> {
  return request<PlannerState>("/api/state", { token });
}

export async function fetchChatQuota(token: string): Promise<ChatQuota> {
  return request<ChatQuota>("/api/chat/quota", { token });
}

export async function sendChatMessage(
  token: string,
  messages: ChatConversationMessage[],
  serviceLine: string
): Promise<ChatResponse> {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    token,
    body: JSON.stringify({ messages, serviceLine })
  });
}

export async function streamChatMessage(
  token: string,
  messages: ChatConversationMessage[],
  serviceLine: string,
  handlers: {
    onDelta: (delta: string) => void;
    onMeta?: (meta: ChatStreamMeta) => void;
    onReset?: () => void;
  },
  signal?: AbortSignal
): Promise<ChatResponse> {
  const response = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ messages, serviceLine }),
    signal
  });
  if (!response.ok) {
    const payload = await readOptionalJson<{ error?: string }>(response);
    if (response.status === 401) throw new UnauthorizedError(payload?.error);
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }
  if (!response.body) throw new Error("The assistant returned an empty response");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed: ChatResponse | undefined;

  function processLine(line: string) {
    const trimmed = line.trim();
    if (!trimmed) return;
    const event = JSON.parse(trimmed) as
      | ({ type: "meta" } & ChatStreamMeta)
      | { type: "delta"; delta: string }
      | { type: "reset" }
      | ({ type: "complete" } & ChatResponse)
      | { type: "error"; error: string };
    if (event.type === "meta") handlers.onMeta?.(event);
    if (event.type === "delta") handlers.onDelta(event.delta);
    if (event.type === "reset") handlers.onReset?.();
    if (event.type === "complete") completed = event;
    if (event.type === "error") throw new Error(event.error);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) processLine(line);
  }
  buffer += decoder.decode();
  if (buffer.trim()) processLine(buffer);
  if (!completed) throw new Error("The assistant response was interrupted");
  return completed;
}

export async function refreshChatLookups(
  token: string,
  serviceLine: string,
  lookups: ChatLookup[]
): Promise<{ lookups: ChatLookup[]; checkedAt: string; dataUpdatedAt: string; stateVersion: number }> {
  return request("/api/chat/lookups/refresh", {
    method: "POST",
    token,
    body: JSON.stringify({
      serviceLine,
      lookups: lookups.map(({ tool, arguments: lookupArguments }) => ({ tool, arguments: lookupArguments }))
    })
  });
}

export async function sendChatFeedback(
  token: string,
  rating: "up" | "down",
  excerpt: string
): Promise<{ ok: true }> {
  return request("/api/chat/feedback", {
    method: "POST",
    token,
    body: JSON.stringify({ rating, excerpt: excerpt.slice(0, 240) })
  });
}

export async function transcribeChatAudio(token: string, data: string, format = "wav"): Promise<{ text: string }> {
  return request<{ text: string }>("/api/chat/transcribe", {
    method: "POST",
    token,
    body: JSON.stringify({ data, format })
  });
}

export async function fetchSchedule(token: string, weekId: string, serviceLine?: string): Promise<WeekSchedule> {
  return request<WeekSchedule>(`/api/weeks/${weekId}/schedule${buildQuery({ service: serviceLine })}`, { token });
}

export async function runSuggestion(token: string, weekId: string, serviceLine?: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/weeks/${weekId}/suggest${buildQuery({ service: serviceLine })}`, {
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

export async function createCoverageEntry(token: string, entry: Partial<CoverageEntry>, serviceLine?: string): Promise<PlannerState> {
  return request<PlannerState>("/api/coverage-entries", {
    method: "POST",
    token,
    body: JSON.stringify({ ...entry, serviceLine })
  });
}

export async function updateCoverageEntry(token: string, id: string, patch: Partial<CoverageEntry>, serviceLine?: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/coverage-entries/${id}`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ ...patch, serviceLine })
  });
}

export async function deleteCoverageEntry(token: string, id: string, serviceLine?: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/coverage-entries/${id}${buildQuery({ service: serviceLine })}`, {
    method: "DELETE",
    token
  });
}

export async function submitCoverageRequest(
  token: string,
  payload: Partial<CoverageChangeRequest>,
  serviceLine?: string
): Promise<PlannerState> {
  return request<PlannerState>("/api/coverage-requests", {
    method: "POST",
    token,
    body: JSON.stringify({ ...payload, serviceLine })
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

export async function deleteCoverageRequest(token: string, id: string): Promise<PlannerState> {
  return request<PlannerState>(`/api/coverage-requests/${id}`, {
    method: "DELETE",
    token
  });
}

export async function claimCoverage(token: string, claim: ClaimRequest): Promise<PlannerState> {
  return request<PlannerState>("/api/claims", {
    method: "POST",
    token,
    body: JSON.stringify(claim)
  });
}

export async function awardGoldStar(token: string, recipientResidentId: string): Promise<PlannerState> {
  return request<PlannerState>("/api/gold-stars", {
    method: "POST",
    token,
    body: JSON.stringify({ recipientResidentId })
  });
}

export async function getUncoveredMessage(token: string, weekId: string, date?: string, serviceLine?: string): Promise<string> {
  const query = buildQuery({ date, service: serviceLine });
  const result = await request<{ message: string }>(`/api/weeks/${weekId}/uncovered-message${query}`, { token });
  return result.message;
}

export async function fetchUsers(token: string): Promise<UserSummary[]> {
  const result = await request<UsersResponse>("/api/users", { token });
  return result.users;
}

export async function createUser(
  token: string,
  payload: {
    username: string;
    displayName?: string;
    role?: Role;
    attendingId?: string;
    password?: string;
    temporaryPassword?: string;
    servicePrivileges?: ServicePrivileges;
  }
): Promise<UserCreateResponse> {
  return request<UserCreateResponse>("/api/users", {
    method: "POST",
    token,
    body: JSON.stringify(payload)
  });
}

export async function createUsers(
  token: string,
  users: Array<{
    username: string;
    displayName?: string;
    role?: Role;
    attendingId?: string;
    password?: string;
    temporaryPassword?: string;
    servicePrivileges?: ServicePrivileges;
  }>
): Promise<BulkUserCreateResponse> {
  return request<BulkUserCreateResponse>("/api/users/bulk", {
    method: "POST",
    token,
    body: JSON.stringify({ users })
  });
}

export async function updateUser(
  token: string,
  username: string,
  patch: { displayName?: string; role?: Role; attendingId?: string; servicePrivileges?: ServicePrivileges }
): Promise<UserSummary[]> {
  const result = await request<UsersResponse>(`/api/users/${encodeURIComponent(username)}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(patch)
  });
  return result.users;
}

export async function deleteUser(token: string, username: string): Promise<UserSummary[]> {
  const result = await request<UsersResponse>(`/api/users/${encodeURIComponent(username)}`, {
    method: "DELETE",
    token
  });
  return result.users;
}

export async function resetUserPassword(token: string, username: string): Promise<PasswordResetResponse> {
  return request<PasswordResetResponse>(`/api/users/${encodeURIComponent(username)}/password`, {
    method: "PATCH",
    token
  });
}

export async function changeMyPassword(token: string, currentPassword: string, nextPassword: string): Promise<PasswordChangeResponse> {
  return request<PasswordChangeResponse>("/api/me/password", {
    method: "PATCH",
    token,
    body: JSON.stringify({ currentPassword, nextPassword })
  });
}

export function subscribeToStateEvents(
  token: string,
  onState: (event: { version: number; updatedAt: string }) => void,
  onUnauthorized: () => void
): () => void {
  const events = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
  events.addEventListener("state", (event) => {
    const parsed = JSON.parse((event as MessageEvent).data) as { version: number; updatedAt: string };
    onState(parsed);
  });
  events.onerror = () => {
    if (events.readyState === EventSource.CLOSED) onUnauthorized();
  };
  return () => events.close();
}

function buildQuery(params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) query.set(key, value);
  }
  const text = query.toString();
  return text ? `?${text}` : "";
}

async function request<T>(url: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (init.token) {
    headers.set("authorization", `Bearer ${init.token}`);
  }
  if (init.method && init.method !== "GET" && expectedStateVersion) {
    headers.set("x-state-version", String(expectedStateVersion));
  }

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (!response.ok) {
    const payload = await readOptionalJson<{ error?: string; currentVersion?: number }>(response);
    if (response.status === 401) {
      throw new UnauthorizedError(payload?.error);
    }
    if (response.status === 409) {
      throw new ConflictError(payload?.error, payload?.currentVersion);
    }
    throw new Error(payload?.error ?? `Request failed: ${response.status}`);
  }

  return readJson<T>(response, url);
}

async function readOptionalJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text().catch(() => "");
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    return undefined;
  }
}

async function readJson<T>(response: Response, url: string): Promise<T> {
  const text = await response.text();
  if (!text.trim()) {
    throw new Error(`Empty response from ${url}`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON response from ${url}`);
  }
}
