import express from "express";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileUserStore } from "./userStore";
import { createToken, validateLogin } from "./auth";
import { salzTrackRouter } from "./salzTrack";

let directory: string;
let store: FileUserStore;
let app: express.Express;
let token: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "salztrack-test-"));
  store = new FileUserStore(path.join(directory, "users.json"));
  await store.createUser({ username: "tracker", password: "safe-password", canUseSalzTrack: true });
  token = createToken((await validateLogin(store, "tracker", "safe-password"))!);
  app = express(); app.use(express.json()); app.use("/api/salztrack", salzTrackRouter(store));
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); });
const locate = (code: unknown) => request(app).post("/api/salztrack/locate").set("Authorization", `Bearer ${token}`).send({ code });

describe("SalzTrack permissions and fixed sightings", () => {
  it("requires authentication and honors revocation with an existing token", async () => {
    await request(app).post("/api/salztrack/locate").send({ code: "3320" }).expect(401);
    await locate("3320").expect(200);
    await store.updateUser("tracker", { canUseSalzTrack: false });
    await locate("3320").expect(403);
    expect((await new FileUserStore(path.join(directory, "users.json")).getUser("tracker"))?.canUseSalzTrack).toBe(false);
  });
  it("defaults ordinary users to no access and always allows admins", async () => {
    const user = await store.createUser({ username: "ordinary", password: "safe-password" });
    expect(user.user.canUseSalzTrack).toBe(false);
    token = createToken(user.user);
    await locate("3320").expect(403);
    await store.updateUser("ordinary", { role: "admin", canUseSalzTrack: false });
    token = createToken((await store.getUser("ordinary"))!);
    await locate("3320").expect(200);
  });
  it("persists granted access, exposes it in sessions, and returns the three reference spots", async () => {
    const restarted = new FileUserStore(path.join(directory, "users.json"));
    expect((await validateLogin(restarted, "tracker", "safe-password"))?.canUseSalzTrack).toBe(true);
    const main = await locate("3320").expect(200);
    const east = await locate("3321").expect(200);
    const riverside = await locate("3323").expect(200);
    expect(main.body.name).toContain("Memorial Hospital");
    expect(east.body.map).toBe(main.body.map);
    expect(east.body.x).toBeGreaterThan(main.body.x);
    expect(riverside.body.name).toBe("Riverside 3");
    expect(riverside.body.map).not.toBe(main.body.map);
    expect(main.body.map).toMatch(/^data:image\/jpeg;base64,/);
    expect(main.headers["cache-control"]).toBe("no-store");
  });
  it.each(["3322", "", "__proto__", 3320, "03320"])("rejects unrecognized code %s", async code => {
    await locate(code).expect(400);
  });
});
