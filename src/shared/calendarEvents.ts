import type { ResidencyCalendarEvent } from "./types";

// UTC date arithmetic keeps recurrences stable through daylight saving changes.
export function calendarEventOccursOn(event: ResidencyCalendarEvent, date: string): boolean {
  if (date < event.date) return false;
  const recurrence = event.recurrence;
  if (!recurrence) return date === event.date;
  if (recurrence.untilDate && date > recurrence.untilDate) return false;
  const anchor = new Date(`${event.date}T00:00:00Z`);
  const target = new Date(`${date}T00:00:00Z`);
  const interval = recurrence.interval ?? 1;
  if (recurrence.frequency === "weekly") {
    const days = recurrence.daysOfWeek ?? [anchor.getUTCDay()];
    const anchorSunday = anchor.getTime() - anchor.getUTCDay() * 86_400_000;
    const week = Math.floor((target.getTime() - anchorSunday) / (7 * 86_400_000));
    return week % interval === 0 && days.includes(target.getUTCDay());
  }
  const months = (target.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + target.getUTCMonth() - anchor.getUTCMonth();
  if (months % interval !== 0) return false;
  if (recurrence.weekOfMonth === undefined) return target.getUTCDate() === anchor.getUTCDate();
  const days = recurrence.daysOfWeek ?? [anchor.getUTCDay()];
  if (!days.includes(target.getUTCDay())) return false;
  if (recurrence.weekOfMonth === -1) {
    const nextWeek = new Date(target.getTime() + 7 * 86_400_000);
    return nextWeek.getUTCMonth() !== target.getUTCMonth();
  }
  return Math.ceil(target.getUTCDate() / 7) === recurrence.weekOfMonth;
}

export function createDefaultCalendarEvents(): ResidencyCalendarEvent[] {
  return [{
    id: "calendar_friday_mm",
    title: "Morbidity & mortality conference",
    date: "2026-07-03",
    recurrence: { frequency: "weekly", daysOfWeek: [5] },
    createdAt: "2026-07-03T00:00:00.000Z",
    updatedAt: "2026-07-03T00:00:00.000Z"
  }];
}
