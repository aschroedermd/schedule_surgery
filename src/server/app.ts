import cors from "cors";
import express from "express";
import path from "node:path";
import { isCoverageKindAllowedOnDate } from "../shared/coverage";
import { createId } from "../shared/id";
import {
  addActivity,
  applyClaim,
  applySuggestion,
  buildUncoveredMessage,
  buildWeekSchedule,
  collectWarnings,
  makeAssignment
} from "../shared/scheduler";
import {
  ClaimRequest,
  CollectionName,
  CoverageChangeRequest,
  CoverageEntry,
  CoverageKind,
  CoverageRequestAction,
  PlannerState
} from "../shared/types";
import { authenticate, AuthenticatedRequest, createToken, requireAdmin, validateLogin } from "./auth";
import { getOpenApiDocument } from "./openapi";
import { StateStore } from "./store";

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

export function createApp(store: StateStore) {
  const app = express();
  app.use(cors());
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

  app.post("/api/auth/login", (req, res) => {
    const { role, password } = req.body as { role?: "admin" | "viewer"; password?: string };
    if (!role || !password || !["admin", "viewer"].includes(role) || !validateLogin(role, password)) {
      res.status(401).json({ error: "Invalid role or password" });
      return;
    }
    res.json({ token: createToken(role), role });
  });

  app.get("/api/session", authenticate, (req: AuthenticatedRequest, res) => {
    res.json({ role: req.user?.role, authType: req.user?.authType });
  });

  app.get("/api/state", authenticate, async (_req, res, next) => {
    try {
      res.json(await store.load());
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/weeks/:weekId/schedule", authenticate, async (req, res, next) => {
    try {
      const state = await store.load();
      res.json(buildWeekSchedule(state, getParam(req.params.weekId)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/weeks/:weekId/warnings", authenticate, async (req, res, next) => {
    try {
      const state = await store.load();
      res.json(collectWarnings(state, getParam(req.params.weekId)));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/weeks/:weekId/uncovered-message", authenticate, async (req, res, next) => {
    try {
      const state = await store.load();
      const date = typeof req.query.date === "string" ? req.query.date : undefined;
      res.json({ message: buildUncoveredMessage(state, getParam(req.params.weekId), date) });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/weeks/:weekId/suggest", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const nextState = applySuggestion(state, getParam(req.params.weekId), req.user?.role ?? "admin");
      await store.save(nextState);
      res.json(nextState);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/entities/:collection", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const state = await store.load();
      const entity = req.body;
      const nextState = {
        ...state,
        [collection]: [...state[collection], entity]
      } as PlannerState;
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "created item", `Created ${collection}`, collection, entity.id);
      await store.save(withActivity);
      res.status(201).json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/entities/:collection/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const id = getParam(req.params.id);
      const state = await store.load();
      const nextState = {
        ...state,
        [collection]: state[collection].map((entity) => (entity.id === id ? { ...entity, ...req.body, id } : entity))
      } as PlannerState;
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "updated item", `Updated ${collection}`, collection, id);
      await store.save(withActivity);
      res.json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/entities/:collection/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const collection = assertCollection(getParam(req.params.collection));
      const id = getParam(req.params.id);
      const state = await store.load();
      const nextState = collection === "weeks" ? deleteWeek(state, id) : deleteEntityFromCollection(state, collection, id);
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "deleted item", `Deleted ${collection}`, collection, id);
      await store.save(withActivity);
      res.json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/assignments", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const assignment = makeAssignment(req.body.kind, req.body.targetId, req.body.residentId, "admin", Boolean(req.body.locked));
      const caseIdsInAssignedBlock =
        assignment.kind === "block"
          ? new Set(state.cases.filter((surgeryCase) => surgeryCase.blockId === assignment.targetId).map((surgeryCase) => surgeryCase.id))
          : new Set<string>();
      const replacedAssignments =
        assignment.kind === "clinic"
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
      await store.save(withActivity);
      res.status(201).json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/assignments/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const nextState: PlannerState = {
        ...state,
        assignments: state.assignments.map((assignment) =>
          assignment.id === id ? { ...assignment, ...req.body, id: assignment.id, updatedAt: new Date().toISOString() } : assignment
        )
      };
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "updated assignment", "Assignment lock or resident changed", "assignment", id);
      await store.save(withActivity);
      res.json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/assignments/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const nextState: PlannerState = {
        ...state,
        assignments: state.assignments.filter((assignment) => assignment.id !== id)
      };
      const withActivity = addActivity(nextState, req.user?.role ?? "admin", "removed assignment", "Assignment cleared", "assignment", id);
      await store.save(withActivity);
      res.json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-entries", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
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
      await store.save(withActivity);
      res.status(201).json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.patch("/api/coverage-entries/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
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
      await store.save(withActivity);
      res.json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.delete("/api/coverage-entries/:id", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
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
      await store.save(withActivity);
      res.json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-requests", authenticate, async (req: AuthenticatedRequest, res, next) => {
    try {
      const state = await store.load();
      const coverageRequest = buildCoverageRequest(state, req.body);
      const nextState: PlannerState = {
        ...state,
        coverageRequests: [coverageRequest, ...state.coverageRequests]
      };
      const withActivity = addActivity(
        nextState,
        req.user?.role ?? "viewer",
        "submitted call calendar request",
        describeCoverageRequest(nextState, coverageRequest),
        "coverageRequest",
        coverageRequest.id
      );
      await store.save(withActivity);
      res.status(201).json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-requests/:id/approve", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const coverageRequest = requireCoverageRequest(state, id);
      if (coverageRequest.status !== "pending") {
        res.status(400).json({ error: "Coverage request is already resolved" });
        return;
      }
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
        "approved call calendar request",
        describeCoverageRequest(nextState, coverageRequest),
        "coverageRequest",
        id
      );
      await store.save(withActivity);
      res.json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/coverage-requests/:id/deny", authenticate, requireAdmin, async (req: AuthenticatedRequest, res, next) => {
    try {
      const id = getParam(req.params.id);
      const state = await store.load();
      const coverageRequest = requireCoverageRequest(state, id);
      if (coverageRequest.status !== "pending") {
        res.status(400).json({ error: "Coverage request is already resolved" });
        return;
      }
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
        "denied call calendar request",
        describeCoverageRequest(nextState, coverageRequest),
        "coverageRequest",
        id
      );
      await store.save(withActivity);
      res.json(withActivity);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/claims", authenticate, async (req, res, next) => {
    try {
      const state = await store.load();
      const claim = req.body as ClaimRequest;
      if (!claim.residentId || !claim.targetId || !["case", "block"].includes(claim.scope)) {
        res.status(400).json({ error: "Invalid claim" });
        return;
      }
      const nextState = applyClaim(state, claim);
      await store.save(nextState);
      res.status(201).json(nextState);
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/import/preview", authenticate, requireAdmin, (_req, res) => {
    res.status(501).json({
      error: "OCR import is reserved for a later version",
      targetShape: ["AttendingBlock", "Case"]
    });
  });

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
    res.status(500).json({ error: error instanceof Error ? error.message : "Internal server error" });
  });

  return app;
}

function assertCollection(value: string): CollectionName {
  if (!collections.includes(value as CollectionName)) {
    throw new Error(`Unknown collection: ${value}`);
  }
  return value as CollectionName;
}

function deleteEntityFromCollection(state: PlannerState, collection: CollectionName, id: string): PlannerState {
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

function buildCoverageEntry(state: PlannerState, input: Partial<CoverageEntry>, existing?: CoverageEntry): CoverageEntry {
  const now = new Date().toISOString();
  const kind = assertCoverageKind(input.kind ?? existing?.kind);
  const date = assertDate(input.date ?? existing?.date);
  const residentId = readOptionalString(input.residentId);
  const entry: CoverageEntry = {
    id: readOptionalString(input.id) ?? existing?.id ?? createId("cover"),
    date,
    kind,
    residentId,
    note: readOptionalString(input.note) ?? "",
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

function buildCoverageRequest(state: PlannerState, input: Partial<CoverageChangeRequest>): CoverageChangeRequest {
  const now = new Date().toISOString();
  const action = assertCoverageRequestAction(input.action);
  const entryId = readOptionalString(input.entryId);
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
    requesterName: readOptionalString(input.requesterName),
    message: readOptionalString(input.message) ?? "",
    createdAt: now,
    updatedAt: now
  };
}

function applyCoverageRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): PlannerState {
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

function compareCoverageEntries(a: CoverageEntry, b: CoverageEntry): number {
  const kindOrder = { call: 0, rounding: 1, off: 2, note: 3 };
  return a.date.localeCompare(b.date) || kindOrder[a.kind] - kindOrder[b.kind] || a.id.localeCompare(b.id);
}

function describeCoverageRequest(state: PlannerState, coverageRequest: CoverageChangeRequest): string {
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

function getParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}
