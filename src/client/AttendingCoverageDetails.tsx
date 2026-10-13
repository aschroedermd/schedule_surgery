import { useId, useState } from "react";
import type { PlannerState } from "../shared/types";
import { COVERAGE_DISPLAY_LINES, COVERAGE_LABELS, PRIORITY_COVERAGE_LINES, resolveCoverageRows } from "../shared/attendingCoverage";

/** Date-scoped expansion is intentionally not persisted. */
export function AttendingCoverageDetails({ state, date }: { state: PlannerState; date: string }) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const lines = expanded ? COVERAGE_DISPLAY_LINES : PRIORITY_COVERAGE_LINES;
  return <section className="coverage-details" aria-label={`Attending coverage for ${date}`}>
    <header className="coverage-details-heading">
      <strong>Attending coverage · <time dateTime={date}>{date}</time></strong>
      <button type="button" className="secondary-button" aria-expanded={expanded} aria-controls={contentId}
        onClick={() => setExpanded(value => !value)}>{expanded ? "Show priority coverage" : "Show all coverage"}</button>
    </header>
    <div id={contentId} className="coverage-details-lines">
      {lines.map(line => {
        const rows = resolveCoverageRows(state.attendingCoverageAssignments, line, date).filter(row => expanded || row.assignment.role === "primary");
        const carryIn = state.attendingCoverageAssignments.filter(row => (expanded || row.role === "primary") && row.line === line && row.date < date && row.endDate && (row.endDate > date || (row.endDate === date && row.endTime !== "00:00")));
        return <div className="coverage-details-line" key={line}>
          <strong>{COVERAGE_LABELS[line]}</strong>
          {rows.length === 0 && <span className="coverage-unassigned">Unassigned</span>}
          {rows.map((resolved, index) => {
            const row = resolved.assignment;
            const provider = row.attendingId ? state.attendings.find(person => person.id === row.attendingId) : state.residents.find(person => person.id === row.fellowResidentId);
            const inherited = resolved.inheritedFromDay || resolved.inheritedFromWeekend;
            return <div key={`${row.id}-${index}`} className="coverage-details-assignment">
              <strong>{provider?.name ?? "Unknown clinician"}</strong>
              <span>{resolved.effectiveShift ?? row.shift}{row.role === "backup" ? " · backup" : ""}</span>
              {row.startTime && <span>{row.startTime}–{row.endTime}{row.endDate !== date ? ` (${row.endDate})` : ""} · New York</span>}
              <span className={inherited ? "coverage-inherited" : "coverage-explicit"}>{inherited ? `Inherited ${resolved.inheritedFromDay ? "from day" : "from weekend"}` : "Assigned"} · {row.source}</span>
            </div>;
          })}
          {carryIn.map(row => <div className="coverage-details-assignment" key={`carry-${row.id}`}>
            <strong>{state.attendings.find(person => person.id === row.attendingId)?.name ?? "Unknown clinician"}</strong>
            <span>Continues from {row.date} until {row.endDate} {row.endTime} · New York · {row.source}</span>
          </div>)}
        </div>;
      })}
    </div>
  </section>;
}
