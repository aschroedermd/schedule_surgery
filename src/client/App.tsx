import {
  CalendarDays,
  ClipboardCopy,
  Lock,
  LogIn,
  LogOut,
  Plus,
  RefreshCw,
  Scissors,
  Trash2,
  Unlock,
  UserPlus,
  Wand2
} from "lucide-react";
import type { CSSProperties, FormEvent } from "react";
import { useEffect, useState } from "react";
import {
  claimCoverage,
  createAssignment,
  createEntity,
  deleteAssignment,
  deleteEntity,
  fetchSchedule,
  fetchSession,
  fetchState,
  getUncoveredMessage,
  login,
  runSuggestion,
  Session,
  UnauthorizedError,
  updateAssignment,
  updateEntity
} from "./api";
import { CalendarTab, RequestsTab } from "./CoverageCalendar";
import { AccountTab, PasswordChangeRequiredScreen, UsersTab } from "./UsersTab";
import { addDays, displayDate, getCurrentMonday, getMondayForDate, parseLocalDate } from "../shared/date";
import { createId } from "../shared/id";
import {
  Assignment,
  Attending,
  AttendingBlock,
  ClinicSession,
  CollectionName,
  Hospital,
  PlannerState,
  ProcedureDefault,
  Resident,
  Role,
  SERVICE_LINES,
  ScheduledBlock,
  ScheduledCase,
  ScheduledClinicSession,
  SurgeryCase,
  TrainingLevel,
  UserSummary,
  Week,
  WeekSchedule
} from "../shared/types";
import {
  DEFAULT_SERVICE_LINE,
  clinicMatchesService,
  getAttendingsForService,
  getStateServiceLines,
  isResidentOnService,
  sortResidentsForService
} from "../shared/services";

type Tab = "board" | "calendar" | "requests" | "entry" | "roster" | "defaults" | "activity" | "users" | "account";
type PlannerSession = Session;

const emptyResident: Resident = {
  id: "",
  name: "",
  trainingLevel: "PGY3",
  serviceTags: [DEFAULT_SERVICE_LINE],
  color: "#2f78c4",
  tags: [],
  trainingInterests: [],
  unavailable: []
};

export function App() {
  const [session, setSession] = useState<PlannerSession | undefined>(() => getStoredSession());
  const [showLoggedOut, setShowLoggedOut] = useState(false);
  const [state, setState] = useState<PlannerState | undefined>();
  const [schedule, setSchedule] = useState<WeekSchedule | undefined>();
  const [selectedWeekId, setSelectedWeekId] = useState(() => localStorage.getItem("plannerSelectedWeekId") ?? "");
  const [selectedService, setSelectedService] = useState(() => getStoredServiceLine());
  const [activeTab, setActiveTab] = useState<Tab>("board");
  const [error, setError] = useState<string | undefined>();
  const [toast, setToast] = useState<string | undefined>();

  const selectedWeek = state?.weeks.find((week) => week.id === selectedWeekId);
  const serviceLines = state ? getStateServiceLines(state) : [...SERVICE_LINES];
  const isAdmin = session?.role === "admin";
  const selectedPrivilege = session ? getSessionPrivilege(session, selectedService) : "view";
  const canEditSelectedService = Boolean(session && (isAdmin || selectedPrivilege === "edit"));
  const canRequestSelectedService = Boolean(session && (canEditSelectedService || selectedPrivilege === "request"));
  const canUseRequests = Boolean(session && (isAdmin || hasAnyRequestPrivilege(session)));
  const pendingCoverageRequestCount = state?.coverageRequests.filter((request) => request.status === "pending").length ?? 0;

  function showLoggedOutScreen() {
    clearStoredSession();
    setSession(undefined);
    setState(undefined);
    setSchedule(undefined);
    setError(undefined);
    setToast(undefined);
    setShowLoggedOut(true);
  }

  function handleExpiredSession(error: unknown): boolean {
    if (!(error instanceof UnauthorizedError)) return false;
    showLoggedOutScreen();
    return true;
  }

  function handleLogout() {
    showLoggedOutScreen();
  }

  function handleLogin(nextSession: PlannerSession) {
    setShowLoggedOut(false);
    storeSession(nextSession);
    setSession(nextSession);
  }

  function handlePasswordChanged(user: UserSummary) {
    if (!session) return;
    const nextSession: PlannerSession = {
      ...session,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      servicePrivileges: user.servicePrivileges,
      mustChangePassword: user.mustChangePassword,
      temporaryPasswordExpiresAt: user.temporaryPasswordExpiresAt
    };
    storeSession(nextSession);
    setSession(nextSession);
    setError(undefined);
    setToast("Password changed");
  }

  async function refresh(nextState?: PlannerState, preferredWeekId = selectedWeekId, serviceLine = selectedService) {
    if (!session) return;
    const loadedState = nextState ?? (await fetchState(session.token));
    const weekId = chooseWeekId(loadedState.weeks, preferredWeekId);
    setState(loadedState);
    if (weekId) {
      setSelectedWeekId(weekId);
      localStorage.setItem("plannerSelectedWeekId", weekId);
      setSchedule(await fetchSchedule(session.token, weekId, serviceLine));
    } else {
      setSelectedWeekId("");
      localStorage.removeItem("plannerSelectedWeekId");
      setSchedule(undefined);
    }
  }

  async function runMutation(action: () => Promise<PlannerState | void>, message?: string, preferredWeekId?: string) {
    if (!session) return;
    try {
      setError(undefined);
      const result = await action();
      await refresh(result || undefined, preferredWeekId ?? selectedWeekId);
      if (message) setToast(message);
    } catch (mutationError) {
      if (handleExpiredSession(mutationError)) return;
      setError(mutationError instanceof Error ? mutationError.message : "Something went wrong");
    }
  }

  async function selectWeek(weekId: string) {
    if (!session || !weekId || weekId === selectedWeekId) return;
    try {
      setError(undefined);
      setSelectedWeekId(weekId);
      localStorage.setItem("plannerSelectedWeekId", weekId);
      setSchedule(await fetchSchedule(session.token, weekId, selectedService));
    } catch (loadError) {
      if (handleExpiredSession(loadError)) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load week");
    }
  }

  async function selectServiceLine(serviceLine: string) {
    if (serviceLine === selectedService) return;
    setSelectedService(serviceLine);
    localStorage.setItem("plannerSelectedServiceLine", serviceLine);
    if (!session || !selectedWeekId) return;
    try {
      setError(undefined);
      setSchedule(await fetchSchedule(session.token, selectedWeekId, serviceLine));
    } catch (loadError) {
      if (handleExpiredSession(loadError)) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load service");
    }
  }

  useEffect(() => {
    if (!session) return;
    const token = session.token;
    let cancelled = false;
    async function loadPlanner() {
      try {
        const currentSession = await fetchSession(token);
        if (cancelled) return;
        const nextSession = { token, ...currentSession };
        storeSession(nextSession);
        setSession(nextSession);
        if (nextSession.mustChangePassword) return;
        await refresh();
      } catch (loadError) {
        if (cancelled || handleExpiredSession(loadError)) return;
        setError(loadError instanceof Error ? loadError.message : "Unable to load planner");
      }
    }
    if (session.mustChangePassword) return;
    loadPlanner();
    return () => {
      cancelled = true;
    };
  }, [session?.token, session?.mustChangePassword]);

  useEffect(() => {
    if (!session) return;
    if ((activeTab === "users" || activeTab === "entry" || activeTab === "roster" || activeTab === "defaults") && !isAdmin) {
      setActiveTab("board");
      return;
    }
    if (activeTab === "requests" && !canUseRequests) {
      setActiveTab("board");
    }
  }, [activeTab, canUseRequests, isAdmin, session?.username]);

  if (!session) {
    if (showLoggedOut) {
      return <LoggedOutScreen onReturn={() => setShowLoggedOut(false)} />;
    }
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (session.mustChangePassword) {
    return (
      <PasswordChangeRequiredScreen
        token={session.token}
        username={session.username}
        onPasswordChanged={handlePasswordChanged}
      />
    );
  }

  if (!state || !schedule || !selectedWeek || !selectedWeekId) {
    return <Shell role={session.role} onLogout={handleLogout} error={error}>Loading planner...</Shell>;
  }

  return (
    <Shell role={session.role} onLogout={handleLogout} error={error} toast={toast}>
      <header className="planner-header">
        <div>
          <ServiceLinePicker
            serviceLines={serviceLines}
            selectedService={selectedService}
            onSelect={selectServiceLine}
          />
          <h1>{selectedWeek.label}</h1>
          <p className="week-range">{formatWeekRange(selectedWeek, state.settings.weekdayOnly)}</p>
        </div>
        <div className="header-actions">
          <WeekManager
            state={state}
            selectedWeek={selectedWeek}
            token={session.token}
            disabled={!isAdmin}
            onSelect={selectWeek}
            onMutate={runMutation}
          />
          <button
            title="Refresh"
            className="icon-button"
            onClick={() =>
              refresh(undefined, selectedWeekId, selectedService).catch((refreshError) => {
                if (handleExpiredSession(refreshError)) return;
                setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh planner");
              })
            }
          >
            <RefreshCw size={18} />
          </button>
          {isAdmin && (
            <button
              title="Suggest schedule"
              className="primary-button"
              onClick={() => runMutation(() => runSuggestion(session.token, selectedWeekId, selectedService), "Suggestion refreshed")}
            >
              <Wand2 size={18} />
              Suggest
            </button>
          )}
          <button
            title="Copy uncovered week"
            className="secondary-button"
            onClick={async () => {
              const message = await getUncoveredMessage(session.token, selectedWeekId, undefined, selectedService);
              await navigator.clipboard.writeText(message);
              setToast("Uncovered message copied");
            }}
          >
            <ClipboardCopy size={18} />
            Copy Week
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Planner sections">
        {([
          ["board", "Board"],
          ["calendar", "Calendar"],
          ...(canUseRequests ? [["requests", pendingCoverageRequestCount > 0 ? `Requests (${pendingCoverageRequestCount})` : "Requests"]] as const : []),
          ...(isAdmin ? [["entry", "Cases & Clinic"], ["roster", "Residents"], ["defaults", "Setup"], ["users", "Users"]] as const : []),
          ["activity", "Activity"],
          ["account", "Account"]
        ] as const).map(([tab, label]) => (
          <button key={tab} className={activeTab === tab ? "active" : ""} onClick={() => setActiveTab(tab)}>
            {label}
          </button>
        ))}
      </nav>

      {activeTab === "board" && (
        <BoardTab
          state={state}
          schedule={schedule}
          token={session.token}
          selectedService={selectedService}
          canEdit={canEditSelectedService}
          onMutate={runMutation}
          onCopied={(message) => setToast(message)}
        />
      )}
      {activeTab === "calendar" && (
        <CalendarTab
          state={state}
          token={session.token}
          selectedService={selectedService}
          canEdit={canEditSelectedService}
          canRequest={canRequestSelectedService}
          onMutate={runMutation}
        />
      )}
      {activeTab === "requests" && (
        <RequestsTab
          state={state}
          token={session.token}
          canApprove={canEditSelectedService || isAdmin}
          onMutate={runMutation}
        />
      )}
      {activeTab === "entry" && (
        <EntryTab state={state} week={selectedWeek} token={session.token} selectedService={selectedService} disabled={!isAdmin} onMutate={runMutation} />
      )}
      {activeTab === "roster" && (
        <RosterTab state={state} week={selectedWeek} token={session.token} selectedService={selectedService} disabled={!isAdmin} onMutate={runMutation} />
      )}
      {activeTab === "defaults" && (
        <DefaultsTab state={state} token={session.token} selectedService={selectedService} disabled={!isAdmin} onMutate={runMutation} />
      )}
      {activeTab === "activity" && <ActivityTab state={state} />}
      {activeTab === "users" && isAdmin && (
        <UsersTab token={session.token} serviceLines={serviceLines} onToast={(message) => setToast(message)} />
      )}
      {activeTab === "account" && (
        <AccountTab
          token={session.token}
          username={session.username}
          onToast={(message) => setToast(message)}
          onPasswordChanged={handlePasswordChanged}
        />
      )}
    </Shell>
  );
}

function LoginScreen({ onLogin }: { onLogin: (session: PlannerSession) => void }) {
  const [username, setUsername] = useState("guest");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    try {
      const session = await login(username, password);
      onLogin(session);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Login failed");
    }
  }

  return (
    <main className="login-screen">
      <form className="login-panel" onSubmit={submit}>
        <p className="eyebrow">Resident OR Coverage</p>
        <h1>Coverage Planner</h1>
        <label>
          Username
          <input value={username} onChange={(event) => setUsername(event.target.value)} autoFocus />
        </label>
        <label>
          Password
          <input value={password} type="password" onChange={(event) => setPassword(event.target.value)} />
        </label>
        {error && <p className="error-text">{error}</p>}
        <button className="primary-button" type="submit">
          <CalendarDays size={18} />
          Open Planner
        </button>
      </form>
    </main>
  );
}

function LoggedOutScreen({ onReturn }: { onReturn: () => void }) {
  return (
    <main className="login-screen">
      <section className="login-panel" aria-labelledby="logged-out-title">
        <p className="eyebrow">Resident OR Coverage</p>
        <h1 id="logged-out-title">Logged out...</h1>
        <p className="muted-copy">Go back to login?</p>
        <button className="primary-button" type="button" onClick={onReturn}>
          <LogIn size={18} />
          Back to Login
        </button>
      </section>
    </main>
  );
}

function Shell({
  role,
  children,
  onLogout,
  error,
  toast
}: {
  role: Role;
  children: React.ReactNode;
  onLogout: () => void;
  error?: string;
  toast?: string;
}) {
  return (
    <main className="app-shell">
      <div className="top-strip">
        <span>{roleLabel(role)}</span>
        <button title="Log out" className="icon-button" onClick={onLogout}>
          <LogOut size={18} />
        </button>
      </div>
      {error && <div className="alert danger">{error}</div>}
      {toast && <div className="alert success">{toast}</div>}
      {children}
    </main>
  );
}

function ServiceLinePicker({
  serviceLines,
  selectedService,
  onSelect
}: {
  serviceLines: string[];
  selectedService: string;
  onSelect: (serviceLine: string) => void;
}) {
  return (
    <label className="service-line-picker">
      <Scissors size={16} aria-hidden="true" />
      <select
        aria-label="Service line"
        value={selectedService}
        onChange={(event) => onSelect(event.target.value)}
      >
        {serviceLines.map((serviceLine) => (
          <option key={serviceLine} value={serviceLine}>
            {serviceLine}
          </option>
        ))}
      </select>
    </label>
  );
}

function ServiceTagPicker({
  state,
  selected,
  onChange
}: {
  state: PlannerState;
  selected: string[];
  onChange: (serviceTags: string[]) => void;
}) {
  return (
    <div className="service-tag-picker">
      {serviceLineOptions(state).map((serviceLine) => {
        const checked = selected.includes(serviceLine.id);
        return (
          <label key={serviceLine.id} className="service-tag-option">
            <input
              type="checkbox"
              checked={checked}
              onChange={(event) => {
                const next = event.target.checked
                  ? [...selected, serviceLine.id]
                  : selected.filter((serviceTag) => serviceTag !== serviceLine.id);
                onChange([...new Set(next)]);
              }}
            />
            <span>{serviceLine.name}</span>
          </label>
        );
      })}
    </div>
  );
}

function WeekManager({
  state,
  selectedWeek,
  token,
  disabled,
  onSelect,
  onMutate
}: {
  state: PlannerState;
  selectedWeek: Week;
  token: string;
  disabled: boolean;
  onSelect: (weekId: string) => Promise<void>;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string, preferredWeekId?: string) => Promise<void>;
}) {
  const sortedWeeks = sortWeeks(state.weeks);
  const [newWeekDate, setNewWeekDate] = useState(addDays(selectedWeek.startDate, 7));

  useEffect(() => {
    setNewWeekDate(addDays(selectedWeek.startDate, 7));
  }, [selectedWeek.id, selectedWeek.startDate]);

  async function addWeek(event: FormEvent) {
    event.preventDefault();
    const startDate = getMondayForDate(newWeekDate);
    const existingWeek = state.weeks.find((week) => week.startDate === startDate);
    if (existingWeek) {
      await onSelect(existingWeek.id);
      return;
    }

    const week: Week = {
      id: buildWeekId(startDate),
      startDate,
      label: formatWeekLabel(startDate)
    };
    await onMutate(() => createEntity<Week>(token, "weeks", week), "Week added", week.id);
  }

  async function deleteSelectedWeek() {
    const index = sortedWeeks.findIndex((week) => week.id === selectedWeek.id);
    const fallbackWeek = sortedWeeks[index + 1] ?? sortedWeeks[index - 1];
    if (!fallbackWeek || !window.confirm(`Delete ${selectedWeek.label} and its schedule data?`)) return;
    await onMutate(() => deleteEntity(token, "weeks", selectedWeek.id), "Week deleted", fallbackWeek.id);
  }

  return (
    <form className="week-manager" onSubmit={addWeek}>
      <select
        aria-label="Selected week"
        value={selectedWeek.id}
        onChange={(event) => onSelect(event.target.value)}
      >
        {sortedWeeks.map((week) => (
          <option key={week.id} value={week.id}>
            {week.label} ({formatWeekRange(week, state.settings.weekdayOnly)})
          </option>
        ))}
      </select>
      <input
        aria-label="New week date"
        type="date"
        disabled={disabled}
        value={newWeekDate}
        onChange={(event) => setNewWeekDate(event.target.value)}
      />
      <button className="secondary-button" type="submit" disabled={disabled}>
        <Plus size={16} />
        Week
      </button>
      <button
        title="Delete selected week"
        type="button"
        className="icon-button"
        disabled={disabled || sortedWeeks.length <= 1}
        onClick={deleteSelectedWeek}
      >
        <Trash2 size={15} />
      </button>
    </form>
  );
}

function BoardTab({
  state,
  schedule,
  token,
  selectedService,
  canEdit,
  onMutate,
  onCopied
}: {
  state: PlannerState;
  schedule: WeekSchedule;
  token: string;
  selectedService: string;
  canEdit: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
  onCopied: (message: string) => void;
}) {
  return (
    <section className="board-grid">
      {schedule.days.map((day) => (
        <article key={day.date} className="day-column">
          <header className="day-header">
            <div>
              <h2>{displayDate(day.date)}</h2>
              <span>{day.uncoveredCases.length} uncovered</span>
            </div>
            <button
              title="Copy day"
              className="icon-button"
              onClick={async () => {
                const message = await getUncoveredMessage(token, schedule.week.id, day.date, selectedService);
                await navigator.clipboard.writeText(message);
                onCopied("Day message copied");
              }}
            >
              <ClipboardCopy size={16} />
            </button>
          </header>

          {day.blocks.map((block) => (
            <BlockView
              key={block.id}
              state={state}
              block={block}
              canEdit={canEdit}
              token={token}
              selectedService={selectedService}
              onMutate={onMutate}
            />
          ))}

          {day.clinics.map((clinic) => (
            <ClinicView
              key={clinic.id}
            state={state}
            clinic={clinic}
            canEdit={canEdit}
            token={token}
            selectedService={selectedService}
            onMutate={onMutate}
            />
          ))}
        </article>
      ))}
    </section>
  );
}

function BlockView({
  state,
  block,
  canEdit,
  token,
  selectedService,
  onMutate
}: {
  state: PlannerState;
  block: ScheduledBlock;
  canEdit: boolean;
  token: string;
  selectedService: string;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const hospitalTone = getHospitalTone(block.hospital);
  const allCasesCoveredIndividually = block.cases.length > 0 && block.cases.every((surgeryCase) => surgeryCase.assignment?.kind === "case");
  const blockStyle = {
    borderTopColor: hospitalTone.border,
    "--hospital-bg": hospitalTone.background,
    "--case-bg": hospitalTone.caseBackground
  } as CSSProperties;

  return (
    <section className="block-section" style={blockStyle}>
      <div className="block-title">
        <div>
          <div className="attending-label">
            <span className="attending-marker" style={{ backgroundColor: getAttendingColor(block.attending) }} />
            <strong>{block.attending.name}</strong>
          </div>
          <span>{block.hospital.shortName} · {block.firstCaseStartTime}</span>
          {block.notes && <span>{block.notes}</span>}
        </div>
        <AssignmentControl
          state={state}
          token={token}
          kind="block"
          targetId={block.id}
          assignment={block.assignment}
          coveredWithoutDirectAssignment={allCasesCoveredIndividually}
          emptyLabel={allCasesCoveredIndividually ? "Individually assigned" : undefined}
          disabled={!canEdit}
          claimable={false}
          selectedService={selectedService}
          onMutate={onMutate}
        />
      </div>
      <Warnings warnings={block.warningMessages} />
      <div className="case-list">
        {block.cases.map((surgeryCase) => (
          <CaseRow
            key={surgeryCase.id}
            state={state}
            surgeryCase={surgeryCase}
            canEdit={canEdit}
            token={token}
            selectedService={selectedService}
            onMutate={onMutate}
          />
        ))}
      </div>
    </section>
  );
}

function CaseRow({
  state,
  surgeryCase,
  canEdit,
  token,
  selectedService,
  onMutate
}: {
  state: PlannerState;
  surgeryCase: ScheduledCase;
  canEdit: boolean;
  token: string;
  selectedService: string;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const arrangementWarnings = surgeryCase.warningMessages.filter((warning) => warning === "check arrangement");
  const caseWarnings = surgeryCase.warningMessages.filter((warning) => warning !== "check arrangement");

  return (
    <div className="case-row">
      <div className="case-main">
        <span className="time-pill">{surgeryCase.startTime}-{surgeryCase.endTime}</span>
        <strong>{surgeryCase.procedureLabel}</strong>
        <span>{surgeryCase.durationMinutes} min</span>
      </div>
      <AssignmentControl
        state={state}
        token={token}
        kind="case"
        targetId={surgeryCase.id}
        assignment={surgeryCase.assignment?.kind === "case" ? surgeryCase.assignment : undefined}
        inheritedAssignment={surgeryCase.assignment?.kind === "block" ? surgeryCase.assignment : undefined}
        disabled={!canEdit}
        claimable={false}
        arrangementWarnings={arrangementWarnings}
        selectedService={selectedService}
        onMutate={onMutate}
      />
      <Warnings warnings={caseWarnings} />
    </div>
  );
}

function ClinicView({
  state,
  clinic,
  canEdit,
  token,
  selectedService,
  onMutate
}: {
  state: PlannerState;
  clinic: ScheduledClinicSession;
  canEdit: boolean;
  token: string;
  selectedService: string;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  return (
    <section className="clinic-section">
      <div>
        <strong>{clinic.service} clinic</strong>
        <span>{clinic.startTime}-{clinic.endTime} · {clinic.location}</span>
      </div>
      <div className="clinic-assignments">
        {Array.from({ length: Math.max(clinic.capacity, clinic.assignments.length || 1) }).map((_, index) => (
          <AssignmentControl
            key={`${clinic.id}-${index}`}
            state={state}
            token={token}
            kind="clinic"
            targetId={clinic.id}
            assignment={clinic.assignments[index]}
            disabled={!canEdit}
            claimable={false}
            selectedService={selectedService}
            onMutate={onMutate}
          />
        ))}
      </div>
      <Warnings warnings={clinic.warningMessages} />
    </section>
  );
}

function AssignmentControl({
  state,
  token,
  kind,
  targetId,
  assignment,
  inheritedAssignment,
  coveredWithoutDirectAssignment,
  emptyLabel,
  disabled,
  claimable,
  arrangementWarnings = [],
  selectedService,
  onMutate
}: {
  state: PlannerState;
  token: string;
  kind: "case" | "block" | "clinic";
  targetId: string;
  assignment?: Assignment;
  inheritedAssignment?: Assignment;
  coveredWithoutDirectAssignment?: boolean;
  emptyLabel?: string;
  disabled: boolean;
  claimable: boolean;
  arrangementWarnings?: string[];
  selectedService: string;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const displayedAssignment = assignment ?? inheritedAssignment;
  const isCovered = Boolean(displayedAssignment || coveredWithoutDirectAssignment);
  const residents = sortResidentsForService(state.residents, selectedService);
  const [claimResidentId, setClaimResidentId] = useState(residents[0]?.id ?? "");

  useEffect(() => {
    if (claimResidentId || !residents[0]) return;
    setClaimResidentId(residents[0].id);
  }, [claimResidentId, residents]);

  if (claimable && kind !== "clinic") {
    return (
      <div className="assign-control">
        <select value={claimResidentId} onChange={(event) => setClaimResidentId(event.target.value)}>
          {residents.map((resident) => (
            <option key={resident.id} value={resident.id}>
              {formatResidentOption(resident, selectedService)}
            </option>
          ))}
        </select>
        <button
          title="Claim coverage"
          className="icon-button"
          onClick={() =>
            onMutate(
              () => claimCoverage(token, { scope: kind, targetId, residentId: claimResidentId }),
              "Coverage claimed"
            )
          }
        >
          <UserPlus size={16} />
        </button>
      </div>
    );
  }

  return (
    <div className="assign-control">
      <select
        className={isCovered ? "assignment-select assigned" : "assignment-select unassigned"}
        disabled={disabled}
        value={assignment?.residentId ?? ""}
        onChange={(event) => {
          const residentId = event.target.value;
          if (!residentId && assignment) {
            onMutate(() => deleteAssignment(token, assignment.id), "Assignment cleared");
            return;
          }
          if (residentId) {
            onMutate(
              () =>
                assignment
                  ? updateAssignment(token, assignment.id, { residentId })
                  : createAssignment(token, { kind, targetId, residentId, locked: false }),
              "Assignment saved"
            );
          }
        }}
      >
        <option value="">{emptyLabel ?? (inheritedAssignment ? residentLabel(state, inheritedAssignment.residentId) : "Unassigned")}</option>
        {residents.map((resident) => (
          <option key={resident.id} value={resident.id}>
            {formatResidentOption(resident, selectedService)}
          </option>
        ))}
      </select>
      {assignment && !disabled && (
        <button
          title={assignment.locked ? "Unlock" : "Lock"}
          className="icon-button"
          onClick={() => onMutate(() => updateAssignment(token, assignment.id, { locked: !assignment.locked }), "Assignment updated")}
        >
          {assignment.locked ? <Lock size={16} /> : <Unlock size={16} />}
        </button>
      )}
      {arrangementWarnings.map((warning) => (
        <span key={warning} className="arrangement-badge">{warning}</span>
      ))}
      {displayedAssignment?.source === "viewer-claim" && <span className="claim-badge">claim</span>}
    </div>
  );
}

function EntryTab({
  state,
  week,
  token,
  selectedService,
  disabled,
  onMutate
}: {
  state: PlannerState;
  week: Week;
  token: string;
  selectedService: string;
  disabled: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const serviceAttendings = getAttendingsForService(state.attendings, selectedService);
  const attendingOptions = serviceAttendings;
  const [blockForm, setBlockForm] = useState({
    date: week.startDate,
    attendingId: attendingOptions[0]?.id ?? "",
    hospitalId: state.hospitals[0]?.id ?? "",
    firstCaseStartTime: "07:30"
  });
  const [clinicForm, setClinicForm] = useState({
    date: week.startDate,
    attendingId: attendingOptions[0]?.id ?? "",
    hospitalId: state.hospitals[0]?.id ?? "",
    startTime: "13:00",
    endTime: "17:00",
    service: selectedService,
    location: "",
    capacity: 1
  });
  const weekBlocks = state.attendingBlocks.filter(
    (block) =>
      block.weekId === week.id &&
      getAttendingsForService(state.attendings, selectedService).some((attending) => attending.id === block.attendingId)
  );
  const weekClinics = state.clinicSessions.filter((clinic) => clinic.weekId === week.id && clinicMatchesService(clinic, selectedService));

  useEffect(() => {
    const nextAttendingId = attendingOptions.some((attending) => attending.id === blockForm.attendingId)
      ? blockForm.attendingId
      : attendingOptions[0]?.id ?? "";
    setBlockForm((current) => ({ ...current, date: week.startDate, attendingId: nextAttendingId }));
    setClinicForm((current) => ({
      ...current,
      date: week.startDate,
      attendingId: attendingOptions.some((attending) => attending.id === current.attendingId)
        ? current.attendingId
        : attendingOptions[0]?.id ?? "",
      service: selectedService
    }));
  }, [week.id, week.startDate, selectedService]);

  return (
    <section className="two-column">
      <form
        className="editor-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onMutate(
            () =>
              createEntity<AttendingBlock>(token, "attendingBlocks", {
                id: createId("block"),
                weekId: week.id,
                notes: "",
                ...blockForm
              }),
            "Block added"
          );
        }}
      >
        <h2>OR Blocks</h2>
        <fieldset disabled={disabled}>
          <label>Date<input type="date" min={week.startDate} max={getWeekEndDate(week, state.settings.weekdayOnly)} value={blockForm.date} onChange={(event) => setBlockForm({ ...blockForm, date: event.target.value })} /></label>
          <label>Attending<Select value={blockForm.attendingId} onChange={(attendingId) => setBlockForm({ ...blockForm, attendingId })} options={attendingOptions} /></label>
          <label>Hospital<Select value={blockForm.hospitalId} onChange={(hospitalId) => setBlockForm({ ...blockForm, hospitalId })} options={state.hospitals} labelKey="shortName" /></label>
          <label>First start<input type="time" value={blockForm.firstCaseStartTime} onChange={(event) => setBlockForm({ ...blockForm, firstCaseStartTime: event.target.value })} /></label>
          <button className="primary-button" type="submit" disabled={!blockForm.attendingId}><Plus size={16} />Add Block</button>
        </fieldset>
        <div className="entity-list">
          {weekBlocks.map((block) => (
            <BlockEditor key={block.id} state={state} block={block} token={token} selectedService={selectedService} disabled={disabled} onMutate={onMutate} />
          ))}
        </div>
      </form>

      <form
        className="editor-panel"
        onSubmit={(event) => {
          event.preventDefault();
          onMutate(
            () =>
              createEntity<ClinicSession>(token, "clinicSessions", {
                id: createId("clinic"),
                weekId: week.id,
                ...clinicForm
              }),
            "Clinic added"
          );
        }}
      >
        <h2>Clinic Sessions</h2>
        <fieldset disabled={disabled}>
          <label>Date<input type="date" min={week.startDate} max={getWeekEndDate(week, state.settings.weekdayOnly)} value={clinicForm.date} onChange={(event) => setClinicForm({ ...clinicForm, date: event.target.value })} /></label>
          <label>Attending<Select value={clinicForm.attendingId} onChange={(attendingId) => setClinicForm({ ...clinicForm, attendingId })} options={attendingOptions} /></label>
          <label>Hospital<Select value={clinicForm.hospitalId} onChange={(hospitalId) => setClinicForm({ ...clinicForm, hospitalId })} options={state.hospitals} labelKey="shortName" /></label>
          <label>Start<input type="time" value={clinicForm.startTime} onChange={(event) => setClinicForm({ ...clinicForm, startTime: event.target.value })} /></label>
          <label>End<input type="time" value={clinicForm.endTime} onChange={(event) => setClinicForm({ ...clinicForm, endTime: event.target.value })} /></label>
          <label>Service<Select value={clinicForm.service} onChange={(service) => setClinicForm({ ...clinicForm, service })} options={serviceLineOptions(state)} /></label>
          <label>Location<input value={clinicForm.location} onChange={(event) => setClinicForm({ ...clinicForm, location: event.target.value })} /></label>
          <label>Capacity<input type="number" min={1} value={clinicForm.capacity} onChange={(event) => setClinicForm({ ...clinicForm, capacity: Number(event.target.value) })} /></label>
          <button className="primary-button" type="submit"><Plus size={16} />Add Clinic</button>
        </fieldset>
        <div className="entity-list">
          {weekClinics.map((clinic) => (
            <CompactEntity
              key={clinic.id}
              title={`${clinic.service} clinic`}
              subtitle={`${clinic.date} ${clinic.startTime}-${clinic.endTime} · ${clinic.location}`}
              disabled={disabled}
              onDelete={() => onMutate(() => deleteEntity(token, "clinicSessions", clinic.id), "Clinic deleted")}
            />
          ))}
        </div>
      </form>
    </section>
  );
}

function BlockEditor({
  state,
  block,
  token,
  selectedService,
  disabled,
  onMutate
}: {
  state: PlannerState;
  block: AttendingBlock;
  token: string;
  selectedService: string;
  disabled: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const serviceAttendings = getAttendingsForService(state.attendings, selectedService);
  const attendingOptions = serviceAttendings;
  const [blockDraft, setBlockDraft] = useState({
    date: block.date,
    attendingId: block.attendingId,
    hospitalId: block.hospitalId,
    firstCaseStartTime: block.firstCaseStartTime,
    notes: block.notes
  });
  const [caseForm, setCaseForm] = useState({
    defaultId: state.procedureDefaults[0]?.id ?? "",
    procedureLabel: state.procedureDefaults[0]?.label ?? "",
    durationMinutes: state.procedureDefaults[0]?.durationMinutes ?? 90,
    priority: state.procedureDefaults[0]?.priority ?? 3,
    tags: state.procedureDefaults[0]?.tags.join(", ") ?? ""
  });
  const blockCases = state.cases.filter((surgeryCase) => surgeryCase.blockId === block.id).sort((a, b) => a.order - b.order);
  const attending = state.attendings.find((candidate) => candidate.id === block.attendingId);
  const hospital = state.hospitals.find((candidate) => candidate.id === block.hospitalId);

  useEffect(() => {
    setBlockDraft({
      date: block.date,
      attendingId: block.attendingId,
      hospitalId: block.hospitalId,
      firstCaseStartTime: block.firstCaseStartTime,
      notes: block.notes
    });
  }, [block.attendingId, block.date, block.firstCaseStartTime, block.hospitalId, block.notes]);

  function applyDefault(defaultId: string) {
    const procedureDefault = state.procedureDefaults.find((candidate) => candidate.id === defaultId);
    if (!procedureDefault) return;
    setCaseForm({
      defaultId,
      procedureLabel: procedureDefault.label,
      durationMinutes: procedureDefault.durationMinutes,
      priority: procedureDefault.priority,
      tags: procedureDefault.tags.join(", ")
    });
  }

  return (
    <section className="mini-section">
      <div className="mini-title">
        <strong>{attending?.name}</strong>
        <span>{block.date} · {hospital?.shortName} · {block.firstCaseStartTime}</span>
        <button
          title="Delete block"
          className="icon-button"
          disabled={disabled}
          onClick={() => onMutate(() => deleteEntity(token, "attendingBlocks", block.id), "Block deleted")}
        >
          <Trash2 size={15} />
        </button>
      </div>
      <fieldset disabled={disabled} className="inline-form block-edit-form">
        <input type="date" value={blockDraft.date} onChange={(event) => setBlockDraft({ ...blockDraft, date: event.target.value })} />
        <Select value={blockDraft.attendingId} onChange={(attendingId) => setBlockDraft({ ...blockDraft, attendingId })} options={attendingOptions} />
        <Select value={blockDraft.hospitalId} onChange={(hospitalId) => setBlockDraft({ ...blockDraft, hospitalId })} options={state.hospitals} labelKey="shortName" />
        <input type="time" value={blockDraft.firstCaseStartTime} onChange={(event) => setBlockDraft({ ...blockDraft, firstCaseStartTime: event.target.value })} />
        <input value={blockDraft.notes} placeholder="Room / notes" onChange={(event) => setBlockDraft({ ...blockDraft, notes: event.target.value })} />
        <button
          type="button"
          className="secondary-button"
          onClick={() => onMutate(() => updateEntity<AttendingBlock>(token, "attendingBlocks", block.id, blockDraft), "Block updated")}
        >
          Save Block
        </button>
      </fieldset>
      <fieldset disabled={disabled} className="inline-form">
        <select value={caseForm.defaultId} onChange={(event) => applyDefault(event.target.value)}>
          {state.procedureDefaults.map((procedureDefault) => (
            <option key={procedureDefault.id} value={procedureDefault.id}>{procedureDefault.label}</option>
          ))}
        </select>
        <input value={caseForm.procedureLabel} onChange={(event) => setCaseForm({ ...caseForm, procedureLabel: event.target.value })} />
        <input type="number" min={1} value={caseForm.durationMinutes} onChange={(event) => setCaseForm({ ...caseForm, durationMinutes: Number(event.target.value) })} />
        <button
          type="button"
          className="secondary-button"
          onClick={() =>
            onMutate(
              () =>
                createEntity(token, "cases", {
                  id: createId("case"),
                  blockId: block.id,
                  procedureLabel: caseForm.procedureLabel,
                  durationMinutes: caseForm.durationMinutes,
                  priority: caseForm.priority,
                  tags: splitTags(caseForm.tags),
                  notes: "",
                  order: blockCases.length
                }),
              "Case added"
            )
          }
        >
          <Plus size={15} />Case
        </button>
      </fieldset>
      {blockCases.map((surgeryCase) => (
        <CaseEditor
          key={surgeryCase.id}
          surgeryCase={surgeryCase}
          token={token}
          disabled={disabled}
          onMutate={onMutate}
        />
      ))}
    </section>
  );
}

function CaseEditor({
  surgeryCase,
  token,
  disabled,
  onMutate
}: {
  surgeryCase: SurgeryCase;
  token: string;
  disabled: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    procedureLabel: surgeryCase.procedureLabel,
    durationMinutes: surgeryCase.durationMinutes
  });

  useEffect(() => {
    setDraft({
      procedureLabel: surgeryCase.procedureLabel,
      durationMinutes: surgeryCase.durationMinutes
    });
  }, [surgeryCase.durationMinutes, surgeryCase.procedureLabel]);

  return (
    <fieldset disabled={disabled} className="case-edit-row">
      <input
        value={draft.procedureLabel}
        aria-label="Case name"
        onChange={(event) => setDraft({ ...draft, procedureLabel: event.target.value })}
      />
      <input
        type="number"
        min={1}
        value={draft.durationMinutes}
        aria-label="Duration minutes"
        onChange={(event) => setDraft({ ...draft, durationMinutes: Number(event.target.value) })}
      />
      <button
        type="button"
        className="secondary-button"
        onClick={() => onMutate(() => updateEntity<SurgeryCase>(token, "cases", surgeryCase.id, draft), "Case updated")}
      >
        Save
      </button>
      <button
        title="Delete case"
        type="button"
        className="icon-button"
        onClick={() => onMutate(() => deleteEntity(token, "cases", surgeryCase.id), "Case deleted")}
      >
        <Trash2 size={15} />
      </button>
    </fieldset>
  );
}

function RosterTab({
  state,
  week,
  token,
  selectedService,
  disabled,
  onMutate
}: {
  state: PlannerState;
  week: Week;
  token: string;
  selectedService: string;
  disabled: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState<Resident>(() => makeEmptyResident(selectedService));
  const [offForm, setOffForm] = useState({ date: week.startDate, endDate: "", startTime: "", endTime: "", label: "off" });

  const isExisting = Boolean(state.residents.find((resident) => resident.id === editing.id));

  useEffect(() => {
    setOffForm((current) => ({ ...current, date: week.startDate }));
  }, [week.id, week.startDate]);

  return (
    <section className="two-column">
      <form
        className="editor-panel"
        onSubmit={(event) => {
          event.preventDefault();
          const resident = { ...editing, id: editing.id || createId("res") };
          onMutate(
            () => (isExisting ? updateEntity(token, "residents", resident.id, resident) : createEntity(token, "residents", resident)),
            "Resident saved"
          );
          setEditing(makeEmptyResident(selectedService));
        }}
      >
        <h2>Resident Roster</h2>
        <fieldset disabled={disabled}>
          <label>Name<input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
          <label>Level<select value={editing.trainingLevel} onChange={(event) => setEditing({ ...editing, trainingLevel: event.target.value as TrainingLevel })}>
            {["PGY1", "PGY2", "PGY3", "PGY4", "PGY5", "Fellow"].map((level) => <option key={level}>{level}</option>)}
          </select></label>
          <label>Service tags<ServiceTagPicker state={state} selected={editing.serviceTags} onChange={(serviceTags) => setEditing({ ...editing, serviceTags })} /></label>
          <label>Color<input type="color" value={editing.color ?? "#2f78c4"} onChange={(event) => setEditing({ ...editing, color: event.target.value })} /></label>
          <label>Tags<input value={editing.tags.join(", ")} onChange={(event) => setEditing({ ...editing, tags: splitTags(event.target.value) })} /></label>
          <label>Training interests<input value={editing.trainingInterests.join(", ")} onChange={(event) => setEditing({ ...editing, trainingInterests: splitTags(event.target.value) })} /></label>
          <div className="inline-form">
            <input type="date" value={offForm.date} onChange={(event) => setOffForm({ ...offForm, date: event.target.value })} />
            <input type="date" value={offForm.endDate} onChange={(event) => setOffForm({ ...offForm, endDate: event.target.value })} />
            <input type="time" value={offForm.startTime} onChange={(event) => setOffForm({ ...offForm, startTime: event.target.value })} />
            <input type="time" value={offForm.endTime} onChange={(event) => setOffForm({ ...offForm, endTime: event.target.value })} />
            <input value={offForm.label} onChange={(event) => setOffForm({ ...offForm, label: event.target.value })} />
            <button
              type="button"
              className="secondary-button"
              onClick={() =>
                setEditing({
                  ...editing,
                  unavailable: [
                    ...editing.unavailable,
                    {
                      id: createId("off"),
                      date: offForm.date,
                      endDate: offForm.endDate || undefined,
                      startTime: offForm.startTime || undefined,
                      endTime: offForm.endTime || undefined,
                      label: offForm.label
                    }
                  ]
                })
              }
            >
              <Plus size={15} />Off
            </button>
          </div>
          <button className="primary-button" type="submit"><Plus size={16} />Save Resident</button>
        </fieldset>
        <div className="off-list">
          {editing.unavailable.map((block) => (
            <span key={block.id} className="tag">{block.date}{block.endDate ? ` to ${block.endDate}` : ""} {block.label}</span>
          ))}
        </div>
      </form>

      <section className="editor-panel">
        <h2>Current Residents</h2>
        <div className="entity-list">
          {sortResidentsForService(state.residents, selectedService).map((resident) => (
            <CompactEntity
              key={resident.id}
              title={`${resident.name} · ${resident.trainingLevel}`}
              subtitle={`${formatServiceTags(resident.serviceTags)} · ${resident.trainingInterests.join(", ") || "no interests"} · ${resident.unavailable.length} unavailable`}
              disabled={disabled}
              onEdit={() => setEditing(resident)}
              onDelete={() => onMutate(() => deleteEntity(token, "residents", resident.id), "Resident deleted")}
            />
          ))}
        </div>
      </section>
    </section>
  );
}

function DefaultsTab({
  state,
  token,
  selectedService,
  disabled,
  onMutate
}: {
  state: PlannerState;
  token: string;
  selectedService: string;
  disabled: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const [hospital, setHospital] = useState({ name: "", shortName: "", color: "#2454a6" });
  const [procedureDefault, setProcedureDefault] = useState({ label: "", durationMinutes: 90, priority: 3, tags: "" });

  return (
    <section className="three-column">
      <AttendingsSetup
        state={state}
        token={token}
        selectedService={selectedService}
        disabled={disabled}
        onMutate={onMutate}
      />
      <SetupList
        title="Hospitals"
        disabled={disabled}
        fields={
          <>
            <label>Name<input value={hospital.name} onChange={(event) => setHospital({ ...hospital, name: event.target.value })} /></label>
            <label>Short name<input value={hospital.shortName} onChange={(event) => setHospital({ ...hospital, shortName: event.target.value })} /></label>
            <label>Color<input type="color" value={hospital.color} onChange={(event) => setHospital({ ...hospital, color: event.target.value })} /></label>
          </>
        }
        onAdd={() => onMutate(() => createEntity<Hospital>(token, "hospitals", { id: createId("hosp"), ...hospital }), "Hospital added")}
        items={state.hospitals.map((item) => ({
          id: item.id,
          title: item.name,
          subtitle: item.shortName,
          onDelete: () => onMutate(() => deleteEntity(token, "hospitals", item.id), "Hospital deleted")
        }))}
      />
      <SetupList
        title="Case Defaults"
        disabled={disabled}
        fields={
          <>
            <label>Label<input value={procedureDefault.label} onChange={(event) => setProcedureDefault({ ...procedureDefault, label: event.target.value })} /></label>
            <label>Minutes<input type="number" min={1} value={procedureDefault.durationMinutes} onChange={(event) => setProcedureDefault({ ...procedureDefault, durationMinutes: Number(event.target.value) })} /></label>
            <label>Priority<input type="number" min={1} max={5} value={procedureDefault.priority} onChange={(event) => setProcedureDefault({ ...procedureDefault, priority: Number(event.target.value) })} /></label>
            <label>Tags<input value={procedureDefault.tags} onChange={(event) => setProcedureDefault({ ...procedureDefault, tags: event.target.value })} /></label>
          </>
        }
        onAdd={() =>
          onMutate(
            () =>
              createEntity<ProcedureDefault>(token, "procedureDefaults", {
                id: createId("proc"),
                label: procedureDefault.label,
                durationMinutes: procedureDefault.durationMinutes,
                priority: clampPriority(procedureDefault.priority),
                tags: splitTags(procedureDefault.tags)
              }),
            "Case default added"
          )
        }
        items={state.procedureDefaults.map((item) => ({
          id: item.id,
          title: item.label,
          subtitle: `${item.durationMinutes} min · P${item.priority} · ${item.tags.join(", ")}`,
          onDelete: () => onMutate(() => deleteEntity(token, "procedureDefaults", item.id), "Case default deleted")
        }))}
      />
    </section>
  );
}

function AttendingsSetup({
  state,
  token,
  selectedService,
  disabled,
  onMutate
}: {
  state: PlannerState;
  token: string;
  selectedService: string;
  disabled: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const [attending, setAttending] = useState({
    name: "",
    service: selectedService,
    priority: 3,
    defaultHospitalId: state.hospitals[0]?.id ?? ""
  });

  useEffect(() => {
    setAttending((current) => ({ ...current, service: current.service || selectedService }));
  }, [selectedService]);

  return (
    <form
      className="editor-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onMutate(
          () =>
            createEntity<Attending>(token, "attendings", {
              id: createId("att"),
              ...attending,
              priority: clampPriority(attending.priority)
            }),
          "Attending added"
        );
        setAttending({
          name: "",
          service: selectedService,
          priority: 3,
          defaultHospitalId: state.hospitals[0]?.id ?? ""
        });
      }}
    >
      <h2>Attendings</h2>
      <fieldset disabled={disabled}>
        <label>Name<input value={attending.name} onChange={(event) => setAttending({ ...attending, name: event.target.value })} /></label>
        <label>Service<Select value={attending.service} onChange={(service) => setAttending({ ...attending, service })} options={serviceLineOptions(state)} /></label>
        <label>Priority<input type="number" min={1} max={5} value={attending.priority} onChange={(event) => setAttending({ ...attending, priority: Number(event.target.value) })} /></label>
        <label>Default hospital<Select value={attending.defaultHospitalId} onChange={(defaultHospitalId) => setAttending({ ...attending, defaultHospitalId })} options={state.hospitals} labelKey="shortName" /></label>
        <button className="primary-button" type="submit"><Plus size={16} />Add</button>
      </fieldset>
      <div className="entity-list">
        {state.attendings.map((item) => (
          <div key={item.id} className="compact-entity attending-entity">
            <div>
              <strong>{item.name}</strong>
              <span>{item.service} · P{item.priority}</span>
            </div>
            <div className="row-actions">
              <select
                aria-label={`${item.name} service`}
                disabled={disabled}
                value={item.service}
                onChange={(event) =>
                  onMutate(
                    () => updateEntity<Attending>(token, "attendings", item.id, { service: event.target.value }),
                    "Attending updated"
                  )
                }
              >
                {serviceLineOptions(state).map((serviceLine) => (
                  <option key={serviceLine.id} value={serviceLine.id}>
                    {serviceLine.name}
                  </option>
                ))}
              </select>
              <button
                title="Delete"
                type="button"
                className="icon-button"
                disabled={disabled}
                onClick={() => onMutate(() => deleteEntity(token, "attendings", item.id), "Attending deleted")}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </form>
  );
}

function SetupList({
  title,
  fields,
  items,
  disabled,
  onAdd
}: {
  title: string;
  fields: React.ReactNode;
  items: { id: string; title: string; subtitle: string; onDelete: () => void }[];
  disabled: boolean;
  onAdd: () => void;
}) {
  return (
    <form
      className="editor-panel"
      onSubmit={(event) => {
        event.preventDefault();
        onAdd();
      }}
    >
      <h2>{title}</h2>
      <fieldset disabled={disabled}>
        {fields}
        <button className="primary-button" type="submit"><Plus size={16} />Add</button>
      </fieldset>
      <div className="entity-list">
        {items.map((item) => (
          <CompactEntity key={item.id} title={item.title} subtitle={item.subtitle} disabled={disabled} onDelete={item.onDelete} />
        ))}
      </div>
    </form>
  );
}

function ActivityTab({ state }: { state: PlannerState }) {
  return (
    <section className="activity-list">
      {state.activityEvents.map((event) => (
        <article key={event.id} className="activity-item">
          <span>{new Date(event.createdAt).toLocaleString()}</span>
          <strong>{event.action}</strong>
          <p>{event.details}</p>
        </article>
      ))}
    </section>
  );
}

function CompactEntity({
  title,
  subtitle,
  disabled,
  onDelete,
  onEdit
}: {
  title: string;
  subtitle: string;
  disabled: boolean;
  onDelete: () => void;
  onEdit?: () => void;
}) {
  return (
    <div className="compact-entity">
      <div>
        <strong>{title}</strong>
        <span>{subtitle}</span>
      </div>
      <div className="row-actions">
        {onEdit && <button type="button" className="secondary-button" disabled={disabled} onClick={onEdit}>Edit</button>}
        <button title="Delete" type="button" className="icon-button" disabled={disabled} onClick={onDelete}><Trash2 size={15} /></button>
      </div>
    </div>
  );
}

function Select<T extends { id: string; name?: string; label?: string; shortName?: string }>({
  value,
  options,
  onChange,
  labelKey = "name"
}: {
  value: string;
  options: T[];
  onChange: (value: string) => void;
  labelKey?: "name" | "label" | "shortName";
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option[labelKey] ?? option.name ?? option.label ?? option.id}
        </option>
      ))}
    </select>
  );
}

function Warnings({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="warnings">
      {warnings.map((warning) => (
        <span key={warning}>{warning}</span>
      ))}
    </div>
  );
}

function TagList({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="tag-list">
      {tags.map((tag) => (
        <span key={tag} className="tag">{tag}</span>
      ))}
    </div>
  );
}

function makeEmptyResident(selectedService: string): Resident {
  return {
    ...emptyResident,
    serviceTags: [selectedService]
  };
}

function serviceLineOptions(state: PlannerState): { id: string; name: string }[] {
  return getStateServiceLines(state).map((serviceLine) => ({ id: serviceLine, name: serviceLine }));
}

function formatResidentOption(resident: Resident, selectedService: string): string {
  const orderedTags = isResidentOnService(resident, selectedService)
    ? [selectedService, ...resident.serviceTags.filter((serviceTag) => serviceTag !== selectedService)]
    : resident.serviceTags;
  const serviceLabel = formatServiceTags(orderedTags);
  if (!serviceLabel) return resident.name;
  return `${resident.name} (${serviceLabel})`;
}

function formatServiceTags(serviceTags: string[]): string {
  return serviceTags.length ? serviceTags.join(", ") : "no service";
}

function residentLabel(state: PlannerState, residentId: string): string {
  return state.residents.find((resident) => resident.id === residentId)?.name ?? "Assigned";
}

function sortWeeks(weeks: Week[]): Week[] {
  return [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function chooseWeekId(weeks: Week[], preferredWeekId?: string): string | undefined {
  if (preferredWeekId && weeks.some((week) => week.id === preferredWeekId)) {
    return preferredWeekId;
  }

  const sortedWeeks = sortWeeks(weeks);
  const currentMonday = getCurrentMonday();
  return sortedWeeks.find((week) => week.startDate >= currentMonday)?.id ?? sortedWeeks[sortedWeeks.length - 1]?.id;
}

function buildWeekId(startDate: string): string {
  return `week_${startDate.replaceAll("-", "_")}`;
}

function formatWeekLabel(startDate: string): string {
  return `Week of ${parseLocalDate(startDate).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  })}`;
}

function getWeekEndDate(week: Week, weekdayOnly: boolean): string {
  return addDays(week.startDate, weekdayOnly ? 4 : 6);
}

function formatWeekRange(week: Week, weekdayOnly: boolean): string {
  const start = parseLocalDate(week.startDate).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const end = parseLocalDate(getWeekEndDate(week, weekdayOnly)).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
  return `${start}-${end}`;
}

function splitTags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function getHospitalTone(hospital: Hospital) {
  const key = `${hospital.shortName} ${hospital.name}`.toLowerCase();
  if (key.includes("rmh") || key.includes("roanoke")) {
    return {
      border: "#4f88c7",
      background: "#eef6ff",
      caseBackground: "#f7fbff"
    };
  }

  if (key.includes("ccasc") || key.includes("ambulatory")) {
    return {
      border: "#d2a833",
      background: "#fff7dd",
      caseBackground: "#fffdf2"
    };
  }

  return {
    border: hospital.color,
    background: "#ffffff",
    caseBackground: "#fcfdff"
  };
}

function getAttendingColor(attending: Attending): string {
  const palette = ["#b84a62", "#2f78c4", "#357d54", "#8a5bb6", "#b46a22", "#4b6f7f", "#8b5a3c", "#2f8c89"];
  const input = attending.id || attending.name;
  let hash = 0;
  for (const char of input) {
    hash = (hash * 31 + char.charCodeAt(0)) % palette.length;
  }
  return palette[hash];
}

function clampPriority(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, value)) as 1 | 2 | 3 | 4 | 5;
}

function roleLabel(role: Role): string {
  return role === "admin" ? "admin" : "user";
}

function getStoredSession(): PlannerSession | undefined {
  const token = localStorage.getItem("plannerToken");
  const role = localStorage.getItem("plannerRole");
  const username = localStorage.getItem("plannerUsername");
  const displayName = localStorage.getItem("plannerDisplayName");
  const servicePrivileges = parseStoredPrivileges(localStorage.getItem("plannerServicePrivileges"));
  const mustChangePassword = localStorage.getItem("plannerMustChangePassword") === "true";
  const temporaryPasswordExpiresAt = localStorage.getItem("plannerTemporaryPasswordExpiresAt") ?? undefined;
  return token && username && displayName && isRole(role)
    ? { token, role, username, displayName, servicePrivileges, mustChangePassword, temporaryPasswordExpiresAt }
    : undefined;
}

function storeSession(session: PlannerSession) {
  localStorage.setItem("plannerToken", session.token);
  localStorage.setItem("plannerRole", session.role);
  localStorage.setItem("plannerUsername", session.username);
  localStorage.setItem("plannerDisplayName", session.displayName);
  localStorage.setItem("plannerServicePrivileges", JSON.stringify(session.servicePrivileges));
  localStorage.setItem("plannerMustChangePassword", String(session.mustChangePassword));
  if (session.temporaryPasswordExpiresAt) {
    localStorage.setItem("plannerTemporaryPasswordExpiresAt", session.temporaryPasswordExpiresAt);
  } else {
    localStorage.removeItem("plannerTemporaryPasswordExpiresAt");
  }
}

function getStoredServiceLine(): string {
  const serviceLine = localStorage.getItem("plannerSelectedServiceLine");
  return serviceLine && SERVICE_LINES.includes(serviceLine as (typeof SERVICE_LINES)[number]) ? serviceLine : DEFAULT_SERVICE_LINE;
}

function isRole(role: string | null): role is Role {
  return role === "admin" || role === "viewer";
}

function parseStoredPrivileges(value: string | null): PlannerSession["servicePrivileges"] {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as PlannerSession["servicePrivileges"];
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

function getSessionPrivilege(session: PlannerSession, serviceLine: string): "view" | "request" | "edit" {
  const privilege = session.servicePrivileges[serviceLine];
  return privilege === "request" || privilege === "edit" ? privilege : "view";
}

function hasAnyRequestPrivilege(session: PlannerSession): boolean {
  return Object.values(session.servicePrivileges).some((privilege) => privilege === "request" || privilege === "edit");
}

function clearStoredSession() {
  localStorage.removeItem("plannerToken");
  localStorage.removeItem("plannerRole");
  localStorage.removeItem("plannerUsername");
  localStorage.removeItem("plannerDisplayName");
  localStorage.removeItem("plannerServicePrivileges");
  localStorage.removeItem("plannerMustChangePassword");
  localStorage.removeItem("plannerTemporaryPasswordExpiresAt");
}
