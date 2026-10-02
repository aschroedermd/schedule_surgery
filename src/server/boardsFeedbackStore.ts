import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDefaultUserStorePath } from './userStore';
export interface ArchivedComment { id: string; text: string; author: string; accountId: string; archivedAt: string; [key: string]: any; }
export class BoardsFeedbackStore {
  constructor(readonly root = process.env.SBS_COMMENT_ARCHIVE_PATH || path.join(path.dirname(getDefaultUserStorePath()), 'boards-feedback')) {}
  async save(entry: any, accountId: string, author: string): Promise<ArchivedComment> {
    if (!entry || !/^[a-zA-Z0-9_-]{1,160}$/.test(entry.id) || typeof entry.text !== 'string' || !accountId) throw Error('Invalid comment record');
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
    const record = { ...entry, client: { ...entry.client, user_id: accountId }, accountId, author, archivedAt: entry.archivedAt || new Date().toISOString() };
    const temp = path.join(this.root, `.${crypto.randomUUID()}.tmp`);
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); }
    finally { await handle.close(); }
    try {
      await fs.rename(temp, path.join(this.root, `${entry.id}.json`));
      const directory = await fs.open(this.root, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await fs.rm(temp, { force: true }); }
    return record;
  }
  async list(accountId?: string): Promise<ArchivedComment[]> {
    const names = await fs.readdir(this.root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const entries: ArchivedComment[] = [];
    for (const name of names.filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name))) {
      const entry = JSON.parse(await fs.readFile(path.join(this.root, name), 'utf8'));
      if (!accountId || entry.accountId === accountId) entries.push(entry);
    }
    return entries.sort((a, b) => String(a.at || a.created_at || a.archivedAt).localeCompare(String(b.at || b.created_at || b.archivedAt)));
  }
}
export function commentsCsv(entries: ArchivedComment[]) {
  const columns = ['id','at','author','accountId','sessionId','scenario','turn','category','severity','text','tags'];
  const cell = (value: unknown) => {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text)) text = `'${text}`;
    return `"${text.replaceAll('"','""')}"`;
  };
  return '\uFEFF' + columns.join(',') + '\r\n' + entries.map(entry => [entry.id, entry.at || entry.created_at || entry.archivedAt, entry.author, entry.accountId, entry.session?.id || entry.session?.session_id, entry.session?.scenario, entry.turn, entry.category, entry.severity, entry.text, (entry.tags || []).join(', ')].map(cell).join(',')).join('\r\n');
}
