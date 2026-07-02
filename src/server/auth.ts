import crypto from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { Role, SERVICE_LINES, SessionUser } from "../shared/types";
import { UserStore, hasServicePrivilege } from "./userStore";

const TOKEN_TTL_SECONDS = 60 * 60 * 18;

export interface AuthenticatedRequest extends Request {
  user?: SessionUser & {
    authType: "session" | "apiKey";
  };
}

export function getAuthConfig() {
  return {
    secret: process.env.APP_SECRET ?? "dev-secret-change-me",
    adminApiKey: process.env.ADMIN_API_KEY,
    viewerApiKey: process.env.VIEWER_API_KEY
  };
}

export async function validateLogin(userStore: UserStore, username: string, password: string): Promise<SessionUser | undefined> {
  const user = await userStore.authenticate(username, password);
  return user
    ? {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        servicePrivileges: user.servicePrivileges,
        mustChangePassword: user.mustChangePassword,
        temporaryPasswordExpiresAt: user.temporaryPasswordExpiresAt
      }
    : undefined;
}

export function createToken(user: Pick<SessionUser, "username" | "role">): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = base64Url(JSON.stringify({ username: user.username, role: user.role, exp: expiresAt }));
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export async function verifyToken(userStore: UserStore, token: string): Promise<SessionUser | undefined> {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return undefined;

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
    username?: string;
    role?: Role;
    exp?: number;
  };
  if (!parsed.username || !parsed.role || !["admin", "viewer"].includes(parsed.role)) return undefined;
  if (!parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return undefined;

  const user = await userStore.getUser(parsed.username);
  if (!user || user.role !== parsed.role) return undefined;
  return {
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    servicePrivileges: user.servicePrivileges,
    mustChangePassword: user.mustChangePassword,
    temporaryPasswordExpiresAt: user.temporaryPasswordExpiresAt
  };
}

export function verifyApiKey(apiKey: string | undefined): SessionUser | undefined {
  if (!apiKey) return undefined;
  const config = getAuthConfig();
  if (config.adminApiKey && safeEqual(apiKey, config.adminApiKey)) {
    return makeApiKeyUser("api-admin", "API admin", "admin", "edit");
  }
  if (config.viewerApiKey && safeEqual(apiKey, config.viewerApiKey)) {
    return makeApiKeyUser("api-viewer", "API viewer", "viewer", "view");
  }
  return undefined;
}

export function authenticate(userStore: UserStore) {
  return async function authenticateRequest(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const header = req.header("authorization");
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      const apiKeyUser = verifyApiKey(req.header("x-api-key"));
      if (apiKeyUser) {
        req.user = { ...apiKeyUser, authType: "apiKey" };
        next();
        return;
      }

      const user = token ? await verifyToken(userStore, token) : undefined;
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      req.user = { ...user, authType: "session" };
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!passwordReady(req, res)) return;
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

export function requireServiceEdit(req: AuthenticatedRequest, res: Response, serviceLine: string | undefined): boolean {
  if (!passwordReady(req, res)) return false;
  if (hasServicePrivilege(req.user, serviceLine, "edit")) return true;
  res.status(403).json({ error: "Edit privilege required for this service" });
  return false;
}

export function requireServiceRequest(req: AuthenticatedRequest, res: Response, serviceLine: string | undefined): boolean {
  if (!passwordReady(req, res)) return false;
  if (hasServicePrivilege(req.user, serviceLine, "request")) return true;
  res.status(403).json({ error: "Request privilege required for this service" });
  return false;
}

function makeApiKeyUser(username: string, displayName: string, role: Role, privilege: "view" | "edit"): SessionUser {
  return {
    username,
    displayName,
    role,
    servicePrivileges: Object.fromEntries(SERVICE_LINES.map((service) => [service, privilege])),
    mustChangePassword: false,
    temporaryPasswordExpiresAt: undefined
  };
}

export function requirePasswordReady(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!passwordReady(req, res)) return;
  next();
}

function passwordReady(req: AuthenticatedRequest, res: Response): boolean {
  if (!req.user?.mustChangePassword) return true;
  res.status(403).json({ error: "Password change required" });
  return false;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getAuthConfig().secret).update(payload).digest("base64url");
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}
