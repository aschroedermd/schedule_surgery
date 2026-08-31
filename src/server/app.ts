import cors from "cors";
import express from "express";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { URL } from "node:url";
import {
  isCoverageKindAllowedOnDate,
  isMinimallyInvasiveFellow,
  isPracticeWeekendStart,
  isResidentCallEligible
} from "../shared/coverage";
import { addDays, getCurrentMonday, minutesToTime, timeToMinutes } from "../shared/date";
import { createId } from "../shared/id";
import { getResidentTimeOff } from "../shared/availability";
import {
  evaluateCallSchedule,
  getCallBuilderBlock,
  getCallBuilderWeekendAnchor
} from "../shared/callBuilder";
import {
  CallBuilderInfeasibleError,
  describeScheduleChanges,
  solveCallSchedule
} from "./callBuilderSolver";
import {
  INDEPENDENT_CALL_LINES,
  isIndependentCallLine,
  resolveIndependentCallCoverage,
  resolveIndependentMondayEarlyMorningCoverage,
  type ResolvedIndependentCallCoverage
} from "../shared/attendingCoverage";
import {
  type ActivityActor,
  type ActivityInput,
  addActivity,
  applyClaim,
  applySuggestion,
  buildUncoveredMessage,
  buildWeekSchedule,
  collectWarnings,
  formatClinicLabel,
  makeAssignment
} from "../shared/scheduler";
import { isResidentOnService } from "../shared/services";
import {
  CALL_POSITIONS,
  ATTENDING_COVERAGE_LINES,
  Assignment,
  AssignmentChange,
  AttendingCoverageAssignment,
  AttendingCoverageLine,
  AttendingCoverageRole,
  AttendingCoverageShift,
  AttendingBlock,
  CallBuilderAssignment,
  CallBuilderSolverSummary,
  CallPosition,
  CallOffRequest,
  CallScheduleDraft,
  CaseOrderChange,
  ClaimRequest,
  ClinicSession,
  ClinicSessionChange,
  CollectionName,
  ContactRequest,
  CoverageChangeRequest,
  CoverageEntry,
  CoverageKind,
  DirectoryContact,
  CoverageRequestAction,
  GoldStarAward,
  HOSPITAL_CONTACT_FACILITIES,
  HospitalContactFacility,
  PlannerState,
  Resident,
  ResidentProfileChange,
  ResidentVacationChange,
  Role,
  SessionUser,
  SurgeryCase,
  WikiArticle,
  WikiArticleKind,
  WikiArticleRelationship,
  WikiArticleScope,
  WikiAuthority,
  WikiChangeEvent,
  WikiSource,
  WikiSourceReference,
  WikiStatus,
  WIKI_ARTICLE_KINDS,
  WIKI_AUTHORITIES,
  WIKI_CATEGORIES,
  WIKI_CLINICAL_PHASES,
  WIKI_RELATIONSHIP_TYPES,
  WIKI_SOURCE_TYPES,
  WIKI_STATUSES
} from "../shared/types";
import {
  AuthenticatedRequest,
  authenticate,
  createToken,
  requireAdmin,
  hasCallBuilderAccess,
  requireCallBuilder,
  requirePasswordReady,
  requireSessionAdmin,
  requireServiceEdit,
  requireServiceRequest,
  validateLogin
} from "./auth";
import { getOpenApiDocument } from "./openapi";
import {
  answerScheduleQuestion,
  ChatMessage,
  ChatRequestError,
  VoicePreset,
  getChatQuotaDateKey,
  refreshScheduleLookups,
  streamScheduleQuestion,
  synthesizeScheduleSpeech,
  transcribeScheduleAudio
} from "./chat";
import {
  ChatModelSettings,
  ChatSettingsStore,
  ChatSettingsValidationError,
  createDefaultChatSettingsStore
} from "./chatSettingsStore";
import { StateConflictError, StateStore } from "./store";
import { DEFAULT_VOICE_DAILY_LIMIT, UpsertUserInput, UserStore, createDefaultUserStore, hasServicePrivilege } from "./userStore";
import { syncQgenda } from "./qgenda";
import {
  normalizeWikiArticles,
  normalizeWikiSources,
  normalizeWikiSlug,
  computeWikiSourceHash,
  readWikiArticle,
  searchWikiArticles,
  summarizeWikiArticle,
  validateWikiKnowledgeBase
} from "./wiki";
import { WikiFileStore, createDefaultWikiFileStore } from "./wikiFileStore";

const MAX_SURGERY_CALL_RESIDENTS = 3;
const MAX_SCC_CALL_RESIDENTS = 1;
const DAILY_CHAT_LIMIT = 20;
const ASSISTANT_ACTION_TTL_MS = 10 * 60 * 1000;

type AssistantScheduleAction =
  | { kind: "coverage-request"; request: CoverageChangeRequest }
  | { kind: "coverage-direct"; action: CoverageRequestAction; entry?: CoverageEntry; entryId?: string; serviceLine: string }
  | { kind: "assignment-request"; request: CoverageChangeRequest }
  | { kind: "assignment-direct"; action: CoverageRequestAction; change: AssignmentChange; serviceLine: string }
  | { kind: "case-order-request"; request: CoverageChangeRequest }
  | { kind: "case-order-direct"; change: CaseOrderChange; serviceLine: string }
  | { kind: "clinic-session-request"; request: CoverageChangeRequest }
  | { kind: "clinic-session-direct"; change: ClinicSessionChange; serviceLine: string }
  | { kind: "request-resolution"; requestId: string; resolution: "approve" | "deny" };

interface PendingAssistantScheduleAction {
  token: string;
  username: string;
  expectedVersion: number;
  expiresAt: number;
  mode: "direct" | "request";
  summary: string;
  action: AssistantScheduleAction;
}

interface CompletedAssistantScheduleAction {
  username: string;
  expiresAt: number;
  message: string;
  stateVersion: number;
  dataUpdatedAt: string;
}

const collections: CollectionName[] = [
  "hospitals",
  "attendings",
  "residents",
  "procedureDefaults",
  "weeks",
  "attendingBlocks",
  "cases",
  "clinicSessions"
];
type ScheduleEditableCollection = "attendingBlocks" | "cases" | "clinicSessions";
const scheduleEditableCollections = new Set<CollectionName>(["attendingBlocks", "cases", "clinicSessions"]);

export function createApp(
  store: StateStore,
  options: { userStore?: UserStore; chatSettingsStore?: ChatSettingsStore; wikiFileStore?: WikiFileStore } = {}
) {
  const app = express();
  const userStore = options.userStore ?? createDefaultUserStore();
  const chatSettingsStore = options.chatSettingsStore ?? createDefaultChatSettingsStore();
  const wikiFileStore = options.wikiFileStore ?? createDefaultWikiFileStore();
  const requireAuth = authenticate(userStore);
  const loginLimiter = createRateLimiter(8, 15 * 60 * 1000);
  const transcriptionLimiter = createRateLimiter(25, 24 * 60 * 60 * 1000);
  const chatFeedbackLimiter = createRateLimiter(50, 24 * 60 * 60 * 1000);
  const stateSubscribers = new Set<express.Response>();
  const pendingAssistantActions = new Map<string, PendingAssistantScheduleAction>();
  const completedAssistantActions = new Map<string, CompletedAssistantScheduleAction>();
  app.locals.broadcastPlannerState = (state: PlannerState) => broadcastStateEvent(stateSubscribers, state);

  app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use(cors(getCorsOptions()));
  app.use("/api/wiki/sources/:sourceId/file", express.raw({ type: "*/*", limit: "25mb" }));
  app.use(express.json({ limit: "12mb" }));

  function assistantActionPreparer(state: PlannerState, user: SessionUser, serviceLine: string) {
    return {
      prepare(args: Record<string, unknown>) {
        pruneAssistantActionMaps(pendingAssistantActions, completedAssistantActions);
        const pending = prepareAssistantScheduleAction(state, user, serviceLine, args);
        pendingAssistantActions.set(pending.token, pending);
        return {
          token: pending.token,
          mode: pending.mode,
          summary: pending.summary,
          prompt: pending.mode === "direct"
            ? `Ready to make this change: ${pending.summary}`
            : `Ready to submit this for approval: ${pending.summary}`
        };
      }
    };
  }

  app.get("/api/healthz", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/openapi.json", (_req, res) => {
    res.json(getOpenApiDocument());
  });

  app.get("/api/docs", (_req, res) => {
    res.type("html").send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>Resident OR Coverage Planner API</title>
          <style>
            body { font-family: system-ui, sans-serif; max-width: 840px; margin: 40px auto; padding: 0 20px; line-height: 1.5; color: #1d2733; }
            code, pre { background: #f1f4f7; border-radius: 6px; }
            code { padding: 2px 5px; }
            pre { padding: 12px; overflow: auto; }
            a { color: #20675a; font-weight: 700; }
          </style>
        </head>
        <body>
          <h1>Resident OR Coverage Planner API</h1>
          <p>Use <code>X-API-Key</code> for external tools and MCP servers.</p>
          <p><a href="/api/openapi.json">OpenAPI JSON</a></p>
          <pre>curl -H "X-API-Key: $ADMIN_API_KEY" ${process.env.PUBLIC_BASE_URL || ""}/api/state</pre>
        </body>
      </html>
    `);
  });

  app.post("/api/auth/login", async (req, res, next) => {
    try {
      const { username, password } = req.body as { username?: string; password?: string };
      if (!username || !password) {
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }
      if (!loginLimiter.tryConsume(`${req.ip}:${username.trim().toLowerCase()}`)) {
        res.status(429).json({ error: "Too many login attempts; wait a few minutes and try again" });
        return;
      }
      const user = await validateLogin(userStore, username, password);
      if (!user) {
        res.status(401).json({ error: "Invalid username or password" });
        return;
      }
      await recordActivity({
        ...userActivityActor(user),
        activityType: "login",
        action: "logged in",
        details: `${user.displayName || user.username} logged in`,
        entityType: "user",
        entityId: user.username
      });
      res.json({ token: createToken(user), ...user });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/session", requireAuth, (req: AuthenticatedRequest, res) => {
    res.json(req.user);
  });

  app.patch("/api/me/voice-preset", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.body || typeof req.body !== "object" || !("preferredVoicePreset" in req.body)) {
        throw new HttpError(400, "preferredVoicePreset is required");
      }
      const preferredVoicePreset = readVoicePreset(req.body.preferredVoicePreset);
      const user = await userStore.updatePreferredVoicePreset(req.user!.username, preferredVoicePreset);
      res.json({ preferredVoicePreset: user.preferredVoicePreset });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/chat-settings", requireAuth, requireAdmin, async (_req: AuthenticatedRequest, res, next) => {
    try {
      res.json(await chatSettingsStore.get());
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/chat-settings", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json(await chatSettingsStore.update(readChatModelSettingsPatch(req.body)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/admin/users/:username/voice-quota", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const username = getParam(req.params.username).trim().toLowerCase();
      const user = await userStore.getUser(username);
      if (!user) throw new HttpError(404, "User not found");
      res.json(await getUserVoiceQuota(store, user.username, user.voiceDailyLimit));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/admin/users/:username/voice-quota", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const username = getParam(req.params.username).trim().toLowerCase();
      let user = await userStore.getUser(username);
      if (!user) throw new HttpError(404, "User not found");
      const hasLimit = Object.prototype.hasOwnProperty.call(req.body, "limit");
      const resetUsed = req.body.resetUsed === true;
      if (!hasLimit && !resetUsed) throw new HttpError(400, "Provide limit and/or resetUsed: true");
      if (hasLimit) {
        if (!Number.isInteger(req.body.limit) || req.body.limit < 0 || req.body.limit > 10_000) {
          throw new HttpError(400, "Voice limit must be an integer from 0 to 10000");
        }
        user = await userStore.updateVoiceDailyLimit(username, req.body.limit);
      }
      if (resetUsed) await store.resetVoiceQuota(username, getChatQuotaDateKey());
      res.json(await getUserVoiceQuota(store, user.username, user.voiceDailyLimit));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/chat/quota", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const unlimited = req.user!.role === "admin";
      const quota = unlimited
        ? { used: 0, remaining: DAILY_CHAT_LIMIT }
        : await store.getChatQuota(req.user!.username, getChatQuotaDateKey(), DAILY_CHAT_LIMIT);
      res.json({ ...quota, limit: DAILY_CHAT_LIMIT, warningThreshold: 5, unlimited });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/chat/voice/quota", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const limit = (await userStore.getUser(req.user!.username))?.voiceDailyLimit ?? DEFAULT_VOICE_DAILY_LIMIT;
      const quota = await store.getVoiceQuota(req.user!.username, getChatQuotaDateKey(), limit);
      res.json({ ...quota, limit, unlimited: false });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chat", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const modelSettings = await chatSettingsStore.get();
      if (!isChatProviderConfigured(modelSettings)) {
        res.status(503).json({ error: "The schedule assistant is not configured yet" });
        return;
      }
      const messages = Array.isArray(req.body.messages) ? (req.body.messages as ChatMessage[]) : [];
      const serviceLine = readOptionalString(req.body.serviceLine);
      if (!serviceLine) {
        res.status(400).json({ error: "Current service is required" });
        return;
      }
      const unlimited = req.user!.role === "admin";
      const quota = unlimited
        ? { allowed: true, used: 0, remaining: DAILY_CHAT_LIMIT }
        : await store.consumeChatQuota(req.user!.username, getChatQuotaDateKey(), DAILY_CHAT_LIMIT);
      if (!quota.allowed) {
        res.status(429).json({
          error: "Daily assistant limit reached. Try again after midnight Eastern time.",
          ...quota,
          limit: DAILY_CHAT_LIMIT,
          warningThreshold: 5
        });
        return;
      }
      const state = filterStateForUser(await store.load(), req.user, { includeWikiSources: true });
      const answer = await answerScheduleQuestion(
        messages,
        {
          state,
          user: req.user!,
          serviceLine,
          voiceMode: req.body.voiceMode === true,
          actions: assistantActionPreparer(state, req.user!, serviceLine)
        },
        fetch,
        modelSettings
      );
      res.json({
        ...answer,
        used: quota.used,
        remaining: quota.remaining,
        limit: DAILY_CHAT_LIMIT,
        warningThreshold: 5,
        unlimited
      });
    } catch (error) {
      if (error instanceof ChatRequestError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.post("/api/chat/stream", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    let modelSettings: ChatModelSettings;
    try {
      modelSettings = await chatSettingsStore.get();
    } catch (error) {
      next(error);
      return;
    }
    if (!isChatProviderConfigured(modelSettings)) {
      res.status(503).json({ error: "The schedule assistant is not configured yet" });
      return;
    }
    const messages = Array.isArray(req.body.messages) ? (req.body.messages as ChatMessage[]) : [];
    const serviceLine = readOptionalString(req.body.serviceLine);
    if (!serviceLine) {
      res.status(400).json({ error: "Current service is required" });
      return;
    }

    try {
      const unlimited = req.user!.role === "admin";
      const quota = unlimited
        ? { allowed: true, used: 0, remaining: DAILY_CHAT_LIMIT }
        : await store.consumeChatQuota(req.user!.username, getChatQuotaDateKey(), DAILY_CHAT_LIMIT);
      if (!quota.allowed) {
        res.status(429).json({
          error: "Daily assistant limit reached. Try again after midnight Eastern time.",
          ...quota,
          limit: DAILY_CHAT_LIMIT,
          warningThreshold: 5
        });
        return;
      }
      const state = filterStateForUser(await store.load(), req.user, { includeWikiSources: true });
      const abortController = new AbortController();
      res.on("close", () => {
        if (!res.writableEnded) abortController.abort();
      });
      res.status(200);
      res.setHeader("content-type", "application/x-ndjson; charset=utf-8");
      res.setHeader("cache-control", "no-cache, no-transform");
      res.setHeader("x-accel-buffering", "no");
      res.flushHeaders();
      writeChatStreamEvent(res, {
        type: "meta",
        used: quota.used,
        remaining: quota.remaining,
        limit: DAILY_CHAT_LIMIT,
        warningThreshold: 5,
        unlimited,
        checkedAt: new Date().toISOString(),
        dataUpdatedAt: state.updatedAt,
        stateVersion: state.version
      });
      const answer = await streamScheduleQuestion(
        messages,
        {
          state,
          user: req.user!,
          serviceLine,
          voiceMode: req.body.voiceMode === true,
          actions: assistantActionPreparer(state, req.user!, serviceLine)
        },
        (delta) => writeChatStreamEvent(res, { type: "delta", delta }),
        fetch,
        abortController.signal,
        () => writeChatStreamEvent(res, { type: "reset" }),
        modelSettings
      );
      writeChatStreamEvent(res, {
        type: "complete",
        ...answer,
        used: quota.used,
        remaining: quota.remaining,
        limit: DAILY_CHAT_LIMIT,
        warningThreshold: 5,
        unlimited
      });
      res.end();
    } catch (error) {
      if (res.headersSent) {
        if (!res.writableEnded && !res.destroyed) {
          const message =
            error instanceof ChatRequestError
              ? error.message
              : error instanceof DOMException && error.name === "AbortError"
                ? "Request stopped"
                : "The assistant could not answer";
          writeChatStreamEvent(res, { type: "error", error: message });
          res.end();
        }
        return;
      }
      if (error instanceof ChatRequestError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.post("/api/chat/lookups/refresh", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const serviceLine = readOptionalString(req.body.serviceLine);
      if (!serviceLine) {
        res.status(400).json({ error: "Current service is required" });
        return;
      }
      const state = filterStateForUser(await store.load(), req.user);
      const requestedLookups = Array.isArray(req.body.lookups) ? req.body.lookups : [];
      const lookups = refreshScheduleLookups(requestedLookups, {
        state,
        user: req.user!,
        serviceLine
      });
      res.json({
        lookups,
        checkedAt: new Date().toISOString(),
        dataUpdatedAt: state.updatedAt,
        stateVersion: state.version
      });
    } catch (error) {
      if (error instanceof ChatRequestError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.post("/api/chat/actions/:token/commit", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      pruneAssistantActionMaps(pendingAssistantActions, completedAssistantActions);
      const token = getParam(req.params.token);
      const completed = completedAssistantActions.get(token);
      if (completed) {
        if (completed.username !== req.user!.username) throw new HttpError(403, "This action belongs to another account");
        res.json({ message: completed.message, stateVersion: completed.stateVersion, dataUpdatedAt: completed.dataUpdatedAt });
        return;
      }
      const pending = pendingAssistantActions.get(token);
      if (!pending) throw new HttpError(404, "This confirmation expired. Ask the assistant to prepare the change again.");
      if (pending.username !== req.user!.username) throw new HttpError(403, "This action belongs to another account");
      const state = await store.load();
      if (state.version !== pending.expectedVersion) {
        pendingAssistantActions.delete(token);
        res.status(409).json({
          error: "The schedule changed after this preview. Ask the assistant to check and prepare it again.",
          currentVersion: state.version
        });
        return;
      }
      const committed = commitAssistantScheduleAction(state, req.user!, pending);
      const saved = await store.save(committed.state, { expectedVersion: pending.expectedVersion });
      broadcastStateEvent(stateSubscribers, saved);
      const result: CompletedAssistantScheduleAction = {
        username: req.user!.username,
        expiresAt: Date.now() + ASSISTANT_ACTION_TTL_MS,
        message: committed.message,
        stateVersion: saved.version,
        dataUpdatedAt: saved.updatedAt
      };
      pendingAssistantActions.delete(token);
      completedAssistantActions.set(token, result);
      res.json({ message: result.message, stateVersion: result.stateVersion, dataUpdatedAt: result.dataUpdatedAt });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chat/feedback", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const rating = req.body.rating === "up" || req.body.rating === "down" ? req.body.rating : undefined;
      if (!rating) {
        res.status(400).json({ error: "Feedback rating must be up or down" });
        return;
      }
      if (!chatFeedbackLimiter.tryConsume(`${req.user!.username}:${getChatQuotaDateKey()}`)) {
        res.status(429).json({ error: "Feedback limit reached for today" });
        return;
      }
      await recordActivity({
        ...requestActivityActor(req),
        activityType: "assistant",
        action: `rated assistant response ${rating}`,
        details: readOptionalString(req.body.excerpt)?.slice(0, 240) || "Assistant response feedback",
        entityType: "assistant"
      });
      res.json({ ok: true });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/chat/transcribe", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const dateKey = getChatQuotaDateKey();
      const unlimited = req.user!.role === "admin";
      const quota = unlimited
        ? { used: 0, remaining: DAILY_CHAT_LIMIT }
        : await store.getChatQuota(req.user!.username, dateKey, DAILY_CHAT_LIMIT);
      if (!unlimited && quota.remaining === 0) {
        res.status(429).json({ error: "Daily assistant limit reached. Try again after midnight Eastern time." });
        return;
      }
      if (!unlimited && !transcriptionLimiter.tryConsume(`${req.user!.username}:${dateKey}`)) {
        res.status(429).json({ error: "Daily voice recording limit reached. Try again tomorrow." });
        return;
      }
      const text = await transcribeScheduleAudio(
        {
          data: typeof req.body.data === "string" ? req.body.data : "",
          format: typeof req.body.format === "string" ? req.body.format : undefined
        },
        fetch,
        await chatSettingsStore.get()
      );
      res.json({ text });
    } catch (error) {
      if (error instanceof ChatRequestError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.post("/api/chat/speech", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = typeof req.body.input === "string" ? req.body.input.trim() : "";
      if (!input) {
        res.status(400).json({ error: "Speech text is required" });
        return;
      }
      const voicePreset = readVoicePreset(req.body.voicePreset);
      if (!process.env.ELEVENLABS_API_KEY) {
        res.status(503).json({ error: "ElevenLabs voice is not configured yet" });
        return;
      }
      const limit = (await userStore.getUser(req.user!.username))?.voiceDailyLimit ?? DEFAULT_VOICE_DAILY_LIMIT;
      const quota = await store.consumeVoiceQuota(req.user!.username, getChatQuotaDateKey(), limit);
      if (!quota.allowed) {
        res.status(429).json({
          error: "Voice limit reached",
          ...quota,
          limit,
          unlimited: false
        });
        return;
      }
      const speech = await synthesizeScheduleSpeech(input, voicePreset, fetch, await chatSettingsStore.get());
      res.setHeader("content-type", speech.contentType);
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-voice-used", String(quota.used));
      res.setHeader("x-voice-remaining", String(quota.remaining));
      res.setHeader("x-voice-limit", String(limit));
      res.setHeader("x-voice-unlimited", "false");
      res.setHeader("x-voice-preset", String(voicePreset));
      res.send(Buffer.from(speech.audio));
    } catch (error) {
      if (error instanceof ChatRequestError) {
        res.status(error.status).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  app.get("/api/events", requireAuth, requirePasswordReady, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      res.write(formatStateEvent(state));
      stateSubscribers.add(res);
      res.on("close", () => {
        stateSubscribers.delete(res);
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/users", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json({ users: await userStore.listUsers() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const input = normalizeUserCreationInput(req, req.body);
      const state = await store.load();
      assertAttendingAccountLinks(state, [input]);
      assertMedicalStudentAccountLinks(state, [input]);
      const created = await userStore.createUser(input);
      const nextState = addActivity(addMedicalStudentRosterEntries(state, [created.user]), {
        ...requestActivityActor(req),
        activityType: "account",
        action: "created account",
        details: `Created account for ${formatUserSummary(created.user)}`,
        entityType: "user",
        entityId: created.user.username
      });
      await commitState(req, nextState);
      res.status(201).json({ ...created, ...(await sessionUserList(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users/bulk", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const users = Array.isArray(req.body.users) ? req.body.users.map((input: unknown) => normalizeUserCreationInput(req, input)) : [];
      const state = await store.load();
      assertAttendingAccountLinks(state, users);
      assertMedicalStudentAccountLinks(state, users);
      const created = await userStore.createUsers(users);
      const nextState = addActivity(addMedicalStudentRosterEntries(state, created.map((item) => item.user)), {
        ...requestActivityActor(req),
        activityType: "account",
        action: "created accounts",
        details: `Created accounts for ${created.map((item) => formatUserSummary(item.user)).join(", ")}`,
        entityType: "user",
        entityId: created.map((item) => item.user.username).join(",")
      });
      await commitState(req, nextState);
      res.status(201).json({ created, ...(await sessionUserList(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/:username", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const username = getParam(req.params.username);
      const existing = await userStore.getUser(username);
      if (!existing) throw new HttpError(404, "User not found");
      assertApiKeyUserUpdateAllowed(req, existing);
      const state = await store.load();
      const input = {
        role: req.body.role ?? existing.role,
        attendingId: req.body.attendingId ?? existing.attendingId,
        username: existing.username,
        displayName: req.body.displayName ?? existing.displayName
      };
      assertAttendingAccountLinks(state, [input]);
      assertMedicalStudentAccountLinks(state, [input]);
      const user = await userStore.updateUser(username, {
        displayName: readOptionalString(req.body.displayName),
        role: isRole(req.body.role) ? req.body.role : undefined,
        attendingId: readOptionalString(req.body.attendingId),
        servicePrivileges: req.body.servicePrivileges,
        canAddContacts: typeof req.body.canAddContacts === "boolean" ? req.body.canAddContacts : undefined,
        canBuildCall: typeof req.body.canBuildCall === "boolean" ? req.body.canBuildCall : undefined
      });
      const nextState = addActivity(addMedicalStudentRosterEntries(state, [user]), {
        ...requestActivityActor(req),
        activityType: "account",
        action: "updated account",
        details: `Updated account for ${formatUserSummary(user)}`,
        entityType: "user",
        entityId: user.username
      });
      await commitState(req, nextState);
      res.json({ user, users: await userStore.listUsers() });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/:username/password", requireAuth, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const username = getParam(req.params.username);
      if (req.user?.authType === "apiKey" && username.trim().toLowerCase() === "admin") {
        throw new HttpError(403, "The admin API key cannot reset the built-in browser admin account");
      }
      const requestedTemporaryPassword = readRequestedTemporaryPassword(req.body);
      const reset = await userStore.resetPassword(username, requestedTemporaryPassword);
      await recordActivity({
        ...requestActivityActor(req),
        activityType: "account",
        action: "reset password",
        details: `Reset password for ${formatUserSummary(reset.user)}`,
        entityType: "user",
        entityId: reset.user.username
      });
      res.json({ ...reset, ...(await sessionUserList(req)) });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/users/:username", requireAuth, requireSessionAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const username = getParam(req.params.username);
      await userStore.deleteUser(username);
      await recordActivity({
        ...requestActivityActor(req),
        activityType: "account",
        action: "deleted account",
        details: `Deleted account ${username}`,
        entityType: "user",
        entityId: username
      });
      res.json({ users: await userStore.listUsers() });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/me/password", requireAuth, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (!req.user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      const user = await userStore.changePassword(
        req.user.username,
        String(req.body.currentPassword ?? ""),
        String(req.body.nextPassword ?? "")
      );
      await recordActivity({
        ...requestActivityActor(req),
        activityType: "account",
        action: "changed password",
        details: `${formatUserSummary(user)} changed password`,
        entityType: "user",
        entityId: user.username
      });
      res.json({ token: createToken(user), ...user });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/me/password/skip", requireAuth, (req: AuthenticatedRequest, res) => {
    if (!req.user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    if (!req.user.mustChangePassword) {
      res.status(400).json({ error: "Password change is not required" });
      return;
    }
    res.json({ token: createToken(req.user, { deferPasswordChange: true }) });
  });

  app.get("/api/state", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json(filterStateForUser(await store.load(), req.user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/call-off-requests", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const linkedResident = findResidentForUser(state, req.user);
      const requestedResidentId = readOptionalString(req.body?.residentId);
      const resident = hasCallBuilderAccess(req.user) && requestedResidentId
        ? state.residents.find((candidate) => candidate.id === requestedResidentId)
        : linkedResident;
      if (!resident) {
        throw new HttpError(403, "A linked resident roster record is required to submit a call-off request");
      }
      if (!hasCallBuilderAccess(req.user) && requestedResidentId && requestedResidentId !== resident.id) {
        throw new HttpError(403, "Call-off requests may be submitted only for your linked resident record");
      }

      const date = assertDate(req.body?.date);
      const weekday = new Date(`${date}T12:00:00`).getDay();
      if (weekday !== 5 && weekday !== 6 && weekday !== 0) {
        throw new HttpError(400, "Call-off requests must use a Friday, Saturday, or Sunday date");
      }
      const block = getCallBuilderBlockForDate(date);
      if (!block) throw new HttpError(400, "The requested date is outside the configured rotation blocks");
      const scope = req.body?.scope === "weekend" ? "weekend" as const : req.body?.scope === "day" ? "day" as const : undefined;
      if (!scope) throw new HttpError(400, "scope must be day or weekend");
      const priority = req.body?.priority === "secondary" ? "secondary" as const : req.body?.priority === "priority" ? "priority" as const : undefined;
      if (!priority) throw new HttpError(400, "priority must be priority or secondary");
      const reason = readOptionalString(req.body?.reason);
      if (reason && reason.length > 280) throw new HttpError(400, "Reason must be 280 characters or fewer");
      assertNoPhiText(reason ?? "", "call-off request reason");

      const now = new Date().toISOString();
      const existing = state.callOffRequests.find((request) => {
        const requestBlock = getCallBuilderBlockForDate(request.date);
        return request.residentId === resident.id && request.priority === priority && requestBlock?.blockNumber === block.blockNumber;
      });
      const request: CallOffRequest = existing
        ? { ...existing, date, scope, reason, updatedAt: now }
        : {
            id: createId("call_off_request"),
            residentId: resident.id,
            requesterUsername: req.user!.username,
            requesterName: req.user!.displayName || req.user!.username,
            date,
            scope,
            priority,
            reason,
            createdAt: now,
            updatedAt: now
          };
      const nextState: PlannerState = {
        ...state,
        callOffRequests: existing
          ? state.callOffRequests.map((item) => item.id === existing.id ? request : item)
          : [request, ...state.callOffRequests]
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req, "viewer"),
        activityType: "calendar",
        action: existing ? "updated call-off request" : "submitted call-off request",
        details: `${resident.name} requested ${priority} ${scope} off on ${date}`,
        entityType: "callOffRequest",
        entityId: request.id
      });
      const saved = await commitState(req, withActivity);
      res.status(existing ? 200 : 201).json(filterStateForUser(saved, req.user));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/call-off-requests/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const request = state.callOffRequests.find((candidate) => candidate.id === id);
      if (!request) throw new HttpError(404, "Call-off request not found");
      const linkedResident = findResidentForUser(state, req.user);
      if (!hasCallBuilderAccess(req.user) && request.requesterUsername !== req.user?.username && request.residentId !== linkedResident?.id) {
        throw new HttpError(403, "You can withdraw only your own call-off request");
      }
      const resident = state.residents.find((candidate) => candidate.id === request.residentId);
      const nextState = addActivity(
        { ...state, callOffRequests: state.callOffRequests.filter((candidate) => candidate.id !== id) },
        {
          ...requestActivityActor(req, "viewer"),
          activityType: "calendar",
          action: "withdrew call-off request",
          details: `${resident?.name ?? request.requesterName} withdrew ${request.priority} ${request.scope} off on ${request.date}`,
          entityType: "callOffRequest",
          entityId: id
        }
      );
      res.json(filterStateForUser(await commitState(req, nextState), req.user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/call-builder/generate", requireAuth, requireCallBuilder, async (req: AuthenticatedRequest, res, next) => {
    try {
      const blockNumber = readCallBuilderBlockNumber(req.body?.blockNumber);
      const lockedAssignments = req.body?.lockedAssignments === undefined
        ? []
        : readCallBuilderAssignments(req.body.lockedAssignments);
      const baselineAssignments = req.body?.baselineAssignments === undefined
        ? []
        : readCallBuilderAssignments(req.body.baselineAssignments);
      res.json(await solveCallSchedule(await store.load(), blockNumber, { lockedAssignments, baselineAssignments }));
    } catch (error) {
      if (error instanceof CallBuilderInfeasibleError) {
        next(new HttpError(422, error.message));
        return;
      }
      next(error);
    }
  });

  app.post("/api/call-builder/suggest", requireAuth, requireCallBuilder, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const blockNumber = readCallBuilderBlockNumber(req.body?.blockNumber);
      const assignments = readCallBuilderAssignments(req.body?.assignments);
      const lockedAssignments = req.body?.lockedAssignments === undefined
        ? []
        : readCallBuilderAssignments(req.body.lockedAssignments);
      const current = evaluateCallSchedule(state, blockNumber, assignments);
      const optimized = await solveCallSchedule(state, blockNumber, {
        lockedAssignments,
        baselineAssignments: assignments
      });
      if (optimized.assignments.every((assignment, index) => {
        const candidate = assignments[index];
        return candidate
          && candidate.date === assignment.date
          && candidate.callPosition === assignment.callPosition
          && candidate.residentId === assignment.residentId;
      })) {
        res.json([]);
        return;
      }
      res.json([{
        id: `optimized:${blockNumber}:${Date.now()}`,
        description: describeScheduleChanges(state, assignments, optimized.assignments),
        improvement: Math.max(0, current.penalty - optimized.penalty),
        assignments: optimized.assignments,
        solverSummary: optimized.solverSummary
      }]);
    } catch (error) {
      if (error instanceof CallBuilderInfeasibleError) {
        next(new HttpError(422, error.message));
        return;
      }
      next(error);
    }
  });

  app.post("/api/call-builder/validate", requireAuth, requireCallBuilder, async (req: AuthenticatedRequest, res, next) => {
    try {
      const blockNumber = readCallBuilderBlockNumber(req.body?.blockNumber);
      const assignments = readCallBuilderAssignments(req.body?.assignments);
      res.json(evaluateCallSchedule(await store.load(), blockNumber, assignments));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/call-builder/drafts", requireAuth, requireCallBuilder, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const blockNumber = readCallBuilderBlockNumber(req.body?.blockNumber);
      const assignments = readCallBuilderAssignments(req.body?.assignments);
      if (assignments.length === 0) throw new HttpError(400, "Add at least one assignment before saving a draft");
      const evaluation = evaluateCallSchedule(state, blockNumber, assignments);
      const now = new Date().toISOString();
      const draft: CallScheduleDraft = {
        id: createId("call_schedule_draft"),
        blockNumber,
        assignments: evaluation.assignments,
        createdByUsername: req.user!.username,
        createdByName: req.user!.displayName || req.user!.username,
        createdAt: now,
        isMain: false,
        solverSummary: readCallBuilderSolverSummary(req.body?.solverSummary),
        evaluationSnapshot: {
          hardViolationCount: evaluation.hardViolationCount,
          warningCount: evaluation.warningCount,
          fairnessPercent: evaluation.fairnessPercent,
          qualityScore: evaluation.qualityScore
        }
      };
      const nextState = addActivity(
        { ...state, callScheduleDrafts: [draft, ...state.callScheduleDrafts] },
        {
          ...requestActivityActor(req),
          activityType: "calendar",
          action: "saved call schedule draft",
          details: `Saved a block ${blockNumber} call draft with ${evaluation.assignments.length} assignments, ${evaluation.hardViolationCount} blocker${evaluation.hardViolationCount === 1 ? "" : "s"}, and ${evaluation.warningCount} advisory issue${evaluation.warningCount === 1 ? "" : "s"}`,
          entityType: "callScheduleDraft",
          entityId: draft.id
        }
      );
      const saved = await commitState(req, nextState);
      res.status(201).json(filterStateForUser(saved, req.user));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/call-builder/drafts/:id", requireAuth, requireCallBuilder, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (typeof req.body?.isMain !== "boolean") throw new HttpError(400, "isMain must be true or false");
      const state = await store.load();
      const id = getParam(req.params.id);
      const draft = state.callScheduleDrafts.find((candidate) => candidate.id === id);
      if (!draft) throw new HttpError(404, "Call schedule draft not found");
      const isMain = req.body.isMain as boolean;
      const callScheduleDrafts = state.callScheduleDrafts.map((candidate) => {
        if (candidate.id === id) return { ...candidate, isMain };
        if (isMain && candidate.blockNumber === draft.blockNumber) return { ...candidate, isMain: false };
        return candidate;
      });
      const nextState = addActivity(
        { ...state, callScheduleDrafts },
        {
          ...requestActivityActor(req),
          activityType: "calendar",
          action: isMain ? "selected main call schedule draft" : "cleared main call schedule draft",
          details: `${isMain ? "Selected" : "Cleared"} the ${draft.createdAt} draft for block ${draft.blockNumber}${isMain ? " as the default" : ""}`,
          entityType: "callScheduleDraft",
          entityId: draft.id
        }
      );
      const saved = await commitState(req, nextState);
      res.json(filterStateForUser(saved, req.user));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/call-builder/drafts/:id", requireAuth, requireCallBuilder, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const id = getParam(req.params.id);
      const draft = state.callScheduleDrafts.find((candidate) => candidate.id === id);
      if (!draft) throw new HttpError(404, "Call schedule draft not found");
      if (draft.createdByUsername !== req.user!.username) {
        throw new HttpError(403, "Only the person who saved this draft can delete it");
      }
      const nextState = addActivity(
        { ...state, callScheduleDrafts: state.callScheduleDrafts.filter((candidate) => candidate.id !== id) },
        {
          ...requestActivityActor(req),
          activityType: "calendar",
          action: "deleted call schedule draft",
          details: `Deleted their ${draft.createdAt} call draft for block ${draft.blockNumber}`,
          entityType: "callScheduleDraft",
          entityId: draft.id
        }
      );
      const saved = await commitState(req, nextState);
      res.json(filterStateForUser(saved, req.user));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/contacts", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = filterStateForUser(await store.load(), req.user);
      res.json({ contacts: state.contacts, requests: state.contactRequests, stateVersion: state.version });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/contacts", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const now = new Date().toISOString();
      const contact = readDirectoryContact(req.body, req.user?.username, now);
      assertContactIsUnique(state, contact);
      const canAddDirectly = req.user?.role === "admin" || req.user?.canAddContacts === true;
      const nextState: PlannerState = canAddDirectly
        ? { ...state, contacts: [...state.contacts, contact] }
        : {
            ...state,
            contactRequests: [
              {
                id: createId("contact_request"),
                contact,
                status: "pending",
                requesterUsername: req.user!.username,
                requesterName: req.user!.displayName || req.user!.username,
                createdAt: now,
                updatedAt: now
              },
              ...state.contactRequests
            ]
          };
      const saved = await commitState(req, addActivity(nextState, {
        ...requestActivityActor(req, "viewer"),
        activityType: "account",
        action: canAddDirectly ? "added directory contact" : "requested directory contact",
        details: `${contact.name} · ${contact.phoneNumber} · ${contact.category}`,
        entityType: canAddDirectly ? "directoryContact" : "contactRequest",
        entityId: canAddDirectly ? contact.id : nextState.contactRequests[0].id
      }));
      res.setHeader("x-contact-disposition", canAddDirectly ? "added" : "requested");
      res.status(201).json(filterStateForUser(saved, req.user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/contact-requests/:id/approve", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const id = getParam(req.params.id);
      const contactRequest = requireContactRequest(state, id);
      if (contactRequest.status !== "pending") throw new HttpError(400, "Contact request is already resolved");
      assertContactIsUnique(state, contactRequest.contact, id);
      const now = new Date().toISOString();
      const nextState: PlannerState = {
        ...state,
        contacts: [...state.contacts, { ...contactRequest.contact, updatedAt: now }],
        contactRequests: state.contactRequests.map((item) => item.id === id ? {
          ...item,
          status: "approved",
          adminNote: readOptionalString(req.body.adminNote),
          updatedAt: now,
          resolvedAt: now,
          resolvedBy: req.user!.username
        } : item)
      };
      const saved = await commitState(req, addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: "account",
        action: "approved directory contact",
        details: `${contactRequest.contact.name} · ${contactRequest.contact.phoneNumber}`,
        entityType: "contactRequest",
        entityId: id
      }));
      res.json(saved);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/contact-requests/:id/reject", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const id = getParam(req.params.id);
      const contactRequest = requireContactRequest(state, id);
      if (contactRequest.status !== "pending") throw new HttpError(400, "Contact request is already resolved");
      const now = new Date().toISOString();
      const nextState: PlannerState = {
        ...state,
        contactRequests: state.contactRequests.map((item) => item.id === id ? {
          ...item,
          status: "rejected",
          adminNote: readOptionalString(req.body.adminNote),
          updatedAt: now,
          resolvedAt: now,
          resolvedBy: req.user!.username
        } : item)
      };
      const saved = await commitState(req, addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: "account",
        action: "rejected directory contact",
        details: `${contactRequest.contact.name} · ${contactRequest.contact.phoneNumber}`,
        entityType: "contactRequest",
        entityId: id
      }));
      res.json(saved);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/contacts/:id", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const id = getParam(req.params.id);
      const existing = state.contacts.find((item) => item.id === id);
      if (!existing) throw new HttpError(404, "Contact not found");
      const now = new Date().toISOString();
      const contact = readDirectoryContactUpdate(req.body, existing, now);
      assertContactIsUnique(state, contact, undefined, id);
      const saved = await commitState(req, addActivity({
        ...state,
        contacts: state.contacts.map((item) => item.id === id ? contact : item)
      }, {
        ...requestActivityActor(req),
        activityType: "account",
        action: "updated directory contact",
        details: `${contact.name} · ${contact.phoneNumber} · ${contact.category}`,
        entityType: "directoryContact",
        entityId: id
      }));
      res.json(saved);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/contacts/:id", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const id = getParam(req.params.id);
      const contact = state.contacts.find((item) => item.id === id);
      if (!contact) throw new HttpError(404, "Contact not found");
      const saved = await commitState(req, addActivity({
        ...state,
        contacts: state.contacts.filter((item) => item.id !== id)
      }, {
        ...requestActivityActor(req),
        activityType: "account",
        action: "removed directory contact",
        details: `${contact.name} · ${contact.phoneNumber}`,
        entityType: "directoryContact",
        entityId: id
      }));
      res.json(saved);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/wiki", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const query = readOptionalString(req.query.query) ?? "";
      const limit = readOptionalPositiveInteger(req.query.limit) ?? 8;
      const includeUnpublished = req.user?.role === "admin" && req.query.includeUnpublished === "true";
      const visibleArticles = includeUnpublished
        ? state.wikiArticles
        : state.wikiArticles.filter((article) => article.status === "published");
      const articles = query
        ? searchWikiArticles(state.wikiArticles, query, limit, includeUnpublished)
        : visibleArticles
            .slice()
            .sort((left, right) => left.category.localeCompare(right.category) || left.title.localeCompare(right.title))
            .slice(0, Math.min(limit, 50))
            .map(summarizeWikiArticle);
      res.json({ articles, query, stateVersion: state.version, dataUpdatedAt: state.updatedAt });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/wiki/export", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      res.json({
        formatVersion: 1,
        wikiRevision: state.wikiRevision,
        exportedAt: new Date().toISOString(),
        articles: state.wikiArticles,
        sources: state.wikiSources
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/wiki/changes", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const after = readOptionalNonNegativeInteger(req.query.after) ?? 0;
      const oldestAvailableRevision = state.wikiChanges[0]?.revision ?? state.wikiRevision;
      res.json({
        after,
        currentRevision: state.wikiRevision,
        oldestAvailableRevision,
        requiresFullExport: Boolean(state.wikiChanges.length && after < oldestAvailableRevision - 1),
        changes: state.wikiChanges.filter((change) => change.revision > after)
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/wiki/sources", requireAuth, requirePasswordReady, requireAdmin, async (_req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      res.json({ sources: state.wikiSources.map(withWikiSourceDownload), wikiRevision: state.wikiRevision });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/wiki/sources/:sourceId/file", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const sourceId = normalizeWikiSourceId(getParam(req.params.sourceId));
      const source = state.wikiSources.find((candidate) => candidate.id === sourceId);
      const isPublishedReference = state.wikiArticles.some((article) =>
        article.status === "published" && article.sourceRefs.some((reference) => reference.sourceId === sourceId)
      );
      if (!source?.referenceFile?.available || (req.user?.role !== "admin" && !isPublishedReference)) {
        throw new HttpError(404, "Wiki reference file not found");
      }
      const data = await wikiFileStore.read(sourceId);
      if (!data || computeWikiSourceHash(data) !== source.contentHash) {
        throw new HttpError(404, "Wiki reference file not found");
      }
      res.setHeader("cache-control", "private, no-store");
      res.setHeader("content-type", source.referenceFile.mediaType);
      res.setHeader("content-length", String(data.byteLength));
      res.setHeader("content-disposition", contentDispositionAttachment(source.referenceFile.filename));
      res.send(data);
    } catch (error) {
      next(error);
    }
  });

  app.put("/api/wiki/sources/:sourceId/file", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const sourceId = normalizeWikiSourceId(getParam(req.params.sourceId));
      const source = state.wikiSources.find((candidate) => candidate.id === sourceId);
      if (!source) throw new HttpError(404, "Wiki source not found");
      if (!Buffer.isBuffer(req.body) || !req.body.byteLength) throw new HttpError(400, "Reference file body is required");
      if (computeWikiSourceHash(req.body) !== source.contentHash) {
        throw new HttpError(400, "Reference file does not match the wiki source contentHash");
      }
      const filename = readWikiFilenameHeader(req.header("x-wiki-filename")) || source.referenceFile?.filename || source.origin || source.title;
      const mediaType = readWikiMediaType(req.header("content-type")) || source.referenceFile?.mediaType || "application/octet-stream";
      const referenceFile = { filename, mediaType, byteSize: req.body.byteLength, available: true as const };
      await wikiFileStore.put(sourceId, req.body);
      const unchanged = JSON.stringify(source.referenceFile) === JSON.stringify(referenceFile);
      if (unchanged) {
        res.json({ source: withWikiSourceDownload(source), wikiRevision: state.wikiRevision, uploaded: true });
        return;
      }
      const now = new Date().toISOString();
      const updatedSource = normalizeWikiSources([{
        ...source,
        referenceFile,
        updatedAt: now,
        updatedBy: req.user?.displayName || req.user?.username
      }])[0];
      const nextState = addActivity(
        applyWikiMutationMetadata(
          { ...state, wikiSources: state.wikiSources.map((candidate) => candidate.id === sourceId ? updatedSource : candidate) },
          [{ entity: "source", operation: "update", key: sourceId, sourceId, contentHash: source.contentHash }],
          req.user
        ),
        {
          ...requestActivityActor(req),
          activityType: "wiki",
          action: "uploaded wiki reference file",
          details: `Uploaded ${filename}`,
          entityType: "wikiArticle"
        }
      );
      const saved = await commitState(req, nextState);
      res.status(201).json({ source: withWikiSourceDownload(updatedSource), wikiRevision: saved.wikiRevision, uploaded: true });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/wiki/sources/:sourceId/file", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const sourceId = normalizeWikiSourceId(getParam(req.params.sourceId));
      const source = state.wikiSources.find((candidate) => candidate.id === sourceId);
      if (!source?.referenceFile) throw new HttpError(404, "Wiki reference file not found");
      const now = new Date().toISOString();
      const updatedSource = normalizeWikiSources([{
        ...source,
        referenceFile: undefined,
        updatedAt: now,
        updatedBy: req.user?.displayName || req.user?.username
      }])[0];
      const nextState = applyWikiMutationMetadata(
        { ...state, wikiSources: state.wikiSources.map((candidate) => candidate.id === sourceId ? updatedSource : candidate) },
        [{ entity: "source", operation: "update", key: sourceId, sourceId, contentHash: source.contentHash }],
        req.user
      );
      const saved = await commitState(req, nextState);
      await wikiFileStore.delete(sourceId);
      res.json({ deleted: sourceId, wikiRevision: saved.wikiRevision });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/wiki/sync/preview", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      res.json(buildWikiSyncPlan(state, req.body, req.user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/wiki/sync/apply", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const plan = buildWikiSyncPlan(state, req.body, req.user);
      if (plan.baseRevision !== state.wikiRevision) {
        throw new HttpError(409, `Wiki changed from revision ${plan.baseRevision} to ${state.wikiRevision}; pull and retry`);
      }
      if (!plan.validation.valid) throw new HttpError(400, plan.validation.errors.join("; "));
      if (!plan.changes.length) {
        res.json({ applied: false, wikiRevision: state.wikiRevision, summary: plan.summary, validation: plan.validation });
        return;
      }
      const changedState = applyWikiMutationMetadata(
        { ...state, wikiArticles: plan.articles, wikiSources: plan.sources },
        plan.changes,
        req.user
      );
      const withActivity = addActivity(changedState, {
        ...requestActivityActor(req),
        activityType: "wiki",
        action: "synchronized wiki",
        details: `${plan.summary.created} created, ${plan.summary.updated} updated, ${plan.summary.deleted} deleted`,
        entityType: "wikiArticle"
      });
      const saved = await commitState(req, withActivity);
      const deletedSourceIds = plan.changes
        .filter((change) => change.entity === "source" && change.operation === "delete")
        .map((change) => change.sourceId)
        .filter((sourceId): sourceId is string => Boolean(sourceId));
      await Promise.allSettled(deletedSourceIds.map((sourceId) => wikiFileStore.delete(sourceId)));
      res.json({
        applied: true,
        wikiRevision: saved.wikiRevision,
        stateVersion: saved.version,
        summary: plan.summary,
        validation: plan.validation
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/wiki/:slug", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const result = readWikiArticle(state.wikiArticles, getParam(req.params.slug), req.user?.role === "admin");
      if (!result) throw new HttpError(404, "Wiki article not found");
      res.json({
        ...result,
        sources: result.article.sourceRefs.map((reference) => ({
          reference,
          source: state.wikiSources.find((source) => source.id === reference.sourceId)
            ? withWikiSourceDownload(state.wikiSources.find((source) => source.id === reference.sourceId)!)
            : undefined
        })),
        stateVersion: state.version,
        dataUpdatedAt: state.updatedAt
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/wiki", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const article = buildWikiArticle(req.body, undefined, req.user);
      if (state.wikiArticles.some((candidate) => candidate.slug === article.slug)) {
        throw new HttpError(409, `Wiki article already exists: ${article.slug}`);
      }
      const validation = validateWikiKnowledgeBase([...state.wikiArticles, article], state.wikiSources);
      if (!validation.valid) throw new HttpError(400, validation.errors.join("; "));
      const wikiState = applyWikiMutationMetadata(
        { ...state, wikiArticles: [...state.wikiArticles, article] },
        [{
          entity: "article",
          operation: "create",
          key: article.slug,
          slug: article.slug,
          articleRevision: article.revision,
          contentHash: article.contentHash
        }],
        req.user
      );
      const nextState = addActivity(
        wikiState,
        {
          ...requestActivityActor(req),
          activityType: "wiki",
          action: "created wiki article",
          details: `Created ${article.title}`,
          entityType: "wikiArticle",
          entityId: article.id
        }
      );
      const saved = await commitState(req, nextState);
      res.status(201).json({ article, stateVersion: saved.version, dataUpdatedAt: saved.updatedAt });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/wiki/:slug", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const currentSlug = normalizeWikiSlug(getParam(req.params.slug));
      const existing = state.wikiArticles.find((candidate) => candidate.slug === currentSlug);
      if (!existing) throw new HttpError(404, "Wiki article not found");
      const article = buildWikiArticle(req.body, existing, req.user);
      if (state.wikiArticles.some((candidate) => candidate.id !== existing.id && candidate.slug === article.slug)) {
        throw new HttpError(409, `Wiki article already exists: ${article.slug}`);
      }
      const changes: PendingWikiChange[] = [{
        entity: "article",
        operation: "update",
        key: article.slug,
        slug: article.slug,
        articleRevision: article.revision,
        contentHash: article.contentHash
      }];
      const wikiArticles = state.wikiArticles.map((candidate) => {
        if (candidate.id === existing.id) return article;
        if (article.slug === currentSlug || !candidate.links.includes(currentSlug)) return candidate;
        const linkedArticle = buildWikiArticle(
          { links: candidate.links.map((link) => (link === currentSlug ? article.slug : link)) },
          candidate,
          req.user
        );
        changes.push({
          entity: "article",
          operation: "update",
          key: linkedArticle.slug,
          slug: linkedArticle.slug,
          articleRevision: linkedArticle.revision,
          contentHash: linkedArticle.contentHash
        });
        return linkedArticle;
      });
      const validation = validateWikiKnowledgeBase(wikiArticles, state.wikiSources);
      if (!validation.valid) throw new HttpError(400, validation.errors.join("; "));
      const nextState = addActivity(
        applyWikiMutationMetadata({ ...state, wikiArticles }, changes, req.user),
        {
          ...requestActivityActor(req),
          activityType: "wiki",
          action: "updated wiki article",
          details: `Updated ${article.title}`,
          entityType: "wikiArticle",
          entityId: article.id
        }
      );
      const saved = await commitState(req, nextState);
      res.json({ article, stateVersion: saved.version, dataUpdatedAt: saved.updatedAt });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/wiki/:slug", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const slug = normalizeWikiSlug(getParam(req.params.slug));
      const existing = state.wikiArticles.find((candidate) => candidate.slug === slug);
      if (!existing) throw new HttpError(404, "Wiki article not found");
      const changes: PendingWikiChange[] = [{
        entity: "article",
        operation: "delete",
        key: slug,
        slug,
        articleRevision: existing.revision,
        contentHash: existing.contentHash
      }];
      const wikiArticles = state.wikiArticles
        .filter((candidate) => candidate.id !== existing.id)
        .map((candidate) => {
          if (!candidate.links.includes(slug)) return candidate;
          const linkedArticle = buildWikiArticle(
            { links: candidate.links.filter((link) => link !== slug) },
            candidate,
            req.user
          );
          changes.push({
            entity: "article",
            operation: "update",
            key: linkedArticle.slug,
            slug: linkedArticle.slug,
            articleRevision: linkedArticle.revision,
            contentHash: linkedArticle.contentHash
          });
          return linkedArticle;
        });
      const nextState = addActivity(
        applyWikiMutationMetadata({ ...state, wikiArticles }, changes, req.user),
        {
          ...requestActivityActor(req),
          activityType: "wiki",
          action: "deleted wiki article",
          details: `Deleted ${existing.title}`,
          entityType: "wikiArticle",
          entityId: existing.id
        }
      );
      const saved = await commitState(req, nextState);
      res.json({ deleted: slug, stateVersion: saved.version, dataUpdatedAt: saved.updatedAt });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/weeks/:weekId/schedule", requireAuth, requirePasswordReady, async (req, res, next) => {
    try {
      const state = await store.load();
      res.json(buildWeekSchedule(state, getParam(req.params.weekId), readOptionalString(req.query.service)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/weeks/:weekId/warnings", requireAuth, requirePasswordReady, async (req, res, next) => {
    try {
      const state = await store.load();
      res.json(collectWarnings(state, getParam(req.params.weekId), readOptionalString(req.query.service)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/weeks/:weekId/uncovered-message", requireAuth, requirePasswordReady, async (req, res, next) => {
    try {
      const state = await store.load();
      const date = typeof req.query.date === "string" ? req.query.date : undefined;
      res.json({ message: buildUncoveredMessage(state, getParam(req.params.weekId), date, readOptionalString(req.query.service)) });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/residents/:residentId/calendar.ics", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const resident = state.residents.find((candidate) => candidate.id === getParam(req.params.residentId));
      if (!resident) {
        res.status(404).json({ error: "Resident not found" });
        return;
      }
      if (req.user?.role !== "admin" && !residentMatchesUser(resident, req.user)) {
        res.status(403).json({ error: "Calendar export is only available for your linked resident profile" });
        return;
      }
      res
        .type("text/calendar")
        .setHeader("content-disposition", `inline; filename="${resident.id}.ics"`)
        .send(buildResidentCalendarIcs(state, resident.id));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/weeks/:weekId/suggest", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const nextState = applySuggestion(
        state,
        getParam(req.params.weekId),
        requestActivityActor(req),
        readOptionalString(req.query.service)
      );
      res.json(await commitState(req, nextState));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/entities/:collection", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const state = await store.load();
      const entity = req.body;
      if (!requireEntityWriteAccess(req, res, state, collection, entity)) return;
      assertNoPhiInEntity(collection, entity);
      if (collection === "residents") assertResidentVacationInput(entity);
      const nextState = {
        ...state,
        [collection]: [...state[collection], entity]
      } as PlannerState;
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: collectionActivityType(collection),
        action: "created item",
        details: `Created ${collection}`,
        entityType: collection,
        entityId: entity.id
      });
      res.status(201).json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/entities/:collection/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const id = getParam(req.params.id);
      const state = await store.load();
      const existing = findEntity(state, collection, id);
      const nextEntity = existing ? { ...existing, ...req.body, id } : undefined;
      if (!requireEntityWriteAccess(req, res, state, collection, existing, nextEntity)) return;
      assertNoPhiInEntity(collection, req.body);
      if (collection === "residents") assertResidentVacationInput(req.body);
      const nextState = {
        ...state,
        [collection]: state[collection].map((entity) => (entity.id === id ? { ...entity, ...req.body, id } : entity))
      } as PlannerState;
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: collectionActivityType(collection),
        action: "updated item",
        details: `Updated ${collection}`,
        entityType: collection,
        entityId: id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/entities/:collection/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const id = getParam(req.params.id);
      const state = await store.load();
      if (!requireEntityWriteAccess(req, res, state, collection, findEntity(state, collection, id))) return;
      const nextState = collection === "weeks" ? deleteWeek(state, id) : deleteEntityFromCollection(state, collection, id);
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: collectionActivityType(collection),
        action: "deleted item",
        details: `Deleted ${collection}`,
        entityType: collection,
        entityId: id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assignments", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      let state = await store.load();
      const serviceLine = getAssignmentTargetServiceLine(state, req.body.kind, req.body.targetId);
      const isMedicalStudentSelfAssignment = req.user?.role === "medical-student";
      if (isMedicalStudentSelfAssignment) {
        assertMedicalStudentSelfAssignment(state, req.user, req.body);
      } else if (!requireServiceEdit(req, res, serviceLine)) {
        return;
      }
      const manualMedicalStudentName = readOptionalString(req.body.manualMedicalStudentName);
      if (manualMedicalStudentName && req.body.residentId) {
        throw new HttpError(400, "Choose an existing person or enter a medical student name, not both");
      }
      if (manualMedicalStudentName && req.body.kind !== "case" && req.body.kind !== "clinic") {
        throw new HttpError(400, "Medical students can be assigned to cases or clinics only");
      }
      const manualMedicalStudent = manualMedicalStudentName
        ? findOrCreateManualMedicalStudent(state, manualMedicalStudentName)
        : undefined;
      if (manualMedicalStudent?.created) {
        state = { ...state, residents: [...state.residents, manualMedicalStudent.resident] };
      }
      const residentId = manualMedicalStudent?.resident.id ?? req.body.residentId;
      requireResident(state, residentId);
      assertMedicalStudentAssignmentKind(state, req.body.kind, residentId);
      assertResidentAvailableForAssignment(state, req.body.kind, req.body.targetId, residentId);
      const assignment = makeAssignment(req.body.kind, req.body.targetId, residentId, "admin", Boolean(req.body.locked));
      if (
        assignment.kind === "case" &&
        state.assignments.some(
          (candidate) =>
            candidate.kind === "case" &&
            candidate.targetId === assignment.targetId &&
            candidate.residentId === assignment.residentId
        )
      ) {
        res.status(400).json({ error: "Resident is already assigned to this case" });
        return;
      }
      const caseIdsInAssignedBlock =
        assignment.kind === "block"
          ? new Set(state.cases.filter((surgeryCase) => surgeryCase.blockId === assignment.targetId).map((surgeryCase) => surgeryCase.id))
          : new Set<string>();
      const replacedAssignments =
        assignment.kind === "case" || assignment.kind === "clinic"
          ? state.assignments
          : state.assignments.filter((candidate) => {
            if (candidate.kind === assignment.kind && candidate.targetId === assignment.targetId) return false;
            if (assignment.kind === "block" && candidate.kind === "case" && caseIdsInAssignedBlock.has(candidate.targetId)) return false;
            return true;
          });
      const nextState = {
        ...state,
        assignments: [...replacedAssignments, assignment]
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: "assignment",
        action: "assigned resident",
        details: "Manual assignment updated",
        entityType: assignment.kind,
        entityId: assignment.targetId
      });
      res.status(201).json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/assignments/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const existing = state.assignments.find((assignment) => assignment.id === id);
      if (!existing) throw new Error(`Assignment not found: ${id}`);
      const serviceLine = getAssignmentTargetServiceLine(state, existing.kind, existing.targetId);
      if (!requireServiceEdit(req, res, serviceLine)) return;
      if (req.body.residentId) requireResident(state, req.body.residentId);
      const nextResidentId = typeof req.body.residentId === "string" ? req.body.residentId : existing.residentId;
      const nextTargetId = typeof req.body.targetId === "string" ? req.body.targetId : existing.targetId;
      if (typeof req.body.residentId === "string" || typeof req.body.targetId === "string") {
        assertMedicalStudentAssignmentKind(state, existing.kind, nextResidentId);
        assertResidentAvailableForAssignment(state, existing.kind, nextTargetId, nextResidentId);
      }
      if (
        existing.kind === "case" &&
        state.assignments.some(
          (assignment) =>
            assignment.id !== id &&
            assignment.kind === "case" &&
            assignment.targetId === nextTargetId &&
            assignment.residentId === nextResidentId
        )
      ) {
        res.status(400).json({ error: "Resident is already assigned to this case" });
        return;
      }
      const nextState: PlannerState = {
        ...state,
        assignments: state.assignments.map((assignment) =>
          assignment.id === id ? { ...assignment, ...req.body, id: assignment.id, updatedAt: new Date().toISOString() } : assignment
        )
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: "assignment",
        action: "updated assignment",
        details: "Assignment lock or resident changed",
        entityType: "assignment",
        entityId: id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/assignments/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const existing = state.assignments.find((assignment) => assignment.id === id);
      if (!existing) throw new Error(`Assignment not found: ${id}`);
      const serviceLine = getAssignmentTargetServiceLine(state, existing.kind, existing.targetId);
      if (!requireServiceEdit(req, res, serviceLine)) return;
      const nextState: PlannerState = {
        ...state,
        assignments: state.assignments.filter((assignment) => assignment.id !== id)
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: "assignment",
        action: "removed assignment",
        details: "Assignment cleared",
        entityType: "assignment",
        entityId: id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-entries", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const entry = buildCoverageEntry(state, req.body);
      const serviceLine = getCoverageEntryServiceLine(entry, readServiceLine(req));
      if (!requireServiceEdit(req, res, serviceLine)) return;
      const nextState = upsertCoverageEntry(state, entry);
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: "calendar",
        action: "updated call calendar",
        details: `Set ${describeCoverageEntry(nextState, entry)}`,
        entityType: "coverageEntry",
        entityId: entry.id
      });
      res.status(201).json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/coverage-entries/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const existing = requireCoverageEntry(state, id);
      const entry = buildCoverageEntry(state, { ...existing, ...req.body, id }, existing);
      const fallbackServiceLine = readServiceLine(req);
      const affectedServices = new Set([
        getCoverageEntryServiceLine(existing, fallbackServiceLine),
        getCoverageEntryServiceLine(entry, fallbackServiceLine)
      ]);
      if ([...affectedServices].some((serviceLine) => !requireServiceEdit(req, res, serviceLine))) return;
      const nextState = upsertCoverageEntry(state, entry);
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: "calendar",
        action: "updated call calendar",
        details: `Updated ${describeCoverageEntry(nextState, entry)}`,
        entityType: "coverageEntry",
        entityId: entry.id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/coverage-entries/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const existing = requireCoverageEntry(state, id);
      const serviceLine = getCoverageEntryServiceLine(existing, readServiceLine(req));
      if (!requireServiceEdit(req, res, serviceLine)) return;
      const nextState: PlannerState = {
        ...state,
        coverageEntries: state.coverageEntries.filter((entry) => entry.id !== id)
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: "calendar",
        action: "updated call calendar",
        details: `Cleared ${describeCoverageEntry(state, existing)}`,
        entityType: "coverageEntry",
        entityId: id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/attending-coverage", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const startDate = readOptionalString(req.query.startDate);
      const endDate = readOptionalString(req.query.endDate);
      const line = readOptionalString(req.query.line);
      if (startDate) assertDate(startDate);
      if (endDate) assertDate(endDate);
      if (startDate && endDate && startDate > endDate) throw new HttpError(400, "startDate must be on or before endDate");
      if (startDate && endDate && endDate > addDays(startDate, 365)) throw new HttpError(400, "Attending coverage ranges may not exceed 366 days");
      const coverageLine = line ? assertAttendingCoverageLine(line) : undefined;
      const assignments = state.attendingCoverageAssignments.filter(
        (assignment) =>
          (!startDate || assignment.date >= startDate) &&
          (!endDate || assignment.date <= endDate) &&
          (!coverageLine || assignment.line === coverageLine)
      );
      const effectiveCoverage = startDate && endDate
        ? getEffectiveAttendingCoverage(state, startDate, endDate, coverageLine)
        : undefined;
      res.json({ assignments, effectiveCoverage, stateVersion: state.version });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/attending-coverage", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const assignment = buildAttendingCoverageAssignment(state, req.body, undefined, req.user?.authType === "apiKey" ? "api" : "manual");
      assertUniqueAttendingCoverageSlot(state, assignment);
      const nextState = addActivity(
        { ...state, attendingCoverageAssignments: [...state.attendingCoverageAssignments, assignment].sort(compareAttendingCoverageAssignments) },
        {
          ...requestActivityActor(req),
          activityType: "calendar",
          action: "updated attending coverage",
          details: `Set ${describeAttendingCoverage(state, assignment)}`,
          entityType: "attendingCoverageAssignment",
          entityId: assignment.id
        }
      );
      res.status(201).json(await commitState(req, nextState));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/attending-coverage/:id", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const id = getParam(req.params.id);
      const existing = requireAttendingCoverageAssignment(state, id);
      if (existing.source === "qgenda") throw new HttpError(409, "QGenda assignments are managed by the daily sync");
      const assignment = buildAttendingCoverageAssignment(state, { ...existing, ...req.body, id }, existing, existing.source);
      assertUniqueAttendingCoverageSlot(state, assignment);
      const nextState = addActivity(
        {
          ...state,
          attendingCoverageAssignments: state.attendingCoverageAssignments
            .map((candidate) => (candidate.id === id ? assignment : candidate))
            .sort(compareAttendingCoverageAssignments)
        },
        {
          ...requestActivityActor(req),
          activityType: "calendar",
          action: "updated attending coverage",
          details: `Updated ${describeAttendingCoverage(state, assignment)}`,
          entityType: "attendingCoverageAssignment",
          entityId: assignment.id
        }
      );
      res.json(await commitState(req, nextState));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/attending-coverage/:id", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const id = getParam(req.params.id);
      const existing = requireAttendingCoverageAssignment(state, id);
      if (existing.source === "qgenda") throw new HttpError(409, "QGenda assignments are managed by the daily sync");
      const nextState = addActivity(
        { ...state, attendingCoverageAssignments: state.attendingCoverageAssignments.filter((candidate) => candidate.id !== id) },
        {
          ...requestActivityActor(req),
          activityType: "calendar",
          action: "updated attending coverage",
          details: `Cleared ${describeAttendingCoverage(state, existing)}`,
          entityType: "attendingCoverageAssignment",
          entityId: id
        }
      );
      res.json(await commitState(req, nextState));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/integrations/qgenda/sync", requireAuth, requirePasswordReady, requireAdmin, async (_req, res, next) => {
    try {
      const result = await syncQgenda(store);
      broadcastStateEvent(stateSubscribers, result.state);
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-requests", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const serviceLine = readServiceLine(req);
      const isResidentTrade = req.body?.requestType === "resident-trade";
      const isResidentProfile = req.body?.requestType === "resident-profile";
      const isResidentVacation = req.body?.requestType === "resident-vacation";
      let coverageRequest = isResidentTrade
        ? buildResidentTradeRequest(state, req.body, req.user, serviceLine)
        : isResidentProfile
          ? buildResidentProfileRequest(state, req.body, req.user)
          : isResidentVacation
            ? buildResidentVacationRequest(state, req.body, req.user)
            : buildCoverageRequest(state, req.body, req.user, serviceLine);
      if (!isResidentTrade && !isResidentProfile && !isResidentVacation) {
        const affectedServices = getCoverageRequestServiceLines(state, coverageRequest, serviceLine);
        if (affectedServices.some((affectedService) => !requireServiceRequest(req, res, affectedService))) return;
        coverageRequest = { ...coverageRequest, serviceLine: affectedServices.at(-1) ?? serviceLine };
      }
      const nextState: PlannerState = {
        ...state,
        coverageRequests: [coverageRequest, ...state.coverageRequests]
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req, "viewer"),
        activityType: isResidentProfile ? "account" : isResidentVacation ? "resident" : "calendar",
        action: isResidentTrade
          ? "submitted resident call trade"
          : isResidentProfile
            ? "submitted resident profile request"
            : isResidentVacation
              ? "submitted resident vacation request"
              : "submitted call calendar request",
        details: describeCoverageRequest(nextState, coverageRequest),
        entityType: "coverageRequest",
        entityId: coverageRequest.id
      });
      res.status(201).json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-requests/:id/approve", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const coverageRequest = requireCoverageRequest(state, id);
      if (!canResolveCoverageRequest(state, req.user, coverageRequest)) {
        res.status(403).json({ error: getCoverageRequestResolveError(coverageRequest) });
        return;
      }
      if (coverageRequest.status !== "pending") {
        res.status(400).json({ error: "Coverage request is already resolved" });
        return;
      }
      assertNoPhiText(readOptionalString(req.body.adminNote) ?? "", "admin note");
      const applied = applyCoverageRequest(state, coverageRequest);
      const now = new Date().toISOString();
      const nextState: PlannerState = {
        ...applied,
        coverageRequests: applied.coverageRequests.map((requestItem) =>
          requestItem.id === id
            ? { ...requestItem, status: "approved", adminNote: readOptionalString(req.body.adminNote), updatedAt: now, resolvedAt: now }
            : requestItem
        )
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: getCoverageRequestActivityType(coverageRequest),
        action: getApprovedCoverageRequestActivity(coverageRequest),
        details: describeCoverageRequest(nextState, coverageRequest),
        entityType: "coverageRequest",
        entityId: id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-requests/:id/deny", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const coverageRequest = requireCoverageRequest(state, id);
      if (!canResolveCoverageRequest(state, req.user, coverageRequest)) {
        res.status(403).json({ error: getCoverageRequestResolveError(coverageRequest) });
        return;
      }
      if (coverageRequest.status !== "pending") {
        res.status(400).json({ error: "Coverage request is already resolved" });
        return;
      }
      assertNoPhiText(readOptionalString(req.body.adminNote) ?? "", "admin note");
      const now = new Date().toISOString();
      const nextState: PlannerState = {
        ...state,
        coverageRequests: state.coverageRequests.map((requestItem) =>
          requestItem.id === id
            ? { ...requestItem, status: "denied", adminNote: readOptionalString(req.body.adminNote), updatedAt: now, resolvedAt: now }
            : requestItem
        )
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: getCoverageRequestActivityType(coverageRequest),
        action: getDeniedCoverageRequestActivity(coverageRequest),
        details: describeCoverageRequest(nextState, coverageRequest),
        entityType: "coverageRequest",
        entityId: id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/coverage-requests/:id", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const coverageRequest = requireCoverageRequest(state, id);
      const nextState: PlannerState = {
        ...state,
        coverageRequests: state.coverageRequests.filter((requestItem) => requestItem.id !== id)
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req),
        activityType: getCoverageRequestActivityType(coverageRequest),
        action: "removed coverage request",
        details: describeCoverageRequest(state, coverageRequest),
        entityType: "coverageRequest",
        entityId: id
      });
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/claims", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const claim = req.body as ClaimRequest;
      if (!claim.residentId || !claim.targetId || !["case", "block"].includes(claim.scope)) {
        res.status(400).json({ error: "Invalid claim" });
        return;
      }
      const serviceLine = getAssignmentTargetServiceLine(state, claim.scope, claim.targetId);
      if (!requireServiceEdit(req, res, serviceLine)) return;
      requireResident(state, claim.residentId);
      assertMedicalStudentAssignmentKind(state, claim.scope, claim.residentId);
      assertResidentAvailableForAssignment(state, claim.scope, claim.targetId, claim.residentId);
      const nextState = applyClaim(state, claim, requestActivityActor(req, "viewer"));
      res.status(201).json(await commitState(req, nextState));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/gold-stars", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const { award, giverName, recipient } = buildGoldStarAward(state, req.user, req.body);
      const nextState: PlannerState = {
        ...state,
        goldStarAwards: [award, ...state.goldStarAwards]
      };
      const withActivity = addActivity(nextState, {
        ...requestActivityActor(req, "viewer"),
        activityType: "resident",
        action: "awarded gold star",
        details: `${giverName} awarded a star to ${recipient.name}`,
        entityType: "goldStarAward",
        entityId: award.id
      });
      const saved = await commitState(req, withActivity);
      res.status(201).json(filterStateForUser(saved, req.user));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import/preview", requireAuth, requirePasswordReady, requireAdmin, (_req, res) => {
    res.status(501).json({
      error: "OCR import is reserved for a later version",
      targetShape: ["AttendingBlock", "Case"]
    });
  });

  async function commitState(req: express.Request, state: PlannerState): Promise<PlannerState> {
    const saved = await store.save(state, { expectedVersion: readExpectedVersion(req, state.version) });
    broadcastStateEvent(stateSubscribers, saved);
    return saved;
  }

  async function recordActivity(activity: ActivityInput): Promise<PlannerState> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const state = await store.load();
        const saved = await store.save(addActivity(state, activity));
        broadcastStateEvent(stateSubscribers, saved);
        return saved;
      } catch (error) {
        if (!(error instanceof StateConflictError) || attempt === 2) throw error;
      }
    }
    throw new Error("Unable to record activity");
  }

  async function sessionUserList(req: AuthenticatedRequest): Promise<{ users?: Awaited<ReturnType<UserStore["listUsers"]>> }> {
    return req.user?.authType === "session" ? { users: await userStore.listUsers() } : {};
  }

  const clientDist = path.resolve(process.cwd(), "dist/client");
  app.use(express.static(clientDist, { index: false }));
  app.get("*", async (req, res, next) => {
    if (process.env.NODE_ENV !== "production") {
      next();
      return;
    }
    try {
      const requestedOrigin = process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`;
      const origin = new URL(requestedOrigin).origin;
      const indexHtml = await fs.readFile(path.join(clientDist, "index.html"), "utf8");
      res.type("html").send(indexHtml.replaceAll("__APP_ORIGIN__", origin));
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, req: AuthenticatedRequest, res: express.Response, _next: express.NextFunction) => {
    console.error(error);
    if (error instanceof StateConflictError) {
      res.status(409).json({
        error: error.message,
        currentVersion: error.currentVersion
      });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof ChatSettingsValidationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    const showDiagnostics = req.user?.role === "admin" || req.user?.username?.trim().toLowerCase() === "aschroeder";
    res.status(500).json({
      error: showDiagnostics && error instanceof Error
        ? error.message
        : "Something went wrong. Please try again."
    });
  });

  return app;
}

async function getUserVoiceQuota(store: StateStore, username: string, limit: number) {
  const date = getChatQuotaDateKey();
  const quota = await store.getVoiceQuota(username, date, limit);
  return { username, date, ...quota, limit };
}

function requestActivityActor(req: AuthenticatedRequest, fallbackRole: Role = "admin"): ActivityActor {
  return req.user ? userActivityActor(req.user) : { actorRole: fallbackRole };
}

function userActivityActor(user: Pick<SessionUser, "role" | "username" | "displayName">): ActivityActor {
  return {
    actorRole: user.role,
    actorUsername: user.username,
    actorName: user.displayName
  };
}

function formatUserSummary(user: Pick<SessionUser, "username" | "displayName">): string {
  return user.displayName && user.displayName !== user.username ? `${user.displayName} (${user.username})` : user.username;
}

function collectionActivityType(_collection: CollectionName): ActivityInput["activityType"] {
  return "assignment";
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "HttpError";
  }
}

interface RateLimiter {
  tryConsume(key: string): boolean;
}

function createRateLimiter(maxAttempts: number, windowMs: number): RateLimiter {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return {
    tryConsume(key: string): boolean {
      const now = Date.now();
      const existing = attempts.get(key);
      if (!existing || existing.resetAt <= now) {
        attempts.set(key, { count: 1, resetAt: now + windowMs });
        return true;
      }
      if (existing.count >= maxAttempts) return false;
      existing.count += 1;
      return true;
    }
  };
}

function securityHeaders(_req: express.Request, res: express.Response, next: express.NextFunction): void {
  res.setHeader("content-security-policy", [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'"
  ].join("; "));
  res.setHeader("cross-origin-opener-policy", "same-origin");
  res.setHeader("referrer-policy", "no-referrer");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("x-permitted-cross-domain-policies", "none");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("strict-transport-security", "max-age=15552000; includeSubDomains");
  }
  next();
}

function getCorsOptions(): cors.CorsOptions {
  const allowedOrigins = getAllowedOrigins();
  if (process.env.NODE_ENV !== "production" && allowedOrigins.length === 0) {
    return { origin: true };
  }
  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new HttpError(403, "Origin is not allowed"));
    }
  };
}

function getAllowedOrigins(): string[] {
  const origins = [process.env.PUBLIC_BASE_URL, "http://localhost:5173", "http://127.0.0.1:5173"]
    .filter((value): value is string => Boolean(value))
    .flatMap((value) => {
      try {
        const url = new URL(value);
        return [`${url.protocol}//${url.host}`];
      } catch {
        return [];
      }
    });
  return [...new Set(origins)];
}

function readExpectedVersion(req: express.Request, fallbackVersion: number): number {
  const raw = req.header("x-state-version") ?? req.header("if-match");
  if (!raw) return fallbackVersion;
  const normalized = raw.replace(/^W\//, "").replace(/^"|"$/g, "");
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new HttpError(400, "Invalid state version");
  }
  return parsed;
}

function formatStateEvent(state: PlannerState): string {
  return `event: state\ndata: ${JSON.stringify({ version: state.version, updatedAt: state.updatedAt })}\n\n`;
}

function writeChatStreamEvent(res: express.Response, event: Record<string, unknown>): void {
  if (!res.writableEnded && !res.destroyed) res.write(`${JSON.stringify(event)}\n`);
}

function broadcastStateEvent(subscribers: Set<express.Response>, state: PlannerState): void {
  const event = formatStateEvent(state);
  for (const subscriber of subscribers) {
    subscriber.write(event);
  }
}

function buildResidentCalendarIcs(state: PlannerState, residentId: string): string {
  const resident = state.residents.find((candidate) => candidate.id === residentId);
  const events: string[] = [];
  for (const week of state.weeks) {
    const schedule = buildWeekSchedule(state, week.id);
    for (const day of schedule.days) {
      for (const block of day.blocks) {
        for (const surgeryCase of block.cases.filter((candidate) =>
          candidate.assignments.some((assignment) => assignment.residentId === residentId)
        )) {
          events.push(
            timedIcsEvent({
              uid: `${surgeryCase.id}@schedule-surgery`,
              summary: `${surgeryCase.attending.name} ${surgeryCase.procedureLabel}`,
              description: surgeryCase.hospital.name,
              date: surgeryCase.date,
              startMinutes: surgeryCase.startMinutes,
              endMinutes: surgeryCase.endMinutes
            })
          );
        }
      }
      for (const clinic of day.clinics.filter((candidate) => candidate.assignments.some((assignment) => assignment.residentId === residentId))) {
        events.push(
          timedIcsEvent({
            uid: `${clinic.id}-${residentId}@schedule-surgery`,
            summary: formatClinicLabel(clinic),
            description: clinic.location,
            date: clinic.date,
            startMinutes: timeToMinutes(clinic.startTime),
            endMinutes: timeToMinutes(clinic.endTime)
          })
        );
      }
    }
  }
  for (const entry of state.coverageEntries.filter((candidate) => candidate.residentId === residentId)) {
    events.push(
      allDayIcsEvent({
        uid: `${entry.id}@schedule-surgery`,
        summary: `${formatCoverageKindLabel(entry)}${resident ? `: ${resident.name}` : ""}`,
        description: entry.note,
        date: entry.date
      })
    );
  }
  for (const assignment of state.attendingCoverageAssignments.filter(
    (candidate) => candidate.fellowResidentId === residentId
  )) {
    events.push(
      timedIcsEvent({
        uid: `${assignment.id}@schedule-surgery`,
        summary: "Practice call",
        description: assignment.note,
        date: assignment.date,
        startMinutes: assignment.shift === "weekend" ? 17 * 60 : 0,
        endMinutes: assignment.shift === "weekend" ? 3 * 24 * 60 + 6 * 60 : 24 * 60
      })
    );
  }
  for (const vacation of resident?.vacation ?? []) {
    events.push(
      allDayDateRangeIcsEvent({
        uid: `vacation-${residentId}-${vacation.id}@schedule-surgery`,
        summary: `Vacation${resident ? `: ${resident.name}` : ""}`,
        startDate: vacation.startDate,
        endDate: vacation.endDate
      })
    );
  }

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//schedule_surgery//Resident Coverage//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...events,
    "END:VCALENDAR",
    ""
  ].join("\r\n");
}

function timedIcsEvent(input: {
  uid: string;
  summary: string;
  description?: string;
  date: string;
  startMinutes: number;
  endMinutes: number;
}): string {
  return [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${formatIcsTimestamp(new Date())}`,
    `DTSTART:${formatIcsLocalDateTime(input.date, input.startMinutes)}`,
    `DTEND:${formatIcsLocalDateTime(input.date, input.endMinutes)}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    input.description ? `DESCRIPTION:${escapeIcsText(input.description)}` : undefined,
    "END:VEVENT"
  ].filter(Boolean).join("\r\n");
}

function allDayIcsEvent(input: { uid: string; summary: string; description?: string; date: string }): string {
  return [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${formatIcsTimestamp(new Date())}`,
    `DTSTART;VALUE=DATE:${formatIcsDate(input.date)}`,
    `DTEND;VALUE=DATE:${formatIcsDate(addDays(input.date, 1))}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    input.description ? `DESCRIPTION:${escapeIcsText(input.description)}` : undefined,
    "END:VEVENT"
  ].filter(Boolean).join("\r\n");
}

function allDayDateRangeIcsEvent(input: { uid: string; summary: string; startDate: string; endDate: string }): string {
  return [
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(input.uid)}`,
    `DTSTAMP:${formatIcsTimestamp(new Date())}`,
    `DTSTART;VALUE=DATE:${formatIcsDate(input.startDate)}`,
    `DTEND;VALUE=DATE:${formatIcsDate(addDays(input.endDate, 1))}`,
    `SUMMARY:${escapeIcsText(input.summary)}`,
    "END:VEVENT"
  ].join("\r\n");
}

function formatIcsLocalDateTime(date: string, minutes: number): string {
  const dayOffset = Math.floor(minutes / (24 * 60));
  const time = minutesToTime(minutes % (24 * 60));
  return `${formatIcsDate(addDays(date, dayOffset))}T${time.replace(":", "")}00`;
}

function formatIcsDate(date: string): string {
  return date.replace(/-/g, "");
}

function formatIcsTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function residentMatchesUser(resident: Resident, user: SessionUser | undefined): boolean {
  if (!user) return false;
  const username = normalizeUsername(user.username);
  const displayName = normalizeUsername(user.displayName);
  return (
    normalizeUsername(resident.username ?? "") === username ||
    normalizeUsername(resident.name) === displayName ||
    (resident.aliases ?? []).some((alias) => normalizeUsername(alias) === displayName)
  );
}

function findResidentForUser(state: PlannerState, user: SessionUser | undefined): Resident | undefined {
  return state.residents.find((resident) => residentMatchesUser(resident, user));
}

function buildGoldStarAward(
  state: PlannerState,
  user: SessionUser | undefined,
  input: { recipientResidentId?: unknown; residentId?: unknown } | undefined
): { award: GoldStarAward; giverName: string; recipient: Resident } {
  const giver = findResidentForUser(state, user);
  const body = input ?? {};
  const recipientResidentId = readOptionalString(body.recipientResidentId) ?? readOptionalString(body.residentId);
  if (!recipientResidentId) throw new HttpError(400, "Choose a resident to receive your star");
  const recipient = state.residents.find((resident) => resident.id === recipientResidentId);
  if (!recipient) throw new HttpError(400, `Unknown resident: ${recipientResidentId}`);
  if (giver && recipient.id === giver.id) throw new HttpError(400, "Choose another resident for your star");

  const weekStartDate = getCurrentMonday();
  if (state.goldStarAwards.some((award) => award.weekStartDate === weekStartDate && award.giverUsername === user?.username)) {
    throw new HttpError(400, "You already awarded your star this week");
  }

  const now = new Date().toISOString();
  return {
    giverName: user?.displayName || user?.username || "A signed-in user",
    recipient,
    award: {
      id: createId("star"),
      weekStartDate,
      giverResidentId: giver?.id,
      giverUsername: user?.username,
      recipientResidentId: recipient.id,
      createdAt: now,
      updatedAt: now
    }
  };
}

function assertAttendingAccountLinks(state: PlannerState, inputs: Array<{ role?: unknown; attendingId?: unknown }>): void {
  for (const input of inputs) {
    if (input.role !== "attending") continue;
    const attendingId = readOptionalString(input.attendingId);
    if (!attendingId || !state.attendings.some((attending) => attending.id === attendingId)) {
      throw new HttpError(400, "Choose an existing attending for an attending account");
    }
  }
}

function assertApiKeyUserUpdateAllowed(
  req: AuthenticatedRequest,
  existing: { username: string; role: Role; attendingId?: string }
): void {
  if (req.user?.authType !== "apiKey") return;
  if (existing.role === "admin") {
    throw new HttpError(403, "The admin API key cannot modify an admin browser account");
  }
  if (req.body.role !== undefined && req.body.role !== existing.role) {
    throw new HttpError(403, "The admin API key cannot change browser account roles");
  }
  if (req.body.attendingId !== undefined && readOptionalString(req.body.attendingId) !== existing.attendingId) {
    throw new HttpError(403, "The admin API key cannot relink an attending browser account");
  }
}

function normalizeUserCreationInput(req: AuthenticatedRequest, input: unknown): UpsertUserInput {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "User input must be an object");
  }
  const user = input as UpsertUserInput & { accountType?: unknown };
  const accountType = user.accountType;
  let role = user.role;

  if (accountType !== undefined) {
    if (accountType !== "user" && accountType !== "attending" && accountType !== "medical-student") {
      throw new HttpError(400, "Account type must be user, attending, or medical-student");
    }
    const accountRole: Role = accountType === "user" ? "viewer" : accountType;
    if (role !== undefined && role !== accountRole) {
      throw new HttpError(400, "accountType and role must describe the same account type");
    }
    role = accountRole;
  }

  if (req.user?.authType === "apiKey" && role === "admin") {
    throw new HttpError(403, "API keys can create only user, attending, or medical-student accounts");
  }

  return { ...user, role };
}

function isRole(value: unknown): value is Role {
  return value === "admin" || value === "attending" || value === "viewer" || value === "medical-student";
}

function assertMedicalStudentAccountLinks(state: PlannerState, inputs: Array<{ role?: unknown; username?: unknown }>): void {
  for (const input of inputs) {
    if (input.role !== "medical-student") continue;
    const username = readOptionalString(input.username);
    if (!username) throw new HttpError(400, "Medical student accounts require a username");
    const linkedResident = state.residents.find((resident) => normalizeUsername(resident.username ?? "") === normalizeUsername(username));
    if (linkedResident && linkedResident.trainingLevel !== "Medical Student") {
      throw new HttpError(400, "This username is already linked to a non-medical-student roster entry");
    }
  }
}

function addMedicalStudentRosterEntries(state: PlannerState, users: Array<{ username: string; displayName: string; role: Role }>): PlannerState {
  const newStudents = users
    .filter((user) => user.role === "medical-student")
    .filter((user) => !state.residents.some((resident) => normalizeUsername(resident.username ?? "") === normalizeUsername(user.username)))
    .map((user): Resident => ({
      id: createId("res_medical_student"),
      username: user.username,
      name: user.displayName,
      aliases: [],
      trainingLevel: "Medical Student",
      rosterKind: "primary",
      sourceProgram: "Medical School",
      accountEligible: true,
      serviceTags: [],
      tags: [],
      trainingInterests: [],
      unavailable: [],
      vacation: []
    }));
  return newStudents.length ? { ...state, residents: [...state.residents, ...newStudents] } : state;
}

function normalizeUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertCollection(value: string): CollectionName {
  if (!collections.includes(value as CollectionName)) {
    throw new Error(`Unknown collection: ${value}`);
  }
  return value as CollectionName;
}

function isScheduleEditableCollection(collection: CollectionName): collection is ScheduleEditableCollection {
  return scheduleEditableCollections.has(collection);
}

function findEntity(state: PlannerState, collection: CollectionName, id: string): unknown | undefined {
  return (state[collection] as Array<{ id: string }>).find((entity) => entity.id === id);
}

function requireEntityWriteAccess(
  req: AuthenticatedRequest,
  res: express.Response,
  state: PlannerState,
  collection: CollectionName,
  currentEntity: unknown,
  nextEntity?: unknown
): boolean {
  if (req.user?.role === "admin") return true;
  if (!isScheduleEditableCollection(collection)) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }

  const entities = [currentEntity, nextEntity].filter(Boolean);
  if (entities.length === 0) {
    throw new HttpError(404, `${collection} item not found`);
  }

  if (req.user?.role === "attending" && entities.every((entity) => entityBelongsToAttending(state, collection, entity, req.user?.attendingId))) {
    return true;
  }

  for (const serviceLine of new Set(entities.map((entity) => getScheduleEntityServiceLine(state, collection, entity)))) {
    if (!hasServicePrivilege(req.user, serviceLine, "edit")) {
      res.status(403).json({ error: "Edit privilege required for this service" });
      return false;
    }
  }
  return true;
}

function entityBelongsToAttending(
  state: PlannerState,
  collection: CollectionName,
  entity: unknown,
  attendingId: string | undefined
): boolean {
  if (!attendingId || !entity || typeof entity !== "object") return false;
  if (collection === "attendingBlocks") return (entity as Partial<AttendingBlock>).attendingId === attendingId;
  if (collection === "cases") {
    const blockId = (entity as Partial<SurgeryCase>).blockId;
    return typeof blockId === "string" && state.attendingBlocks.some((block) => block.id === blockId && block.attendingId === attendingId);
  }
  return false;
}

function getScheduleEntityServiceLine(state: PlannerState, collection: ScheduleEditableCollection, entity: unknown): string {
  if (!entity || typeof entity !== "object") {
    throw new HttpError(400, `Invalid ${collection} payload`);
  }

  if (collection === "attendingBlocks") {
    const attendingId = readRequiredString((entity as Partial<AttendingBlock>).attendingId, "attendingId");
    return getAttendingServiceLine(state, attendingId);
  }

  if (collection === "cases") {
    const blockId = readRequiredString((entity as Partial<SurgeryCase>).blockId, "blockId");
    return getBlockServiceLine(state, blockId);
  }

  const clinic = entity as Partial<ClinicSession>;
  return readOptionalString(clinic.service) ?? getAttendingServiceLine(state, readRequiredString(clinic.attendingId, "attendingId"));
}

function getAttendingServiceLine(state: PlannerState, attendingId: string): string {
  const attending = state.attendings.find((candidate) => candidate.id === attendingId);
  if (!attending) throw new HttpError(400, `Attending not found: ${attendingId}`);
  return attending.service;
}

function deleteEntityFromCollection(state: PlannerState, collection: CollectionName, id: string): PlannerState {
  if (collection === "residents") return deleteResident(state, id);
  if (collection === "attendings") return deleteAttending(state, id);
  if (collection === "hospitals") return deleteHospital(state, id);
  if (collection === "attendingBlocks") return deleteBlocks(state, new Set([id]));
  if (collection === "cases") return deleteCases(state, new Set([id]));
  if (collection === "clinicSessions") return deleteClinics(state, new Set([id]));
  return {
    ...state,
    [collection]: state[collection].filter((entity) => entity.id !== id)
  } as PlannerState;
}

function deleteWeek(state: PlannerState, weekId: string): PlannerState {
  if (state.weeks.length <= 1) {
    throw new Error("Cannot delete the only week");
  }

  const blockIds = new Set(state.attendingBlocks.filter((block) => block.weekId === weekId).map((block) => block.id));
  const caseIds = new Set(state.cases.filter((surgeryCase) => blockIds.has(surgeryCase.blockId)).map((surgeryCase) => surgeryCase.id));
  const clinicIds = new Set(state.clinicSessions.filter((clinic) => clinic.weekId === weekId).map((clinic) => clinic.id));

  return {
    ...state,
    weeks: state.weeks.filter((week) => week.id !== weekId),
    attendingBlocks: state.attendingBlocks.filter((block) => block.weekId !== weekId),
    cases: state.cases.filter((surgeryCase) => !blockIds.has(surgeryCase.blockId)),
    clinicSessions: state.clinicSessions.filter((clinic) => clinic.weekId !== weekId),
    assignments: state.assignments.filter((assignment) => {
      if (assignment.kind === "block") return !blockIds.has(assignment.targetId);
      if (assignment.kind === "case") return !caseIds.has(assignment.targetId);
      if (assignment.kind === "clinic") return !clinicIds.has(assignment.targetId);
      return true;
    })
  };
}

function deleteResident(state: PlannerState, residentId: string): PlannerState {
  return {
    ...state,
    residents: state.residents.filter((resident) => resident.id !== residentId),
    assignments: state.assignments.filter((assignment) => assignment.residentId !== residentId),
    attendingCoverageAssignments: state.attendingCoverageAssignments.filter(
      (assignment) => assignment.fellowResidentId !== residentId
    ),
    coverageEntries: state.coverageEntries.filter((entry) => entry.residentId !== residentId),
    coverageRequests: state.coverageRequests.filter((request) => !coverageRequestReferencesResident(request, residentId))
  };
}

function deleteAttending(state: PlannerState, attendingId: string): PlannerState {
  const blockIds = new Set(state.attendingBlocks.filter((block) => block.attendingId === attendingId).map((block) => block.id));
  const clinicIds = new Set(state.clinicSessions.filter((clinic) => clinic.attendingId === attendingId).map((clinic) => clinic.id));
  return deleteClinics(
    deleteBlocks(
      {
        ...state,
        attendings: state.attendings.filter((attending) => attending.id !== attendingId),
        attendingCoverageAssignments: state.attendingCoverageAssignments.filter(
          (assignment) => assignment.attendingId !== attendingId
        ),
        coverageEntries: state.coverageEntries.filter(
          (entry) => entry.dayAttendingId !== attendingId && entry.nightAttendingId !== attendingId
        )
      },
      blockIds
    ),
    clinicIds
  );
}

function deleteHospital(state: PlannerState, hospitalId: string): PlannerState {
  const blockIds = new Set(state.attendingBlocks.filter((block) => block.hospitalId === hospitalId).map((block) => block.id));
  const clinicIds = new Set(state.clinicSessions.filter((clinic) => clinic.hospitalId === hospitalId).map((clinic) => clinic.id));
  return deleteClinics(deleteBlocks({ ...state, hospitals: state.hospitals.filter((hospital) => hospital.id !== hospitalId) }, blockIds), clinicIds);
}

function deleteBlocks(state: PlannerState, blockIds: Set<string>): PlannerState {
  const caseIds = new Set(state.cases.filter((surgeryCase) => blockIds.has(surgeryCase.blockId)).map((surgeryCase) => surgeryCase.id));
  return deleteCases(
    {
      ...state,
      attendingBlocks: state.attendingBlocks.filter((block) => !blockIds.has(block.id)),
      assignments: state.assignments.filter((assignment) => assignment.kind !== "block" || !blockIds.has(assignment.targetId))
    },
    caseIds
  );
}

function deleteCases(state: PlannerState, caseIds: Set<string>): PlannerState {
  return {
    ...state,
    cases: state.cases.filter((surgeryCase) => !caseIds.has(surgeryCase.id)),
    assignments: state.assignments.filter((assignment) => assignment.kind !== "case" || !caseIds.has(assignment.targetId))
  };
}

function deleteClinics(state: PlannerState, clinicIds: Set<string>): PlannerState {
  return {
    ...state,
    clinicSessions: state.clinicSessions.filter((clinic) => !clinicIds.has(clinic.id)),
    assignments: state.assignments.filter((assignment) => assignment.kind !== "clinic" || !clinicIds.has(assignment.targetId))
  };
}

function buildCoverageEntry(state: PlannerState, input: Partial<CoverageEntry>, existing?: CoverageEntry): CoverageEntry {
  const now = new Date().toISOString();
  const kind = assertCoverageKind(input.kind ?? existing?.kind);
  const date = assertDate(input.date ?? existing?.date);
  const residentId = readOptionalString(input.residentId);
  const dayAttendingId = kind === "attending-call" ? readOptionalString(input.dayAttendingId) : undefined;
  const nightAttendingId = kind === "attending-call" ? readOptionalString(input.nightAttendingId) : undefined;
  const serviceLine = readOptionalString(input.serviceLine) ?? existing?.serviceLine;
  const callPosition = kind === "call" ? normalizeCallPosition(input.callPosition ?? existing?.callPosition) : undefined;
  const note = normalizeCoverageEntryNote(kind, readOptionalString(input.note) ?? "");
  assertNoPhiText(note, "coverage note");
  const entry: CoverageEntry = {
    id: readOptionalString(input.id) ?? existing?.id ?? createId("cover"),
    date,
    kind,
    residentId,
    dayAttendingId,
    nightAttendingId,
    serviceLine,
    callPosition,
    note,
    createdAt: existing?.createdAt ?? readOptionalString(input.createdAt) ?? now,
    updatedAt: now
  };

  validateCoverageEntry(state, entry);
  return entry;
}

function upsertCoverageEntry(state: PlannerState, entry: CoverageEntry): PlannerState {
  const coverageEntries = state.coverageEntries.filter((candidate) => candidate.id !== entry.id);

  return {
    ...state,
    coverageEntries: [...coverageEntries, entry].sort(compareCoverageEntries)
  };
}

function prepareAssistantScheduleAction(
  state: PlannerState,
  user: SessionUser,
  currentServiceLine: string,
  args: Record<string, unknown>
): PendingAssistantScheduleAction {
  const actionType = readRequiredString(args.action_type, "action_type");
  const operation = readRequiredString(args.operation, "operation");
  const prepared = actionType === "call_swap"
    ? prepareAssistantCallSwap(state, user, currentServiceLine, args, operation)
    : actionType === "case_coverage"
      ? prepareAssistantCaseCoverage(state, user, args, operation)
      : actionType === "case_order"
        ? prepareAssistantCaseOrder(state, user, args, operation)
        : actionType === "clinic_session"
          ? prepareAssistantClinicSession(state, user, args, operation)
        : actionType === "calendar_entry"
          ? prepareAssistantCalendarEntry(state, user, currentServiceLine, args, operation)
          : actionType === "request_resolution"
            ? prepareAssistantRequestResolution(state, user, args, operation)
            : (() => { throw new HttpError(400, "Unsupported assistant schedule action"); })();
  return {
    token: `assistant_action_${randomUUID()}`,
    username: user.username,
    expectedVersion: state.version,
    expiresAt: Date.now() + ASSISTANT_ACTION_TTL_MS,
    ...prepared
  };
}

function prepareAssistantCallSwap(
  state: PlannerState,
  user: SessionUser,
  currentServiceLine: string,
  args: Record<string, unknown>,
  operation: string
): Pick<PendingAssistantScheduleAction, "mode" | "summary" | "action"> {
  if (operation !== "swap" && operation !== "update") throw new HttpError(400, "Call trades use the swap operation");
  const requesterResident = findResidentForUser(state, user);
  if (!requesterResident) throw new HttpError(403, "A linked resident profile is required to trade call");
  const date = assertDate(args.date);
  const sourceEntry = findUniqueCoverageEntry(state, {
    entryId: readOptionalString(args.entry_id),
    date,
    kind: "call",
    residentId: requesterResident.id
  });
  const targetResident = findResidentByName(state, readRequiredString(args.target_resident_name, "target_resident_name"));
  const targetDate = readOptionalString(args.target_date);
  const swapEntry = targetDate
    ? findUniqueCoverageEntry(state, { date: assertDate(targetDate), kind: "call", residentId: targetResident.id })
    : undefined;
  const serviceLine = sourceEntry.serviceLine ?? readOptionalString(args.service) ?? currentServiceLine;
  const request = buildResidentTradeRequest(state, {
    requestType: "resident-trade",
    action: "update",
    entryId: sourceEntry.id,
    targetResidentId: targetResident.id,
    swapEntryId: swapEntry?.id,
    message: readOptionalString(args.note) ?? "Submitted through the schedule assistant"
  }, user, serviceLine);
  return {
    mode: "request",
    summary: swapEntry
      ? `Ask ${targetResident.name} to swap your call on ${sourceEntry.date} for their call on ${swapEntry.date}`
      : `Ask ${targetResident.name} to cover your call on ${sourceEntry.date}`,
    action: { kind: "coverage-request", request }
  };
}

function prepareAssistantCaseCoverage(
  state: PlannerState,
  user: SessionUser,
  args: Record<string, unknown>,
  operation: string
): Pick<PendingAssistantScheduleAction, "mode" | "summary" | "action"> {
  const action = assertCoverageRequestAction(operation);
  const surgeryCase = findAssistantCase(state, args);
  const block = state.attendingBlocks.find((candidate) => candidate.id === surgeryCase.blockId)!;
  const attending = state.attendings.find((candidate) => candidate.id === block.attendingId)!;
  const serviceLine = getBlockServiceLine(state, block.id);
  let assignment = readOptionalString(args.assignment_id)
    ? state.assignments.find((candidate) => candidate.id === readOptionalString(args.assignment_id))
    : undefined;
  const requestedResidentName = readOptionalString(args.resident_name);
  if (!assignment && action === "delete" && requestedResidentName) {
    const resident = findResidentByName(state, requestedResidentName);
    assignment = state.assignments.find(
      (candidate) => candidate.kind === "case" && candidate.targetId === surgeryCase.id && candidate.residentId === resident.id
    );
  }
  if ((action === "delete" || action === "update") && (!assignment || assignment.kind !== "case" || assignment.targetId !== surgeryCase.id)) {
    throw new HttpError(400, "Choose the specific case assignment to change");
  }
  const resident = action === "delete"
    ? assignment && state.residents.find((candidate) => candidate.id === assignment!.residentId)
    : findResidentByName(state, readRequiredString(args.resident_name, "resident_name"));
  if (action !== "delete") {
    assertMedicalStudentAssignmentKind(state, "case", resident!.id);
    assertResidentAvailableForAssignment(state, "case", surgeryCase.id, resident!.id);
  }
  const change: AssignmentChange = {
    assignmentId: assignment?.id,
    kind: "case",
    targetId: surgeryCase.id,
    residentId: action === "delete" ? assignment?.residentId : resident!.id,
    locked: assignment?.locked ?? false
  };
  const mode = assistantServiceActionMode(user, serviceLine);
  const verb = action === "delete" ? `remove ${resident?.name ?? "the resident"} from` : action === "update" ? `change coverage to ${resident!.name} for` : `assign ${resident!.name} to`;
  const summary = `${capitalize(verb)} ${surgeryCase.procedureLabel} with ${attending.name} on ${block.date}`;
  if (mode === "request") {
    const now = new Date().toISOString();
    const request: CoverageChangeRequest = {
      id: createId("assignment_req"),
      requestType: "assignment-change",
      action,
      status: "pending",
      requestedAssignmentChange: change,
      serviceLine,
      requesterUsername: user.username,
      requesterName: user.displayName,
      message: readOptionalString(args.note) ?? "Submitted through the schedule assistant",
      createdAt: now,
      updatedAt: now
    };
    return { mode, summary, action: { kind: "assignment-request", request } };
  }
  return { mode, summary, action: { kind: "assignment-direct", action, change, serviceLine } };
}

function prepareAssistantCaseOrder(
  state: PlannerState,
  user: SessionUser,
  args: Record<string, unknown>,
  operation: string
): Pick<PendingAssistantScheduleAction, "mode" | "summary" | "action"> {
  if (operation !== "update") throw new HttpError(400, "Case order changes use the update operation");
  const surgeryCase = findAssistantCase(state, args);
  const block = state.attendingBlocks.find((candidate) => candidate.id === surgeryCase.blockId)!;
  const attending = state.attendings.find((candidate) => candidate.id === block.attendingId)!;
  const serviceLine = getBlockServiceLine(state, block.id);
  const requestedOrder = readOptionalPositiveInteger(args.requested_order);
  if (!requestedOrder) throw new HttpError(400, "A one-based requested case order is required");
  const caseCount = state.cases.filter((candidate) => candidate.blockId === surgeryCase.blockId).length;
  if (requestedOrder > caseCount) throw new HttpError(400, `Case order must be between 1 and ${caseCount}`);
  const change: CaseOrderChange = { caseId: surgeryCase.id, order: requestedOrder };
  const ownsCase = user.role === "attending" && user.attendingId === block.attendingId;
  const mode = ownsCase || hasServicePrivilege(user, serviceLine, "edit") ? "direct" : assistantServiceActionMode(user, serviceLine);
  const summary = `Move ${surgeryCase.procedureLabel} with ${attending.name} on ${block.date} to case #${requestedOrder}`;
  if (mode === "request") {
    const now = new Date().toISOString();
    const request: CoverageChangeRequest = {
      id: createId("case_order_req"),
      requestType: "case-order-change",
      action: "update",
      status: "pending",
      requestedCaseOrderChange: change,
      serviceLine,
      requesterUsername: user.username,
      requesterName: user.displayName,
      message: readOptionalString(args.note) ?? "Submitted through the schedule assistant",
      createdAt: now,
      updatedAt: now
    };
    return { mode, summary, action: { kind: "case-order-request", request } };
  }
  return { mode, summary, action: { kind: "case-order-direct", change, serviceLine } };
}

function prepareAssistantClinicSession(
  state: PlannerState,
  user: SessionUser,
  args: Record<string, unknown>,
  operation: string
): Pick<PendingAssistantScheduleAction, "mode" | "summary" | "action"> {
  if (operation !== "update") throw new HttpError(400, "Clinic session changes use the update operation");
  const clinic = findAssistantClinicSession(state, args);
  const startTime = readOptionalString(args.start_time);
  const endTime = readOptionalString(args.end_time);
  const isProcedure = args.is_procedure === null || args.is_procedure === undefined
    ? undefined
    : typeof args.is_procedure === "boolean"
      ? args.is_procedure
      : (() => { throw new HttpError(400, "is_procedure must be true, false, or null"); })();
  if (startTime === undefined && endTime === undefined && isProcedure === undefined) {
    throw new HttpError(400, "Specify a clinic start time, end time, and/or session type to change");
  }
  const nextStartTime = startTime ?? clinic.startTime;
  const nextEndTime = endTime ?? clinic.endTime;
  assertAssistantClinicTime(nextStartTime, "start_time");
  assertAssistantClinicTime(nextEndTime, "end_time");
  if (timeToMinutes(nextStartTime) >= timeToMinutes(nextEndTime)) {
    throw new HttpError(400, "Clinic start time must be before its end time");
  }
  const change: ClinicSessionChange = {
    clinicId: clinic.id,
    startTime,
    endTime,
    isProcedure
  };
  const attending = clinic.attendingId
    ? state.attendings.find((candidate) => candidate.id === clinic.attendingId)
    : undefined;
  const serviceLine = clinic.service || (attending ? getAttendingServiceLine(state, attending.id) : undefined);
  if (!serviceLine) throw new HttpError(400, "The clinic session does not have a service line");
  const ownsClinic = user.role === "attending" && user.attendingId === clinic.attendingId;
  const mode = ownsClinic || hasServicePrivilege(user, serviceLine, "edit")
    ? "direct"
    : assistantServiceActionMode(user, serviceLine);
  const oldType = clinic.isProcedure ? "procedure clinic" : "clinic";
  const nextType = (isProcedure ?? clinic.isProcedure) ? "procedure clinic" : "clinic";
  const summary = `Update ${attending?.name ?? clinic.service} ${oldType} on ${clinic.date} from ${clinic.startTime}-${clinic.endTime} to ${nextStartTime}-${nextEndTime}${nextType !== oldType ? ` and make it a ${nextType}` : ""}`;
  if (mode === "request") {
    const now = new Date().toISOString();
    const request: CoverageChangeRequest = {
      id: createId("clinic_req"),
      requestType: "clinic-session-change",
      action: "update",
      status: "pending",
      requestedClinicSessionChange: change,
      serviceLine,
      requesterUsername: user.username,
      requesterName: user.displayName,
      message: readOptionalString(args.note) ?? "Submitted through the schedule assistant",
      createdAt: now,
      updatedAt: now
    };
    return { mode, summary, action: { kind: "clinic-session-request", request } };
  }
  return { mode, summary, action: { kind: "clinic-session-direct", change, serviceLine } };
}

function assertAssistantClinicTime(value: string, field: string): void {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new HttpError(400, `${field} must use 24-hour HH:MM format`);
  }
}

function prepareAssistantCalendarEntry(
  state: PlannerState,
  user: SessionUser,
  currentServiceLine: string,
  args: Record<string, unknown>,
  operation: string
): Pick<PendingAssistantScheduleAction, "mode" | "summary" | "action"> {
  const action = assertCoverageRequestAction(operation);
  const entryId = readOptionalString(args.entry_id);
  const existing = action === "create"
    ? undefined
    : findUniqueCoverageEntry(state, {
      entryId,
      date: readOptionalString(args.date),
      kind: readOptionalString(args.entry_kind) as CoverageKind | undefined,
      residentId: readOptionalString(args.resident_name) ? findResidentByName(state, readOptionalString(args.resident_name)!).id : undefined
    });
  const kind = (readOptionalString(args.entry_kind) ?? existing?.kind) as CoverageKind | undefined;
  if (!kind || kind === "attending-call") throw new HttpError(400, "Choose call, rounding, off, or note for this calendar action");
  const resident = readOptionalString(args.resident_name)
    ? findResidentByName(state, readOptionalString(args.resident_name)!)
    : existing?.residentId
      ? state.residents.find((candidate) => candidate.id === existing.residentId)
      : undefined;
  const requestedService = readOptionalString(args.service) ?? existing?.serviceLine ?? currentServiceLine;
  const requestedEntry = action === "delete" ? undefined : buildCoverageEntry(state, {
    ...existing,
    id: existing?.id,
    date: readOptionalString(args.date) ?? existing?.date,
    kind,
    residentId: resident?.id,
    serviceLine: kind === "call" ? undefined : requestedService,
    callPosition: kind === "call" ? normalizeCallPosition(args.call_position) ?? existing?.callPosition : undefined,
    note: readOptionalString(args.note) ?? existing?.note ?? ""
  }, existing);
  const serviceLine = getCoverageEntryServiceLine(existing ?? requestedEntry!, requestedService)!;
  const mode = assistantServiceActionMode(user, serviceLine);
  const described = existing ?? requestedEntry!;
  const summary = `${capitalize(action)} ${describeCoverageEntry(state, described)}`;
  if (mode === "request") {
    const request = buildCoverageRequest(state, {
      action,
      entryId: existing?.id,
      requestedEntry,
      message: readOptionalString(args.note) ?? "Submitted through the schedule assistant"
    }, user, serviceLine);
    return { mode, summary, action: { kind: "coverage-request", request } };
  }
  return {
    mode,
    summary,
    action: { kind: "coverage-direct", action, entry: requestedEntry, entryId: existing?.id, serviceLine }
  };
}

function prepareAssistantRequestResolution(
  state: PlannerState,
  user: SessionUser,
  args: Record<string, unknown>,
  operation: string
): Pick<PendingAssistantScheduleAction, "mode" | "summary" | "action"> {
  if (operation !== "approve" && operation !== "deny") throw new HttpError(400, "Request decisions must approve or deny");
  const requestId = readRequiredString(args.request_id, "request_id");
  const request = requireCoverageRequest(state, requestId);
  if (request.status !== "pending") throw new HttpError(400, "This request is already resolved");
  if (!canResolveCoverageRequest(state, user, request)) throw new HttpError(403, getCoverageRequestResolveError(request));
  return {
    mode: "direct",
    summary: `${capitalize(operation)}: ${describeCoverageRequest(state, request)}`,
    action: { kind: "request-resolution", requestId, resolution: operation }
  };
}

function assistantServiceActionMode(user: SessionUser, serviceLine: string): "direct" | "request" {
  if (hasServicePrivilege(user, serviceLine, "edit")) return "direct";
  if (hasServicePrivilege(user, serviceLine, "request")) return "request";
  throw new HttpError(403, `You do not have change or request permission for ${serviceLine}`);
}

function findAssistantCase(state: PlannerState, args: Record<string, unknown>): SurgeryCase {
  const caseId = readOptionalString(args.case_id);
  if (caseId) {
    const surgeryCase = state.cases.find((candidate) => candidate.id === caseId);
    if (!surgeryCase) throw new HttpError(404, "The selected OR case is no longer available");
    return surgeryCase;
  }
  const date = readOptionalString(args.date);
  const procedure = readOptionalString(args.procedure)?.toLowerCase();
  const attendingName = readOptionalString(args.attending_name);
  const attending = attendingName ? findAttendingByName(state, attendingName) : undefined;
  const matches = state.cases.filter((surgeryCase) => {
    const block = state.attendingBlocks.find((candidate) => candidate.id === surgeryCase.blockId);
    return Boolean(
      block &&
      (!date || block.date === date) &&
      (!attending || block.attendingId === attending.id) &&
      (!procedure || surgeryCase.procedureLabel.toLowerCase().includes(procedure))
    );
  });
  if (matches.length !== 1) {
    throw new HttpError(400, matches.length ? "More than one OR case matches; include the date, attending, and procedure" : "No matching OR case was found");
  }
  return matches[0];
}

function findAssistantClinicSession(state: PlannerState, args: Record<string, unknown>): ClinicSession {
  const clinicId = readOptionalString(args.clinic_id);
  if (clinicId) {
    const clinic = state.clinicSessions.find((candidate) => candidate.id === clinicId);
    if (!clinic) throw new HttpError(404, "The selected clinic session is no longer available");
    return clinic;
  }
  const date = readOptionalString(args.date);
  const service = readOptionalString(args.service);
  const attendingName = readOptionalString(args.attending_name);
  const attending = attendingName ? findAttendingByName(state, attendingName) : undefined;
  const matches = state.clinicSessions.filter((clinic) =>
    (!date || clinic.date === date) &&
    (!service || clinic.service.toLowerCase() === service.toLowerCase()) &&
    (!attending || clinic.attendingId === attending.id)
  );
  if (matches.length !== 1) {
    throw new HttpError(400, matches.length
      ? "More than one clinic session matches; include the date, attending, and service"
      : "No matching clinic session was found");
  }
  return matches[0];
}

function findResidentByName(state: PlannerState, name: string): Resident {
  const normalized = normalizeUsername(name);
  const exact = state.residents.filter((resident) =>
    [resident.name, resident.username, ...(resident.aliases ?? [])].some((value) => normalizeUsername(value ?? "") === normalized)
  );
  const matches = exact.length ? exact : state.residents.filter((resident) => normalizeUsername(resident.name).includes(normalized));
  if (matches.length !== 1) throw new HttpError(400, matches.length ? `More than one resident matches ${name}` : `Resident not found: ${name}`);
  return matches[0];
}

function findAttendingByName(state: PlannerState, name: string) {
  const normalized = normalizeUsername(name);
  const exact = state.attendings.filter((attending) =>
    [attending.name, ...(attending.aliases ?? [])].some((value) => normalizeUsername(value) === normalized)
  );
  const matches = exact.length ? exact : state.attendings.filter((attending) => normalizeUsername(attending.name).includes(normalized));
  if (matches.length !== 1) throw new HttpError(400, matches.length ? `More than one attending matches ${name}` : `Attending not found: ${name}`);
  return matches[0];
}

function findUniqueCoverageEntry(
  state: PlannerState,
  filter: { entryId?: string; date?: string; kind?: CoverageKind; residentId?: string }
): CoverageEntry {
  if (filter.entryId) return requireCoverageEntry(state, filter.entryId);
  const matches = state.coverageEntries.filter((entry) =>
    (!filter.date || entry.date === filter.date) &&
    (!filter.kind || entry.kind === filter.kind) &&
    (!filter.residentId || entry.residentId === filter.residentId)
  );
  if (matches.length !== 1) {
    throw new HttpError(400, matches.length ? "More than one calendar entry matches; include the specific entry" : "No matching calendar entry was found");
  }
  return matches[0];
}

function pruneAssistantActionMaps(
  pending: Map<string, PendingAssistantScheduleAction>,
  completed: Map<string, CompletedAssistantScheduleAction>
): void {
  const now = Date.now();
  for (const [token, action] of pending) if (action.expiresAt <= now) pending.delete(token);
  for (const [token, action] of completed) if (action.expiresAt <= now) completed.delete(token);
}

function commitAssistantScheduleAction(
  state: PlannerState,
  user: SessionUser,
  pending: PendingAssistantScheduleAction
): { state: PlannerState; message: string } {
  const action = pending.action;
  if (
    action.kind === "coverage-request" ||
    action.kind === "assignment-request" ||
    action.kind === "case-order-request" ||
    action.kind === "clinic-session-request"
  ) {
    validateAssistantRequestAuthority(state, user, action.request);
    const nextState = addActivity({
      ...state,
      coverageRequests: [action.request, ...state.coverageRequests]
    }, {
      ...userActivityActor(user),
      activityType: action.kind === "assignment-request" || action.kind === "case-order-request" ? "assignment" : "calendar",
      action: "submitted assistant schedule request",
      details: describeCoverageRequest(state, action.request),
      entityType: "coverageRequest",
      entityId: action.request.id
    });
    return { state: nextState, message: `Request submitted: ${pending.summary}` };
  }

  if (action.kind === "coverage-direct") {
    if (!hasServicePrivilege(user, action.serviceLine, "edit")) throw new HttpError(403, "Edit permission is no longer available for this service");
    let nextState: PlannerState;
    if (action.action === "delete") {
      if (!action.entryId) throw new HttpError(400, "Calendar entry is missing");
      requireCoverageEntry(state, action.entryId);
      nextState = { ...state, coverageEntries: state.coverageEntries.filter((entry) => entry.id !== action.entryId) };
    } else {
      if (!action.entry) throw new HttpError(400, "Calendar change is missing");
      const existing = action.action === "update" ? requireCoverageEntry(state, action.entry.id) : undefined;
      const entry = buildCoverageEntry(state, action.entry, existing);
      nextState = upsertCoverageEntry(state, entry);
    }
    return {
      state: addActivity(nextState, {
        ...userActivityActor(user),
        activityType: "calendar",
        action: "completed assistant calendar change",
        details: pending.summary,
        entityType: "coverageEntry",
        entityId: action.entryId ?? action.entry?.id
      }),
      message: `Schedule updated: ${pending.summary}`
    };
  }

  if (action.kind === "assignment-direct") {
    if (!hasServicePrivilege(user, action.serviceLine, "edit")) throw new HttpError(403, "Edit permission is no longer available for this service");
    const nextState = applyAssignmentChange(state, action.action, action.change);
    return {
      state: addActivity(nextState, {
        ...userActivityActor(user),
        activityType: "assignment",
        action: "completed assistant case coverage change",
        details: pending.summary,
        entityType: "case",
        entityId: action.change.targetId
      }),
      message: `Case coverage updated: ${pending.summary}`
    };
  }

  if (action.kind === "case-order-direct") {
    const surgeryCase = state.cases.find((candidate) => candidate.id === action.change.caseId);
    if (!surgeryCase) throw new HttpError(404, "The selected OR case is no longer available");
    const block = state.attendingBlocks.find((candidate) => candidate.id === surgeryCase.blockId);
    const ownsCase = user.role === "attending" && user.attendingId === block?.attendingId;
    if (!ownsCase && !hasServicePrivilege(user, action.serviceLine, "edit")) {
      throw new HttpError(403, "Edit permission is no longer available for this case");
    }
    const nextState = applyCaseOrderChange(state, action.change);
    return {
      state: addActivity(nextState, {
        ...userActivityActor(user),
        activityType: "assignment",
        action: "completed assistant case order change",
        details: pending.summary,
        entityType: "case",
        entityId: action.change.caseId
      }),
      message: `Case order updated: ${pending.summary}`
    };
  }

  if (action.kind === "clinic-session-direct") {
    const clinic = state.clinicSessions.find((candidate) => candidate.id === action.change.clinicId);
    if (!clinic) throw new HttpError(404, "The selected clinic session is no longer available");
    const ownsClinic = user.role === "attending" && user.attendingId === clinic.attendingId;
    if (!ownsClinic && !hasServicePrivilege(user, action.serviceLine, "edit")) {
      throw new HttpError(403, "Edit permission is no longer available for this clinic session");
    }
    const nextState = applyClinicSessionChange(state, action.change);
    return {
      state: addActivity(nextState, {
        ...userActivityActor(user),
        activityType: "calendar",
        action: "completed assistant clinic session change",
        details: pending.summary,
        entityType: "clinicSessions",
        entityId: action.change.clinicId
      }),
      message: `Clinic session updated: ${pending.summary}`
    };
  }

  const request = requireCoverageRequest(state, action.requestId);
  if (request.status !== "pending") throw new HttpError(400, "This request is already resolved");
  if (!canResolveCoverageRequest(state, user, request)) throw new HttpError(403, getCoverageRequestResolveError(request));
  const now = new Date().toISOString();
  const applied = action.resolution === "approve" ? applyCoverageRequest(state, request) : state;
  const nextState: PlannerState = {
    ...applied,
    coverageRequests: applied.coverageRequests.map((candidate) =>
      candidate.id === request.id
        ? { ...candidate, status: action.resolution === "approve" ? "approved" : "denied", updatedAt: now, resolvedAt: now }
        : candidate
    )
  };
  return {
    state: addActivity(nextState, {
      ...userActivityActor(user),
      activityType: getCoverageRequestActivityType(request),
      action: action.resolution === "approve" ? getApprovedCoverageRequestActivity(request) : getDeniedCoverageRequestActivity(request),
      details: describeCoverageRequest(nextState, request),
      entityType: "coverageRequest",
      entityId: request.id
    }),
    message: `Request ${action.resolution === "approve" ? "approved" : "denied"}: ${pending.summary.replace(/^(Approve|Deny): /, "")}`
  };
}

function validateAssistantRequestAuthority(state: PlannerState, user: SessionUser, request: CoverageChangeRequest): void {
  if (isResidentTradeRequest(request)) {
    const resident = findResidentForUser(state, user);
    if (!resident || request.requesterResidentId !== resident.id) throw new HttpError(403, "This call trade no longer belongs to your account");
    return;
  }
  if (!hasServicePrivilege(user, request.serviceLine, "request")) {
    throw new HttpError(403, "Request permission is no longer available for this service");
  }
}

function applyAssignmentChange(
  state: PlannerState,
  action: CoverageRequestAction,
  change: AssignmentChange
): PlannerState {
  if (action === "delete") {
    if (!change.assignmentId) throw new Error("Assignment delete request is missing assignmentId");
    const existing = state.assignments.find((assignment) => assignment.id === change.assignmentId);
    if (!existing || existing.kind !== change.kind || existing.targetId !== change.targetId) {
      throw new Error("Case assignment changed; submit a new request");
    }
    return { ...state, assignments: state.assignments.filter((assignment) => assignment.id !== existing.id) };
  }
  if (!change.residentId) throw new Error("Assignment request is missing residentId");
  requireResident(state, change.residentId);
  assertMedicalStudentAssignmentKind(state, change.kind, change.residentId);
  assertResidentAvailableForAssignment(state, change.kind, change.targetId, change.residentId);
  if (action === "create") {
    if (state.assignments.some((assignment) =>
      assignment.kind === change.kind && assignment.targetId === change.targetId && assignment.residentId === change.residentId
    )) throw new Error("Resident is already assigned to this case");
    return {
      ...state,
      assignments: [...state.assignments, makeAssignment(change.kind, change.targetId, change.residentId, "admin", Boolean(change.locked))]
    };
  }
  if (!change.assignmentId) throw new Error("Assignment update request is missing assignmentId");
  const existing = state.assignments.find((assignment) => assignment.id === change.assignmentId);
  if (!existing || existing.kind !== change.kind || existing.targetId !== change.targetId) {
    throw new Error("Case assignment changed; submit a new request");
  }
  if (state.assignments.some((assignment) =>
    assignment.id !== existing.id &&
    assignment.kind === change.kind &&
    assignment.targetId === change.targetId &&
    assignment.residentId === change.residentId
  )) throw new Error("Resident is already assigned to this case");
  return {
    ...state,
    assignments: state.assignments.map((assignment) => assignment.id === existing.id
      ? { ...assignment, residentId: change.residentId!, locked: change.locked ?? assignment.locked, updatedAt: new Date().toISOString() }
      : assignment)
  };
}

function applyCaseOrderChange(state: PlannerState, change: CaseOrderChange): PlannerState {
  const surgeryCase = state.cases.find((candidate) => candidate.id === change.caseId);
  if (!surgeryCase) throw new Error(`Case not found: ${change.caseId}`);
  const blockCases = state.cases
    .filter((candidate) => candidate.blockId === surgeryCase.blockId)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const withoutTarget = blockCases.filter((candidate) => candidate.id !== surgeryCase.id);
  const index = Math.max(0, Math.min(change.order - 1, withoutTarget.length));
  withoutTarget.splice(index, 0, surgeryCase);
  const orders = new Map(withoutTarget.map((candidate, order) => [candidate.id, order]));
  return {
    ...state,
    cases: state.cases.map((candidate) => orders.has(candidate.id) ? { ...candidate, order: orders.get(candidate.id)! } : candidate)
  };
}

function applyClinicSessionChange(state: PlannerState, change: ClinicSessionChange): PlannerState {
  const clinic = state.clinicSessions.find((candidate) => candidate.id === change.clinicId);
  if (!clinic) throw new Error(`Clinic session not found: ${change.clinicId}`);
  const startTime = change.startTime ?? clinic.startTime;
  const endTime = change.endTime ?? clinic.endTime;
  assertAssistantClinicTime(startTime, "start_time");
  assertAssistantClinicTime(endTime, "end_time");
  if (timeToMinutes(startTime) >= timeToMinutes(endTime)) {
    throw new Error("Clinic start time must be before its end time");
  }
  return {
    ...state,
    clinicSessions: state.clinicSessions.map((candidate) => candidate.id === clinic.id
      ? {
        ...candidate,
        startTime,
        endTime,
        isProcedure: change.isProcedure ?? candidate.isProcedure
      }
      : candidate)
  };
}

function buildCoverageRequest(
  state: PlannerState,
  input: Partial<CoverageChangeRequest>,
  requester: SessionUser | undefined,
  serviceLine: string | undefined
): CoverageChangeRequest {
  const now = new Date().toISOString();
  const action = assertCoverageRequestAction(input.action);
  const entryId = readOptionalString(input.entryId);
  assertNoPhiText(readOptionalString(input.message) ?? "", "request message");
  let requestedEntry: CoverageEntry | undefined;

  if (action === "delete") {
    if (!entryId) throw new Error("Delete requests require entryId");
    requireCoverageEntry(state, entryId);
  } else {
    const existing = action === "update" && entryId ? requireCoverageEntry(state, entryId) : undefined;
    requestedEntry = buildCoverageEntry(state, { ...input.requestedEntry, id: entryId ?? input.requestedEntry?.id }, existing);
  }

  return {
    id: readOptionalString(input.id) ?? createId("cover_req"),
    action,
    status: "pending",
    entryId,
    requestedEntry,
    serviceLine,
    requesterUsername: requester?.username,
    requesterName: readOptionalString(input.requesterName) ?? requester?.displayName,
    message: readOptionalString(input.message) ?? "",
    createdAt: now,
    updatedAt: now
  };
}

function buildResidentTradeRequest(
  state: PlannerState,
  input: Partial<CoverageChangeRequest>,
  requester: SessionUser | undefined,
  serviceLine: string | undefined
): CoverageChangeRequest {
  const now = new Date().toISOString();
  const action = input.action ? assertCoverageRequestAction(input.action) : "update";
  if (action !== "update") {
    throw new Error("Resident trade requests must update an existing entry");
  }
  const requesterResident = findResidentForUser(state, requester);
  if (!requesterResident) {
    throw new HttpError(403, "Linked resident profile required to trade call");
  }
  const entryId = readOptionalString(input.entryId);
  if (!entryId) throw new Error("Resident trade requests require entryId");
  const sourceEntry = requireCoverageEntry(state, entryId);
  if (!isTradeableCoverageKind(sourceEntry.kind)) {
    throw new Error("Only call and rounding entries can be traded between residents");
  }
  if (sourceEntry.residentId !== requesterResident.id) {
    throw new HttpError(403, "You can only trade your own call calendar entry");
  }

  const targetResidentId = readOptionalString(input.targetResidentId);
  const targetResident = targetResidentId
    ? state.residents.find((resident) => resident.id === targetResidentId)
    : undefined;
  if (!targetResident) throw new Error("Resident trade requests require a targetResidentId");
  if (targetResident.id === requesterResident.id) {
    throw new Error("Choose another resident for the trade request");
  }
  if (sourceEntry.kind === "call" && !isResidentCallEligible(targetResident)) {
    throw new HttpError(400, "Resident call trades require a resident who is in the call pool");
  }
  assertNoPhiText(readOptionalString(input.message) ?? "", "request message");

  const swapEntryId = readOptionalString(input.swapEntryId);
  const swapEntry = swapEntryId ? requireCoverageEntry(state, swapEntryId) : undefined;
  if (swapEntry) {
    if (!isTradeableCoverageKind(swapEntry.kind)) {
      throw new Error("Only call and rounding entries can be swapped between residents");
    }
    if (swapEntry.kind !== sourceEntry.kind) {
      throw new Error("Resident trade swaps must use the same calendar entry type");
    }
    if (swapEntry.id === sourceEntry.id) {
      throw new Error("Choose a different entry to swap");
    }
    if (swapEntry.residentId !== targetResident.id) {
      throw new Error("Swap entry must belong to the target resident");
    }
  }

  const requestedEntry = buildCoverageEntry(
    state,
    { ...sourceEntry, residentId: targetResident.id, id: sourceEntry.id, createdAt: sourceEntry.createdAt },
    sourceEntry
  );
  const swapRequestedEntry = swapEntry
    ? buildCoverageEntry(
      state,
      { ...swapEntry, residentId: requesterResident.id, id: swapEntry.id, createdAt: swapEntry.createdAt },
      swapEntry
    )
    : undefined;

  return {
    id: readOptionalString(input.id) ?? createId("cover_trade"),
    requestType: "resident-trade",
    action,
    status: "pending",
    entryId,
    requestedEntry,
    requesterResidentId: requesterResident.id,
    targetResidentId: targetResident.id,
    swapEntryId,
    swapRequestedEntry,
    serviceLine,
    requesterUsername: requester?.username,
    requesterName: readOptionalString(input.requesterName) ?? requester?.displayName,
    message: readOptionalString(input.message) ?? "",
    createdAt: now,
    updatedAt: now
  };
}

function buildResidentProfileRequest(
  state: PlannerState,
  input: Partial<CoverageChangeRequest>,
  requester: SessionUser | undefined
): CoverageChangeRequest {
  const now = new Date().toISOString();
  const action = input.action ? assertCoverageRequestAction(input.action) : "update";
  if (action !== "update") {
    throw new Error("Resident profile requests must update an existing resident");
  }
  const requesterResident = findResidentForUser(state, requester);
  if (!requesterResident) {
    throw new HttpError(403, "Linked resident profile required to request profile changes");
  }
  const targetResidentId = readOptionalString(input.targetResidentId) ?? readOptionalString(input.requestedResidentProfile?.residentId);
  if (!targetResidentId) throw new Error("Resident profile requests require a targetResidentId");
  const targetResident = state.residents.find((resident) => resident.id === targetResidentId);
  if (!targetResident) throw new Error(`Resident not found: ${targetResidentId}`);
  if (requester?.role !== "admin" && targetResident.id !== requesterResident.id) {
    throw new HttpError(403, "You can only request changes for your linked resident profile");
  }
  assertNoPhiText(readOptionalString(input.message) ?? "", "request message");
  const requestedResidentProfile = buildResidentProfileChange(input.requestedResidentProfile, targetResident);

  return {
    id: readOptionalString(input.id) ?? createId("resident_profile_req"),
    requestType: "resident-profile",
    action,
    status: "pending",
    requesterResidentId: requesterResident.id,
    targetResidentId: targetResident.id,
    requestedResidentProfile,
    requesterUsername: requester?.username,
    requesterName: readOptionalString(input.requesterName) ?? requester?.displayName,
    message: readOptionalString(input.message) ?? "",
    createdAt: now,
    updatedAt: now
  };
}

function buildResidentProfileChange(input: ResidentProfileChange | undefined, resident: Resident): ResidentProfileChange {
  const name = readOptionalString(input?.name);
  const aliases = input && "aliases" in input ? normalizeAliasList(input.aliases) : undefined;
  if (!name && aliases === undefined) {
    throw new Error("Resident profile requests require a display name or aliases");
  }
  if (name) assertNoPhiText(name, "resident display name");
  for (const alias of aliases ?? []) {
    assertNoPhiText(alias, "resident alias");
  }
  return {
    residentId: resident.id,
    name,
    aliases
  };
}

function buildResidentVacationRequest(
  state: PlannerState,
  input: Partial<CoverageChangeRequest>,
  requester: SessionUser | undefined
): CoverageChangeRequest {
  const now = new Date().toISOString();
  const action = input.action ? assertCoverageRequestAction(input.action) : "update";
  if (action !== "update") {
    throw new Error("Resident vacation requests must update an existing resident");
  }
  const targetResidentId = readOptionalString(input.targetResidentId) ?? readOptionalString(input.requestedResidentVacation?.residentId);
  if (!targetResidentId) throw new Error("Resident vacation requests require a targetResidentId");
  const targetResident = state.residents.find((resident) => resident.id === targetResidentId);
  if (!targetResident) throw new Error(`Resident not found: ${targetResidentId}`);
  assertNoPhiText(readOptionalString(input.message) ?? "", "request message");
  const requestedResidentVacation = buildResidentVacationChange(input.requestedResidentVacation, targetResident);

  return {
    id: readOptionalString(input.id) ?? createId("resident_vacation_req"),
    requestType: "resident-vacation",
    action,
    status: "pending",
    targetResidentId: targetResident.id,
    requestedResidentVacation,
    requesterUsername: requester?.username,
    requesterName: readOptionalString(input.requesterName) ?? requester?.displayName,
    message: readOptionalString(input.message) ?? "",
    createdAt: now,
    updatedAt: now
  };
}

function buildResidentVacationChange(
  input: ResidentVacationChange | undefined,
  resident: Resident
): ResidentVacationChange {
  if (!input || !Array.isArray(input.vacation)) {
    throw new Error("Resident vacation requests require a vacation list");
  }
  if (input.residentId && input.residentId !== resident.id) {
    throw new Error("Resident vacation request must target the selected resident");
  }
  return {
    residentId: resident.id,
    vacation: normalizeVacationBlocks(input.vacation)
  };
}

function applyCoverageRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): PlannerState {
  if (isAssignmentChangeRequest(coverageRequest)) {
    if (!coverageRequest.requestedAssignmentChange) throw new Error("Assignment request is missing requested change");
    return applyAssignmentChange(state, coverageRequest.action, coverageRequest.requestedAssignmentChange);
  }

  if (isCaseOrderChangeRequest(coverageRequest)) {
    if (!coverageRequest.requestedCaseOrderChange) throw new Error("Case order request is missing requested change");
    return applyCaseOrderChange(state, coverageRequest.requestedCaseOrderChange);
  }

  if (isClinicSessionChangeRequest(coverageRequest)) {
    if (!coverageRequest.requestedClinicSessionChange) throw new Error("Clinic session request is missing requested change");
    return applyClinicSessionChange(state, coverageRequest.requestedClinicSessionChange);
  }

  if (isResidentProfileRequest(coverageRequest)) {
    return applyResidentProfileRequest(state, coverageRequest);
  }

  if (isResidentVacationRequest(coverageRequest)) {
    return applyResidentVacationRequest(state, coverageRequest);
  }

  if (isResidentTradeRequest(coverageRequest)) {
    return applyResidentTradeRequest(state, coverageRequest);
  }

  if (coverageRequest.action === "delete") {
    if (!coverageRequest.entryId) throw new Error("Delete request is missing entryId");
    return {
      ...state,
      coverageEntries: state.coverageEntries.filter((entry) => entry.id !== coverageRequest.entryId)
    };
  }

  if (!coverageRequest.requestedEntry) {
    throw new Error("Coverage request is missing requestedEntry");
  }

  const existing =
    coverageRequest.action === "update" && coverageRequest.entryId
      ? requireCoverageEntry(state, coverageRequest.entryId)
      : undefined;
  const entry = buildCoverageEntry(
    state,
    {
      ...coverageRequest.requestedEntry,
      id: coverageRequest.entryId ?? coverageRequest.requestedEntry.id,
      createdAt: existing?.createdAt ?? coverageRequest.requestedEntry.createdAt
    },
    existing
  );
  return upsertCoverageEntry(state, entry);
}

function applyResidentProfileRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): PlannerState {
  const requestedProfile = coverageRequest.requestedResidentProfile;
  const residentId = coverageRequest.targetResidentId ?? requestedProfile?.residentId;
  if (!residentId || !requestedProfile) {
    throw new Error("Resident profile request is missing requested profile");
  }
  if (!state.residents.some((resident) => resident.id === residentId)) {
    throw new Error(`Resident not found: ${residentId}`);
  }
  return {
    ...state,
    residents: state.residents.map((resident) =>
      resident.id === residentId
        ? {
          ...resident,
          name: requestedProfile.name ?? resident.name,
          aliases: requestedProfile.aliases ?? resident.aliases ?? []
        }
        : resident
    )
  };
}

function applyResidentVacationRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): PlannerState {
  const requestedVacation = coverageRequest.requestedResidentVacation;
  const residentId = coverageRequest.targetResidentId ?? requestedVacation?.residentId;
  if (!residentId || !requestedVacation) {
    throw new Error("Resident vacation request is missing vacation details");
  }
  if (!state.residents.some((resident) => resident.id === residentId)) {
    throw new Error(`Resident not found: ${residentId}`);
  }
  return {
    ...state,
    residents: state.residents.map((resident) =>
      resident.id === residentId ? { ...resident, vacation: requestedVacation.vacation } : resident
    )
  };
}

function applyResidentTradeRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): PlannerState {
  if (!coverageRequest.entryId || !coverageRequest.requestedEntry) {
    throw new Error("Resident trade request is missing source entry");
  }
  if (!coverageRequest.requesterResidentId || !coverageRequest.targetResidentId) {
    throw new Error("Resident trade request is missing resident links");
  }
  const sourceEntry = requireCoverageEntry(state, coverageRequest.entryId);
  if (sourceEntry.residentId !== coverageRequest.requesterResidentId) {
    throw new Error("Source call assignment changed; submit a new trade request");
  }

  let nextState = upsertCoverageEntry(
    state,
    buildCoverageEntry(
      state,
      {
        ...coverageRequest.requestedEntry,
        id: sourceEntry.id,
        createdAt: sourceEntry.createdAt
      },
      sourceEntry
    )
  );

  if (coverageRequest.swapEntryId) {
    if (!coverageRequest.swapRequestedEntry) {
      throw new Error("Resident trade request is missing swap entry");
    }
    const swapEntry = requireCoverageEntry(nextState, coverageRequest.swapEntryId);
    if (swapEntry.residentId !== coverageRequest.targetResidentId) {
      throw new Error("Swap call assignment changed; submit a new trade request");
    }
    nextState = upsertCoverageEntry(
      nextState,
      buildCoverageEntry(
        nextState,
        {
          ...coverageRequest.swapRequestedEntry,
          id: swapEntry.id,
          createdAt: swapEntry.createdAt
        },
        swapEntry
      )
    );
  }

  return nextState;
}

function validateCoverageEntry(state: PlannerState, entry: CoverageEntry): void {
  if (!isCoverageKindAllowedOnDate(entry.kind, entry.date)) {
    throw new HttpError(400, `${entry.kind} is not allowed on ${entry.date}`);
  }
  if ((entry.kind === "call" || entry.kind === "rounding") && !entry.residentId) {
    throw new HttpError(400, `${entry.kind} requires a resident`);
  }
  if (entry.residentId && !state.residents.some((resident) => resident.id === entry.residentId)) {
    throw new HttpError(400, `Unknown resident: ${entry.residentId}`);
  }
  if (entry.kind === "rounding" && entry.residentId) {
    assertResidentAvailableForWork(state, entry.residentId, entry.date, "rounding");
  }
  if (entry.kind === "call") {
    validateCallEntry(state, entry);
  }
  if (entry.kind === "attending-call") {
    validateAttendingCallEntry(state, entry);
  } else if (entry.dayAttendingId || entry.nightAttendingId) {
    throw new HttpError(400, "Only attending call entries can include attending assignments");
  }
}

function validateAttendingCallEntry(state: PlannerState, entry: CoverageEntry): void {
  if (entry.residentId) {
    throw new HttpError(400, "Attending call entries cannot include a resident");
  }
  if (entry.callPosition) {
    throw new HttpError(400, "Attending call entries do not use callPosition");
  }
  if (entry.note) {
    throw new HttpError(400, "Attending call entries do not accept notes");
  }
  if (!entry.dayAttendingId || !entry.nightAttendingId) {
    throw new HttpError(400, "Attending call requires both dayAttendingId and nightAttendingId");
  }
  for (const attendingId of [entry.dayAttendingId, entry.nightAttendingId]) {
    if (!state.attendings.some((attending) => attending.id === attendingId)) {
      throw new HttpError(400, `Unknown attending: ${attendingId}`);
    }
  }
  if (
    state.coverageEntries.some(
      (candidate) =>
        candidate.id !== entry.id &&
        candidate.kind === "attending-call" &&
        candidate.date === entry.date
    )
  ) {
    throw new HttpError(400, `Attending call is already listed for ${entry.date}`);
  }
}

function validateCallEntry(state: PlannerState, entry: CoverageEntry): void {
  if (entry.note && !isSccCallNote(entry.note)) {
    throw new HttpError(400, "Call entries only accept resident assignments; note may only be SCC or ICU for SCC/ICU call");
  }

  const callEntries = [
    ...state.coverageEntries.filter((candidate) => candidate.kind === "call" && candidate.date === entry.date && candidate.id !== entry.id),
    entry
  ].filter((candidate) => candidate.residentId);

  const ineligibleResident = callEntries
    .map((candidate) => state.residents.find((resident) => resident.id === candidate.residentId))
    .find((resident) => resident && !isResidentCallEligible(resident));
  if (ineligibleResident) {
    const reason = isMinimallyInvasiveFellow(ineligibleResident)
      ? "Minimally invasive fellows are not in the resident call pool"
      : `${ineligibleResident.name} is not eligible for resident call`;
    throw new HttpError(400, reason);
  }

  const duplicateResident = callEntries.find(
    (candidate, index) => callEntries.findIndex((other) => other.residentId === candidate.residentId) !== index
  );
  if (duplicateResident?.residentId) {
    const residentName = state.residents.find((resident) => resident.id === duplicateResident.residentId)?.name ?? duplicateResident.residentId;
    throw new HttpError(400, `${residentName} is already listed for call on ${entry.date}`);
  }

  const surgeryEntries = callEntries.filter((candidate) => !isSccCallEntry(state, candidate));
  for (const surgeryEntry of surgeryEntries) {
    if (!surgeryEntry.callPosition) {
      throw new HttpError(400, "Surgery call entries require callPosition: senior, mid-level, or intern");
    }
  }
  const duplicatePosition = surgeryEntries.find(
    (candidate, index) =>
      Boolean(candidate.callPosition) &&
      surgeryEntries.findIndex((other) => other.callPosition === candidate.callPosition) !== index
  );
  if (duplicatePosition?.callPosition) {
    throw new HttpError(400, `Surgery call already has a ${duplicatePosition.callPosition} resident on ${entry.date}`);
  }
  if (surgeryEntries.length > MAX_SURGERY_CALL_RESIDENTS) {
    throw new HttpError(400, `Surgery call can include at most ${MAX_SURGERY_CALL_RESIDENTS} residents on ${entry.date}`);
  }

  const sccEntries = callEntries.filter((candidate) => isSccCallEntry(state, candidate));
  if (sccEntries.some((candidate) => candidate.callPosition)) {
    throw new HttpError(400, "SCC/ICU call entries do not use callPosition");
  }
  if (sccEntries.length > MAX_SCC_CALL_RESIDENTS) {
    throw new HttpError(400, `SCC/ICU call can include at most ${MAX_SCC_CALL_RESIDENTS} resident on ${entry.date}`);
  }
}

function normalizeCallPosition(value: unknown): CallPosition | undefined {
  const normalized = readOptionalString(value)?.toLowerCase().replace(/[_\s]+/g, "-");
  if (!normalized) return undefined;
  if (normalized === "mid" || normalized === "midlevel") return "mid-level";
  if (CALL_POSITIONS.includes(normalized as CallPosition)) return normalized as CallPosition;
  throw new HttpError(400, "Invalid callPosition; use senior, mid-level, or intern");
}

function normalizeCoverageEntryNote(kind: CoverageKind, note: string): string {
  if (kind !== "call") return note;
  if (!note) return "";
  if (/^icu$/i.test(note)) return "ICU";
  if (/^scc$/i.test(note)) return "SCC";
  return note;
}

function isSccCallEntry(state: PlannerState, entry: CoverageEntry): boolean {
  if (isSccCallNote(entry.note)) return true;
  const resident = entry.residentId ? state.residents.find((candidate) => candidate.id === entry.residentId) : undefined;
  return resident ? isResidentOnService(resident, "ICU", entry.date) : false;
}

function isSccCallNote(note: string): boolean {
  return /^(icu|scc)$/i.test(note.trim());
}

function isTradeableCoverageKind(kind: CoverageKind): boolean {
  return kind === "call" || kind === "rounding";
}

function requireResident(state: PlannerState, residentId: unknown): asserts residentId is string {
  if (typeof residentId !== "string" || !state.residents.some((resident) => resident.id === residentId)) {
    throw new HttpError(400, `Unknown resident: ${String(residentId ?? "")}`);
  }
}

function assertNoPhiInEntity(collection: CollectionName, entity: unknown): void {
  if (!entity || typeof entity !== "object") return;
  const fieldsByCollection: Partial<Record<CollectionName, string[]>> = {
    attendingBlocks: ["notes"],
    cases: ["procedureLabel", "notes"],
    clinicSessions: ["location"],
    procedureDefaults: ["label"]
  };
  for (const field of fieldsByCollection[collection] ?? []) {
    const value = (entity as Record<string, unknown>)[field];
    if (typeof value === "string") assertNoPhiText(value, field);
  }
}

function assertResidentVacationInput(entity: unknown): void {
  if (!entity || typeof entity !== "object" || !("vacation" in entity)) return;
  const vacation = (entity as { vacation?: unknown }).vacation;
  if (!Array.isArray(vacation)) {
    throw new HttpError(400, "vacation must be an array");
  }
  normalizeVacationBlocks(vacation);
}

function normalizeVacationBlocks(vacation: unknown[]): ResidentVacationChange["vacation"] {
  const ids = new Set<string>();
  return vacation.map((vacationBlock, index) => {
    if (!vacationBlock || typeof vacationBlock !== "object") {
      throw new HttpError(400, `Vacation ${index + 1} must be an object`);
    }
    const block = vacationBlock as { id?: unknown; startDate?: unknown; endDate?: unknown };
    const id = readRequiredString(block.id, `Vacation ${index + 1} id`);
    if (ids.has(id)) throw new HttpError(400, `Duplicate vacation id: ${id}`);
    ids.add(id);
    const startDate = assertDate(block.startDate);
    const endDate = assertDate(block.endDate);
    if (endDate < startDate) {
      throw new HttpError(400, "Vacation endDate must be on or after startDate");
    }
    return { id, startDate, endDate };
  });
}

function assertNoPhiText(value: string, field: string): void {
  if (!value) return;
  const patterns = [
    /\b(patient|mrn|dob|date of birth|medical record|identifier)\b/i,
    /\bmrn\s*[:#-]?\s*\d{4,}\b/i,
    /\b\d{2}\/\d{2}\/(?:\d{2}|\d{4})\b/,
    /\b\d{7,10}\b/
  ];
  if (patterns.some((pattern) => pattern.test(value))) {
    throw new HttpError(400, `${field} appears to contain patient-identifying text; keep scheduler data no-PHI`);
  }
}

function requireCoverageEntry(state: PlannerState, id: string): CoverageEntry {
  const entry = state.coverageEntries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Coverage entry not found: ${id}`);
  return entry;
}

function requireAttendingCoverageAssignment(state: PlannerState, id: string): AttendingCoverageAssignment {
  const assignment = state.attendingCoverageAssignments.find((candidate) => candidate.id === id);
  if (!assignment) throw new HttpError(404, `Attending coverage assignment not found: ${id}`);
  return assignment;
}

function buildAttendingCoverageAssignment(
  state: PlannerState,
  input: Partial<AttendingCoverageAssignment>,
  existing?: AttendingCoverageAssignment,
  source: AttendingCoverageAssignment["source"] = "manual"
): AttendingCoverageAssignment {
  const now = new Date().toISOString();
  const date = assertDate(input.date ?? existing?.date);
  const line = assertAttendingCoverageLine(input.line ?? existing?.line);
  const shift = assertAttendingCoverageShift(input.shift ?? existing?.shift);
  const role = assertAttendingCoverageRole(input.role ?? existing?.role);
  const attendingId = readOptionalString(input.attendingId ?? existing?.attendingId);
  const fellowResidentId = readOptionalString(input.fellowResidentId ?? existing?.fellowResidentId);
  if (Boolean(attendingId) === Boolean(fellowResidentId)) {
    throw new HttpError(400, "Attending coverage requires exactly one attendingId or fellowResidentId");
  }
  if (attendingId && !state.attendings.some((attending) => attending.id === attendingId)) {
    throw new HttpError(400, "Attending not found");
  }
  if (fellowResidentId) {
    const fellow = state.residents.find((resident) => resident.id === fellowResidentId);
    if (!fellow || !isMinimallyInvasiveFellow(fellow)) {
      throw new HttpError(400, "fellowResidentId must identify a minimally invasive fellow");
    }
    if (line !== "Practice" || shift !== "weekend" || role !== "primary") {
      throw new HttpError(400, "A minimally invasive fellow may cover only primary Practice weekend call");
    }
  }
  if (shift === "weekend" && !isIndependentCallLine(line)) {
    throw new HttpError(400, "Weekend coverage is available only for Practice, Vascular, Pediatrics, and NRV call");
  }
  if (shift === "weekend" && !isPracticeWeekendStart(date)) {
    throw new HttpError(400, "Weekend call must start on Friday (5 PM Friday through 6 AM Monday)");
  }
  if (role === "primary" && shift === "night" && (line === "EGS" || line === "Trauma" || line === "SCC")) {
    throw new HttpError(400, "Night EGS, Trauma, and SCC coverage is one ACS call assignment; use line ACS");
  }
  if (line === "ACS" && role === "primary" && shift !== "night") {
    throw new HttpError(400, "Primary ACS call is a night assignment");
  }
  const note = typeof input.note === "string" ? input.note.trim() : existing?.note ?? "";
  assertNoPhiText(note, "attending coverage note");
  return {
    id: input.id || existing?.id || createId("attcov"),
    date,
    line,
    shift,
    role,
    attendingId,
    fellowResidentId,
    source,
    note,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now
  };
}

function assertUniqueAttendingCoverageSlot(state: PlannerState, assignment: AttendingCoverageAssignment): void {
  const conflict = state.attendingCoverageAssignments.find(
    (candidate) =>
      candidate.id !== assignment.id &&
      candidate.date === assignment.date &&
      candidate.line === assignment.line &&
      candidate.shift === assignment.shift &&
      candidate.role === assignment.role
  );
  if (conflict) throw new HttpError(409, "That attending coverage slot is already assigned");
}

function getEffectiveAttendingCoverage(
  state: PlannerState,
  startDate: string,
  endDate: string,
  line?: AttendingCoverageLine
) {
  const lines = line && isIndependentCallLine(line)
    ? [line]
    : line ? [] : [...INDEPENDENT_CALL_LINES];
  const effective: Array<Record<string, unknown>> = [];
  let date = startDate;
  for (let dayCount = 0; date <= endDate && dayCount < 366; dayCount += 1, date = addDays(date, 1)) {
    for (const coverageLine of lines) {
      const day = resolveIndependentCallCoverage(state.attendingCoverageAssignments, coverageLine, date, "day");
      const night = resolveIndependentCallCoverage(state.attendingCoverageAssignments, coverageLine, date, "night");
      const earlyMorning = resolveIndependentMondayEarlyMorningCoverage(state.attendingCoverageAssignments, coverageLine, date);
      if (!day && !night && !earlyMorning) continue;
      effective.push({
        date,
        line: coverageLine,
        day: day ? describeEffectiveAttendingCoverage(day) : undefined,
        night: night ? describeEffectiveAttendingCoverage(night) : undefined,
        earlyMorningUntil6am: earlyMorning ? describeEffectiveAttendingCoverage(earlyMorning) : undefined
      });
    }
  }
  return effective;
}

function describeEffectiveAttendingCoverage(
  resolved: ResolvedIndependentCallCoverage
) {
  return {
    assignmentId: resolved.assignment.id,
    attendingId: resolved.assignment.attendingId,
    fellowResidentId: resolved.assignment.fellowResidentId,
    sourceShift: resolved.assignment.shift,
    inheritedFromDay: resolved.inheritedFromDay,
    inheritedFromWeekend: resolved.inheritedFromWeekend,
    weekend: resolved.weekend
  };
}

function assertAttendingCoverageLine(value: unknown): AttendingCoverageLine {
  if (value === "Elective") return "Practice";
  if (typeof value === "string" && ATTENDING_COVERAGE_LINES.includes(value as AttendingCoverageLine)) {
    return value as AttendingCoverageLine;
  }
  throw new HttpError(400, "Invalid attending coverage line");
}

function assertAttendingCoverageShift(value: unknown): AttendingCoverageShift {
  if (value === "day" || value === "night" || value === "24h" || value === "weekend") return value;
  throw new HttpError(400, "Invalid attending coverage shift");
}

function assertAttendingCoverageRole(value: unknown): AttendingCoverageRole {
  if (value === "primary" || value === "backup") return value;
  throw new HttpError(400, "Invalid attending coverage role");
}

function compareAttendingCoverageAssignments(a: AttendingCoverageAssignment, b: AttendingCoverageAssignment): number {
  return (
    a.date.localeCompare(b.date) ||
    ATTENDING_COVERAGE_LINES.indexOf(a.line) - ATTENDING_COVERAGE_LINES.indexOf(b.line) ||
    a.role.localeCompare(b.role) ||
    a.shift.localeCompare(b.shift) ||
    a.id.localeCompare(b.id)
  );
}

function describeAttendingCoverage(state: PlannerState, assignment: AttendingCoverageAssignment): string {
  const attending = assignment.attendingId
    ? state.attendings.find((candidate) => candidate.id === assignment.attendingId)?.name
    : state.residents.find((candidate) => candidate.id === assignment.fellowResidentId)?.name;
  const line = assignment.line === "ACS" && assignment.role === "primary" ? "ACS call" : assignment.line;
  return `${line} ${assignment.shift} ${assignment.role} on ${assignment.date}: ${attending ?? "clinician"}`;
}

function requireCoverageRequest(state: PlannerState, id: string): CoverageChangeRequest {
  const coverageRequest = state.coverageRequests.find((candidate) => candidate.id === id);
  if (!coverageRequest) throw new Error(`Coverage request not found: ${id}`);
  return coverageRequest;
}

function assertCoverageKind(value: unknown): CoverageKind {
  if (value === "call" || value === "attending-call" || value === "rounding" || value === "off" || value === "note") {
    return value;
  }
  throw new Error("Invalid coverage kind");
}

function assertCoverageRequestAction(value: unknown): CoverageRequestAction {
  if (value === "create" || value === "update" || value === "delete") {
    return value;
  }
  throw new Error("Invalid coverage request action");
}

function assertDate(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid coverage date");
  }
  return value;
}

function getCallBuilderBlockForDate(date: string) {
  for (let blockNumber = 1; blockNumber <= 13; blockNumber += 1) {
    const block = getCallBuilderBlock(blockNumber);
    if (block && block.startDate <= date && date <= block.endDate) return block;
  }
  return undefined;
}

function readCallBuilderBlockNumber(value: unknown): number {
  const blockNumber = Number(value);
  if (!Number.isInteger(blockNumber) || !getCallBuilderBlock(blockNumber)) {
    throw new HttpError(400, "Choose a configured rotation block");
  }
  return blockNumber;
}

function readCallBuilderAssignments(value: unknown): CallBuilderAssignment[] {
  if (!Array.isArray(value)) throw new HttpError(400, "assignments must be an array");
  if (value.length > 100) throw new HttpError(400, "A call-builder draft may contain at most 100 assignments");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `Assignment ${index + 1} must be an object`);
    }
    const input = item as Record<string, unknown>;
    const date = assertDate(input.date);
    const callPosition = input.callPosition;
    if (callPosition !== "senior" && callPosition !== "mid-level" && callPosition !== "intern") {
      throw new HttpError(400, `Assignment ${index + 1} has an invalid call position`);
    }
    const residentId = readOptionalString(input.residentId);
    if (!residentId) throw new HttpError(400, `Assignment ${index + 1} requires a residentId`);
    return { date, callPosition, residentId };
  });
}

function readCallBuilderSolverSummary(value: unknown): CallBuilderSolverSummary | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "solverSummary must be an object");
  }
  const input = value as Record<string, unknown>;
  const engine = input.engine;
  if (engine !== "cp-sat" && engine !== "heuristic" && engine !== "manual") {
    throw new HttpError(400, "solverSummary has an invalid engine");
  }
  const status = input.status;
  if (status !== "optimal" && status !== "feasible" && status !== "infeasible" && status !== "fallback" && status !== "manual") {
    throw new HttpError(400, "solverSummary has an invalid status");
  }
  const objectives = Array.isArray(input.objectives)
    ? input.objectives.slice(0, 30).map((objective, index) => {
        if (!objective || typeof objective !== "object" || Array.isArray(objective)) {
          throw new HttpError(400, `solverSummary objective ${index + 1} must be an object`);
        }
        const item = objective as Record<string, unknown>;
        return {
          key: readRequiredString(item.key, `solverSummary.objectives[${index}].key`),
          label: readRequiredString(item.label, `solverSummary.objectives[${index}].label`),
          value: Number.isFinite(Number(item.value)) ? Number(item.value) : 0,
          optimal: item.optimal === true
        };
      })
    : [];
  return {
    engine,
    engineVersion: readRequiredString(input.engineVersion, "solverSummary.engineVersion"),
    status,
    optimalityProven: input.optimalityProven === true,
    durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
    objectives,
    message: readOptionalString(input.message)
  };
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function readOptionalNonNegativeInteger(value: unknown): number | undefined {
  const parsed = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

type PendingWikiChange = Omit<WikiChangeEvent, "revision" | "changedAt" | "changedBy">;

interface WikiSyncPlan {
  baseRevision: number;
  currentRevision: number;
  articles: WikiArticle[];
  sources: WikiSource[];
  changes: PendingWikiChange[];
  summary: { created: number; updated: number; deleted: number };
  validation: ReturnType<typeof validateWikiKnowledgeBase>;
}

function buildWikiSyncPlan(state: PlannerState, body: unknown, user: SessionUser | undefined): WikiSyncPlan {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Wiki sync payload must be an object");
  }
  const input = body as Record<string, unknown>;
  const baseRevision = readOptionalNonNegativeInteger(input.baseRevision) ?? state.wikiRevision;
  const articleInputs = readOptionalObjectArray(input.articles, "articles");
  const sourceInputs = readOptionalObjectArray(input.sources, "sources");
  const deleteArticles = readOptionalStringArray(input.deleteArticles, "deleteArticles").map(normalizeWikiSlug);
  const deleteSources = readOptionalStringArray(input.deleteSources, "deleteSources");
  let articles = [...state.wikiArticles];
  let sources = [...state.wikiSources];
  const changes: PendingWikiChange[] = [];

  for (const sourceInput of sourceInputs) {
    const requestedId = readOptionalString(sourceInput.id)?.toLowerCase().replace(/[^a-z0-9_-]/g, "-") ?? "";
    const existing = sources.find((source) => source.id === requestedId);
    const source = buildWikiSource(sourceInput, existing, user);
    if (existing && wikiSourceMetadata(existing) === wikiSourceMetadata(source)) continue;
    sources = existing
      ? sources.map((candidate) => (candidate.id === existing.id ? source : candidate))
      : [...sources, source];
    changes.push({
      entity: "source",
      operation: existing ? "update" : "create",
      key: source.id,
      sourceId: source.id,
      contentHash: source.contentHash
    });
  }

  for (const sourceId of deleteSources) {
    const existing = sources.find((source) => source.id === sourceId);
    if (!existing) continue;
    sources = sources.filter((source) => source.id !== sourceId);
    changes.push({ entity: "source", operation: "delete", key: sourceId, sourceId });
  }

  for (const articleInput of articleInputs) {
    const requestedSlug = normalizeWikiSlug(readOptionalString(articleInput.slug) ?? "");
    const existing = articles.find((article) => article.slug === requestedSlug);
    const article = buildWikiArticle(articleInput, existing, user);
    if (existing && existing.contentHash === article.contentHash) continue;
    articles = existing
      ? articles.map((candidate) => (candidate.id === existing.id ? article : candidate))
      : [...articles, article];
    changes.push({
      entity: "article",
      operation: existing ? "update" : "create",
      key: article.slug,
      slug: article.slug,
      articleRevision: article.revision,
      contentHash: article.contentHash
    });
  }

  for (const slug of deleteArticles) {
    const existing = articles.find((article) => article.slug === slug);
    if (!existing) continue;
    articles = articles.filter((article) => article.id !== existing.id);
    changes.push({
      entity: "article",
      operation: "delete",
      key: slug,
      slug,
      articleRevision: existing.revision,
      contentHash: existing.contentHash
    });
    articles = articles.map((article) => {
      if (!article.links.includes(slug)) return article;
      const updated = buildWikiArticle({ links: article.links.filter((link) => link !== slug) }, article, user);
      changes.push({
        entity: "article",
        operation: "update",
        key: updated.slug,
        slug: updated.slug,
        articleRevision: updated.revision,
        contentHash: updated.contentHash
      });
      return updated;
    });
  }

  articles = normalizeWikiArticles(articles);
  sources = normalizeWikiSources(sources);
  const validation = validateWikiKnowledgeBase(articles, sources);
  return {
    baseRevision,
    currentRevision: state.wikiRevision,
    articles,
    sources,
    changes,
    summary: {
      created: changes.filter((change) => change.operation === "create").length,
      updated: changes.filter((change) => change.operation === "update").length,
      deleted: changes.filter((change) => change.operation === "delete").length
    },
    validation
  };
}

function applyWikiMutationMetadata(
  state: PlannerState,
  changes: PendingWikiChange[],
  user: SessionUser | undefined
): PlannerState {
  if (!changes.length) return state;
  const revision = state.wikiRevision + 1;
  const changedAt = new Date().toISOString();
  const changedBy = user?.displayName || user?.username;
  return {
    ...state,
    wikiRevision: revision,
    wikiChanges: [
      ...state.wikiChanges,
      ...changes.map<WikiChangeEvent>((change) => ({ ...change, revision, changedAt, changedBy }))
    ].slice(-1_000)
  };
}

function buildWikiSource(input: Record<string, unknown>, existing: WikiSource | undefined, user: SessionUser | undefined): WikiSource {
  const now = new Date().toISOString();
  const id = (readOptionalString(input.id) ?? existing?.id ?? "").toLowerCase().replace(/[^a-z0-9_-]/g, "-").slice(0, 120);
  const title = readOptionalString(input.title) ?? existing?.title;
  const sourceType = readOptionalString(input.sourceType) ?? existing?.sourceType ?? "document";
  const capturedAt = readOptionalIsoTimestamp(input.capturedAt) ?? existing?.capturedAt ?? now;
  const contentHash = (readOptionalString(input.contentHash) ?? existing?.contentHash ?? "").toLowerCase();
  if (!id) throw new HttpError(400, "Wiki source id is required");
  if (!title) throw new HttpError(400, "Wiki source title is required");
  if (!(WIKI_SOURCE_TYPES as readonly string[]).includes(sourceType)) {
    throw new HttpError(400, `Invalid wiki source type: ${sourceType}`);
  }
  if (!/^[a-f0-9]{64}$/.test(contentHash)) {
    throw new HttpError(400, "Wiki source contentHash must be a SHA-256 hex digest");
  }
  const source = normalizeWikiSources([{
    id,
    title,
    sourceType: sourceType as WikiSource["sourceType"],
    author: "author" in input ? readOptionalString(input.author) : existing?.author,
    origin: "origin" in input ? readOptionalString(input.origin) : existing?.origin,
    capturedAt,
    effectiveDate: "effectiveDate" in input ? readOptionalWikiDate(input.effectiveDate) : existing?.effectiveDate,
    contentHash,
    referenceFile: "referenceFile" in input
      ? preserveAvailableWikiReferenceFile(
          readWikiReferenceFile(input.referenceFile),
          existing?.referenceFile,
          existing?.contentHash === contentHash
        )
      : existing?.referenceFile,
    notes: "notes" in input ? readOptionalString(input.notes) : existing?.notes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    updatedBy: user?.displayName || user?.username
  }])[0];
  if (!source) throw new HttpError(400, "Wiki source is invalid");
  return source;
}

function wikiSourceMetadata(source: WikiSource): string {
  return JSON.stringify({
    id: source.id,
    title: source.title,
    sourceType: source.sourceType,
    author: source.author,
    origin: source.origin,
    capturedAt: source.capturedAt,
    effectiveDate: source.effectiveDate,
    contentHash: source.contentHash,
    referenceFile: source.referenceFile,
    notes: source.notes
  });
}

function readWikiReferenceFile(value: unknown): WikiSource["referenceFile"] {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "referenceFile must be an object");
  }
  const input = value as Record<string, unknown>;
  const filename = readOptionalString(input.filename)?.replace(/[\\/]/g, "-");
  const mediaType = readWikiMediaType(readOptionalString(input.mediaType));
  const byteSize = Number(input.byteSize);
  if (!filename) throw new HttpError(400, "referenceFile.filename is required");
  if (!mediaType) throw new HttpError(400, "referenceFile.mediaType is required");
  if (!Number.isInteger(byteSize) || byteSize <= 0 || byteSize > 25 * 1024 * 1024) {
    throw new HttpError(400, "referenceFile.byteSize must be between 1 byte and 25 MB");
  }
  return { filename: filename.slice(0, 240), mediaType, byteSize };
}

function preserveAvailableWikiReferenceFile(
  requested: WikiSource["referenceFile"],
  existing: WikiSource["referenceFile"],
  sameContent: boolean
): WikiSource["referenceFile"] {
  if (!requested) return undefined;
  const sameFile = sameContent && existing?.available === true &&
    existing.filename === requested.filename &&
    existing.mediaType === requested.mediaType &&
    existing.byteSize === requested.byteSize;
  return { ...requested, available: sameFile ? true : undefined };
}

function withWikiSourceDownload(source: WikiSource) {
  return {
    ...source,
    downloadUrl: source.referenceFile?.available ? `/api/wiki/sources/${encodeURIComponent(source.id)}/file` : undefined
  };
}

function normalizeWikiSourceId(value: string): string {
  const sourceId = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,119}$/.test(sourceId)) throw new HttpError(400, "Invalid wiki source id");
  return sourceId;
}

function readWikiFilenameHeader(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    throw new HttpError(400, "x-wiki-filename must be URI encoded");
  }
  const filename = path.basename(decoded).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!filename) throw new HttpError(400, "x-wiki-filename is invalid");
  return filename.slice(0, 240);
}

function readWikiMediaType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const mediaType = value.split(";", 1)[0].trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mediaType) ? mediaType : undefined;
}

function contentDispositionAttachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function readOptionalObjectArray(value: unknown, field: string): Array<Record<string, unknown>> {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array`);
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `${field}[${index}] must be an object`);
    }
    return item as Record<string, unknown>;
  });
}

function readOptionalStringArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  return readWikiStringList(value, field);
}

function readOptionalIsoTimestamp(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function buildWikiArticle(input: unknown, existing: WikiArticle | undefined, user: SessionUser | undefined): WikiArticle {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Wiki article must be an object");
  }
  const patch = input as Record<string, unknown>;
  const now = new Date().toISOString();
  const slug = normalizeWikiSlug(readOptionalString(patch.slug) ?? existing?.slug ?? "");
  const title = readOptionalString(patch.title) ?? existing?.title;
  const summary = readOptionalString(patch.summary) ?? existing?.summary;
  const body = typeof patch.body === "string" ? patch.body.trim() : existing?.body;
  const categoryValue = readOptionalString(patch.category) ?? existing?.category ?? "program";
  if (!slug) throw new HttpError(400, "Wiki slug is required");
  if (!title) throw new HttpError(400, "Wiki title is required");
  if (!summary) throw new HttpError(400, "Wiki summary is required");
  if (!body) throw new HttpError(400, "Wiki body is required");
  if (!(WIKI_CATEGORIES as readonly string[]).includes(categoryValue)) {
    throw new HttpError(400, `Invalid wiki category: ${categoryValue}`);
  }
  const kindValue = readOptionalString(patch.kind) ?? existing?.kind;
  if (kindValue && !(WIKI_ARTICLE_KINDS as readonly string[]).includes(kindValue)) {
    throw new HttpError(400, `Invalid wiki article kind: ${kindValue}`);
  }
  const scope = "scope" in patch ? readWikiArticleScope(patch.scope) : existing?.scope;
  const relationships = "relationships" in patch
    ? readWikiRelationships(patch.relationships)
    : existing?.relationships ?? [];
  const audience = "audience" in patch ? readWikiStringList(patch.audience, "audience") : existing?.audience ?? [];
  const aliases = "aliases" in patch ? readWikiStringList(patch.aliases, "aliases") : existing?.aliases ?? [];
  const tags = "tags" in patch ? readWikiStringList(patch.tags, "tags") : existing?.tags ?? [];
  const links = "links" in patch
    ? readWikiStringList(patch.links, "links").map(normalizeWikiSlug).filter(Boolean)
    : existing?.links ?? [];
  const statusValue = readOptionalString(patch.status) ?? existing?.status ?? (categoryValue === "clinical-reference" ? "draft" : "published");
  if (!(WIKI_STATUSES as readonly string[]).includes(statusValue)) {
    throw new HttpError(400, `Invalid wiki status: ${statusValue}`);
  }
  const authorityValue = readOptionalString(patch.authority) ?? existing?.authority ?? defaultWikiAuthority(categoryValue as WikiArticle["category"]);
  if (!(WIKI_AUTHORITIES as readonly string[]).includes(authorityValue)) {
    throw new HttpError(400, `Invalid wiki authority: ${authorityValue}`);
  }
  const sourceRefs = "sourceRefs" in patch ? readWikiSourceReferences(patch.sourceRefs) : existing?.sourceRefs ?? [];
  const owner = "owner" in patch ? readOptionalString(patch.owner) : existing?.owner;
  const reviewedBy = "reviewedBy" in patch ? readOptionalString(patch.reviewedBy) : existing?.reviewedBy;
  const reviewedAt = "reviewedAt" in patch ? readOptionalWikiDate(patch.reviewedAt) : existing?.reviewedAt;
  const reviewDueAt = "reviewDueAt" in patch ? readOptionalWikiDate(patch.reviewDueAt) : existing?.reviewDueAt;
  const supersedes = "supersedes" in patch
    ? readWikiStringList(patch.supersedes, "supersedes").map(normalizeWikiSlug).filter(Boolean)
    : existing?.supersedes ?? [];
  if (
    statusValue === "published" &&
    (authorityValue === "institutional-policy" || authorityValue === "attending-preference" || authorityValue === "educational-template") &&
    (!owner || !reviewedBy || !reviewedAt || !sourceRefs.length)
  ) {
    throw new HttpError(400, "Published clinical knowledge requires owner, reviewedBy, reviewedAt, and at least one source reference");
  }
  assertNoPhiWikiText([title, summary, body, ...aliases, ...tags].join("\n"));
  const normalized = normalizeWikiArticles([{
    id: existing?.id ?? createId("wiki"),
    slug,
    title,
    summary,
    body,
    category: categoryValue as WikiArticle["category"],
    kind: kindValue as WikiArticleKind | undefined,
    scope,
    relationships,
    audience,
    aliases,
    tags,
    links,
    status: statusValue as WikiStatus,
    authority: authorityValue as WikiAuthority,
    revision: existing?.revision ?? 1,
    contentHash: existing?.contentHash ?? "",
    sourceRefs,
    owner,
    reviewedBy,
    reviewedAt,
    reviewDueAt,
    supersedes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    updatedBy: user?.displayName || user?.username
  }])[0];
  if (!normalized) throw new HttpError(400, "Wiki article is invalid");
  return {
    ...normalized,
    revision: existing && normalized.contentHash !== existing.contentHash ? existing.revision + 1 : existing?.revision ?? 1
  };
}

function readWikiStringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new HttpError(400, `${field} must be an array of strings`);
  return value.map((item, index) => {
    const text = readOptionalString(item);
    if (!text) throw new HttpError(400, `${field}[${index}] must be a non-empty string`);
    return text;
  });
}

function readWikiArticleScope(value: unknown): WikiArticleScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "scope must be an object");
  }
  const input = value as Record<string, unknown>;
  const phases = readOptionalStringArray(input.phases, "scope.phases");
  for (const phase of phases) {
    if (!(WIKI_CLINICAL_PHASES as readonly string[]).includes(phase)) {
      throw new HttpError(400, `Invalid clinical phase: ${phase}`);
    }
  }
  return {
    services: readOptionalStringArray(input.services, "scope.services"),
    attendings: readOptionalStringArray(input.attendings, "scope.attendings"),
    procedures: readOptionalStringArray(input.procedures, "scope.procedures"),
    hospitals: readOptionalStringArray(input.hospitals, "scope.hospitals"),
    phases: phases as WikiArticleScope["phases"],
    patientPopulations: readOptionalStringArray(input.patientPopulations, "scope.patientPopulations")
  };
}

function readWikiRelationships(value: unknown): WikiArticleRelationship[] {
  return readOptionalObjectArray(value, "relationships").map((item, index) => {
    const type = readOptionalString(item.type);
    const target = normalizeWikiSlug(readOptionalString(item.target) ?? "");
    if (!type || !(WIKI_RELATIONSHIP_TYPES as readonly string[]).includes(type)) {
      throw new HttpError(400, `relationships[${index}].type is invalid`);
    }
    if (!target) throw new HttpError(400, `relationships[${index}].target is required`);
    return { type: type as WikiArticleRelationship["type"], target, note: readOptionalString(item.note) };
  });
}

function readWikiSourceReferences(value: unknown): WikiSourceReference[] {
  if (!Array.isArray(value)) throw new HttpError(400, "sourceRefs must be an array");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new HttpError(400, `sourceRefs[${index}] must be an object`);
    }
    const input = item as Record<string, unknown>;
    const sourceId = readOptionalString(input.sourceId);
    if (!sourceId) throw new HttpError(400, `sourceRefs[${index}].sourceId is required`);
    return {
      sourceId,
      locator: readOptionalString(input.locator),
      supports: readOptionalString(input.supports)
    };
  });
}

function defaultWikiAuthority(category: WikiArticle["category"]): WikiAuthority {
  if (category === "workflow") return "workflow";
  if (category === "clinical-reference") return "institutional-policy";
  return "program-reference";
}

function assertNoPhiWikiText(value: string): void {
  const explicitPhiPatterns = [
    /\b(?:patient name|mrn|medical record number)\s*[:#-]\s*[a-z0-9-]{3,}/i,
    /\b(?:dob|date of birth)\s*[:#-]\s*\d{1,2}[/-]\d{1,2}[/-](?:\d{2}|\d{4})\b/i
  ];
  if (explicitPhiPatterns.some((pattern) => pattern.test(value))) {
    throw new HttpError(400, "Wiki article appears to contain PHI; store only general institutional knowledge");
  }
}

function readOptionalWikiDate(value: unknown): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, "reviewedAt must use YYYY-MM-DD format");
  }
  return value;
}

function readRequestedTemporaryPassword(body: unknown): string | undefined {
  if (!body || typeof body !== "object" || !("temporaryPassword" in body)) return undefined;
  const temporaryPassword = readOptionalString((body as { temporaryPassword?: unknown }).temporaryPassword);
  if (!temporaryPassword) throw new HttpError(400, "temporaryPassword must be a non-empty string");
  if (temporaryPassword.length < 4) throw new HttpError(400, "Temporary password must be at least 4 characters");
  return temporaryPassword;
}

function readChatModelSettingsPatch(body: unknown): Partial<ChatModelSettings> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Chat settings must be an object");
  }
  const input = body as Record<string, unknown>;
  const patch: Partial<ChatModelSettings> = {};
  if ("chatProvider" in input) {
    const chatProvider = readRequiredString(input.chatProvider, "chatProvider");
    if (chatProvider !== "openai" && chatProvider !== "openrouter") {
      throw new HttpError(400, "chatProvider must be openai or openrouter");
    }
    patch.chatProvider = chatProvider;
  }
  if ("primaryModel" in input) patch.primaryModel = readRequiredString(input.primaryModel, "primaryModel");
  if ("fallbackModels" in input) {
    if (!Array.isArray(input.fallbackModels)) throw new HttpError(400, "fallbackModels must be an array");
    patch.fallbackModels = input.fallbackModels.map((model, index) =>
      readRequiredString(model, `fallbackModels[${index}]`)
    );
  }
  if ("transcriptionModel" in input) {
    patch.transcriptionModel = readRequiredString(input.transcriptionModel, "transcriptionModel");
  }
  if ("voiceModel" in input) patch.voiceModel = readRequiredString(input.voiceModel, "voiceModel");
  if ("voiceName" in input) patch.voiceName = readRequiredString(input.voiceName, "voiceName");
  if ("elevenLabsModel" in input) {
    patch.elevenLabsModel = readRequiredString(input.elevenLabsModel, "elevenLabsModel");
  }
  if ("elevenLabsVoiceIds" in input) {
    if (!Array.isArray(input.elevenLabsVoiceIds) || input.elevenLabsVoiceIds.length !== 5) {
      throw new HttpError(400, "elevenLabsVoiceIds must contain exactly 5 voice ids");
    }
    patch.elevenLabsVoiceIds = input.elevenLabsVoiceIds.map((voiceId, index) =>
      readRequiredString(voiceId, `elevenLabsVoiceIds[${index}]`)
    ) as [string, string, string, string, string];
  }
  if (Object.keys(patch).length === 0) {
    throw new HttpError(
      400,
      "Provide chatProvider, primaryModel, fallbackModels, transcriptionModel, voiceModel, voiceName, elevenLabsModel, or elevenLabsVoiceIds"
    );
  }
  return patch;
}

function isChatProviderConfigured(settings: ChatModelSettings): boolean {
  return settings.chatProvider === "openai"
    ? Boolean(process.env.OPENAI_API_KEY)
    : Boolean(process.env.OPENROUTER_API_KEY);
}

function readVoicePreset(value: unknown): VoicePreset {
  const preset = value === undefined ? 1 : Number(value);
  if (!Number.isInteger(preset) || preset < 1 || preset > 5) {
    throw new HttpError(400, "voicePreset must be 1, 2, 3, 4, or 5");
  }
  return preset as VoicePreset;
}

function readRequiredString(value: unknown, field: string): string {
  const normalized = readOptionalString(value);
  if (!normalized) throw new HttpError(400, `${field} is required`);
  return normalized;
}

function readDirectoryContact(input: unknown, createdBy: string | undefined, now: string): DirectoryContact {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Contact input must be an object");
  }
  const value = input as Record<string, unknown>;
  const name = readRequiredString(value.name, "Contact name");
  const phoneNumber = readRequiredString(value.phoneNumber, "Phone number");
  const category = readRequiredString(value.category, "Category");
  const directoryTypeValue = readOptionalString(value.directoryType) ?? "Hospital";
  if (directoryTypeValue !== "Hospital" && directoryTypeValue !== "Residents" && directoryTypeValue !== "Faculty & Staff") {
    throw new HttpError(400, "Directory type must be Hospital, Residents, or Faculty & Staff");
  }
  const alternatePhoneNumbers = readOptionalStringArray(value.alternatePhoneNumbers, "Alternate phone numbers");
  const aliases = readOptionalStringArray(value.aliases, "Aliases");
  const facilityValue = directoryTypeValue === "Hospital" ? readOptionalString(value.facility) ?? "RMH" : undefined;
  if (facilityValue && !HOSPITAL_CONTACT_FACILITIES.includes(facilityValue as HospitalContactFacility)) {
    throw new HttpError(400, `Facility must be one of ${HOSPITAL_CONTACT_FACILITIES.join(", ")}`);
  }
  const building = directoryTypeValue === "Hospital" ? readOptionalString(value.building) : undefined;
  const importanceValue = directoryTypeValue === "Hospital" ? readOptionalString(value.importance) ?? "extended" : undefined;
  if (importanceValue && importanceValue !== "essential" && importanceValue !== "extended") {
    throw new HttpError(400, "Importance must be essential or extended");
  }
  const organization = readOptionalString(value.organization) ?? (
    directoryTypeValue === "Residents"
      ? "Carilion Clinic General Surgery Residency"
      : directoryTypeValue === "Faculty & Staff"
        ? "Carilion Clinic Department of Surgery"
        : "Hospital Directory"
  );
  if (name.length > 120 || category.length > 80 || organization.length > 120 || (building?.length ?? 0) > 120) {
    throw new HttpError(400, "Contact name, category, organization, or building is too long");
  }
  if (aliases.some((alias) => alias.length > 120)) {
    throw new HttpError(400, "Each contact alias must be 120 characters or fewer");
  }
  const digits = phoneNumber.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) {
    throw new HttpError(400, "Phone number must contain 7 to 15 digits");
  }
  if (alternatePhoneNumbers.some((alternate) => {
    const alternateDigits = alternate.replace(/\D/g, "");
    return alternateDigits.length < 7 || alternateDigits.length > 15;
  })) {
    throw new HttpError(400, "Each alternate phone number must contain 7 to 15 digits");
  }
  return {
    id: createId("contact"),
    name,
    phoneNumber,
    alternatePhoneNumbers: alternatePhoneNumbers.length ? alternatePhoneNumbers : undefined,
    aliases: aliases.length ? aliases : undefined,
    category,
    directoryType: directoryTypeValue,
    facility: facilityValue as HospitalContactFacility | undefined,
    building,
    importance: importanceValue as "essential" | "extended" | undefined,
    organization,
    createdAt: now,
    updatedAt: now,
    createdBy
  };
}

function readDirectoryContactUpdate(input: unknown, existing: DirectoryContact, now: string): DirectoryContact {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new HttpError(400, "Contact input must be an object");
  }
  const replacement = readDirectoryContact(
    { ...existing, ...(input as Record<string, unknown>) },
    existing.createdBy,
    now
  );
  return { ...replacement, id: existing.id, createdAt: existing.createdAt, createdBy: existing.createdBy, updatedAt: now };
}

function assertContactIsUnique(
  state: PlannerState,
  contact: DirectoryContact,
  ignoredRequestId?: string,
  ignoredContactId?: string
): void {
  const phone = contact.phoneNumber.replace(/\D/g, "");
  const sameContact = (candidate: DirectoryContact) =>
    candidate.phoneNumber.replace(/\D/g, "") === phone && candidate.name.trim().toLowerCase() === contact.name.trim().toLowerCase();
  if (state.contacts.some((candidate) => candidate.id !== ignoredContactId && sameContact(candidate))) {
    throw new HttpError(409, "This contact is already in the directory");
  }
  if (state.contactRequests.some((request) => request.id !== ignoredRequestId && request.status === "pending" && sameContact(request.contact))) {
    throw new HttpError(409, "This contact already has a pending request");
  }
}

function requireContactRequest(state: PlannerState, id: string): ContactRequest {
  const contactRequest = state.contactRequests.find((item) => item.id === id);
  if (!contactRequest) throw new HttpError(404, "Contact request not found");
  return contactRequest;
}

function normalizeAliasList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];
  return [...new Set(values.map((alias) => readOptionalString(alias)).filter((alias): alias is string => Boolean(alias)))];
}

function compareCoverageEntries(a: CoverageEntry, b: CoverageEntry): number {
  const kindOrder: Record<CoverageKind, number> = { call: 0, "attending-call": 1, rounding: 2, off: 3, note: 4 };
  return (
    a.date.localeCompare(b.date) ||
    kindOrder[a.kind] - kindOrder[b.kind] ||
    getCoverageEntryPositionRank(a) - getCoverageEntryPositionRank(b) ||
    a.id.localeCompare(b.id)
  );
}

function getCoverageEntryPositionRank(entry: CoverageEntry): number {
  if (entry.kind !== "call") return 0;
  if (entry.callPosition) return CALL_POSITIONS.indexOf(entry.callPosition);
  if (isSccCallNote(entry.note)) return CALL_POSITIONS.length + 1;
  return CALL_POSITIONS.length;
}

function describeCoverageRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  if (isAssignmentChangeRequest(coverageRequest)) {
    const change = coverageRequest.requestedAssignmentChange;
    const surgeryCase = change ? state.cases.find((candidate) => candidate.id === change.targetId) : undefined;
    const resident = change?.residentId ? state.residents.find((candidate) => candidate.id === change.residentId) : undefined;
    return `${capitalize(coverageRequest.action)} case coverage${resident ? ` for ${resident.name}` : ""}${surgeryCase ? ` on ${surgeryCase.procedureLabel}` : ""}`;
  }

  if (isCaseOrderChangeRequest(coverageRequest)) {
    const change = coverageRequest.requestedCaseOrderChange;
    const surgeryCase = change ? state.cases.find((candidate) => candidate.id === change.caseId) : undefined;
    return `Move ${surgeryCase?.procedureLabel ?? "OR case"} to case #${change?.order ?? "?"}`;
  }

  if (isClinicSessionChangeRequest(coverageRequest)) {
    const change = coverageRequest.requestedClinicSessionChange;
    const clinic = change ? state.clinicSessions.find((candidate) => candidate.id === change.clinicId) : undefined;
    const attending = clinic?.attendingId
      ? state.attendings.find((candidate) => candidate.id === clinic.attendingId)
      : undefined;
    const time = clinic && change
      ? `${clinic.startTime}-${clinic.endTime} to ${change.startTime ?? clinic.startTime}-${change.endTime ?? clinic.endTime}`
      : "requested times";
    const type = change?.isProcedure === undefined
      ? ""
      : ` and make it a ${change.isProcedure ? "procedure clinic" : "clinic"}`;
    return `Update ${attending?.name ?? clinic?.service ?? "clinic session"} on ${clinic?.date ?? "the scheduled date"} from ${time}${type}`;
  }

  if (isResidentProfileRequest(coverageRequest)) {
    return describeResidentProfileRequest(state, coverageRequest);
  }

  if (isResidentVacationRequest(coverageRequest)) {
    return describeResidentVacationRequest(state, coverageRequest);
  }

  if (isResidentTradeRequest(coverageRequest)) {
    return describeResidentTradeRequest(state, coverageRequest);
  }

  if (coverageRequest.action === "delete") {
    const entry = coverageRequest.entryId
      ? state.coverageEntries.find((candidate) => candidate.id === coverageRequest.entryId)
      : undefined;
    return entry ? `Delete ${describeCoverageEntry(state, entry)}` : "Delete calendar entry";
  }

  if (coverageRequest.requestedEntry) {
    return `${capitalize(coverageRequest.action)} ${describeCoverageEntry(state, coverageRequest.requestedEntry)}`;
  }

  return "Coverage calendar request";
}

function getApprovedCoverageRequestActivity(coverageRequest: CoverageChangeRequest): string {
  if (isAssignmentChangeRequest(coverageRequest)) return "approved case coverage request";
  if (isCaseOrderChangeRequest(coverageRequest)) return "approved case order request";
  if (isClinicSessionChangeRequest(coverageRequest)) return "approved clinic session request";
  if (isResidentProfileRequest(coverageRequest)) return "approved resident profile request";
  if (isResidentVacationRequest(coverageRequest)) return "approved resident vacation request";
  if (isResidentTradeRequest(coverageRequest)) return "accepted resident call trade";
  return "approved call calendar request";
}

function getDeniedCoverageRequestActivity(coverageRequest: CoverageChangeRequest): string {
  if (isAssignmentChangeRequest(coverageRequest)) return "denied case coverage request";
  if (isCaseOrderChangeRequest(coverageRequest)) return "denied case order request";
  if (isClinicSessionChangeRequest(coverageRequest)) return "denied clinic session request";
  if (isResidentProfileRequest(coverageRequest)) return "denied resident profile request";
  if (isResidentVacationRequest(coverageRequest)) return "denied resident vacation request";
  if (isResidentTradeRequest(coverageRequest)) return "denied resident call trade";
  return "denied call calendar request";
}

function getCoverageRequestActivityType(coverageRequest: CoverageChangeRequest): ActivityInput["activityType"] {
  if (isAssignmentChangeRequest(coverageRequest) || isCaseOrderChangeRequest(coverageRequest)) return "assignment";
  if (isResidentProfileRequest(coverageRequest)) return "account";
  if (isResidentVacationRequest(coverageRequest)) return "resident";
  return "calendar";
}

function describeResidentProfileRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  const resident = coverageRequest.targetResidentId
    ? state.residents.find((candidate) => candidate.id === coverageRequest.targetResidentId)
    : undefined;
  return `Update profile for ${resident?.name ?? coverageRequest.requesterName ?? "resident"}`;
}

function describeResidentVacationRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  const resident = coverageRequest.targetResidentId
    ? state.residents.find((candidate) => candidate.id === coverageRequest.targetResidentId)
    : undefined;
  const vacation = coverageRequest.requestedResidentVacation?.vacation ?? [];
  const dates = vacation.map((block) => `${block.startDate} to ${block.endDate}`).join(", ");
  return `Update vacation for ${resident?.name ?? coverageRequest.requesterName ?? "resident"}${dates ? ` (${dates})` : ""}`;
}

function describeResidentTradeRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  const requester = coverageRequest.requesterResidentId
    ? state.residents.find((resident) => resident.id === coverageRequest.requesterResidentId)
    : undefined;
  const target = coverageRequest.targetResidentId
    ? state.residents.find((resident) => resident.id === coverageRequest.targetResidentId)
    : undefined;
  const requesterName = requester?.name ?? coverageRequest.requesterName ?? "Requester";
  const targetName = target?.name ?? "requested resident";
  const source = coverageRequest.requestedEntry
    ? `${requesterName} ${coverageRequest.requestedEntry.kind} on ${coverageRequest.requestedEntry.date} to ${targetName}`
    : "Resident call trade";
  if (!coverageRequest.swapRequestedEntry) return source;
  return `${source}; ${targetName} ${coverageRequest.swapRequestedEntry.kind} on ${coverageRequest.swapRequestedEntry.date} to ${requesterName}`;
}

function describeCoverageEntry(state: PlannerState, entry: CoverageEntry): string {
  if (entry.kind === "attending-call") {
    const dayName = state.attendings.find((attending) => attending.id === entry.dayAttendingId)?.name ?? "Unknown attending";
    const nightName = state.attendings.find((attending) => attending.id === entry.nightAttendingId)?.name ?? "Unknown attending";
    const coverage = dayName === nightName ? `${dayName} all day` : `${dayName} day / ${nightName} night`;
    return `Attending call on ${entry.date}: ${coverage}`;
  }
  const residentName = entry.residentId
    ? state.residents.find((resident) => resident.id === entry.residentId)?.name ?? "Unknown resident"
    : "General";
  const note = entry.note ? ` (${entry.note})` : "";
  return `${residentName} ${formatCoverageKindLabel(entry).toLowerCase()} on ${entry.date}${note}`;
}

function formatCoverageKindLabel(entry: CoverageEntry): string {
  if (entry.kind === "call" && entry.callPosition) return `${formatCallPositionLabel(entry.callPosition)} call`;
  return capitalize(entry.kind);
}

function formatCallPositionLabel(callPosition: CallPosition): string {
  return callPosition === "mid-level" ? "Mid-level" : capitalize(callPosition);
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function filterStateForUser(
  state: PlannerState,
  user: SessionUser | undefined,
  options: { includeWikiSources?: boolean } = {}
): PlannerState {
  if (!user || user.role === "admin") return state;
  const linkedResident = findResidentForUser(state, user);
  const wikiArticles = state.wikiArticles.filter((article) => article.status === "published");
  const visibleSourceIds = new Set(wikiArticles.flatMap((article) => article.sourceRefs.map((reference) => reference.sourceId)));
  return {
    ...state,
    wikiArticles,
    wikiSources: options.includeWikiSources
      ? state.wikiSources.filter((source) => visibleSourceIds.has(source.id))
      : [],
    wikiChanges: [],
    callOffRequests: hasCallBuilderAccess(user)
      ? state.callOffRequests
      : state.callOffRequests.filter((request) => request.requesterUsername === user.username || request.residentId === linkedResident?.id),
    callScheduleDrafts: hasCallBuilderAccess(user) ? state.callScheduleDrafts : [],
    coverageRequests: state.coverageRequests.filter((coverageRequest) => canSeeCoverageRequest(state, user, coverageRequest)),
    contactRequests: state.contactRequests.filter((contactRequest) => contactRequest.requesterUsername === user.username),
    goldStarAwards: state.goldStarAwards.map((award) =>
      award.giverUsername === user.username || Boolean(linkedResident && award.giverResidentId === linkedResident.id)
        ? award
        : { ...award, giverResidentId: undefined, giverUsername: undefined }
    ),
    activityEvents: []
  };
}

function canSeeCoverageRequest(state: PlannerState, user: SessionUser, coverageRequest: CoverageChangeRequest): boolean {
  if (coverageRequest.requesterUsername === user.username) return true;
  if (coverageRequestInvolvesUserResident(state, user, coverageRequest)) return true;
  if (hasServicePrivilege(user, coverageRequest.serviceLine, "edit")) return true;
  return !coverageRequest.serviceLine && hasAnyEditPrivilege(user);
}

function canResolveCoverageRequest(
  state: PlannerState,
  user: SessionUser | undefined,
  coverageRequest: CoverageChangeRequest
): boolean {
  if (isResidentProfileRequest(coverageRequest) || isResidentVacationRequest(coverageRequest)) {
    return user?.role === "admin";
  }
  if (isResidentTradeRequest(coverageRequest) && coverageRequestTargetsUserResident(state, user, coverageRequest)) {
    return true;
  }
  return hasServicePrivilege(user, coverageRequest.serviceLine, "edit");
}

function getCoverageRequestResolveError(coverageRequest: CoverageChangeRequest): string {
  if (isResidentProfileRequest(coverageRequest)) return "Admin approval required for resident profile requests";
  if (isResidentVacationRequest(coverageRequest)) return "Admin approval required for resident vacation requests";
  return isResidentTradeRequest(coverageRequest)
    ? "Only the requested resident or a service editor can resolve this trade request"
    : "Edit privilege required for this service";
}

function isResidentProfileRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "resident-profile";
}

function isResidentVacationRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "resident-vacation";
}

function isResidentTradeRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "resident-trade";
}

function isAssignmentChangeRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "assignment-change";
}

function isCaseOrderChangeRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "case-order-change";
}

function isClinicSessionChangeRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "clinic-session-change";
}

function coverageRequestTargetsUserResident(
  state: PlannerState,
  user: SessionUser | undefined,
  coverageRequest: CoverageChangeRequest
): boolean {
  const resident = findResidentForUser(state, user);
  return Boolean(resident && coverageRequest.targetResidentId === resident.id);
}

function coverageRequestInvolvesUserResident(
  state: PlannerState,
  user: SessionUser | undefined,
  coverageRequest: CoverageChangeRequest
): boolean {
  const resident = findResidentForUser(state, user);
  return Boolean(
    resident &&
    (coverageRequest.requesterResidentId === resident.id ||
      coverageRequest.targetResidentId === resident.id ||
      coverageRequest.requestedResidentProfile?.residentId === resident.id ||
      coverageRequest.requestedResidentVacation?.residentId === resident.id ||
      coverageRequest.requestedAssignmentChange?.residentId === resident.id ||
      coverageRequest.requestedEntry?.residentId === resident.id ||
      coverageRequest.swapRequestedEntry?.residentId === resident.id)
  );
}

function coverageRequestReferencesResident(coverageRequest: CoverageChangeRequest, residentId: string): boolean {
  return (
    coverageRequest.requesterResidentId === residentId ||
    coverageRequest.targetResidentId === residentId ||
    coverageRequest.requestedResidentProfile?.residentId === residentId ||
    coverageRequest.requestedResidentVacation?.residentId === residentId ||
    coverageRequest.requestedAssignmentChange?.residentId === residentId ||
    coverageRequest.requestedEntry?.residentId === residentId ||
    coverageRequest.swapRequestedEntry?.residentId === residentId
  );
}

function hasAnyEditPrivilege(user: SessionUser): boolean {
  return Object.values(user.servicePrivileges).some((privilege) => privilege === "edit");
}

function readServiceLine(req: AuthenticatedRequest): string | undefined {
  return readOptionalString(req.body?.serviceLine) ?? readOptionalString(req.query.service);
}

function getCoverageEntryServiceLine(entry: CoverageEntry, fallbackServiceLine: string | undefined): string | undefined {
  return entry.serviceLine ?? fallbackServiceLine;
}

function getCoverageRequestServiceLines(
  state: PlannerState,
  request: CoverageChangeRequest,
  fallbackServiceLine: string | undefined
): string[] {
  const existing = request.entryId ? state.coverageEntries.find((entry) => entry.id === request.entryId) : undefined;
  const services = [
    existing ? getCoverageEntryServiceLine(existing, fallbackServiceLine) : undefined,
    request.requestedEntry ? getCoverageEntryServiceLine(request.requestedEntry, fallbackServiceLine) : undefined,
    request.serviceLine ?? fallbackServiceLine
  ].filter((service): service is string => Boolean(service));
  return [...new Set(services)];
}

function getAssignmentTargetServiceLine(state: PlannerState, kind: unknown, targetId: unknown): string {
  if (typeof targetId !== "string") throw new Error("Assignment targetId is required");
  if (kind === "case") {
    const surgeryCase = state.cases.find((candidate) => candidate.id === targetId);
    if (!surgeryCase) throw new Error(`Case not found: ${targetId}`);
    return getBlockServiceLine(state, surgeryCase.blockId);
  }
  if (kind === "block") {
    return getBlockServiceLine(state, targetId);
  }
  if (kind === "clinic") {
    const clinic = state.clinicSessions.find((candidate) => candidate.id === targetId);
    if (!clinic) throw new Error(`Clinic not found: ${targetId}`);
    return clinic.service;
  }
  throw new Error("Invalid assignment kind");
}

function getAssignmentTargetDate(state: PlannerState, kind: unknown, targetId: unknown): string {
  if (typeof targetId !== "string") throw new Error("Assignment targetId is required");
  if (kind === "case") {
    const surgeryCase = state.cases.find((candidate) => candidate.id === targetId);
    if (!surgeryCase) throw new Error(`Case not found: ${targetId}`);
    return getAssignmentTargetDate(state, "block", surgeryCase.blockId);
  }
  if (kind === "block") {
    const block = state.attendingBlocks.find((candidate) => candidate.id === targetId);
    if (!block) throw new Error(`Block not found: ${targetId}`);
    return block.date;
  }
  if (kind === "clinic") {
    const clinic = state.clinicSessions.find((candidate) => candidate.id === targetId);
    if (!clinic) throw new Error(`Clinic not found: ${targetId}`);
    return clinic.date;
  }
  throw new Error("Invalid assignment kind");
}

function assertResidentAvailableForAssignment(state: PlannerState, kind: unknown, targetId: unknown, residentId: unknown): void {
  if (kind !== "case" && kind !== "block") return;
  assertResidentAvailableForWork(state, residentId, getAssignmentTargetDate(state, kind, targetId), "case");
}

function assertMedicalStudentSelfAssignment(state: PlannerState, user: SessionUser | undefined, input: Record<string, unknown>): void {
  if (input.kind !== "case" && input.kind !== "clinic") {
    throw new HttpError(403, "Medical students can add themselves to cases or clinics only");
  }
  if (readOptionalString(input.manualMedicalStudentName)) {
    throw new HttpError(403, "Medical students can only add their own linked profile");
  }
  if (input.locked) {
    throw new HttpError(403, "Medical student self-assignments cannot be locked");
  }

  const resident = findResidentForUser(state, user);
  if (!resident || resident.trainingLevel !== "Medical Student" || input.residentId !== resident.id) {
    throw new HttpError(403, "Medical students can only add themselves");
  }

  if (input.kind === "case") {
    const surgeryCase = state.cases.find((candidate) => candidate.id === input.targetId);
    const directAssignmentCount = state.assignments.filter(
      (assignment) => assignment.kind === "case" && assignment.targetId === input.targetId
    ).length;
    const hasBlockAssignment = Boolean(
      surgeryCase && state.assignments.some((assignment) => assignment.kind === "block" && assignment.targetId === surgeryCase.blockId)
    );
    if (directAssignmentCount + Number(hasBlockAssignment) >= 2) {
      throw new HttpError(400, "This case already has its maximum of two assigned people");
    }
    return;
  }

  const clinic = state.clinicSessions.find((candidate) => candidate.id === input.targetId);
  const assignedCount = state.assignments.filter(
    (assignment) => assignment.kind === "clinic" && assignment.targetId === input.targetId
  ).length;
  if (clinic && assignedCount >= Math.max(1, clinic.capacity)) {
    throw new HttpError(400, "This clinic is already at capacity");
  }
}

function assertMedicalStudentAssignmentKind(state: PlannerState, kind: unknown, residentId: unknown): void {
  if (typeof residentId !== "string") return;
  const resident = state.residents.find((candidate) => candidate.id === residentId);
  if (resident?.trainingLevel === "Medical Student" && kind !== "case" && kind !== "clinic") {
    throw new HttpError(400, "Medical students can be assigned to cases or clinics only");
  }
}

function findOrCreateManualMedicalStudent(
  state: PlannerState,
  inputName: string
): { resident: Resident; created: boolean } {
  const name = inputName.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 100) {
    throw new HttpError(400, "Medical student name must be 2-100 characters");
  }
  const normalizedName = normalizePersonLookupName(name);
  const existing = state.residents.find(
    (resident) => resident.trainingLevel === "Medical Student" && normalizePersonLookupName(resident.name) === normalizedName
  );
  if (existing) return { resident: existing, created: false };

  return {
    created: true,
    resident: {
      id: createId("res_med_student"),
      name,
      aliases: [],
      trainingLevel: "Medical Student",
      designation: "resident",
      rosterKind: "off-service",
      sourceProgram: "Medical Student",
      sourceProgramAbbreviation: "MS",
      accountEligible: false,
      serviceTags: [],
      serviceStatus: "off-service",
      color: "#64748b",
      tags: ["manual-medical-student"],
      trainingInterests: [],
      unavailable: [],
      vacation: [],
      rotationSchedule: []
    }
  };
}

function normalizePersonLookupName(value: string): string {
  return value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function assertResidentAvailableForWork(state: PlannerState, residentId: unknown, date: string, workLabel: "case" | "rounding"): void {
  if (typeof residentId !== "string") throw new Error("Resident is required");
  const resident = state.residents.find((candidate) => candidate.id === residentId);
  if (!resident) throw new HttpError(400, `Unknown resident: ${residentId}`);
  const timeOff = getResidentTimeOff(state, resident, date);
  if (timeOff) {
    throw new HttpError(400, `${resident.name} cannot be assigned to ${workLabel} on ${date}: ${timeOff.description}`);
  }
}

function getBlockServiceLine(state: PlannerState, blockId: string): string {
  const block = state.attendingBlocks.find((candidate) => candidate.id === blockId);
  if (!block) throw new Error(`Block not found: ${blockId}`);
  const attending = state.attendings.find((candidate) => candidate.id === block.attendingId);
  if (!attending) throw new Error(`Attending not found: ${block.attendingId}`);
  return attending.service;
}

function getParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}
