import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getDefaultUserStorePath } from "./userStore";
import { isSalzCoordinate, SALZ_PRESETS, type SalzPosition, type SalzPositionChange } from "../shared/salzTrack";

export class FileSalzTrackStore {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly filePath = process.env.SALZTRACK_STORE_PATH || path.join(path.dirname(getDefaultUserStorePath()), "salztrack.json")) {}
  async read(): Promise<SalzPosition> {
    await this.queue;
    return this.load();
  }
  private async load(): Promise<SalzPosition> {
    try {
      const value = JSON.parse(await fs.readFile(this.filePath, "utf8")) as SalzPosition;
      if (!isSalzCoordinate(value.lat, value.lng) || !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.updatedAt !== "string") throw new Error("Invalid saved SalzTrack position");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return { lat: SALZ_PRESETS["3320"].lat, lng: SALZ_PRESETS["3320"].lng, revision: 0, updatedAt: new Date(0).toISOString() };
    }
  }
  update(change: SalzPositionChange): Promise<SalzPosition> {
    const operation = this.queue.then(async () => {
      const previous = await this.load();
      let lat = previous.lat, lng = previous.lng;
      if ("direction" in change) {
        // Two metres per step; server-side increments preserve concurrent steering.
        const latStep = 2 / 111320;
        const lngStep = latStep / Math.cos(lat * Math.PI / 180);
        if (change.direction === "north") lat += latStep;
        if (change.direction === "south") lat -= latStep;
        if (change.direction === "east") lng += lngStep;
        if (change.direction === "west") lng -= lngStep;
        lat = Math.max(-85, Math.min(85, lat));
        lng = ((lng + 180) % 360 + 360) % 360 - 180;
      } else { lat = change.lat; lng = change.lng; }
      if (!isSalzCoordinate(lat, lng)) throw new Error("Invalid SalzTrack coordinates");
      const next = { lat, lng, revision: previous.revision + 1, updatedAt: new Date().toISOString() };
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
        await fs.rename(temporary, this.filePath);
      } finally { await fs.rm(temporary, { force: true }); }
      return next;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
