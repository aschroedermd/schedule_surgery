const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) {
    throw new Error(`Invalid time: ${time}`);
  }
  return hours * 60 + minutes;
}

export function minutesToTime(totalMinutes: number): string {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

export function addMinutes(time: string, minutes: number): string {
  return minutesToTime(timeToMinutes(time) + minutes);
}

export function addDays(date: string, days: number): string {
  const parsed = parseLocalDate(date);
  return formatDate(new Date(parsed.getTime() + days * MS_PER_DAY));
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseLocalDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getWeekDates(startDate: string, weekdayOnly = true): string[] {
  const count = weekdayOnly ? 5 : 7;
  return Array.from({ length: count }, (_, index) => addDays(startDate, index));
}

export function displayDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

export function getCurrentMonday(): string {
  const today = new Date();
  return getMondayForDate(formatDate(today));
}

export function getDefaultPlannerMonday(today = new Date()): string {
  const currentMonday = getMondayForDate(formatDate(today));
  const day = today.getDay();
  return day === 0 || day === 6 ? addDays(currentMonday, 7) : currentMonday;
}

export function getMondayForDate(date: string): string {
  const today = parseLocalDate(date);
  const day = today.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return formatDate(new Date(today.getFullYear(), today.getMonth(), today.getDate() + offset));
}
