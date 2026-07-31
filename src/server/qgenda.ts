import { formatDate, parseLocalDate } from "../shared/date";
import { createId } from "../shared/id";
import {
  Attending,
  AttendingCoverageAssignment,
  AttendingCoverageLine,
  AttendingCoverageRole,
  AttendingCoverageShift,
  PlannerState
} from "../shared/types";
import { StateConflictError, StateStore } from "./store";

const DEFAULT_PUBLIC_LINK_URL = "https://app.qgenda.com/Link/view?linkKey=d70363fd-a304-4054-af95-a957a57f1145";

const DEFAULT_PUBLIC_TASK_MAP: Record<string, QgendaTaskMapping> = {
  "f1a142ee-6324-48f0-8e83-79ed03af7018": { line: "EGS", shift: "day", role: "primary" },
  "b8285b23-9888-49e9-b47f-60d557ad8eef": { line: "Trauma", shift: "day", role: "primary" },
  "c8e3ca5b-aca2-4889-9a9b-2e6b8cce8f39": { line: "SCC", shift: "day", role: "primary" },
  "288f61d6-90af-413b-88e1-befd6e4044b7": { line: "ACS", shift: "night", role: "primary" },
  "923f2f6a-c740-4dcf-9043-970b41eb5729": { line: "ACS", shift: "night", role: "primary" },
  "dd48d80c-216d-4601-bd87-8731107babd6": { line: "ACS", shift: "night", role: "primary" },
  "6a215514-c3d1-4439-a1a0-532952c0cdd9": { line: "ACS", shift: "day", role: "backup" },
  "f1adea56-a594-44be-958e-0155c123b951": { line: "ACS", shift: "night", role: "backup" }
};

const DEFAULT_PUBLIC_STAFF: Record<string, string> = {
  "7e62880a-741c-4972-8a11-c6761de7d51f": "K. Bower",
  "78f97eb3-2652-43d9-bb3c-b5a09ba61449": "Collier",
  "69b15d44-c2f8-4d74-b2a8-7473f76140b9": "Collins",
  "a37cb365-0006-4573-a060-84d1327b6bd2": "Cragun",
  "2f71fc37-2c25-4274-8c99-d85267f1f7fd": "Faulks",
  "8644c3be-c0f0-41b4-acb3-e87c96e95db6": "Gerrish",
  "a12bcdd3-0177-4d9a-9a13-554ca83098a6": "Gillen",
  "c7ae6981-57df-4fe6-89ac-b53a77b056cd": "Harnois",
  "cced347d-309e-4ca2-bd17-3274469e5cd1": "Katz",
  "ff596aa0-125c-4dd5-a337-87756ff98168": "Lollar",
  "f515c57d-c0bd-4180-8eda-2550ae1ab96d": "Nussbaum",
  "003afb08-fc4a-4765-9ca8-43d9941705af": "Paget",
  "c8134b11-7a4b-4003-869f-1224b090568d": "Rudderow",
  "d58329b8-e458-4d96-a7d0-fa3dbd928802": "Smith",
  "939035e0-180c-49eb-9fb6-b5ab575e274e": "Stodghill",
  "b13f91fa-9202-46d7-85e3-f092e60a11e4": "Wattsman",
  "1132f9a1-f7c0-415a-8ca8-d087b3fa509e": "Williams"
};

export interface QgendaTaskMapping {
  line: AttendingCoverageLine;
  shift: AttendingCoverageShift;
  role: AttendingCoverageRole;
}

interface PublicPageSettings {
  linkKey: string;
  companyKey: string;
}

export interface QgendaPublicScheduleItem {
  scheduleEntryKey?: string;
  displayKey?: string;
  date?: string;
  taskKey?: string;
  staffMemberKey?: string;
  isStruck?: boolean;
}

interface QgendaPublicResponse {
  items?: QgendaPublicScheduleItem[];
}

export interface QgendaSyncResult {
  state: PlannerState;
  changedCount: number;
  importedCount: number;
  skippedCount: number;
  windowStart: string;
  windowEnd: string;
}

export function isQgendaSyncConfigured(): boolean {
  return process.env.QGENDA_SYNC_ENABLED !== "false" && Boolean(process.env.QGENDA_PUBLIC_LINK_URL || DEFAULT_PUBLIC_LINK_URL);
}

export async function syncQgenda(store: StateStore, now = new Date()): Promise<QgendaSyncResult> {
  const attemptedAt = now.toISOString();
  const window = getSyncWindow(now);
  try {
    const remote = await fetchPublishedSchedule(window.start, window.end);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const state = await store.load();
      const merged = mergePublishedSchedule(state, remote, window.start, window.end, attemptedAt);
      try {
        const saved = await store.save(merged.state, { expectedVersion: state.version });
        return { ...merged, state: saved, windowStart: window.start, windowEnd: window.end };
      } catch (error) {
        if (!(error instanceof StateConflictError) || attempt === 2) throw error;
      }
    }
    throw new Error("Unable to save QGenda schedule after concurrent updates");
  } catch (error) {
    await saveSyncFailure(store, attemptedAt, window.start, window.end, error);
    throw error;
  }
}

export function mergePublishedSchedule(
  state: PlannerState,
  items: QgendaPublicScheduleItem[],
  windowStart: string,
  windowEnd: string,
  syncedAt = new Date().toISOString()
): Omit<QgendaSyncResult, "windowStart" | "windowEnd"> {
  const taskMap = getPublicTaskMap();
  const staffNames = getPublicStaffMap();
  const attendings: Attending[] = state.attendings.map((attending) => ({
    ...attending,
    aliases: attending.aliases ? [...attending.aliases] : undefined,
    coverageLines: attending.coverageLines ? [...attending.coverageLines] : undefined
  }));
  const attendingByStaffId = new Map(
    attendings.filter((attending) => attending.qgendaStaffId).map((attending) => [attending.qgendaStaffId!, attending])
  );
  let skippedCount = 0;
  const candidates: AttendingCoverageAssignment[] = [];

  for (const item of items) {
    if (item.isStruck) continue;
    const date = normalizeDate(item.date);
    const mapping = item.taskKey ? taskMap[item.taskKey] : undefined;
    if (!date || date < windowStart || date > windowEnd || !mapping || !item.staffMemberKey) continue;
    let attending = attendingByStaffId.get(item.staffMemberKey);
    if (!attending) {
      const knownName = staffNames[item.staffMemberKey];
      attending = knownName ? findAttendingByName(attendings, knownName) : undefined;
      if (attending) {
        attending.qgendaStaffId = item.staffMemberKey;
        attending.coverageLines = uniqueCoverageLines([...(attending.coverageLines ?? []), mapping.line]);
      } else if (knownName) {
        attending = createImportedAttending(knownName, item.staffMemberKey, mapping.line);
        attendings.push(attending);
      }
      if (attending) attendingByStaffId.set(item.staffMemberKey, attending);
    }
    if (!attending) {
      skippedCount += 1;
      continue;
    }
    attending.coverageLines = uniqueCoverageLines([...(attending.coverageLines ?? []), mapping.line]);
    candidates.push({
      id: `attcov_qg_${item.scheduleEntryKey || item.displayKey || createId("entry")}`,
      date,
      ...mapping,
      attendingId: attending.id,
      source: "qgenda",
      externalId: item.scheduleEntryKey || item.displayKey,
      note: "",
      createdAt: syncedAt,
      updatedAt: syncedAt
    });
  }

  const imported = preserveUnchangedAssignments(
    collapseAcsNightAssignments(candidates),
    state.attendingCoverageAssignments
  );
  const managedSlots = new Set(Object.values(taskMap).map(assignmentSlotWithoutDate));
  const preserved = state.attendingCoverageAssignments.filter(
    (assignment) =>
      assignment.date < windowStart ||
      assignment.date > windowEnd ||
      !managedSlots.has(assignmentSlotWithoutDate(assignment))
  );
  const nextAssignments = [...preserved, ...imported].sort(compareAssignments);
  const changedCount = countAssignmentChanges(state.attendingCoverageAssignments, nextAssignments);
  return {
    state: {
      ...state,
      attendings,
      attendingCoverageAssignments: nextAssignments,
      qgendaSync: {
        enabled: true,
        lastAttemptAt: syncedAt,
        lastSuccessAt: syncedAt,
        lastChangedCount: changedCount,
        lastImportedCount: imported.length,
        skippedCount,
        windowStart,
        windowEnd
      }
    },
    changedCount,
    importedCount: imported.length,
    skippedCount
  };
}

async function fetchPublishedSchedule(startDate: string, endDate: string): Promise<QgendaPublicScheduleItem[]> {
  const publicUrl = process.env.QGENDA_PUBLIC_LINK_URL || DEFAULT_PUBLIC_LINK_URL;
  const landing = await fetch(publicUrl, { headers: { accept: "text/html" } });
  if (!landing.ok) throw new Error(`QGenda published schedule returned ${landing.status}`);
  const html = await landing.text();
  const token = readHtmlValue(html, "RequestVerificationToken");
  const settings = readBundleSettings(html);
  const cookies = readResponseCookies(landing);
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
    pragma: "no-cache",
    "x-requested-with": "XMLHttpRequest",
    "x-qgenda-companykey": settings.pageSettings.companyKey,
    "x-qgenda-quicklinkkey": settings.pageSettings.linkKey,
    requestverificationtoken: token
  };
  if (cookies) headers.cookie = cookies;

  const monthStarts = getMonthStarts(startDate, endDate);
  const responses = await Promise.all(
    monthStarts.map(async (monthStart) => {
      const response = await fetch(
        `https://app.qgenda.com/Link/${encodeURIComponent(settings.pageSettings.linkKey)}/ScheduleView/GetQuickLinkScheduleDisplayItems`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            ...settings.calendarOptions,
            companyKey: settings.pageSettings.companyKey,
            linkAccessKey: null,
            includePublishedOpens: false,
            startDate: `${monthStart}T00:00:00`,
            timeRangeUnitType: 2,
            rangeValue: 1,
            scheduleViewType: 1,
            selectedTimeZoneId: "Eastern Standard Time"
          })
        }
      );
      if (!response.ok) throw new Error(`QGenda schedule feed returned ${response.status}`);
      return (await response.json()) as QgendaPublicResponse;
    })
  );
  return responses.flatMap((response) => response.items ?? []);
}

function readBundleSettings(html: string): { pageSettings: PublicPageSettings; calendarOptions: Record<string, unknown> } {
  const match = html.match(/<div id="react-app"[^>]*data-bundle-settings="([^"]+)"/i);
  if (!match) throw new Error("QGenda published schedule settings were not found");
  const decoded = decodeHtml(match[1]);
  const parsed = JSON.parse(decoded) as { pageSettings?: PublicPageSettings; calendarOptions?: Record<string, unknown> };
  if (!parsed.pageSettings?.linkKey || !parsed.pageSettings.companyKey) {
    throw new Error("QGenda published schedule is missing its link or company identifier");
  }
  return { pageSettings: parsed.pageSettings, calendarOptions: parsed.calendarOptions ?? {} };
}

function readHtmlValue(html: string, id: string): string {
  const pattern = new RegExp(`<input[^>]*id=["']${id}["'][^>]*value=["']([^"']+)["']`, "i");
  const match = html.match(pattern);
  if (!match) throw new Error(`QGenda ${id} was not found`);
  return decodeHtml(match[1]);
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

function readResponseCookies(response: Response): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? (headers.get("set-cookie") ? [headers.get("set-cookie")!] : []);
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function getSyncWindow(now: Date): { start: string; end: string } {
  const today = formatDate(now);
  const pastMonths = readNonNegativeInteger(process.env.QGENDA_SYNC_MONTHS_PAST, 1);
  const futureMonths = readNonNegativeInteger(process.env.QGENDA_SYNC_MONTHS_FUTURE, 3);
  const current = parseLocalDate(`${today.slice(0, 7)}-01`);
  const start = new Date(current.getFullYear(), current.getMonth() - pastMonths, 1);
  const end = new Date(current.getFullYear(), current.getMonth() + futureMonths + 1, 0);
  return { start: formatDate(start), end: formatDate(end) };
}

function getMonthStarts(startDate: string, endDate: string): string[] {
  const starts: string[] = [];
  const start = parseLocalDate(`${startDate.slice(0, 7)}-01`);
  const end = parseLocalDate(`${endDate.slice(0, 7)}-01`);
  for (let cursor = start; cursor <= end; cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)) {
    starts.push(formatDate(cursor));
  }
  return starts;
}

function normalizeDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const iso = value.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const us = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!us) return undefined;
  return `${us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
}

function collapseAcsNightAssignments(assignments: AttendingCoverageAssignment[]): AttendingCoverageAssignment[] {
  const bySlot = new Map<string, AttendingCoverageAssignment[]>();
  for (const assignment of assignments) {
    const key = `${assignment.date}:${assignmentSlotWithoutDate(assignment)}`;
    bySlot.set(key, [...(bySlot.get(key) ?? []), assignment]);
  }
  return [...bySlot.entries()].map(([slot, grouped]) => {
    const attendingIds = new Set(grouped.map((assignment) => assignment.attendingId));
    if (attendingIds.size > 1) {
      throw new Error(`QGenda has conflicting attendings for ${slot}; no schedule changes were applied`);
    }
    return grouped[0];
  });
}

function preserveUnchangedAssignments(
  imported: AttendingCoverageAssignment[],
  existing: AttendingCoverageAssignment[]
): AttendingCoverageAssignment[] {
  const existingBySignature = new Map(
    existing
      .filter((assignment) => assignment.source === "qgenda")
      .map((assignment) => [assignmentSignature(assignment), assignment])
  );
  return imported.map((assignment) => existingBySignature.get(assignmentSignature(assignment)) ?? assignment);
}

function createImportedAttending(name: string, qgendaStaffId: string, line: AttendingCoverageLine): Attending {
  return {
    id: createId("att"),
    name: name.includes(" ") ? name : `Dr. ${name}`,
    service: "Davies",
    coverageLines: uniqueCoverageLines([line]),
    qgendaStaffId,
    priority: 3
  };
}

function findAttendingByName(attendings: Attending[], qgendaName: string): Attending | undefined {
  const target = normalizeName(qgendaName);
  const targetLast = normalizeName(qgendaName.split(/\s+/).at(-1) ?? qgendaName);
  return attendings.find((attending) => {
    const candidates = [attending.name, ...(attending.aliases ?? [])];
    return candidates.some((name) => {
      const normalized = normalizeName(name);
      return normalized === target || normalized.endsWith(targetLast);
    });
  });
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/^dr\.?\s*/, "").replace(/[^a-z0-9]/g, "");
}

function uniqueCoverageLines(lines: AttendingCoverageLine[]): AttendingCoverageLine[] {
  return [...new Set(lines)];
}

function assignmentSlotWithoutDate(assignment: Pick<AttendingCoverageAssignment, "line" | "shift" | "role"> | QgendaTaskMapping): string {
  return `${assignment.line}:${assignment.shift}:${assignment.role}`;
}

function compareAssignments(a: AttendingCoverageAssignment, b: AttendingCoverageAssignment): number {
  return a.date.localeCompare(b.date) || assignmentSlotWithoutDate(a).localeCompare(assignmentSlotWithoutDate(b)) || a.id.localeCompare(b.id);
}

function countAssignmentChanges(before: AttendingCoverageAssignment[], after: AttendingCoverageAssignment[]): number {
  const beforeSet = new Set(before.map(assignmentSignature));
  const afterSet = new Set(after.map(assignmentSignature));
  return [...beforeSet].filter((value) => !afterSet.has(value)).length + [...afterSet].filter((value) => !beforeSet.has(value)).length;
}

function assignmentSignature(assignment: AttendingCoverageAssignment): string {
  return `${assignment.date}:${assignmentSlotWithoutDate(assignment)}:${assignment.attendingId}:${assignment.source}`;
}

function getPublicTaskMap(): Record<string, QgendaTaskMapping> {
  return { ...DEFAULT_PUBLIC_TASK_MAP, ...readJsonObject<QgendaTaskMapping>(process.env.QGENDA_PUBLIC_TASK_MAP_JSON) };
}

function getPublicStaffMap(): Record<string, string> {
  return { ...DEFAULT_PUBLIC_STAFF, ...readJsonObject<string>(process.env.QGENDA_PUBLIC_STAFF_MAP_JSON) };
}

function readJsonObject<T>(value: string | undefined): Record<string, T> {
  if (!value) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("QGenda mapping JSON must be an object");
  return parsed as Record<string, T>;
}

function readNonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

async function saveSyncFailure(store: StateStore, attemptedAt: string, windowStart: string, windowEnd: string, error: unknown): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const state = await store.load();
      await store.save(
        {
          ...state,
          qgendaSync: {
            ...state.qgendaSync,
            enabled: true,
            lastAttemptAt: attemptedAt,
            lastError: error instanceof Error ? error.message : "QGenda sync failed",
            windowStart,
            windowEnd
          }
        },
        { expectedVersion: state.version }
      );
      return;
    } catch (saveError) {
      if (!(saveError instanceof StateConflictError) || attempt === 2) return;
    }
  }
}
