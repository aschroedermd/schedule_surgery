import express from "express";
import request from "supertest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FileUserStore } from "./userStore";
import { createToken, validateLogin } from "./auth";
import { salzTrackRouter } from "./salzTrack";
import { FileSalzTrackStore } from "./salzTrackStore";

let directory: string;
let store: FileUserStore;
let app: express.Express;
let token: string;
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), "salztrack-test-"));
  store = new FileUserStore(path.join(directory, "users.json"));
  await store.createUser({ username: "tracker", password: "safe-password", canUseSalzTrack: true });
  token = createToken((await validateLogin(store, "tracker", "safe-password"))!);
  app = express(); app.use(express.json()); app.use("/api/salztrack", salzTrackRouter(store, new FileSalzTrackStore(path.join(directory, "salztrack.json"))));
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
    expect(east.body.lng).toBeGreaterThan(main.body.lng);
    expect(riverside.body.name).toBe("Riverside 3");
    expect(riverside.body.lat).toBeGreaterThan(main.body.lat);
    expect(main.body.mode).toBe("preset");
    expect(main.headers["cache-control"]).toBe("no-store");
  });
  it.each(["3322", "", "__proto__", 3320, "03320"])("rejects unrecognized code %s", async code => {
    await locate(code).expect(400);
  });
});


describe("shared Salzberg position", () => {
  const patch = (editorToken: string, change: object, caller = token) => request(app).patch("/api/salztrack/position").set("Authorization", `Bearer ${caller}`).set("X-SalzTrack-Editor", editorToken).send(change);
  it("saves a dropped position and shares it with a second viewer and after restart", async () => {
    const editor = await locate("9111").expect(200);
    const viewer = await store.createUser({ username: "viewer", password: "safe-password", canUseSalzTrack: true });
    const viewerToken = createToken(viewer.user);
    await patch("", { lat: 37.25, lng: -79.94 }, viewerToken).expect(403);
    await patch(editor.body.editorToken, { lat: 37.25, lng: -79.94 }, viewerToken).expect(403);
    const saved = await patch(editor.body.editorToken, { lat: 37.26, lng: -79.95 }).expect(200);
    const live = await request(app).post("/api/salztrack/locate").set("Authorization", `Bearer ${viewerToken}`).send({ code: "1234" }).expect(200);
    expect(live.body).toMatchObject({ lat: 37.26, lng: -79.95, revision: saved.body.revision, mode: "live" });
    expect(live.body.editorToken).toBeUndefined();
    const restored = await new FileSalzTrackStore(path.join(directory, "salztrack.json")).read();
    expect(restored).toEqual(saved.body);
  });
  it("serializes steering so concurrent steps are preserved and revocation stops edits and reads", async () => {
    const editor = await locate("9111").expect(200);
    const initial = await patch(editor.body.editorToken, { lat: 37.25, lng: -79.94 }).expect(200);
    await Promise.all(Array.from({ length: 5 }, () => patch(editor.body.editorToken, { direction: "north" }).expect(200)));
    const updated = await request(app).get("/api/salztrack/position").set("Authorization", `Bearer ${token}`).expect(200);
    expect(updated.body.revision).toBe(initial.body.revision + 5);
    expect(updated.body.lat).toBeCloseTo(37.25 + 10 / 111320, 8);
    await store.updateUser("tracker", { canUseSalzTrack: false });
    await patch(editor.body.editorToken, { direction: "east" }).expect(403);
    await request(app).get("/api/salztrack/position").set("Authorization", `Bearer ${token}`).expect(403);
  });
  it("rejects invalid coordinates/directions and invalidates a closed editor", async () => {
    const editor = await locate("9111").expect(200);
    for (const change of [{ lat: 100, lng: 0 }, { lat: "37", lng: -79 }, { direction: "up" }, { direction: "north", lat: 37 }]) await patch(editor.body.editorToken, change).expect(400);
    await request(app).delete("/api/salztrack/editor").set("Authorization", `Bearer ${token}`).set("X-SalzTrack-Editor", editor.body.editorToken).expect(204);
    await patch(editor.body.editorToken, { direction: "north" }).expect(403);
  });
});
