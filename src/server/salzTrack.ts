import { Router } from "express";
import fs from "node:fs/promises";
import { authenticate, type AuthenticatedRequest } from "./auth";
import type { UserStore } from "./userStore";

// These are hand-picked joke locations, never device or person telemetry.
const locations = {
  "3320": { name: "Carilion Roanoke Memorial Hospital", detail: "Main hospital · Roanoke, VA", quip: "You would be at Memorial dot com.", x: 50.65, y: 36.1, asset: "hospital", wideMarker: false },
  "3321": { name: "Carilion Roanoke Memorial Hospital", detail: "East side of campus · Roanoke, VA", quip: "Same Salz. Different spot. Extremely on brand.", x: 65.75, y: 32, asset: "hospital", wideMarker: false },
  "3323": { name: "Riverside 3", detail: "Carilion Clinic · Roanoke, VA", quip: "Riverside dot com. Biodesign energy detected.", x: 45.7, y: 51.2, asset: "riverside", wideMarker: true }
} as const;

export function salzTrackRouter(store: UserStore) {
  const router = Router();
  router.use(authenticate(store));
  router.post("/locate", async (req: AuthenticatedRequest, res, next) => {
    res.set("Cache-Control", "no-store");
    if (req.user?.role !== "admin" && req.user?.canUseSalzTrack !== true) {
      res.status(403).json({ error: "SalzTrack access has not been granted by an admin." });
      return;
    }
    const code: unknown = req.body?.code;
    if (typeof code !== "string" || !Object.hasOwn(locations, code)) {
      res.status(400).json({ error: "No Salz signal on that frequency. Try another four-digit code." });
      return;
    }
    try {
      const { asset, ...location } = locations[code as keyof typeof locations];
      const map = await fs.readFile(new URL(`./assets/salztrack/${asset}.jpg`, import.meta.url));
      res.json({ ...location, map: `data:image/jpeg;base64,${map.toString("base64")}` });
    } catch (error) { next(error); }
  });
  return router;
}
