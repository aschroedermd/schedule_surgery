import { PlannerState } from "../shared/types";
import { isQgendaSyncConfigured, syncQgenda } from "./qgenda";
import { StateStore } from "./store";

export function startQgendaScheduler(store: StateStore, onSaved?: (state: PlannerState) => void): () => void {
  if (!isQgendaSyncConfigured()) return () => undefined;
  const timeZone = process.env.QGENDA_SYNC_TIME_ZONE || "America/New_York";
  let lastRunDate = "";
  let running = false;

  async function runIfDue(force = false) {
    if (running) return;
    const now = new Date();
    const local = getLocalClock(now, timeZone);
    if (!force && (local.hour !== "03" || Number(local.minute) >= 10 || lastRunDate === local.date)) return;
    running = true;
    lastRunDate = local.date;
    try {
      const result = await syncQgenda(store, now);
      onSaved?.(result.state);
      console.log(`QGenda sync complete: ${result.importedCount} assignments, ${result.changedCount} changes`);
    } catch (error) {
      console.error("QGenda sync failed", error);
    } finally {
      running = false;
    }
  }

  const interval = setInterval(() => void runIfDue(), 60_000);
  interval.unref();
  if (process.env.QGENDA_SYNC_ON_START !== "false") void runIfDue(true);
  return () => clearInterval(interval);
}

function getLocalClock(now: Date, timeZone: string): { date: string; hour: string; minute: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, minute: parts.minute };
}
