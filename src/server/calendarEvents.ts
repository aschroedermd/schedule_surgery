import { createId } from "../shared/id";
import type { ResidencyCalendarEvent } from "../shared/types";

export class CalendarEventValidationError extends Error {}

export function assertCalendarDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new CalendarEventValidationError(`${field} must be YYYY-MM-DD`);
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new CalendarEventValidationError(`Invalid ${field}`);
  return value;
}

function optionalText(value: unknown, field: string, maxLength = 2000): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || value.trim().length > maxLength) throw new CalendarEventValidationError(`Invalid ${field}`);
  return value.trim() || undefined;
}

export function buildCalendarEvent(input: unknown, existing?: ResidencyCalendarEvent): ResidencyCalendarEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new CalendarEventValidationError("Expected a calendar event object");
  const patch = input as Record<string, unknown>;
  const fields = new Set(["id", "title", "date", "startTime", "endTime", "location", "meetingUrl", "description", "recurrence"]);
  for (const key of Object.keys(patch)) if (!fields.has(key)) throw new CalendarEventValidationError(`Unknown calendar event field: ${key}`);
  if (existing && patch.id !== undefined && patch.id !== existing.id) throw new CalendarEventValidationError("An event id cannot be changed");
  const data = { ...existing, ...patch };
  const title = optionalText(data.title, "title", 200);
  if (!title) throw new CalendarEventValidationError("title is required");
  const date = assertCalendarDate(data.date, "date");
  const startTime = optionalText(data.startTime, "startTime", 5);
  const endTime = optionalText(data.endTime, "endTime", 5);
  for (const time of [startTime, endTime]) if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new CalendarEventValidationError("Times must be HH:mm");
  if (endTime && !startTime) throw new CalendarEventValidationError("endTime requires startTime");
  if (startTime && endTime && endTime <= startTime) throw new CalendarEventValidationError("endTime must be after startTime on the same day");
  const meetingUrl = optionalText(data.meetingUrl, "meetingUrl", 8000);
  if (meetingUrl) {
    if (/\s/.test(meetingUrl)) throw new CalendarEventValidationError("meetingUrl cannot contain whitespace");
    let url: URL;
    try { url = new URL(meetingUrl); } catch { throw new CalendarEventValidationError("Invalid meetingUrl"); }
    if (url.protocol !== "https:" || url.username || url.password) throw new CalendarEventValidationError("meetingUrl must be an HTTPS URL without credentials");
  }
  let recurrence: ResidencyCalendarEvent["recurrence"];
  if (data.recurrence != null) {
    if (typeof data.recurrence !== "object" || Array.isArray(data.recurrence)) throw new CalendarEventValidationError("Invalid recurrence");
    const rule = data.recurrence as Record<string, unknown>;
    for (const key of Object.keys(rule)) if (!["frequency", "interval", "daysOfWeek", "weekOfMonth", "untilDate"].includes(key)) throw new CalendarEventValidationError(`Unknown recurrence field: ${key}`);
    if (rule.frequency !== "weekly" && rule.frequency !== "monthly") throw new CalendarEventValidationError("recurrence.frequency must be weekly or monthly");
    const interval = rule.interval ?? 1;
    if (typeof interval !== "number" || !Number.isInteger(interval) || interval < 1 || interval > 52) throw new CalendarEventValidationError("recurrence.interval must be 1–52");
    let daysOfWeek: number[] | undefined;
    if (rule.daysOfWeek !== undefined) {
      if (!Array.isArray(rule.daysOfWeek) || !rule.daysOfWeek.length || rule.daysOfWeek.some(day => !Number.isInteger(day) || day < 0 || day > 6)) throw new CalendarEventValidationError("daysOfWeek must contain weekdays 0 (Sunday) through 6 (Saturday)");
      daysOfWeek = [...new Set(rule.daysOfWeek)] as number[];
    }
    const weekOfMonth = rule.weekOfMonth;
    if (weekOfMonth !== undefined && (rule.frequency !== "monthly" || typeof weekOfMonth !== "number" || ![-1, 1, 2, 3, 4, 5].includes(weekOfMonth))) throw new CalendarEventValidationError("weekOfMonth requires monthly recurrence and must be 1–5 or -1 (last)");
    if (rule.frequency === "monthly" && daysOfWeek && weekOfMonth === undefined) throw new CalendarEventValidationError("Monthly daysOfWeek requires weekOfMonth");
    const untilDate = rule.untilDate == null ? undefined : assertCalendarDate(rule.untilDate, "untilDate");
    if (untilDate && untilDate < date) throw new CalendarEventValidationError("untilDate cannot precede date");
    recurrence = { frequency: rule.frequency, interval, daysOfWeek, weekOfMonth: weekOfMonth as number | undefined, untilDate };
  }
  const now = new Date().toISOString();
  return {
    id: existing?.id ?? optionalText(data.id, "id", 200) ?? createId("calendar"),
    title, date, startTime, endTime, meetingUrl,
    location: optionalText(data.location, "location", 500),
    description: optionalText(data.description, "description", 10000),
    recurrence, createdAt: existing?.createdAt ?? now, updatedAt: now
  };
}
