import crypto from "node:crypto";
import { NextFunction, Request, Response } from "express";
import { Role } from "../shared/types";

const TOKEN_TTL_SECONDS = 60 * 60 * 18;

export interface AuthenticatedRequest extends Request {
  user?: {
    role: Role;
    authType: "session" | "apiKey";
  };
}

export function getAuthConfig() {
  return {
    secret: process.env.APP_SECRET ?? "dev-secret-change-me",
    adminPassword: process.env.ADMIN_PASSWORD ?? "admin-dev-password",
    viewerPassword: process.env.VIEWER_PASSWORD ?? "viewer-dev-password",
    adminApiKey: process.env.ADMIN_API_KEY,
    viewerApiKey: process.env.VIEWER_API_KEY
  };
}

export function validateLogin(role: Role, password: string): boolean {
  const config = getAuthConfig();
  const expected = role === "admin" ? config.adminPassword : config.viewerPassword;
  return safeEqual(password, expected);
}

export function createToken(role: Role): string {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = base64Url(JSON.stringify({ role, exp: expiresAt }));
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function verifyToken(token: string): { role: Role } | undefined {
  const [payload, signature] = token.split(".");
  if (!payload || !signature || !safeEqual(signature, sign(payload))) return undefined;

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { role: Role; exp: number };
  if (!["admin", "viewer"].includes(parsed.role)) return undefined;
  if (parsed.exp < Math.floor(Date.now() / 1000)) return undefined;
  return { role: parsed.role };
}

export function verifyApiKey(apiKey: string | undefined): { role: Role } | undefined {
  if (!apiKey) return undefined;
  const config = getAuthConfig();
  if (config.adminApiKey && safeEqual(apiKey, config.adminApiKey)) return { role: "admin" };
  if (config.viewerApiKey && safeEqual(apiKey, config.viewerApiKey)) return { role: "viewer" };
  return undefined;
}

export function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const user = token ? verifyToken(token) : undefined;
  const apiKeyUser = verifyApiKey(req.header("x-api-key"));
  if (apiKeyUser) {
    req.user = { ...apiKeyUser, authType: "apiKey" };
    next();
    return;
  }

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  req.user = { ...user, authType: "session" };
  next();
}

export function requireAdmin(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
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
