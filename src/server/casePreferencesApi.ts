import express from "express";
import { casePreferencesAccess } from "../shared/casePreferences";
import { authenticate, requirePasswordReady, type AuthenticatedRequest } from "./auth";
import { CasePreferenceError, type CasePreferencesStore } from "./casePreferencesStore";
import type { UserStore } from "./userStore";

export function casePreferencesRouter(store: CasePreferencesStore, users: UserStore) {
  const router = express.Router();
  router.use(authenticate(users), requirePasswordReady);
  router.use((req: AuthenticatedRequest, res, next) => {
    const access = casePreferencesAccess(req.user);
    if (access === "none" || (req.method !== "GET" && access !== "edit")) {
      res.status(403).json({ error: req.method === "GET" ? "Case preferences access required" : "Case preferences edit access required" });
      return;
    }
    res.set("Cache-Control", "no-store");
    next();
  });
  router.get("/", async (_req, res, next) => {
    try { res.json({ cards: await store.list() }); } catch (error) { next(error); }
  });
  router.post("/", async (req: AuthenticatedRequest, res, next) => {
    try { res.status(201).json({ card: await store.save(req.body.card, undefined, req.user!.username) }); } catch (error) { next(error); }
  });
  router.put("/:id", async (req: AuthenticatedRequest, res, next) => {
    try { res.json({ card: await store.save(req.body.card, req.body.expectedRevision, req.user!.username, String(req.params.id)) }); } catch (error) { next(error); }
  });
  router.delete("/:id", async (req, res, next) => {
    try { await store.delete(String(req.params.id), req.body.expectedRevision); res.status(204).end(); } catch (error) { next(error); }
  });
  router.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error instanceof CasePreferenceError) { res.status(error.status).json({ error: error.message }); return; }
    next(error);
  });
  return router;
}
