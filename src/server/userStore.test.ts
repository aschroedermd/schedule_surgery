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
