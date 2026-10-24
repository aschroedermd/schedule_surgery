import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { Router, type RequestHandler } from "express";
import { type AuthenticatedRequest, requirePasswordReady, requireSessionAdmin } from "./auth";
import { getDefaultUserStorePath, type UserStore } from "./userStore";
import type { SupportConversation, SupportMessage } from "../shared/support";

const PRESENCE_MS = 25_000;
const LEASE_MS = 30_000;
interface RecordData {
  id: string; username: string; displayName: string; serviceLine?: string; messages: SupportMessage[]; revision: number;
  audit: Array<{ at: string; event: string; actor: string; requestId?: string }>;
}
interface Live {
  data: RecordData;
  presence: Map<string, number>;
  lease?: { actor: string; token: string; until: number };
  pending?: { id: string; reply?: string };
}
export class SupportError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
/** One server process owns the files and live leases, matching FileUserStore. */
export class SupportConversations {
  private records = new Map<string, Live>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private directory = process.env.CHAT_CONVERSATIONS_PATH || path.join(path.dirname(getDefaultUserStorePath()), "conversations"), private now = Date.now) {}
  private file(id: string) { return path.join(this.directory, `${createHash("sha256").update(id).digest("hex")}.json`); }
  private async get(id: string): Promise<Live> {
    let live = this.records.get(id);
    if (!live) {
      let data: RecordData;
      try { data = JSON.parse(await fs.readFile(this.file(id), "utf8")); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        data = { id, username: "", displayName: "", messages: [], revision: 0, audit: [] };
      }
      live = { data, presence: new Map() };
      this.records.set(id, live);
    }
    return live;
  }
  private async save(live: Live) {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    const file = this.file(live.data.id);
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(live.data), { mode: 0o600 });
      await fs.rename(temp, file);
    } finally { await fs.rm(temp, { force: true }).catch(() => undefined); }
  }
  private transact<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }
  private async expire(live: Live) {
    for (const [tab, until] of live.presence) if (until <= this.now()) live.presence.delete(tab);
    if (live.lease && (live.lease.until <= this.now() || live.presence.size === 0)) {
      live.data.audit.push({ at: new Date(this.now()).toISOString(), event: "release-expired", actor: live.lease.actor });
      live.lease = undefined;
      await this.save(live);
    }
  }
  private view(live: Live, admin = false): SupportConversation {
    return { id: live.data.id, username: live.data.username, displayName: live.data.displayName,
      serviceLine: live.data.serviceLine, messages: live.data.messages.map(m => ({ ...m })), revision: live.data.revision,
      active: live.presence.size > 0, humanJoined: !!live.lease, busy: !!live.pending,
      pendingRequestId: live.pending?.reply === undefined ? live.pending?.id : undefined, ...(admin ? { owner: live.lease?.actor } : {}) };
  }
  snapshot(id: string) {
    return this.transact(async () => { const live = await this.get(id); await this.expire(live); return this.view(live); });
  }
  clear(id: string, revision: number, actor: string) {
    return this.transact(async () => {
      const live = await this.get(id);
      if (live.pending) throw new SupportError(409, "Wait for the current response to finish before clearing chat");
      if (revision !== live.data.revision) throw new SupportError(409, "The conversation changed. Please retry with the latest history.");
      const previous = live.data;
      live.data = { ...previous, messages: [], revision: previous.revision + 1,
        audit: [...previous.audit, { at: new Date(this.now()).toISOString(), event: "clear", actor }] };
      try { await this.save(live); } catch (error) { live.data = previous; throw error; }
      return this.view(live);
    });
  }
  presence(id: string, tab: string, active: boolean, username: string, displayName: string, serviceLine?: string) {
    return this.transact(async () => {
      const live = await this.get(id);
      live.data.username = username; live.data.displayName = displayName;
      if (serviceLine) live.data.serviceLine = serviceLine;
      if (active) live.presence.set(tab, this.now() + PRESENCE_MS); else live.presence.delete(tab);
      await this.expire(live);
      return this.view(live);
    });
  }
  list() {
    return this.transact(async () => {
      const views = await Promise.all([...this.records.values()].map(async live => { await this.expire(live); return this.view(live, true); }));
      return views.filter(view => view.active);
    });
  }
  claim(id: string, actor: string, token: string) {
    return this.transact(async () => {
      const live = await this.get(id); await this.expire(live);
      if (!live.presence.size) throw new SupportError(409, "This user is no longer on the assistant page");
      if (live.lease && (live.lease.actor !== actor || live.lease.token !== token)) throw new SupportError(409, "Another support session owns this conversation");
      if (!live.lease && live.pending) throw new SupportError(409, "Wait for the current response to finish before joining");
      if (!live.lease) live.data.audit.push({ at: new Date(this.now()).toISOString(), event: "join", actor });
      const previous = live.lease;
      live.lease = { actor, token, until: this.now() + LEASE_MS };
      try { await this.save(live); } catch (error) { live.lease = previous; throw error; }
      return this.view(live, true);
    });
  }
  heartbeat(id: string, actor: string, token: string) {
    return this.transact(async () => {
      const live = await this.get(id); await this.expire(live); this.assertOwner(live, actor, token);
      live.lease!.until = this.now() + LEASE_MS;
      return this.view(live, true);
    });
  }
  release(id: string, actor: string, token: string) {
    return this.transact(async () => {
      const live = await this.get(id); await this.expire(live);
      if (live.lease) {
        this.assertOwner(live, actor, token);
        live.data.audit.push({ at: new Date(this.now()).toISOString(), event: "release", actor });
        live.lease = undefined;
      }
      await this.save(live);
    });
  }
  private assertOwner(live: Live, actor: string, token: string) {
    if (!live.lease || live.lease.actor !== actor || live.lease.token !== token) throw new SupportError(409, "Support ownership has expired or changed");
  }
  reply(id: string, actor: string, token: string, requestId: string, text: string) {
    return this.transact(async () => {
      const live = await this.get(id); await this.expire(live); this.assertOwner(live, actor, token);
      if (live.pending?.id !== requestId || live.pending.reply !== undefined) throw new SupportError(409, "This question is no longer waiting for a reply");
      live.data.audit.push({ at: new Date(this.now()).toISOString(), event: "reply", actor, requestId });
      await this.save(live);
      live.pending.reply = text;
    });
  }
  begin(id: string, revision: number, messageId: string, content: string) {
    return this.transact(async () => {
      const live = await this.get(id); await this.expire(live);
      if (live.pending) throw new SupportError(409, "A response is already in progress in this conversation");
      if (revision !== live.data.revision) throw new SupportError(409, "The conversation changed. Please retry with the latest history.");
      if (live.data.messages.some(m => m.id === messageId)) throw new SupportError(409, "This message has already been submitted");
      live.pending = { id: randomUUID() };
      live.data.messages.push({ id: messageId, role: "user", content, createdAt: new Date(this.now()).toISOString() });
      live.data.revision++;
      try { await this.save(live); } catch (error) { live.pending = undefined; live.data.messages.pop(); live.data.revision--; throw error; }
      return { requestId: live.pending.id, serviceLine: live.data.serviceLine, messages: live.data.messages.map(m => ({ role: m.role, content: m.content })), human: !!live.lease };
    });
  }
  async waitForReply(id: string, requestId: string, signal: AbortSignal): Promise<string | undefined> {
    while (!signal.aborted) {
      const result = await this.transact(async () => {
        const live = await this.get(id); await this.expire(live);
        if (live.pending?.id !== requestId) throw new SupportError(409, "This response is no longer active");
        return { reply: live.pending.reply, human: !!live.lease };
      });
      if (result.reply !== undefined) return result.reply;
      if (!result.human) return undefined;
      await new Promise<void>(resolve => { const timeout = setTimeout(done, 200); function done() { clearTimeout(timeout); signal.removeEventListener("abort", done); resolve(); } signal.addEventListener("abort", done, { once: true }); });
    }
    throw new DOMException("Request stopped", "AbortError");
  }
  complete(id: string, requestId: string, message: Omit<SupportMessage, "id" | "role" | "createdAt">) {
    return this.transact(async () => {
      const live = await this.get(id);
      if (live.pending?.id !== requestId) throw new SupportError(409, "This response is no longer active");
      const entry: SupportMessage = { ...message, id: randomUUID(), role: "assistant", createdAt: new Date(this.now()).toISOString() };
      live.data.messages.push(entry); live.data.revision++;
      try { await this.save(live); } catch (error) { live.data.messages.pop(); live.data.revision--; throw error; }
      live.pending = undefined;
      return { ...entry, revision: live.data.revision };
    });
  }
  recordAction(id: string, actionToken: string, choiceId: string, result: { message: string; stateVersion?: number; dataUpdatedAt?: string }) {
    return this.transact(async () => {
      const live = await this.get(id);
      const source = live.data.messages.find(message => message.interaction?.actionToken === actionToken);
      const option = source?.interaction?.options.find(choice => choice.id === choiceId);
      if (!option) throw new SupportError(409, "This confirmation is no longer in the conversation");
      const resultId = `action-${actionToken}`;
      if (!live.data.messages.some(message => message.id === resultId)) {
        const createdAt = new Date(this.now()).toISOString();
        const previousAnswered = source?.interactionAnswered;
        if (source) source.interactionAnswered = true;
        live.data.messages.push(
          { id: `choice-${actionToken}`, role: "user", content: option.label, createdAt },
          { id: resultId, role: "assistant", content: result.message, createdAt, responder: "ai", stateVersion: result.stateVersion, dataUpdatedAt: result.dataUpdatedAt }
        );
        live.data.revision++;
        try { await this.save(live); }
        catch (error) {
          live.data.messages.splice(-2); live.data.revision--;
          if (source) source.interactionAnswered = previousAnswered;
          throw error;
        }
      }
      return this.view(live);
    });
  }
  cancel(id: string, requestId: string) {
    return this.transact(async () => { const live = await this.get(id); if (live.pending?.id === requestId) live.pending = undefined; });
  }
}

export function supportRouter(conversations: SupportConversations, users: UserStore, auth: RequestHandler) {
  const router = Router();
  router.use(auth, requirePasswordReady);
  const handle = (work: (req: AuthenticatedRequest) => Promise<unknown>): RequestHandler => async (req, res, next) => {
    try { res.setHeader("cache-control", "no-store"); res.json(await work(req)); }
    catch (error) { if (error instanceof SupportError) res.status(error.status).json({ error: error.message }); else next(error); }
  };
  async function account(req: AuthenticatedRequest) {
    const id = await users.getAccountId(req.user!.username);
    if (!id) throw new SupportError(403, "A user account is required");
    return id;
  }
  const token = (value: unknown) => {
    if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(value)) throw new SupportError(400, "Invalid session identifier");
    return value;
  };
  router.get("/conversation", handle(async req => conversations.snapshot(await account(req))));
  router.delete("/conversation", handle(async req => {
    if (!Number.isSafeInteger(req.body.revision) || req.body.revision < 0) throw new SupportError(400, "Invalid conversation revision");
    return conversations.clear(await account(req), req.body.revision, req.user!.username);
  }));
  router.post("/presence", handle(async req => conversations.presence(await account(req), token(req.body.tabId), req.body.active === true, req.user!.username, req.user!.displayName || req.user!.username, typeof req.body.serviceLine === "string" ? req.body.serviceLine.slice(0, 100) : undefined)));
  router.use("/admin", requireSessionAdmin);
  router.get("/admin", handle(async () => conversations.list()));
  router.post("/admin/:id/claim", handle(async req => conversations.claim(token(req.params.id), req.user!.username, token(req.body.leaseToken))));
  router.post("/admin/:id/heartbeat", handle(async req => conversations.heartbeat(token(req.params.id), req.user!.username, token(req.body.leaseToken))));
  router.post("/admin/:id/release", handle(async req => { await conversations.release(token(req.params.id), req.user!.username, token(req.body.leaseToken)); return { ok: true }; }));
  router.post("/admin/:id/reply", handle(async req => {
    if (typeof req.body.text !== "string" || !req.body.text.trim() || req.body.text.length > 16000) throw new SupportError(400, "Reply must contain 1–16000 characters");
    await conversations.reply(token(req.params.id), req.user!.username, token(req.body.leaseToken), token(req.body.requestId), req.body.text.trim());
    return { ok: true };
  }));
  return router;
}
