import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, displayDate } from "../shared/date";
import { buildDailyGrandView } from "../shared/dailyGrand";
import type { PlannerState } from "../shared/types";

export function DailyGrandView({ state, initialDate }: { state: PlannerState; initialDate: string }) {
  const [date, setDate] = useState(initialDate);
  const entries = useMemo(() => buildDailyGrandView(state, date), [state, date]);
  const groups = [...new Set(["RMH", "FMH", "CCASE", "Clinic", ...entries.map(entry => entry.group)])];
  const uncovered = entries.flatMap(entry => entry.coverage).filter(item => !item.residentNames.length).length;
  return <section className="daily-grand" aria-label="Daily grand view">
    <header className="grand-header">
      <div><span className="grand-eyebrow">ALL SERVICES · DAILY GRAND VIEW</span><h2>{displayDate(date)}</h2>
        <p>{entries.length} {entries.length === 1 ? "block" : "blocks"} <span aria-hidden="true">·</span> <strong>{uncovered} unassigned</strong></p></div>
      <div className="grand-date-controls">
        <button className="icon-button" aria-label="Previous grand view day" onClick={() => setDate(addDays(date, -1))}><ChevronLeft size={18} /></button>
        <label>Day<input type="date" value={date} onChange={event => { if (event.target.value) setDate(event.target.value); }} /></label>
        <button className="icon-button" aria-label="Next grand view day" onClick={() => setDate(addDays(date, 1))}><ChevronRight size={18} /></button>
      </div>
    </header>
    <p className="grand-note">All services together. Endoscopy appears once at its location. End times marked * are calculated from the scheduled cases.</p>
    {!entries.length && <p className="grand-empty">No OR, endoscopy, or clinic blocks scheduled for this day.</p>}
    <div className="grand-locations">{groups.map(group => {
      const items = entries.filter(entry => entry.group === group);
      const unassigned = items.flatMap(entry => entry.coverage).filter(item => !item.residentNames.length).length;
      return <section key={group} className={`grand-location grand-location-${group.toLowerCase()}`} aria-label={`${group} daily schedule`}>
        <header><h3>{group}</h3><span>{items.length} {items.length === 1 ? "block" : "blocks"}{unassigned > 0 && ` · ${unassigned} unassigned`}</span></header>
        {!items.length && <p className="grand-empty">No blocks scheduled</p>}
        {items.map(entry => <article key={entry.id} className="grand-entry">
          <div className="grand-time"><strong>{entry.startTime}{entry.endTime && `–${entry.endTime}${entry.calculatedEnd ? "*" : ""}`}</strong>
            <span>{entry.kind}{entry.kind === "OR" ? " start" : ""}</span>
            {entry.kind === "Endoscopy" && !entry.endTime && <span>End time unavailable</span>}</div>
          <div className="grand-surgeon"><strong>{entry.surgeon}</strong><span>{entry.service} · {entry.location}</span></div>
          <ol className="grand-cases">{entry.coverage.map(item => <li key={item.id}>
            <span>{item.label}</span><span className={item.residentNames.length ? "grand-assigned" : "grand-unassigned"}>
              {item.residentNames.length ? item.residentNames.join(", ") : <><span aria-hidden="true">🚩 </span>Unassigned</>}
            </span></li>)}</ol>
        </article>)}
      </section>;
    })}</div>
  </section>;
}
