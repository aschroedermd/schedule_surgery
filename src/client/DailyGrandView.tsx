import { useMemo } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { addDays, displayDate } from "../shared/date";
import { buildDailyGrandView } from "../shared/dailyGrand";
import type { PlannerState } from "../shared/types";

export function GrandDateControls({ date, onChange }: { date: string; onChange: (date: string) => void }) {
  return <div className="grand-date-controls">
    <button type="button" className="icon-button" aria-label="Previous grand view day" onClick={() => onChange(addDays(date, -1))}><ChevronLeft size={17} /></button>
    <time dateTime={date}>{displayDate(date)}</time>
    <button type="button" className="icon-button" aria-label="Next grand view day" onClick={() => onChange(addDays(date, 1))}><ChevronRight size={17} /></button>
    <div className="grand-calendar-picker">
      <CalendarDays size={17} aria-hidden="true" />
      <input type="date" onClick={event => event.currentTarget.showPicker?.()} aria-label="Grand view date" value={date} onInput={event => { if (event.currentTarget.value) onChange(event.currentTarget.value); }} />
    </div>
  </div>;
}

export function DailyGrandView({ state, date }: { state: PlannerState; date: string }) {
  const entries = useMemo(() => buildDailyGrandView(state, date), [state, date]);
  const groups = [...new Set(["RMH", "FMH", "CCASE", "Clinic", ...entries.map(entry => entry.group)])];
  return <section className="daily-grand" aria-label="Daily grand view">
    {!entries.length && <p className="grand-empty">No OR, endoscopy, or clinic blocks scheduled for this day.</p>}
    <div className="grand-locations">{groups.map(group => {
      const items = entries.filter(entry => entry.group === group);
      const unassigned = items.flatMap(entry => entry.coverage).filter(item => !item.residentNames.length).length;
      return <section key={group} className={`grand-location grand-location-${group.toLowerCase()}`} aria-label={`${group} daily schedule`}>
        <header><h3>{group}</h3><span>{items.length} {items.length === 1 ? "block" : "blocks"}{unassigned > 0 && ` · ${unassigned} unassigned`}</span></header>
        {!items.length && <p className="grand-empty">No blocks scheduled</p>}
        {items.map(entry => <article key={entry.id} className="grand-entry">
          <div className="grand-surgeon"><strong>{entry.surgeon}</strong><span>{entry.service} · {entry.location}</span></div>
          <div className="grand-time"><strong title={entry.calculatedEnd ? "End time calculated from scheduled cases" : undefined}>{entry.startTime}{entry.endTime && `–${entry.endTime}${entry.calculatedEnd ? "*" : ""}`}</strong>
            <span>{entry.kind}{entry.kind === "OR" ? " start" : ""}</span>
            {entry.kind === "Endoscopy" && !entry.endTime && <span>End time unavailable</span>}</div>
          <ol className="grand-cases">{entry.coverage.map(item => <li key={item.id}>
            <span>{item.label}</span><span className={item.residentNames.length ? "grand-assigned" : "grand-unassigned"}>
              {item.residentNames.length ? item.residentNames.join(", ") : <><span aria-hidden="true">🚩 </span>Unassigned</>}
            </span></li>)}</ol>
        </article>)}
      </section>;
    })}</div>
  </section>;
}
