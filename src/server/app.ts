import cors from "cors";
import express from "express";
import path from "node:path";
import { URL } from "node:url";
import { isCoverageKindAllowedOnDate } from "../shared/coverage";
import { addDays, minutesToTime, timeToMinutes } from "../shared/date";
import { createId } from "../shared/id";
import {
  addActivity,
  applyClaim,
  applySuggestion,
  buildUncoveredMessage,
  buildWeekSchedule,
  collectWarnings,
  formatClinicLabel,
  makeAssignment
} from "../shared/scheduler";
import {
  ClaimRequest,
  CollectionName,
  CoverageChangeRequest,
  CoverageEntry,
  CoverageKind,
  CoverageRequestAction,
  PlannerState,
  Resident,
  ResidentProfileChange,
  SessionUser
} from "../shared/types";
import {
  AuthenticatedRequest,
  authenticate,
  createToken,
  requireAdmin,
  requirePasswordReady,
  requireSessionAdmin,
  requireServiceEdit,
  requireServiceRequest,
  validateLogin
} from "./auth";
import { getOpenApiDocument } from "./openapi";
import { StateConflictError, StateStore } from "./store";
import { UserStore, createDefaultUserStore, hasServicePrivilege } from "./userStore";

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

export function createApp(store: StateStore, options: { userStore?: UserStore } = {}) {
  const app = express();
  const userStore = options.userStore ?? createDefaultUserStore();
  const requireAuth = authenticate(userStore);
  const loginLimiter = createRateLimiter(8, 15 * 60 * 1000);
  const stateSubscribers = new Set<express.Response>();

  app.set("trust proxy", 1);
  app.use(securityHeaders);
  app.use(cors(getCorsOptions()));
  app.use(express.json({ limit: "1mb" }));

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
      res.json({ token: createToken(user), ...user });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/session", requireAuth, (req: AuthenticatedRequest, res) => {
    res.json(req.user);
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

  app.get("/api/users", requireAuth, requireSessionAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json({ users: await userStore.listUsers() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users", requireAuth, requireSessionAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const created = await userStore.createUser(req.body);
      res.status(201).json({ ...created, users: await userStore.listUsers() });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/users/bulk", requireAuth, requireSessionAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const users = Array.isArray(req.body.users) ? req.body.users : [];
      const created = await userStore.createUsers(users);
      res.status(201).json({ created, users: await userStore.listUsers() });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/:username", requireAuth, requireSessionAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const user = await userStore.updateUser(getParam(req.params.username), {
        displayName: readOptionalString(req.body.displayName),
        role: req.body.role === "admin" ? "admin" : req.body.role === "viewer" ? "viewer" : undefined,
        servicePrivileges: req.body.servicePrivileges
      });
      res.json({ user, users: await userStore.listUsers() });
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/users/:username/password", requireAuth, requireSessionAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const reset = await userStore.resetPassword(getParam(req.params.username));
      res.json({ ...reset, users: await userStore.listUsers() });
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/users/:username", requireAuth, requireSessionAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      await userStore.deleteUser(getParam(req.params.username));
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
      res.json({ token: createToken(user), ...user });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/state", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      res.json(filterStateForUser(await store.load(), req.user));
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
        req.user?.role ?? "admin",
        readOptionalString(req.query.service)
      );
      res.json(await commitState(req, nextState));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/entities/:collection", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const state = await store.load();
      const entity = req.body;
      assertNoPhiInEntity(collection, entity);
      const nextState = {
        ...state,
        [collection]: [...state[collection], entity]
      } as PlannerState;
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "created item", `Created ${collection}`, collection, entity.id);
      res.status(201).json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/entities/:collection/:id", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const id = getParam(req.params.id);
      const state = await store.load();
      assertNoPhiInEntity(collection, req.body);
      const nextState = {
        ...state,
        [collection]: state[collection].map((entity) => (entity.id === id ? { ...entity, ...req.body, id } : entity))
      } as PlannerState;
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "updated item", `Updated ${collection}`, collection, id);
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/entities/:collection/:id", requireAuth, requirePasswordReady, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const id = getParam(req.params.id);
      const state = await store.load();
      const nextState = collection === "weeks" ? deleteWeek(state, id) : deleteEntityFromCollection(state, collection, id);
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "deleted item", `Deleted ${collection}`, collection, id);
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assignments", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const serviceLine = getAssignmentTargetServiceLine(state, req.body.kind, req.body.targetId);
      if (!requireServiceEdit(req, res, serviceLine)) return;
      requireResident(state, req.body.residentId);
      const assignment = makeAssignment(req.body.kind, req.body.targetId, req.body.residentId, "admin", Boolean(req.body.locked));
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
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "assigned resident", "Manual assignment updated", assignment.kind, assignment.targetId);
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
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "updated assignment", "Assignment lock or resident changed", "assignment", id);
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
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "removed assignment", "Assignment cleared", "assignment", id);
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-entries", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const serviceLine = readServiceLine(req);
      if (!requireServiceEdit(req, res, serviceLine)) return;
      const entry = buildCoverageEntry(state, req.body);
      const nextState = upsertCoverageEntry(state, entry);
      const withActivity = addActivity(
        nextState,
        req.user?.role ?? "admin",
        "updated call calendar",
        `Set ${describeCoverageEntry(nextState, entry)}`,
        "coverageEntry",
        entry.id
      );
      res.status(201).json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/coverage-entries/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const serviceLine = readServiceLine(req);
      if (!requireServiceEdit(req, res, serviceLine)) return;
      const existing = requireCoverageEntry(state, id);
      const entry = buildCoverageEntry(state, { ...existing, ...req.body, id }, existing);
      const nextState = upsertCoverageEntry(state, entry);
      const withActivity = addActivity(
        nextState,
        req.user?.role ?? "admin",
        "updated call calendar",
        `Updated ${describeCoverageEntry(nextState, entry)}`,
        "coverageEntry",
        entry.id
      );
      res.json(await commitState(req, withActivity));
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/coverage-entries/:id", requireAuth, requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const serviceLine = readServiceLine(req);
      if (!requireServiceEdit(req, res, serviceLine)) return;
      const existing = requireCoverageEntry(state, id);
      const nextState: PlannerState = {
        ...state,
        coverageEntries: state.coverageEntries.filter((entry) => entry.id !== id)
      };
      const withActivity = addActivity(
        nextState,
        req.user?.role ?? "admin",
        "updated call calendar",
        `Cleared ${describeCoverageEntry(state, existing)}`,
        "coverageEntry",
        id
      );
      res.json(await commitState(req, withActivity));
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
      if (!isResidentTrade && !isResidentProfile && !requireServiceRequest(req, res, serviceLine)) return;
      const coverageRequest = isResidentTrade
        ? buildResidentTradeRequest(state, req.body, req.user, serviceLine)
        : isResidentProfile
          ? buildResidentProfileRequest(state, req.body, req.user)
          : buildCoverageRequest(state, req.body, req.user, serviceLine);
      const nextState: PlannerState = {
        ...state,
        coverageRequests: [coverageRequest, ...state.coverageRequests]
      };
      const withActivity = addActivity(
        nextState,
        req.user?.role ?? "viewer",
        isResidentTrade
          ? "submitted resident call trade"
          : isResidentProfile
            ? "submitted resident profile request"
            : "submitted call calendar request",
        describeCoverageRequest(nextState, coverageRequest),
        "coverageRequest",
        coverageRequest.id
      );
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
      const withActivity = addActivity(
        nextState,
        req.user?.role ?? "admin",
        getApprovedCoverageRequestActivity(coverageRequest),
        describeCoverageRequest(nextState, coverageRequest),
        "coverageRequest",
        id
      );
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
      const withActivity = addActivity(
        nextState,
        req.user?.role ?? "admin",
        getDeniedCoverageRequestActivity(coverageRequest),
        describeCoverageRequest(nextState, coverageRequest),
        "coverageRequest",
        id
      );
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
      const withActivity = addActivity(
        nextState,
        req.user?.role ?? "admin",
        "removed coverage request",
        describeCoverageRequest(state, coverageRequest),
        "coverageRequest",
        id
      );
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
      const nextState = applyClaim(state, claim);
      res.status(201).json(await commitState(req, nextState));
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

  const clientDist = path.resolve(process.cwd(), "dist/client");
  app.use(express.static(clientDist));
  app.get("*", (_req, res, next) => {
    if (process.env.NODE_ENV !== "production") {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
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
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  });

  return app;
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
        summary: `${capitalize(entry.kind)}${resident ? `: ${resident.name}` : ""}`,
        description: entry.note,
        date: entry.date
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

function normalizeUsername(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function assertCollection(value: string): CollectionName {
  if (!collections.includes(value as CollectionName)) {
    throw new Error(`Unknown collection: ${value}`);
  }
  return value as CollectionName;
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
    coverageEntries: state.coverageEntries.filter((entry) => entry.residentId !== residentId),
    coverageRequests: state.coverageRequests.filter((request) => !coverageRequestReferencesResident(request, residentId))
  };
}

function deleteAttending(state: PlannerState, attendingId: string): PlannerState {
  const blockIds = new Set(state.attendingBlocks.filter((block) => block.attendingId === attendingId).map((block) => block.id));
  const clinicIds = new Set(state.clinicSessions.filter((clinic) => clinic.attendingId === attendingId).map((clinic) => clinic.id));
  return deleteClinics(deleteBlocks({ ...state, attendings: state.attendings.filter((attending) => attending.id !== attendingId) }, blockIds), clinicIds);
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
  const note = readOptionalString(input.note) ?? "";
  assertNoPhiText(note, "coverage note");
  const entry: CoverageEntry = {
    id: readOptionalString(input.id) ?? existing?.id ?? createId("cover"),
    date,
    kind,
    residentId,
    note,
    createdAt: existing?.createdAt ?? readOptionalString(input.createdAt) ?? now,
    updatedAt: now
  };

  validateCoverageEntry(state, entry);
  return entry;
}

function upsertCoverageEntry(state: PlannerState, entry: CoverageEntry): PlannerState {
  const replacesSlot = entry.kind === "call" || entry.kind === "rounding";
  const coverageEntries = state.coverageEntries
    .filter((candidate) => candidate.id !== entry.id)
    .filter((candidate) => !replacesSlot || candidate.date !== entry.date || candidate.kind !== entry.kind);

  return {
    ...state,
    coverageEntries: [...coverageEntries, entry].sort(compareCoverageEntries)
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

function applyCoverageRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): PlannerState {
  if (isResidentProfileRequest(coverageRequest)) {
    return applyResidentProfileRequest(state, coverageRequest);
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
    throw new Error(`${entry.kind} is not allowed on ${entry.date}`);
  }
  if ((entry.kind === "call" || entry.kind === "rounding") && !entry.residentId) {
    throw new Error(`${entry.kind} requires a resident`);
  }
  if (entry.residentId && !state.residents.some((resident) => resident.id === entry.residentId)) {
    throw new Error(`Unknown resident: ${entry.residentId}`);
  }
}

function isTradeableCoverageKind(kind: CoverageKind): boolean {
  return kind === "call" || kind === "rounding";
}

function requireResident(state: PlannerState, residentId: unknown): void {
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

function requireCoverageRequest(state: PlannerState, id: string): CoverageChangeRequest {
  const coverageRequest = state.coverageRequests.find((candidate) => candidate.id === id);
  if (!coverageRequest) throw new Error(`Coverage request not found: ${id}`);
  return coverageRequest;
}

function assertCoverageKind(value: unknown): CoverageKind {
  if (value === "call" || value === "rounding" || value === "off" || value === "note") {
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

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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
  const kindOrder = { call: 0, rounding: 1, off: 2, note: 3 };
  return a.date.localeCompare(b.date) || kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id);
}

function describeCoverageRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  if (isResidentProfileRequest(coverageRequest)) {
    return describeResidentProfileRequest(state, coverageRequest);
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
  if (isResidentProfileRequest(coverageRequest)) return "approved resident profile request";
  if (isResidentTradeRequest(coverageRequest)) return "accepted resident call trade";
  return "approved call calendar request";
}

function getDeniedCoverageRequestActivity(coverageRequest: CoverageChangeRequest): string {
  if (isResidentProfileRequest(coverageRequest)) return "denied resident profile request";
  if (isResidentTradeRequest(coverageRequest)) return "denied resident call trade";
  return "denied call calendar request";
}

function describeResidentProfileRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
  const resident = coverageRequest.targetResidentId
    ? state.residents.find((candidate) => candidate.id === coverageRequest.targetResidentId)
    : undefined;
  return `Update profile for ${resident?.name ?? coverageRequest.requesterName ?? "resident"}`;
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
  const residentName = entry.residentId
    ? state.residents.find((resident) => resident.id === entry.residentId)?.name ?? "Unknown resident"
    : "General";
  const note = entry.note ? ` (${entry.note})` : "";
  return `${residentName} ${entry.kind} on ${entry.date}${note}`;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function filterStateForUser(state: PlannerState, user: SessionUser | undefined): PlannerState {
  if (!user || user.role === "admin") return state;
  return {
    ...state,
    coverageRequests: state.coverageRequests.filter((coverageRequest) => canSeeCoverageRequest(state, user, coverageRequest))
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
  if (isResidentProfileRequest(coverageRequest)) {
    return user?.role === "admin";
  }
  if (isResidentTradeRequest(coverageRequest) && coverageRequestTargetsUserResident(state, user, coverageRequest)) {
    return true;
  }
  return hasServicePrivilege(user, coverageRequest.serviceLine, "edit");
}

function getCoverageRequestResolveError(coverageRequest: CoverageChangeRequest): string {
  if (isResidentProfileRequest(coverageRequest)) return "Admin approval required for resident profile requests";
  return isResidentTradeRequest(coverageRequest)
    ? "Only the requested resident or a service editor can resolve this trade request"
    : "Edit privilege required for this service";
}

function isResidentProfileRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "resident-profile";
}

function isResidentTradeRequest(coverageRequest: CoverageChangeRequest): boolean {
  return coverageRequest.requestType === "resident-trade";
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
        coverageRequest.requestedEntry?.residentId === resident.id ||
        coverageRequest.swapRequestedEntry?.residentId === resident.id)
  );
}

function coverageRequestReferencesResident(coverageRequest: CoverageChangeRequest, residentId: string): boolean {
  return (
    coverageRequest.requesterResidentId === residentId ||
    coverageRequest.targetResidentId === residentId ||
    coverageRequest.requestedResidentProfile?.residentId === residentId ||
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
