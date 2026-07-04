import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  PencilLine,
  Plus,
  Send,
  Trash2,
  XCircle
} from "lucide-react";
import { CSSProperties, FormEvent, useEffect, useMemo, useState } from "react";
import {
  approveCoverageRequest,
  createCoverageEntry,
  deleteCoverageEntry,
  deleteCoverageRequest,
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
  ServicePrivileges
} from "../shared/types";
import {
  DEFAULT_SERVICE_LINE,
  isResidentOnService,
  servicesMatch
} from "../shared/services";
import {
  getCalendarNightResidentsForDate,
  getResidentLastName,
  getResidentServiceTagsForDate,
  getTodayDate
} from "../shared/rotations";

type MutationRunner = (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;

interface CalendarTabProps {
  state: PlannerState;
  token: string;
  selectedService: string;
  serviceLines: string[];
  username: string;
  isAdmin: boolean;
  servicePrivileges: ServicePrivileges;
  onMutate: MutationRunner;
}

interface CalendarAccessProps {
  state: PlannerState;
  token: string;
  selectedService: string;
  visibleServices: string[];
  isAdmin: boolean;
  servicePrivileges: ServicePrivileges;
  onMutate: MutationRunner;
}

export function CalendarTab({
  state,
  token,
  selectedService,
  serviceLines,
  username,
  isAdmin,
  servicePrivileges,
  onMutate
}: CalendarTabProps) {
  const [month, setMonth] = useState(() => localStorage.getItem("coverageCalendarMonth") ?? getDefaultCoverageMonth(state));
  const [visibleServices, setVisibleServices] = useState(() => getStoredCalendarServices(serviceLines, selectedService, username));
  const dates = useMemo(() => getMonthGridDates(month), [month]);
  const serviceLineKey = serviceLines.join("\u0000");
  const visibleResidents = useMemo(
    () => state.residents.filter((resident) => dates.some((date) => residentMatchesServices(resident, visibleServices, date))),
    [dates, state.residents, visibleServices]
  );
  const visibleCoverageEntries = useMemo(
    () => state.coverageEntries.filter((entry) => coverageEntryMatchesServices(state, entry, visibleServices)),
    [state, visibleServices]
  );
  const currentResident = useMemo(() => findResidentForUsername(state, username), [state, username]);
  const pendingCount = state.coverageRequests.filter(
    (request) => request.status === "pending" && coverageRequestMatchesServices(state, request, visibleServices)
  ).length;
  const allServicesChecked = serviceLines.length > 0 && serviceLines.every((serviceLine) => serviceIsVisible(visibleServices, serviceLine));
  const nightResidents = getCalendarNightResidentsForDate(state.residents, getTodayDate());

  useEffect(() => {
    localStorage.setItem("coverageCalendarMonth", month);
  }, [month]);

  useEffect(() => {
    setVisibleServices(getStoredCalendarServices(serviceLines, selectedService, username));
  }, [selectedService, serviceLineKey, username]);

  useEffect(() => {
    storeCalendarServices(username, selectedService, visibleServices);
  }, [selectedService, username, visibleServices]);

  function updateVisibleService(serviceLine: string, checked: boolean) {
    setVisibleServices((current) => {
      const next = checked
        ? [...current, serviceLine]
        : current.filter((candidate) => !servicesMatch(candidate, serviceLine));
      return normalizeCalendarServices(next, serviceLines, selectedService);
    });
  }

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

      <div className="coverage-service-filter" aria-label="Calendar services">
        <label className="service-filter-option">
          <input
            type="checkbox"
            checked={allServicesChecked}
            onChange={(event) => setVisibleServices(event.target.checked ? [...serviceLines] : getDefaultCalendarServices(serviceLines, selectedService))}
          />
          <span>All services</span>
        </label>
        {serviceLines.map((serviceLine) => (
          <label key={serviceLine} className="service-filter-option">
            <input
              type="checkbox"
              checked={serviceIsVisible(visibleServices, serviceLine)}
              onChange={(event) => updateVisibleService(serviceLine, event.target.checked)}
            />
            <span>{serviceLine}</span>
          </label>
        ))}
      </div>

      <div className="coverage-summary">
        <div className="coverage-legend">
          {visibleResidents.map((resident) => (
            <span key={resident.id} className="resident-legend-item">
              <span className="resident-dot" style={{ backgroundColor: getResidentColor(resident) }} />
              {formatResidentName(resident)}
            </span>
          ))}
        </div>
        <span className="nights-summary">
          🌙 NIGHTS: {nightResidents.length ? nightResidents.map((resident) => getResidentLastName(resident.name)).join(", ") : "None listed"}
        </span>
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
            selectedService={selectedService}
            visibleServices={visibleServices}
            visibleResidents={visibleResidents}
            coverageEntries={visibleCoverageEntries}
            currentResident={currentResident}
            isAdmin={isAdmin}
            servicePrivileges={servicePrivileges}
            month={month}
            date={date}
            onMutate={onMutate}
          />
        ))}
      </div>
    </section>
  );
}

function CoverageDay({
  state,
  token,
  selectedService,
  visibleServices,
  visibleResidents,
  coverageEntries,
  currentResident,
  isAdmin,
  servicePrivileges,
  month,
  date,
  onMutate
}: CalendarAccessProps & {
  visibleResidents: Resident[];
  coverageEntries: CoverageEntry[];
  currentResident?: Resident;
  month: string;
  date: string;
}) {
  const inMonth = getMonthFromDate(date) === month;
  const dayVisibleResidents = visibleResidents.filter((resident) => residentMatchesServices(resident, visibleServices, date));
  const entries = coverageEntries.filter((entry) => entry.date === date);
  const callEntry = getCoverageSlot(coverageEntries, date, "call");
  const roundingEntry = getCoverageSlot(coverageEntries, date, "rounding");
  const required = inMonth && isWeekendCoverageRequired(date);
  const unassigned = required && !hasWeekendCoverage(coverageEntries, date);
  const pendingRequests = state.coverageRequests.filter(
    (request) =>
      request.status === "pending" &&
      requestTouchesDate(state, request, date) &&
      coverageRequestMatchesServices(state, request, visibleServices)
  );
  const canEditVisibleServices = visibleServices.some((serviceLine) =>
    canEditService(isAdmin, servicePrivileges, serviceLine)
  );
  const canCreateForVisibleServices = visibleServices.some((serviceLine) =>
    canRequestService(isAdmin, servicePrivileges, serviceLine)
  );
  const dayNumber = parseLocalDate(date).getDate();
  const [noteDraft, setNoteDraft] = useState({
    residentId: dayVisibleResidents[0]?.id ?? "",
    kind: "off" as Extract<CoverageKind, "off" | "note">,
    note: ""
  });
  const [showNoteForm, setShowNoteForm] = useState(false);

  useEffect(() => {
    if (!noteDraft.residentId) {
      if (dayVisibleResidents[0]) {
        setNoteDraft((current) => ({ ...current, residentId: dayVisibleResidents[0]?.id ?? "" }));
      }
      return;
    }
    if (dayVisibleResidents.some((resident) => resident.id === noteDraft.residentId)) return;
    setNoteDraft((current) => ({ ...current, residentId: dayVisibleResidents[0]?.id ?? "" }));
  }, [dayVisibleResidents, noteDraft.residentId]);

  async function addNote(event: FormEvent) {
    event.preventDefault();
    const entry = makeClientCoverageEntry(date, noteDraft.kind, noteDraft.residentId || undefined, noteDraft.note);
    const serviceLine = resolveEntryMutationService(state, entry, visibleServices, selectedService);
    const canEdit = canEditService(isAdmin, servicePrivileges, serviceLine);
    const canRequest = canRequestService(isAdmin, servicePrivileges, serviceLine);
    if (!canRequest) return;
    const action = canEdit
      ? () => createCoverageEntry(token, entry, serviceLine)
      : () =>
          submitCoverageRequest(
            token,
            {
              action: "create",
              requestedEntry: entry,
              message: `Request ${entry.kind} entry`
            },
            serviceLine
          );
    await onMutate(action, canEdit ? "Calendar note saved" : "Request submitted");
    setNoteDraft((current) => ({ ...current, note: "" }));
    setShowNoteForm(false);
  }

  const otherEntries = entries.filter((entry) => entry.kind === "off" || entry.kind === "note");

  return (
    <article className={`coverage-day${inMonth ? "" : " outside-month"}${unassigned ? " unassigned" : ""}`} data-date={date}>
      <header className="coverage-day-header">
        <strong>{dayNumber}</strong>
        <span className="coverage-day-mobile-date">{formatMobileCoverageDate(date)}</span>
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
            selectedService={selectedService}
            visibleServices={visibleServices}
            visibleResidents={dayVisibleResidents}
            currentResident={currentResident}
            isAdmin={isAdmin}
            servicePrivileges={servicePrivileges}
            disabled={!inMonth || !canCreateForVisibleServices}
            allowResidentTrade={inMonth}
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
            selectedService={selectedService}
            visibleServices={visibleServices}
            visibleResidents={dayVisibleResidents}
            currentResident={currentResident}
            isAdmin={isAdmin}
            servicePrivileges={servicePrivileges}
            disabled={!inMonth || !canCreateForVisibleServices}
            allowResidentTrade={inMonth}
            onMutate={onMutate}
          />
        )}
      </div>

      <div className="coverage-chip-list">
        {otherEntries.map((entry) => (
          <CoverageChip
            key={entry.id}
            entry={entry}
            residents={visibleResidents}
            canDelete={inMonth}
            selectedService={selectedService}
            visibleServices={visibleServices}
            state={state}
            isAdmin={isAdmin}
            servicePrivileges={servicePrivileges}
            token={token}
            onMutate={onMutate}
          />
        ))}
      </div>

      {inMonth && canCreateForVisibleServices && !isRoundingDate(date) && !showNoteForm && (
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
            {dayVisibleResidents.map((resident) => (
              <option key={resident.id} value={resident.id}>
                {formatResidentName(resident)}
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
          <button title={canEditVisibleServices ? "Add note" : "Request note"} className="icon-button" type="submit">
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
  selectedService,
  visibleServices,
  visibleResidents,
  currentResident,
  isAdmin,
  servicePrivileges,
  disabled,
  allowResidentTrade,
  onMutate
}: {
  label: string;
  kind: "call" | "rounding";
  date: string;
  entry?: CoverageEntry;
  state: PlannerState;
  token: string;
  selectedService: string;
  visibleServices: string[];
  visibleResidents: Resident[];
  currentResident?: Resident;
  isAdmin: boolean;
  servicePrivileges: ServicePrivileges;
  disabled: boolean;
  allowResidentTrade: boolean;
  onMutate: MutationRunner;
}) {
  const resident = state.residents.find((candidate) => candidate.id === entry?.residentId);
  const style = resident
    ? ({
        "--resident-color": getResidentColor(resident)
      } as CSSProperties)
    : undefined;
  const [showTradeForm, setShowTradeForm] = useState(false);
  const [tradeDraft, setTradeDraft] = useState({
    targetResidentId: "",
    swapEntryId: "",
    message: ""
  });
  const canTradeOwnEntry = Boolean(
    allowResidentTrade &&
      entry &&
      currentResident &&
      entry.residentId === currentResident.id &&
      isTradeableCoverageKind(entry.kind)
  );
  const tradeResidentOptions = useMemo(
    () =>
      state.residents
        .filter((residentOption) => residentOption.id !== currentResident?.id)
        .sort((a, b) => {
          const serviceDelta =
            Number(isResidentOnService(b, selectedService, date)) -
            Number(isResidentOnService(a, selectedService, date));
          if (serviceDelta !== 0) return serviceDelta;
          return a.name.localeCompare(b.name);
        }),
    [currentResident?.id, date, selectedService, state.residents]
  );
  const swapEntryOptions = useMemo(
    () =>
      tradeDraft.targetResidentId && entry
        ? state.coverageEntries
            .filter(
              (candidate) =>
                candidate.id !== entry.id &&
                candidate.kind === entry.kind &&
                candidate.residentId === tradeDraft.targetResidentId
            )
            .sort((a, b) => a.date.localeCompare(b.date))
        : [],
    [entry, state.coverageEntries, tradeDraft.targetResidentId]
  );

  useEffect(() => {
    if (!showTradeForm) return;
    if (tradeResidentOptions.some((residentOption) => residentOption.id === tradeDraft.targetResidentId)) return;
    setTradeDraft((current) => ({
      ...current,
      targetResidentId: tradeResidentOptions[0]?.id ?? "",
      swapEntryId: ""
    }));
  }, [showTradeForm, tradeDraft.targetResidentId, tradeResidentOptions]);

  useEffect(() => {
    if (!tradeDraft.swapEntryId) return;
    if (swapEntryOptions.some((swapEntry) => swapEntry.id === tradeDraft.swapEntryId)) return;
    setTradeDraft((current) => ({ ...current, swapEntryId: "" }));
  }, [swapEntryOptions, tradeDraft.swapEntryId]);

  async function changeResident(residentId: string) {
    if (disabled) return;
    if (!entry && !residentId) return;

    const serviceLine = entry && !residentId
      ? resolveEntryMutationService(state, entry, visibleServices, selectedService)
      : resolveResidentMutationService(state, residentId, visibleServices, selectedService, date);
    const canEdit = canEditService(isAdmin, servicePrivileges, serviceLine);
    const canRequest = canRequestService(isAdmin, servicePrivileges, serviceLine);
    if (!canRequest) return;

    if (canEdit) {
      if (!residentId && entry) {
        await onMutate(() => deleteCoverageEntry(token, entry.id, serviceLine), "Calendar assignment cleared");
        return;
      }
      if (entry) {
        await onMutate(() => updateCoverageEntry(token, entry.id, { residentId }, serviceLine), "Calendar assignment saved");
        return;
      }
      await onMutate(() => createCoverageEntry(token, { date, kind, residentId, note: "" }, serviceLine), "Calendar assignment saved");
      return;
    }

    if (!residentId && entry) {
      await onMutate(
        () =>
          submitCoverageRequest(
            token,
            { action: "delete", entryId: entry.id, message: `Request clearing ${kind}` },
            serviceLine
          ),
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
          submitCoverageRequest(
            token,
            {
              action: entry ? "update" : "create",
              entryId: entry?.id,
              requestedEntry,
              message: `Request ${kind} assignment`
            },
            serviceLine
          ),
        "Request submitted"
      );
    }
  }

  async function sendTradeRequest(event: FormEvent) {
    event.preventDefault();
    if (!entry || !currentResident || !tradeDraft.targetResidentId) return;
    const serviceLine = resolveEntryMutationService(state, entry, visibleServices, selectedService);
    await onMutate(
      () =>
        submitCoverageRequest(
          token,
          {
            requestType: "resident-trade",
            action: "update",
            entryId: entry.id,
            targetResidentId: tradeDraft.targetResidentId,
            swapEntryId: tradeDraft.swapEntryId || undefined,
            message: tradeDraft.message.trim()
          },
          serviceLine
        ),
      "Trade request sent"
    );
    setShowTradeForm(false);
    setTradeDraft((current) => ({ ...current, swapEntryId: "", message: "" }));
  }

  return (
    <div className={`coverage-slot-wrapper${showTradeForm ? " expanded" : ""}`} style={style}>
      <div className="coverage-slot-row">
        <label className="coverage-slot-select">
          <span>{label}</span>
          <select
            data-coverage-kind={kind}
            value={entry?.residentId ?? ""}
            disabled={disabled}
            onChange={(event) => changeResident(event.target.value)}
          >
            <option value="">Unassigned</option>
            {visibleResidents.map((residentOption) => (
              <option key={residentOption.id} value={residentOption.id}>
                {formatResidentName(residentOption)}
              </option>
            ))}
          </select>
        </label>
        {canTradeOwnEntry && (
          <button
            type="button"
            title="Request trade"
            className="icon-button"
            onClick={() => setShowTradeForm((current) => !current)}
          >
            <ArrowRightLeft size={14} />
          </button>
        )}
      </div>
      {showTradeForm && canTradeOwnEntry && (
        <form className="coverage-trade-form" onSubmit={sendTradeRequest}>
          <select
            aria-label="Trade resident"
            value={tradeDraft.targetResidentId}
            onChange={(event) => setTradeDraft({ ...tradeDraft, targetResidentId: event.target.value, swapEntryId: "" })}
          >
            {tradeResidentOptions.map((residentOption) => (
              <option key={residentOption.id} value={residentOption.id}>
                {formatResidentName(residentOption)}
              </option>
            ))}
          </select>
          <select
            aria-label="Swap entry"
            value={tradeDraft.swapEntryId}
            onChange={(event) => setTradeDraft({ ...tradeDraft, swapEntryId: event.target.value })}
          >
            <option value="">Cover my {kind}</option>
            {swapEntryOptions.map((swapEntry) => (
              <option key={swapEntry.id} value={swapEntry.id}>
                Swap for {formatMobileCoverageDate(swapEntry.date)}
              </option>
            ))}
          </select>
          <input
            aria-label="Trade note"
            value={tradeDraft.message}
            placeholder="Note"
            onChange={(event) => setTradeDraft({ ...tradeDraft, message: event.target.value })}
          />
          <button title="Send trade request" className="icon-button" type="submit" disabled={!tradeDraft.targetResidentId}>
            <Send size={14} />
          </button>
        </form>
      )}
    </div>
  );
}

function CoverageChip({
  entry,
  residents,
  canDelete,
  selectedService,
  visibleServices,
  state,
  isAdmin,
  servicePrivileges,
  token,
  onMutate
}: {
  entry: CoverageEntry;
  residents: Resident[];
  canDelete: boolean;
  selectedService: string;
  visibleServices: string[];
  state: PlannerState;
  isAdmin: boolean;
  servicePrivileges: ServicePrivileges;
  token: string;
  onMutate: MutationRunner;
}) {
  const resident = residents.find((candidate) => candidate.id === entry.residentId);
  const style = {
    "--resident-color": getResidentColor(resident)
  } as CSSProperties;
  const residentName = resident ? formatResidentName(resident) : "General";
  const [showActions, setShowActions] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editDraft, setEditDraft] = useState({
    residentId: entry.residentId ?? "",
    kind: entry.kind as Extract<CoverageKind, "off" | "note">,
    note: entry.note
  });
  const entryServiceLine = resolveEntryMutationService(state, entry, visibleServices, selectedService);
  const canEdit = canEditService(isAdmin, servicePrivileges, entryServiceLine);
  const canRequest = canRequestService(isAdmin, servicePrivileges, entryServiceLine);

  useEffect(() => {
    setEditDraft({
      residentId: entry.residentId ?? "",
      kind: entry.kind as Extract<CoverageKind, "off" | "note">,
      note: entry.note
    });
  }, [entry.id, entry.kind, entry.note, entry.residentId]);

  async function deleteEntry() {
    if (!canDelete) return;
    const action = canEdit
      ? () => deleteCoverageEntry(token, entry.id, entryServiceLine)
      : () =>
          submitCoverageRequest(
            token,
            {
              action: "delete",
              entryId: entry.id,
              message: `Request removing ${entry.kind}`
            },
            entryServiceLine
          );
    await onMutate(action, canEdit ? "Calendar entry removed" : "Request submitted");
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
    const serviceLine = editDraft.residentId
      ? resolveResidentMutationService(state, editDraft.residentId, visibleServices, selectedService, entry.date)
      : entryServiceLine;
    const canEditTarget = canEditService(isAdmin, servicePrivileges, serviceLine);
    const canRequestTarget = canRequestService(isAdmin, servicePrivileges, serviceLine);
    if (!canRequestTarget) return;
    const action = canEditTarget
      ? () => updateCoverageEntry(token, entry.id, nextEntry, serviceLine)
      : () =>
          submitCoverageRequest(
            token,
            {
              action: "update",
              entryId: entry.id,
              requestedEntry: nextEntry,
              message: `Request editing ${entry.kind}`
            },
            serviceLine
          );
    await onMutate(action, canEditTarget ? "Calendar entry updated" : "Request submitted");
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
      {canDelete && (canEdit || canRequest) && (
        <button
          title={canEdit ? "Edit entry" : "Request edit"}
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
                {formatResidentName(residentOption)}
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

export function RequestsTab({
  state,
  token,
  username,
  isAdmin,
  servicePrivileges,
  onMutate
}: {
  state: PlannerState;
  token: string;
  username: string;
  isAdmin: boolean;
  servicePrivileges: ServicePrivileges;
  onMutate: MutationRunner;
}) {
  const sortedRequests = [...state.coverageRequests].sort((a, b) => {
    if (a.status !== b.status) return a.status === "pending" ? -1 : b.status === "pending" ? 1 : 0;
    return b.updatedAt.localeCompare(a.updatedAt);
  });

  if (sortedRequests.length === 0) {
    return (
      <section className="requests-empty">
        <Clock3 size={20} />
        <strong>No requests</strong>
      </section>
    );
  }

  return (
    <section className="requests-list">
      {sortedRequests.map((coverageRequest) => {
        const canResolve = canResolveRequest(state, coverageRequest, username, isAdmin, servicePrivileges);
        const canShowActions = (canResolve && coverageRequest.status === "pending") || isAdmin;

        return (
          <article key={coverageRequest.id} className={`request-item ${coverageRequest.status}`}>
            <div className="request-main">
              <span className={`request-status ${coverageRequest.status}`}>{formatRequestStatus(coverageRequest)}</span>
              <strong>{describeRequest(state, coverageRequest)}</strong>
              <p>{coverageRequest.message || "No extra note"}</p>
              {coverageRequest.requesterName && <span>From {coverageRequest.requesterName}</span>}
              <span>{new Date(coverageRequest.createdAt).toLocaleString()}</span>
            </div>
            {canShowActions && (
              <div className="request-actions">
                {canResolve && coverageRequest.status === "pending" && (
                  <>
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
                      {isResidentTradeRequest(coverageRequest) ? "Accept" : "Approve"}
                    </button>
                  </>
                )}
                {isAdmin && (
                  <button
                    className="secondary-button"
                    onClick={() => onMutate(() => deleteCoverageRequest(token, coverageRequest.id), "Request removed")}
                  >
                    <Trash2 size={16} />
                    Delete
                  </button>
                )}
              </div>
            )}
          </article>
        );
      })}
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

function coverageRequestMatchesServices(
  state: PlannerState,
  coverageRequest: CoverageChangeRequest,
  visibleServices: string[]
): boolean {
  if (coverageRequest.serviceLine) return serviceIsVisible(visibleServices, coverageRequest.serviceLine);
  if (coverageRequest.requestedEntry) return coverageEntryMatchesServices(state, coverageRequest.requestedEntry, visibleServices);
  const entry = state.coverageEntries.find((candidate) => candidate.id === coverageRequest.entryId);
  return entry ? coverageEntryMatchesServices(state, entry, visibleServices) : true;
}

function coverageEntryMatchesServices(state: PlannerState, entry: CoverageEntry, visibleServices: string[]): boolean {
  if (!entry.residentId) return true;
  const resident = state.residents.find((candidate) => candidate.id === entry.residentId);
  return resident ? residentMatchesServices(resident, visibleServices, entry.date) : true;
}

function residentMatchesServices(resident: Resident, visibleServices: string[], date?: string): boolean {
  return visibleServices.some((serviceLine) => isResidentOnService(resident, serviceLine, date));
}

function serviceIsVisible(visibleServices: string[], serviceLine: string): boolean {
  return visibleServices.some((candidate) => servicesMatch(candidate, serviceLine));
}

function getStoredCalendarServices(serviceLines: string[], selectedService: string, username: string): string[] {
  const stored = localStorage.getItem(getCalendarServicesStorageKey(username, selectedService));
  if (!stored) return getDefaultCalendarServices(serviceLines, selectedService);
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed)
      ? normalizeCalendarServices(parsed.filter((item) => typeof item === "string"), serviceLines, selectedService)
      : getDefaultCalendarServices(serviceLines, selectedService);
  } catch {
    return getDefaultCalendarServices(serviceLines, selectedService);
  }
}

function storeCalendarServices(username: string, selectedService: string, visibleServices: string[]) {
  localStorage.setItem(getCalendarServicesStorageKey(username, selectedService), JSON.stringify(visibleServices));
}

function getCalendarServicesStorageKey(username: string, selectedService: string): string {
  return `coverageCalendarServices:${normalizeStorageSegment(username)}:${normalizeStorageSegment(selectedService)}`;
}

function normalizeStorageSegment(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function getDefaultCalendarServices(serviceLines: string[], selectedService: string): string[] {
  const defaultService =
    serviceLines.find((serviceLine) => servicesMatch(serviceLine, selectedService)) ??
    serviceLines.find((serviceLine) => servicesMatch(serviceLine, DEFAULT_SERVICE_LINE));
  return defaultService ? [defaultService] : serviceLines.slice(0, 1);
}

function normalizeCalendarServices(selectedServices: string[], serviceLines: string[], selectedService: string): string[] {
  const normalized = serviceLines.filter((serviceLine) => selectedServices.some((candidate) => servicesMatch(candidate, serviceLine)));
  return normalized.length > 0 ? normalized : getDefaultCalendarServices(serviceLines, selectedService);
}

function resolveEntryMutationService(
  state: PlannerState,
  entry: CoverageEntry,
  visibleServices: string[],
  selectedService: string
): string {
  return resolveResidentMutationService(state, entry.residentId, visibleServices, selectedService, entry.date);
}

function resolveResidentMutationService(
  state: PlannerState,
  residentId: string | undefined,
  visibleServices: string[],
  selectedService: string,
  date?: string
): string {
  const resident = residentId ? state.residents.find((candidate) => candidate.id === residentId) : undefined;
  if (resident) {
    const visibleMatch = visibleServices.find((serviceLine) => isResidentOnService(resident, serviceLine, date));
    if (visibleMatch) return visibleMatch;
    if (isResidentOnService(resident, selectedService, date)) return selectedService;
    const residentServiceTag = getResidentServiceTagsForDate(resident, date)[0];
    if (residentServiceTag) return residentServiceTag;
  }
  return visibleServices.find((serviceLine) => servicesMatch(serviceLine, selectedService)) ?? visibleServices[0] ?? selectedService;
}

function canEditService(isAdmin: boolean, servicePrivileges: ServicePrivileges, serviceLine: string): boolean {
  return isAdmin || servicePrivileges[serviceLine] === "edit";
}

function canRequestService(isAdmin: boolean, servicePrivileges: ServicePrivileges, serviceLine: string): boolean {
  const privilege = servicePrivileges[serviceLine];
  return canEditService(isAdmin, servicePrivileges, serviceLine) || privilege === "request";
}

function describeRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  if (isResidentProfileRequest(coverageRequest)) {
    return describeResidentProfileRequest(state, coverageRequest);
  }
  if (isResidentTradeRequest(coverageRequest)) {
    return describeResidentTradeRequest(state, coverageRequest);
  }
  if (coverageRequest.action === "delete") {
    const entry = state.coverageEntries.find((candidate) => candidate.id === coverageRequest.entryId);
    return entry ? `Delete ${describeEntry(state, entry)}` : "Delete calendar entry";
  }
  if (coverageRequest.requestedEntry) {
    return `${capitalize(coverageRequest.action)} ${describeEntry(state, coverageRequest.requestedEntry)}`;
  }
  return "Calendar request";
}

function describeResidentProfileRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  const resident = coverageRequest.targetResidentId
    ? state.residents.find((candidate) => candidate.id === coverageRequest.targetResidentId)
    : undefined;
  const requestedName = coverageRequest.requestedResidentProfile?.name;
  const requestedAliases = coverageRequest.requestedResidentProfile?.aliases ?? [];
  const aliasText = requestedAliases.length ? ` · aliases: ${requestedAliases.join(", ")}` : "";
  return `Update ${resident ? formatResidentName(resident) : "resident"}${requestedName ? ` to ${requestedName}` : ""}${aliasText}`;
}

function describeResidentTradeRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  const requester = coverageRequest.requesterResidentId
    ? state.residents.find((resident) => resident.id === coverageRequest.requesterResidentId)
    : undefined;
  const target = coverageRequest.targetResidentId
    ? state.residents.find((resident) => resident.id === coverageRequest.targetResidentId)
    : undefined;
  const requesterName = requester ? formatResidentName(requester) : coverageRequest.requesterName ?? "Requester";
  const targetName = target ? formatResidentName(target) : "requested resident";
  const source = coverageRequest.requestedEntry;
  const swap = coverageRequest.swapRequestedEntry;
  if (!source) return "Resident trade request";
  if (!swap) return `${requesterName} asks ${targetName} to cover ${source.kind} on ${source.date}`;
  return `${requesterName} ${source.kind} on ${source.date} for ${targetName} ${swap.kind} on ${swap.date}`;
}

function describeEntry(state: PlannerState, entry: CoverageEntry): string {
  const resident = state.residents.find((candidate) => candidate.id === entry.residentId);
  const residentName = resident ? formatResidentName(resident) : "General";
  const note = entry.note ? ` (${entry.note})` : "";
  return `${residentName} ${entry.kind} on ${entry.date}${note}`;
}

function formatRequestStatus(coverageRequest: CoverageChangeRequest): string {
  if (isResidentTradeRequest(coverageRequest) && coverageRequest.status === "approved") return "accepted";
  return coverageRequest.status;
}

function canResolveRequest(
  state: PlannerState,
  coverageRequest: CoverageChangeRequest,
  username: string,
  isAdmin: boolean,
  servicePrivileges: ServicePrivileges
): boolean {
  if (isResidentProfileRequest(coverageRequest)) return isAdmin;
  if (isResidentTradeRequest(coverageRequest) && coverageRequestTargetsUsername(state, coverageRequest, username)) {
    return true;
  }
  if (isAdmin) return true;
  if (coverageRequest.serviceLine) return servicePrivileges[coverageRequest.serviceLine] === "edit";
  return Object.values(servicePrivileges).some((privilege) => privilege === "edit");
}

function coverageRequestTargetsUsername(
  state: PlannerState,
  coverageRequest: CoverageChangeRequest,
  username: string
): boolean {
  const resident = findResidentForUsername(state, username);
  return Boolean(resident && coverageRequest.targetResidentId === resident.id);
}

function isResidentTradeRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "resident-trade";
}

function isResidentProfileRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "resident-profile";
}

function isTradeableCoverageKind(kind: CoverageKind): boolean {
  return kind === "call" || kind === "rounding";
}

function findResidentForUsername(state: PlannerState, username: string): Resident | undefined {
  const normalized = normalizeUsername(username);
  return state.residents.find((resident) => normalizeUsername(resident.username ?? "") === normalized);
}

function normalizeUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatResidentName(resident: Pick<Resident, "name" | "emoji">): string {
  return resident.emoji ? `${resident.emoji} ${resident.name}` : resident.name;
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

function formatMobileCoverageDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric"
  });
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
