import { Router } from "express";
import crypto from "node:crypto";
import { authenticate, type AuthenticatedRequest } from "./auth";
import type { UserStore } from "./userStore";
import { FileSalzTrackStore } from "./salzTrackStore";
import { isSalzCoordinate, SALZ_PRESETS, type SalzDirection } from "../shared/salzTrack";

export function salzTrackRouter(store: UserStore, positions = new FileSalzTrackStore()) {
  const router = Router();
  const grants = new Map<string, { username: string; passwordUpdatedAt: string; expiresAt: number }>();
  router.use(authenticate(store));
  router.use((req: AuthenticatedRequest, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.user?.mustChangePassword || (req.user?.role !== "admin" && req.user?.canUseSalzTrack !== true)) {
      res.status(403).json({ error: "SalzTrack access has not been granted by an admin." });
      return;
    }
    next();
  });
  router.post("/locate", async (req: AuthenticatedRequest, res, next) => {
    const code: unknown = req.body?.code;
    try {
      if (code === "1234" || code === "9111") {
        const position = await positions.read();
        let editorToken: string | undefined;
        if (code === "9111") {
          for (const [key, grant] of grants) if (grant.expiresAt < Date.now() || grant.username === req.user!.username) grants.delete(key);
          editorToken = crypto.randomBytes(32).toString("base64url");
          grants.set(editorToken, { username: req.user!.username, passwordUpdatedAt: req.user!.passwordUpdatedAt, expiresAt: Date.now() + 18 * 3600000 });
        }
        res.json({ ...position, name: "Salzberg", detail: "Shared Salztelite location", mode: code === "9111" ? "editor" : "live", editorToken });
        return;
      }
      if (typeof code !== "string" || !Object.hasOwn(SALZ_PRESETS, code)) {
        res.status(400).json({ error: "No Salz signal on that frequency. Try another four-digit code." });
        return;
      }
      res.json({ ...SALZ_PRESETS[code as keyof typeof SALZ_PRESETS], revision: 0, updatedAt: new Date(0).toISOString(), mode: "preset" });
    } catch (error) { next(error); }
  });
  router.get("/position", async (_req, res, next) => {
    try { res.json(await positions.read()); } catch (error) { next(error); }
  });
  router.patch("/position", async (req: AuthenticatedRequest, res, next) => {
    const grant = grants.get(req.header("X-SalzTrack-Editor") ?? "");
    if (!grant || grant.username !== req.user!.username || grant.passwordUpdatedAt !== req.user!.passwordUpdatedAt || grant.expiresAt <= Date.now()) {
      res.status(403).json({ error: "Open the 9111 editor to move Salzberg." });
      return;
    }
    try {
      const body = req.body;
      const direction = body?.direction;
      if (direction !== undefined) {
        if (!["north", "south", "east", "west"].includes(direction) || body.lat !== undefined || body.lng !== undefined) {
          res.status(400).json({ error: "Choose a valid steering direction." }); return;
        }
        res.json(await positions.update({ direction: direction as SalzDirection }));
      } else {
        if (!isSalzCoordinate(body?.lat, body?.lng)) { res.status(400).json({ error: "Choose a valid map position." }); return; }
        res.json(await positions.update({ lat: body.lat, lng: body.lng }));
      }
    } catch (error) { next(error); }
  });
  router.delete("/editor", (req: AuthenticatedRequest, res) => {
    const key = req.header("X-SalzTrack-Editor") ?? "";
    if (grants.get(key)?.username === req.user!.username) grants.delete(key);
    res.sendStatus(204);
  });
  return router;
}
