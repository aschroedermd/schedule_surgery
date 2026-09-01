import { AlertTriangle, ArrowRightLeft, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, FileClock, Lock, Plus, RefreshCw, Save, Send, ShieldCheck, Trash2, Unlock, Users, Wand2, X } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  deleteCallOffRequest,
  deleteCallScheduleDraft,
  generateCallScheduleDraft,
  saveCallScheduleDraft,
  setCallScheduleDraftMain,
  suggestOptimizedCallSchedule,
  submitCallOffRequest
} from "./api";
import {
  CALL_BUILDER_GOALS,
  evaluateCallSchedule,
  getCallBuilderBlock,
  getCallBuilderDates,
  getCallBuilderShiftsForDate,
  getCallBuilderSlots,
  getCallHolidayName,
  getCallBuilderResidentsForPosition,
  getCallBuilderWeekendAnchor,
  getCallPositionForResident,
  getCallUnits,
  isCallRestrictedRotation,
} from "../shared/callBuilder";
import { addDays, displayDate, parseLocalDate } from "../shared/date";
import { getCallOffRequestSeniority } from "../shared/callOffRequests";
import { comparePersonNames } from "../shared/names";
import { getRotationBlockForDate, getRotationForDate, ROTATION_BLOCK_DATES, getTodayDate } from "../shared/rotations";
import {
  getBlockCallOffRequests,
  getCallOffRequestDates,
  getCallOffRequestResidentIdsByDate,
  groupCallOffRequestsByResident
} from "./callOffRequestCalendar";
import {
  CALL_POSITIONS,
  CallBuilderAssignment,
  CallBuilderConstraint,
  CallBuilderSolverSummary,
  CallBuilderSuggestion,
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
    const block = getRotationBlockForDate(date);
    const existingPriority = priority === "priority" && block
      ? state.callOffRequests.find((request) =>
          request.residentId === residentId
          && request.priority === "priority"
          && getRotationBlockForDate(request.date)?.blockNumber === block.blockNumber
        )
      : undefined;
    if (existingPriority && !window.confirm("Do you want to override your previous priority request?")) return;
    await onMutate(
      () => submitCallOffRequest(token, {
        residentId,
        date,
        scope,
        priority,
        reason: reason.trim() || undefined,
        overrideExistingPriority: Boolean(existingPriority)
      }),
      `${priority === "priority" ? "Priority" : "Secondary"} call-off request saved`
    );
  }

  return (
    <section className="call-request-panel" aria-label="Request a call weekend or day off">
      <header className="call-request-heading">
        <div>
          <p className="eyebrow">Resident preference</p>
          <h3>Request call time off</h3>
          <p>Choose one priority and one secondary preference per block. Replacing a priority request requires confirmation.</p>
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
  username,
  onMutate
}: {
  state: PlannerState;
  token: string;
  username: string;
  onMutate: Mutate;
}) {
  const defaultDraft = getMainCallScheduleDraft(state, getDefaultBlockNumber());
  const [blockNumber, setBlockNumber] = useState(() => getDefaultBlockNumber());
  const [assignments, setAssignments] = useState<CallBuilderAssignment[] | undefined>(() => defaultDraft?.assignments);
  const [builderConstraints, setBuilderConstraints] = useState<CallBuilderConstraint[]>(() => defaultDraft?.builderConstraints ?? []);
  const [solverSummary, setSolverSummary] = useState<CallBuilderSolverSummary | undefined>(() => defaultDraft?.solverSummary);
  const [lockedSlotKeys, setLockedSlotKeys] = useState<Set<string>>(() => new Set());
  const [suggestions, setSuggestions] = useState<CallBuilderSuggestion[]>([]);
  const [suggestionsBusy, setSuggestionsBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [offCallRequestsOpen, setOffCallRequestsOpen] = useState(false);
  const block = getCallBuilderBlock(blockNumber)!;
  const offCallResidentCount = new Set(getBlockCallOffRequests(state.callOffRequests, block).map((request) => request.residentId)).size;
  const evaluation = useMemo(
    () => assignments ? evaluateCallSchedule(state, blockNumber, assignments, builderConstraints) : undefined,
    [assignments, blockNumber, builderConstraints, state]
  );
  const callDateGroups = getCallDateGroups(blockNumber);

  async function buildSchedule() {
    try {
      setBusy(true);
      setError(undefined);
      const baselineAssignments = assignments ?? [];
      const lockedAssignments = baselineAssignments.filter((assignment) => lockedSlotKeys.has(callSlotKey(assignment)));
      const result = await generateCallScheduleDraft(token, blockNumber, { baselineAssignments, lockedAssignments, builderConstraints });
      setAssignments(result.assignments);
      setSolverSummary(result.solverSummary);
      setSuggestions([]);
    } catch (buildError) {
      setError(buildError instanceof Error ? buildError.message : "The call schedule could not be built");
    } finally {
      setBusy(false);
    }
  }

  async function findSuggestedMoves() {
    if (!evaluation) return;
    try {
      setSuggestionsBusy(true);
      setError(undefined);
      const lockedAssignments = evaluation.assignments.filter((assignment) => lockedSlotKeys.has(callSlotKey(assignment)));
      setSuggestions(await suggestOptimizedCallSchedule(token, blockNumber, evaluation.assignments, lockedAssignments, builderConstraints));
    } catch (suggestionError) {
      setError(suggestionError instanceof Error ? suggestionError.message : "Suggested moves could not be calculated");
    } finally {
      setSuggestionsBusy(false);
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
    setSolverSummary({
      engine: "manual",
      engineVersion: "published-call-import",
      status: "manual",
      optimalityProven: false,
      durationMs: 0,
      objectives: [],
      message: "Loaded from the published CALL calendar."
    });
    setLockedSlotKeys(new Set());
    setBuilderConstraints([]);
    setSuggestions([]);
  }

  function updateAssignment(date: string, callPosition: CallBuilderAssignment["callPosition"], residentId: string, shift?: CallBuilderAssignment["shift"]) {
    setAssignments((current) => {
      const withoutSlot = (current ?? []).filter((assignment) => callSlotKey(assignment) !== callSlotKey({ date, callPosition, shift }));
      return residentId ? [...withoutSlot, { date, callPosition, residentId, ...(shift === "holiday-day" ? { shift } : {}) }] : withoutSlot;
    });
    setSolverSummary(undefined);
    setSuggestions([]);
  }

  return (
    <section className="call-builder-page">
      <div className="call-builder-toolbar">
        <div>
          <p className="eyebrow">Protected scheduling workspace</p>
          <h2>Call Builder</h2>
          <p>Build an optimized draft, lock any manual choices, review tradeoffs, and save it for the Call Builder team.</p>
        </div>
        <div className="call-builder-actions">
          <label>
            Rotation block
            <select
              value={blockNumber}
              onChange={(event) => {
                const nextBlockNumber = Number(event.target.value);
                setBlockNumber(nextBlockNumber);
                const nextDraft = getMainCallScheduleDraft(state, nextBlockNumber);
                setAssignments(nextDraft?.assignments);
                setBuilderConstraints(nextDraft?.builderConstraints ?? []);
                setSolverSummary(nextDraft?.solverSummary);
                setLockedSlotKeys(new Set());
                setSuggestions([]);
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

      <CallScheduleDraftPanel
        state={state}
        blockNumber={blockNumber}
        token={token}
        username={username}
        onLoad={(nextAssignments, nextSummary, nextConstraints) => {
          setAssignments(nextAssignments);
          setSolverSummary(nextSummary);
          setBuilderConstraints(nextConstraints);
          setLockedSlotKeys(new Set());
          setSuggestions([]);
        }}
        onMutate={onMutate}
      />

      <CallBuilderInputs state={state} blockNumber={blockNumber} />

      <CallBuilderRequirements
        state={state}
        blockNumber={blockNumber}
        constraints={builderConstraints}
        onChange={(nextConstraints) => {
          setBuilderConstraints(nextConstraints);
          setSolverSummary(undefined);
          setSuggestions([]);
        }}
      />

      {error && <div className="alert danger">{error}</div>}

      {!evaluation ? (
        <CallBuilderStartState state={state} blockNumber={blockNumber} />
      ) : (
        <>
          <CallBuilderScorecard evaluation={evaluation} solverSummary={solverSummary} />
          <div className="call-builder-workspace">
            <div className="call-builder-main">
              <div className="call-builder-weekends">
                {callDateGroups.map((group) => (
                  <CallBuilderWeekend
                    key={group.key}
                    state={state}
                    title={group.title}
                    dates={group.dates}
                    assignments={evaluation.assignments}
                    onChange={updateAssignment}
                    lockedSlotKeys={lockedSlotKeys}
                    onToggleLock={(date, callPosition, shift) => {
                      const key = callSlotKey({ date, callPosition, shift });
                      setLockedSlotKeys((current) => {
                        const next = new Set(current);
                        if (next.has(key)) next.delete(key);
                        else next.add(key);
                        return next;
                      });
                      setSuggestions([]);
                    }}
                  />
                ))}
              </div>

              <section className="call-builder-review-panel">
                <header>
                  <div>
                    <p className="eyebrow">Live validity check</p>
                    <h3>{evaluation.hardViolationCount ? "Draft has blockers" : evaluation.warningCount ? "Review tradeoffs" : "Ready to save"}</h3>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => onMutate(
                      () => saveCallScheduleDraft(token, blockNumber, evaluation.assignments, solverSummary, builderConstraints),
                      `Block ${blockNumber} call schedule draft saved`
                    )}
                  >
                    <Save size={17} />Save draft
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
              <CallBuilderSuggestions
                suggestions={suggestions}
                busy={suggestionsBusy}
                solverSummary={solverSummary}
                lockedCount={lockedSlotKeys.size}
                onFind={() => void findSuggestedMoves()}
                onApply={(nextAssignments, nextSummary) => {
                  setAssignments(nextAssignments);
                  setSolverSummary(nextSummary);
                  setSuggestions([]);
                }}
              />
              <CallBuilderFairness state={state} evaluation={evaluation} />
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

function CallBuilderRequirements({
  state,
  blockNumber,
  constraints,
  onChange
}: {
  state: PlannerState;
  blockNumber: number;
  constraints: CallBuilderConstraint[];
  onChange: (constraints: CallBuilderConstraint[]) => void;
}) {
  const residents = CALL_POSITIONS
    .flatMap((position) => getCallBuilderResidentsForPosition(state, position))
    .sort((left, right) => comparePersonNames(left.name, right.name));
  const callDates = getCallBuilderDates(blockNumber);
  const [residentId, setResidentId] = useState(residents[0]?.id ?? "");
  const [kind, setKind] = useState<CallBuilderConstraint["kind"]>("off");
  const [scope, setScope] = useState<CallOffRequestScope>("weekend");
  const [date, setDate] = useState(callDates[0] ?? "");
  const [shift, setShift] = useState<CallBuilderAssignment["shift"]>(() => getCallBuilderShiftsForDate(callDates[0] ?? "")[0]);
  const [message, setMessage] = useState<string>();

  useEffect(() => {
    const firstDate = getCallBuilderDates(blockNumber)[0] ?? "";
    setDate(firstDate);
    setShift(getCallBuilderShiftsForDate(firstDate)[0]);
    setMessage(undefined);
  }, [blockNumber]);

  function addRequirement(event: FormEvent) {
    event.preventDefault();
    if (!residentId || !date) return;
    const nextScope = kind === "required-call" || !isWeekendDate(date) ? "day" : scope;
    const nextShift = kind === "required-call" ? shift : undefined;
    const duplicate = constraints.some((constraint) =>
      constraint.kind === kind
      && constraint.residentId === residentId
      && constraint.date === date
      && constraint.scope === nextScope
      && (constraint.shift ?? "regular") === (nextShift ?? "regular")
    );
    if (duplicate) {
      setMessage("That build requirement is already listed.");
      return;
    }
    const id = `builder_requirement_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    onChange([...constraints, { id, kind, residentId, date, scope: nextScope, ...(nextShift === "holiday-day" ? { shift: nextShift } : {}) }]);
    setMessage(undefined);
  }

  return (
    <section className="call-builder-requirements" aria-label="Resident-specific call rules">
      <header>
        <div><ShieldCheck size={18} /><span><strong>Resident-specific rules</strong><small>Hard on/off rules for this draft only</small></span></div>
        <b>{constraints.length}</b>
      </header>
      <p>Choose a resident and require a specific weekday, weekend day, or whole weekend on or off. The solver must honor these rules in addition to the standard hierarchy.</p>
      <form onSubmit={addRequirement}>
        <label>
          Resident
          <select value={residentId} onChange={(event) => setResidentId(event.target.value)} required>
            {residents.map((resident) => (
              <option key={resident.id} value={resident.id}>{resident.name} · {formatPosition(getCallPositionForResident(resident)!)}</option>
            ))}
          </select>
        </label>
        <label>
          Requirement
          <select value={kind} onChange={(event) => setKind(event.target.value as CallBuilderConstraint["kind"])}>
            <option value="off">Must be off</option>
            <option value="required-call">Must be on call</option>
          </select>
        </label>
        <label>
          Call day
          <select value={date} onChange={(event) => {
            const nextDate = event.target.value;
            setDate(nextDate);
            setShift(getCallBuilderShiftsForDate(nextDate)[0]);
          }} required>
            {callDates.map((callDate) => <option key={callDate} value={callDate}>{formatCallDateOption(callDate)}</option>)}
          </select>
        </label>
        {kind === "required-call" && (
          <label>
            Shift
            <select value={shift ?? "regular"} onChange={(event) => setShift(event.target.value as CallBuilderAssignment["shift"])}>
              {getCallBuilderShiftsForDate(date).map((callShift) => (
                <option key={callShift} value={callShift}>{callShift === "holiday-day" ? "Holiday daytime · 12h" : "Regular call"}</option>
              ))}
            </select>
          </label>
        )}
        {kind === "off" && isWeekendDate(date) && (
          <label>
            Applies to
            <select value={scope} onChange={(event) => setScope(event.target.value as CallOffRequestScope)}>
              <option value="weekend">Entire Fri–Sun weekend</option>
              <option value="day">Only this day</option>
            </select>
          </label>
        )}
        <button type="submit" className="secondary-button"><Plus size={16} />Add requirement</button>
      </form>
      {message && <span className="call-builder-requirement-error">{message}</span>}
      {constraints.length > 0 && (
        <div className="call-builder-requirement-list">
          {constraints.map((constraint) => {
            const resident = state.residents.find((candidate) => candidate.id === constraint.residentId);
            const anchor = getCallBuilderWeekendAnchor(constraint.date);
            const dateLabel = constraint.kind === "off" && constraint.scope === "weekend" && isWeekendDate(constraint.date)
              ? `${formatCompactDate(anchor)}–${formatCompactDate(addDays(anchor, 2))}`
              : `${formatLongDate(constraint.date)}${constraint.kind === "required-call" ? ` · ${constraint.shift === "holiday-day" ? "holiday daytime" : "regular call"}` : ""}`;
            return (
              <div key={constraint.id}>
                <span className={`call-builder-requirement-kind ${constraint.kind}`}>{constraint.kind === "off" ? "Must be off" : "Must call"}</span>
                <span><strong>{resident?.name ?? constraint.residentId}</strong><small>{dateLabel}</small></span>
                <button type="button" className="icon-button danger" aria-label={`Remove requirement for ${resident?.name ?? constraint.residentId}`} onClick={() => onChange(constraints.filter((item) => item.id !== constraint.id))}>
                  <Trash2 size={15} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CallScheduleDraftPanel({
  state,
  blockNumber,
  token,
  username,
  onLoad,
  onMutate
}: {
  state: PlannerState;
  blockNumber: number;
  token: string;
  username: string;
  onLoad: (
    assignments: CallBuilderAssignment[],
    solverSummary: CallBuilderSolverSummary | undefined,
    builderConstraints: CallBuilderConstraint[]
  ) => void;
  onMutate: Mutate;
}) {
  const drafts = state.callScheduleDrafts
    .filter((draft) => draft.blockNumber === blockNumber)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  return (
    <section className="call-schedule-drafts" aria-label={`Saved call schedule drafts for block ${blockNumber}`}>
      <header>
        <div><FileClock size={18} /><span><strong>Saved drafts</strong><small>Block {blockNumber} · shared with Call Builder users</small></span></div>
        <b>{drafts.length}</b>
      </header>
      {drafts.length === 0 ? (
        <p>No saved drafts for this block yet. Build or edit a schedule, then choose <strong>Save draft</strong>.</p>
      ) : (
        <div className="call-schedule-draft-list">
          {drafts.map((draft) => {
            const isOwner = draft.createdByUsername === username;
            return (
              <article key={draft.id} className={`call-schedule-draft${draft.isMain ? " main" : ""}`}>
                <div className="call-schedule-draft-meta">
                  <strong>{formatDraftTimestamp(draft.createdAt)}</strong>
                  <span>Saved by {draft.createdByName} · {draft.assignments.length} assignments · {(draft.builderConstraints ?? []).length} build requirements · {formatSolverStatus(draft.solverSummary)}</span>
                </div>
                <label className="call-schedule-main-toggle">
                  <input
                    type="checkbox"
                    checked={draft.isMain}
                    onChange={(event) => {
                      const isMain = event.target.checked;
                      if (isMain) onLoad(draft.assignments, draft.solverSummary, draft.builderConstraints ?? []);
                      void onMutate(
                        () => setCallScheduleDraftMain(token, draft.id, isMain),
                        isMain ? `Block ${blockNumber} main draft updated` : `Block ${blockNumber} main draft cleared`
                      );
                    }}
                  />
                  <span>{draft.isMain ? "Main draft" : "Make main"}</span>
                </label>
                <button type="button" className="secondary-button" onClick={() => onLoad(draft.assignments, draft.solverSummary, draft.builderConstraints ?? [])}>Load</button>
                {isOwner && (
                  <button
                    type="button"
                    className="icon-button danger"
                    aria-label={`Delete draft saved ${formatDraftTimestamp(draft.createdAt)}`}
                    title="Delete your draft"
                    onClick={() => {
                      if (!window.confirm(`Delete your block ${blockNumber} draft from ${formatDraftTimestamp(draft.createdAt)}?`)) return;
                      void onMutate(() => deleteCallScheduleDraft(token, draft.id), "Call schedule draft deleted");
                    }}
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </article>
            );
          })}
        </div>
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
  const residentRequestRank = new Map(residentGroups.map((group, index) => [group.residentId, index]));
  const selectedResidentNames = (selectedDate ? residentsByDate[selectedDate] ?? [] : [])
    .sort((left, right) => (residentRequestRank.get(left) ?? Number.MAX_SAFE_INTEGER) - (residentRequestRank.get(right) ?? Number.MAX_SAFE_INTEGER))
    .map((residentId) => residentNames.get(residentId) ?? residentId);
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
          <header><strong>Requests by resident</strong><span>Preference, seniority, then submission time · {blockRequests.length} preference{blockRequests.length === 1 ? "" : "s"}</span></header>
          <div className="off-call-resident-scroll">
            {residentGroups.length === 0 ? (
              <div className="off-call-empty"><CalendarDays size={20} /><span>No off-call requests for this block.</span></div>
            ) : residentGroups.map((group) => (
              <article key={group.residentId} className="off-call-resident-card">
                <strong>{group.residentName} · {getCallOffRequestSeniority(group.trainingLevel).label}</strong>
                <div>
                  {group.requests.map((request) => (
                    <span key={request.id}>
                      <i className={`call-request-priority ${request.priority}`}>{request.priority}</i>
                      <b>{formatRequestDates(request, block)}</b>
                      <small>{request.scope === "weekend" ? "Entire weekend" : "Requested day"} · Submitted {formatDraftTimestamp(request.createdAt)}{request.reason ? ` · ${request.reason}` : ""}</small>
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
  title,
  dates,
  assignments,
  onChange,
  lockedSlotKeys,
  onToggleLock
}: {
  state: PlannerState;
  title: string;
  dates: string[];
  assignments: CallBuilderAssignment[];
  onChange: (date: string, callPosition: CallBuilderAssignment["callPosition"], residentId: string, shift?: CallBuilderAssignment["shift"]) => void;
  lockedSlotKeys: Set<string>;
  onToggleLock: (date: string, callPosition: CallBuilderAssignment["callPosition"], shift?: CallBuilderAssignment["shift"]) => void;
}) {
  return (
    <article className="call-builder-weekend">
      <header><strong>{title}</strong><span>{dates.flatMap((date) => getCallBuilderShiftsForDate(date).map((shift) => formatCallDuration(date, shift))).join(" · ")}</span></header>
      <div className="call-builder-day-grid" style={{ gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))` }}>
        {dates.map((date) => (
          <section key={date} className="call-builder-day">
            <div className="call-builder-day-heading">
              <strong>{parseLocalDate(date).toLocaleDateString(undefined, { weekday: "long" })}</strong>
              <span>{displayDate(date).replace(/^\w+,?\s*/, "")}</span>
              {getCallBuilderShiftsForDate(date).includes("holiday-day") && <em>{getCallHolidayName(date)}</em>}
            </div>
            {getCallBuilderShiftsForDate(date).map((shift) => (
              <div key={shift} className={`call-builder-shift-group ${shift}`}>
                {getCallBuilderShiftsForDate(date).length > 1 && <strong>{shift === "holiday-day" ? "Holiday daytime · 12h" : "Regular evening call · 12h"}</strong>}
                {CALL_POSITIONS.map((callPosition) => {
                  const assignment = assignments.find((item) => item.date === date
                    && (item.shift ?? "regular") === shift
                    && item.callPosition === callPosition);
                  const residents = getCallBuilderResidentsForPosition(state, callPosition);
                  const slot = { date, callPosition, ...(shift === "holiday-day" ? { shift } : {}) };
                  const locked = lockedSlotKeys.has(callSlotKey(slot));
                  return (
                    <div key={callPosition} className={`call-builder-assignment-control${locked ? " locked" : ""}`}>
                      <label>
                        <span>{formatPosition(callPosition)}</span>
                        <select value={assignment?.residentId ?? ""} onChange={(event) => onChange(date, callPosition, event.target.value, shift)}>
                          <option value="">Unassigned</option>
                          {residents.map((resident) => (
                            <option key={resident.id} value={resident.id}>
                              {resident.name} · {getRotationForDate(resident, date)?.service ?? "no rotation"}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="call-builder-lock-button"
                        disabled={!assignment}
                        aria-label={`${locked ? "Unlock" : "Lock"} ${formatPosition(callPosition)} ${shift === "holiday-day" ? "holiday day" : "regular call"} assignment on ${date}`}
                        title={locked ? "Allow optimizer to change this assignment" : "Keep this assignment during optimization"}
                        onClick={() => onToggleLock(date, callPosition, shift)}
                      >
                        {locked ? <Lock size={13} /> : <Unlock size={13} />}
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        ))}
      </div>
    </article>
  );
}

function CallBuilderScorecard({
  evaluation,
  solverSummary
}: {
  evaluation: ReturnType<typeof evaluateCallSchedule>;
  solverSummary?: CallBuilderSolverSummary;
}) {
  return (
    <div className="call-builder-scorecard">
      <div className={solverSummary?.status === "optimal" ? "is-clear" : ""}><span>Solver</span><strong>{formatSolverStatus(solverSummary)}</strong><small>{solverSummary?.durationMs ? `${(solverSummary.durationMs / 1000).toFixed(1)} seconds` : "manual draft"}</small></div>
      <div><span>Fairness</span><strong>{evaluation.fairnessPercent}%</strong><small>achievable load range</small></div>
      <div className={evaluation.hardViolationCount ? "has-errors" : "is-clear"}><span>Blocking</span><strong>{evaluation.hardViolationCount}</strong><small>{evaluation.hardViolationCount ? "must resolve" : "valid draft"}</small></div>
      <div><span>Advisories</span><strong>{evaluation.warningCount}</strong><small>review before saving</small></div>
    </div>
  );
}

function CallBuilderSuggestions({
  suggestions,
  busy,
  solverSummary,
  lockedCount,
  onFind,
  onApply
}: {
  suggestions: CallBuilderSuggestion[];
  busy: boolean;
  solverSummary?: CallBuilderSolverSummary;
  lockedCount: number;
  onFind: () => void;
  onApply: (assignments: CallBuilderAssignment[], solverSummary?: CallBuilderSolverSummary) => void;
}) {
  return (
    <section className="call-builder-side-panel">
      <header><ArrowRightLeft size={17} /><div><strong>Optimizer</strong><span>{lockedCount ? `${lockedCount} assignment${lockedCount === 1 ? "" : "s"} locked` : "Coordinated schedule improvements"}</span></div></header>
      {solverSummary?.message && <p className={`call-builder-solver-message ${solverSummary.status}`}>{solverSummary.message}</p>}
      {solverSummary?.objectives.length ? (
        <details className="call-builder-objectives">
          <summary>Hierarchy result</summary>
          <div>{solverSummary.objectives.filter((objective) => objective.key !== "stable-tie-break").map((objective) => (
            <span key={objective.key}><b>{objective.label}</b><em>{objective.value}</em></span>
          ))}</div>
        </details>
      ) : null}
      <button type="button" className="secondary-button call-builder-find-moves" disabled={busy} onClick={onFind}>
        <Wand2 size={15} />{busy ? "Optimizing…" : "Find best moves"}
      </button>
      {!busy && suggestions.length === 0 ? <p className="muted-copy">Run the optimizer to look for a better coordinated schedule while preserving locked assignments.</p> : suggestions.map((suggestion) => (
        <div key={suggestion.id} className="call-builder-suggestion">
          <span>{suggestion.description}</span>
          <button type="button" className="secondary-button" onClick={() => onApply(suggestion.assignments, suggestion.solverSummary)}>Apply</button>
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
  const rotationUnavailable = state.residents.flatMap((resident) => (resident.rotationSchedule ?? [])
    .filter((rotation) => rotation.endDate >= block.startDate && rotation.startDate <= block.endDate && isCallRestrictedRotation(rotation.service))
    .map((rotation) => ({ resident, rotation })))
    .sort((left, right) => comparePersonNames(left.resident.name, right.resident.name));
  const holidays = getCallBuilderDates(blockNumber)
    .map((date) => ({ date, name: getCallHolidayName(date) }))
    .filter((holiday): holiday is { date: string; name: string } => Boolean(holiday.name) && getCallBuilderShiftsForDate(holiday.date).includes("holiday-day"));
  return (
    <section className="call-builder-side-panel call-builder-inputs-panel">
      <header><CalendarDays size={17} /><div><strong>Scheduling inputs</strong><span>Visible before building · requests, protected time, and rotation exclusions</span></div></header>
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
      <InputGroup label={`Rotation unavailable · ${rotationUnavailable.length}`}>
        {rotationUnavailable.length === 0 ? <span className="muted-copy">None for this block</span> : rotationUnavailable.map(({ resident, rotation }) => <span key={`${resident.id}:${rotation.id}`}><b>{resident.name}</b> · {rotation.service} · unavailable for general surgery call</span>)}
      </InputGroup>
      <InputGroup label={`Weekday holiday day shifts · ${holidays.length}`}>
        {holidays.length === 0 ? <span className="muted-copy">None for this block</span> : holidays.map((holiday) => <span key={holiday.date}><b>{holiday.name}</b> · {formatLongDate(holiday.date)}</span>)}
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
      <header><ShieldCheck size={17} /><div><strong>Fairness ledger</strong><span>12h = 1 unit · 24h = 2 units</span></div></header>
      <div className="call-builder-ledger">
        {CALL_POSITIONS.map((position) => (
          <div key={position} className="call-builder-ledger-group">
            <strong>{formatPosition(position)}</strong>
            {evaluation.residentLoads.filter((load) => load.callPosition === position).map((load) => (
              <span key={load.residentId} className={!load.regularPool ? "reserve" : load.units >= load.targetMinUnits && load.units <= load.targetMaxUnits ? "balanced" : "unbalanced"}>
                <b>{load.residentName}</b><i>{load.service}</i><em>{load.regularPool ? `${load.units}/${formatTargetRange(load.targetMinUnits, load.targetMaxUnits)}` : load.units ? `${load.units} used` : "reserve"}</em>
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
      <div><h3>Ready to build Block {blockNumber}</h3><p>The engine will fill {getCallBuilderSlots(blockNumber).length} positions using rotations, PGY level, vacation, approved unavailable time, resident-specific rules, weekday holiday shifts, and {requestCount} resident request{requestCount === 1 ? "" : "s"}.</p></div>
      <ol>{CALL_BUILDER_GOALS.map((goal) => <li key={goal}>{goal}</li>)}</ol>
    </div>
  );
}

function getCallDateGroups(blockNumber: number): Array<{ key: string; title: string; dates: string[] }> {
  const callDates = getCallBuilderDates(blockNumber);
  const callDateSet = new Set(callDates);
  const weekendAnchors = [...new Set(callDates.filter(isWeekendDate).map(getCallBuilderWeekendAnchor))];
  const groups = weekendAnchors.map((anchor) => ({
    key: `weekend:${anchor}`,
    title: `Weekend of ${displayDate(anchor)}`,
    dates: [anchor, addDays(anchor, 1), addDays(anchor, 2)].filter((date) => callDateSet.has(date))
  }));
  for (const date of callDates.filter((candidate) => !isWeekendDate(candidate))) {
    groups.push({
      key: `holiday:${date}`,
      title: `${getCallHolidayName(date) ?? "Holiday"} call · ${displayDate(date)}`,
      dates: [date]
    });
  }
  return groups.sort((left, right) => left.dates[0].localeCompare(right.dates[0]));
}

function isWeekendDate(date: string): boolean {
  const weekday = parseLocalDate(date).getDay();
  return weekday === 5 || weekday === 6 || weekday === 0;
}

function formatCallDuration(date: string, shift: CallBuilderAssignment["shift"]): string {
  const weekday = parseLocalDate(date).toLocaleDateString(undefined, { weekday: "short" });
  if (shift === "holiday-day") return `${weekday} holiday day 12h`;
  return `${weekday} ${getCallUnits(date, shift) * 12}h${getCallBuilderShiftsForDate(date).length > 1 ? " evening" : ""}`;
}

function formatCallDateOption(date: string): string {
  const holiday = getCallHolidayName(date);
  const shifts = getCallBuilderShiftsForDate(date);
  if (shifts.length > 1) return `${formatLongDate(date)} · ${holiday} daytime + regular evening call`;
  if (shifts[0] === "holiday-day") return `${formatLongDate(date)} · ${holiday} daytime (12h)`;
  return `${formatLongDate(date)} · ${getCallUnits(date) * 12}h`;
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

function formatDraftTimestamp(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function getMainCallScheduleDraft(state: PlannerState, blockNumber: number) {
  return state.callScheduleDrafts.find((draft) => draft.blockNumber === blockNumber && draft.isMain);
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

function callSlotKey(assignment: Pick<CallBuilderAssignment, "date" | "callPosition" | "shift">): string {
  return `${assignment.date}:${assignment.shift ?? "regular"}:${assignment.callPosition}`;
}

function formatTargetRange(min: number, max: number): string {
  return min === max ? String(min) : `${min}–${max}`;
}

function formatSolverStatus(summary: CallBuilderSolverSummary | undefined): string {
  if (!summary) return "Manual";
  if (summary.status === "optimal") return "Optimal";
  if (summary.status === "feasible") return "Best found";
  if (summary.status === "fallback") return "Fallback";
  if (summary.status === "infeasible") return "Infeasible";
  return "Manual";
}

function formatRule(rule: string): string {
  return rule.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
}
