import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createServer, Server, RequestListener } from 'node:http';
import { boardsTesterRouter, hashSimulatorPassword } from './boardsTester';
import { createToken } from './auth';
import { FileUserStore } from './userStore';

let directory: string;
let store: FileUserStore;
let app: express.Express;
let token: string;
let accountId: string;
let upstream: Server | undefined;
const origin = 'https://planner.example';
async function unlock(password = 'simulator-secret') {
  return request(app).post('/api/boards-tester/access').set('Origin', origin).set('Authorization', `Bearer ${token}`).send({ password });
}
async function cookie() {
  const result = await unlock(); expect(result.status).toBe(200);
  return result.headers['set-cookie'][0].split(';')[0];
}
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'tester-gateway-'));
  vi.stubEnv('APP_SECRET', 'a'.repeat(32)); vi.stubEnv('ADMIN_PASSWORD', 'test-admin-password');
  vi.stubEnv('PUBLIC_BASE_URL', origin); vi.stubEnv('SBS_GATEWAY_TOKEN', 'gateway-test-only');
  vi.stubEnv('SBS_ACCESS_PASSWORD_HASH', await hashSimulatorPassword('simulator-secret'));
  vi.stubEnv('SBS_REVIEWER_ACCOUNT_IDS', '');
  store = new FileUserStore(path.join(directory, 'users.json'));
  const user = (await store.createUser({ username: 'tester', displayName: 'Élodie 王', password: 'test-account-password' })).user;
  token = createToken(user); accountId = (await store.getAccountId('tester'))!;
  app = express(); app.use('/api/boards-tester', boardsTesterRouter(store));
});
afterEach(async () => { if (upstream) { upstream.closeAllConnections(); await new Promise<void>(resolve => upstream!.close(() => resolve())); upstream = undefined; } vi.unstubAllEnvs(); await fs.rm(directory, { recursive: true, force: true }); });
async function startUpstream(handler: RequestListener) {
  upstream = createServer(handler); await new Promise<void>(resolve => upstream!.listen(0, '127.0.0.1', resolve));
  const address = upstream.address() as { port: number }; vi.stubEnv('SBS_TESTER_URL', `http://127.0.0.1:${address.port}`);
}
describe('tester gateway', () => {
  it('requires an account, an extra password, and same origin; limits attempts', async () => {
    await request(app).post('/api/boards-tester/access').set('Origin', origin).send({ password: 'simulator-secret' }).expect(401);
    await request(app).post('/api/boards-tester/access').set('Origin', 'https://evil.example').set('Authorization', `Bearer ${token}`).send({ password: 'simulator-secret' }).expect(403);
    for (let i = 0; i < 5; i++) expect((await unlock('wrong')).status).toBe(403);
    expect((await unlock()).status).toBe(429);
    await request(app).get('/api/boards-tester/scenarios').set('Authorization', `Bearer ${token}`).expect(401);
  });
  it('uses trusted stable identity and streams POST SSE before the upstream closes', async () => {
    let finish: (() => void) | undefined;
    const released = new Promise<void>(resolve => { finish = resolve; });
    await startUpstream((req, res) => {
      expect(req.url).toBe('/v1/session/case/input');
      expect(req.headers.authorization).toBe('Bearer gateway-test-only');
      expect(req.headers['x-sbs-user-id']).toBe(accountId);
      expect(req.headers['x-sbs-user-name']).toBe('Elodie');
      expect(req.headers['x-sbs-reviewer']).toBe('false');
      expect(req.headers['x-sbs-evil']).toBeUndefined();
      res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"t":"Hello"}\n\n');
      void released.then(() => res.end('data: {"m":{"turn":1}}\n\n'));
    });
    const grant = await cookie();
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address() as { port: number };
    try {
      const response = await fetch(`http://127.0.0.1:${address.port}/api/boards-tester/session/case/input`, { method: 'POST', headers: { Origin: origin, Cookie: grant, Authorization: 'Bearer forged', 'X-SBS-User-Id': 'victim', 'X-SBS-Reviewer': 'true', 'X-SBS-Evil': 'evil', 'Content-Type': 'application/json' }, body: JSON.stringify({ user_text: 'hello' }) });
      expect(response.status).toBe(200); expect(response.headers.get('x-accel-buffering')).toBe('no');
      const reader = response.body!.getReader();
      expect(new TextDecoder().decode((await reader.read()).value)).toContain('Hello');
      finish!(); while (!(await reader.read()).done) { /* drain */ }
    } finally { finish!(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('blocks global review unless separately authorized and retains upstream status', async () => {
    await startUpstream((req, res) => { expect(req.headers['x-sbs-reviewer']).toBe('true'); res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '20' }); res.end('{"detail":"At capacity"}'); });
    const grant = await cookie();
    for (const route of ['/feedback', '/feedback/report/bundle']) await request(app).get(`/api/boards-tester${route}`).set('Cookie', grant).set('X-SBS-Reviewer', 'true').expect(403);
    await request(app).post('/api/boards-tester/feedback/report/triage').set('Cookie', grant).set('Origin', origin).send({ status: 'resolved' }).expect(403);
    vi.stubEnv('SBS_REVIEWER_ACCOUNT_IDS', accountId);
    const response = await request(app).get('/api/boards-tester/feedback').set('Cookie', grant).expect(429);
    expect(response.body.detail).toBe('At capacity'); expect(response.headers['retry-after']).toBe('20');
  });
  it('revokes access on password rotation or deletion; stable IDs survive names and restart', async () => {
    const grant = await cookie();
    await store.updateUser('tester', { displayName: 'Changed name' });
    expect(await new FileUserStore(path.join(directory, 'users.json')).getAccountId('tester')).toBe(accountId);
    const response = await request(app).get('/api/boards-tester/access').set('Cookie', grant).expect(200);
    expect(response.body.displayName).toBe('Changed name'); expect(response.body.accountId).toBeUndefined();
    vi.stubEnv('SBS_ACCESS_PASSWORD_HASH', await hashSimulatorPassword('rotated'));
    await request(app).get('/api/boards-tester/access').set('Cookie', grant).expect(401);
    const nextGrant = (await unlock('rotated')).headers['set-cookie'][0].split(';')[0];
    await store.deleteUser('tester');
    await request(app).get('/api/boards-tester/scenarios').set('Cookie', nextGrant).expect(401);
    await store.createUser({ username: 'tester', password: 'test-account-password' });
    expect(await store.getAccountId('tester')).not.toBe(accountId);
  });
  it('rejects oversized inputs and undocumented backend routes', async () => {
    const grant = await cookie();
    await request(app).post('/api/boards-tester/session/case/input').set('Origin', origin).set('Cookie', grant).send({ user_text: 'x'.repeat(33_000) }).expect(413);
    await request(app).get('/api/boards-tester/editor').set('Cookie', grant).expect(404);
    await request(app).post('/api/boards-tester/session/start').set('Cookie', grant).send({ scenario_name: 'case' }).expect(403);
  });
});
