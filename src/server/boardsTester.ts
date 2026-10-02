import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import express from 'express';
import { authenticate, AuthenticatedRequest, getAuthConfig, requirePasswordReady, verifyToken } from './auth';
import { UserStore } from './userStore';

const scrypt = promisify(crypto.scrypt);
const COOKIE = 'boards_tester';
const TTL = 2 * 60 * 60 * 1000;
const BODY_LIMIT = 32 * 1024;
export async function hashSimulatorPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt}:${key.toString('hex')}`;
}
async function verifyPassword(password: unknown, hash: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const [algorithm, salt, key] = hash.split(':');
  if (algorithm !== 'scrypt' || !/^[a-f0-9]{32}$/.test(salt || '') || !/^[a-f0-9]{128}$/.test(key || '')) return false;
  return crypto.timingSafeEqual(await scrypt(password, salt, 64) as Buffer, Buffer.from(key, 'hex'));
}
function sign(value: string) { return crypto.createHmac('sha256', getAuthConfig().secret).update(value).digest('base64url'); }
function safeEqual(a: string, b: string) { return a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); }
function fingerprint() { return sign(process.env.SBS_ACCESS_PASSWORD_HASH || 'disabled'); }
function reviewer(accountId: string) { return (process.env.SBS_REVIEWER_ACCOUNT_IDS || '').split(',').map(s => s.trim()).includes(accountId); }
export function httpName(name: string) { return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\x20-\x7e]/g, '').trim().slice(0, 160) || 'Tester'; }

export function boardsTesterRouter(store: UserStore) {
  const router = express.Router();
  const limits = new Map<string, { count: number; until: number }>();
  function consume(key: string, count: number, window: number) {
    const now = Date.now();
    for (const [id, value] of limits) if (value.until <= now) limits.delete(id);
    const value = limits.get(key) || { count: 0, until: now + window };
    limits.set(key, value);
    return ++value.count <= count;
  }
  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  router.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      const expected = process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : `${req.protocol}://${req.get('host')}`;
      if (req.get('origin') !== expected || req.get('sec-fetch-site') === 'cross-site') {
        res.status(403).json({ detail: 'Same-origin request required' }); return;
      }
    }
    next();
  });
  router.use(express.json({ limit: BODY_LIMIT }));
  const cookieOptions = () => ({ httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict' as const, path: '/api/boards-tester' });
  router.post('/access', authenticate(store), requirePasswordReady, async (req: AuthenticatedRequest, res, next) => {
    try {
      if (req.user?.authType !== 'session') { res.status(403).json({ detail: 'Authenticated account required' }); return; }
      if (!consume(`unlock:${req.user.username}`, 5, 15 * 60 * 1000) || !consume(`ip:${req.ip}`, 20, 15 * 60 * 1000)) {
        res.status(429).json({ detail: 'Too many password attempts. Try again in 15 minutes.' }); return;
      }
      if (!process.env.SBS_ACCESS_PASSWORD_HASH || !process.env.SBS_GATEWAY_TOKEN) { res.status(503).json({ detail: 'Simulator access is not configured' }); return; }
      if (!await verifyPassword(req.body?.password, process.env.SBS_ACCESS_PASSWORD_HASH)) { res.status(403).json({ detail: 'Incorrect simulator password' }); return; }
      const accountId = await store.getAccountId(req.user.username);
      if (!accountId) { res.status(401).json({ detail: 'Account no longer exists' }); return; }
      const token = req.get('authorization')!.slice(7);
      const payload = Buffer.from(JSON.stringify({ token, exp: Date.now() + TTL, gate: fingerprint(), owner: sign(accountId) })).toString('base64url');
      res.cookie(COOKIE, `${payload}.${sign(payload)}`, { ...cookieOptions(), maxAge: TTL });
      res.json({ displayName: req.user.displayName, reviewer: !!accountId && reviewer(accountId) });
    } catch (error) { next(error); }
  });
  router.delete('/access', (_req, res) => { res.clearCookie(COOKIE, cookieOptions()); res.json({ ok: true }); });
  router.use(async (req: AuthenticatedRequest, res, next) => {
    try {
      const cookie = req.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
      const [payload, signature] = decodeURIComponent(cookie || '').split('.');
      if (!payload || !signature || !safeEqual(signature, sign(payload))) throw new Error('Access required');
      const access = JSON.parse(Buffer.from(payload, 'base64url').toString());
      if (access.exp <= Date.now() || access.gate !== fingerprint() || !process.env.SBS_ACCESS_PASSWORD_HASH) throw new Error('Access expired');
      const user = await verifyToken(store, access.token);
      if (!user || user.mustChangePassword) throw new Error('Account session expired');
      const accountId = await store.getAccountId(user.username);
      if (!accountId || access.owner !== sign(accountId)) throw new Error('Account session expired');
      req.user = { ...user, authType: 'session' };
      next();
    } catch { res.status(401).json({ detail: 'Simulator access expired. Open Settings and unlock again.' }); }
  });
  router.get('/access', async (req: AuthenticatedRequest, res, next) => {
    try { const id = await store.getAccountId(req.user!.username); res.json({ displayName: req.user!.displayName, reviewer: !!id && reviewer(id) }); } catch (error) { next(error); }
  });
  router.use(async (req: AuthenticatedRequest, res, next) => {
    let upstreamReader: Readable | undefined;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    const disconnect = () => { if (!res.writableEnded) { controller.abort(); upstreamReader?.destroy(); } };
    res.on('close', disconnect);
    try {
      const route = req.path;
      const publicRoute = (req.method === 'GET' && ['/scenarios', '/feedback/options'].includes(route)) ||
        (req.method === 'POST' && route === '/session/start') ||
        (/^\/session\/[a-zA-Z0-9_-]+$/.test(route) && req.method === 'DELETE') ||
        (/^\/session\/[a-zA-Z0-9_-]+\/(state|exchanges|feedback|score)$/.test(route) && req.method === 'GET') ||
        (/^\/session\/[a-zA-Z0-9_-]+\/(input|feedback)$/.test(route) && req.method === 'POST');
      const reviewRoute = (route === '/feedback' && req.method === 'GET') ||
        (/^\/feedback\/[a-zA-Z0-9_-]+\/bundle$/.test(route) && req.method === 'GET') ||
        (/^\/feedback\/[a-zA-Z0-9_-]+\/triage$/.test(route) && req.method === 'POST');
      if (!publicRoute && !reviewRoute) { res.status(404).json({ detail: 'Unknown tester route' }); return; }
      const accountId = await store.getAccountId(req.user!.username);
      if (!accountId) { res.status(401).json({ detail: 'Account no longer exists' }); return; }
      const isReviewer = reviewer(accountId);
      if (reviewRoute && !isReviewer) { res.status(403).json({ detail: 'Reviewer authorization required' }); return; }
      if (!consume(`api:${accountId}`, 60, 60_000)) { res.set('Retry-After', '60').status(429).json({ detail: 'Too many simulator requests. Try again in a minute.' }); return; }
      const token = process.env.SBS_GATEWAY_TOKEN;
      if (!token) { res.status(503).json({ detail: 'Simulator unavailable' }); return; }
      // Construct a new header allowlist; browser Authorization and X-SBS-* never travel upstream.
      const headers = { Authorization: `Bearer ${token}`, 'X-SBS-User-Id': accountId, 'X-SBS-User-Name': httpName(req.user!.displayName), 'X-SBS-Reviewer': String(isReviewer), 'Content-Type': 'application/json', Accept: req.get('accept') === 'text/event-stream' ? 'text/event-stream' : 'application/json' };
      const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      const base = (process.env.SBS_TESTER_URL || 'http://127.0.0.1:8005').replace(/\/$/, '');
      const upstream = await fetch(`${base}/v1${route}${query}`, { method: req.method, headers, body: req.method === 'POST' ? JSON.stringify(req.body) : undefined, signal: controller.signal, redirect: 'error' });
      res.status(upstream.status);
      for (const header of ['content-type', 'content-disposition', 'retry-after']) { const value = upstream.headers.get(header); if (value) res.set(header, value); }
      res.set('X-Accel-Buffering', 'no');
      res.flushHeaders();
      if (upstream.body) { upstreamReader = Readable.fromWeb(upstream.body as any); await pipeline(upstreamReader, res); } else res.end();
    } catch (error) {
      if (res.destroyed) return;
      if (res.headersSent) res.destroy();
      else res.status(controller.signal.aborted ? 504 : 502).json({ detail: controller.signal.aborted ? 'Simulator timed out. Recover exchanges or start a new case.' : 'Simulator unavailable. Try again shortly.' });
    } finally { clearTimeout(timeout); res.off('close', disconnect); }
  });
  router.use((error: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (error?.type === 'entity.too.large') res.status(413).json({ detail: 'Simulator input exceeds 32 KB' });
    else if (error?.type === 'entity.parse.failed') res.status(400).json({ detail: 'Invalid JSON' });
    else next(error);
  });
  return router;
}
