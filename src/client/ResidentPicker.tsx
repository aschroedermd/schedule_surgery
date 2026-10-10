import { Check, ChevronDown, Search, X, CalendarDays, AlertTriangle } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isResidentOnService } from "../shared/services";
import { displayDate } from "../shared/date";
import { buildResidentPickerContext, getResidentPickerWorkload, type PickerActivity } from "./residentPickerContext";
import type { PlannerState, Resident } from "../shared/types";

export function ResidentPicker({ residents, service, date, value, label, className, emptyLabel = "Clear assignment", state, kind, targetId, onSelect }: {
  state?: PlannerState; kind?: "case" | "block" | "clinic"; targetId?: string;
  residents: Resident[]; service: string; date?: string; value?: string; label: string;
  className?: string; emptyLabel?: string; onSelect: (id: string, close: () => void) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [inspectedId, setInspectedId] = useState<string>();
  const [showDay, setShowDay] = useState(false);
  const [error, setError] = useState("");
  const context = useMemo(() => open && state && kind && targetId ? buildResidentPickerContext(state, kind, targetId) : undefined, [open, state, kind, targetId]);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [viewport, setViewport] = useState({ height: typeof window === "undefined" ? 768 : window.innerHeight, bottom: 0 });
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current!.getBoundingClientRect();
      const visual = window.visualViewport;
      setViewport({ height: visual?.height ?? window.innerHeight, bottom: visual ? Math.max(0, window.innerHeight - visual.height - visual.offsetTop) : 0 });
      const width = state && (window.innerWidth >= 1000 || (window.innerWidth >= 740 && window.innerHeight <= 500)) ? 780 : 420;
      setPosition({ left: Math.max(12, Math.min(rect.left, window.innerWidth - width - 12)),
        top: Math.max(12, Math.min(rect.bottom + 8, window.innerHeight - Math.min(640, window.innerHeight - 24) - 12)) });
    };
    place();
    // Let phone users browse suggestions before bringing up the keyboard.
    if (window.matchMedia?.("(min-width: 641px) and (hover: hover) and (pointer: fine)").matches) search.current?.focus();
    else panel.current?.focus();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    return () => { document.body.style.overflow = previousOverflow; window.removeEventListener("resize", place); window.visualViewport?.removeEventListener("resize", place); window.visualViewport?.removeEventListener("scroll", place); };
  }, [open, state]);
  const words = query.trim().toLocaleLowerCase().split(/\s+/);
  const filtered = residents.filter(resident => words.every(word =>
    `${resident.name} ${(resident.aliases ?? []).join(" ")} ${resident.sourceProgram ?? ""}`.toLocaleLowerCase().includes(word)))
    .sort((left, right) => context ? Number(getResidentPickerWorkload(context, left.id).overlaps.length > 0) - Number(getResidentPickerWorkload(context, right.id).overlaps.length > 0) : 0);
  const recommended = filtered.filter(resident => isResidentOnService(resident, service, date));
  const others = filtered.filter(resident => !isResidentOnService(resident, service, date));
  async function choose(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      let saved = false;
      await onSelect(id, () => { saved = true; close(); });
      if (!saved) setError("Assignment was not saved. Please try again.");
    } catch { setError("Could not save. Please try again."); } finally { setBusy(false); }
  }
  function renderActivities(activities: PickerActivity[], residentName?: string) {
    return <div className="resident-activity-list">
      {activities.length === 0 && <p className="resident-context-hint">No cases or clinics assigned today.</p>}
      {activities.map(activity => <article key={activity.id} className={activity.target ? "is-target" : ""}>
        <time>{activity.time}</time><strong>{activity.title}</strong><span>{activity.surgeon} · {activity.location}</span>
        {!residentName && <span className={activity.residentIds.length ? "" : "needs-coverage"}>{activity.residentIds.length ? activity.residentIds.map(id => context?.residentNames[id] ?? "Assigned resident").join(", ") : "Unassigned"}</span>}
      </article>)}
      <p className="resident-context-hint">Listed cases and clinics only; check other duties before assigning.</p>
    </div>;
  }
  return <>
    <button ref={trigger} type="button" className={`assignment-select resident-picker-trigger ${className ?? ""}`}
      aria-label={`Choose resident: ${label}`} aria-haspopup="dialog" aria-expanded={open}
      onClick={() => { setQuery(""); setInspectedId(undefined); setShowDay(false); setError(""); setOpen(true); }}><span>{label}</span><ChevronDown size={14} /></button>
    {open && createPortal(<div className="resident-picker-backdrop" onClick={event => {
      if (event.target === event.currentTarget && !busy) close();
    }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={busy} tabIndex={-1}
        className={`resident-picker-panel${context ? " has-context" : ""}${viewport.height < 500 ? " compact-height" : ""}`} style={{ ...position, ...(window.innerWidth <= 640 ? { bottom: viewport.bottom, maxHeight: viewport.height < 500 ? viewport.height - 8 : viewport.height * .92 } : {}) }} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (!busy) close(); }
          if (event.key === "Tab") {
            const controls = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)')].filter(control => control.getClientRects().length > 0);
            const first = controls[0], last = controls[controls.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel.current)) { event.preventDefault(); first?.focus(); }
          }
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            const options = [...panel.current!.querySelectorAll<HTMLButtonElement>('.resident-picker-option:not(:disabled)')];
            const index = options.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === "ArrowDown" ? Math.min(index + 1, options.length - 1) : Math.max(0, index - 1);
            event.preventDefault(); options[next]?.focus();
          }
        }}>
        <header><div><p className="resident-picker-eyebrow">{service} · {date ? displayDate(date) : "Coverage"}</p><h3 id={titleId}>Choose resident</h3></div>
          <button type="button" className="icon-button" aria-label="Close resident picker" disabled={busy} onClick={close}><X size={20} /></button></header>
        {context && <div className="resident-picker-target"><strong>{context.title}</strong><span>{context.subtitle}</span>
          <button type="button" className="resident-day-toggle" aria-expanded={showDay} onClick={() => { setShowDay(!showDay); setInspectedId(undefined); }}><CalendarDays size={16} />{showDay ? "Hide day schedule" : "View day schedule"}</button></div>}
        <div className="resident-picker-body"><div className="resident-picker-choices">
        <label className="resident-picker-search"><Search size={18} /><input ref={search} type="search" placeholder="Search by name…"
          aria-label="Search residents" autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} enterKeyHint="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <div className="resident-picker-results">
          {[{ heading: `${service} team · Suggested`, list: recommended }, { heading: "Other residents", list: others }].map(({ heading, list }) => {
            return list.length > 0 && <section key={heading}><h4>{heading}</h4>{list.map(resident => {
              const workload = context ? getResidentPickerWorkload(context, resident.id) : undefined;
              const inspected = inspectedId === resident.id;
              return <div key={resident.id} className={`resident-picker-row${isResidentOnService(resident, service, date) ? " recommended" : ""}${inspected ? " inspected" : ""}`}>
                <button type="button" disabled={busy} className="resident-picker-option"
                  aria-pressed={value === resident.id} onClick={() => void choose(resident.id)}>
                  <span><strong>{resident.name}</strong><small>{resident.trainingLevel}{resident.sourceProgram ? ` · ${resident.sourceProgram}` : ""}</small>
                    {workload && <small className={workload.overlaps.length ? "resident-workload warning" : "resident-workload"}>
                      {workload.overlaps.length > 0 && <AlertTriangle size={12} />}{workload.overlaps.length ? `${workload.overlaps.length} overlapping assignment${workload.overlaps.length === 1 ? "" : "s"}` : workload.activities.length ? `${workload.activities.length} assignment${workload.activities.length === 1 ? "" : "s"} today` : "No cases or clinics assigned today"}
                    </small>}
                  </span>
                  {value === resident.id ? <Check size={18} aria-label="Selected" /> : isResidentOnService(resident, service, date) ? <span className="resident-team-dot" aria-label="On service" /> : null}
                </button>
                {context && <button type="button" className="resident-inspect" aria-label={`View ${resident.name}’s day`} aria-expanded={inspected} title={`View ${resident.name}’s day`}
                  onClick={() => { setInspectedId(inspected ? undefined : resident.id); setShowDay(false); }}><CalendarDays size={18} /><span>Day</span></button>}
                {context && inspected && <div className="resident-mobile-detail">{renderActivities(workload!.activities, resident.name)}</div>}
              </div>;
            })}</section>;
          })}
          {filtered.length === 0 && <p className="resident-picker-empty" role="status">No residents found. Try another name.</p>}
        </div>
        </div>
        {context && <aside className={`resident-picker-context${showDay ? " show-day" : ""}`} aria-label="Day schedule">
          <div className="resident-context-heading"><h4>{inspectedId ? context.residentNames[inspectedId] : "Day schedule"}</h4>{inspectedId && <button type="button" onClick={() => setInspectedId(undefined)}>All surgeons</button>}</div>
          <p className="resident-context-hint">{inspectedId ? "Cases and clinics already assigned today." : "All services · highlighted cases belong to this selection."}</p>
          {renderActivities(inspectedId ? getResidentPickerWorkload(context, inspectedId).activities : context.activities, inspectedId ? context.residentNames[inspectedId] : undefined)}
        </aside>}
        </div>
        {error && <p className="resident-picker-error" role="alert">{error}</p>}
        <footer><button type="button" disabled={busy} onClick={() => void choose("")}>{emptyLabel}</button><span aria-live="polite">{busy ? "Saving…" : `${filtered.length} resident${filtered.length === 1 ? "" : "s"}`}</span></footer>
      </div>
    </div>, document.body)}
  </>;
}
