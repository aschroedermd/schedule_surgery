import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Role, SERVICE_LINES, ServicePrivileges, UserSummary } from "../shared/types";
import { RESIDENT_USER_SEEDS } from "./residentRotationSeed";

const DEFAULT_USERS = RESIDENT_USER_SEEDS;
const DEFAULT_NEW_USER_TEMPORARY_PASSWORD = "schroeder1";
export const DEFAULT_VOICE_DAILY_LIMIT = 12;
export const DEFAULT_VOICE_PRESET = 1;

interface PasswordHash {
  algorithm: "scrypt";
  salt: string;
  key: string;
}

interface StoredUser extends UserSummary {
  passwordHash: PasswordHash;
}

interface UserStoreData {
  version: 1;
  users: StoredUser[];
}

export interface UpsertUserInput {
  username: string;
  displayName?: string;
  role?: Role;
  attendingId?: string;
  password?: string;
  temporaryPassword?: string;
  servicePrivileges?: ServicePrivileges;
  canAddContacts?: boolean;
}

export interface PasswordResetResult {
  user: UserSummary;
  temporaryPassword: string;
}

export interface UserCreationResult {
  user: UserSummary;
  temporaryPassword?: string;
}

export interface UserStore {
  authenticate(username: string, password: string): Promise<UserSummary | undefined>;
  getUser(username: string): Promise<UserSummary | undefined>;
  listUsers(): Promise<UserSummary[]>;
  createUser(input: UpsertUserInput): Promise<UserCreationResult>;
  createUsers(inputs: UpsertUserInput[]): Promise<UserCreationResult[]>;
  updateUser(username: string, patch: Partial<Pick<UserSummary, "displayName" | "role" | "attendingId" | "servicePrivileges" | "canAddContacts">>): Promise<UserSummary>;
  updateVoiceDailyLimit(username: string, limit: number): Promise<UserSummary>;
  updatePreferredVoicePreset(username: string, preset: 1 | 2 | 3 | 4 | 5): Promise<UserSummary>;
  deleteUser(username: string): Promise<void>;
  resetPassword(username: string, temporaryPassword?: string): Promise<PasswordResetResult>;
  changePassword(username: string, currentPassword: string, nextPassword: string): Promise<UserSummary>;
}

export class FileUserStore implements UserStore {
  // A single app process owns this file. Keep reads in memory, serialize every
  // mutation, and publish complete snapshots so auth can never parse half a write.
  private data: UserStoreData | undefined;
  private loading: Promise<UserStoreData> | undefined;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath = getDefaultUserStorePath()) {}

  async authenticate(username: string, password: string): Promise<UserSummary | undefined> {
    const data = await this.load();
    const user = findStoredUser(data, username);
    if (!user || !verifySecret(password, user.passwordHash)) return undefined;
    return toSummary(user);
  }

  async getUser(username: string): Promise<UserSummary | undefined> {
    const data = await this.load();
    const user = findStoredUser(data, username);
    return user ? toSummary(user) : undefined;
  }

  async listUsers(): Promise<UserSummary[]> {
    const data = await this.load();
    return data.users.map(toSummary).sort((a, b) => a.username.localeCompare(b.username));
  }

  async createUser(input: UpsertUserInput): Promise<UserCreationResult> {
    const [created] = await this.createUsers([input]);
    return created;
  }

  async createUsers(inputs: UpsertUserInput[]): Promise<UserCreationResult[]> {
    if (inputs.length === 0) throw new Error("At least one user is required");
    return this.mutate(async (data) => {
      const existingUsernames = new Set(data.users.map((user) => user.username));
      const batchUsernames = new Set<string>();
      const now = new Date().toISOString();
      const created: Array<{ stored: StoredUser; temporaryPassword?: string }> = [];

      for (const input of inputs) {
        const username = normalizeUsername(input.username);
        if (existingUsernames.has(username) || batchUsernames.has(username)) {
          throw new Error(`User already exists: ${username}`);
        }
        batchUsernames.add(username);
        created.push(makeCreatedUser({ ...input, username }, now));
      }

      data.users.push(...created.map(({ stored }) => stored));
      return created.map(({ stored, temporaryPassword }) => ({ user: toSummary(stored), temporaryPassword }));
    });
  }

  async updateUser(
    username: string,
    patch: Partial<Pick<UserSummary, "displayName" | "role" | "attendingId" | "servicePrivileges" | "canAddContacts">>
  ): Promise<UserSummary> {
    return this.mutate(async (data) => {
      const user = requireStoredUser(data, username);
      user.displayName = readOptionalString(patch.displayName) ?? user.displayName;
      user.role = user.username === "admin" ? "admin" : normalizeRole(patch.role ?? user.role);
      user.attendingId = user.role === "attending" ? readOptionalString(patch.attendingId) ?? user.attendingId : undefined;
      if (user.role === "attending" && !user.attendingId) throw new Error("Attending accounts must be linked to an attending");
      if (patch.servicePrivileges) user.servicePrivileges = normalizePrivileges(patch.servicePrivileges);
      if (typeof patch.canAddContacts === "boolean") user.canAddContacts = user.role === "admin" || patch.canAddContacts;
      user.updatedAt = new Date().toISOString();
      return toSummary(user);
    });
  }

  async deleteUser(username: string): Promise<void> {
    await this.mutate(async (data) => {
      const normalized = normalizeUsername(username);
      if (normalized === "admin") throw new Error("The built-in admin account cannot be deleted");
      if (!data.users.some((user) => user.username === normalized)) throw new Error(`User not found: ${normalized}`);
      data.users = data.users.filter((user) => user.username !== normalized);
    });
  }

  async updateVoiceDailyLimit(username: string, limit: number): Promise<UserSummary> {
    return this.mutate(async (data) => {
      const user = requireStoredUser(data, username);
      user.voiceDailyLimit = normalizeVoiceDailyLimit(limit);
      user.updatedAt = new Date().toISOString();
      return toSummary(user);
    });
  }

  async updatePreferredVoicePreset(username: string, preset: 1 | 2 | 3 | 4 | 5): Promise<UserSummary> {
    return this.mutate(async (data) => {
      const user = requireStoredUser(data, username);
      user.preferredVoicePreset = normalizeVoicePreset(preset);
      user.updatedAt = new Date().toISOString();
      return toSummary(user);
    });
  }

  async resetPassword(username: string, requestedTemporaryPassword?: string): Promise<PasswordResetResult> {
    return this.mutate(async (data) => {
      const user = requireStoredUser(data, username);
      const now = new Date().toISOString();
      const temporaryPassword = readOptionalString(requestedTemporaryPassword) ?? generateTemporaryPassword();
      assertUsableSecret(temporaryPassword, "Temporary password");
      user.passwordHash = hashSecret(temporaryPassword);
      user.passwordUpdatedAt = now;
      user.updatedAt = now;
      user.mustChangePassword = true;
      return { user: toSummary(user), temporaryPassword };
    });
  }

  async changePassword(username: string, currentPassword: string, nextPassword: string): Promise<UserSummary> {
    assertUsableSecret(nextPassword, "Password");
    return this.mutate(async (data) => {
      const user = requireStoredUser(data, username);
      if (!verifySecret(currentPassword, user.passwordHash)) throw new Error("Current password is incorrect");
      const now = new Date().toISOString();
      user.passwordHash = hashSecret(nextPassword);
      user.passwordUpdatedAt = now;
      user.updatedAt = now;
      user.mustChangePassword = false;
      return toSummary(user);
    });
  }

  private async load(): Promise<UserStoreData> {
    if (this.data) return this.data;
    if (this.loading) return this.loading;
    this.loading = this.loadFromDisk();
    try {
      this.data = await this.loading;
      return this.data;
    } finally {
      this.loading = undefined;
    }
  }

  private async loadFromDisk(): Promise<UserStoreData> {
    let loaded: UserStoreData | undefined;
    try {
      loaded = JSON.parse(await fs.readFile(this.filePath, "utf8")) as UserStoreData;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    const data = normalizeUserStoreData(loaded);
    if (!loaded || JSON.stringify(data) !== JSON.stringify(loaded)) await this.save(data);
    return data;
  }

  private mutate<T>(action: (data: UserStoreData) => Promise<T> | T): Promise<T> {
    const run = async () => {
      const data = structuredClone(await this.load());
      const result = await action(data);
      await this.save(data);
      this.data = data;
      return result;
    };
    const pending = this.mutationQueue.then(run, run);
    this.mutationQueue = pending.then(() => undefined, () => undefined);
    return pending;
  }

  private async save(data: UserStoreData): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
      await fs.rename(temporaryPath, this.filePath);
      await fs.chmod(this.filePath, 0o600).catch(() => undefined);
    } catch (error) {
      await fs.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }
}

export function createDefaultUserStore(): UserStore {
  return new FileUserStore();
}

export function getDefaultUserStorePath(): string {
  return process.env.USER_STORE_PATH || path.resolve(process.cwd(), ".local/users.json");
}

export function getPrivilege(privileges: ServicePrivileges | undefined, serviceLine: string | undefined) {
  if (!serviceLine) return "view";
  return privileges?.[serviceLine] ?? "view";
}

export function hasServicePrivilege(
  user: Pick<UserSummary, "role" | "servicePrivileges"> | undefined,
  serviceLine: string | undefined,
  required: "request" | "edit"
): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  return privilegeRank(getPrivilege(user.servicePrivileges, serviceLine)) >= privilegeRank(required);
}

function normalizeUserStoreData(input: UserStoreData | undefined): UserStoreData {
  const now = new Date().toISOString();
  const users = new Map<string, StoredUser>();
  for (const user of input?.users ?? []) {
    if (!user.username || !user.passwordHash) continue;
    const username = normalizeUsername(user.username);
    users.set(username, {
      ...user,
      username,
      displayName: readOptionalString(user.displayName) ?? username,
      role: username === "admin" ? "admin" : normalizeRole(user.role),
      attendingId: normalizeRole(user.role) === "attending" ? readOptionalString(user.attendingId) : undefined,
      servicePrivileges: normalizePrivileges(user.servicePrivileges),
      canAddContacts: username === "admin" || user.canAddContacts === true,
      voiceDailyLimit: normalizeVoiceDailyLimit(user.voiceDailyLimit),
      preferredVoicePreset: normalizeVoicePreset(user.preferredVoicePreset),
      createdAt: user.createdAt ?? now,
      updatedAt: user.updatedAt ?? now,
      passwordUpdatedAt: user.passwordUpdatedAt ?? user.updatedAt ?? now,
      mustChangePassword: user.mustChangePassword ?? false
    });
  }

  if (!users.has("admin")) {
    users.set("admin", makeSeedUser("admin", "admin", "admin", getInitialAdminPassword(), now, false));
  }
  const seedPassword = getInitialSeedUserPassword();
  for (const user of DEFAULT_USERS) {
    const existing = users.get(user.username);
    if (!existing && user.legacyUsername !== user.username) {
      const legacy = users.get(user.legacyUsername);
      if (legacy) {
        users.delete(user.legacyUsername);
        users.set(user.username, {
          ...legacy,
          username: user.username,
          displayName: legacy.displayName === user.legacyDisplayName ? user.displayName : legacy.displayName,
          updatedAt: now
        });
        continue;
      }
    }
    if (!existing) {
      users.set(user.username, makeSeedUser(user.username, user.displayName, "viewer", seedPassword, now, true));
    }
  }

  return {
    version: 1,
    users: [...users.values()]
  };
}

function makeSeedUser(
  username: string,
  displayName: string,
  role: Role,
  password: string,
  now: string,
  mustChangePassword = false
): StoredUser {
  return {
    username,
    displayName,
    role,
    servicePrivileges: normalizePrivileges(role === "admin" ? Object.fromEntries(SERVICE_LINES.map((service) => [service, "edit"])) : {}),
    canAddContacts: role === "admin",
    voiceDailyLimit: DEFAULT_VOICE_DAILY_LIMIT,
    preferredVoicePreset: DEFAULT_VOICE_PRESET,
    passwordHash: hashSecret(password),
    createdAt: now,
    updatedAt: now,
    passwordUpdatedAt: now,
    mustChangePassword
  };
}

function makeCreatedUser(input: UpsertUserInput, now: string): { stored: StoredUser; temporaryPassword?: string } {
  const username = normalizeUsername(input.username);
  const role: Role = username === "admin" ? "admin" : normalizeRole(input.role);
  const attendingId = role === "attending" ? readOptionalString(input.attendingId) : undefined;
  if (role === "attending" && !attendingId) throw new Error("Attending accounts must be linked to an attending");
  const providedPassword = readOptionalString(input.password);
  const providedTemporaryPassword = readOptionalString(input.temporaryPassword);
  if (providedPassword && providedTemporaryPassword) {
    throw new Error("Provide either a password or a temporary password, not both");
  }
  if (providedPassword) assertUsableSecret(providedPassword, "Password");
  if (providedTemporaryPassword) assertUsableSecret(providedTemporaryPassword, "Temporary password");
  const temporaryPassword = providedTemporaryPassword ?? (providedPassword ? undefined : DEFAULT_NEW_USER_TEMPORARY_PASSWORD);
  const password = providedPassword ?? temporaryPassword ?? DEFAULT_NEW_USER_TEMPORARY_PASSWORD;

  return {
    stored: {
      username,
      displayName: readOptionalString(input.displayName) ?? username,
      role,
      attendingId,
      servicePrivileges: normalizePrivileges(
        role === "admin" ? Object.fromEntries(SERVICE_LINES.map((service) => [service, "edit"])) : input.servicePrivileges
      ),
      canAddContacts: role === "admin" || input.canAddContacts === true,
      voiceDailyLimit: DEFAULT_VOICE_DAILY_LIMIT,
      preferredVoicePreset: DEFAULT_VOICE_PRESET,
      passwordHash: hashSecret(password),
      createdAt: now,
      updatedAt: now,
      passwordUpdatedAt: now,
      mustChangePassword: Boolean(temporaryPassword)
    },
    temporaryPassword
  };
}

function normalizePrivileges(input: ServicePrivileges | undefined): ServicePrivileges {
  const privileges: ServicePrivileges = {};
  for (const [service, privilege] of Object.entries(input ?? {})) {
    if (!service.trim()) continue;
    privileges[service.trim()] = privilege === "edit" || privilege === "request" ? privilege : "view";
  }
  for (const service of SERVICE_LINES) {
    if (!privileges[service]) privileges[service] = "view";
  }
  return privileges;
}

function findStoredUser(data: UserStoreData, username: string): StoredUser | undefined {
  const normalized = normalizeUsername(username);
  return data.users.find((user) => user.username === normalized);
}

function requireStoredUser(data: UserStoreData, username: string): StoredUser {
  const user = findStoredUser(data, username);
  if (!user) throw new Error(`User not found: ${normalizeUsername(username)}`);
  return user;
}

function toSummary(user: StoredUser): UserSummary {
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    attendingId: user.attendingId,
    servicePrivileges: { ...user.servicePrivileges },
    canAddContacts: user.role === "admin" || user.canAddContacts,
    voiceDailyLimit: normalizeVoiceDailyLimit(user.voiceDailyLimit),
    preferredVoicePreset: normalizeVoicePreset(user.preferredVoicePreset),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    passwordUpdatedAt: user.passwordUpdatedAt,
    mustChangePassword: user.mustChangePassword
  };
}

function normalizeVoiceDailyLimit(value: unknown): number {
  return Number.isInteger(value) && Number(value) >= 0 && Number(value) <= 10_000
    ? Number(value)
    : DEFAULT_VOICE_DAILY_LIMIT;
}

function normalizeVoicePreset(value: unknown): 1 | 2 | 3 | 4 | 5 {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 5
    ? Number(value) as 1 | 2 | 3 | 4 | 5
    : DEFAULT_VOICE_PRESET;
}

function normalizeRole(role: unknown): Role {
  return role === "admin" || role === "attending" || role === "medical-student" ? role : "viewer";
}

function hashSecret(secret: string): PasswordHash {
  const salt = crypto.randomBytes(16).toString("base64url");
  const key = crypto.scryptSync(secret, salt, 64).toString("base64url");
  return { algorithm: "scrypt", salt, key };
}

function verifySecret(secret: string, hash: PasswordHash): boolean {
  if (hash.algorithm !== "scrypt") return false;
  const candidate = crypto.scryptSync(secret, hash.salt, 64);
  const expected = Buffer.from(hash.key, "base64url");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function normalizeUsername(username: string): string {
  const normalized = username.trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,40}$/.test(normalized)) {
    throw new Error("Usernames must be 2-40 lowercase letters, numbers, dots, underscores, or dashes");
  }
  return normalized;
}

function assertUsableSecret(secret: string, label: string) {
  if (secret.length < 4) throw new Error(`${label} must be at least 4 characters`);
}

function getInitialAdminPassword(): string {
  return process.env.ADMIN_PASSWORD ?? generateTemporaryPassword();
}

function getInitialSeedUserPassword(): string {
  return process.env.SEED_USER_PASSWORD ?? generateTemporaryPassword();
}

function generateTemporaryPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.randomBytes(14);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

function readOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function privilegeRank(privilege: "view" | "request" | "edit"): number {
  return { view: 0, request: 1, edit: 2 }[privilege];
}
