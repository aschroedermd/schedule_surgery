import { useId, useState } from "react";
import type { PlannerState } from "../shared/types";
import { COVERAGE_DISPLAY_LINES, COVERAGE_LABELS, PRIORITY_COVERAGE_LINES, resolveCoverageRows } from "../shared/attendingCoverage";

/** Date-scoped expansion is intentionally not persisted. */
export function AttendingCoverageDetails({ state, date }: { state: PlannerState; date: string }) {
  const contentId = useId();
  const [expanded, setExpanded] = useState(false);
  const lines = expanded ? COVERAGE_DISPLAY_LINES : PRIORITY_COVERAGE_LINES;
  return <section className="coverage-details" aria-label={`Attending coverage for ${date}`}>
    <div id={contentId} className="coverage-details-lines">
      {lines.map(line => {
        const rows = resolveCoverageRows(state.attendingCoverageAssignments, line, date).filter(row => expanded || row.assignment.role === "primary");
        const carryIn = state.attendingCoverageAssignments.filter(row => (expanded || row.role === "primary") && row.line === line && row.date < date && row.endDate && (row.endDate > date || (row.endDate === date && row.endTime !== "00:00")));
        // A day assignment can also resolve to night coverage. List each clinician once.
        const names = [...new Set([...rows.map(row => row.assignment), ...carryIn].map(row => {
          const provider = row.attendingId ? state.attendings.find(person => person.id === row.attendingId) : state.residents.find(person => person.id === row.fellowResidentId);
          return `${provider?.name ?? "Unknown clinician"}${row.role === "backup" ? " (backup)" : ""}`;
        }))];
        const label = line === "ACS" ? "ACS night" : line === "Practice" ? "Practice" : COVERAGE_LABELS[line];
        return <div className="coverage-details-line" key={line}>
          <strong>{label}:</strong>{" "}
          <span className={names.length ? "coverage-details-assignment" : "coverage-unassigned"}>{names.length ? names.join(", ") : "Unassigned"}</span>
        </div>;
      })}
    </div>
    <button type="button" className="secondary-button coverage-details-toggle" aria-expanded={expanded} aria-controls={contentId}
      onClick={() => setExpanded(value => !value)}>{expanded ? "Show less" : "Show all"}</button>
  </section>;
}
