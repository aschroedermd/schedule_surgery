import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileUserStore } from "./userStore";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function makeStore(): Promise<{ filePath: string; store: FileUserStore }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "schedule-user-store-"));
  temporaryDirectories.push(directory);
  const filePath = path.join(directory, "users.json");
  return { filePath, store: new FileUserStore(filePath) };
}

describe("file user store", () => {
  it("stores only a hash of a personal API key and invalidates it on rotation, revocation, and password change", async () => {
    const { filePath, store } = await makeStore();
    await store.createUser({ username: "apiresident", password: "safe-password" });

    const first = await store.rotateApiKey("apiresident");
    expect(first.apiKey).toMatch(/^ss_v1_[A-Za-z0-9_-]{43}$/);
    expect(await store.authenticateApiKey(first.apiKey)).toEqual(expect.objectContaining({ username: "apiresident" }));
    expect(await fs.readFile(filePath, "utf8")).not.toContain(first.apiKey);
    expect(await new FileUserStore(filePath).authenticateApiKey(first.apiKey)).toEqual(expect.objectContaining({ username: "apiresident" }));

    const second = await store.rotateApiKey("apiresident");
    expect(await store.authenticateApiKey(first.apiKey)).toBeUndefined();
    expect(await store.authenticateApiKey(second.apiKey)).toBeDefined();
    await store.revokeApiKey("apiresident");
    expect(await store.authenticateApiKey(second.apiKey)).toBeUndefined();
    expect(await store.getApiKeyStatus("apiresident")).toEqual({ createdAt: null });

    const third = await store.rotateApiKey("apiresident");
    await store.changePassword("apiresident", "safe-password", "new-safe-password");
    expect(await store.authenticateApiKey(third.apiKey)).toBeUndefined();

    const fourth = await store.rotateApiKey("apiresident");
    await store.resetPassword("apiresident", "temporary-safe-password");
    expect(await store.authenticateApiKey(fourth.apiKey)).toBeUndefined();
    await expect(store.rotateApiKey("apiresident")).rejects.toThrow("Password change required");
  });

  it("creates resident accounts with view-only defaults", async () => {
    const { store } = await makeStore();

    const created = await store.createUser({ username: "newresident", password: "safe-password" });

    expect(created.user).toEqual(expect.objectContaining({
      role: "resident",
      canBuildCall: false,
      servicePrivileges: expect.objectContaining({ ICU: "view", Davies: "view", Berry: "view" })
    }));
  });

  it("limits advanced editor access to resident and attending accounts", async () => {
    const { store } = await makeStore();

    const resident = await store.createUser({ username: "advancedresident", role: "resident", password: "safe-password", canBuildCall: true });
    const attending = await store.createUser({ username: "advancedattending", role: "attending", attendingId: "att_1", password: "safe-password", canBuildCall: true });
    const student = await store.createUser({ username: "studentaccount", role: "student", password: "safe-password", canBuildCall: true });

    expect(resident.user.canBuildCall).toBe(true);
    expect(attending.user.canBuildCall).toBe(true);
    expect(student.user.canBuildCall).toBe(false);
  });

  it("migrates legacy viewer and medical-student roles", async () => {
    const { filePath, store } = await makeStore();
    await store.createUser({ username: "legacyresident", password: "safe-password" });
    await store.createUser({ username: "legacystudent", role: "student", password: "safe-password" });
    const data = JSON.parse(await fs.readFile(filePath, "utf8")) as { users: Array<{ username: string; role: string }> };
    data.users.find((user) => user.username === "legacyresident")!.role = "viewer";
    data.users.find((user) => user.username === "legacystudent")!.role = "medical-student";
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);

    const migrated = new FileUserStore(filePath);
    await expect(migrated.getUser("legacyresident")).resolves.toEqual(expect.objectContaining({ role: "resident" }));
    await expect(migrated.getUser("legacystudent")).resolves.toEqual(expect.objectContaining({ role: "student" }));
  });

  it("authenticates a username with one extra alphabetic middle initial", async () => {
    const { store } = await makeStore();
    await store.createUser({ username: "jrudderow", password: "correct-password" });

    await expect(store.authenticate("jsrudderow", "correct-password")).resolves.toEqual(
      expect.objectContaining({ username: "jrudderow" })
    );
    await expect(store.authenticate("JSRUDDEROW", "correct-password")).resolves.toEqual(
      expect.objectContaining({ username: "jrudderow" })
    );
  });

  it("does not broaden middle-initial login matching beyond one alphabetic character in the second position", async () => {
    const { store } = await makeStore();
    await store.createUser({ username: "jrudderow", password: "correct-password" });

    await expect(store.authenticate("jssrudderow", "correct-password")).resolves.toBeUndefined();
    await expect(store.authenticate("jruxdderow", "correct-password")).resolves.toBeUndefined();
    await expect(store.authenticate("j1rudderow", "correct-password")).resolves.toBeUndefined();
    await expect(store.authenticate("jsrudderow", "wrong-password")).resolves.toBeUndefined();
  });

  it("keeps an exact username authoritative over a possible middle-initial correction", async () => {
    const { store } = await makeStore();
    await store.createUser({ username: "jrudderow", password: "base-password" });
    await store.createUser({ username: "jsrudderow", password: "exact-password" });

    await expect(store.authenticate("jsrudderow", "exact-password")).resolves.toEqual(
      expect.objectContaining({ username: "jsrudderow" })
    );
    await expect(store.authenticate("jsrudderow", "base-password")).resolves.toBeUndefined();
  });

  it("does not rewrite the user file during authenticated reads", async () => {
    const { filePath, store } = await makeStore();
    await store.getUser("admin");
    const before = await fs.stat(filePath);

    await Promise.all(Array.from({ length: 30 }, () => store.getUser("admin")));

    const after = await fs.stat(filePath);
    const contents = await fs.readFile(filePath, "utf8");
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(() => JSON.parse(contents)).not.toThrow();
  });

  it("serializes concurrent mutations without losing users or exposing partial JSON", async () => {
    const { filePath, store } = await makeStore();
    await store.getUser("admin");

    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        store.createUser({ username: `test-user-${index}`, displayName: `Test User ${index}`, password: "safe-password" })
      )
    );

    const stored = JSON.parse(await fs.readFile(filePath, "utf8")) as { users: Array<{ username: string }> };
    expect(stored.users.filter((user) => user.username.startsWith("test-user-")).map((user) => user.username).sort()).toEqual(
      Array.from({ length: 8 }, (_, index) => `test-user-${index}`)
    );
  });
});
