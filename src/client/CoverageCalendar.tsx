import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PencilLine,
  Plus,
  Trash2,
  XCircle
} from "lucide-react";
import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import {
  approveCoverageRequest,
  createCoverageEntry,
  deleteCoverageEntry,
  denyCoverageRequest,
  submitCoverageRequest,
  updateCoverageEntry
} from "./api";
import {
  formatMonthLabel,
  getCoverageSlot,
  getMonthFromDate,
  getMonthGridDates,
  getResidentColor,
  hasWeekendCoverage,
  isCallDate,
  isRoundingDate,
  isWeekendCoverageRequired
} from "../shared/coverage";
import { addDays, parseLocalDate } from "../shared/date";
import { createId } from "../shared/id";
import {
  CoverageChangeRequest,
  CoverageEntry,
  CoverageKind,
  PlannerState,
  Resident,
  Role
} from "../shared/types";

type MutationRunner = (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;

interface CoverageTabProps {
  state: PlannerState;
  token: string;
  role: Role;
  onMutate: MutationRunner;
}

export function CalendarTab({ state, token, role, onMutate }: CoverageTabProps) {
  const [month, setMonth] = useState(() => localStorage.getItem("coverageCalendarMonth") ?? getDefaultCoverageMonth(state));
  const dates = useMemo(() => getMonthGridDates(month), [month]);
  const pendingCount = state.coverageRequests.filter((request) => request.status === "pending").length;

  useEffect(() => {
    localStorage.setItem("coverageCalendarMonth", month);
  }, [month]);

  return (
    <section className="coverage-page">
      <div className="coverage-toolbar">
        <div>
          <p className="eyebrow">Call & Rounding</p>
          <h2>{formatMonthLabel(month)}</h2>
        </div>
        <div className="coverage-toolbar-actions">
          <button title="Previous month" className="icon-button" onClick={() => setMonth(shiftMonth(month, -1))}>
            <ChevronLeft size={17} />
          </button>
          <input
            aria-label="Coverage month"
            type="month"
            value={month}
            onChange={(event) => setMonth(event.target.value)}
          />
          <button title="Next month" className="icon-button" onClick={() => setMonth(shiftMonth(month, 1))}>
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      <div className="coverage-summary">
        <div className="coverage-legend">
          {state.residents.map((resident) => (
            <span key={resident.id} className="resident-legend-item">
              <span className="resident-dot" style={{ backgroundColor: getResidentColor(resident) }} />
              {resident.name}
            </span>
          ))}
        </div>
        <span className={pendingCount ? "request-count active" : "request-count"}>
          {pendingCount} pending request{pendingCount === 1 ? "" : "s"}
        </span>
      </div>

      <div className="coverage-weekdays" aria-hidden="true">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((weekday) => (
          <span key={weekday}>{weekday}</span>
        ))}
      </div>

      <div className="coverage-calendar-grid">
        {dates.map((date) => (
          <CoverageDay
            key={date}
            state={state}
            token={token}
            role={role}
            month={month}
            date={date}
            onMutate={onMutate}
          />
        ))}
      </div>
    </section>
  );
}

function CoverageDay({ state, token, role, month, date, onMutate }: CoverageTabProps & { month: string; date: string }) {
  const isAdmin = role === "admin";
  const inMonth = getMonthFromDate(date) === month;
  const entries = state.coverageEntries.filter((entry) => entry.date === date);
  const callEntry = getCoverageSlot(state.coverageEntries, date, "call");
  const roundingEntry = getCoverageSlot(state.coverageEntries, date, "rounding");
  const required = inMonth && isWeekendCoverageRequired(date);
  const unassigned = required && !hasWeekendCoverage(state.coverageEntries, date);
  const pendingRequests = state.coverageRequests.filter(
    (request) => request.status === "pending" && requestTouchesDate(state, request, date)
  );
  const dayNumber = parseLocalDate(date).getDate();
  const [noteDraft, setNoteDraft] = useState({
    residentId: state.residents[0]?.id ?? "",
    kind: "off" as Extract<CoverageKind, "off" | "note">,
    note: ""
  });
  const [showNoteForm, setShowNoteForm] = useState(false);

  useEffect(() => {
    if (noteDraft.residentId || !state.residents[0]) return;
    setNoteDraft((current) => ({ ...current, residentId: state.residents[0]?.id ?? "" }));
  }, [noteDraft.residentId, state.residents]);

  async function addNote(event: FormEvent) {
    event.preventDefault();
    const entry = makeClientCoverageEntry(date, noteDraft.kind, noteDraft.residentId || undefined, noteDraft.note);
    const action = isAdmin
      ? () => createCoverageEntry(token, entry)
      : () =>
          submitCoverageRequest(token, {
            action: "create",
            requestedEntry: entry,
            message: `Request ${entry.kind} entry`
          });
    await onMutate(action, isAdmin ? "Calendar note saved" : "Request submitted");
    setNoteDraft((current) => ({ ...current, note: "" }));
    setShowNoteForm(false);
  }

  const otherEntries = entries.filter((entry) => entry.kind === "off" || entry.kind === "note");

  return (
    <article className={`coverage-day${inMonth ? "" : " outside-month"}${unassigned ? " unassigned" : ""}`} data-date={date}>
      <header className="coverage-day-header">
        <strong>{dayNumber}</strong>
        <div className="coverage-day-flags">
          {pendingRequests.length > 0 && <span className="pending-flag">{pendingRequests.length} pending</span>}
          {unassigned && (
            <span className="unassigned-flag">
              <AlertTriangle size={13} />
              Unassigned
            </span>
          )}
        </div>
      </header>

      <div className="coverage-slots">
        {isCallDate(date) && (
          <CoverageSlotSelect
            label="Call"
            kind="call"
            date={date}
            entry={callEntry}
            state={state}
            token={token}
            isAdmin={isAdmin}
            disabled={!inMonth}
            onMutate={onMutate}
          />
        )}
        {isRoundingDate(date) && (
          <CoverageSlotSelect
            label="Round"
            kind="rounding"
            date={date}
            entry={roundingEntry}
            state={state}
            token={token}
            isAdmin={isAdmin}
            disabled={!inMonth}
            onMutate={onMutate}
          />
        )}
      </div>

      <div className="coverage-chip-list">
        {otherEntries.map((entry) => (
          <CoverageChip
            key={entry.id}
            entry={entry}
            residents={state.residents}
            canDelete={inMonth}
            isAdmin={isAdmin}
            token={token}
            onMutate={onMutate}
          />
        ))}
      </div>

      {inMonth && !isRoundingDate(date) && !showNoteForm && (
        <button type="button" className="secondary-button coverage-add-note-button" onClick={() => setShowNoteForm(true)}>
          add+
        </button>
      )}

      {inMonth && !isRoundingDate(date) && showNoteForm && (
        <form className="coverage-note-form" onSubmit={addNote}>
          <select
            aria-label="Note resident"
            value={noteDraft.residentId}
            onChange={(event) => setNoteDraft({ ...noteDraft, residentId: event.target.value })}
          >
            <option value="">General</option>
            {state.residents.map((resident) => (
              <option key={resident.id} value={resident.id}>
                {resident.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Note type"
            value={noteDraft.kind}
            onChange={(event) => setNoteDraft({ ...noteDraft, kind: event.target.value as "off" | "note" })}
          >
            <option value="off">Off</option>
            <option value="note">Note</option>
          </select>
          <input
            aria-label="Note"
            value={noteDraft.note}
            placeholder="Note"
            onChange={(event) => setNoteDraft({ ...noteDraft, note: event.target.value })}
          />
          <button title={isAdmin ? "Add note" : "Request note"} className="icon-button" type="submit">
            <Plus size={15} />
          </button>
        </form>
      )}
    </article>
  );
}

function CoverageSlotSelect({
  label,
  kind,
  date,
  entry,
  state,
  token,
  isAdmin,
  disabled,
  onMutate
}: {
  label: string;
  kind: "call" | "rounding";
  date: string;
  entry?: CoverageEntry;
  state: PlannerState;
  token: string;
  isAdmin: boolean;
  disabled: boolean;
  onMutate: MutationRunner;
}) {
  const resident = state.residents.find((candidate) => candidate.id === entry?.residentId);
  const style = resident
    ? ({
        "--resident-color": getResidentColor(resident)
      } as CSSProperties)
    : undefined;

  async function changeResident(residentId: string) {
    if (disabled) return;
    if (!entry && !residentId) return;

    if (isAdmin) {
      if (!residentId && entry) {
        await onMutate(() => deleteCoverageEntry(token, entry.id), "Calendar assignment cleared");
        return;
      }
      if (entry) {
        await onMutate(() => updateCoverageEntry(token, entry.id, { residentId }), "Calendar assignment saved");
        return;
      }
      await onMutate(() => createCoverageEntry(token, { date, kind, residentId, note: "" }), "Calendar assignment saved");
      return;
    }

    if (!residentId && entry) {
      await onMutate(
        () => submitCoverageRequest(token, { action: "delete", entryId: entry.id, message: `Request clearing ${kind}` }),
        "Request submitted"
      );
      return;
    }

    if (residentId) {
      const requestedEntry = entry
        ? { ...entry, residentId }
        : makeClientCoverageEntry(date, kind, residentId, "");
      await onMutate(
        () =>
          submitCoverageRequest(token, {
            action: entry ? "update" : "create",
            entryId: entry?.id,
            requestedEntry,
            message: `Request ${kind} assignment`
          }),
        "Request submitted"
      );
    }
  }

  return (
    <label className="coverage-slot-select" style={style}>
      <span>{label}</span>
      <select
        data-coverage-kind={kind}
        value={entry?.residentId ?? ""}
        disabled={disabled}
        onChange={(event) => changeResident(event.target.value)}
      >
        <option value="">Unassigned</option>
        {state.residents.map((residentOption) => (
          <option key={residentOption.id} value={residentOption.id}>
            {residentOption.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function CoverageChip({
  entry,
  residents,
  canDelete,
  isAdmin,
  token,
  onMutate
}: {
  entry: CoverageEntry;
  residents: Resident[];
  canDelete: boolean;
  isAdmin: boolean;
  token: string;
  onMutate: MutationRunner;
}) {
  const resident = residents.find((candidate) => candidate.id === entry.residentId);
  const style = {
    "--resident-color": getResidentColor(resident)
  } as CSSProperties;
  const residentName = resident?.name ?? "General";
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({
    residentId: entry.residentId ?? "",
    kind: entry.kind as Extract<CoverageKind, "off" | "note">,
    note: entry.note
  });

  useEffect(() => {
    setEditDraft({
      residentId: entry.residentId ?? "",
      kind: entry.kind as Extract<CoverageKind, "off" | "note">,
      note: entry.note
    });
  }, [entry.id, entry.kind, entry.note, entry.residentId]);

  async function deleteEntry() {
    if (!canDelete) return;
    const action = isAdmin
      ? () => deleteCoverageEntry(token, entry.id)
      : () =>
          submitCoverageRequest(token, {
            action: "delete",
            entryId: entry.id,
            message: `Request removing ${entry.kind}`
          });
    await onMutate(action, isAdmin ? "Calendar entry removed" : "Request submitted");
    setShowActions(false);
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    const nextEntry = {
      ...entry,
      kind: editDraft.kind,
      residentId: editDraft.residentId || undefined,
      note: editDraft.note.trim()
    };
    const action = isAdmin
      ? () => updateCoverageEntry(token, entry.id, nextEntry)
      : () =>
          submitCoverageRequest(token, {
            action: "update",
            entryId: entry.id,
            requestedEntry: nextEntry,
            message: `Request editing ${entry.kind}`
          });
    await onMutate(action, isAdmin ? "Calendar entry updated" : "Request submitted");
    setIsEditing(false);
    setShowActions(false);
  }

  return (
    <div className={`coverage-chip ${entry.kind}${showActions || isEditing ? " expanded" : ""}`} style={style}>
      <div className="coverage-chip-main">
        <span>{entry.kind}</span>
        <strong>{residentName}</strong>
        {entry.note && <em>{entry.note}</em>}
      </div>
      {canDelete && (
        <button
          title={isAdmin ? "Edit entry" : "Request edit"}
          className="icon-button"
          onClick={() => {
            setShowActions((current) => !current);
            setIsEditing(false);
          }}
        >
          <PencilLine size={13} />
        </button>
      )}
      {showActions && !isEditing && (
        <div className="coverage-chip-actions">
          <button type="button" className="secondary-button" onClick={() => setIsEditing(true)}>
            <PencilLine size={14} />
            Edit
          </button>
          <button type="button" className="secondary-button" onClick={deleteEntry}>
            <Trash2 size={14} />
            Delete
          </button>
        </div>
      )}
      {isEditing && (
        <form className="coverage-chip-edit-form" onSubmit={saveEdit}>
          <select
            aria-label="Edit entry resident"
            value={editDraft.residentId}
            onChange={(event) => setEditDraft({ ...editDraft, residentId: event.target.value })}
          >
            <option value="">General</option>
            {residents.map((residentOption) => (
              <option key={residentOption.id} value={residentOption.id}>
                {residentOption.name}
              </option>
            ))}
          </select>
          <select
            aria-label="Edit entry type"
            value={editDraft.kind}
            onChange={(event) => setEditDraft({ ...editDraft, kind: event.target.value as "off" | "note" })}
          >
            <option value="off">Off</option>
            <option value="note">Note</option>
          </select>
          <input
            aria-label="Edit entry note"
            value={editDraft.note}
            placeholder="Note"
            onChange={(event) => setEditDraft({ ...editDraft, note: event.target.value })}
          />
          <div className="coverage-chip-edit-actions">
            <button type="button" className="secondary-button" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
            <button type="submit" className="primary-button">
              Save
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

export function RequestsTab({ state, token, role, onMutate }: CoverageTabProps) {
  const isAdmin = role === "admin";
  const sortedRequests = [...state.coverageRequests].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : b.status === "pending" ? 1 : 0;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  if (sortedRequests.length === 0) {
    return (
      <section className="requests-empty">
        <Clock3 size={20} />
        <strong>No calendar requests</strong>
      </section>
    );
  }

  return (
    <section className="requests-list">
      {sortedRequests.map((coverageRequest) => (
        <article key={coverageRequest.id} className={`request-item ${coverageRequest.status}`}>
          <div className="request-main">
            <span className={`request-status ${coverageRequest.status}`}>{coverageRequest.status}</span>
            <strong>{describeRequest(state, coverageRequest)}</strong>
            <p>{coverageRequest.message || "No extra note"}</p>
            <span>{new Date(coverageRequest.createdAt).toLocaleString()}</span>
          </div>
          {isAdmin && coverageRequest.status === "pending" && (
            <div className="request-actions">
              <button
                className="secondary-button"
                onClick={() => onMutate(() => denyCoverageRequest(token, coverageRequest.id), "Request denied")}
              >
                <XCircle size={16} />
                Deny
              </button>
              <button
                className="primary-button"
                onClick={() => onMutate(() => approveCoverageRequest(token, coverageRequest.id), "Request approved")}
              >
                <CheckCircle2 size={16} />
                Approve
              </button>
            </div>
          )}
        </article>
      ))}
    </section>
  );
}

function makeClientCoverageEntry(
  date: string,
  kind: CoverageKind,
  residentId: string | undefined,
  note: string
): CoverageEntry {
  const now = new Date().toISOString();
  return {
    id: createId("cover"),
    date,
    kind,
    residentId,
    note: note.trim(),
    createdAt: now,
    updatedAt: now
  };
}

function requestTouchesDate(state: PlannerState, coverageRequest: CoverageChangeRequest, date: string): boolean {
  if (coverageRequest.requestedEntry?.date === date) return true;
  if (!coverageRequest.entryId) return false;
  return state.coverageEntries.some((entry) => entry.id === coverageRequest.entryId && entry.date === date);
}

function describeRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  if (coverageRequest.action === "delete") {
    const entry = state.coverageEntries.find((candidate) => candidate.id === coverageRequest.entryId);
    return entry ? `Delete ${describeEntry(state, entry)}` : "Delete calendar entry";
  }
  if (coverageRequest.requestedEntry) {
    return `${capitalize(coverageRequest.action)} ${describeEntry(state, coverageRequest.requestedEntry)}`;
  }
  return "Calendar request";
}

function describeEntry(state: PlannerState, entry: CoverageEntry): string {
  const resident = state.residents.find((candidate) => candidate.id === entry.residentId);
  const residentName = resident?.name ?? "General";
  const note = entry.note ? ` (${entry.note})` : "";
  return `${residentName} ${entry.kind} on ${entry.date}${note}`;
}

function getDefaultCoverageMonth(state: PlannerState): string {
  if (state.coverageEntries.some((entry) => entry.date.startsWith("2026-07"))) return "2026-07";
  const firstEntry = [...state.coverageEntries].sort((a, b) => a.date.localeCompare(b.date))[0];
  if (firstEntry) return getMonthFromDate(firstEntry.date);
  return new Date().toISOString().slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
