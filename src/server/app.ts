import cors from "cors";
import express from "express";
import path from "node:path";
import {
  addActivity,
  applyClaim,
  applySuggestion,
  buildUncoveredMessage,
  buildWeekSchedule,
  collectWarnings,
  makeAssignment
} from "../shared/scheduler";
import { ClaimRequest, CollectionName, PlannerState } from "../shared/types";
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
      const nextState = {
        ...state,
        [collection]: state[collection].filter((entity) => entity.id !== id)
      } as PlannerState;
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

function getParam(value: string | string[]): string {
  return Array.isArray(value) ? value[0] : value;
}
