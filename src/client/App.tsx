import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Lock,
  LogIn,
  LogOut,
  Plus,
  Printer,
  RefreshCw,
  Save,
  Scissors,
  Send,
  Sparkles,
  Star,
  Trash2,
  Trophy,
  Unlock,
  UserPlus,
  Wand2
} from "lucide-react";
import type { CSSProperties, FormEvent } from "react";
import { useEffect, useRef, useState } from "react";
import {
  awardGoldStar,
  claimCoverage,
  ConflictError,
  createAssignment,
  createEntity,
  deleteAssignment,
  deleteEntity,
  fetchSchedule,
  fetchSession,
  fetchState,
  getUncoveredMessage,
  login,
  PasswordChangeResponse,
  runSuggestion,
  Session,
  setExpectedStateVersion,
  submitCoverageRequest,
  subscribeToStateEvents,
  UnauthorizedError,
  updateAssignment,
  updateEntity
} from "./api";
import { CalendarTab, RequestsTab } from "./CoverageCalendar";
import { NussbaumTamagotchi } from "./NussbaumTamagotchi";
import { AccountTab, PasswordChangeRequiredScreen, UsersTab } from "./UsersTab";
import { canEditScheduleForSelectedService, getNavigationTabs, type Tab } from "./navigation";
import { formatMonthLabel, getMonthFromDate, isCallDate } from "../shared/coverage";
import { addDays, displayDate, getDefaultPlannerMonday, getMondayForDate, getWeekDates, parseLocalDate } from "../shared/date";
import { buildResidentUsername, createId, isPlaceholderResidentUsername } from "../shared/id";
import {
  Assignment,
  ActivityEvent,
  ActivityEventType,
  Attending,
  AttendingBlock,
  CALL_POSITIONS,
  CallPosition,
  ClinicSession,
  CollectionName,
  CoverageEntry,
  GoldStarAward,
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
  ResidentRotationBlock,
  TrainingLevel,
  UserSummary,
  Week,
  WeekSchedule
} from "../shared/types";
import { formatClinicLabel } from "../shared/scheduler";
import {
  DEFAULT_SERVICE_LINE,
  clinicMatchesService,
  getAttendingsForService,
  getStateServiceLines,
  isResidentOnService,
  sortResidentsForService
} from "../shared/services";
import {
  ROTATION_BLOCK_DATES,
  getCalendarNightResidentsForDate,
  getResidentLastName,
  getResidentServiceTagsForDate,
  getRotationBlockForDate,
  getRotationForBlock,
  getRotationForDate,
  getTodayDate,
  normalizeRotationServiceToServiceLine,
  sortResidentsBySeniority
} from "../shared/rotations";

type PlannerSession = Session;
type LayoutMode = "desktop" | "mobile";
type InputMode = "pointer" | "touch";
type BoardPrintSnapshot = {
  state: PlannerState;
  schedule: WeekSchedule;
  serviceLine: string;
  weekRange: string;
};

const MOBILE_LAYOUT_QUERY = "(max-width: 760px), (hover: none) and (pointer: coarse) and (orientation: portrait) and (max-width: 900px)";
const TOUCH_INPUT_QUERY = "(hover: none) and (pointer: coarse)";

const emptyResident: Resident = {
  id: "",
  username: "",
  name: "",
  aliases: [],
  emoji: "",
  trainingLevel: "PGY3",
  rosterKind: "primary",
  sourceProgram: "General Surgery",
  sourceProgramAbbreviation: "",
  accountEligible: true,
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
  const [selectedWeekId, setSelectedWeekId] = useState("");
  const [selectedService, setSelectedService] = useState(() => getStoredServiceLine() ?? DEFAULT_SERVICE_LINE);
  const [activeTab, setActiveTab] = useState<Tab>("board");
  const [isScheduleEditorOpen, setIsScheduleEditorOpen] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [toast, setToast] = useState<string | undefined>();
  const [printSnapshot, setPrintSnapshot] = useState<BoardPrintSnapshot | undefined>();
  const [isTamagotchiOpen, setIsTamagotchiOpen] = useState(false);
  const stateVersionRef = useRef<number | undefined>();

  const selectedWeek = state?.weeks.find((week) => week.id === selectedWeekId);
  const serviceLines = state ? getStateServiceLines(state) : [...SERVICE_LINES];
  const isAdmin = session?.role === "admin";
  const selectedPrivilege = session ? getSessionPrivilege(session, selectedService) : "view";
  const canEditSelectedService = Boolean(session && canEditScheduleForSelectedService(isAdmin, selectedPrivilege));
  const canRequestSelectedService = Boolean(session && (canEditSelectedService || selectedPrivilege === "request"));
  const linkedResident = state && session ? findResidentForSession(state, session) : undefined;
  const canUseRequests = Boolean(session && (isAdmin || hasAnyRequestPrivilege(session) || linkedResident || (state?.coverageRequests.length ?? 0) > 0));
  const pendingCoverageRequestCount = state?.coverageRequests.filter((request) => request.status === "pending").length ?? 0;

  function showLoggedOutScreen() {
    clearStoredSession();
    setSession(undefined);
    setState(undefined);
    setSchedule(undefined);
    setSelectedWeekId("");
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
    const storedServiceLine = getStoredServiceLine(nextSession.username);
    if (storedServiceLine) setSelectedService(storedServiceLine);
    setSelectedWeekId("");
    setSession(nextSession);
  }

  function handlePasswordChanged(user: PasswordChangeResponse) {
    if (!session) return;
    const nextSession: PlannerSession = {
      ...session,
      token: user.token,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      servicePrivileges: user.servicePrivileges,
      passwordUpdatedAt: user.passwordUpdatedAt,
      mustChangePassword: user.mustChangePassword,
      temporaryPasswordExpiresAt: user.temporaryPasswordExpiresAt
    };
    storeSession(nextSession);
    setSession(nextSession);
    setError(undefined);
    setToast("Password changed");
  }

  async function refresh(
    nextState?: PlannerState,
    preferredWeekId = selectedWeekId,
    serviceLine = selectedService,
    tokenOverride = session?.token
  ) {
    if (!tokenOverride) return;
    const loadedState = nextState ?? (await fetchState(tokenOverride));
    const weekId = chooseWeekId(loadedState.weeks, preferredWeekId);
    setState(loadedState);
    if (weekId) {
      setSelectedWeekId(weekId);
      setSchedule(await fetchSchedule(tokenOverride, weekId, serviceLine));
    } else {
      setSelectedWeekId("");
      setSchedule(undefined);
    }
  }

  async function runMutation(action: () => Promise<PlannerState | void>, message?: string, preferredWeekId?: string) {
    if (!session) return;
    async function runOnce(version: number | undefined) {
      setExpectedStateVersion(version);
      try {
        return await action();
      } finally {
        setExpectedStateVersion(undefined);
      }
    }
    try {
      setError(undefined);
      const result = await runOnce(state?.version);
      await refresh(result || undefined, preferredWeekId ?? selectedWeekId);
      if (message) setToast(message);
    } catch (mutationError) {
      if (handleExpiredSession(mutationError)) return;
      if (mutationError instanceof ConflictError) {
        try {
          const latest = await fetchState(session.token);
          stateVersionRef.current = latest.version;
          const result = await runOnce(latest.version);
          await refresh(result || undefined, preferredWeekId ?? selectedWeekId);
          setToast(message ? `${message} after refresh` : "Saved after refresh");
          return;
        } catch (retryError) {
          if (handleExpiredSession(retryError)) return;
          setError(retryError instanceof Error ? retryError.message : "Planner changed; refresh and retry");
          return;
        }
      }
      setError(mutationError instanceof Error ? mutationError.message : "Something went wrong");
    }
  }

  async function selectWeek(weekId: string) {
    if (!session || !weekId || weekId === selectedWeekId) return;
    try {
      setError(undefined);
      setSelectedWeekId(weekId);
      setSchedule(await fetchSchedule(session.token, weekId, selectedService));
    } catch (loadError) {
      if (handleExpiredSession(loadError)) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load week");
    }
  }

  async function navigateToWeekForDate(date: string) {
    if (!session || !state || !date) return;
    const startDate = getMondayForDate(date);
    const existingWeek = state.weeks.find((week) => week.startDate === startDate);
    if (existingWeek) {
      await selectWeek(existingWeek.id);
      return;
    }
    if (!isAdmin) {
      setError("Only admins can open a new blank week.");
      return;
    }

    const week: Week = {
      id: buildWeekId(startDate),
      startDate,
      label: formatWeekLabel(startDate)
    };
    await runMutation(() => createEntity<Week>(session.token, "weeks", week), "Week opened", week.id);
  }

  async function selectServiceLine(serviceLine: string) {
    if (serviceLine === selectedService) return;
    setSelectedService(serviceLine);
    storeSelectedServiceLine(session?.username, serviceLine);
    if (!session || !selectedWeekId) return;
    try {
      setError(undefined);
      setSchedule(await fetchSchedule(session.token, selectedWeekId, serviceLine));
    } catch (loadError) {
      if (handleExpiredSession(loadError)) return;
      setError(loadError instanceof Error ? loadError.message : "Unable to load service");
    }
  }

  function handlePrintBoard() {
    if (!state || !schedule) return;
    setPrintSnapshot({
      state,
      schedule,
      serviceLine: selectedService,
      weekRange: formatWeekRange(schedule.week, state.settings.weekdayOnly)
    });
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
        const loadedState = await fetchState(token);
        if (cancelled) return;
        const serviceLine = resolveSessionServiceLine(loadedState, nextSession, selectedService);
        setSelectedService(serviceLine);
        await refresh(loadedState, selectedWeekId, serviceLine, token);
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
    stateVersionRef.current = state?.version;
  }, [state?.version]);

  useEffect(() => {
    if (!session || session.mustChangePassword) return;
    return subscribeToStateEvents(
      session.token,
      (event) => {
        if ((stateVersionRef.current ?? 0) >= event.version) return;
        refresh(undefined, selectedWeekId, selectedService, session.token).catch((refreshError) => {
          if (handleExpiredSession(refreshError)) return;
          setError(refreshError instanceof Error ? refreshError.message : "Unable to refresh planner");
        });
      },
      showLoggedOutScreen
    );
  }, [session?.token, session?.mustChangePassword, selectedWeekId, selectedService]);

  useEffect(() => {
    if (!printSnapshot) return;
    const frame = window.requestAnimationFrame(() => window.print());
    const clearPrintSnapshot = () => setPrintSnapshot(undefined);
    window.addEventListener("afterprint", clearPrintSnapshot, { once: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("afterprint", clearPrintSnapshot);
    };
  }, [printSnapshot]);

  useEffect(() => {
    if (!session) return;
    if ((activeTab === "users" || activeTab === "roster" || activeTab === "defaults" || activeTab === "activity") && !isAdmin) {
      setActiveTab("board");
      return;
    }
    if (activeTab === "requests" && !canUseRequests) {
      setActiveTab("board");
    }
  }, [activeTab, canUseRequests, isAdmin, session?.username]);

  useEffect(() => {
    if (activeTab !== "board" || !canEditSelectedService) {
      setIsScheduleEditorOpen(false);
    }
  }, [activeTab, canEditSelectedService]);

  if (isTamagotchiOpen) {
    return <NussbaumTamagotchi onExit={() => setIsTamagotchiOpen(false)} />;
  }

  if (!session) {
    if (showLoggedOut) {
      return <LoggedOutScreen onReturn={() => setShowLoggedOut(false)} />;
    }
    return <LoginScreen onLogin={handleLogin} onOpenTamagotchi={() => setIsTamagotchiOpen(true)} />;
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
    <Shell role={session.role} onLogout={handleLogout} error={error} toast={toast} printMode={Boolean(printSnapshot)}>
      <header className="planner-header">
        <div>
          <ServiceLinePicker
            serviceLines={serviceLines}
            selectedService={selectedService}
            onSelect={selectServiceLine}
          />
          <h1>{activeTab === "board" ? selectedWeek.label : getTabTitle(activeTab)}</h1>
          {activeTab === "board" && <p className="week-range">{formatWeekRange(selectedWeek, state.settings.weekdayOnly)}</p>}
        </div>
        {activeTab === "board" && (
          <div className="header-actions">
            <WeekNavigator
              state={state}
              selectedWeek={selectedWeek}
              token={session.token}
              canCreateWeek={isAdmin}
              onNavigateToDate={navigateToWeekForDate}
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
            {canEditSelectedService && (
              <button
                title={isScheduleEditorOpen ? "Close schedule editor" : "Edit schedule"}
                className={isScheduleEditorOpen ? "primary-button" : "secondary-button"}
                onClick={() => setIsScheduleEditorOpen((open) => !open)}
              >
                <Scissors size={18} />
                {isScheduleEditorOpen ? "Done Editing" : "Edit Schedule"}
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
            <button title="Print board" className="secondary-button" onClick={handlePrintBoard}>
              <Printer size={18} />
              Print
            </button>
          </div>
        )}
      </header>

      <nav className="tabs" aria-label="Planner sections">
        {getNavigationTabs({ canUseRequests, pendingCoverageRequestCount, isAdmin }).map(([tab, label]) => (
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
          showScheduleEditor={isScheduleEditorOpen}
          onMutate={runMutation}
          onCopied={(message) => setToast(message)}
        />
      )}
      {activeTab === "my" && (
        <MyScheduleTab
          state={state}
          schedule={schedule}
          session={session}
          selectedService={selectedService}
        />
      )}
      {activeTab === "residents" && (
        <GoldStarChartTab
          state={state}
          session={session}
          token={session.token}
          onMutate={runMutation}
        />
      )}
      {activeTab === "calendar" && (
        <CalendarTab
          state={state}
          token={session.token}
          selectedService={selectedService}
          serviceLines={serviceLines}
          username={session.username}
          isAdmin={isAdmin}
          servicePrivileges={session.servicePrivileges}
          onMutate={runMutation}
        />
      )}
      {activeTab === "call" && <CallShiftsTab state={state} />}
      {activeTab === "schedule" && (
        <ResidentScheduleTab state={state} token={session.token} disabled={!isAdmin} onMutate={runMutation} />
      )}
      {activeTab === "requests" && (
        <RequestsTab
          state={state}
          token={session.token}
          username={session.username}
          isAdmin={isAdmin}
          servicePrivileges={session.servicePrivileges}
          onMutate={runMutation}
        />
      )}
      {activeTab === "roster" && (
        <RosterTab state={state} week={selectedWeek} token={session.token} selectedService={selectedService} disabled={!isAdmin} onMutate={runMutation} />
      )}
      {activeTab === "defaults" && (
        <DefaultsTab state={state} token={session.token} selectedService={selectedService} disabled={!isAdmin} onMutate={runMutation} />
      )}
      {activeTab === "activity" && isAdmin && <ActivityTab state={state} />}
      {activeTab === "users" && isAdmin && (
        <UsersTab token={session.token} serviceLines={serviceLines} onToast={(message) => setToast(message)} />
      )}
      {activeTab === "account" && (
        <AccountTab
          token={session.token}
          username={session.username}
          onToast={(message) => setToast(message)}
          onPasswordChanged={handlePasswordChanged}
          onOpenTamagotchi={() => setIsTamagotchiOpen(true)}
        >
          {linkedResident && (
            <ResidentProfileRequestPanel
              state={state}
              resident={linkedResident}
              session={session}
              token={session.token}
              onMutate={runMutation}
            />
          )}
        </AccountTab>
      )}
      {printSnapshot && <BoardPrintout snapshot={printSnapshot} />}
    </Shell>
  );
}

function LoginScreen({
  onLogin,
  onOpenTamagotchi
}: {
  onLogin: (session: PlannerSession) => void;
  onOpenTamagotchi: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | undefined>();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (username.trim().toLowerCase() === "nussbaum" && password === "") {
      setError(undefined);
      onOpenTamagotchi();
      return;
    }
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
  toast,
  printMode = false
}: {
  role: Role;
  children: React.ReactNode;
  onLogout: () => void;
  error?: string;
  toast?: string;
  printMode?: boolean;
}) {
  const responsiveMode = useResponsiveMode();

  return (
    <main
      className={`app-shell${printMode ? " is-printing-board" : ""}`}
      data-layout-mode={responsiveMode.layoutMode}
      data-input-mode={responsiveMode.inputMode}
    >
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

function WeekNavigator({
  state,
  selectedWeek,
  token,
  canCreateWeek,
  onNavigateToDate,
  onMutate
}: {
  state: PlannerState;
  selectedWeek: Week;
  token: string;
  canCreateWeek: boolean;
  onNavigateToDate: (date: string) => Promise<void>;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string, preferredWeekId?: string) => Promise<void>;
}) {
  const sortedWeeks = sortWeeks(state.weeks);

  async function deleteSelectedWeek() {
    const index = sortedWeeks.findIndex((week) => week.id === selectedWeek.id);
    const fallbackWeek = sortedWeeks[index + 1] ?? sortedWeeks[index - 1];
    if (!fallbackWeek || !window.confirm(`Delete ${selectedWeek.label} and its schedule data?`)) return;
    await onMutate(() => deleteEntity(token, "weeks", selectedWeek.id), "Week deleted", fallbackWeek.id);
  }

  return (
    <div className="week-manager" aria-label="Week navigation">
      <button
        title="Previous week"
        type="button"
        className="icon-button"
        onClick={() => onNavigateToDate(addDays(selectedWeek.startDate, -7))}
      >
        <ChevronLeft size={18} />
      </button>
      <input
        aria-label="Choose day in week"
        type="date"
        value={selectedWeek.startDate}
        onChange={(event) => onNavigateToDate(event.target.value)}
      />
      <button
        title="Next week"
        type="button"
        className="icon-button"
        onClick={() => onNavigateToDate(addDays(selectedWeek.startDate, 7))}
      >
        <ChevronRight size={18} />
      </button>
      <button
        title="Delete selected week"
        type="button"
        className="icon-button"
        disabled={!canCreateWeek || sortedWeeks.length <= 1}
        onClick={deleteSelectedWeek}
      >
        <Trash2 size={15} />
      </button>
    </div>
  );
}

function BoardTab({
  state,
  schedule,
  token,
  selectedService,
  canEdit,
  showScheduleEditor,
  onMutate,
  onCopied
}: {
  state: PlannerState;
  schedule: WeekSchedule;
  token: string;
  selectedService: string;
  canEdit: boolean;
  showScheduleEditor: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
  onCopied: (message: string) => void;
}) {
  return (
    <>
      {showScheduleEditor && (
        <section className="board-schedule-editor" aria-label="Edit OR and clinic schedule">
          <ScheduleEditor
            state={state}
            week={schedule.week}
            token={token}
            selectedService={selectedService}
            disabled={!canEdit}
            onMutate={onMutate}
          />
        </section>
      )}
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
    </>
  );
}

function BoardPrintout({ snapshot }: { snapshot: BoardPrintSnapshot }) {
  const totalUncovered = snapshot.schedule.days.reduce((count, day) => count + day.uncoveredCases.length, 0);
  const blockCount = snapshot.schedule.days.reduce((count, day) => count + day.blocks.length, 0);
  const clinicCount = snapshot.schedule.days.reduce((count, day) => count + day.clinics.length, 0);

  return (
    <section className="print-board" aria-label="Printable OR and clinic schedule">
      <header className="print-board-header">
        <div>
          <p>OR / Clinic</p>
          <h1>{snapshot.schedule.week.label}</h1>
        </div>
        <div className="print-board-meta">
          <strong>{snapshot.serviceLine}</strong>
          <span>{snapshot.weekRange}</span>
          <span>{blockCount} OR blocks · {clinicCount} clinics · {totalUncovered} open cases</span>
        </div>
      </header>

      <div className="print-board-days">
        {snapshot.schedule.days.map((day) => (
          <article key={day.date} className="print-day">
            <header className="print-day-header">
              <h2>{formatPrintDayLabel(day.date)}</h2>
              <span>{day.uncoveredCases.length ? `${day.uncoveredCases.length} open` : "covered"}</span>
            </header>
            <div className="print-day-body">
              {day.blocks.map((block) => (
                <PrintBlock key={block.id} state={snapshot.state} block={block} />
              ))}
              {day.clinics.map((clinic) => (
                <PrintClinic key={clinic.id} state={snapshot.state} clinic={clinic} />
              ))}
              {day.blocks.length === 0 && day.clinics.length === 0 && <p className="print-empty">No OR / clinic</p>}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function PrintBlock({ state, block }: { state: PlannerState; block: ScheduledBlock }) {
  const blockAssignmentLabel = formatPrintAssignmentList(state, block.assignment ? [block.assignment] : []);

  return (
    <section className="print-block">
      <div className="print-block-heading">
        <strong>{block.attending.name}</strong>
        <span>
          {block.hospital.shortName} · {block.firstCaseStartTime}
          {blockAssignmentLabel ? ` · block ${blockAssignmentLabel}` : ""}
        </span>
      </div>
      <div className="print-case-list">
        {block.cases.map((surgeryCase) => {
          const assignmentLabel = formatPrintAssignmentList(state, surgeryCase.assignments);
          return (
            <div key={surgeryCase.id} className="print-case-row">
              <span>{surgeryCase.startTime}</span>
              <strong>{surgeryCase.procedureLabel}</strong>
              <span className={assignmentLabel ? "" : "print-open"}>{assignmentLabel || "open"}</span>
            </div>
          );
        })}
        {block.cases.length === 0 && <p className="print-empty">No cases</p>}
      </div>
    </section>
  );
}

function PrintClinic({ state, clinic }: { state: PlannerState; clinic: ScheduledClinicSession }) {
  const assignmentLabel = formatPrintAssignmentList(state, clinic.assignments);

  return (
    <section className="print-clinic">
      <div className="print-clinic-heading">
        <strong>{formatClinicLabel(clinic)}</strong>
        <span>{clinic.startTime}-{clinic.endTime}</span>
      </div>
      <div className="print-clinic-meta">
        <span>{clinic.location}</span>
        {assignmentLabel && <strong>{assignmentLabel}</strong>}
      </div>
    </section>
  );
}

function MyScheduleTab({
  state,
  schedule,
  session,
  selectedService
}: {
  state: PlannerState;
  schedule: WeekSchedule;
  session: PlannerSession;
  selectedService: string;
}) {
  const resident = findResidentForSession(state, session);
  if (!resident) {
    return (
      <section className="my-schedule-empty">
        <CalendarDays size={20} />
        <strong>No linked resident profile</strong>
        <span>Ask an admin to set your resident username in the roster.</span>
      </section>
    );
  }

  const weekDates = new Set(getWeekDates(schedule.week.startDate, state.settings.weekdayOnly));
  const cases = schedule.days.flatMap((day) =>
    day.blocks.flatMap((block) =>
      block.cases.filter((surgeryCase) => surgeryCase.assignments.some((assignment) => assignment.residentId === resident.id))
    )
  );
  const clinics = schedule.days.flatMap((day) =>
    day.clinics
      .filter((clinic) => clinic.assignments.some((assignment) => assignment.residentId === resident.id))
      .map((clinic) => ({
        clinic,
        assignmentCount: clinic.assignments.filter((assignment) => assignment.residentId === resident.id).length
      }))
  );
  const coverageEntries = state.coverageEntries
    .filter((entry) => entry.residentId === resident.id && entry.kind !== "call" && weekDates.has(entry.date))
    .sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));
  const callEntries = getPersonalCallEntries(state, resident.id);

  return (
    <section className="my-schedule-page">
      <div className="my-schedule-header">
        <div>
          <p className="eyebrow">{selectedService}</p>
          <h2>{formatResidentName(resident)}</h2>
        </div>
        <div className="my-schedule-actions">
          <span className="service-line-chip">{formatServiceTags(getResidentServiceTagsForDate(resident, schedule.week.startDate))}</span>
          <a
            className="secondary-button"
            href={`/api/residents/${encodeURIComponent(resident.id)}/calendar.ics?token=${encodeURIComponent(session.token)}`}
          >
            <CalendarDays size={16} />
            ICS
          </a>
        </div>
      </div>

      <div className="my-schedule-grid">
        <section className="editor-panel">
          <h2>O.R.</h2>
          {cases.length === 0 ? (
            <p className="muted-copy">No O.R. assignments this week.</p>
          ) : (
            <div className="entity-list">
              {cases.map((surgeryCase) => (
                <div key={surgeryCase.id} className="compact-entity">
                  <div>
                    <strong>{surgeryCase.procedureLabel}</strong>
                    <span>{displayDate(surgeryCase.date)} · {surgeryCase.startTime}-{surgeryCase.endTime} · {surgeryCase.attending.name}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="editor-panel">
          <h2>Clinic</h2>
          {clinics.length === 0 ? (
            <p className="muted-copy">No clinic assignments this week.</p>
          ) : (
            <div className="entity-list">
              {clinics.map(({ clinic, assignmentCount }) => (
                <div key={clinic.id} className="compact-entity">
                  <div>
                    <strong>{formatClinicLabel(clinic)}</strong>
                    <span>{displayDate(clinic.date)} · {clinic.startTime}-{clinic.endTime} · {assignmentCount} slot{assignmentCount === 1 ? "" : "s"}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="editor-panel">
          <h2>Call Shifts</h2>
          {callEntries.length === 0 ? (
            <p className="muted-copy">No call shifts listed.</p>
          ) : (
            <div className="entity-list">
              {callEntries.map((entry) => (
                <div key={entry.id} className="compact-entity">
                  <div>
                    <strong>{displayDate(entry.date)}</strong>
                    <span>{formatPersonalCallEntryLabel(state, entry)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="editor-panel">
          <h2>Calendar</h2>
          {coverageEntries.length === 0 ? (
            <p className="muted-copy">No rounding, off, or note entries this week.</p>
          ) : (
            <div className="entity-list">
              {coverageEntries.map((entry) => (
                <div key={entry.id} className="compact-entity">
                  <div>
                    <strong>{entry.kind}</strong>
                    <span>{displayDate(entry.date)}{entry.note ? ` · ${entry.note}` : ""}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

function GoldStarChartTab({
  state,
  session,
  token,
  onMutate
}: {
  state: PlannerState;
  session: PlannerSession;
  token: string;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const weekStartDate = getMondayForDate(getTodayDate());
  const eligibleResidents = getGoldStarResidents(state);
  const eligibleResidentIds = new Set(eligibleResidents.map((resident) => resident.id));
  const weeklyAwards = state.goldStarAwards.filter(
    (award) => award.weekStartDate === weekStartDate && eligibleResidentIds.has(award.recipientResidentId)
  );
  const linkedResident = findResidentForSession(state, session);
  const myAward = linkedResident ? weeklyAwards.find((award) => award.giverResidentId === linkedResident.id) : undefined;
  const myRecipient = myAward ? state.residents.find((resident) => resident.id === myAward.recipientResidentId) : undefined;
  const leaderboard = getGoldStarLeaderboard(eligibleResidents, weeklyAwards).slice(0, 5);
  const [sparkleResidentId, setSparkleResidentId] = useState<string | undefined>();
  const sparkleTimerRef = useRef<number | undefined>();

  useEffect(() => {
    return () => {
      if (sparkleTimerRef.current) window.clearTimeout(sparkleTimerRef.current);
    };
  }, []);

  function celebrateResident(residentId: string) {
    if (sparkleTimerRef.current) window.clearTimeout(sparkleTimerRef.current);
    setSparkleResidentId(residentId);
    sparkleTimerRef.current = window.setTimeout(() => setSparkleResidentId(undefined), 1600);
  }

  function submitStar(recipientResidentId: string) {
    void onMutate(async () => {
      const nextState = await awardGoldStar(token, recipientResidentId);
      celebrateResident(recipientResidentId);
      return nextState;
    }, "Star awarded");
  }

  return (
    <section className="gold-star-page">
      <div className="gold-star-header">
        <div>
          <p className="eyebrow">Gold Star Chart</p>
          <h2>Top 5 residents this week</h2>
        </div>
        <span className="gold-star-week">Week of {displayDate(weekStartDate)}</span>
      </div>

      <section className="gold-star-rules" aria-label="Gold Star Chart rules">
        <span>One star each week.</span>
        <span>Refreshes every Monday.</span>
        <span>Give it to another resident.</span>
        <span>Awards are anonymous.</span>
      </section>

      <div className="gold-star-layout">
        <section className="editor-panel gold-star-board">
          <div className="gold-star-panel-heading">
            <Trophy size={18} />
            <h2>Leaderboard</h2>
          </div>
          {leaderboard.length === 0 ? (
            <div className="gold-star-empty">
              <Star size={20} />
              <strong>No stars yet this week.</strong>
            </div>
          ) : (
            <ol className="gold-star-leaderboard">
              {leaderboard.map(({ resident, count }, index) => (
                <li key={resident.id}>
                  <span className="gold-star-rank">{index + 1}</span>
                  <div>
                    <strong>{formatResidentName(resident)}</strong>
                    <span>{resident.trainingLevel}</span>
                  </div>
                  <strong className="gold-star-count">{formatStarCount(count)}</strong>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="editor-panel gold-star-awards">
          <div className="gold-star-panel-heading">
            <Sparkles size={18} />
            <h2>Award a star</h2>
          </div>
          {!linkedResident ? (
            <p className="muted-copy">A linked resident profile is required to award a star.</p>
          ) : (
            <>
              {myAward ? (
                <p className="gold-star-spent">
                  This week's star went to {myRecipient ? formatResidentName(myRecipient) : "another resident"}.
                </p>
              ) : (
                <p className="muted-copy">Choose one resident for this week's star.</p>
              )}
              <div className="gold-star-resident-list">
                {eligibleResidents.map((resident) => {
                  const isSelf = resident.id === linkedResident.id;
                  const isChosen = myAward?.recipientResidentId === resident.id;
                  const canAward = !isSelf && !myAward;
                  return (
                    <div key={resident.id} className={`gold-star-resident${sparkleResidentId === resident.id ? " celebrating" : ""}`}>
                      <div>
                        <strong>{formatResidentName(resident)}</strong>
                        <span>{formatResidentRosterSummary(resident, weekStartDate)}</span>
                      </div>
                      <button
                        type="button"
                        data-testid={`gold-star-award-${resident.id}`}
                        className={isChosen ? "primary-button gold-star-award-button" : "secondary-button gold-star-award-button"}
                        disabled={!canAward}
                        onClick={() => submitStar(resident.id)}
                      >
                        <Star size={16} />
                        {getGoldStarButtonLabel({ isSelf, isChosen, hasAward: Boolean(myAward) })}
                      </button>
                      {sparkleResidentId === resident.id && (
                        <span className="gold-star-burst" aria-hidden="true">
                          ⭐️ ✨ ⭐️
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
    </section>
  );
}

function CallShiftsTab({ state }: { state: PlannerState }) {
  const [month, setMonth] = useState(() => localStorage.getItem("coverageCalendarMonth") ?? getDefaultCallMonth(state));
  const nightTeamSegments = getNightTeamSegments(state, month);
  const weekendRows = getWeekendCallRows(state, month);
  const today = getTodayDate();

  useEffect(() => {
    localStorage.setItem("coverageCalendarMonth", month);
  }, [month]);

  return (
    <section className="call-shifts-page">
      <div className="call-shifts-toolbar">
        <div>
          <p className="eyebrow">CALL 📟</p>
          <h2>{formatMonthLabel(month)}</h2>
        </div>
        <div className="coverage-toolbar-actions">
          <button title="Previous month" className="icon-button" onClick={() => setMonth(shiftMonthValue(month, -1))}>
            <ChevronLeft size={17} />
          </button>
          <input aria-label="Call month" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          <button title="Next month" className="icon-button" onClick={() => setMonth(shiftMonthValue(month, 1))}>
            <ChevronRight size={17} />
          </button>
        </div>
      </div>

      <section className="call-night-panel">
        {nightTeamSegments.length === 0 ? (
          <p>
            <strong>Night team:</strong> None listed
          </p>
        ) : nightTeamSegments.length === 1 ? (
          <p>
            <strong>Night team:</strong> {nightTeamSegments[0].residentNames || "None listed"}
          </p>
        ) : (
          <>
            <strong>Night team:</strong>
            <div className="call-night-segments">
              {nightTeamSegments.map((segment) => (
                <span key={`${segment.startDate}:${segment.endDate}`}>
                  {formatCallDateRange(segment.startDate, segment.endDate)}: {segment.residentNames || "None listed"}
                </span>
              ))}
            </div>
          </>
        )}
      </section>

      <div className="call-week-list">
        {weekendRows.length === 0 ? (
          <section className="call-week-empty">No weekend call listed for this month.</section>
        ) : (
          weekendRows.map((row) => (
            <article key={row.anchorDate} className="call-week-row">
              <header className="call-week-header">
                <strong>{row.label}</strong>
                <span>{row.dateRange}</span>
              </header>
              <div className="call-weekend-grid">
                {row.days.map((day) => (
                  <section
                    key={day.date}
                    className={`call-day-card${day.inMonth ? "" : " outside-month"}${day.groups.length ? "" : " empty"}${day.date === today ? " today" : ""}`}
                  >
                    <header className="call-day-header">
                      <span className="call-day-name">{day.weekday}</span>
                      <span className="call-day-date">{formatShortDate(day.date)}</span>
                    </header>
                    <div className="call-duty-list">
                      {day.groups.length === 0 ? (
                        <span className="call-duty-empty">Not listed</span>
                      ) : (
                        day.groups.map((group) => (
                          <div key={group.label} className="call-duty-line">
                            <span className="call-duty-label">{group.label}</span>
                            <strong>{group.residentNames}</strong>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function ResidentProfileRequestPanel({
  state,
  resident,
  session,
  token,
  onMutate
}: {
  state: PlannerState;
  resident: Resident;
  session: PlannerSession;
  token: string;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => ({
    name: resident.name,
    aliases: (resident.aliases ?? []).join(", "),
    message: ""
  }));
  const pendingProfileRequest = state.coverageRequests.find(
    (request) =>
      request.requestType === "resident-profile" &&
      request.status === "pending" &&
      request.requesterUsername === session.username &&
      (request.targetResidentId === resident.id || request.requestedResidentProfile?.residentId === resident.id)
  );
  const nextName = draft.name.trim();
  const nextAliases = splitTags(draft.aliases);
  const currentAliases = resident.aliases ?? [];
  const hasChanges = nextName !== resident.name || nextAliases.join("|") !== currentAliases.join("|");

  useEffect(() => {
    setDraft({
      name: resident.name,
      aliases: (resident.aliases ?? []).join(", "),
      message: ""
    });
  }, [resident.id, resident.name, resident.aliases?.join("|")]);

  function submitProfileRequest(event: FormEvent) {
    event.preventDefault();
    void onMutate(
      () =>
        submitCoverageRequest(token, {
          requestType: "resident-profile",
          action: "update",
          targetResidentId: resident.id,
          requestedResidentProfile: {
            residentId: resident.id,
            name: nextName,
            aliases: nextAliases
          },
          message: draft.message.trim()
        }),
      "Profile request submitted"
    );
  }

  return (
    <form className="editor-panel" onSubmit={submitProfileRequest}>
      <h2>Profile</h2>
      <label>
        Display name
        <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
      </label>
      <label>
        Aliases
        <input value={draft.aliases} onChange={(event) => setDraft({ ...draft, aliases: event.target.value })} />
      </label>
      <label>
        Note
        <input value={draft.message} onChange={(event) => setDraft({ ...draft, message: event.target.value })} />
      </label>
      {pendingProfileRequest && <span className="pending-flag">pending</span>}
      <button className="secondary-button" type="submit" disabled={!hasChanges || !nextName || Boolean(pendingProfileRequest)}>
        <Send size={16} />
        Request update
      </button>
    </form>
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
  const allCasesCoveredIndividually =
    block.cases.length > 0 && block.cases.every((surgeryCase) => surgeryCase.assignments.some((assignment) => assignment.kind === "case"));
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
  const directAssignments = surgeryCase.assignments.filter((assignment) => assignment.kind === "case");
  const inheritedAssignment = surgeryCase.assignments.find((assignment) => assignment.kind === "block");
  const [isAddingResident, setIsAddingResident] = useState(false);
  const assignedResidentIds = surgeryCase.assignments.map((assignment) => assignment.residentId);
  const assignmentControls: Array<{
    assignment?: Assignment;
    kind: Assignment["kind"];
    targetId: string;
    showLock: boolean;
  }> = [
    ...(inheritedAssignment
      ? [{ assignment: inheritedAssignment, kind: "block" as const, targetId: inheritedAssignment.targetId, showLock: false }]
      : []),
    ...(directAssignments.length > 0
      ? directAssignments.map((assignment) => ({ assignment, kind: "case" as const, targetId: surgeryCase.id, showLock: true }))
      : inheritedAssignment
        ? []
        : [{ kind: "case" as const, targetId: surgeryCase.id, showLock: true }])
  ];
  const canAddResident = canEdit && assignedResidentIds.length === 1 && !isAddingResident;
  const onAdditionalResidentMutate = async (action: () => Promise<PlannerState | void>, message?: string) => {
    await onMutate(action, message);
    setIsAddingResident(false);
  };

  return (
    <div className="case-row">
      <div className="case-main">
        <span className="time-pill">{surgeryCase.startTime}-{surgeryCase.endTime}</span>
        <strong>{surgeryCase.procedureLabel}</strong>
        <span>{surgeryCase.durationMinutes} min</span>
      </div>
      <div className="case-assignment-stack">
        {assignmentControls.map((control, index) => (
          <AssignmentControl
            key={control.assignment?.id ?? `${surgeryCase.id}-unassigned`}
            state={state}
            token={token}
            kind={control.kind}
            targetId={control.targetId}
            assignment={control.assignment}
            disabled={!canEdit}
            claimable={false}
            arrangementWarnings={index === 0 ? arrangementWarnings : []}
            selectedService={selectedService}
            excludedResidentIds={assignedResidentIds}
            showLock={control.showLock}
            onMutate={onMutate}
          />
        ))}
        {isAddingResident && (
          <AssignmentControl
            state={state}
            token={token}
            kind="case"
            targetId={surgeryCase.id}
            disabled={!canEdit}
            claimable={false}
            selectedService={selectedService}
            excludedResidentIds={assignedResidentIds}
            emptyLabel="Select resident"
            quietEmpty
            onMutate={onAdditionalResidentMutate}
          />
        )}
        {canAddResident && (
          <button type="button" className="secondary-button add-resident-button" onClick={() => setIsAddingResident(true)}>
            +resident
          </button>
        )}
      </div>
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
  const [isAddingResident, setIsAddingResident] = useState(false);
  const assignedResidentIds = clinic.assignments.map((assignment) => assignment.residentId);
  const canAddResident = canEdit && !isAddingResident && clinic.assignments.length < Math.max(1, clinic.capacity);
  const onAdditionalResidentMutate = async (action: () => Promise<PlannerState | void>, message?: string) => {
    await onMutate(action, message);
    setIsAddingResident(false);
  };

  return (
    <section className="clinic-section">
      <div>
        <strong>{formatClinicLabel(clinic)}</strong>
        <span>{clinic.startTime}-{clinic.endTime} · {clinic.location}</span>
      </div>
      <div className="clinic-assignments">
        {clinic.assignments.map((assignment) => (
          <AssignmentControl
            key={assignment.id}
            state={state}
            token={token}
            kind="clinic"
            targetId={clinic.id}
            assignment={assignment}
            disabled={!canEdit}
            claimable={false}
            selectedService={selectedService}
            excludedResidentIds={assignedResidentIds}
            onMutate={onMutate}
          />
        ))}
        {isAddingResident && (
          <AssignmentControl
            state={state}
            token={token}
            kind="clinic"
            targetId={clinic.id}
            disabled={!canEdit}
            claimable={false}
            selectedService={selectedService}
            excludedResidentIds={assignedResidentIds}
            emptyLabel="Select resident"
            quietEmpty
            onMutate={onAdditionalResidentMutate}
          />
        )}
        {canAddResident && (
          <button type="button" className="secondary-button add-resident-button" onClick={() => setIsAddingResident(true)}>
            +resident
          </button>
        )}
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
  excludedResidentIds = [],
  showLock = true,
  quietEmpty = false,
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
  excludedResidentIds?: string[];
  showLock?: boolean;
  quietEmpty?: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const displayedAssignment = assignment ?? inheritedAssignment;
  const isCovered = Boolean(displayedAssignment || coveredWithoutDirectAssignment);
  const assignmentDate = getAssignmentDate(state, kind, targetId);
  const residents = sortResidentsForService(state.residents, selectedService, assignmentDate).filter(
    (resident) => !excludedResidentIds.includes(resident.id) || resident.id === assignment?.residentId
  );
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
              {formatResidentOption(resident, selectedService, assignmentDate)}
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
        className={isCovered ? "assignment-select assigned" : quietEmpty ? "assignment-select" : "assignment-select unassigned"}
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
            {formatResidentOption(resident, selectedService, assignmentDate)}
          </option>
        ))}
      </select>
      {assignment && !disabled && showLock && (
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

function ScheduleEditor({
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
    capacity: 1,
    isProcedure: false
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
          <label className="inline-checkbox">
            <input type="checkbox" checked={clinicForm.isProcedure} onChange={(event) => setClinicForm({ ...clinicForm, isProcedure: event.target.checked })} />
            <span>Procedure</span>
          </label>
          <label>Location<input value={clinicForm.location} onChange={(event) => setClinicForm({ ...clinicForm, location: event.target.value })} /></label>
          <label>Capacity<input type="number" min={1} value={clinicForm.capacity} onChange={(event) => setClinicForm({ ...clinicForm, capacity: Number(event.target.value) })} /></label>
          <button className="primary-button" type="submit"><Plus size={16} />Add Clinic</button>
        </fieldset>
        <div className="entity-list">
          {weekClinics.map((clinic) => (
            <ClinicSessionEditor
              key={clinic.id}
              state={state}
              clinic={clinic}
              token={token}
              disabled={disabled}
              onMutate={onMutate}
            />
          ))}
        </div>
      </form>
    </section>
  );
}

function ClinicSessionEditor({
  state,
  clinic,
  token,
  disabled,
  onMutate
}: {
  state: PlannerState;
  clinic: ClinicSession;
  token: string;
  disabled: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const attending = state.attendings.find((candidate) => candidate.id === clinic.attendingId);

  return (
    <div className="compact-entity">
      <div>
        <strong>{formatClinicLabel({ ...clinic, attending })}</strong>
        <span>{clinic.date} {clinic.startTime}-{clinic.endTime} · {clinic.location}</span>
      </div>
      <div className="row-actions">
        <label className="inline-checkbox">
          <input
            type="checkbox"
            checked={clinic.isProcedure}
            disabled={disabled}
            onChange={(event) =>
              onMutate(
                () => updateEntity<ClinicSession>(token, "clinicSessions", clinic.id, { isProcedure: event.target.checked }),
                "Clinic updated"
              )
            }
          />
          <span>Procedure</span>
        </label>
        <button
          title="Delete"
          type="button"
          className="icon-button"
          disabled={disabled}
          onClick={() => onMutate(() => deleteEntity(token, "clinicSessions", clinic.id), "Clinic deleted")}
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
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
          <label className="inline-checkbox">
            <input
              type="checkbox"
              checked={editing.accountEligible !== false}
              onChange={(event) => setEditing(updateResidentAccountDraft(editing, event.target.checked))}
            />
            <span>Login account</span>
          </label>
          <label>Username<input disabled={editing.accountEligible === false} value={editing.username ?? ""} onChange={(event) => setEditing({ ...editing, username: normalizeUsernameInput(event.target.value), accountEligible: true })} /></label>
          <label>Display name<input value={editing.name} onChange={(event) => setEditing(updateResidentNameDraft(editing, event.target.value))} /></label>
          <label>Aliases<input value={(editing.aliases ?? []).join(", ")} onChange={(event) => setEditing({ ...editing, aliases: splitTags(event.target.value) })} /></label>
          <label>Emoji<input value={editing.emoji ?? ""} onChange={(event) => setEditing({ ...editing, emoji: firstInputCharacter(event.target.value) })} /></label>
          <label>Level<select value={editing.trainingLevel} onChange={(event) => setEditing({ ...editing, trainingLevel: event.target.value as TrainingLevel })}>
            {["PGY1", "PGY2", "PGY3", "PGY4", "PGY5", "Fellow"].map((level) => <option key={level}>{level}</option>)}
          </select></label>
          <label>Roster<select value={editing.rosterKind ?? "primary"} onChange={(event) => setEditing({ ...editing, rosterKind: event.target.value as Resident["rosterKind"] })}>
            <option value="primary">Primary</option>
            <option value="off-service">Off-service</option>
          </select></label>
          <label>Source<input value={editing.sourceProgram ?? ""} onChange={(event) => setEditing({ ...editing, sourceProgram: event.target.value })} /></label>
          <label>Source tag<input value={editing.sourceProgramAbbreviation ?? ""} onChange={(event) => setEditing({ ...editing, sourceProgramAbbreviation: event.target.value })} /></label>
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
          {sortResidentsForService(state.residents, selectedService, week.startDate).map((resident) => (
            <CompactEntity
              key={resident.id}
              title={`${formatResidentName(resident)} · ${resident.trainingLevel}`}
              subtitle={`${formatResidentRosterSummary(resident, week.startDate)} · ${formatResidentAliases(resident)} · ${resident.trainingInterests.join(", ") || "no interests"} · ${resident.unavailable.length} unavailable`}
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

function ResidentScheduleTab({
  state,
  token,
  disabled,
  onMutate
}: {
  state: PlannerState;
  token: string;
  disabled: boolean;
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const todayBlock = getRotationBlockForDate(getTodayDate())?.blockNumber ?? 1;
  const residents = [...state.residents].sort((a, b) => a.name.localeCompare(b.name));
  const [selectedBlock, setSelectedBlock] = useState<number>(todayBlock);
  const [selectedResidentId, setSelectedResidentId] = useState(residents[0]?.id ?? "");
  const selectedResident = residents.find((resident) => resident.id === selectedResidentId) ?? residents[0];
  const block = ROTATION_BLOCK_DATES.find((candidate) => candidate.blockNumber === selectedBlock) ?? ROTATION_BLOCK_DATES[0];
  const serviceOptions = getRotationServiceOptions(state);

  useEffect(() => {
    if (selectedResidentId && residents.some((resident) => resident.id === selectedResidentId)) return;
    setSelectedResidentId(residents[0]?.id ?? "");
  }, [residents, selectedResidentId]);

  return (
    <section className="resident-schedule-page">
      <div className="schedule-toolbar">
        <label>
          Block
          <select value={selectedBlock} onChange={(event) => setSelectedBlock(Number(event.target.value))}>
            {ROTATION_BLOCK_DATES.map((rotationBlock) => (
              <option key={rotationBlock.blockNumber} value={rotationBlock.blockNumber}>
                Block {rotationBlock.blockNumber} · {rotationBlock.startDate} to {rotationBlock.endDate}
              </option>
            ))}
          </select>
        </label>
        <label>
          Resident
          <select value={selectedResident?.id ?? ""} onChange={(event) => setSelectedResidentId(event.target.value)}>
            {residents.map((resident) => (
              <option key={resident.id} value={resident.id}>
                {formatResidentName(resident)}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="resident-schedule-layout">
        <section className="editor-panel block-schedule-panel">
          <div className="schedule-panel-heading">
            <p className="eyebrow">Block {selectedBlock}</p>
            <h2>{block.startDate} to {block.endDate}</h2>
          </div>
          <div className="block-service-groups">
            {getBlockServiceGroups(state.residents, selectedBlock).map((group) => (
              <article key={group.service} className="block-service-group">
                <div className="block-service-title">
                  <strong>{group.service}</strong>
                  <span>{group.residents.length}</span>
                </div>
                <div className="block-resident-list">
                  {group.residents.map((resident) => (
                    <span key={resident.id} className="resident-legend-item">
                      <span className="resident-dot" style={{ backgroundColor: resident.color ?? "#2f78c4" }} />
                      {formatResidentName(resident)}
                    </span>
                  ))}
                </div>
              </article>
            ))}
          </div>
        </section>

        {selectedResident && (
          <ResidentRotationEditor
            resident={selectedResident}
            token={token}
            disabled={disabled}
            serviceOptions={serviceOptions}
            onMutate={onMutate}
          />
        )}
      </div>
    </section>
  );
}

function ResidentRotationEditor({
  resident,
  token,
  disabled,
  serviceOptions,
  onMutate
}: {
  resident: Resident;
  token: string;
  disabled: boolean;
  serviceOptions: string[];
  onMutate: (action: () => Promise<PlannerState | void>, message?: string) => Promise<void>;
}) {
  const [draftServices, setDraftServices] = useState<Record<number, string>>(() => makeRotationDraft(resident));
  const optionListId = `rotation-services-${resident.id}`;

  useEffect(() => {
    setDraftServices(makeRotationDraft(resident));
  }, [resident]);

  function saveBlock(blockNumber: number) {
    const nextSchedule = ensureRotationSchedule(resident).map((rotation) =>
      rotation.blockNumber === blockNumber
        ? { ...rotation, service: draftServices[blockNumber]?.trim() || "Not listed in source grid" }
        : rotation
    );
    void onMutate(
      () => updateEntity<Resident>(token, "residents", resident.id, { rotationSchedule: nextSchedule }),
      "Resident schedule updated"
    );
  }

  return (
    <section className="editor-panel resident-lineup-panel">
      <div className="schedule-panel-heading">
        <p className="eyebrow">{resident.trainingLevel}</p>
        <h2>{formatResidentName(resident)}</h2>
      </div>
      <datalist id={optionListId}>
        {serviceOptions.map((service) => (
          <option key={service} value={service} />
        ))}
      </datalist>
      <div className="resident-lineup-grid">
        {ensureRotationSchedule(resident).map((rotation) => {
          const serviceLine = normalizeRotationServiceToServiceLine(draftServices[rotation.blockNumber]);
          return (
            <div key={rotation.blockNumber} className="resident-lineup-row">
              <div>
                <strong>Block {rotation.blockNumber}</strong>
                <span>{rotation.startDate} to {rotation.endDate}</span>
              </div>
              <input
                aria-label={`${formatResidentName(resident)} block ${rotation.blockNumber} rotation`}
                list={optionListId}
                value={draftServices[rotation.blockNumber] ?? ""}
                disabled={disabled}
                onChange={(event) =>
                  setDraftServices((current) => ({
                    ...current,
                    [rotation.blockNumber]: event.target.value
                  }))
                }
              />
              <span className={serviceLine ? "service-line-chip" : "service-line-chip muted"}>{serviceLine ?? "Off list"}</span>
              <button
                title="Save rotation"
                type="button"
                className="icon-button"
                disabled={disabled || draftServices[rotation.blockNumber] === rotation.service}
                onClick={() => saveBlock(rotation.blockNumber)}
              >
                <Save size={15} />
              </button>
            </div>
          );
        })}
      </div>
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

const activityTypeOptions: Array<{ type: ActivityEventType; label: string }> = [
  { type: "login", label: "Login" },
  { type: "assignment", label: "Assignment" },
  { type: "calendar", label: "Calendar" },
  { type: "account", label: "Account" },
  { type: "resident", label: "Resident" }
];

function ActivityTab({ state }: { state: PlannerState }) {
  const [selectedTypes, setSelectedTypes] = useState<Record<ActivityEventType, boolean>>({
    login: true,
    assignment: true,
    calendar: true,
    account: true,
    resident: true
  });
  const visibleEvents = state.activityEvents.filter((event) => selectedTypes[event.activityType]);

  return (
    <section className="activity-page">
      <div className="activity-filter-bar" aria-label="Activity filters">
        {activityTypeOptions.map((option) => (
          <label key={option.type} className="activity-filter-option">
            <input
              type="checkbox"
              checked={selectedTypes[option.type]}
              onChange={(event) => setSelectedTypes((current) => ({ ...current, [option.type]: event.target.checked }))}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
      <div className="activity-list">
        {visibleEvents.map((event) => (
          <article key={event.id} className="activity-item">
            <div className="activity-meta">
              <span>{new Date(event.createdAt).toLocaleString()}</span>
              <span>{formatActivityType(event.activityType)}</span>
              <span>{formatActivityActor(event)}</span>
            </div>
            <strong>{event.action}</strong>
            <p>{event.details}</p>
          </article>
        ))}
        {visibleEvents.length === 0 && <p className="muted-copy">No activity for the selected filters.</p>}
      </div>
    </section>
  );
}

function formatActivityType(activityType: ActivityEventType): string {
  return activityTypeOptions.find((option) => option.type === activityType)?.label ?? activityType;
}

function formatActivityActor(event: ActivityEvent): string {
  const actor = event.actorName || event.actorUsername || (event.actorRole === "admin" ? "admin" : "user");
  if (event.actorName && event.actorUsername && event.actorName !== event.actorUsername) {
    return `${event.actorName} (${event.actorUsername})`;
  }
  return actor;
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

function updateResidentNameDraft(resident: Resident, name: string): Resident {
  const nextUsername = buildResidentUsername(name);
  if (!nextUsername) return { ...resident, name };
  if (resident.accountEligible !== false && shouldUpdateResidentUsernameFromName(resident)) {
    return { ...resident, name, username: nextUsername };
  }
  return { ...resident, name };
}

function updateResidentAccountDraft(resident: Resident, accountEligible: boolean): Resident {
  if (!accountEligible) return { ...resident, accountEligible: false, username: undefined };
  return {
    ...resident,
    accountEligible: true,
    username: resident.username || buildResidentUsername(resident.name) || undefined
  };
}

function shouldUpdateResidentUsernameFromName(resident: Resident): boolean {
  const username = normalizeUsernameInput(resident.username ?? "");
  const currentDerivedUsername = buildResidentUsername(resident.name);
  return !username || isPlaceholderResidentUsername(username) || (Boolean(currentDerivedUsername) && username === currentDerivedUsername);
}

function serviceLineOptions(state: PlannerState): { id: string; name: string }[] {
  return getStateServiceLines(state).map((serviceLine) => ({ id: serviceLine, name: serviceLine }));
}

function getGoldStarResidents(state: PlannerState): Resident[] {
  return state.residents
    .filter((resident) => resident.accountEligible !== false)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function getGoldStarLeaderboard(
  residents: Resident[],
  weeklyAwards: Pick<GoldStarAward, "recipientResidentId">[]
): Array<{ resident: Resident; count: number }> {
  const counts = new Map<string, number>();
  for (const award of weeklyAwards) {
    counts.set(award.recipientResidentId, (counts.get(award.recipientResidentId) ?? 0) + 1);
  }
  return residents
    .map((resident) => ({ resident, count: counts.get(resident.id) ?? 0 }))
    .filter((entry) => entry.count > 0)
    .sort((a, b) => b.count - a.count || a.resident.name.localeCompare(b.resident.name));
}

function formatStarCount(count: number): string {
  return `${count} ${count === 1 ? "⭐️" : "⭐️"}`;
}

function getGoldStarButtonLabel({
  isSelf,
  isChosen,
  hasAward
}: {
  isSelf: boolean;
  isChosen: boolean;
  hasAward: boolean;
}): string {
  if (isSelf) return "You";
  if (isChosen) return "Given";
  if (hasAward) return "Used";
  return "Award";
}

function formatResidentOption(resident: Resident, selectedService: string, date?: string): string {
  const serviceTags = getResidentServiceTagsForDate(resident, date);
  const orderedTags = isResidentOnService(resident, selectedService, date)
    ? [selectedService, ...serviceTags.filter((serviceTag) => serviceTag !== selectedService)]
    : serviceTags;
  const serviceLabel = formatServiceTags(orderedTags);
  const labels = [serviceLabel, formatResidentSourceTag(resident)].filter(Boolean);
  if (!labels.length) return formatResidentName(resident);
  return `${formatResidentName(resident)} (${labels.join(" · ")})`;
}

function formatServiceTags(serviceTags: string[]): string {
  return serviceTags.length ? serviceTags.join(", ") : "no service";
}

function residentLabel(state: PlannerState, residentId: string): string {
  const resident = state.residents.find((candidate) => candidate.id === residentId);
  return resident ? formatResidentName(resident) : "Assigned";
}

function formatPrintAssignmentList(state: PlannerState, assignments: Assignment[]): string {
  const residentIds = [...new Set(assignments.map((assignment) => assignment.residentId))];
  return residentIds.map((residentId) => formatPrintResidentName(state, residentId)).join(", ");
}

function formatPrintResidentName(state: PlannerState, residentId: string): string {
  const resident = state.residents.find((candidate) => candidate.id === residentId);
  if (!resident) return "Assigned";
  const lastName = getResidentLastName(resident.name);
  const duplicateLastName = state.residents.some((candidate) => candidate.id !== resident.id && getResidentLastName(candidate.name) === lastName);
  if (!duplicateLastName) return lastName;
  const firstName = resident.name.trim().split(/\s+/)[0] ?? "";
  return firstName ? `${firstName.charAt(0)}. ${lastName}` : lastName;
}

function formatResidentName(resident: Pick<Resident, "name" | "emoji">): string {
  return resident.emoji ? `${resident.emoji} ${resident.name}` : resident.name;
}

function formatResidentAliases(resident: Pick<Resident, "aliases">): string {
  return resident.aliases?.length ? `aliases: ${resident.aliases.join(", ")}` : "no aliases";
}

function formatResidentRosterSummary(resident: Resident, date?: string): string {
  const login = resident.accountEligible === false ? "assignable only" : resident.username ?? "login pending";
  return [login, formatServiceTags(getResidentServiceTagsForDate(resident, date)), formatResidentSource(resident)].filter(Boolean).join(" · ");
}

function formatResidentSource(resident: Pick<Resident, "rosterKind" | "sourceProgram" | "sourceProgramAbbreviation">): string {
  const source = resident.sourceProgramAbbreviation || resident.sourceProgram;
  if (resident.rosterKind === "off-service" && source) return `off-service from ${source}`;
  if (resident.rosterKind === "off-service") return "off-service";
  return source ? `source: ${source}` : "";
}

function formatResidentSourceTag(resident: Pick<Resident, "rosterKind" | "sourceProgramAbbreviation">): string {
  if (resident.rosterKind !== "off-service") return "";
  return resident.sourceProgramAbbreviation || "off-service";
}

function findResidentForSession(state: PlannerState, session: PlannerSession): Resident | undefined {
  const username = normalizeUsernameInput(session.username);
  const displayName = normalizePersonName(session.displayName);
  return (
    state.residents.find((resident) => normalizeUsernameInput(resident.username ?? "") === username) ??
    state.residents.find(
      (resident) =>
        normalizePersonName(resident.name) === displayName ||
        (resident.aliases ?? []).some((alias) => normalizePersonName(alias) === displayName)
    )
  );
}

function normalizeUsernameInput(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9._-]/g, "");
}

function normalizePersonName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function firstInputCharacter(value: string): string {
  return Array.from(value.trim())[0] ?? "";
}

function getAssignmentDate(state: PlannerState, kind: Assignment["kind"], targetId: string): string | undefined {
  if (kind === "case") {
    const surgeryCase = state.cases.find((candidate) => candidate.id === targetId);
    const block = state.attendingBlocks.find((candidate) => candidate.id === surgeryCase?.blockId);
    return block?.date;
  }
  if (kind === "block") {
    return state.attendingBlocks.find((candidate) => candidate.id === targetId)?.date;
  }
  return state.clinicSessions.find((candidate) => candidate.id === targetId)?.date;
}

function ensureRotationSchedule(resident: Resident): ResidentRotationBlock[] {
  return ROTATION_BLOCK_DATES.map((block) => {
    const existing = getRotationForBlock(resident, block.blockNumber);
    return {
      id: existing?.id ?? `rot_${resident.id.replace(/^res_/, "")}_${block.blockNumber}`,
      blockNumber: block.blockNumber,
      startDate: block.startDate,
      endDate: block.endDate,
      service: existing?.service ?? "Not listed in source grid"
    };
  });
}

function makeRotationDraft(resident: Resident): Record<number, string> {
  return Object.fromEntries(ensureRotationSchedule(resident).map((rotation) => [rotation.blockNumber, rotation.service]));
}

function getRotationServiceOptions(state: PlannerState): string[] {
  const options = new Set([
    ...SERVICE_LINES,
    "NFloat",
    "SCC Night",
    "SCC-days",
    "Anesthesia",
    "Endoscopy",
    "Breast",
    "Head & Neck",
    "Thoracic",
    "Transplant",
    "Research",
    "VCU Burn",
    "Plastic Surgery",
    "Not listed in source grid"
  ]);
  for (const resident of state.residents) {
    for (const rotation of resident.rotationSchedule ?? []) {
      if (rotation.service.trim()) options.add(rotation.service.trim());
    }
  }
  return [...options].sort((a, b) => a.localeCompare(b));
}

function getBlockServiceGroups(residents: Resident[], blockNumber: number): { service: string; residents: Resident[] }[] {
  const groups = new Map<string, Resident[]>();
  for (const resident of residents) {
    const rotation = getRotationForBlock(resident, blockNumber);
    const service = rotation?.service || "Not listed in source grid";
    if (service === "Not listed in source grid" && isOffServiceRosterResident(resident)) continue;
    groups.set(service, [...(groups.get(service) ?? []), resident]);
  }
  return [...groups.entries()]
    .map(([service, groupResidents]) => ({
      service,
      residents: [...groupResidents].sort((a, b) => a.name.localeCompare(b.name))
    }))
    .sort((a, b) => a.service.localeCompare(b.service));
}

function isOffServiceRosterResident(resident: Resident): boolean {
  return (
    resident.rosterKind === "off-service" ||
    resident.accountEligible === false ||
    resident.tags.some((tag) => tag.trim().toLowerCase() === "off-service")
  );
}

interface CallNightSegment {
  startDate: string;
  endDate: string;
  residentNames: string;
}

interface CallDutyGroup {
  label: string;
  residentNames: string;
}

interface CallWeekendDay {
  date: string;
  weekday: string;
  inMonth: boolean;
  groups: CallDutyGroup[];
}

interface CallWeekendRow {
  anchorDate: string;
  label: string;
  dateRange: string;
  days: CallWeekendDay[];
}

function getDefaultCallMonth(state: PlannerState): string {
  const firstCallEntry = [...state.coverageEntries]
    .filter((entry) => entry.kind === "call")
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  return firstCallEntry ? getMonthFromDate(firstCallEntry.date) : getTodayDate().slice(0, 7);
}

function getPersonalCallEntries(state: PlannerState, residentId: string): CoverageEntry[] {
  return getOrderedSurgeryCallEntries(
    state.coverageEntries.filter((entry) => entry.kind === "call" && entry.residentId === residentId)
  ).sort((a, b) => a.date.localeCompare(b.date) || getCallPositionSortValue(a) - getCallPositionSortValue(b));
}

function getCallPositionSortValue(entry: Pick<CoverageEntry, "callPosition">): number {
  return entry.callPosition ? CALL_POSITIONS.indexOf(entry.callPosition) : CALL_POSITIONS.length;
}

function formatPersonalCallEntryLabel(state: PlannerState, entry: CoverageEntry): string {
  const label = isSccCallEntry(state, entry)
    ? "SCC/ICU"
    : entry.callPosition
      ? formatCallPositionLabel(entry.callPosition)
      : "Surgery call";
  return entry.note ? `${label} · ${entry.note}` : label;
}

function formatCallPositionLabel(position: CallPosition): string {
  switch (position) {
    case "senior":
      return "Senior call";
    case "mid-level":
      return "Mid-level call";
    case "intern":
      return "Intern call";
  }
}

function getNightTeamSegments(state: PlannerState, month: string): CallNightSegment[] {
  const { startDate, endDate } = getMonthBounds(month);
  const segments = ROTATION_BLOCK_DATES
    .filter((block) => block.endDate >= startDate && block.startDate <= endDate)
    .map<CallNightSegment>((block) => {
      const segmentStart = block.startDate > startDate ? block.startDate : startDate;
      const segmentEnd = block.endDate < endDate ? block.endDate : endDate;
      return {
        startDate: segmentStart,
        endDate: segmentEnd,
        residentNames: formatResidentList(getCalendarNightResidentsForDate(state.residents, segmentStart))
      };
    });

  return mergeCallNightSegments(segments);
}

function mergeCallNightSegments(segments: CallNightSegment[]): CallNightSegment[] {
  const merged: CallNightSegment[] = [];
  for (const segment of segments) {
    const previous = merged[merged.length - 1];
    if (previous && previous.residentNames === segment.residentNames && addDays(previous.endDate, 1) === segment.startDate) {
      previous.endDate = segment.endDate;
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

function getWeekendCallRows(state: PlannerState, month: string): CallWeekendRow[] {
  const callDates = getDatesInMonth(month).filter(isCallDate);
  const groupedDates = new Map<string, string[]>();
  for (const date of callDates) {
    const anchor = getWeekendAnchorDate(date);
    groupedDates.set(anchor, [...(groupedDates.get(anchor) ?? []), date]);
  }

  return [...groupedDates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([anchorDate]) => ({
      anchorDate,
      label: `Week of ${formatShortDate(anchorDate)}`,
      dateRange: formatCallDateRange(anchorDate, addDays(anchorDate, 2)),
      days: [
        { weekday: "Fri", offset: 0 },
        { weekday: "Sat", offset: 1 },
        { weekday: "Sun", offset: 2 }
      ].map(({ weekday, offset }) => {
        const date = addDays(anchorDate, offset);
        return {
          date,
          weekday,
          inMonth: getMonthFromDate(date) === month,
          groups: getCallDutyGroupsForDate(state, date)
        };
      })
    }));
}

function getDatesInMonth(month: string): string[] {
  const { startDate, endDate } = getMonthBounds(month);
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function getMonthBounds(month: string): { startDate: string; endDate: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const startDate = `${month}-01`;
  const end = new Date(year, monthNumber, 0);
  const endDate = `${year}-${String(monthNumber).padStart(2, "0")}-${String(end.getDate()).padStart(2, "0")}`;
  return { startDate, endDate };
}

function getWeekendAnchorDate(date: string): string {
  const day = parseLocalDate(date).getDay();
  if (day === 0) return addDays(date, -2);
  if (day === 6) return addDays(date, -1);
  return date;
}

function getCallDutyGroupsForDate(state: PlannerState, date: string): CallDutyGroup[] {
  const entries = state.coverageEntries.filter((entry) => entry.date === date && entry.kind === "call" && entry.residentId);
  if (entries.length === 0) return [];
  const surgeryEntries = entries.filter((entry) => !isSccCallEntry(state, entry));
  const sccEntries = entries.filter((entry) => isSccCallEntry(state, entry));
  const surgeryNames = formatCallEntryLastNameList(state, getOrderedSurgeryCallEntries(surgeryEntries));
  const sccNames = formatCallEntryLastNameList(state, sccEntries);
  return [
    ...(surgeryNames ? [{ label: "Call", residentNames: surgeryNames }] : []),
    ...(sccNames ? [{ label: "SCC", residentNames: sccNames }] : [])
  ];
}

function getOrderedSurgeryCallEntries<T extends { callPosition?: CallPosition }>(entries: T[]): T[] {
  const entriesByPosition = new Map<CallPosition, T[]>();
  const unpositionedEntries: T[] = [];
  for (const entry of entries) {
    if (entry.callPosition) {
      entriesByPosition.set(entry.callPosition, [...(entriesByPosition.get(entry.callPosition) ?? []), entry]);
    } else {
      unpositionedEntries.push(entry);
    }
  }

  return [...CALL_POSITIONS.flatMap((position) => entriesByPosition.get(position) ?? []), ...unpositionedEntries];
}

function getEntryResidents(state: PlannerState, entries: Array<{ residentId?: string }>): Resident[] {
  const residentsById = new Map(state.residents.map((resident) => [resident.id, resident]));
  return entries.map((entry) => (entry.residentId ? residentsById.get(entry.residentId) : undefined)).filter((resident): resident is Resident => Boolean(resident));
}

function formatCallEntryLastNameList(state: PlannerState, entries: Array<{ residentId?: string }>): string {
  return getEntryResidents(state, entries).map((resident) => getResidentLastName(resident.name)).join(", ");
}

function isSccCallEntry(state: PlannerState, entry: { residentId?: string; note?: string; date: string }): boolean {
  if (/\b(icu|scc)\b/i.test(entry.note ?? "")) return true;
  const resident = entry.residentId ? state.residents.find((candidate) => candidate.id === entry.residentId) : undefined;
  return resident ? getRotationForDate(resident, entry.date)?.service.toLowerCase().includes("scc") ?? false : false;
}

function formatResidentList(residents: Resident[]): string {
  return sortResidentsBySeniority(residents).map(formatResidentName).join(", ");
}

function formatCallDateRange(startDate: string, endDate: string): string {
  return startDate === endDate ? formatShortDate(startDate) : `${formatShortDate(startDate)}-${formatShortDate(endDate)}`;
}

function formatShortDate(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatPrintDayLabel(date: string): string {
  return parseLocalDate(date).toLocaleDateString(undefined, { weekday: "short", month: "numeric", day: "numeric" });
}

function shiftMonthValue(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(year, monthNumber - 1 + delta, 1);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}`;
}

function sortWeeks(weeks: Week[]): Week[] {
  return [...weeks].sort((a, b) => a.startDate.localeCompare(b.startDate));
}

function getTabTitle(tab: Tab): string {
  switch (tab) {
    case "board":
      return "OR / Clinic 🔪";
    case "my":
      return "My Schedule ☁️";
    case "residents":
      return "Residents ✨";
    case "calendar":
      return "Calendar 🗓️";
    case "call":
      return "CALL 📟";
    case "schedule":
      return "Blocks ⏹️";
    case "requests":
      return "Requests 📤";
    case "roster":
      return "Roster";
    case "defaults":
      return "Setup";
    case "activity":
      return "Activity 🛒";
    case "users":
      return "Users";
    case "account":
      return "Account 🛠️";
  }
}

function useResponsiveMode(): { layoutMode: LayoutMode; inputMode: InputMode } {
  const [responsiveMode, setResponsiveMode] = useState(getResponsiveMode);

  useEffect(() => {
    const mobileQuery = window.matchMedia(MOBILE_LAYOUT_QUERY);
    const touchQuery = window.matchMedia(TOUCH_INPUT_QUERY);
    const updateResponsiveMode = () => setResponsiveMode(getResponsiveMode());

    mobileQuery.addEventListener("change", updateResponsiveMode);
    touchQuery.addEventListener("change", updateResponsiveMode);
    updateResponsiveMode();

    return () => {
      mobileQuery.removeEventListener("change", updateResponsiveMode);
      touchQuery.removeEventListener("change", updateResponsiveMode);
    };
  }, []);

  return responsiveMode;
}

function getResponsiveMode(): { layoutMode: LayoutMode; inputMode: InputMode } {
  if (typeof window === "undefined" || !window.matchMedia) {
    return { layoutMode: "desktop", inputMode: "pointer" };
  }

  return {
    layoutMode: window.matchMedia(MOBILE_LAYOUT_QUERY).matches ? "mobile" : "desktop",
    inputMode: window.matchMedia(TOUCH_INPUT_QUERY).matches ? "touch" : "pointer"
  };
}

function chooseWeekId(weeks: Week[], preferredWeekId?: string): string | undefined {
  if (preferredWeekId && weeks.some((week) => week.id === preferredWeekId)) {
    return preferredWeekId;
  }

  const sortedWeeks = sortWeeks(weeks);
  const defaultMonday = getDefaultPlannerMonday();
  return sortedWeeks.find((week) => week.startDate >= defaultMonday)?.id ?? sortedWeeks[sortedWeeks.length - 1]?.id;
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
  const passwordUpdatedAt = localStorage.getItem("plannerPasswordUpdatedAt");
  const servicePrivileges = parseStoredPrivileges(localStorage.getItem("plannerServicePrivileges"));
  const mustChangePassword = localStorage.getItem("plannerMustChangePassword") === "true";
  const temporaryPasswordExpiresAt = localStorage.getItem("plannerTemporaryPasswordExpiresAt") ?? undefined;
  return token && username && displayName && passwordUpdatedAt && isRole(role)
    ? { token, role, username, displayName, passwordUpdatedAt, servicePrivileges, mustChangePassword, temporaryPasswordExpiresAt }
    : undefined;
}

function storeSession(session: PlannerSession) {
  localStorage.setItem("plannerToken", session.token);
  localStorage.setItem("plannerRole", session.role);
  localStorage.setItem("plannerUsername", session.username);
  localStorage.setItem("plannerDisplayName", session.displayName);
  localStorage.setItem("plannerPasswordUpdatedAt", session.passwordUpdatedAt);
  localStorage.setItem("plannerServicePrivileges", JSON.stringify(session.servicePrivileges));
  localStorage.setItem("plannerMustChangePassword", String(session.mustChangePassword));
  if (session.temporaryPasswordExpiresAt) {
    localStorage.setItem("plannerTemporaryPasswordExpiresAt", session.temporaryPasswordExpiresAt);
  } else {
    localStorage.removeItem("plannerTemporaryPasswordExpiresAt");
  }
}

function resolveSessionServiceLine(state: PlannerState, session: PlannerSession, fallback: string): string {
  return (
    getSessionResidentServiceLine(state, session) ??
    getStoredServiceLine(session.username) ??
    getStoredServiceLine() ??
    fallback ??
    DEFAULT_SERVICE_LINE
  );
}

function getSessionResidentServiceLine(state: PlannerState, session: PlannerSession): string | undefined {
  const resident =
    findResidentForSession(state, session) ??
    state.residents.find((candidate) => normalizeUsername(candidate.username ?? buildResidentUsername(candidate.name)) === normalizeUsername(session.username));
  if (!resident) return undefined;
  return getResidentServiceTagsForDate(resident, getTodayDate()).find(isKnownServiceLine);
}

function normalizeUsername(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function getStoredServiceLine(username?: string): string | undefined {
  const serviceLine = localStorage.getItem(getSelectedServiceStorageKey(username));
  return isKnownServiceLine(serviceLine) ? serviceLine : undefined;
}

function storeSelectedServiceLine(username: string | undefined, serviceLine: string) {
  if (!isKnownServiceLine(serviceLine)) return;
  if (username) localStorage.setItem(getSelectedServiceStorageKey(username), serviceLine);
  localStorage.setItem(getSelectedServiceStorageKey(), serviceLine);
}

function getSelectedServiceStorageKey(username?: string): string {
  return username ? `plannerSelectedServiceLine:${normalizeUsername(username)}` : "plannerSelectedServiceLine";
}

function isKnownServiceLine(serviceLine: string | null | undefined): serviceLine is (typeof SERVICE_LINES)[number] {
  return Boolean(serviceLine && SERVICE_LINES.includes(serviceLine as (typeof SERVICE_LINES)[number]));
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
  localStorage.removeItem("plannerPasswordUpdatedAt");
  localStorage.removeItem("plannerServicePrivileges");
  localStorage.removeItem("plannerMustChangePassword");
  localStorage.removeItem("plannerTemporaryPasswordExpiresAt");
}
