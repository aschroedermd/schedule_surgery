import { AlertTriangle, ArrowRightLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, RefreshCw, Send, ShieldCheck, Trash2, Users, Wand2, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteCallOffRequest,
  generateCallScheduleDraft,
  publishCallSchedule,
  submitCallOffRequest
} from "./api";
import {
  CALL_BUILDER_GOALS,
  evaluateCallSchedule,
  getCallBuilderBlock,
  getCallBuilderDates,
  getCallBuilderResidentsForPosition,
  getCallBuilderWeekendAnchor,
  suggestCallScheduleMoves
} from "../shared/callBuilder";
import { addDays, displayDate, parseLocalDate } from "../shared/date";
import { comparePersonNames } from "../shared/names";
import { getRotationForDate, ROTATION_BLOCK_DATES, getTodayDate } from "../shared/rotations";
import {
  getBlockCallOffRequests,
  getCallOffRequestDates,
  getCallOffRequestResidentIdsByDate,
  groupCallOffRequestsByResident
} from "./callOffRequestCalendar";
import {
  CALL_POSITIONS,
  CallBuilderAssignment,
  CallOffRequest,
  CallOffRequestPriority,
  CallOffRequestScope,
  PlannerState,
  Resident
} from "../shared/types";

type Mutate = (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;

export function CallOffRequestForm({
  state,
  token,
  linkedResident,
  canBuildCall,
  onClose,
  onMutate
}: {
  state: PlannerState;
  token: string;
  linkedResident?: Resident;
  canBuildCall: boolean;
  onClose: () => void;
  onMutate: Mutate;
}) {
  const residentOptions = state.residents.filter((resident) => resident.rosterKind === "primary" && resident.trainingLevel !== "Medical Student");
  const [residentId, setResidentId] = useState(linkedResident?.id ?? (canBuildCall ? residentOptions[0]?.id ?? "" : ""));
  const [date, setDate] = useState(getNextCallDate(getTodayDate()));
  const [scope, setScope] = useState<CallOffRequestScope>("weekend");
  const [priority, setPriority] = useState<CallOffRequestPriority>("priority");
  const [reason, setReason] = useState("");
  const selectedResident = state.residents.find((resident) => resident.id === residentId);
  const requests = state.callOffRequests
    .filter((request) => request.residentId === residentId)
    .sort((left, right) => left.date.localeCompare(right.date) || left.priority.localeCompare(right.priority));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!residentId) return;
    await onMutate(
      () => submitCallOffRequest(token, { residentId, date, scope, priority, reason: reason.trim() || undefined }),
      `${priority === "priority" ? "Priority" : "Secondary"} call-off request saved`
    );
  }

  return (
    <section className="call-request-panel" aria-label="Request a call weekend or day off">
      <header className="call-request-heading">
        <div>
          <p className="eyebrow">Resident preference</p>
          <h3>Request call time off</h3>
          <p>Choose one priority and one secondary preference per block. Saving again updates that preference.</p>
        </div>
        <button type="button" className="icon-button" aria-label="Close call-off request" onClick={onClose}>×</button>
      </header>

      {!selectedResident ? (
        <div className="alert danger">Your account is not linked to a resident roster record. Ask an administrator to link it before submitting.</div>
      ) : (
        <form className="call-request-form" onSubmit={submit}>
          {canBuildCall && (
            <label>
              Resident
              <select value={residentId} onChange={(event) => setResidentId(event.target.value)}>
                {residentOptions.map((resident) => <option key={resident.id} value={resident.id}>{resident.name}</option>)}
              </select>
            </label>
          )}
          {!canBuildCall && <div className="call-request-resident"><span>Resident</span><strong>{selectedResident.name}</strong></div>}
          <label>
            Preference
            <select value={priority} onChange={(event) => setPriority(event.target.value as CallOffRequestPriority)}>
              <option value="priority">Priority request</option>
              <option value="secondary">Secondary request</option>
            </select>
          </label>
          <label>
            Date
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
          </label>
          <label>
            Applies to
            <select value={scope} onChange={(event) => setScope(event.target.value as CallOffRequestScope)}>
              <option value="weekend">Entire Fri–Sun weekend</option>
              <option value="day">Only this day</option>
            </select>
          </label>
          <label className="call-request-reason">
            Optional reason
            <input value={reason} maxLength={280} onChange={(event) => setReason(event.target.value)} placeholder="Personal event (no patient information)" />
          </label>
          <button className="primary-button" type="submit"><Send size={16} />Save request</button>
        </form>
      )}

      {requests.length > 0 && (
        <div className="call-request-saved-list">
          <strong>Saved preferences for {selectedResident?.name}</strong>
          {requests.map((request) => (
            <div key={request.id} className="call-request-saved-item">
              <span className={`call-request-priority ${request.priority}`}>{request.priority}</span>
              <span>{displayDate(request.date)} · {request.scope === "weekend" ? "whole weekend" : "that day"}</span>
              {request.reason && <span className="muted-copy">{request.reason}</span>}
              <button
                type="button"
                className="icon-button"
                title="Withdraw request"
                onClick={() => onMutate(() => deleteCallOffRequest(token, request.id), "Call-off request withdrawn")}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function CallBuilderTab({
  state,
  token,
  onMutate
}: {
  state: PlannerState;
  token: string;
  onMutate: Mutate;
}) {
  const [blockNumber, setBlockNumber] = useState(() => getDefaultBlockNumber());
  const [assignments, setAssignments] = useState<CallBuilderAssignment[] | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [offCallRequestsOpen, setOffCallRequestsOpen] = useState(false);
  const block = getCallBuilderBlock(blockNumber)!;
  const offCallResidentCount = new Set(getBlockCallOffRequests(state.callOffRequests, block).map((request) => request.residentId)).size;
  const evaluation = useMemo(
    () => assignments ? evaluateCallSchedule(state, blockNumber, assignments) : undefined,
    [assignments, blockNumber, state]
  );
  const suggestions = useMemo(
    () => evaluation ? suggestCallScheduleMoves(state, blockNumber, evaluation.assignments, 4) : [],
    [evaluation, blockNumber, state]
  );
  const weekendAnchors = [...new Set(getCallBuilderDates(blockNumber).map(getCallBuilderWeekendAnchor))];

  async function buildSchedule() {
    try {
      setBusy(true);
      setError(undefined);
      const result = await generateCallScheduleDraft(token, blockNumber);
      setAssignments(result.assignments);
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "The call schedule could not be built");
    } finally {
      setBusy(false);
    }
  }

  function loadPublishedSchedule() {
    const published = state.coverageEntries
      .filter((entry) => entry.kind === "call" && entry.callPosition && entry.residentId && entry.date >= block.startDate && entry.date <= block.endDate)
      .map((entry): CallBuilderAssignment => ({ date: entry.date, callPosition: entry.callPosition!, residentId: entry.residentId! }));
    if (!published.length) {
      setError("No published resident call schedule exists for this block yet.");
      return;
    }
    setError(undefined);
    setAssignments(published);
  }

  function updateAssignment(date: string, callPosition: CallBuilderAssignment["callPosition"], residentId: string) {
    setAssignments((current) => {
      const withoutSlot = (current ?? []).filter((assignment) => assignment.date !== date || assignment.callPosition !== callPosition);
      return residentId ? [...withoutSlot, { date, callPosition, residentId }] : withoutSlot;
    });
  }

  return (
    <section className="call-builder-page">
      <div className="call-builder-toolbar">
        <div>
          <p className="eyebrow">Protected scheduling workspace</p>
          <h2>Call Builder</h2>
          <p>Build a fair draft, adjust any resident manually, then publish it to CALL.</p>
        </div>
        <div className="call-builder-actions">
          <label>
            Rotation block
            <select
              value={blockNumber}
              onChange={(event) => {
                setBlockNumber(Number(event.target.value));
                setAssignments(undefined);
                setError(undefined);
              }}
            >
              {ROTATION_BLOCK_DATES.map((rotationBlock) => (
                <option key={rotationBlock.blockNumber} value={rotationBlock.blockNumber}>
                  Block {rotationBlock.blockNumber} · {rotationBlock.startDate}–{rotationBlock.endDate}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="secondary-button call-off-requests-button" onClick={() => setOffCallRequestsOpen(true)}>
            <Users size={16} />Off Call Requests{offCallResidentCount > 0 && <span>{offCallResidentCount}</span>}
          </button>
          <button type="button" className="secondary-button" onClick={loadPublishedSchedule}><RefreshCw size={16} />Load published</button>
          <button type="button" className="primary-button" disabled={busy} onClick={buildSchedule}><Wand2 size={17} />{busy ? "Building…" : "Build schedule"}</button>
        </div>
      </div>

      {offCallRequestsOpen && (
        <OffCallRequestsModal
          state={state}
          initialBlockNumber={blockNumber}
          onClose={() => setOffCallRequestsOpen(false)}
        />
      )}

      {error && <div className="alert danger">{error}</div>}

      {!evaluation ? (
        <CallBuilderStartState state={state} blockNumber={blockNumber} />
      ) : (
        <>
          <CallBuilderScorecard evaluation={evaluation} />
          <div className="call-builder-workspace">
            <div className="call-builder-main">
              <div className="call-builder-weekends">
                {weekendAnchors.map((anchor) => (
                  <CallBuilderWeekend
                    key={anchor}
                    state={state}
                    anchor={anchor}
                    assignments={evaluation.assignments}
                    onChange={updateAssignment}
                  />
                ))}
              </div>

              <section className="call-builder-review-panel">
                <header>
                  <div>
                    <p className="eyebrow">Live validity check</p>
                    <h3>{evaluation.hardViolationCount ? "Resolve blockers" : evaluation.warningCount ? "Review tradeoffs" : "Ready to publish"}</h3>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={evaluation.hardViolationCount > 0}
                    onClick={() => onMutate(
                      () => publishCallSchedule(token, blockNumber, evaluation.assignments),
                      `Block ${blockNumber} call schedule published`
                    )}
                  >
                    <ShieldCheck size={17} />Publish to CALL
                  </button>
                </header>
                {evaluation.issues.length === 0 ? (
                  <div className="call-builder-perfect"><CheckCircle2 size={19} />All configured rules are satisfied.</div>
                ) : (
                  <div className="call-builder-issue-list">
                    {evaluation.issues.map((issue) => (
                      <div key={issue.id} className={`call-builder-issue ${issue.severity}`}>
                        {issue.severity === "error" ? <AlertTriangle size={16} /> : issue.severity === "warning" ? <AlertTriangle size={16} /> : <CalendarDays size={16} />}
                        <div><strong>{formatRule(issue.rule)}</strong><span>{issue.message}</span></div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <aside className="call-builder-sidebar">
              <CallBuilderSuggestions suggestions={suggestions} onApply={setAssignments} />
              <CallBuilderInputs state={state} blockNumber={blockNumber} />
              <CallBuilderFairness state={state} evaluation={evaluation} />
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

function OffCallRequestsModal({
  state,
  initialBlockNumber,
  onClose
}: {
  state: PlannerState;
  initialBlockNumber: number;
  onClose: () => void;
}) {
  const [blockNumber, setBlockNumber] = useState(initialBlockNumber);
  const [selectedDate, setSelectedDate] = useState<string>();
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const blockIndex = ROTATION_BLOCK_DATES.findIndex((block) => block.blockNumber === blockNumber);
  const block = getCallBuilderBlock(blockNumber)!;
  const blockRequests = useMemo(
    () => getBlockCallOffRequests(state.callOffRequests, block),
    [state.callOffRequests, block]
  );
  const residentsByDate = useMemo(
    () => getCallOffRequestResidentIdsByDate(blockRequests, block),
    [blockRequests, block]
  );
  const residentGroups = useMemo(
    () => groupCallOffRequestsByResident(blockRequests, state.residents, block),
    [blockRequests, state.residents, block]
  );
  const residentNames = useMemo(
    () => new Map(state.residents.map((resident) => [resident.id, resident.name])),
    [state.residents]
  );
  const selectedResidentNames = (selectedDate ? residentsByDate[selectedDate] ?? [] : [])
    .map((residentId) => residentNames.get(residentId) ?? residentId)
    .sort(comparePersonNames);
  const dates = getDatesInRange(block.startDate, block.endDate);
  const leadingBlanks = (parseLocalDate(block.startDate).getDay() + 6) % 7;
  const calendarCells: Array<string | undefined> = [
    ...Array.from({ length: leadingBlanks }, () => undefined),
    ...dates
  ];
  while (calendarCells.length % 7 !== 0) calendarCells.push(undefined);

  useEffect(() => {
    closeButtonRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  function moveBlock(direction: -1 | 1) {
    const nextBlock = ROTATION_BLOCK_DATES[blockIndex + direction];
    if (!nextBlock) return;
    setBlockNumber(nextBlock.blockNumber);
    setSelectedDate(undefined);
  }

  return (
    <div className="off-call-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="off-call-modal" role="dialog" aria-modal="true" aria-labelledby="off-call-modal-title">
        <header className="off-call-modal-header">
          <button type="button" className="icon-button" aria-label="Previous rotation block" disabled={blockIndex <= 0} onClick={() => moveBlock(-1)}>
            <ChevronLeft size={19} />
          </button>
          <div>
            <p className="eyebrow">Off Call Requests</p>
            <h2 id="off-call-modal-title">Block {blockNumber}</h2>
            <span>{formatCompactDate(block.startDate)}–{formatCompactDate(block.endDate)} · {residentGroups.length} resident{residentGroups.length === 1 ? "" : "s"}</span>
          </div>
          <button type="button" className="icon-button" aria-label="Next rotation block" disabled={blockIndex >= ROTATION_BLOCK_DATES.length - 1} onClick={() => moveBlock(1)}>
            <ChevronRight size={19} />
          </button>
          <button ref={closeButtonRef} type="button" className="icon-button off-call-modal-close" aria-label="Close off-call requests" onClick={onClose}>
            <X size={18} />
          </button>
        </header>

        <div className="off-call-calendar" aria-label={`Block ${blockNumber} off-call request calendar`}>
          <div className="off-call-calendar-weekdays" aria-hidden="true">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => <span key={day}>{day}</span>)}
          </div>
          <div className="off-call-calendar-grid">
            {calendarCells.map((date, index) => {
              if (!date) return <span key={`blank-${index}`} className="off-call-calendar-blank" />;
              const count = residentsByDate[date]?.length ?? 0;
              return (
                <button
                  key={date}
                  type="button"
                  className={`${count ? "has-requests" : ""}${selectedDate === date ? " selected" : ""}`}
                  disabled={count === 0}
                  aria-label={`${formatLongDate(date)}: ${count} resident${count === 1 ? "" : "s"} requested off call`}
                  onClick={() => setSelectedDate(date)}
                >
                  <time dateTime={date}>{formatCalendarDate(date)}</time>
                  {count > 0 && <strong>{count}</strong>}
                </button>
              );
            })}
          </div>
        </div>

        <div className={`off-call-selected-date${selectedDate ? " active" : ""}`} aria-live="polite">
          {selectedDate ? (
            <>
              <strong>{formatLongDate(selectedDate)}</strong>
              <div>{selectedResidentNames.map((name) => <span key={name}>{name}</span>)}</div>
            </>
          ) : (
            <span>Select a numbered date to see who requested it off.</span>
          )}
        </div>

        <section className="off-call-resident-section" aria-label="Residents with off-call requests">
          <header><strong>Requests by resident</strong><span>Alphabetical · {blockRequests.length} preference{blockRequests.length === 1 ? "" : "s"}</span></header>
          <div className="off-call-resident-scroll">
            {residentGroups.length === 0 ? (
              <div className="off-call-empty"><CalendarDays size={20} /><span>No off-call requests for this block.</span></div>
            ) : residentGroups.map((group) => (
              <article key={group.residentId} className="off-call-resident-card">
                <strong>{group.residentName}</strong>
                <div>
                  {group.requests.map((request) => (
                    <span key={request.id}>
                      <i className={`call-request-priority ${request.priority}`}>{request.priority}</i>
                      <b>{formatRequestDates(request, block)}</b>
                      <small>{request.scope === "weekend" ? "Entire weekend" : "Requested day"}{request.reason ? ` · ${request.reason}` : ""}</small>
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </div>
  );
}

function CallBuilderWeekend({
  state,
  anchor,
  assignments,
  onChange
}: {
  state: PlannerState;
  anchor: string;
  assignments: CallBuilderAssignment[];
  onChange: (date: string, callPosition: CallBuilderAssignment["callPosition"], residentId: string) => void;
}) {
  const dates = [anchor, addDays(anchor, 1), addDays(anchor, 2)];
  return (
    <article className="call-builder-weekend">
      <header><strong>Weekend of {displayDate(anchor)}</strong><span>Fri/Sun 12h · Sat 24h</span></header>
      <div className="call-builder-day-grid">
        {dates.map((date) => (
          <section key={date} className="call-builder-day">
            <div className="call-builder-day-heading"><strong>{parseLocalDate(date).toLocaleDateString(undefined, { weekday: "long" })}</strong><span>{displayDate(date).replace(/^\w+,?\s*/, "")}</span></div>
            {CALL_POSITIONS.map((callPosition) => {
              const assignment = assignments.find((item) => item.date === date && item.callPosition === callPosition);
              const residents = getCallBuilderResidentsForPosition(state, callPosition);
              return (
                <label key={callPosition}>
                  <span>{formatPosition(callPosition)}</span>
                  <select value={assignment?.residentId ?? ""} onChange={(event) => onChange(date, callPosition, event.target.value)}>
                    <option value="">Unassigned</option>
                    {residents.map((resident) => (
                      <option key={resident.id} value={resident.id}>
                        {resident.name} · {getRotationForDate(resident, date)?.service ?? "no rotation"}
                      </option>
                    ))}
                  </select>
                </label>
              );
            })}
          </section>
        ))}
      </div>
    </article>
  );
}

function CallBuilderScorecard({ evaluation }: { evaluation: ReturnType<typeof evaluateCallSchedule> }) {
  return (
    <div className="call-builder-scorecard">
      <div><span>Quality</span><strong>{evaluation.qualityScore}</strong><small>/ 100</small></div>
      <div><span>Fairness</span><strong>{evaluation.fairnessPercent}%</strong><small>target workload</small></div>
      <div className={evaluation.hardViolationCount ? "has-errors" : "is-clear"}><span>Blocking</span><strong>{evaluation.hardViolationCount}</strong><small>{evaluation.hardViolationCount ? "must resolve" : "valid draft"}</small></div>
      <div><span>Advisories</span><strong>{evaluation.warningCount}</strong><small>review before publish</small></div>
    </div>
  );
}

function CallBuilderSuggestions({
  suggestions,
  onApply
}: {
  suggestions: ReturnType<typeof suggestCallScheduleMoves>;
  onApply: (assignments: CallBuilderAssignment[]) => void;
}) {
  return (
    <section className="call-builder-side-panel">
      <header><ArrowRightLeft size={17} /><div><strong>Suggested moves</strong><span>One-change improvements</span></div></header>
      {suggestions.length === 0 ? <p className="muted-copy">No single swap or replacement improves this draft.</p> : suggestions.map((suggestion) => (
        <div key={suggestion.id} className="call-builder-suggestion">
          <span>{suggestion.description}</span>
          <button type="button" className="secondary-button" onClick={() => onApply(suggestion.assignments)}>Apply</button>
        </div>
      ))}
    </section>
  );
}

function CallBuilderInputs({ state, blockNumber }: { state: PlannerState; blockNumber: number }) {
  const block = getCallBuilderBlock(blockNumber)!;
  const requests = state.callOffRequests
    .filter((request) => request.date >= block.startDate && request.date <= block.endDate)
    .sort((left, right) => Number(left.priority === "secondary") - Number(right.priority === "secondary") || left.date.localeCompare(right.date));
  const vacations = state.residents.flatMap((resident) => (resident.vacation ?? [])
    .filter((vacation) => vacation.endDate >= block.startDate && vacation.startDate <= block.endDate)
    .map((vacation) => ({ resident, vacation })));
  const unavailable = state.residents.flatMap((resident) => resident.unavailable
    .filter((item) => (item.endDate ?? item.date) >= block.startDate && item.date <= block.endDate)
    .map((item) => ({ resident, item })));
  return (
    <section className="call-builder-side-panel">
      <header><CalendarDays size={17} /><div><strong>Scheduling inputs</strong><span>Requests and protected time</span></div></header>
      <InputGroup label={`Call-off requests · ${requests.length}`}>
        {requests.length === 0 ? <span className="muted-copy">None for this block</span> : requests.map((request) => {
          const resident = state.residents.find((candidate) => candidate.id === request.residentId);
          return <span key={request.id}><b className={request.priority === "priority" ? "priority-text" : ""}>{resident?.name ?? request.residentId}</b> · {displayDate(request.date)} · {request.scope}{request.reason ? ` · ${request.reason}` : ""}</span>;
        })}
      </InputGroup>
      <InputGroup label={`Vacations · ${vacations.length}`}>
        {vacations.length === 0 ? <span className="muted-copy">None for this block</span> : vacations.map(({ resident, vacation }) => <span key={`${resident.id}:${vacation.id}`}><b>{resident.name}</b> · {vacation.startDate}–{vacation.endDate}</span>)}
      </InputGroup>
      <InputGroup label={`Approved unavailable · ${unavailable.length}`}>
        {unavailable.length === 0 ? <span className="muted-copy">None for this block</span> : unavailable.map(({ resident, item }) => <span key={`${resident.id}:${item.id}`}><b>{resident.name}</b> · {item.date}{item.endDate ? `–${item.endDate}` : ""} · {item.label}</span>)}
      </InputGroup>
    </section>
  );
}

function InputGroup({ label, children }: { label: string; children: ReactNode }) {
  return <details className="call-builder-input-group" open><summary>{label}</summary><div>{children}</div></details>;
}

function CallBuilderFairness({
  evaluation
}: {
  state: PlannerState;
  evaluation: ReturnType<typeof evaluateCallSchedule>;
}) {
  return (
    <section className="call-builder-side-panel">
      <header><ShieldCheck size={17} /><div><strong>Fairness ledger</strong><span>Saturday = 2 units</span></div></header>
      <div className="call-builder-ledger">
        {CALL_POSITIONS.map((position) => (
          <div key={position} className="call-builder-ledger-group">
            <strong>{formatPosition(position)}</strong>
            {evaluation.residentLoads.filter((load) => load.callPosition === position).map((load) => (
              <span key={load.residentId} className={!load.regularPool ? "reserve" : load.units === load.targetUnits ? "balanced" : "unbalanced"}>
                <b>{load.residentName}</b><i>{load.service}</i><em>{load.regularPool ? `${load.units}/${load.targetUnits}` : load.units ? `${load.units} used` : "reserve"}</em>
              </span>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function CallBuilderStartState({ state, blockNumber }: { state: PlannerState; blockNumber: number }) {
  const block = getCallBuilderBlock(blockNumber)!;
  const requestCount = state.callOffRequests.filter((request) => request.date >= block.startDate && request.date <= block.endDate).length;
  return (
    <div className="call-builder-start">
      <div className="call-builder-start-icon"><Wand2 size={26} /></div>
      <div><h3>Ready to build Block {blockNumber}</h3><p>The engine will fill {getCallBuilderDates(blockNumber).length * 3} positions using rotations, PGY level, vacation, approved unavailable time, and {requestCount} resident request{requestCount === 1 ? "" : "s"}.</p></div>
      <ol>{CALL_BUILDER_GOALS.map((goal) => <li key={goal}>{goal}</li>)}</ol>
    </div>
  );
}

function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) dates.push(date);
  return dates;
}

function formatCalendarDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatCompactDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatLongDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function formatRequestDates(request: CallOffRequest, block: { startDate: string; endDate: string }): string {
  const dates = getCallOffRequestDates(request, block);
  if (dates.length <= 1) return dates[0] ? formatCompactDate(dates[0]) : formatCompactDate(request.date);
  return `${formatCompactDate(dates[0])}–${formatCompactDate(dates.at(-1)!)}`;
}

function getDefaultBlockNumber(): number {
  const today = getTodayDate();
  return ROTATION_BLOCK_DATES.find((block) => block.startDate <= today && today <= block.endDate)?.blockNumber
    ?? ROTATION_BLOCK_DATES.find((block) => block.startDate > today)?.blockNumber
    ?? ROTATION_BLOCK_DATES.at(-1)!.blockNumber;
}

function getNextCallDate(date: string): string {
  for (let offset = 0; offset < 7; offset += 1) {
    const candidate = addDays(date, offset);
    const weekday = parseLocalDate(candidate).getDay();
    if (weekday === 5) return candidate;
  }
  return date;
}

function formatPosition(position: CallBuilderAssignment["callPosition"]): string {
  if (position === "mid-level") return "Mid-level";
  return position.charAt(0).toUpperCase() + position.slice(1);
}

function formatRule(rule: string): string {
  return rule.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
